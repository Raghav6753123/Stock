import { loadServerEnvOnce } from './loadEnv';

loadServerEnvOnce();

function getConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

export async function getSharedCache(key) {
  const config = getConfig();
  if (!config) return null;

  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', key]),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    return typeof payload?.result === 'string' ? JSON.parse(payload.result) : payload?.result;
  } catch {
    return null;
  }
}

export async function setSharedCache(key, value, ttlMs) {
  const config = getConfig();
  if (!config) return false;

  const ttlSeconds = Math.max(1, Math.ceil(Number(ttlMs) / 1000));
  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', key, JSON.stringify(value), 'EX', String(ttlSeconds)]),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function isSharedCacheConfigured() {
  return Boolean(getConfig());
}
