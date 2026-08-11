import { NextResponse } from 'next/server';
import getConnection from '../../lib/mysql';
import jwtUtil from '../../lib/jwt';
import { isTrustedOrigin } from '../../lib/requestSecurity';

async function getUser(req) {
  const token = req.cookies.get(jwtUtil.ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;
  try {
    return await jwtUtil.verifyAccessToken(token);
  } catch {
    return null;
  }
}

async function getConfirmation(conn, token, userId) {
  const [rows] = await conn.query(
    `SELECT token, side, symbol, quantity, quoted_price, chat_message_id, expires_at, used_at,
            expires_at > UTC_TIMESTAMP() AS is_active
     FROM agent_trade_confirmations WHERE token = ? AND user_id = ? LIMIT 1`,
    [token, userId]
  );
  return rows?.[0] || null;
}

export async function GET(req) {
  const user = await getUser(req);
  const token = String(req.nextUrl.searchParams.get('token') || '');
  if (!user?.sub || !token) return NextResponse.json({ error: 'Please sign in to review this order.' }, { status: 401 });

  try {
    const conn = await getConnection();
    try {
      const order = await getConfirmation(conn, token, user.sub);
      if (!order || order.used_at || !order.is_active) return NextResponse.json({ error: 'This confirmation link has expired.' }, { status: 410 });
      return NextResponse.json({ order: { side: order.side, symbol: order.symbol, quantity: Number(order.quantity), price: Number(order.quoted_price) } });
    } finally {
      conn.release();
    }
  } catch {
    return NextResponse.json({ error: 'Unable to load this order.' }, { status: 500 });
  }
}

export async function POST(req) {
  if (!isTrustedOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  const user = await getUser(req);
  const body = await req.json().catch(() => ({}));
  const token = String(body.token || '');
  if (!user?.sub || !token) return NextResponse.json({ error: 'Please sign in to confirm this order.' }, { status: 401 });

  try {
    const conn = await getConnection();
    let order;
    try {
      order = await getConfirmation(conn, token, user.sub);
      if (!order || order.used_at || !order.is_active) return NextResponse.json({ error: 'This confirmation link has expired.' }, { status: 410 });
    if (body.approve === false) {
        await conn.query('UPDATE agent_trade_confirmations SET used_at = UTC_TIMESTAMP() WHERE token = ?', [token]);
        if (order.chat_message_id) {
          await conn.query(`UPDATE ai_chat_messages m JOIN ai_chat_sessions s ON s.id = m.session_id
            SET m.action_json = NULL, m.text = CONCAT(m.text, '\n\nOrder cancelled from email confirmation.')
            WHERE m.id = ? AND s.user_id = ?`, [order.chat_message_id, user.sub]);
        }
        return NextResponse.json({ answer: 'Order cancelled.' });
      }
      if (body.approve !== true) return NextResponse.json({ error: 'Explicit approval is required.' }, { status: 400 });
    } finally {
      conn.release();
    }

    // Calling the public Railway URL from this same server can fail behind the
    // proxy. The local server is the same authenticated application.
    const internalOrigin = `http://127.0.0.1:${process.env.PORT || 3000}`;
    const response = await fetch(`${internalOrigin}/api/portfolio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: req.headers.get('cookie') || '',
        origin: internalOrigin,
        'x-idempotency-key': token,
      },
      body: JSON.stringify({ side: order.side, sym: order.symbol, name: order.symbol, quantity: Number(order.quantity), price: Number(order.quoted_price) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: data.error || 'Order could not be completed.' }, { status: response.status });

    const finish = await getConnection();
    try {
      await finish.query('UPDATE agent_trade_confirmations SET used_at = UTC_TIMESTAMP() WHERE token = ?', [token]);
      if (order.chat_message_id) {
        await finish.query(`UPDATE ai_chat_messages m JOIN ai_chat_sessions s ON s.id = m.session_id
          SET m.action_json = NULL, m.text = CONCAT(m.text, '\n\n✅ This paper trade was completed after email approval.')
          WHERE m.id = ? AND s.user_id = ?`, [order.chat_message_id, user.sub]);
      }
    } finally {
      finish.release();
    }
    return NextResponse.json({ answer: `${order.side === 'BUY' ? 'Bought' : 'Sold'} ${order.quantity} ${order.symbol} at $${Number(order.quoted_price).toFixed(2)}.` });
  } catch (error) {
    console.error('Trade confirmation failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Unable to complete this order.' }, { status: 500 });
  }
}
