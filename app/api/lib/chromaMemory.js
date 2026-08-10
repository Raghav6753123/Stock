import { ChromaClient } from 'chromadb';
import { loadServerEnvOnce } from './loadEnv';

loadServerEnvOnce();

const BGE_MODEL = process.env.BGE_MODEL || 'BAAI/bge-small-en-v1.5';
const BGE_EMBEDDING_URL = process.env.BGE_EMBEDDING_URL || `https://router.huggingface.co/hf-inference/models/${BGE_MODEL}`;
const BGE_QUERY_PREFIX = process.env.BGE_QUERY_PREFIX || 'Represent this sentence for searching relevant passages: ';
const BGE_SOURCE_DIM = 384;
const EMBED_DIM = BGE_SOURCE_DIM;
const EMBEDDING_TIMEOUT_MS = Number(process.env.BGE_EMBEDDING_TIMEOUT_MS || 8000);

const STOCKS_COLLECTION = 'stonks_stocks_bge_v2';
const CHATS_COLLECTION = 'stonks_chats_bge_v2';
const NEWS_COLLECTION = 'stonks_news_bge_v2';
const PORTFOLIO_COLLECTION = 'stonks_portfolio_bge_v2';

let clientPromise = null;

async function bgeEmbeddings(texts, { query = false } = {}) {
  const inputs = texts.map((text) => {
    const value = String(text ?? '');
    return query ? `${BGE_QUERY_PREFIX}${value}` : value;
  });
  if (!inputs.length) return [];

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), EMBEDDING_TIMEOUT_MS);
  
  try {
    const response = await fetch(BGE_EMBEDDING_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {}),
      },
      body: JSON.stringify({ inputs, options: { wait_for_model: true } }),
      signal: abortController.signal,
    });
    
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`BGE embedding request failed (${response.status}): ${payload?.error || 'unknown error'}`);
    }
    
    const vectors = Array.isArray(payload?.[0]) ? payload : [payload];
    return vectors.map(v => {
      const mag = Math.sqrt(v.reduce((sum, val) => sum + Number(val) * Number(val), 0)) || 1;
      return v.map(val => Number((Number(val) / mag).toFixed(8)));
    });
  } finally {
    clearTimeout(timer);
  }
}

const BGE_EMBEDDING_FUNCTION = {
  name: 'bge-small-en-v1.5',
  generate: async (texts) => bgeEmbeddings(texts),
  generateForQueries: async (texts) => bgeEmbeddings(texts, { query: true }),
  defaultSpace: () => 'cosine',
  supportedSpaces: () => ['cosine', 'l2', 'ip'],
  getConfig: () => ({ provider: 'huggingface', model: BGE_MODEL, sourceDim: BGE_SOURCE_DIM, dim: EMBED_DIM }),
};

const HNSW_COSINE_CONFIGURATION = { hnsw: { space: 'cosine' } };

async function getClient() {
  if (!clientPromise) {
    const chromaUrl = process.env.CHROMA_URL || 'http://localhost:8000';
    const config = {
      path: chromaUrl,
      tenant: process.env.CHROMA_TENANT,
      database: process.env.CHROMA_DATABASE
    };
    if (process.env.CHROMA_API_KEY) {
      config.auth = { provider: 'token', credentials: process.env.CHROMA_API_KEY };
    }
    clientPromise = Promise.resolve(new ChromaClient(config));
  }
  return clientPromise;
}

async function getCollection(name, kind) {
  const client = await getClient();
  return client.getOrCreateCollection({
    name,
    metadata: { app: 'stonks', kind },
    configuration: HNSW_COSINE_CONFIGURATION,
    embeddingFunction: BGE_EMBEDDING_FUNCTION,
  });
}

async function safeUpsert(collection, payload) {
  if (typeof collection.upsert === 'function') {
    await collection.upsert(payload);
  } else {
    if (typeof collection.delete === 'function') {
      await collection.delete({ ids: payload.ids }).catch(() => {});
    }
    await collection.add(payload);
  }
}

function portfolioDoc(snapshot) {
  const holdings = (snapshot?.holdings || []).map(h => `${h.sym}: qty=${h.quantity}, current=${h.currentPrice}`).join('; ');
  return `UserId: ${snapshot.userId}\nScore: ${snapshot.score}/10\nHoldings: ${holdings}`;
}

function stockDoc(stock) {
  return `Symbol: ${stock.sym}\nName: ${stock.name}\nSector: ${stock.sector}\nPrice: ${stock.price}\nChangePercent: ${stock.chg}%`;
}

function newsDoc(item) {
  return `Headline: ${item.headline}\nSentiment: ${item.sentiment}\nImpact: ${item.impact}`;
}

