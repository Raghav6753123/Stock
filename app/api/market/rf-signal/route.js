import { NextResponse } from 'next/server';

const AI_SERVICE_URL = process.env.PY_AI_SERVICE_URL || 'http://127.0.0.1:8001';

export async function GET(req) {
  try {
    const ticker = new URL(req.url).searchParams.get('ticker')?.trim().toUpperCase();
    if (!ticker) return NextResponse.json({ error: 'ticker is required' }, { status: 400 });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    
    const res = await fetch(`${AI_SERVICE_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) throw new Error('AI Service error');
    
    const data = await res.json();
    return NextResponse.json({
      ticker,
      prediction: Number(data.prediction) || 0,
      label: String(data.label || 'SELL').toUpperCase(),
      confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0.52)),
      predicted_price_5d: Number(data.predicted_price_5d) || null,
      timestamp: data.timestamp || new Date().toISOString(),
      source: 'rf-service',
    });
  } catch (error) {
    return NextResponse.json({ error: 'RF signal unavailable' }, { status: 500 });
  }
}
