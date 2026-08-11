import { NextResponse } from 'next/server';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { z } from 'zod';
import { loadServerEnvOnce } from '../../lib/loadEnv';
import { getBatchQuotes, getQuote } from '../../lib/finnhub';
import { isTrustedOrigin } from '../../lib/requestSecurity';
import getConnection from '../../lib/mysql';
import jwtUtil from '../../lib/jwt';
import {
  ensureAiEnv,
  getGeminiApiKey,
  queryChromaContext,
  storeChatTurn,
  upsertNewsToChroma,
  upsertStocksToChroma,
} from '../../lib/chromaMemory';

loadServerEnvOnce();

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const MAX_SESSION_MESSAGES = Number(process.env.AI_CHAT_SESSION_MESSAGE_LIMIT || 40);
const MAX_SAVED_CHATS = 3;
const STOCKS_FETCH_TIMEOUT_MS = Number(process.env.AI_STOCKS_FETCH_TIMEOUT_MS || 12000);
const NEWS_FETCH_TIMEOUT_MS = Number(process.env.AI_NEWS_FETCH_TIMEOUT_MS || 12000);
const CHROMA_TIMEOUT_MS = 1500; // Force fast timeout so it doesn't hang if Chroma is down
const AI_INFER_TIMEOUT_MS = Number(process.env.AI_INFER_TIMEOUT_MS || 60000);
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8001';
const CHAT_MODEL_PROVIDER = process.env.CHAT_MODEL_PROVIDER || 'gemini';
const CHAT_MODEL_ENABLE_FALLBACK = process.env.CHAT_MODEL_ENABLE_FALLBACK === 'true';

const HF_STOCK_MODEL_ENABLED = process.env.HF_STOCK_MODEL_ENABLED === 'true';
const HF_STOCK_MODEL_URL = process.env.HF_STOCK_MODEL_URL || 'https://raghav6753-chatbot.hf.space';
const HF_STOCK_MODEL_API_NAME = process.env.HF_STOCK_MODEL_API_NAME || 'answer';
const HF_STOCK_MODEL_TIMEOUT_MS = Number(process.env.HF_STOCK_MODEL_TIMEOUT_MS || 120000);
const HF_TOKEN = process.env.HF_TOKEN || '';

let aiChainPromise = null;
let agentModelPromise = null;