export async function upsertStocksToChroma(stocks) {
  if (!stocks?.length) return 0;
  try {
    const collection = await getCollection(STOCKS_COLLECTION, 'stocks');
    const ids = stocks.map((s) => `stock:${s.sym}`);
    const documents = stocks.map(stockDoc);
    const metadatas = stocks.map((s) => ({
      source: 'stock', sym: String(s.sym), sector: String(s.sector || 'Unknown'),
      name: String(s.name || s.sym), price: Number(s.price || 0), chg: Number(s.chg || 0)
    }));
    const embeddings = await bgeEmbeddings(documents);
    await safeUpsert(collection, { ids, documents, metadatas, embeddings });
    return stocks.length;
  } catch (err) {
    console.error("Failed to upsert stocks", err);
    return 0;
  }
}

export async function upsertNewsToChroma(newsItems) {
  if (!newsItems?.length) return 0;
  try {
    const collection = await getCollection(NEWS_COLLECTION, 'news');
    const ids = newsItems.map((_, i) => `news:${Date.now()}:${i}`);
    const documents = newsItems.map(newsDoc);
    const metadatas = newsItems.map(item => ({
      source: 'news', headline: String(item.headline || ''), sentiment: String(item.sentiment || 'neutral')
    }));
    const embeddings = await bgeEmbeddings(documents);
    await safeUpsert(collection, { ids, documents, metadatas, embeddings });
    return newsItems.length;
  } catch (err) {
    console.error("Failed to upsert news", err);
    return 0;
  }
}

export async function upsertPortfolioSnapshotToChroma(snapshot) {
  if (!snapshot?.userId) return false;
  try {
    const collection = await getCollection(PORTFOLIO_COLLECTION, 'portfolio');
    const id = `portfolio:${snapshot.userId}`;
    const document = portfolioDoc(snapshot);
    const metadata = { source: 'portfolio', userId: String(snapshot.userId), score: Number(snapshot.score || 0) };
    const embeddings = await bgeEmbeddings([document]);
    await safeUpsert(collection, { ids: [id], documents: [document], metadatas: [metadata], embeddings });
    return true;
  } catch (err) {
    console.error("Failed to upsert portfolio", err);
    return false;
  }
}

export async function queryChromaContext(prompt, opts = {}) {
  try {
    const q = (await bgeEmbeddings([prompt], { query: true }))[0];
    const [stocksColl, newsColl, chatsColl] = await Promise.all([
      getCollection(STOCKS_COLLECTION, 'stocks'),
      getCollection(NEWS_COLLECTION, 'news'),
      getCollection(CHATS_COLLECTION, 'chats')
    ]);

    const [stockRes, newsRes, chatRes] = await Promise.all([
      stocksColl.query({ queryEmbeddings: [q], nResults: opts.stockLimit || 8, include: ['documents', 'metadatas', 'distances'] }),
      newsColl.query({ queryEmbeddings: [q], nResults: opts.newsLimit || 10, include: ['documents', 'metadatas', 'distances'] }),
      chatsColl.query({ queryEmbeddings: [q], nResults: opts.chatLimit || 8, include: ['documents', 'metadatas', 'distances'] })
    ]);

    const mapRes = (res) => (res?.documents?.[0] || []).map((doc, i) => ({
      document: doc, metadata: res?.metadatas?.[0]?.[i] || {}, distance: res?.distances?.[0]?.[i] || 0
    }));

    return { stocks: mapRes(stockRes), news: mapRes(newsRes), chats: mapRes(chatRes) };
  } catch (err) {
    console.error("Failed to query chroma context", err);
    return { stocks: [], news: [], chats: [] };
  }
}

export async function storeChatTurn({ sessionId, prompt, answer }) {
  try {
    const collection = await getCollection(CHATS_COLLECTION, 'chats');
    const docs = [`Role: user\nPrompt: ${prompt}`, `Role: assistant\nAnswer: ${answer}`];
    const ids = [`chat:${sessionId}:user:${Date.now()}`, `chat:${sessionId}:assistant:${Date.now() + 1}`];
    const metadatas = [
      { source: 'chat', role: 'user', sessionId },
      { source: 'chat', role: 'assistant', sessionId }
    ];
    const embeddings = await bgeEmbeddings(docs);
    await safeUpsert(collection, { ids, documents: docs, metadatas, embeddings });
  } catch (err) {
    console.error("Failed to store chat turn", err);
  }
}

export async function getChatHistory(sessionId, limit = 80) {
  if (!sessionId) return [];
  try {
    const collection = await getCollection(CHATS_COLLECTION, 'chats');
    const result = await collection.get({ where: { sessionId: String(sessionId) }, include: ['documents', 'metadatas'] });
    
    if (!result?.ids) return [];

    const items = result.ids.map((id, i) => {
      const meta = result.metadatas[i] || {};
      return {
        id: String(id),
        role: meta.role === 'user' ? 'user' : 'assistant',
        text: String(result.documents[i]).replace(/^(Role: .*\n(Prompt|Answer): )/i, '').trim(),
      };
    });

    return items.slice(-limit);
  } catch (err) {
    console.error("Failed to get chat history", err);
    return [];
  }
}

export function ensureAiEnv() {
  if (!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) {
    throw new Error('Missing required env var: GEMINI_API_KEY or GOOGLE_API_KEY');
  }
  return true;
}

export function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
}
