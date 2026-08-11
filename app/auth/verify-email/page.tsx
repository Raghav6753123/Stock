'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function VerifyEmailPage() {
  const token = useSearchParams().get('token') || '';
  const [message, setMessage] = useState('Verifying your email...');
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (!token) {
      setMessage('This verification link is invalid.');
      return;
    }
    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Email verification failed.');
        setVerified(true);
        setMessage(data.message || 'Email verified.');
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Email verification failed.'));
  }, [token]);

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-xl">
        <h1 className="text-xl font-bold">Email verification</h1>
        <p className="mt-4 text-sm text-muted-foreground" role="status">{message}</p>
        {verified && <Link href="/login" className="mt-6 inline-block font-semibold text-primary">Continue to sign in</Link>}
      </section>
    </main>
  );
}
