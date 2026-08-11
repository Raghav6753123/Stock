import { NextResponse } from 'next/server';
import { checkAllAlerts } from '../../lib/alertMonitor';

export async function GET(req) {
  const secret = process.env.ALERT_MONITOR_SECRET;
  if (!secret || req.headers.get('x-alert-monitor-secret') !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { triggered } = await checkAllAlerts();
    return NextResponse.json({ ok: true, triggered: triggered.length });
  } catch (error) {
    console.error('Alert monitor failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Alert monitor failed' }, { status: 500 });
  }
}