async function getUserId(req) {
  const token = req.cookies.get(jwtUtil.ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;
  try {
    return String((await jwtUtil.verifyAccessToken(token)).sub);
  } catch {
    return null;
  }
}

async function ensureChatTables(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ai_chat_sessions (
      id VARCHAR(100) NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_ai_chat_sessions_user (user_id, updated_at),
      CONSTRAINT fk_ai_chat_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ai_chat_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      session_id VARCHAR(100) NOT NULL,
      role ENUM('user', 'assistant') NOT NULL,
      text TEXT NOT NULL,
      action_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_ai_chat_messages_session (session_id, id),
      CONSTRAINT fk_ai_chat_messages_session FOREIGN KEY (session_id) REFERENCES ai_chat_sessions (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function getSavedHistory(userId, sessionId, limit = MAX_SESSION_MESSAGES) {
  const conn = await getConnection();
  try {
    await ensureChatTables(conn);
    const [rows] = await conn.query(
      `SELECT m.id, m.role, m.text, m.action_json, m.created_at
       FROM ai_chat_messages m
       JOIN ai_chat_sessions s ON s.id = m.session_id
       WHERE s.id = ? AND s.user_id = ? ORDER BY m.id ASC LIMIT ?`,
      [sessionId, userId, limit]
    );

    return rows.map((row) => ({
      id: String(row.id), role: row.role, text: row.text, createdAt: row.created_at,
      action: row.action_json ? (typeof row.action_json === 'string' ? JSON.parse(row.action_json) : row.action_json) : null,
    }));
  } finally {
    conn.release();
  }
}

async function saveChatTurn(userId, sessionId, prompt, answer, action = null) {
  const conn = await getConnection();
  try {
    await ensureChatTables(conn);
    const [sessions] = await conn.query('SELECT id FROM ai_chat_sessions WHERE id = ? AND user_id = ? LIMIT 1', [sessionId, userId]);
    if (!sessions.length) {
      const [countRows] = await conn.query('SELECT COUNT(*) AS total FROM ai_chat_sessions WHERE user_id = ?', [userId]);
      if (Number(countRows[0].total) >= MAX_SAVED_CHATS) {
        const error = new Error('You can keep up to 3 chats. Delete one before creating another.');
        error.statusCode = 429;
        throw error;
      }
      await conn.query('INSERT INTO ai_chat_sessions (id, user_id) VALUES (?, ?)', [sessionId, userId]);
    }
    await conn.query(
      'INSERT INTO ai_chat_messages (session_id, role, text, action_json) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
      [sessionId, 'user', prompt, null, sessionId, 'assistant', answer, action ? JSON.stringify(action) : null]
    );
    await conn.query('UPDATE ai_chat_sessions SET updated_at = UTC_TIMESTAMP() WHERE id = ?', [sessionId]);
  } finally {
    conn.release();
  }
}

const agentTools = [
  {
    name: 'reply_to_user',
    description: 'Reply to a research question, explain missing details, or ask one short follow-up question. Use this when no action should be prepared.',
    schema: z.object({ answer: z.string() }),
  },
  {
    name: 'prepare_trade',
    description: 'Prepare a virtual buy or sell order only when the user clearly gives a stock, quantity, and side. This never executes a trade.',
    schema: z.object({ side: z.enum(['BUY', 'SELL']), symbol: z.string(), quantity: z.number() }),
  },
  {
    name: 'create_price_alert',
    description: 'Prepare a price alert only when the user clearly gives a stock, an above or below direction, and a target price.',
    schema: z.object({ symbol: z.string(), direction: z.enum(['above', 'below']), targetPrice: z.number() }),
  },
  {
    name: 'create_observation',
    description: 'Prepare a stock observation when the user wants to track a thesis over time. Ask for missing thesis or duration instead of calling this tool.',
    schema: z.object({ symbol: z.string(), thesis: z.string(), hours: z.number().int() }),
  },
];

function validSymbol(value) {
  return /^[A-Z][A-Z0-9.]{0,19}$/.test(value);
}

function actionFromTool(toolCall) {
  const args = toolCall?.args || {};
  const symbol = String(args.symbol || '').trim().toUpperCase();
  if (!validSymbol(symbol)) return null;

  if (toolCall.name === 'prepare_trade') {
    const quantity = Number(args.quantity);
    const side = args.side === 'BUY' || args.side === 'SELL' ? args.side : null;
    if (side && Number.isFinite(quantity) && quantity > 0 && quantity <= 1_000_000) {
      return { type: 'trade', side, symbol, quantity };
    }
  }
  if (toolCall.name === 'create_price_alert') {
    const targetPrice = Number(args.targetPrice);
    const direction = args.direction === 'above' || args.direction === 'below' ? args.direction : null;
    if (direction && Number.isFinite(targetPrice) && targetPrice > 0) {
      return { type: 'alert', symbol, direction, targetPrice };
    }
  }
  if (toolCall.name === 'create_observation') {
    const thesis = String(args.thesis || '').trim();
    const hours = Number(args.hours);
    if (thesis && thesis.length <= 500 && Number.isInteger(hours) && hours >= 1 && hours <= 2160) {
      return { type: 'observation', symbol, thesis, hours };
    }
  }
  return null;
}

function normalizeAiError(error) {
  const raw = error instanceof Error ? error.message : String(error || 'AI chat failed');
  const message = String(raw || 'AI chat failed');

  if (Number.isInteger(error?.statusCode)) {
    return { status: error.statusCode, body: { error: message } };
  }

  const isInvalidKey =
    message.includes('API_KEY_INVALID') ||
    message.toLowerCase().includes('api key expired') ||
    message.toLowerCase().includes('api key not valid');

  if (isInvalidKey) {
    return {
      status: 401,
      body: {
        error: 'Gemini API key is invalid or expired. Update GEMINI_API_KEY (or GOOGLE_API_KEY) and restart the server.',
        code: 'GEMINI_API_KEY_INVALID',
      },
    };
  }

  return {
    status: 500,
    body: {
      error: message,
    },
  };
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchStocksFromApi(origin) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STOCKS_FETCH_TIMEOUT_MS);
  const res = await fetch(`${origin}/api/market/stocks`, { cache: 'no-store', signal: controller.signal })
    .catch(() => null)
    .finally(() => clearTimeout(timeoutId));
  if (res?.ok) {
    const data = await res.json().catch(() => ({}));
    if (Array.isArray(data?.stocks) && data.stocks.length) return data.stocks;
  }

  // A Railway service can occasionally time out while calling its own public
  // URL. Use Finnhub directly so the chat remains available in that case.
  const symbols = ['AAPL', 'MSFT', 'NVDA', 'TSLA'];
  const quotes = await getBatchQuotes(symbols).catch(() => ({}));
  return symbols
    .filter((symbol) => quotes[symbol]?.price > 0)
    .map((symbol) => ({
      sym: symbol,
      name: symbol,
      sector: 'Market data',
      price: quotes[symbol].price,
      chg: quotes[symbol].percentChange,
      live: true,
    }));
}

async function fetchNewsFromApi(origin) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NEWS_FETCH_TIMEOUT_MS);
  const res = await fetch(`${origin}/api/news/realtime?count=50`, { cache: 'no-store', signal: controller.signal })
    .catch(() => null)
    .finally(() => clearTimeout(timeoutId));
  if (!res) return [];
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data?.news) ? data.news : [];
}

