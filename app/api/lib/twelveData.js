import { loadServerEnvOnce } from './loadEnv';

loadServerEnvOnce();

const API_BASE = 'https://api.twelvedata.com';

function getApiKey() {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error('Missing required env var: TWELVE_DATA_API_KEY');
  return key;
}

async function requestTwelveData(path, params, revalidate = 60) {
  const query = new URLSearchParams({ ...params, apikey: getApiKey() });
  const response = await fetch(`${API_BASE}${path}?${query.toString()}`, {
    next: { revalidate }, // Next.js native cache
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Twelve Data HTTP ${response.status}: ${text || response.statusText}`);
  }

  const json = await response.json();
  if (json?.status === 'error') {
    throw new Error(`Twelve Data error: ${json?.message || 'unknown error'}`);
  }

  return json;
}

export async function getBatchQuotes(symbols) {
  const symbolCsv = symbols.join(',');
  const data = await requestTwelveData('/quote', { symbol: symbolCsv }, 120);

  const normalized = {};
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (symbols.length === 1 && data.symbol) {
      normalized[data.symbol] = data;
    } else {
      for (const symbol of symbols) {
        if (data[symbol]) normalized[symbol] = data[symbol];
      }
    }
  }

  return { quotes: normalized };
}

export async function getTimeSeries(symbol, interval = '15min', outputsize = 24) {
  const data = await requestTwelveData('/time_series', {
    symbol,
    interval,
    outputsize: String(outputsize),
    order: 'ASC',
  }, 300);

  return {
    symbol,
    values: Array.isArray(data?.values) ? data.values : [],
  };
}

export function parseNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}
