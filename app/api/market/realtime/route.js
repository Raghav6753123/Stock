import { NextResponse } from 'next/server';
import { getBatchQuotes, getSpark } from '../../lib/finnhub';

const INDEX_CONFIG = [
  { id: 'nifty', label: 'NIFTY 50', symbol: process.env.TD_SYMBOL_NIFTY || 'NIFTY', color: '#10b981', flag: '🇮🇳' },
  { id: 'sensex', label: 'SENSEX', symbol: process.env.TD_SYMBOL_SENSEX || 'SENSEX', color: '#6366f1', flag: '🇮🇳' },
  { id: 'nasdaq', label: 'NASDAQ', symbol: process.env.TD_SYMBOL_NASDAQ || 'IXIC', color: '#f59e0b', flag: '🇺🇸' },
  { id: 'sp500', label: 'S&P 500', symbol: process.env.TD_SYMBOL_SP500 || 'GSPC', color: '#ec4899', flag: '🇺🇸' },
];

const WATCHLIST_CONFIG = [
  { sym: 'AAPL', name: 'Apple Inc.' },
  { sym: 'TSLA', name: 'Tesla Inc.' },
  { sym: 'NVDA', name: 'NVIDIA Corp.' },
  { sym: process.env.TD_SYMBOL_RELIANCE || 'RELIANCE.NSE', name: 'Reliance Ind.' },
  { sym: process.env.TD_SYMBOL_INFY || 'INFY.NSE', name: 'Infosys Ltd.' },
  { sym: 'MSFT', name: 'Microsoft Corp.' },
];

function quoteVolume(quote) {
  const v = Number(quote?.volume) || 0;
  if (v === 0) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

export async function GET() {
  try {
    const allSymbols = [...new Set([
      ...INDEX_CONFIG.map(i => i.symbol),
      ...WATCHLIST_CONFIG.map(i => i.sym)
    ])];

    const quotes = await getBatchQuotes(allSymbols).catch(() => ({}));

    const sparkBySymbol = {};
    await Promise.all(
      allSymbols.map(async (sym) => {
        const spark = await getSpark(sym).catch(() => []);
        sparkBySymbol[sym] = spark.length ? spark : Array(20).fill({ v: quotes[sym]?.price || 1 });
      })
    );

    const formatItem = (item, isIndex = false) => {
      const q = quotes[item.symbol || item.sym] || {};
      const price = Number(q.price) || 0;
      const chg = Number(q.percentChange) || 0;
      
      const base = {
        price,
        chgPct: chg,
        chg,
        spark: sparkBySymbol[item.symbol || item.sym],
        color: chg >= 0 ? '#10b981' : '#ef4444',
      };

      return isIndex ? { ...item, ...base } : { ...item, ...base, vol: quoteVolume(q) };
    };

    return NextResponse.json({
      indices: INDEX_CONFIG.map(i => formatItem(i, true)),
      watchlist: WATCHLIST_CONFIG.map(i => formatItem(i, false)),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch market data' }, { status: 500 });
  }
}
