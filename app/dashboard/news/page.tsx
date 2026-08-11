'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Newspaper, ExternalLink, Clock, ChevronDown, ChevronUp,
  Zap, BriefcaseBusiness, Brain,
} from 'lucide-react';

/* ── types ─────────────────────────────────────────────────────────────── */
type NewsItem = {
  headline: string;
  description?: string | null;
  sentiment: string;
  sentimentReview?: string | null;
  impact: string;
  time: string;
  source: string;
  url: string | null;
  imageUrl?: string | null;
};

type Holding = { sym: string; name: string };
type MarketStock = { sym: string; chg: number };

/* ── constants ─────────────────────────────────────────────────────────── */
const SENTIMENT_STYLES: Record<string, { bg: string; text: string; border: string; icon: string }> = {
  bullish: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', icon: '↑' },
  bearish: { bg: 'bg-red-500/10',     text: 'text-red-400',     border: 'border-red-500/20',     icon: '↓' },
  neutral: { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/20',   icon: '→' },
};

const IMPACT_COLORS: Record<string, string> = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };

function eventLabel(item: NewsItem) {
  const text = `${item.headline} ${item.description || ''}`.toLowerCase();
  if (/earnings|quarterly|revenue|profit|results/.test(text)) return 'Earnings';
  if (/fed|rbi|interest rate|inflation|bond yield/.test(text)) return 'Market';
  if (/technology|banking|pharma|energy|oil|chip/.test(text)) return 'Sector';
  return 'General';
}

function relatedHoldings(item: NewsItem, holdings: Holding[]) {
  const text = `${item.headline} ${item.description || ''}`.toLowerCase();
  return holdings.filter((holding) => {
    const symbol = holding.sym.toLowerCase();
    const name = holding.name.toLowerCase();
    return text.includes(symbol) || (name.length > 3 && text.includes(name));
  });
}

