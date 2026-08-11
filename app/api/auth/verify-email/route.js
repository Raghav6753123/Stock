import { NextResponse } from 'next/server';
import getConnection from '../../lib/mysql';
import { isTrustedOrigin } from '../../lib/requestSecurity';

export async function POST(req) {
  if (!isTrustedOrigin(req)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: 'Invalid verification link.' }, { status: 400 });
  }

  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT user_id FROM email_verifications
       WHERE token = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
       LIMIT 1 FOR UPDATE`,
      [token]
    );
    const verification = rows?.[0];
    if (!verification) {
      await conn.rollback();
      return NextResponse.json({ error: 'This verification link is invalid or expired.' }, { status: 410 });
    }

    await conn.query('UPDATE users SET email_verified_at = UTC_TIMESTAMP() WHERE id = ?', [verification.user_id]);
    await conn.query('UPDATE email_verifications SET used_at = UTC_TIMESTAMP() WHERE token = ?', [token]);
    await conn.commit();
    return NextResponse.json({ message: 'Email verified. You can now sign in.' });
  } catch (error) {
    await conn.rollback().catch(() => {});
    const message = process.env.NODE_ENV === 'production'
      ? 'Email verification failed'
      : (error instanceof Error ? error.message : 'Email verification failed');
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    conn.release();
  }
}
