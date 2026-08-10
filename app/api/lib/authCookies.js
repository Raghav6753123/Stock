import jwtUtil from './jwt';

const getCommon = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
});

export function buildAuthCookies({ accessToken, refreshToken, refreshMaxAgeSeconds }) {
  const common = getCommon();
  return {
    access: { name: jwtUtil.ACCESS_TOKEN_COOKIE, value: accessToken, maxAge: jwtUtil.ACCESS_TOKEN_TTL_SECONDS, ...common },
    refresh: { name: jwtUtil.REFRESH_TOKEN_COOKIE, value: refreshToken, maxAge: refreshMaxAgeSeconds, ...common },
  };
}

export function clearAuthCookies() {
  const common = getCommon();
  return {
    access: { name: jwtUtil.ACCESS_TOKEN_COOKIE, value: '', maxAge: 0, ...common },
    refresh: { name: jwtUtil.REFRESH_TOKEN_COOKIE, value: '', maxAge: 0, ...common },
  };
}
