import { NextResponse } from 'next/server';
import { clearAuthCookies } from '../../lib/authCookies';
import getConnection from '../../lib/mysql';
import jwtUtil from '../../lib/jwt';
import { isTrustedOrigin } from '../../lib/requestSecurity';

export async function POST(req) {
  if (!isTrustedOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  const refreshToken = req.cookies.get(jwtUtil.REFRESH_TOKEN_COOKIE)?.value;

  if (refreshToken) {
    try {
      const decoded = await jwtUtil.verifyRefreshToken(refreshToken);
      if (decoded?.sub) {
        const conn = await getConnection();
        try {
          await conn.query(
            'UPDATE users SET refresh_token_hash = NULL, refresh_token_expires_at = NULL WHERE id = ?',
            [decoded.sub]
          );
        } finally {
          conn.release();
        }
      }
    } catch {
      // Clear cookies even when token validation fails.
    }
  }
  const cookies = clearAuthCookies();
  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set(cookies.access);
  res.cookies.set(cookies.refresh);
  return res;
}
