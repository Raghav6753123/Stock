import { loadServerEnvOnce } from './loadEnv';

loadServerEnvOnce();

const API_BASE = 'https://finnhub.io/api/v1';
const REQUEST_TIMEOUT_MS = 8000;

function getToken() {
  const key = process.env.FINNHUB_API_KEY || process.env.FINHUB_API_KEY || 'd7dcs11r01qggoenstvgd7dcs11r01qggoensu00';
  if (!key) throw new Error('Missing FINNHUB_API_KEY');
  return key;
}

function normalizeSymbol(symbol) {
  return symbol.endsWith('.NSE') ? `NSE:${symbol.replace('.NSE', '')}` : symbol;
}

async function requestFinnhub(path, params) {
  const token = getToken();
  const query = new URLSearchParams({ ...params, token });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // Market prices should be fresh. Avoid Next's data cache so a provider
    // connection reset does not turn into a cache write error.
    const res = await fetch(`${API_BASE}${path}?${query.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function getQuote(symbol) {
  const resolvedSymbol = normalizeSymbol(symbol);
  const quote = await requestFinnhub('/quote', { symbol: resolvedSymbol });

  const current = Number(quote?.c) || 0;
  if (current <= 0) return null;

  return {
    symbol,
    providerSymbol: resolvedSymbol,
    price: current,
    change: Number(quote?.d) || 0,
    percentChange: Number(quote?.dp) || 0,
    high: Number(quote?.h) || current,
    low: Number(quote?.l) || current,
    open: Number(quote?.o) || current,
    prevClose: Number(quote?.pc) || current,
    timestamp: Number(quote?.t) || 0,
  };
}

export async function getBatchQuotes(symbols) {
  const settled = await Promise.allSettled(symbols.map(getQuote));
  const quotes = {};

  settled.forEach((item, idx) => {
    if (item.status === 'fulfilled' && item.value) {
      quotes[symbols[idx]] = item.value;
    }
  });

  return quotes;
}

export async function getSpark(symbol, options = {}) {
  const points = Math.max(5, Math.min(60, Number(options.points || 20)));
  const resolution = String(options.resolution || '5');
  const resolvedSymbol = normalizeSymbol(symbol);

  const nowSec = Math.floor(Date.now() / 1000);
  const stepSec = Number(resolution) * 60 || 300;
  const from = nowSec - stepSec * (points + 6);

  const payload = await requestFinnhub('/stock/candle', {
    symbol: resolvedSymbol,
    resolution,
    from: String(from),
    to: String(nowSec),
  });

  if (payload?.s !== 'ok' || !Array.isArray(payload?.c)) return [];

  return payload.c
    .slice(-points)
    .map(v => ({ v: Number(v) }))
    .filter(p => p.v > 0);
}

export async function getComparisonData(symbol) {
  const resolvedSymbol = normalizeSymbol(symbol);
  const now = Math.floor(Date.now() / 1000);
  const yearAgo = now - 365 * 24 * 60 * 60;

  const results = await Promise.allSettled([
    getQuote(symbol),
    requestFinnhub('/stock/profile2', { symbol: resolvedSymbol }),
    requestFinnhub('/stock/metric', { symbol: resolvedSymbol, metric: 'all' }),
    requestFinnhub('/stock/candle', {
      symbol: resolvedSymbol,
      resolution: 'D',
      from: String(yearAgo),
      to: String(now),
    }),
  ]);

  const quote = results[0].status === 'fulfilled' ? results[0].value : null;
  if (!quote) throw new Error(`Live quote unavailable for ${symbol}.`);
  const profile = results[1].status === 'fulfilled' ? results[1].value : {};
  const metricData = results[2].status === 'fulfilled' ? results[2].value : {};
  const candles = results[3].status === 'fulfilled' ? results[3].value : {};

  const closes = Array.isArray(candles?.c) ? candles.c.map(Number).filter(Number.isFinite) : [];
  const firstClose = closes[0];
  const lastClose = closes[closes.length - 1];
  const oneYearReturn = firstClose > 0 && lastClose > 0
    ? ((lastClose - firstClose) / firstClose) * 100
    : null;

  return { quote, profile, metric: metricData?.metric || {}, oneYearReturn };
}
