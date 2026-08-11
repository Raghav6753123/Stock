'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bell, Plus, Trash2 } from 'lucide-react';
import { io } from 'socket.io-client';

type Alert = {
  id: number;
  symbol: string;
  direction: 'above' | 'below';
  targetPrice: number;
  triggeredPrice: number | null;
  triggeredAt: string | null;
  currentPrice: number | null;
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [symbol, setSymbol] = useState('AAPL');
  const [direction, setDirection] = useState<'above' | 'below'>('above');
  const [targetPrice, setTargetPrice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [testPrice, setTestPrice] = useState(0);

  const loadAlerts = async () => {
    const response = await fetch('/api/alerts', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to load alerts.');
    setAlerts(data.alerts || []);
    setTestMode(Boolean(data.testMode));
    setTestPrice(Number(data.testPrice || 0));
  };

  useEffect(() => {
    loadAlerts().catch((err) => setError(err.message));
    const socket = io();
    socket.emit('alerts:watch');
    socket.on('alerts:update', (data) => setAlerts(data.alerts || []));
    return () => {
      socket.disconnect();
    };
  }, []);

  const addAlert = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    try {
      const response = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, direction, targetPrice }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to create alert.');
      setTargetPrice('');
      await loadAlerts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create alert.');
    } finally {
      setSaving(false);
    }
  };

  const removeAlert = async (id: number) => {
    await fetch(`/api/alerts?id=${id}`, { method: 'DELETE' });
    setAlerts((items) => items.filter((alert) => alert.id !== id));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="p-2 rounded-xl bg-muted border border-border text-gray-400 hover:text-white"><ArrowLeft className="w-4 h-4" /></Link>
        <div>
          <h1 className="text-2xl font-bold">Price Alerts</h1>
          <p className="text-xs text-gray-500 mt-0.5">Get notified when a stock reaches your target price.</p>
        </div>
      </div>

      <form onSubmit={addAlert} className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-4 text-sm font-semibold text-gray-200"><Bell className="w-4 h-4 text-primary" /> Create an alert</div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_1fr_auto] gap-3">
          <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} maxLength={20} placeholder="AAPL" className="h-11 rounded-xl border border-border bg-background px-3 text-sm font-bold text-white outline-none focus:border-primary" />
          <select value={direction} onChange={(event) => setDirection(event.target.value as 'above' | 'below')} className="h-11 rounded-xl border border-border bg-background px-3 text-sm text-white outline-none focus:border-primary">
            <option value="above">Goes above</option>
            <option value="below">Drops below</option>
          </select>
          <input value={targetPrice} onChange={(event) => setTargetPrice(event.target.value)} type="number" min="0.01" step="0.01" placeholder="Target price" className="h-11 rounded-xl border border-border bg-background px-3 text-sm text-white outline-none focus:border-primary" />
          <button disabled={saving} className="h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 inline-flex items-center justify-center gap-2"><Plus className="w-4 h-4" /> Add</button>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </form>

      {testMode && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Test mode is on. <strong>TEST</strong> is fixed at ${testPrice.toFixed(2)}. Create a <strong>TEST above $100</strong> alert, then refresh to see it trigger.
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex justify-between"><h2 className="text-sm font-bold text-white">Your alerts</h2><span className="text-xs text-gray-500">Live checks every 30 seconds</span></div>
        {alerts.length === 0 ? <p className="p-10 text-center text-sm text-gray-500">No alerts yet. Add one above to start watching a stock.</p> : (
          <div className="divide-y divide-border">
            {alerts.map((alert) => {
              const done = Boolean(alert.triggeredAt);
              return <div key={alert.id} className="flex items-center gap-4 px-5 py-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${done ? 'bg-emerald-500/10 text-emerald-400' : 'bg-primary/10 text-primary'}`}><Bell className="w-4 h-4" /></div>
                <div className="flex-1"><p className="font-bold text-white">{alert.symbol} <span className="font-normal text-gray-400">{alert.direction === 'above' ? 'above' : 'below'} ${alert.targetPrice.toFixed(2)}</span></p><p className="text-xs text-gray-500 mt-1">{done ? `Triggered at $${alert.triggeredPrice?.toFixed(2)}` : alert.currentPrice ? `Current price: $${alert.currentPrice.toFixed(2)}` : 'Waiting for a live quote'}</p></div>
                <span className={`text-xs font-semibold ${done ? 'text-emerald-400' : 'text-amber-400'}`}>{done ? 'Triggered' : 'Watching'}</span>
                <button onClick={() => removeAlert(alert.id)} className="p-2 text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
              </div>;
            })}
          </div>
        )}
      </section>
    </div>
  );
}
