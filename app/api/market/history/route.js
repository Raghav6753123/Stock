import { NextResponse } from 'next/server';
import { getTimeSeries, parseNumber } from '../../lib/twelveData';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = (searchParams.get('symbol') || '').trim().toUpperCase();
    const interval = (searchParams.get('interval') || '1day').trim();
    const limit = Math.max(5, Math.min(200, Number(searchParams.get('outputsize')) || 60));

    if (!symbol) return NextResponse.json({ error: 'Ticker symbol is required' }, { status: 400 });

    const rawSeries = await getTimeSeries(symbol, interval, limit);
    const ohlc = rawSeries.values.map(point => ({
      datetime: point.datetime,
      open: parseNumber(point.open),
      high: parseNumber(point.high),
      low: parseNumber(point.low),
      close: parseNumber(point.close),
      volume: parseNumber(point.volume),
    }));

    return NextResponse.json({ symbol, interval, ohlc });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