/* ── page ──────────────────────────────────────────────────────────────── */
export default function NewsPage() {
  const [news, setNews]         = useState<NewsItem[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [market, setMarket] = useState<MarketStock[]>([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/news/realtime?count=50', { cache: 'no-store' }),
      fetch('/api/portfolio', { cache: 'no-store' }),
      fetch('/api/market/stocks?liveOnly=1', { cache: 'no-store' }),
    ])
      .then(async ([newsRes, portfolioRes, marketRes]) => ({
        news: await newsRes.json().catch(() => ({})),
        portfolio: await portfolioRes.json().catch(() => ({})),
        market: await marketRes.json().catch(() => ({})),
      }))
      .then((d) => {
        if (!alive) return;
        if (Array.isArray(d.news?.news)) setNews(d.news.news);
        if (Array.isArray(d.portfolio?.holdings)) setHoldings(d.portfolio.holdings);
        if (Array.isArray(d.market?.stocks)) setMarket(d.market.stocks);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { alive = false; };
  }, []);

  const portfolioNews = useMemo(() => news
    .map((item) => ({ item, holdings: relatedHoldings(item, holdings) }))
    .filter((row) => row.holdings.length > 0), [news, holdings]);

  const marketBySymbol = useMemo(() => new Map(market.map((stock) => [stock.sym, stock])), [market]);

  return (
    <>
      {/* header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="p-2 rounded-xl bg-muted border border-border text-gray-400 hover:text-white transition-all">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">News &amp; Sentiment</h1>
          <p className="text-xs text-gray-500 mt-0.5">{news.length} articles from live feed</p>
        </div>
      </div>

      {!loading && holdings.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="flex items-center gap-2 text-base font-bold text-white"><BriefcaseBusiness className="w-4 h-4 text-primary" /> News affecting your portfolio</h2>
              <p className="mt-1 text-xs text-gray-500">Recent articles that mention stocks you currently hold.</p>
            </div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">{portfolioNews.length} matches</span>
          </div>
          {portfolioNews.length === 0 ? <p className="rounded-xl bg-muted/30 p-4 text-sm text-gray-500">No current feed articles mention your holdings. Your full market feed is below.</p> : <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{portfolioNews.slice(0, 4).map(({ item, holdings: matched }, index) => <PortfolioNewsCard key={`${item.headline}-${index}`} item={item} holdings={matched} marketBySymbol={marketBySymbol} />)}</div>}
        </section>
      )}

      {/* articles grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-48 rounded-2xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      ) : news.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-14 text-center">
          <Newspaper className="w-8 h-8 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No news available</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {news.map((n, i) => (
            <NewsFullCard
              key={i}
              item={n}
              index={i}
              isExpanded={expanded === i}
              onToggle={() => setExpanded(expanded === i ? null : i)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function PortfolioNewsCard({ item, holdings, marketBySymbol }: { item: NewsItem; holdings: Holding[]; marketBySymbol: Map<string, MarketStock> }) {
  const prompt = `Why does this news matter to my portfolio? Article: ${item.headline}. ${item.description || ''} My related holdings: ${holdings.map((holding) => holding.sym).join(', ')}. Explain the possible impact in simple language without giving buy or sell instructions.`;
  return <div className="rounded-xl border border-border bg-muted/20 p-4">
    <div className="mb-2 flex items-center gap-2"><span className="rounded-md bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">{eventLabel(item)}</span><span className="text-[10px] text-gray-500">{item.time}</span></div>
    <p className="text-sm font-semibold leading-snug text-gray-100">{item.headline}</p>
    <div className="mt-3 flex flex-wrap items-center gap-2">{holdings.map((holding) => { const change = marketBySymbol.get(holding.sym)?.chg; return <span key={holding.sym} className="rounded-md border border-border bg-card px-2 py-1 text-xs font-bold text-white">{holding.sym} {change != null && Number.isFinite(change) ? <span className={change >= 0 ? 'text-emerald-400' : 'text-red-400'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</span> : null}</span>; })}</div>
    <Link href={`/dashboard/ai?prompt=${encodeURIComponent(prompt.slice(0, 1200))}`} className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:text-primary/80"><Brain className="w-3.5 h-3.5" /> Why this matters</Link>
  </div>;
}

/* ── news full card ───────────────────────────────────────────────────── */
function NewsFullCard({
  item,
  index,
  isExpanded,
  onToggle,
}: {
  item: NewsItem;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const s = SENTIMENT_STYLES[item.sentiment] ?? SENTIMENT_STYLES.neutral;
  const impactColor = IMPACT_COLORS[item.impact] ?? '#6b7280';

  return (
    <div
      className={`group rounded-2xl border bg-card transition-all duration-200 overflow-hidden
        ${isExpanded ? 'border-border ring-1 ring-[#2a2a3e]/50' : 'border-border hover:border-border'}`}
    >
      {/* accent strip */}
      <div className="h-0.75" style={{ background: `linear-gradient(90deg, ${impactColor}80, ${impactColor}20, transparent)` }} />

      {/* main content */}
      <div className="p-5">
        {/* badges row */}
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border ${s.bg} ${s.text} ${s.border}`}>
            {s.icon} {item.sentiment}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border border-border bg-muted text-gray-400">{eventLabel(item)}</span>
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border"
            style={{
              color: impactColor,
              borderColor: impactColor + '30',
              background: impactColor + '10',
            }}
          >
            <Zap className="w-2.5 h-2.5 inline -mt-0.5 mr-0.5" />
            {item.impact}
          </span>
          <span className="text-[10px] text-gray-600 ml-auto flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {item.time}
          </span>
        </div>

        {/* headline */}
        <h3 className="text-[15px] font-semibold text-gray-100 leading-snug mb-2 group-hover:text-white transition-colors">
          {item.headline}
        </h3>

        {/* source */}
        <p className="text-[11px] text-gray-500 font-medium mb-3">{item.source}</p>

        {/* sentiment review */}
        {item.sentimentReview ? (
          <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
            {item.sentimentReview}
          </p>
        ) : null}

        {/* expand / collapse */}
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 text-[11px] font-medium text-[#10b981] hover:text-[#34d399] transition-colors"
        >
          {isExpanded ? (
            <>Hide details <ChevronUp className="w-3 h-3" /></>
          ) : (
            <>Show details <ChevronDown className="w-3 h-3" /></>
          )}
        </button>
      </div>

      {/* expanded section */}
      {isExpanded && (
        <div className="border-t border-border bg-[#0a0a14] px-5 py-4 space-y-3">
          {item.description ? (
            <p className="text-sm text-gray-400 leading-relaxed">{item.description}</p>
          ) : (
            <p className="text-sm text-gray-600 italic">No description available from the source.</p>
          )}

          <div className="flex items-center gap-4 pt-1">
            <span className="text-xs text-gray-500">
              Source: <span className="text-gray-400 font-medium">{item.source}</span>
            </span>
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#10b981] hover:text-[#34d399] transition-colors px-3 py-1.5 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20 hover:border-[#10b981]/40"
              >
                Read full article <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
