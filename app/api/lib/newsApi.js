import { loadServerEnvOnce } from './loadEnv';
import path from 'path';
import { spawn } from 'child_process';

loadServerEnvOnce();

const API_BASE = 'https://newsapi.org/v2';
const FINBERT_TIMEOUT_MS = Number(process.env.FINBERT_TIMEOUT_MS || 25000);
const IS_VERCEL = process.env.VERCEL === '1';

function getApiKey() {
  const key = process.env.NEWS_API_KEY;
  if (!key) throw new Error('Missing required env var: NEWS_API_KEY');
  return key;
}

function toIsoTime(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return 'now';

  const diffMs = Date.now() - date.getTime();
  const min = Math.max(1, Math.floor(diffMs / 60_000));
  if (min < 60) return `${min}m ago`;

  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;

  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function scoreSentiment(text) {
  const value = String(text || '').toLowerCase();
  const bullishWords = ['surge', 'gain', 'rise', 'beats', 'record', 'up', 'bullish', 'rally', 'growth'];
  const bearishWords = ['drop', 'fall', 'miss', 'down', 'bearish', 'cut', 'warn', 'recall', 'lawsuit'];

  let score = 0;
  for (const word of bullishWords) if (value.includes(word)) score += 1;
  for (const word of bearishWords) if (value.includes(word)) score -= 1;

  if (score >= 1) return 'bullish';
  if (score <= -1) return 'bearish';
  return 'neutral';
}

function scoreImpact(title, sourceName) {
  const text = `${title || ''} ${sourceName || ''}`.toLowerCase();
  const highWords = ['federal reserve', 'fed', 'rbi', 'earnings', 'inflation', 'interest rate', 'sec'];
  const mediumWords = ['analyst', 'forecast', 'guidance', 'downgrade', 'upgrade'];

  if (highWords.some(word => text.includes(word))) return 'high';
  if (mediumWords.some(word => text.includes(word))) return 'medium';
  return 'low';
}

function normalizeArticles(articles = [], maxItems = 8) {
  return articles
    .filter(item => item && item.title)
    .slice(0, maxItems)
    .map(item => {
      const title = String(item.title).replace(/\s*[-|]\s*[^-|]+$/, '').trim();
      const sourceName = item?.source?.name || 'Market Wire';
      const sentiment = scoreSentiment(`${title} ${item.description || ''}`);

      return {
        headline: title,
        description: item.description ? String(item.description).trim() : null,
        sentiment,
        impact: scoreImpact(title, sourceName),
        sentimentReview: `Heuristic sentiment: ${sentiment}.`,
        time: toIsoTime(item.publishedAt),
        source: sourceName,
        url: item.url || null,
        imageUrl: item.urlToImage || null,
      };
    });
}

async function runFinBert(textItems) {
  if (!Array.isArray(textItems) || textItems.length === 0) return [];

  const pythonBin = process.env.PYTHON_BIN || 'python';
  const scriptPath = path.join(process.cwd(), 'scripts', 'finbert_sentiment.py');
  const payload = JSON.stringify(textItems);

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [scriptPath, payload], {
      cwd: process.cwd(),
      env: { ...process.env },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('FinBERT timed out'));
    }, FINBERT_TIMEOUT_MS);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    child.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `FinBERT failed with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch {
        reject(new Error('Invalid JSON from FinBERT script'));
      }
    });
  });
}

function mapFinBertLabelToSentiment(label) {
  const v = String(label || '').toLowerCase();
  if (v.includes('positive')) return 'bullish';
  if (v.includes('negative')) return 'bearish';
  return 'neutral';
}

async function enrichNewsWithFinBert(items) {
  const enabled = String(process.env.NEWS_FINBERT_ENABLED || '1').toLowerCase();
  if (enabled === '0' || enabled === 'false' || enabled === 'no') return items;
  if (IS_VERCEL && process.env.NEWS_FINBERT_ON_VERCEL !== '1') return items;

  const textItems = items.map(item => ({
    headline: item.headline,
    description: item.description || '',
  }));

  try {
    const finbert = await runFinBert(textItems);
    if (!Array.isArray(finbert) || finbert.length === 0) return items;

    return items.map((item, idx) => {
      const row = finbert[idx];
      if (!row || typeof row !== 'object') return item;

      const mappedSentiment = mapFinBertLabelToSentiment(row.label);
      const conf = Number(row.confidence);
      const confText = Number.isFinite(conf) ? ` (${(conf * 100).toFixed(1)}% confidence)` : '';
      
      return {
        ...item,
        sentiment: mappedSentiment || item.sentiment,
        sentimentReview: row.review ? String(row.review) : `FinBERT sentiment: ${mappedSentiment}${confText}.`,
      };
    });
  } catch {
    return items;
  }
}

export async function getMarketNews(options = {}) {
  const q = options.query || 'stock market OR nifty OR sensex OR nasdaq';
  const pageSize = options.pageSize ?? 10;
  const maxArticles = options.maxArticles ?? pageSize;
  const revalidate = Math.floor((options.ttlMs ?? 15 * 60_000) / 1000);

  const qs = new URLSearchParams({
    q,
    pageSize: String(pageSize),
    sortBy: 'publishedAt',
    language: 'en',
    apiKey: getApiKey(),
  });

  const response = await fetch(`${API_BASE}/everything?${qs.toString()}`, {
    next: { revalidate },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`News API HTTP ${response.status}: ${text || response.statusText}`);
  }

  const payload = await response.json();
  if (payload?.status !== 'ok') {
    throw new Error(`News API error: ${payload?.message || 'unknown'}`);
  }

  const normalized = normalizeArticles(payload?.articles || [], maxArticles);
  const enriched = await enrichNewsWithFinBert(normalized);

  return { items: enriched };
}
