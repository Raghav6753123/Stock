'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Brain, Eye, Plus, RefreshCw, Trash2 } from 'lucide-react';

type Observation = { id: number; symbol: string; thesis: string; startPrice: number; currentPrice: number | null; startedAt: string; endAt: string; status: 'active' | 'completed'; snapshots: { price: number; recordedAt: string }[] };

function money(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function date(value: string) {
  return new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ObservationsPage() {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [symbol, setSymbol] = useState('');
  const [thesis, setThesis] = useState('');
  const [hours, setHours] = useState('24');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const response = await fetch('/api/observations', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || 'Unable to load observations.');
    else setObservations(data.observations || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const addObservation = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setError('');
    const response = await fetch('/api/observations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, thesis, hours: Number(hours) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || 'Unable to create observation.');
    else { setSymbol(''); setThesis(''); setHours('24'); await load(); }
    setSaving(false);
  };

  const removeObservation = async (id: number) => {
    await fetch(`/api/observations?id=${id}`, { method: 'DELETE' });
    await load();
  };

  return <div className="space-y-6">
    <div className="flex items-center gap-3"><Link href="/dashboard" className="rounded-xl border border-border bg-muted p-2 text-gray-400 hover:text-white"><ArrowLeft className="w-4 h-4" /></Link><div className="flex-1"><h1 className="flex items-center gap-2 text-2xl font-bold"><Eye className="w-5 h-5 text-primary" /> Observations</h1><p className="mt-0.5 text-xs text-gray-500">Track a research idea over time using price snapshots and your own thesis.</p></div><button onClick={load} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-gray-300"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button></div>
    {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}

    <form onSubmit={addObservation} className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-5 md:grid-cols-[140px_1fr_110px_auto]">
      <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="Symbol (AAPL)" className="h-11 rounded-xl border border-border bg-background px-3 text-sm text-white outline-none focus:border-primary" />
      <input value={thesis} onChange={(event) => setThesis(event.target.value)} maxLength={500} placeholder="Your idea: Why are you observing this stock?" className="h-11 rounded-xl border border-border bg-background px-3 text-sm text-white outline-none focus:border-primary" />
      <select value={hours} onChange={(event) => setHours(event.target.value)} className="h-11 rounded-xl border border-border bg-background px-3 text-sm text-white outline-none focus:border-primary"><option value="1">1 hour</option><option value="4">4 hours</option><option value="8">8 hours</option><option value="12">12 hours</option><option value="24">1 day</option><option value="72">3 days</option><option value="168">7 days</option><option value="336">14 days</option><option value="720">30 days</option><option value="2160">90 days</option></select>
      <button disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"><Plus className="w-4 h-4" /> {saving ? 'Saving...' : 'Observe'}</button>
    </form>

    {loading ? <p className="text-sm text-gray-500">Loading observations...</p> : observations.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-gray-500">Add a stock and thesis to start tracking an idea.</div> : <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{observations.map((observation) => {
      const price = observation.currentPrice || observation.snapshots.at(-1)?.price || null;
      const change = price == null ? null : ((price - observation.startPrice) / observation.startPrice) * 100;
      const prompt = `Give me a simple research insight for my ${observation.symbol} observation. My thesis: ${observation.thesis}. Start price: ${money(observation.startPrice)}. Current price: ${price == null ? 'unavailable' : money(price)}. Return: ${change == null ? 'unavailable' : `${change.toFixed(2)}%`}. Observation ends: ${date(observation.endAt)}. Explain evidence, risks, and what information is still missing. Do not give buy or sell instructions.`;
      return <article key={observation.id} className="rounded-2xl border border-border bg-card p-5"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="text-lg font-bold text-white">{observation.symbol}</h2><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${observation.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-gray-400'}`}>{observation.status}</span></div><p className="mt-2 text-sm leading-relaxed text-gray-300">{observation.thesis}</p></div><button onClick={() => removeObservation(observation.id)} className="text-gray-500 hover:text-red-400" title="Delete observation"><Trash2 className="w-4 h-4" /></button></div><div className="mt-5 grid grid-cols-3 gap-3 rounded-xl bg-muted/30 p-3 text-xs"><div><p className="text-gray-500">Start</p><p className="mt-1 font-bold text-white">{money(observation.startPrice)}</p></div><div><p className="text-gray-500">Current</p><p className="mt-1 font-bold text-white">{price == null ? 'Waiting...' : money(price)}</p></div><div><p className="text-gray-500">Return</p><p className={`mt-1 font-bold ${change == null ? 'text-gray-400' : change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{change == null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}</p></div></div><div className="mt-4 flex items-center justify-between gap-3"><p className="text-xs text-gray-500">{observation.snapshots.length} price snapshot{observation.snapshots.length === 1 ? '' : 's'} · Ends {date(observation.endAt)}</p><Link href={`/dashboard/ai?prompt=${encodeURIComponent(prompt.slice(0, 1200))}`} className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:text-primary/80"><Brain className="w-3.5 h-3.5" /> Ask AI for insight</Link></div></article>;
    })}</div>}
  </div>;
}
