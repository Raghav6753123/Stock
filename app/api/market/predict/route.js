import { NextResponse } from 'next/server';
import path from 'path';
import { spawn } from 'child_process';

function estimatePrice(closes) {
  const window = closes.slice(-50);
  const last = Number(window[window.length - 1] || 0);
  if (!last) return null;

  const sma = (arr) => arr.reduce((s, n) => s + Number(n || 0), 0) / arr.length;
  const drift = ((sma(window.slice(-5)) - sma(window.slice(-10))) * 0.55) + ((last - Number(window[window.length - 6] || last)) * 0.25);
  return Number((last + drift).toFixed(4));
}

export async function POST(req) {
  try {
    const body = await req.json();
    const closes = (body?.closes || []).map(Number).filter(Number.isFinite).slice(-50);

    if (closes.length < 50) return NextResponse.json({ error: 'Need at least 50 close values' }, { status: 400 });

    let predicted = null;
    let source = 'heuristic';

    if (process.env.VERCEL !== '1' || process.env.PREDICT_FORCE_PYTHON === '1') {
      try {
        const pythonBin = process.env.PYTHON_BIN || 'python';
        const scriptPath = path.join(process.cwd(), 'scripts', 'predict_price.py');
        
        predicted = await new Promise((resolve, reject) => {
          const child = spawn(pythonBin, [scriptPath, JSON.stringify(closes)], { windowsHide: true });
          let stdout = '';
          child.stdout.on('data', c => stdout += c);
          child.on('close', code => code === 0 ? resolve(JSON.parse(stdout).predicted) : reject());
          setTimeout(() => child.kill(), 10000);
        });
        source = 'model.pth';
      } catch {}
    }

    if (!Number.isFinite(predicted)) {
      predicted = estimatePrice(closes);
    }

    if (!Number.isFinite(predicted)) return NextResponse.json({ error: 'Prediction failed' }, { status: 500 });

    return NextResponse.json({ predicted, meta: { source, window: 50 } });
  } catch (error) {
    return NextResponse.json({ error: 'Prediction failed' }, { status: 500 });
  }
}
