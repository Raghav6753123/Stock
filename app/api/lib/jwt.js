import jwt from 'jsonwebtoken';
import { createHash, randomUUID } from 'crypto';
import { loadServerEnvOnce } from './loadEnv';

loadServerEnvOnce();

const ISSUER = 'stonks';
const AUDIENCE = 'stonks-web';

const getEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Missing required env var: ${name}`);
    err.statusCode = 500;
    throw err;
  }
  return value;
};

const jwtUtil = {
  ACCESS_TOKEN_COOKIE: 'stonks_access',
  REFRESH_TOKEN_COOKIE: 'stonks_refresh',
  ACCESS_TOKEN_TTL_SECONDS: 10 * 60,
  REFRESH_TOKEN_TTL_SECONDS_DEFAULT: 7 * 24 * 60 * 60,
  REFRESH_TOKEN_TTL_SECONDS_REMEMBER_ME: 30 * 24 * 60 * 60,

  createRefreshTokenId: () => randomUUID(),

  hashToken: (token) => createHash('sha256').update(String(token)).digest('hex'),

  signAccessToken: async (payload) => {
    return jwt.sign(
      { email: payload.email ?? null, name: payload.name ?? null },
      getEnv('JWT_ACCESS_SECRET'),
      {
        algorithm: 'HS256',
        expiresIn: jwtUtil.ACCESS_TOKEN_TTL_SECONDS,
        issuer: ISSUER,
        audience: AUDIENCE,
        subject: String(payload.sub),
      }
    );
  },

  signRefreshToken: async (payload, ttlSeconds) => {
    const ttl = ttlSeconds ?? jwtUtil.REFRESH_TOKEN_TTL_SECONDS_DEFAULT;
    return jwt.sign(
      { type: 'refresh' },
      getEnv('JWT_REFRESH_SECRET'),
      {
        algorithm: 'HS256',
        expiresIn: ttl,
        issuer: ISSUER,
        audience: AUDIENCE,
        subject: String(payload.sub),
        jwtid: String(payload.jti),
      }
    );
  },

  verifyAccessToken: async (token) => {
    const payload = jwt.verify(token, getEnv('JWT_ACCESS_SECRET'), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return {
      sub: payload.sub,
      email: payload.email ?? null,
      name: payload.name ?? null,
    };
  },

  verifyRefreshToken: async (token) => {
    const payload = jwt.verify(token, getEnv('JWT_REFRESH_SECRET'), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (payload.type !== 'refresh' || !payload.jti) {
      const err = new Error('Invalid refresh token');
      err.statusCode = 401;
      throw err;
    }
    return {
      sub: payload.sub,
      exp: payload.exp,
      jti: payload.jti,
    };
  }
};

export default jwtUtil;
