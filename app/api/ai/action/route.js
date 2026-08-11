import { NextResponse } from 'next/server';
import sgMail from '@sendgrid/mail';
import getConnection from '../../lib/mysql';
import jwtUtil from '../../lib/jwt';
import { getQuote } from '../../lib/finnhub';
import { isTrustedOrigin } from '../../lib/requestSecurity';

function validSymbol(value) {
  return /^[A-Z][A-Z0-9.]{0,19}$/.test(value);
}

async function getUser(req) {
  const token = req.cookies.get(jwtUtil.ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;
  try {
    return await jwtUtil.verifyAccessToken(token);
  } catch {
    return null;
  }
}

async function ensureConfirmationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS agent_trade_confirmations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      token CHAR(36) NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      side ENUM('BUY', 'SELL') NOT NULL,
      symbol VARCHAR(20) NOT NULL,
      quantity DECIMAL(14, 6) NOT NULL,
      quoted_price DECIMAL(14, 2) NOT NULL,
      chat_message_id BIGINT UNSIGNED NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_agent_trade_token (token),
      CONSTRAINT fk_agent_trade_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [columns] = await conn.query("SHOW COLUMNS FROM agent_trade_confirmations LIKE 'chat_message_id'");
  if (!columns.length) await conn.query('ALTER TABLE agent_trade_confirmations ADD COLUMN chat_message_id BIGINT UNSIGNED NULL');
}

export async function POST(req) {
  if (!isTrustedOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const action = body?.action || {};
  const chatMessageId = Number(body?.chatMessageId) || null;
  const symbol = String(action.symbol || '').toUpperCase();
  const user = await getUser(req);
  if (!user?.sub) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });

  if (!validSymbol(symbol)) {
    return NextResponse.json({ error: 'Invalid stock symbol.' }, { status: 400 });
  }

  if (action.type === 'trade') {
    const quantity = Number(action.quantity);
    const side = action.side === 'BUY' || action.side === 'SELL' ? action.side : null;
    if (!side || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
      return NextResponse.json({ error: 'Invalid trade details.' }, { status: 400 });
    }

    if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
      return NextResponse.json({ error: 'Email confirmation is not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL.' }, { status: 500 });
    }

    try {
      const quote = await getQuote(symbol);
      if (!quote?.price) throw new Error('Live price unavailable');
      const token = crypto.randomUUID();
      const price = Number(quote.price);
      const conn = await getConnection();
      let email;
      try {
        await ensureConfirmationsTable(conn);
        const [users] = await conn.query('SELECT email FROM users WHERE id = ? LIMIT 1', [user.sub]);
        email = users?.[0]?.email;
        if (!email) throw new Error('Account email not found');
        await conn.query(
          'INSERT INTO agent_trade_confirmations (token, user_id, side, symbol, quantity, quoted_price, chat_message_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE))',
          [token, user.sub, side, symbol, quantity, price, chatMessageId]
        );
      } finally {
        conn.release();
      }

      const link = `${process.env.APP_URL || req.nextUrl.origin}/agent/confirm?token=${encodeURIComponent(token)}`;
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      await sgMail.send({
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: `Confirm your ${side} order for ${symbol}`,
        text: `Are you sure you want to ${side.toLowerCase()} ${quantity} ${symbol} at $${price.toFixed(2)}? Confirm or reject within 15 minutes: ${link}`,
        html: `<p>Are you sure you want to <strong>${side}</strong> <strong>${quantity} ${symbol}</strong> at <strong>$${price.toFixed(2)}</strong>?</p><p>This is a virtual portfolio order. It expires in 15 minutes.</p><p><a href="${link}">Review and confirm order</a></p>`,
      });
      if (chatMessageId) {
        const conn = await getConnection();
        try {
          await conn.query(
            `UPDATE ai_chat_messages m JOIN ai_chat_sessions s ON s.id = m.session_id
             SET m.action_json = JSON_SET(m.action_json, '$.status', 'email_sent')
             WHERE m.id = ? AND s.user_id = ?`,
            [chatMessageId, user.sub]
          );
        } finally {
          conn.release();
        }
      }
      return NextResponse.json({ answer: `I sent a confirmation email to your account. Open it and approve the ${side.toLowerCase()} order within 15 minutes.` });
    } catch (error) {
      const sendGridStatus = Number(error?.code || error?.response?.statusCode || 0);
      const providerMessage = error?.response?.body?.errors
        ?.map((item) => item.message)
        .filter(Boolean)
        .join(' ');
      console.error('SendGrid email failed:', sendGridStatus, providerMessage || error?.message || 'Unknown error');
      if (sendGridStatus === 401) {
        return NextResponse.json(
          { error: 'SendGrid rejected the API key. Create a new key with Mail Send permission, update SENDGRID_API_KEY, and restart the server.' },
          { status: 500 }
        );
      }
      if (sendGridStatus === 403) {
        return NextResponse.json(
          { error: providerMessage || 'SendGrid rejected this sender or account. Verify SENDGRID_FROM_EMAIL and finish SendGrid account setup.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to send confirmation email.' }, { status: 500 });
    }
  }

  if (action.type === 'alert') {
    const direction = action.direction === 'above' || action.direction === 'below' ? action.direction : null;
    const targetPrice = Number(action.targetPrice);
    if (!direction || !Number.isFinite(targetPrice) || targetPrice <= 0) {
      return NextResponse.json({ error: 'Invalid alert details.' }, { status: 400 });
    }

    const response = await fetch(`${req.nextUrl.origin}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: req.headers.get('cookie') || '', origin: req.nextUrl.origin },
      body: JSON.stringify({ symbol, direction, targetPrice }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: data.error || 'Unable to create alert.' }, { status: response.status });
    return NextResponse.json({ answer: `Alert created: notify you when ${symbol} goes ${direction} $${targetPrice.toFixed(2)}.` });
  }

  if (action.type === 'observation') {
    const thesis = String(action.thesis || '').trim();
    const hours = Number(action.hours);
    if (!thesis || thesis.length > 500 || !Number.isInteger(hours) || hours < 1 || hours > 2160) {
      return NextResponse.json({ error: 'Invalid observation details.' }, { status: 400 });
    }

    const response = await fetch(`${req.nextUrl.origin}/api/observations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: req.headers.get('cookie') || '', origin: req.nextUrl.origin },
      body: JSON.stringify({ symbol, thesis, hours }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: data.error || 'Unable to create observation.' }, { status: response.status });
    return NextResponse.json({ answer: `Observation started for ${symbol} for ${hours} hour${hours === 1 ? '' : 's'}.` });
  }

  return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
}
