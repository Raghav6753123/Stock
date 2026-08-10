import { loadServerEnvOnce } from './loadEnv';

loadServerEnvOnce();

const API_BASE = 'https://finnhub.io/api/v1';

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
  
  // Use Next.js native fetch caching instead of a complex custom implementation
  const res = await fetch(`${API_BASE}${path}?${query.toString()}`, {
    next: { revalidate: 15 },
  });

  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
  return res.json();
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
