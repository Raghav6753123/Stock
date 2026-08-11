'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, BarChart3, RefreshCw, Search } from 'lucide-react';

type Company = {
  symbol: string;
  name: string;
  sector: string | null;
  price: number | null;
  dayReturn: number | null;
  marketCap: number | null;
  revenueGrowth: number | null;
  pe: number | null;
  debtToEquity: number | null;
  eps: number | null;
  oneYearReturn: number | null;
};

const metrics: Array<{ key: keyof Company; label: string; format: (value: number) => string; better: 'high' | 'low' }> = [
  { key: 'revenueGrowth', label: 'Revenue Growth', format: (value) => `${value.toFixed(1)}%`, better: 'high' },
  { key: 'pe', label: 'P/E Ratio', format: (value) => value.toFixed(1), better: 'low' },
  { key: 'debtToEquity', label: 'Debt / Equity', format: (value) => value.toFixed(2), better: 'low' },
  { key: 'eps', label: 'EPS (TTM)', format: (value) => `$${value.toFixed(2)}`, better: 'high' },
  { key: 'marketCap', label: 'Market Cap', format: (value) => `$${(value / 1000).toFixed(1)}B`, better: 'high' },
  { key: 'oneYearReturn', label: '1-Year Return', format: (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`, better: 'high' },
];

function isWinner(value: number | null, other: number | null, better: 'high' | 'low') {
  if (value === null || other === null || value === other) return false;
  return better === 'high' ? value > other : value < other;
}

function number(value: number | null, format: (value: number) => string) {
  return value === null || !Number.isFinite(value) ? '—' : format(value);
}

export default function ComparePage() {
  const [first, setFirst] = useState('AAPL');
  const [second, setSecond] = useState('MSFT');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const compare = async () => {
    const symbols = [first.trim().toUpperCase(), second.trim().toUpperCase()];
    if (!symbols[0] || !symbols[1] || symbols[0] === symbols[1]) {
      setError('Enter two different stock symbols, for example AAPL and MSFT.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/market/compare?symbols=${encodeURIComponent(symbols.join(','))}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to compare these stocks.');
      setCompanies(data.companies || []);
    } catch (err) {
      setCompanies([]);
      setError(err instanceof Error ? err.message : 'Unable to compare these stocks.');
    } finally {
      setLoading(false);
    }
  };

  const [left, right] = companies;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/stocks" className="p-2 rounded-xl bg-muted border border-border text-gray-400 hover:text-white transition-all">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Stock Comparison</h1>
          <p className="text-xs text-gray-500 mt-0.5">Compare two companies on valuation, growth, debt, earnings, and returns.</p>
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-300 mb-4">
          <Search className="w-4 h-4 text-primary" /> Choose two stocks
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto] gap-3 items-center">
          <input value={first} onChange={(event) => setFirst(event.target.value.toUpperCase())} placeholder="AAPL" maxLength={12} className="h-11 rounded-xl border border-border bg-background px-4 text-sm font-bold text-white outline-none focus:border-primary" />
          <span className="text-center text-xs font-bold text-gray-600">VS</span>
          <input value={second} onChange={(event) => setSecond(event.target.value.toUpperCase())} placeholder="MSFT" maxLength={12} className="h-11 rounded-xl border border-border bg-background px-4 text-sm font-bold text-white outline-none focus:border-primary" />
          <button onClick={compare} disabled={loading} className="h-11 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 inline-flex items-center justify-center gap-2">
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
            Compare
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-3">Use US ticker symbols such as AAPL, MSFT, NVDA, or TSLA. Metrics are supplied by Finnhub.</p>
        {error && <p className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      </section>

      {companies.length === 0 && !loading && !error && (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-14 text-center">
          <BarChart3 className="w-8 h-8 text-gray-700 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-400">Enter two symbols to begin comparing.</p>
        </div>
      )}

      {companies.length === 2 && left && right && (
        <section className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
          <div className="grid grid-cols-[1fr_130px_1fr] sm:grid-cols-[1fr_170px_1fr] border-b border-border bg-muted/20">
            {[left, right].map((company, index) => (
              <div key={company.symbol} className={`p-5 ${index === 0 ? '' : 'col-start-3'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black text-white">{company.symbol}</span>
                  <ArrowUpRight className="w-4 h-4 text-primary" />
                </div>
                <p className="text-xs text-gray-400 mt-1 truncate">{company.name}</p>
                <p className="text-xs text-gray-600 mt-1">{company.sector || 'Sector unavailable'}</p>
                <p className="mt-4 text-xl font-bold text-white">{number(company.price, (value) => `$${value.toFixed(2)}`)}</p>
                <p className={`text-xs font-semibold mt-1 ${(company.dayReturn ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{number(company.dayReturn, (value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}% today`)}</p>
              </div>
            ))}
            <div className="col-start-2 row-start-1 flex items-center justify-center text-xs font-black text-gray-600">VS</div>
          </div>

          <div className="divide-y divide-border/70">
            {metrics.map((metric) => {
              const leftValue = left[metric.key] as number | null;
              const rightValue = right[metric.key] as number | null;
              return (
                <div key={metric.key} className="grid grid-cols-[1fr_130px_1fr] sm:grid-cols-[1fr_170px_1fr] items-center">
                  <MetricValue value={leftValue} other={rightValue} metric={metric} />
                  <p className="px-2 py-4 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500 leading-tight">{metric.label}</p>
                  <MetricValue value={rightValue} other={leftValue} metric={metric} right />
                </div>
              );
            })}
          </div>
          <p className="px-5 py-3 text-[11px] text-gray-600 border-t border-border">Green highlights the higher value for growth, EPS, market cap, and returns; and the lower value for P/E and debt-to-equity. Metrics should be used for research, not investment advice.</p>
        </section>
      )}
    </div>
  );
}

function MetricValue({ value, other, metric, right = false }: { value: number | null; other: number | null; metric: (typeof metrics)[number]; right?: boolean }) {
  const winner = isWinner(value, other, metric.better);
  return <p className={`px-5 py-4 text-sm font-bold ${right ? 'text-right' : ''} ${winner ? 'text-emerald-400' : 'text-gray-200'}`}>{number(value, metric.format)}</p>;
}
