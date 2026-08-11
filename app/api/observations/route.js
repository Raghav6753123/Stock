import { NextResponse } from 'next/server';
import getConnection from '../lib/mysql';
import jwtUtil from '../lib/jwt';
import { getBatchQuotes, getQuote } from '../lib/finnhub';
import { isTrustedOrigin } from '../lib/requestSecurity';

async function getUserId(req) {
  const token = req.cookies.get(jwtUtil.ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;
  try {
    return String((await jwtUtil.verifyAccessToken(token)).sub);
  } catch {
    return null;
  }
}

async function ensureTables(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS stock_observations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      symbol VARCHAR(20) NOT NULL,
      thesis VARCHAR(500) NOT NULL,
      start_price DECIMAL(14, 2) NOT NULL,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      end_at DATETIME NOT NULL,
      status ENUM('active', 'completed') NOT NULL DEFAULT 'active',
      PRIMARY KEY (id),
      KEY idx_observations_user_status (user_id, status),
      CONSTRAINT fk_observations_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS observation_snapshots (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      observation_id BIGINT UNSIGNED NOT NULL,
      price DECIMAL(14, 2) NOT NULL,
      recorded_on DATE NOT NULL,
      recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_observation_snapshot_time (observation_id, recorded_at),
      CONSTRAINT fk_observation_snapshot FOREIGN KEY (observation_id) REFERENCES stock_observations (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [oldIndex] = await conn.query("SHOW INDEX FROM observation_snapshots WHERE Key_name = 'uq_observation_daily_snapshot'");
  if (oldIndex.length) {
    // The older daily index also supports this foreign key. Replace the key and
    // then add the foreign key back so snapshots can be stored every 15 minutes.
    await conn.query('ALTER TABLE observation_snapshots DROP FOREIGN KEY fk_observation_snapshot');
    await conn.query('ALTER TABLE observation_snapshots DROP INDEX uq_observation_daily_snapshot');
    await conn.query('ALTER TABLE observation_snapshots ADD UNIQUE KEY uq_observation_snapshot_time (observation_id, recorded_at)');
    await conn.query('ALTER TABLE observation_snapshots ADD CONSTRAINT fk_observation_snapshot FOREIGN KEY (observation_id) REFERENCES stock_observations (id) ON DELETE CASCADE');
  }
}

async function refreshActiveObservations(conn, rows) {
  const quotes = await getBatchQuotes([...new Set(rows.map((row) => row.symbol))]).catch(() => ({}));
  for (const row of rows) {
    const price = Number(quotes[row.symbol]?.price);
    if (Number.isFinite(price) && price > 0) {
      await conn.query(
        `INSERT INTO observation_snapshots (observation_id, price, recorded_on)
         SELECT ?, ?, UTC_DATE() WHERE NOT EXISTS
         (SELECT 1 FROM observation_snapshots WHERE observation_id = ? AND recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE))`,
        [row.id, price, row.id]
      );
    }
    await conn.query("UPDATE stock_observations SET status = 'completed' WHERE id = ? AND end_at <= UTC_TIMESTAMP()", [row.id]);
  }
  return quotes;
}

export async function GET(req) {
  const monitorSecret = process.env.OBSERVATION_MONITOR_SECRET;
  const isMonitor = Boolean(monitorSecret && req.headers.get('x-observation-secret') === monitorSecret);
  const userId = isMonitor ? null : await getUserId(req);
  if (!isMonitor && !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const conn = await getConnection();
    try {
      await ensureTables(conn);
      const [activeRows] = await conn.query(
        isMonitor
          ? "SELECT id, symbol, end_at FROM stock_observations WHERE status = 'active'"
          : "SELECT id, symbol, end_at FROM stock_observations WHERE user_id = ? AND status = 'active'",
        isMonitor ? [] : [userId]
      );
      const quotes = await refreshActiveObservations(conn, activeRows || []);
      if (isMonitor) return NextResponse.json({ ok: true, checked: activeRows.length });

      const [rows] = await conn.query(
        `SELECT id, symbol, thesis, start_price, started_at, end_at, status
         FROM stock_observations WHERE user_id = ? ORDER BY started_at DESC`,
        [userId]
      );
      const ids = rows.map((row) => row.id);
      const [snapshots] = ids.length
        ? await conn.query('SELECT observation_id, price, recorded_at FROM observation_snapshots WHERE observation_id IN (?) ORDER BY recorded_at ASC', [ids])
        : [[]];
      const snapshotByObservation = new Map();
      snapshots.forEach((snapshot) => {
        const list = snapshotByObservation.get(snapshot.observation_id) || [];
        list.push({ price: Number(snapshot.price), recordedAt: snapshot.recorded_at });
        snapshotByObservation.set(snapshot.observation_id, list);
      });

      return NextResponse.json({
        observations: rows.map((row) => ({
          id: Number(row.id), symbol: row.symbol, thesis: row.thesis, startPrice: Number(row.start_price),
          startedAt: row.started_at, endAt: row.end_at, status: row.status,
          currentPrice: Number(quotes[row.symbol]?.price) || null,
          snapshots: snapshotByObservation.get(row.id) || [],
        })),
      });
    } finally {
      conn.release();
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load observations.' }, { status: 500 });
  }
}

export async function POST(req) {
  if (!isTrustedOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const symbol = String(body.symbol || '').trim().toUpperCase();
  const thesis = String(body.thesis || '').trim();
  const hours = Number(body.hours);
  if (!/^[A-Z][A-Z0-9.]{0,19}$/.test(symbol) || !thesis || thesis.length > 500 || !Number.isInteger(hours) || hours < 1 || hours > 2160) {
    return NextResponse.json({ error: 'Enter a valid symbol, short thesis, and a duration from 1 hour to 90 days.' }, { status: 400 });
  }

  try {
    const quote = await getQuote(symbol);
    if (!quote?.price) return NextResponse.json({ error: 'Live price is unavailable for this symbol.' }, { status: 400 });
    const conn = await getConnection();
    try {
      await ensureTables(conn);
      const [active] = await conn.query("SELECT id FROM stock_observations WHERE user_id = ? AND status = 'active'", [userId]);
      if (active.length >= 10) return NextResponse.json({ error: 'Keep up to 10 active observations at a time.' }, { status: 400 });
      const [result] = await conn.query(
        'INSERT INTO stock_observations (user_id, symbol, thesis, start_price, end_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR))',
        [userId, symbol, thesis, quote.price, hours]
      );
      await conn.query('INSERT INTO observation_snapshots (observation_id, price, recorded_on) VALUES (?, ?, UTC_DATE())', [result.insertId, quote.price]);
      return NextResponse.json({ id: Number(result.insertId) }, { status: 201 });
    } finally {
      conn.release();
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create observation.' }, { status: 500 });
  }
}

export async function DELETE(req) {
  if (!isTrustedOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  const userId = await getUserId(req);
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!userId || !Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid observation.' }, { status: 400 });
  const conn = await getConnection();
  try {
    await ensureTables(conn);
    await conn.query('DELETE FROM stock_observations WHERE id = ? AND user_id = ?', [id, userId]);
    return NextResponse.json({ ok: true });
  } finally {
    conn.release();
  }
}
