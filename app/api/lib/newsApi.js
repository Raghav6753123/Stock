import { loadServerEnvOnce } from './loadEnv';

loadServerEnvOnce();

const API_BASE = 'https://newsapi.org/v2';

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
  return { items: normalized };
}
