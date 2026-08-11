'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  PieChart,
  Activity,
  Receipt,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';

type MarketStock = {
  sym: string;
  name: string;
  sector: string;
  price: number;
  chg: number;
  live: boolean;
};

type Holding = {
  sym: string;
  name: string;
  sector: string | null;
  quantity: number;
  avgPrice: number;
  costBasis: number;
  updatedAt: string;
};

type Txn = {
  id: number;
  sym: string;
  name: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  totalValue: number;
  realizedPnl: number;
  createdAt: string;
};

type PortfolioResponse = {
  walletBalance: number;
  holdings: Holding[];
  transactions: Txn[];
  summary: {
    positions: number;
    totalInvested: number;
    realizedPnl: number;
  };
};

function money(v: number) {
  return `₹${Number(v || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function qty(v: number) {
  return Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 });
}

function fmtDate(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PortfolioPage() {
  const [marketUniverse, setMarketUniverse] = useState<MarketStock[]>([]);
  const [liveMarket, setLiveMarket] = useState<MarketStock[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [selectedSym, setSelectedSym] = useState('');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [quantity, setQuantity] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [portfolioRes, marketUniverseRes, liveMarketRes] = await Promise.all([
        fetch('/api/portfolio', { cache: 'no-store' }),
        fetch('/api/market/stocks', { cache: 'no-store' }),
        fetch('/api/market/stocks?liveOnly=1', { cache: 'no-store' }),
      ]);

      const portfolioData = await portfolioRes.json().catch(() => ({}));
      const marketUniverseData = await marketUniverseRes.json().catch(() => ({}));
      const liveMarketData = await liveMarketRes.json().catch(() => ({}));

      if (!portfolioRes.ok) {
        throw new Error(typeof portfolioData?.error === 'string' ? portfolioData.error : 'Failed to load portfolio');
      }

      setPortfolio(portfolioData as PortfolioResponse);
      const universe = Array.isArray(marketUniverseData?.stocks) ? marketUniverseData.stocks : [];
      const live = Array.isArray(liveMarketData?.stocks) ? liveMarketData.stocks : [];
      setMarketUniverse(universe);
      setLiveMarket(live);

      const hasSelectedInUniverse = universe.some((s: MarketStock) => s.sym === selectedSym);
      if ((!selectedSym || !hasSelectedInUniverse) && universe[0]?.sym) {
        setSelectedSym(universe[0].sym);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load portfolio');
    } finally {
      setLoading(false);
    }
  }, [selectedSym]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const marketBySym = useMemo(() => {
    const map = new Map<string, MarketStock>();
    liveMarket.forEach((s) => map.set(s.sym, s));
    return map;
  }, [liveMarket]);

  const enrichedHoldings = useMemo(() => {
    const raw = portfolio?.holdings || [];
    return raw.map((h) => {
      const quote = marketBySym.get(h.sym);
      const hasLivePrice = quote && Number.isFinite(Number(quote.price)) && Number(quote.price) > 0;
      const currentPrice = hasLivePrice ? Number(quote?.price) : null;
      const marketValue = currentPrice != null ? currentPrice * h.quantity : null;
      const unrealizedPnl = marketValue != null ? marketValue - h.costBasis : null;
      const pnlPct = h.costBasis > 0 && unrealizedPnl != null ? (unrealizedPnl / h.costBasis) * 100 : null;
      return {
        ...h,
        hasLivePrice,
        currentPrice,
        marketValue,
        unrealizedPnl,
        pnlPct,
      };
    });
  }, [portfolio?.holdings, marketBySym]);

  const summary = useMemo(() => {
    const totalMarketValue = enrichedHoldings.reduce((sum, h) => sum + (h.marketValue ?? 0), 0);
    const totalCostBasis = enrichedHoldings.reduce((sum, h) => sum + h.costBasis, 0);
    const totalUnrealized = enrichedHoldings.reduce((sum, h) => sum + (h.unrealizedPnl ?? 0), 0);
    const totalUnrealizedPct = totalCostBasis > 0 ? (totalUnrealized / totalCostBasis) * 100 : 0;
    return {
      walletBalance: Number(portfolio?.walletBalance || 0),
      totalMarketValue,
      totalCostBasis,
      totalUnrealized,
      totalUnrealizedPct,
      realizedPnl: Number(portfolio?.summary?.realizedPnl || 0),
      positions: Number(portfolio?.summary?.positions || 0),
    };
  }, [portfolio, enrichedHoldings]);

  const selectedStock = useMemo(
    () => marketUniverse.find((s) => s.sym === selectedSym) || null,
    [marketUniverse, selectedSym]
  );

  const selectedLiveQuote = useMemo(
    () => marketBySym.get(selectedSym) || null,
    [marketBySym, selectedSym]
  );

  const tradePreview = useMemo(() => {
    const q = Number(quantity);
    const price = Number(selectedLiveQuote?.price || 0);
    const total = Number.isFinite(q) && q > 0 ? q * price : 0;
    return {
      q,
      price,
      total,
    };
  }, [quantity, selectedLiveQuote]);

  const submitTrade = useCallback(async () => {
    setError('');
    setSuccess('');

    if (!selectedStock) {
      setError('Please select a stock');
      return;
    }
    if (!selectedLiveQuote || !Number.isFinite(Number(selectedLiveQuote.price)) || Number(selectedLiveQuote.price) <= 0) {
      setError('Live price unavailable for selected stock');
      return;
    }

    const q = Number(quantity);
    if (!Number.isFinite(q) || q <= 0) {
      setError('Enter a valid quantity');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-idempotency-key': idempotencyKey
        },
        body: JSON.stringify({
          side,
          sym: selectedStock.sym,
          name: selectedStock.name,
          sector: selectedStock.sector,
          quantity: q,
          price: selectedLiveQuote.price,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Trade failed');
      }

      setSuccess(`${side === 'BUY' ? 'Bought' : 'Sold'} ${q} ${selectedStock.sym}`);
      setQuantity('');
      setIdempotencyKey(crypto.randomUUID());
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Trade failed');
    } finally {
      setSubmitting(false);
    }
  }, [selectedStock, selectedLiveQuote, quantity, side, loadData]);

  const allocation = useMemo(() => {
    const total = summary.totalMarketValue;
    if (total <= 0) return [] as Array<{ sym: string; pct: number; value: number }>;
    return enrichedHoldings
      .filter((h) => h.marketValue != null)
      .map((h) => ({
        sym: h.sym,
        pct: ((h.marketValue ?? 0) / total) * 100,
        value: h.marketValue ?? 0,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [enrichedHoldings, summary.totalMarketValue]);

  const portfolioHealth = useMemo(() => {
    const pricedHoldings = enrichedHoldings.filter((holding) => holding.marketValue != null);
    const sectors = new Map<string, number>();

    pricedHoldings.forEach((holding) => {
      const sector = holding.sector || 'Other';
      sectors.set(sector, (sectors.get(sector) || 0) + (holding.marketValue || 0));
    });

    const sectorAllocation = Array.from(sectors, ([name, value]) => ({
      name,
      value,
      pct: summary.totalMarketValue > 0 ? (value / summary.totalMarketValue) * 100 : 0,
    })).sort((a, b) => b.value - a.value);

    const byPerformance = pricedHoldings
      .filter((holding) => holding.pnlPct != null)
      .slice()
      .sort((a, b) => (b.pnlPct || 0) - (a.pnlPct || 0));

    const totalValue = summary.walletBalance + summary.totalMarketValue;
    return {
      totalValue,
      cashPct: totalValue > 0 ? (summary.walletBalance / totalValue) * 100 : 0,
      largestPosition: allocation[0] || null,
      sectorAllocation,
      bestPerformer: byPerformance[0] || null,
      worstPerformer: byPerformance.length > 1 ? byPerformance[byPerformance.length - 1] : null,
    };
  }, [allocation, enrichedHoldings, summary]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="p-2 rounded-xl bg-muted border border-border text-gray-400 hover:text-white transition-all">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Portfolio Command Center</h1>
          <p className="text-xs text-gray-500 mt-0.5">Buy, sell, monitor and rebalance your positions live.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-gray-300 hover:text-white disabled:opacity-50 inline-flex items-center gap-2 transition-all shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-[#ef4444] bg-[#ef4444]/10 border border-[#ef4444]/30 p-3 rounded-xl">{error}</p>}
      {success && <p className="text-sm text-[#10b981] bg-[#10b981]/10 border border-[#10b981]/30 p-3 rounded-xl">{success}</p>}

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard icon={<Wallet className="w-5 h-5 text-[#22c55e]" />} title="Wallet Cash" value={money(summary.walletBalance)} sub="Available to trade" />
        <MetricCard icon={<PieChart className="w-5 h-5 text-[#38bdf8]" />} title="Portfolio Value" value={money(summary.totalMarketValue)} sub={`${summary.positions} open positions`} />
        <MetricCard
          icon={<Activity className="w-5 h-5 text-[#f59e0b]" />}
          title="Unrealized P&L"
          value={money(summary.totalUnrealized)}
          sub={`${summary.totalUnrealizedPct >= 0 ? '+' : ''}${summary.totalUnrealizedPct.toFixed(2)}% vs cost`}
          positive={summary.totalUnrealized >= 0}
        />
        <MetricCard
          icon={<Receipt className="w-5 h-5 text-[#a78bfa]" />}
          title="Realized P&L"
          value={money(summary.realizedPnl)}
          sub="From closed units"
          positive={summary.realizedPnl >= 0}
        />
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="text-base font-bold text-white">Portfolio Health</h2>
            <p className="mt-1 text-xs text-gray-500">A quick view of your value, diversification and position risk.</p>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{money(portfolioHealth.totalValue)} total value</span>
        </div>

        {enrichedHoldings.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-5 text-sm text-gray-500">Buy a stock to see allocation, performance and diversification insights here.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Quick insights</p>
              <p className="text-sm text-gray-300">Cash available: <strong className="text-white">{portfolioHealth.cashPct.toFixed(1)}%</strong> of your portfolio.</p>
              <p className="text-sm text-gray-300">Diversified across <strong className="text-white">{portfolioHealth.sectorAllocation.length}</strong> sector{portfolioHealth.sectorAllocation.length === 1 ? '' : 's'}.</p>
              {portfolioHealth.largestPosition && (
                <p className="text-sm text-gray-300">Largest position: <strong className="text-white">{portfolioHealth.largestPosition.sym}</strong> at <strong className={portfolioHealth.largestPosition.pct > 40 ? 'text-amber-400' : 'text-white'}>{portfolioHealth.largestPosition.pct.toFixed(1)}%</strong>.</p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Performance</p>
              {portfolioHealth.bestPerformer ? <p className="text-sm text-gray-300">Best: <strong className="text-[#10b981]">{portfolioHealth.bestPerformer.sym} {portfolioHealth.bestPerformer.pnlPct! >= 0 ? '+' : ''}{portfolioHealth.bestPerformer.pnlPct!.toFixed(2)}%</strong></p> : <p className="text-sm text-gray-500">Waiting for live prices.</p>}
              {portfolioHealth.worstPerformer ? <p className="text-sm text-gray-300">Needs attention: <strong className="text-[#ef4444]">{portfolioHealth.worstPerformer.sym} {portfolioHealth.worstPerformer.pnlPct! >= 0 ? '+' : ''}{portfolioHealth.worstPerformer.pnlPct!.toFixed(2)}%</strong></p> : <p className="text-sm text-gray-500">Add another priced holding to compare performance.</p>}
              <p className="text-xs text-gray-500">Performance is based on live price versus your average cost.</p>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Sector mix</p>
              {portfolioHealth.sectorAllocation.length === 0 ? <p className="text-sm text-gray-500">Waiting for live prices.</p> : <div className="space-y-3">{portfolioHealth.sectorAllocation.slice(0, 4).map((sector) => <div key={sector.name}><div className="mb-1 flex justify-between text-xs"><span className="text-gray-300">{sector.name}</span><span className="font-bold text-white">{sector.pct.toFixed(1)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-[#38bdf8]" style={{ width: `${Math.max(3, Math.min(100, sector.pct))}%` }} /></div></div>)}</div>}
            </div>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* LEFT COLUMN */}
        <div className="xl:col-span-8 space-y-6">
          
          {/* Open Holdings */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/20">
              <h2 className="text-base font-bold text-white">Open Holdings</h2>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-muted text-gray-400">{enrichedHoldings.length} positions</span>
            </div>

            {loading ? (
              <div className="p-8 text-center text-sm text-gray-400">Loading holdings...</div>
            ) : enrichedHoldings.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">No holdings yet. Start by buying your first stock.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="text-xs text-gray-400 uppercase tracking-wider bg-muted/10">
                    <tr>
                      <th className="text-left px-5 py-4 font-semibold">Symbol</th>
                      <th className="text-right px-5 py-4 font-semibold">Qty</th>
                      <th className="text-right px-5 py-4 font-semibold">Avg Cost</th>
                      <th className="text-right px-5 py-4 font-semibold">LTP</th>
                      <th className="text-right px-5 py-4 font-semibold">Market Value</th>
                      <th className="text-right px-5 py-4 font-semibold">Unrealized</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {enrichedHoldings.map((h) => {
                      const up = (h.unrealizedPnl ?? 0) >= 0;
                      return (
                        <tr key={h.sym} className="hover:bg-muted/10 transition-colors">
                          <td className="px-5 py-4">
                            <div className="font-bold text-white text-base">{h.sym}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{h.name}</div>
                          </td>
                          <td className="px-5 py-4 text-right font-medium text-gray-200">{qty(h.quantity)}</td>
                          <td className="px-5 py-4 text-right text-gray-300">{money(h.avgPrice)}</td>
                          <td className="px-5 py-4 text-right font-medium text-white">{h.currentPrice != null ? money(h.currentPrice) : '—'}</td>
                          <td className="px-5 py-4 text-right font-medium text-white">{h.marketValue != null ? money(h.marketValue) : '—'}</td>
                          <td className="px-5 py-4 text-right">
                            {h.unrealizedPnl != null ? (
                              <div className={`inline-flex flex-col items-end ${up ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
                                <span className="font-bold">{up ? '+' : ''}{money(h.unrealizedPnl)}</span>
                                <span className="text-xs opacity-80 font-medium">({(h.pnlPct ?? 0) >= 0 ? '+' : ''}{(h.pnlPct ?? 0).toFixed(2)}%)</span>
                              </div>
                            ) : (
                              <span className="text-gray-500 font-normal">N/A</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent Transactions */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/20">
              <h2 className="text-base font-bold text-white">Recent Transactions</h2>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-muted text-gray-400">Last 100</span>
            </div>

            {!portfolio || portfolio.transactions.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">No transactions yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead className="text-xs text-gray-400 uppercase tracking-wider bg-muted/10">
                    <tr>
                      <th className="text-left px-5 py-4 font-semibold">Time</th>
                      <th className="text-left px-5 py-4 font-semibold">Stock</th>
                      <th className="text-center px-5 py-4 font-semibold">Side</th>
                      <th className="text-right px-5 py-4 font-semibold">Qty</th>
                      <th className="text-right px-5 py-4 font-semibold">Price</th>
                      <th className="text-right px-5 py-4 font-semibold">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {portfolio.transactions.slice(0, 5).map((t) => {
                      return (
                        <tr key={t.id} className="hover:bg-muted/10 transition-colors">
                          <td className="px-5 py-4 text-xs text-gray-400 whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                          <td className="px-5 py-4 font-bold text-white">{t.sym}</td>
                          <td className="px-5 py-4 text-center">
                            <span
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider ${
                                t.side === 'BUY'
                                  ? 'bg-[#10b981]/10 text-[#10b981]'
                                  : 'bg-[#ef4444]/10 text-[#ef4444]'
                              }`}
                            >
                              {t.side === 'BUY' ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                              {t.side}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right font-medium text-gray-200">{qty(t.quantity)}</td>
                          <td className="px-5 py-4 text-right text-gray-300">{money(t.price)}</td>
                          <td className="px-5 py-4 text-right font-medium text-white">{money(t.totalValue)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {portfolio && portfolio.transactions.length > 5 && (
              <div className="px-5 py-3 border-t border-border bg-muted/5 flex items-center justify-between">
                <span className="text-xs text-gray-400">Showing 5 of {portfolio.transactions.length}</span>
                <Link
                  href="/dashboard/transactions"
                  className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  View All Transactions →
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="xl:col-span-4 space-y-6">
          
          {/* Trade Ticket */}
          <div className="rounded-2xl border border-primary/20 bg-linear-to-b from-card to-background p-5 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
              <TrendingUp className="w-24 h-24" />
            </div>
            
            <div className="flex items-center justify-between mb-5 relative z-10">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Trade Ticket
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5 relative z-10">
              <button
                onClick={() => setSide('BUY')}
                className={`h-11 rounded-xl text-sm font-bold border-2 transition-all ${
                  side === 'BUY'
                    ? 'bg-[#10b981]/10 border-[#10b981] text-[#10b981] shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                    : 'bg-card border-border text-gray-400 hover:border-gray-500'
                }`}
              >
                Buy Order
              </button>
              <button
                onClick={() => setSide('SELL')}
                className={`h-11 rounded-xl text-sm font-bold border-2 transition-all ${
                  side === 'SELL'
                    ? 'bg-[#ef4444]/10 border-[#ef4444] text-[#ef4444] shadow-[0_0_15px_rgba(239,68,68,0.1)]'
                    : 'bg-card border-border text-gray-400 hover:border-gray-500'
                }`}
              >
                Sell Order
              </button>
            </div>

            <div className="space-y-4 relative z-10">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Select Asset</label>
                <select
                  value={selectedSym}
                  onChange={(e) => setSelectedSym(e.target.value)}
                  className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm font-medium text-white outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                >
                  {marketUniverse.map((s) => (
                    <option key={s.sym} value={s.sym}>
                      {s.sym} · {s.name}
                    </option>
                  ))}
                </select>
                {marketUniverse.length === 0 && (
                  <p className="text-[11px] text-[#ef4444] mt-1.5 font-medium">No stocks available to trade.</p>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Quantity</label>
                <div className="relative">
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="0.00"
                    className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm font-medium text-white outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs font-medium">Units</span>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400 font-medium">Live Market Price</span>
                  <span className="text-sm font-bold text-white">{tradePreview.price > 0 ? money(tradePreview.price) : 'Unavailable'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400 font-medium">Estimated Order Value</span>
                  <span className="text-sm font-bold text-primary">{tradePreview.total > 0 ? money(tradePreview.total) : '—'}</span>
                </div>
                <div className="w-full h-px bg-border my-1" />
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400 font-medium">Projected Wallet Balance</span>
                  <span className="text-sm font-bold text-white">
                    {money(
                      side === 'BUY'
                        ? summary.walletBalance - tradePreview.total
                        : summary.walletBalance + tradePreview.total
                    )}
                  </span>
                </div>
              </div>

              <button
                onClick={submitTrade}
                disabled={submitting || loading || !selectedStock || !selectedLiveQuote || tradePreview.price <= 0}
                className={`w-full h-12 rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md ${
                  side === 'BUY'
                    ? 'bg-[#10b981] text-white hover:bg-[#059669]'
                    : 'bg-[#ef4444] text-white hover:bg-[#dc2626]'
                }`}
              >
                {submitting ? 'Processing...' : `Confirm ${side} Order`}
              </button>
            </div>
          </div>

          {/* Top Allocation */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <PieChart className="w-5 h-5 text-primary" />
              <h3 className="text-base font-bold text-white">Portfolio Allocation</h3>
            </div>

            {allocation.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">Your portfolio is currently empty.</p>
            ) : (
              <div className="space-y-4">
                {allocation.map((a) => (
                  <div key={a.sym}>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="font-semibold text-gray-200">{a.sym}</span>
                      <span className="font-bold text-white">{a.pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(2, Math.min(100, a.pct))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  title,
  value,
  sub,
  positive,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  sub: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-500 uppercase tracking-wider">{title}</div>
        {icon}
      </div>
      <div className={`text-xl font-bold tabular-nums ${positive == null ? 'text-white' : positive ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
        {value}
      </div>
      <div className="text-xs text-gray-500 mt-1">{sub}</div>
    </div>
  );
}
