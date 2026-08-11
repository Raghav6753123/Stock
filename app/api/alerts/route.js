import { NextResponse } from 'next/server';
import sgMail from '@sendgrid/mail';
import getConnection from '../lib/mysql';
import jwtUtil from '../lib/jwt';
import { getBatchQuotes } from '../lib/finnhub';
import { isTrustedOrigin } from '../lib/requestSecurity';

const ALERT_TEST_MODE = process.env.NODE_ENV !== 'production' && process.env.ALERT_TEST_MODE === 'true';
const ALERT_TEST_PRICE = Number(process.env.ALERT_TEST_PRICE || 105);

async function userId(req) {
  const token = req.cookies.get(jwtUtil.ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;
  try {
    return String((await jwtUtil.verifyAccessToken(token)).sub);
  } catch {
    return null;
  }
}

async function ensureTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS price_alerts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      symbol VARCHAR(20) NOT NULL,
      direction ENUM('above', 'below') NOT NULL,
      target_price DECIMAL(14, 2) NOT NULL,
      triggered_price DECIMAL(14, 2) NULL,
      triggered_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_price_alerts_user (user_id),
      CONSTRAINT fk_price_alerts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function GET(req) {
  const id = await userId(req);
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const conn = await getConnection();
    try {
      await ensureTable(conn);
      const [rows] = await conn.query(
        `SELECT id, symbol, direction, target_price, triggered_price, triggered_at, created_at
         FROM price_alerts WHERE user_id = ? ORDER BY created_at DESC`,
        [id]
      );

      const active = rows.filter((row) => !row.triggered_at);
      const quotes = await getBatchQuotes([...new Set(active.map((row) => row.symbol))]).catch(() => ({}));
      if (ALERT_TEST_MODE && active.some((row) => row.symbol === 'TEST')) {
        quotes.TEST = { price: Number.isFinite(ALERT_TEST_PRICE) ? ALERT_TEST_PRICE : 105 };
      }
      const triggered = [];
      const [users] = await conn.query('SELECT email FROM users WHERE id = ? LIMIT 1', [id]);
      const email = users[0]?.email;

      for (const row of active) {
        const price = Number(quotes[row.symbol]?.price);
        const target = Number(row.target_price);
        const reached = row.direction === 'above' ? price >= target : price <= target;
        if (!Number.isFinite(price) || !reached) continue;

        const [result] = await conn.query(
          'UPDATE price_alerts SET triggered_price = ?, triggered_at = UTC_TIMESTAMP() WHERE id = ? AND triggered_at IS NULL',
          [price, row.id]
        );
        if (result.affectedRows) {
          row.triggered_price = price;
          row.triggered_at = new Date().toISOString();
          triggered.push({ id: Number(row.id), symbol: row.symbol, price, target });

          if (email && process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) {
            const condition = row.direction === 'above' ? 'rose above' : 'fell below';
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            await sgMail.send({
              to: email,
              from: process.env.SENDGRID_FROM_EMAIL,
              subject: `Price alert: ${row.symbol} ${condition} $${target.toFixed(2)}`,
              text: `${row.symbol} is now $${price.toFixed(2)}. Your alert for ${row.symbol} to ${condition} $${target.toFixed(2)} has triggered.`,
              html: `<p><strong>${row.symbol}</strong> is now <strong>$${price.toFixed(2)}</strong>.</p><p>Your alert for ${row.symbol} to ${condition} <strong>$${target.toFixed(2)}</strong> has triggered.</p>`,
            }).catch((error) => console.error('Unable to email price alert:', error.message));
          }
        }
      }

      return NextResponse.json({
        alerts: rows.map((row) => ({
          id: Number(row.id),
          symbol: row.symbol,
          direction: row.direction,
          targetPrice: Number(row.target_price),
          triggeredPrice: row.triggered_price === null ? null : Number(row.triggered_price),
          triggeredAt: row.triggered_at,
          createdAt: row.created_at,
          currentPrice: Number(quotes[row.symbol]?.price) || null,
        })),
        triggered,
        testMode: ALERT_TEST_MODE,
        testPrice: ALERT_TEST_PRICE,
      });
    } finally {
      conn.release();
    }
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
  if (!symbol || symbol.length > 20 || !direction || !Number.isFinite(target) || target <= 0) {
    return NextResponse.json({ error: 'Enter a symbol, direction, and valid target price.' }, { status: 400 });
  }

  try {
    const conn = await getConnection();
    try {
      await ensureTable(conn);
      const [result] = await conn.query(
        'INSERT INTO price_alerts (user_id, symbol, direction, target_price) VALUES (?, ?, ?, ?)',
        [id, symbol, direction, target]
      );
      return NextResponse.json({ id: Number(result.insertId) }, { status: 201 });
    } finally {
      conn.release();
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create alert' }, { status: 500 });
  }
}

export async function DELETE(req) {
  if (!isTrustedOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  const id = await userId(req);
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const alertId = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(alertId) || alertId <= 0) return NextResponse.json({ error: 'Invalid alert' }, { status: 400 });

  try {
    const conn = await getConnection();
    try {
      await ensureTable(conn);
      await conn.query('DELETE FROM price_alerts WHERE id = ? AND user_id = ?', [alertId, id]);
      return NextResponse.json({ ok: true });
    } finally {
      conn.release();
    }
  } catch {
    return NextResponse.json({ error: 'Unable to delete alert' }, { status: 500 });
  }
}
