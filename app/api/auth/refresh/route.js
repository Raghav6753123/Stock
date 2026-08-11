import { NextResponse } from 'next/server';
import getConnection from '../../lib/mysql';
import { buildAuthCookies } from '../../lib/authCookies';
import jwtUtil from '../../lib/jwt';
import { isTrustedOrigin } from '../../lib/requestSecurity';

export async function POST(req) {
  try {
    if (!isTrustedOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
    const refreshToken = req.cookies.get(jwtUtil.REFRESH_TOKEN_COOKIE)?.value;
    if (!refreshToken) {
      return NextResponse.json({ error: 'Missing refresh token' }, { status: 401 });
    }

    const decoded = await jwtUtil.verifyRefreshToken(refreshToken).catch(() => null);
    if (!decoded?.sub) {
      return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 });
    }

    const conn = await getConnection();
    try {
      const [rows] = await conn.query(
        'SELECT id, name, email, refresh_token_hash FROM users WHERE id = ? LIMIT 1',
        [decoded.sub]
      );
      
      const user = rows[0];
      if (!user || user.refresh_token_hash !== jwtUtil.hashToken(refreshToken)) {
        return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 });
      }

      const refreshTtl = jwtUtil.REFRESH_TOKEN_TTL_SECONDS_DEFAULT;
      const newAccessToken = await jwtUtil.signAccessToken({ sub: user.id, email: user.email, name: user.name });
      const newRefreshToken = await jwtUtil.signRefreshToken({ sub: user.id, jti: jwtUtil.createRefreshTokenId() }, refreshTtl);
      const newRefreshTokenHash = jwtUtil.hashToken(newRefreshToken);

      await conn.query(
        'UPDATE users SET refresh_token_hash = ?, refresh_token_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND) WHERE id = ?',
        [newRefreshTokenHash, refreshTtl, user.id]
      );

      const cookies = buildAuthCookies({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        refreshMaxAgeSeconds: refreshTtl,
      });

      const res = NextResponse.json({ ok: true });
      res.cookies.set(cookies.access);
      res.cookies.set(cookies.refresh);
      return res;
    } finally {
      conn.release();
    }
  } catch (error) {
    return NextResponse.json({ error: 'Refresh failed' }, { status: 500 });
  }
}
