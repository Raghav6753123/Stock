import { NextResponse } from 'next/server';
import { getComparisonData } from '../../lib/finnhub';

function numberFrom(metric, keys) {
  for (const key of keys) {
    const value = Number(metric?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function formatCompany(symbol, data) {
  const metric = data.metric;
  return {
    symbol,
    name: data.profile?.name || symbol,
    sector: data.profile?.finnhubIndustry || null,
    price: data.quote?.price ?? null,
    dayReturn: data.quote?.percentChange ?? null,
    marketCap: numberFrom(data.profile, ['marketCapitalization']),
    revenueGrowth: numberFrom(metric, ['revenueGrowthTTMYoy', 'revenueGrowthAnnual', 'revenueGrowth5Y']),
    pe: numberFrom(metric, ['peTTM', 'peNormalizedAnnual']),
    debtToEquity: numberFrom(metric, ['totalDebt/totalEquityAnnual', 'totalDebt/totalEquityTTM']),
    eps: numberFrom(metric, ['epsTTM', 'epsNormalizedAnnual']),
    oneYearReturn: data.oneYearReturn,
  };
}

export async function GET(request) {
  const symbols = (request.nextUrl.searchParams.get('symbols') || '')
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length !== 2 || new Set(symbols).size !== 2) {
    return NextResponse.json({ error: 'Choose two different stock symbols.' }, { status: 400 });
  }

  try {
    const results = await Promise.all(symbols.map((symbol) => getComparisonData(symbol)));
    return NextResponse.json({ companies: results.map((data, index) => formatCompany(symbols[index], data)) });
  } catch (error) {
    console.error('Stock comparison failed:', error);
    return NextResponse.json({ error: 'Unable to load comparison data. Check your Finnhub API key and symbols.' }, { status: 502 });
  }
}