function toStockDocs(stocks) {
  return stocks.map((s) => ({
    document: [
      `Symbol: ${String(s?.sym || '')}`,
      `Name: ${String(s?.name || '')}`,
      `Sector: ${String(s?.sector || '')}`,
      `Price: ${Number(s?.price || 0)}`,
      `ChangePercent: ${Number(s?.chg || 0)}%`,
      `Volume: ${String(s?.vol || '—')}`,
      `Live: ${s?.live ? 'yes' : 'no'}`,
    ].join('\n'),
    metadata: {
      sym: String(s?.sym || ''),
      live: Boolean(s?.live),
    },
    distance: null,
  }));
}

function toNewsDocs(news) {
  return news.map((n) => ({
    document: [
      `Headline: ${String(n?.headline || '')}`,
      `Description: ${String(n?.description || '')}`,
      `Sentiment: ${String(n?.sentiment || 'neutral')}`,
      `Impact: ${String(n?.impact || 'low')}`,
      `Time: ${String(n?.time || '')}`,
      `Source: ${String(n?.source || 'Market Wire')}`,
      `URL: ${String(n?.url || '')}`,
    ].join('\n'),
    metadata: {
      source: String(n?.source || 'Market Wire'),
      sentiment: String(n?.sentiment || 'neutral'),
      impact: String(n?.impact || 'low'),
    },
    distance: null,
  }));
}

function getAiChain() {
  if (!aiChainPromise) {
    const apiKey = getGeminiApiKey();
    const model = new ChatGoogleGenerativeAI({
      apiKey,
      model: GEMINI_MODEL,
      temperature: 0.25,
      maxOutputTokens: 4000,
      topP: 0.9,
    });

    const prompt = ChatPromptTemplate.fromTemplate(`
You are Stonks AI assistant for a stock dashboard.
Use only the provided database context for stock data; if data is missing, say so clearly.
Keep answers concise and actionable.
IMPORTANT: Format your response using clean, readable bullet points. DO NOT use markdown tables under any circumstances. Use **bold** text for emphasis and stock tickers.

=== STOCK DB CONTEXT ===
{stockContext}

=== NEWS DB CONTEXT ===
{newsContext}

=== CHAT MEMORY DB CONTEXT ===
{chatContext}

=== USER PROMPT ===
{question}
    `);

    aiChainPromise = Promise.resolve(
      RunnableSequence.from([
        prompt,
        model,
        new StringOutputParser(),
      ])
    );
  }
  return aiChainPromise;
}

