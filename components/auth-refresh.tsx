'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export default function AuthRefresh() {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    // React development mode can replay effects. Refreshing twice at once would
    // rotate the first token, then make the second request look invalid.
    if (started.current) return;
    started.current = true;

    let alive = true;

    const run = async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST' });
        if (!alive) return;
        // A missing or invalid refresh token means the user is signed out.
        // Server/database errors should not throw an active user back to login.
        if (res.status === 401 || res.status === 403) {
          router.replace('/login');
        }
      } catch {
        // Keep the current session visible during a temporary network failure.
      }
    };

    // Refresh shortly after mount, then every 5 minutes.
    run();
    const interval = setInterval(run, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [router]);

  return null;
}
