'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Check, X } from 'lucide-react';

type Order = { side: 'BUY' | 'SELL'; symbol: string; quantity: number; price: number };

export default function AgentConfirmPage() {
  const token = useSearchParams().get('token') || '';
  const [order, setOrder] = useState<Order | null>(null);
  const [message, setMessage] = useState('Loading order…');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/ai/trade-confirm?token=${encodeURIComponent(token)}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Unable to load order.');
        setOrder(data.order);
        setMessage('');
      })
      .catch((error) => setMessage(error.message));
  }, [token]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    const response = await fetch('/api/ai/trade-confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, approve }) });
    const data = await response.json().catch(() => ({}));
    setOrder(null);
    setMessage(data.answer || data.error || 'Unable to complete the request.');
    setBusy(false);
  };

  return <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6"><section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
    <h1 className="text-xl font-bold">Confirm virtual stock order</h1>
    {order ? <><p className="mt-3 text-sm text-muted-foreground">Are you sure you want to place this order?</p><div className="mt-5 rounded-xl bg-muted p-4"><p className="text-2xl font-black">{order.side} {order.quantity} {order.symbol}</p><p className="mt-2 text-sm text-muted-foreground">Quoted price: <strong className="text-foreground">${order.price.toFixed(2)}</strong></p></div><p className="mt-4 text-xs text-muted-foreground">This places a virtual portfolio order at the quoted price.</p><div className="mt-6 grid grid-cols-2 gap-3"><button disabled={busy} onClick={() => decide(false)} className="h-11 rounded-xl border border-border text-sm font-bold inline-flex items-center justify-center gap-2"><X className="w-4 h-4" /> Cancel</button><button disabled={busy} onClick={() => decide(true)} className="h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold inline-flex items-center justify-center gap-2"><Check className="w-4 h-4" /> Confirm</button></div></> : <><p className="mt-4 text-sm text-muted-foreground">{message}</p><Link href="/dashboard/ai" className="mt-6 inline-block text-sm font-semibold text-primary">Return to AI Chat</Link></>}
  </section></main>;
}
