import { NextResponse } from 'next/server';
import getConnection from '../lib/mysql';
import jwtUtil from '../lib/jwt';
import { isTrustedOrigin } from '../lib/requestSecurity';
import { checkAlertsForUser, ensureAlertsTable, testMode, testPrice } from '../lib/alertMonitor';

async function userId(req) {
  const token = req.cookies.get(jwtUtil.ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;
  try { return String((await jwtUtil.verifyAccessToken(token)).sub); } catch { return null; }
}

export async function GET(req) {
  const id = await userId(req);
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { rows, triggered, quotes } = await checkAlertsForUser(id);
    return NextResponse.json({
      alerts: rows.map((row) => ({
        id: Number(row.id), symbol: row.symbol, direction: row.direction,
        targetPrice: Number(row.target_price), triggeredPrice: row.triggered_price === null ? null : Number(row.triggered_price),
        triggeredAt: row.triggered_at, emailSentAt: row.email_sent_at, createdAt: row.created_at,
        currentPrice: Number(quotes[row.symbol]?.price) || null,
      })),
      triggered, testMode, testPrice,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load alerts' }, { status: 500 });
  }
}

export async function POST(req) {
  if (!isTrustedOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  const id = await userId(req);
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const symbol = String(body.symbol || '').trim().toUpperCase();
  const direction = body.direction === 'above' || body.direction === 'below' ? body.direction : null;
  const target = Number(body.targetPrice);
  if (!symbol || symbol.length > 20 || !direction || !Number.isFinite(target) || target <= 0) return NextResponse.json({ error: 'Enter a symbol, direction, and valid target price.' }, { status: 400 });
  try {
    const conn = await getConnection();
    try {
      await ensureAlertsTable(conn);
      const [result] = await conn.query('INSERT INTO price_alerts (user_id, symbol, direction, target_price) VALUES (?, ?, ?, ?)', [id, symbol, direction, target]);
      return NextResponse.json({ id: Number(result.insertId) }, { status: 201 });
    } finally { conn.release(); }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create alert' }, { status: 500 });
  }
}

export async function DELETE(req) {
  if (!isTrustedOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  const id = await userId(req);
  const alertId = Number(req.nextUrl.searchParams.get('id'));
  if (!id || !Number.isInteger(alertId) || alertId <= 0) return NextResponse.json({ error: 'Invalid alert' }, { status: 400 });
  try {
    const conn = await getConnection();
    try { await ensureAlertsTable(conn); await conn.query('DELETE FROM price_alerts WHERE id = ? AND user_id = ?', [alertId, id]); return NextResponse.json({ ok: true }); } finally { conn.release(); }
  } catch { return NextResponse.json({ error: 'Unable to delete alert' }, { status: 500 }); }
}