function getAgentModel() {
  if (!agentModelPromise) {
    const model = new ChatGoogleGenerativeAI({
      apiKey: getGeminiApiKey(),
      model: GEMINI_MODEL,
      temperature: 0.2,
      maxOutputTokens: 1200,
    });
    agentModelPromise = Promise.resolve(model.bindTools(agentTools, { tool_choice: 'any' }));
  }
  return agentModelPromise;
}

async function callAgent({ userPrompt, stockDocs, newsDocs, chatDocs }) {
  const stockContext = stockDocs.length ? stockDocs.map((item) => item.document).join('\n\n') : 'No stock context available.';
  const newsContext = newsDocs.length ? newsDocs.map((item) => item.document).join('\n\n') : 'No news context available.';
  const chatContext = chatDocs.length ? chatDocs.map((item) => item.document).join('\n\n') : 'No prior chat memory.';
  const model = await getAgentModel();
  const result = await withTimeout(
    model.invoke(`You are Stonks AI, a concise stock research assistant.
Always select exactly one tool. For a general question or a request with missing details, use reply_to_user.
For an explicit buy or sell request with a stock, quantity, and side, always use prepare_trade.
For an explicit price alert with a stock, direction, and price, always use create_price_alert.
For an observation request with a stock, thesis, and duration, always use create_observation.
Never claim a tool executed anything. Do not give personalized investment advice.

STOCK CONTEXT:
${stockContext}

NEWS CONTEXT:
${newsContext}

CHAT MEMORY:
${chatContext}

USER REQUEST:
${userPrompt}`),
    AI_INFER_TIMEOUT_MS,
    'Agent inference'
  );
  const toolCall = result.tool_calls?.[0];
  const content = typeof result.content === 'string' ? result.content.trim() : '';
  const reply = toolCall?.name === 'reply_to_user' ? String(toolCall.args?.answer || '').trim() : content;
  return { answer: reply, action: actionFromTool(toolCall) };
}

async function callGeminiWithLangChain({ userPrompt, stockDocs, newsDocs, chatDocs }) {
  const stockContext = stockDocs.length
    ? stockDocs.map((s, i) => `StockContext ${i + 1}:\n${s.document}`).join('\n\n')
    : 'No stock context available.';

  const newsContext = newsDocs.length
    ? newsDocs.map((n, i) => `NewsContext ${i + 1}:\n${n.document}`).join('\n\n')
    : 'No news context available.';

  const chatContext = chatDocs.length
    ? chatDocs.map((c, i) => `Memory ${i + 1}:\n${c.document}`).join('\n\n')
    : 'No prior chat memory.';

  const chain = await getAiChain();
  const text = await withTimeout(
    chain.invoke({
      stockContext,
      newsContext,
      chatContext,
      question: userPrompt,
    }),
    AI_INFER_TIMEOUT_MS,
    'AI inference'
  );

  return String(text || '').trim() || 'I could not generate a response from the available data.';
}

async function callLocalChatService({ userPrompt, stockDocs, newsDocs, chatDocs }) {
  console.log("Routing local chat request directly to Gemini API...");
  return await callGeminiWithLangChain({ userPrompt, stockDocs, newsDocs, chatDocs });
}

