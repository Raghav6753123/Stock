import sgMail from '@sendgrid/mail';
import getConnection from './mysql';
import { getBatchQuotes } from './finnhub';

const testMode = process.env.NODE_ENV !== 'production' && process.env.ALERT_TEST_MODE === 'true';
const testPrice = Number(process.env.ALERT_TEST_PRICE || 105);

export async function ensureAlertsTable(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS price_alerts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, user_id BIGINT UNSIGNED NOT NULL,
    symbol VARCHAR(20) NOT NULL, direction ENUM('above', 'below') NOT NULL,
    target_price DECIMAL(14, 2) NOT NULL, triggered_price DECIMAL(14, 2) NULL,
    triggered_at DATETIME NULL, email_sent_at DATETIME NULL, email_error VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id),
    KEY idx_price_alerts_user (user_id),
    CONSTRAINT fk_price_alerts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  for (const column of ['email_sent_at', 'email_error']) {
    const [columns] = await conn.query(`SHOW COLUMNS FROM price_alerts LIKE '${column}'`);
    if (!columns.length) await conn.query(`ALTER TABLE price_alerts ADD COLUMN ${column === 'email_sent_at' ? 'email_sent_at DATETIME NULL' : 'email_error VARCHAR(255) NULL'}`);
  }
}

async function checkRows(conn, rows) {
  const active = rows.filter((row) => !row.triggered_at);
  const quotes = await getBatchQuotes([...new Set(active.map((row) => row.symbol))]).catch(() => ({}));
  if (testMode && active.some((row) => row.symbol === 'TEST')) quotes.TEST = { price: Number.isFinite(testPrice) ? testPrice : 105 };

  const triggered = [];
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
      row.triggered_at = new Date();
      triggered.push({ id: Number(row.id), symbol: row.symbol, price, target });
    }
  }

  for (const row of rows.filter((item) => item.triggered_at && !item.email_sent_at)) {
    if (!row.email || !process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) continue;
    const condition = row.direction === 'above' ? 'rose above' : 'fell below';
    try {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      await sgMail.send({
        to: row.email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: `Price alert: ${row.symbol} ${condition} $${Number(row.target_price).toFixed(2)}`,
        text: `${row.symbol} is now $${Number(row.triggered_price).toFixed(2)}. Your alert has triggered.`,
        html: `<p><strong>${row.symbol}</strong> is now <strong>$${Number(row.triggered_price).toFixed(2)}</strong>.</p><p>Your price alert has triggered.</p>`,
      });
      await conn.query('UPDATE price_alerts SET email_sent_at = UTC_TIMESTAMP(), email_error = NULL WHERE id = ?', [row.id]);
      row.email_sent_at = new Date();
    } catch (error) {
      const message = String(error?.message || 'SendGrid delivery failed').slice(0, 255);
      await conn.query('UPDATE price_alerts SET email_error = ? WHERE id = ?', [message, row.id]);
      console.error(`Price alert email failed for alert ${row.id}:`, message);
    }
  }
  return { rows, triggered, quotes };
}

export async function checkAlertsForUser(userId) {
  const conn = await getConnection();
  try {
    await ensureAlertsTable(conn);
    const [rows] = await conn.query(
      `SELECT a.*, u.email FROM price_alerts a JOIN users u ON u.id = a.user_id
       WHERE a.user_id = ? ORDER BY a.created_at DESC`,
      [userId]
    );
    return await checkRows(conn, rows);
  } finally {
    conn.release();
  }
}

export async function checkAllAlerts() {
  const conn = await getConnection();
  try {
    await ensureAlertsTable(conn);
    const [rows] = await conn.query(
      `SELECT a.*, u.email FROM price_alerts a JOIN users u ON u.id = a.user_id
       WHERE a.triggered_at IS NULL OR a.email_sent_at IS NULL`
    );
    return await checkRows(conn, rows);
  } finally {
    conn.release();
  }
}

export { testMode, testPrice };
