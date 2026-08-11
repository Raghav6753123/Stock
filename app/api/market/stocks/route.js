import { NextResponse } from 'next/server';
import { getBatchQuotes, getSpark } from '../../lib/finnhub';
import { upsertStocksToChroma } from '../../lib/chromaMemory';
import { getSharedCache, setSharedCache } from '../../lib/sharedCache';

const STOCK_POOL = [
  { sym: 'AAPL', name: 'Apple Inc.', sector: 'Technology' },
  { sym: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology' },
  { sym: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology' },
  { sym: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Cyclical' },
  { sym: 'META', name: 'Meta Platforms Inc.', sector: 'Technology' },
  { sym: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology' },
  { sym: 'TSLA', name: 'Tesla Inc.', sector: 'Automotive' },
  { sym: 'NFLX', name: 'Netflix Inc.', sector: 'Entertainment' },
  { sym: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology' },
  { sym: 'INTC', name: 'Intel Corp.', sector: 'Technology' },
  { sym: 'CRM', name: 'Salesforce Inc.', sector: 'Technology' },
  { sym: 'ORCL', name: 'Oracle Corp.', sector: 'Technology' },
  { sym: 'ADBE', name: 'Adobe Inc.', sector: 'Technology' },
  { sym: 'PYPL', name: 'PayPal Holdings', sector: 'Financial Services' },
  { sym: 'UBER', name: 'Uber Technologies', sector: 'Technology' },
  { sym: 'COIN', name: 'Coinbase Global', sector: 'Financial Services' },
  { sym: 'SHOP', name: 'Shopify Inc.', sector: 'Technology' },
  { sym: 'SQ', name: 'Block Inc.', sector: 'Technology' },
  { sym: 'V', name: 'Visa Inc.', sector: 'Financial Services' },
  { sym: 'MA', name: 'Mastercard Inc.', sector: 'Financial Services' },
  { sym: 'JPM', name: 'JPMorgan Chase', sector: 'Financial Services' },
  { sym: 'BAC', name: 'Bank of America', sector: 'Financial Services' },
  { sym: 'GS', name: 'Goldman Sachs', sector: 'Financial Services' },
  { sym: 'DIS', name: 'Walt Disney Co.', sector: 'Entertainment' },
  { sym: 'NKE', name: 'Nike Inc.', sector: 'Consumer Cyclical' },
  { sym: 'WMT', name: 'Walmart Inc.', sector: 'Consumer Defensive' },
  { sym: 'KO', name: 'Coca-Cola Co.', sector: 'Consumer Defensive' },
  { sym: 'PEP', name: 'PepsiCo Inc.', sector: 'Consumer Defensive' },
  { sym: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare' },
  { sym: 'PFE', name: 'Pfizer Inc.', sector: 'Healthcare' },
  { sym: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare' },
  { sym: 'XOM', name: 'Exxon Mobil Corp.', sector: 'Energy' },
  { sym: 'CVX', name: 'Chevron Corp.', sector: 'Energy' },
  { sym: 'BA', name: 'Boeing Co.', sector: 'Industrials' },
  { sym: 'CAT', name: 'Caterpillar Inc.', sector: 'Industrials' },
  { sym: 'RELIANCE.NSE', name: 'Reliance Industries', sector: 'Energy' },
  { sym: 'TCS.NSE', name: 'Tata Consultancy', sector: 'Technology' },
  { sym: 'INFY.NSE', name: 'Infosys Ltd.', sector: 'Technology' },
  { sym: 'HDFCBANK.NSE', name: 'HDFC Bank', sector: 'Financial Services' },
  { sym: 'ICICIBANK.NSE', name: 'ICICI Bank', sector: 'Financial Services' },
  { sym: 'SBIN.NSE', name: 'State Bank of India', sector: 'Financial Services' },
  { sym: 'BHARTIARTL.NSE', name: 'Bharti Airtel', sector: 'Telecom' },
  { sym: 'ITC.NSE', name: 'ITC Ltd.', sector: 'Consumer Defensive' },
  { sym: 'KOTAKBANK.NSE', name: 'Kotak Mahindra Bank', sector: 'Financial Services' },
  { sym: 'LT.NSE', name: 'Larsen & Toubro', sector: 'Industrials' },
  { sym: 'HINDUNILVR.NSE', name: 'Hindustan Unilever', sector: 'Consumer Defensive' },
  { sym: 'BAJFINANCE.NSE', name: 'Bajaj Finance', sector: 'Financial Services' },
  { sym: 'MARUTI.NSE', name: 'Maruti Suzuki', sector: 'Automotive' },
  { sym: 'WIPRO.NSE', name: 'Wipro Ltd.', sector: 'Technology' },
  { sym: 'TATAMOTORS.NSE', name: 'Tata Motors', sector: 'Automotive' },
];

const REALTIME_SYMBOLS = new Set(['AAPL', 'TSLA']);

function quoteVolume(quote) {
  const v = Number(quote?.volume) || 0;
  if (v === 0) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

export async function GET(request) {
  try {
    const liveOnly = ['1', 'true', 'yes'].includes(request?.nextUrl?.searchParams?.get('liveOnly')?.toLowerCase());
    const cacheKey = `market:stocks:${liveOnly ? 'live' : 'all'}`;
    const cached = await getSharedCache(cacheKey);
    if (Array.isArray(cached?.stocks)) {
      return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });
    }
    
    // We only fetch quotes for real-time symbols to avoid API exhaustion
    const symbolsToFetch = STOCK_POOL.map(s => s.sym).filter(s => REALTIME_SYMBOLS.has(s));
    
    const quotes = await getBatchQuotes(symbolsToFetch).catch(() => ({}));

    const sparkBySymbol = {};
    await Promise.all(
      symbolsToFetch.map(async (sym) => {
        sparkBySymbol[sym] = await getSpark(sym).catch(() => []);
      })
    );

    let stocks = STOCK_POOL.map(item => {
      const quote = quotes[item.sym] || {};
      const price = Number(quote.price) || 0;
      const chg = Number(quote.percentChange) || 0;
      const isLive = REALTIME_SYMBOLS.has(item.sym) && price > 0;
      
      const spark = sparkBySymbol[item.sym];
      
      return {
        ...item,
        price,
        chg,
        vol: quoteVolume(quote),
        color: chg >= 0 ? '#10b981' : '#ef4444',
        live: isLive,
        spark: spark?.length ? spark : Array(5).fill({ v: price || 50 }),
      };
    });

    if (liveOnly) {
      stocks = stocks.filter(s => s.live);
    }

    const liveStocks = stocks.filter(s => s.live);
    if (liveStocks.length > 0) {
      upsertStocksToChroma(liveStocks).catch(() => {});
    }

    const payload = { stocks };
    await setSharedCache(cacheKey, payload, 30_000);
    return NextResponse.json(payload, { headers: { 'X-Cache': 'MISS' } });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load stocks' }, { status: 500 });
  }
}