async function callHFStockModel({ previousChat, stockData, newsData, question }) {
  const baseUrl = HF_STOCK_MODEL_URL;

  // Step 1: POST to initiate request and get event_id
  const postRes = await fetch(`${baseUrl}/gradio_api/call/${HF_STOCK_MODEL_API_NAME}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(HF_TOKEN ? { 'Authorization': `Bearer ${HF_TOKEN}` } : {})
    },
    body: JSON.stringify({
      data: [previousChat || '', stockData || '', newsData || '', question || '']
    })
  });

  if (!postRes.ok) {
    throw new Error(`HF POST failed: ${postRes.status} ${postRes.statusText}`);
  }

  const postJson = await postRes.json();
  const eventId = postJson.event_id;

  if (!eventId) {
    throw new Error('HF response did not include event_id');
  }

  // Step 2: GET to poll for result (SSE)
  const getRes = await fetch(`${baseUrl}/gradio_api/call/${HF_STOCK_MODEL_API_NAME}/${eventId}`, {
    headers: {
      ...(HF_TOKEN ? { 'Authorization': `Bearer ${HF_TOKEN}` } : {})
    }
  });

  if (!getRes.ok) {
    throw new Error(`HF result fetch failed: ${getRes.status} ${getRes.statusText}`);
  }

  const sseText = await getRes.text();

  // The response is SSE. We look for the final data line.
  const lines = sseText.split('\n');
  const dataLines = lines.filter((line) => line.startsWith('data: '));
  
  if (dataLines.length === 0) {
    throw new Error('HF SSE response did not contain any data lines');
  }

  // Gradio sends multiple generating events, the last one has the complete response
  const dataLine = dataLines[dataLines.length - 1];

  try {
    const jsonStr = dataLine.replace('data: ', '');
    
    // If the space returns an error, it might look like {"error": "..."}
    if (jsonStr.includes('"error"')) {
       try {
         const errObj = JSON.parse(jsonStr);
         if (errObj.error) throw new Error(errObj.error);
       } catch (e) {
         if (e.message !== 'Unexpected token') throw e;
       }
    }

    const parsed = JSON.parse(jsonStr);
    let answer = Array.isArray(parsed) ? parsed[0] : parsed;

    if (!answer || typeof answer !== 'string') {
      throw new Error(`HF returned invalid or empty answer: ${JSON.stringify(parsed)}`);
    }

    // Remove <think>...</think> tags if present
    answer = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    if (!answer) {
      throw new Error('HF returned empty answer after cleanup');
    }

    return answer;
  } catch (e) {
    throw new Error(`Failed to parse HF response: ${e.message}`);
  }
}

export async function GET(req) {
  try {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (req.nextUrl.searchParams.get('list') === '1') {
      const conn = await getConnection();
      try {
        await ensureChatTables(conn);
        const [sessions] = await conn.query(
          'SELECT id, updated_at FROM ai_chat_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?',
          [userId, MAX_SAVED_CHATS]
        );
        return NextResponse.json({ sessions: sessions.map((session) => ({ id: String(session.id), date: session.updated_at })) }, { headers: { 'Cache-Control': 'no-store' } });
      } finally {
        conn.release();
      }
    }
    const sessionId = String(req.nextUrl.searchParams.get('sessionId') || '').trim().slice(0, 100);
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const limit = Math.min(MAX_SESSION_MESSAGES, Number(req.nextUrl.searchParams.get('limit') || MAX_SESSION_MESSAGES));
    const messages = await getSavedHistory(userId, sessionId, Number.isFinite(limit) ? limit : MAX_SESSION_MESSAGES);

    return NextResponse.json(
      { messages, meta: { sessionId, count: messages.length, sessionLimit: MAX_SESSION_MESSAGES } },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load chat history';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req) {
  if (!isTrustedOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  const userId = await getUserId(req);
  const sessionId = String(req.nextUrl.searchParams.get('sessionId') || '').trim().slice(0, 100);
  if (!userId || !sessionId) return NextResponse.json({ error: 'Invalid chat.' }, { status: 400 });

  try {
    const conn = await getConnection();
    try {
      await ensureChatTables(conn);
      await conn.query('DELETE FROM ai_chat_sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
      return NextResponse.json({ ok: true });
    } finally {
      conn.release();
    }
  } catch {
    return NextResponse.json({ error: 'Unable to delete chat.' }, { status: 500 });
  }
}

export async function POST(req) {
  if (!isTrustedOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = String(body?.prompt || '').trim();
    const sessionId = String(body?.sessionId || 'default').slice(0, 100);
    const userId = await getUserId(req);

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }
    if (!userId) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });

    ensureAiEnv();

    const history = await getSavedHistory(userId, sessionId, MAX_SESSION_MESSAGES);
    if (history.length >= MAX_SESSION_MESSAGES) {
      return NextResponse.json(
        {
          error: 'This chat reached its message limit. Please start a new chat.',
          code: 'CHAT_LIMIT_REACHED',
          meta: { sessionId, count: history.length, sessionLimit: MAX_SESSION_MESSAGES },
        },
        { status: 429 }
      );
    }

    const origin = req.nextUrl.origin;
    const stocks = await fetchStocksFromApi(origin);
    const news = await fetchNewsFromApi(origin);

    // The chat can still answer and the trade tool gets its own live quote.
    // Do not reject the whole prompt just because the dashboard feed is slow.
    await upsertStocksToChroma(stocks);
    if (news.length > 0) {
      await upsertNewsToChroma(news).catch(() => {});
    }

    const context = await withTimeout(
      queryChromaContext(prompt, { stockLimit: 8, newsLimit: 10, chatLimit: 8, sessionId }),
      CHROMA_TIMEOUT_MS,
      'Context query'
    );
    const stockDocs = context.stocks.length ? context.stocks : toStockDocs(stocks);
    const newsDocs = context.news.length ? context.news : toNewsDocs(news);
    const savedChatDocs = history.slice(-8).map((message) => ({
      document: `Role: ${message.role}\n${message.text}`,
    }));
    const chatDocs = context.chats.length ? context.chats : savedChatDocs;

    let agentResult = null;
    try {
      agentResult = await callAgent({ userPrompt: prompt, stockDocs, newsDocs, chatDocs });
    } catch (agentError) {
      console.error('Agent tool selection failed:', agentError.message);
    }

    if (agentResult?.action?.type === 'trade') {
      const quote = await getQuote(agentResult.action.symbol).catch(() => null);
      if (!quote?.price) {
        return NextResponse.json({ answer: `I could not get a live price for ${agentResult.action.symbol}. Please check the symbol and try again.` });
      }
      const total = Number(quote.price) * agentResult.action.quantity;
      const answer = `I prepared a ${agentResult.action.side} order for ${agentResult.action.quantity} ${agentResult.action.symbol} at the current price of $${Number(quote.price).toFixed(2)}. Estimated value: $${total.toFixed(2)}. Please confirm before I place this paper trade.`;
      await saveChatTurn(userId, sessionId, prompt, answer, agentResult.action);
      return NextResponse.json({
        answer,
        action: agentResult.action,
      });
    }

    if (agentResult?.action?.type === 'alert') {
      const answer = `I prepared an alert for ${agentResult.action.symbol} ${agentResult.action.direction} $${agentResult.action.targetPrice.toFixed(2)}. Please confirm before I create it.`;
      await saveChatTurn(userId, sessionId, prompt, answer, agentResult.action);
      return NextResponse.json({
        answer,
        action: agentResult.action,
      });
    }

    if (agentResult?.action?.type === 'observation') {
      const hours = agentResult.action.hours;
      const answer = `I prepared an observation for ${agentResult.action.symbol} for ${hours} hour${hours === 1 ? '' : 's'}. Please confirm before I start tracking it.`;
      await saveChatTurn(userId, sessionId, prompt, answer, agentResult.action);
      return NextResponse.json({
        answer,
        action: agentResult.action,
      });
    }

    let answer;
    let usedProvider = CHAT_MODEL_PROVIDER;

    if (agentResult?.answer) {
      answer = agentResult.answer;
      usedProvider = 'gemini-agent';
    } else try {
      if (CHAT_MODEL_PROVIDER === 'local_finetuned') {
        try {
          answer = await withTimeout(
            callLocalChatService({
              userPrompt: prompt,
              stockDocs,
              newsDocs,
              chatDocs,
            }),
            AI_INFER_TIMEOUT_MS,
            'Local AI inference'
          );
        } catch (localError) {
          console.error('Local fine-tuned chat model failed:', localError.message);
          // Fallback to true if undefined
          const shouldFallback = process.env.CHAT_MODEL_ENABLE_FALLBACK !== 'false';
          if (shouldFallback) {
            console.log('Falling back to Gemini...');
            usedProvider = 'gemini';
            try {
              answer = await callGeminiWithLangChain({
                userPrompt: prompt,
                stockDocs,
                newsDocs,
                chatDocs,
              });
            } catch (geminiError) {
              console.error('Gemini fallback also failed:', geminiError.message);
              throw new Error(`Both primary model and Gemini fallback failed. Primary error: ${localError.message}`);
            }
          } else {
            throw localError;
          }
        }
      } else if (CHAT_MODEL_PROVIDER === 'huggingface') {
        try {
          const stockContext = stockDocs.length
            ? stockDocs.map((s) => s.document).join('\n')
            : 'No stock data available.';

          const newsContext = newsDocs.length
            ? newsDocs.map((n) => n.document).join('\n')
            : 'No news data available.';

          const chatContext = chatDocs.length
            ? chatDocs.map((c) => c.document).join('\n')
            : 'No previous chat history.';

          answer = await withTimeout(
            callHFStockModel({
              previousChat: chatContext,
              stockData: stockContext,
              newsData: newsContext,
              question: prompt,
            }),
            HF_STOCK_MODEL_TIMEOUT_MS,
            'Hugging Face AI inference'
          );
        } catch (hfError) {
          console.error('Hugging Face fine-tuned chat model failed:', hfError.message);
          // Fallback to true if undefined
          const shouldFallback = process.env.CHAT_MODEL_ENABLE_FALLBACK !== 'false';
          if (shouldFallback) {
            console.log('Falling back to Gemini...');
            usedProvider = 'gemini';
            try {
              answer = await callGeminiWithLangChain({
                userPrompt: prompt,
                stockDocs,
                newsDocs,
                chatDocs,
              });
            } catch (geminiError) {
              console.error('Gemini fallback also failed:', geminiError.message);
              throw new Error(`Both primary model and Gemini fallback failed. Primary error: ${hfError.message}`);
            }
          } else {
            throw hfError;
          }
        }
      } else {
        answer = await callGeminiWithLangChain({
          userPrompt: prompt,
          stockDocs,
          newsDocs,
          chatDocs,
        });
      }
    } catch (chatError) {
      throw chatError;
    }

    await saveChatTurn(userId, sessionId, prompt, answer);
    storeChatTurn({ sessionId, prompt, answer }).catch(() => {});

    return NextResponse.json(
      {
        answer,
        meta: {
          stocksIndexed: stocks.length,
          newsIndexed: news.length,
          stockMatches: stockDocs.length,
          newsMatches: newsDocs.length,
          memoryMatches: chatDocs.length,
          vectorStockMatches: context.stocks.length,
          vectorNewsMatches: context.news.length,
          vectorMemoryMatches: context.chats.length,
          model: usedProvider === 'gemini' || usedProvider === 'gemini-agent' ? GEMINI_MODEL : (usedProvider === 'huggingface' ? 'hf-fine-tuned' : 'local_finetuned'),
          provider: usedProvider,
          sessionLimit: MAX_SESSION_MESSAGES,
          messageCount: history.length + 2,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const normalized = normalizeAiError(error);
    return NextResponse.json(normalized.body, { status: normalized.status });
  }
}
