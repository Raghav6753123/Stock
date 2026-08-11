export function isTrustedOrigin(req) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const protocol = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '');

  if (!origin || !host) return false;
  return origin === `${protocol}://${host}`;
}

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LIMIT = 5;
const IP_LIMIT = 20;
const MAX_TRACKED_KEYS = 5000;

function getIp(req) {
  return (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown').split(',')[0].trim();
}

function getAttempt(key) {
  const attempt = attempts.get(key);
  if (!attempt || Date.now() - attempt.firstAttempt > WINDOW_MS) {
    attempts.delete(key);
    return null;
  }
  return attempt;
}

function cleanOldAttempts() {
  if (attempts.size < MAX_TRACKED_KEYS) return;
  const now = Date.now();
  for (const [key, attempt] of attempts) {
    if (now - attempt.firstAttempt > WINDOW_MS) attempts.delete(key);
  }
}

export function isLoginRateLimited(req, email) {
  const ip = getIp(req);
  return (getAttempt(`account:${email}`)?.count || 0) >= ACCOUNT_LIMIT || (getAttempt(`ip:${ip}`)?.count || 0) >= IP_LIMIT;
}

export function recordLoginFailure(req, email) {
  cleanOldAttempts();
  const now = Date.now();
  const keys = [`account:${email}`, `ip:${getIp(req)}`];
  keys.forEach((key) => {
    if (!attempts.has(key) && attempts.size >= MAX_TRACKED_KEYS) return;
    const attempt = getAttempt(key);
    attempts.set(key, { count: (attempt?.count || 0) + 1, firstAttempt: attempt?.firstAttempt || now });
  });
}

export function clearLoginFailures(req, email) {
  attempts.delete(`account:${email}`);
  attempts.delete(`ip:${getIp(req)}`);
}
