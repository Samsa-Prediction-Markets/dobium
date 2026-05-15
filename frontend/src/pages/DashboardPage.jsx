import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';
import { useMarkets } from '../hooks/useMarkets';
import { useWallet } from '../hooks/useWallet';

// ============================================================================
// Robinhood-style dual-canvas equity chart
// Base canvas:    bezier curve + gradient fill  (redraws only when data changes)
// Overlay canvas: pulsing live dot + crosshair  (requestAnimationFrame, 60fps)
// ============================================================================
function EquityChart({ equityPoints, startingBalance, currentValue }) {
  const baseRef    = useRef(null);
  const overlayRef = useRef(null);
  const hoverRef   = useRef(null);   // shared between RAF loop and mouse handler
  const animRef    = useRef(null);
  const scaleRef   = useRef(null);   // cached scale data so RAF doesn't recompute
  const [tooltip, setTooltip] = useState(null);

  const isProfit  = currentValue >= startingBalance;
  const lineColor = isProfit ? '#22c55e' : '#ef4444';
  const colorRgb  = isProfit ? '34,197,94' : '239,68,68';
  const PAD       = { t: 20, r: 8, b: 8, l: 8 };

  // ── Compute pixel coordinates from data ──────────────────────────────────
  const computeScale = useCallback((w, h) => {
    if (!equityPoints || equityPoints.length < 2) return null;
    const gw = w - PAD.l - PAD.r;
    const gh = h - PAD.t - PAD.b;
    const vals     = equityPoints.map(p => p.value);
    const allVals  = [startingBalance, ...vals];
    const dataMin  = Math.min(...allVals);
    const dataMax  = Math.max(...allVals);
    const pad      = Math.max((dataMax - dataMin) * 0.15, 50);
    const min      = dataMin - pad;
    const max      = dataMax + pad;
    const range    = max - min || 1;
    const xs       = equityPoints.map((_, i) => PAD.l + (i / (equityPoints.length - 1)) * gw);
    const ys       = equityPoints.map(p  => PAD.t + (1 - (p.value - min) / range) * gh);
    const baselineY = PAD.t + (1 - (startingBalance - min) / range) * gh;
    return { xs, ys, baselineY, w, h, gw, gh };
  }, [equityPoints, startingBalance, PAD.l, PAD.r, PAD.t, PAD.b]);

  // ── Draw bezier line + gradient fill on base canvas ──────────────────────
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || !equityPoints || equityPoints.length < 2) return;

    const rect = canvas.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const scale = computeScale(W, H);
    if (!scale) return;
    scaleRef.current = scale;   // cache for RAF loop

    const { xs, ys, baselineY } = scale;
    ctx.clearRect(0, 0, W, H);

    // Dashed baseline at starting balance
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth   = 1;
    ctx.globalAlpha = 0.5;
    ctx.moveTo(0, baselineY);
    ctx.lineTo(W, baselineY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // ── Bezier path (Robinhood S-curve) ─────────────────────────────────────
    // Both control points share the midpoint x — one anchored to prev y,
    // one to next y. Produces the characteristic smooth but data-faithful curve.
    const buildPath = (ctx) => {
      ctx.moveTo(xs[0], ys[0]);
      for (let i = 1; i < xs.length; i++) {
        const cpx = (xs[i - 1] + xs[i]) / 2;
        ctx.bezierCurveTo(cpx, ys[i - 1], cpx, ys[i], xs[i], ys[i]);
      }
    };

    // Gradient fill below the curve
    const grad = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b);
    grad.addColorStop(0, `rgba(${colorRgb}, 0.22)`);
    grad.addColorStop(1, `rgba(${colorRgb}, 0)`);
    ctx.beginPath();
    buildPath(ctx);
    ctx.lineTo(xs[xs.length - 1], H - PAD.b);
    ctx.lineTo(xs[0], H - PAD.b);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Stroke the curve on top
    ctx.beginPath();
    buildPath(ctx);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.stroke();
  }, [equityPoints, startingBalance, lineColor, colorRgb, computeScale]);

  // ── Overlay: pulsing dot + crosshair at 60fps ─────────────────────────────
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    let phase = 0;

    const frame = () => {
      const rect = overlay.getBoundingClientRect();
      const dpr  = window.devicePixelRatio || 1;
      overlay.width  = rect.width  * dpr;
      overlay.height = rect.height * dpr;
      const ctx = overlay.getContext('2d');
      ctx.scale(dpr, dpr);

      const W = rect.width;
      const H = rect.height;
      ctx.clearRect(0, 0, W, H);

      // Re-compute scale if not cached yet
      const scale = scaleRef.current || computeScale(W, H);
      if (!scale) { animRef.current = requestAnimationFrame(frame); return; }

      const { xs, ys } = scale;
      const lastX = xs[xs.length - 1];
      const lastY = ys[ys.length - 1];
      const hover  = hoverRef.current;

      if (!hover) {
        // ── Pulsing live dot ──────────────────────────────────────────────
        phase += 0.04;
        const pulse  = (Math.sin(phase) + 1) / 2;          // 0 → 1
        const ring   = 7 + pulse * 9;                       // 7px → 16px
        const alpha  = 0.45 * (1 - pulse);                  // fades as ring grows
        ctx.beginPath();
        ctx.arc(lastX, lastY, ring, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colorRgb}, ${alpha})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
        ctx.fillStyle   = lineColor;
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth   = 2;
        ctx.stroke();
      } else {
        // ── Crosshair ─────────────────────────────────────────────────────
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth   = 1;
        ctx.globalAlpha = 0.6;
        ctx.moveTo(hover.x, PAD.t);
        ctx.lineTo(hover.x, H - PAD.b);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        // Dot on the line
        ctx.beginPath();
        ctx.arc(hover.x, hover.y, 5, 0, Math.PI * 2);
        ctx.fillStyle   = lineColor;
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth   = 2;
        ctx.stroke();
      }

      animRef.current = requestAnimationFrame(frame);
    };

    animRef.current = requestAnimationFrame(frame);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [equityPoints, lineColor, colorRgb, computeScale]);

  // ── Mouse interaction ─────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e) => {
    const overlay = overlayRef.current;
    if (!overlay || !equityPoints || !scaleRef.current) return;
    const rect   = overlay.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const { xs, ys } = scaleRef.current;
    const idx  = Math.max(0, Math.min(Math.round(xRatio * (xs.length - 1)), xs.length - 1));
    const data = { x: xs[idx], y: ys[idx], value: equityPoints[idx].value, date: equityPoints[idx].date, pct: xs[idx] / rect.width };
    hoverRef.current = data;
    setTooltip(data);
  }, [equityPoints]);

  const handleMouseLeave = useCallback(() => {
    hoverRef.current = null;
    setTooltip(null);
  }, []);

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!equityPoints || equityPoints.length < 2) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-slate-600 text-sm">Make your first prediction to see your equity chart</p>
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-full"
      onMouseLeave={handleMouseLeave}
      style={{ position: 'relative' }}
    >
      {/* Base canvas — chart line drawn once per data change */}
      <canvas
        ref={baseRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      />
      {/* Overlay canvas — crosshair + pulsing dot at 60fps */}
      <canvas
        ref={overlayRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
      />
      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="absolute top-2 pointer-events-none px-3 py-1.5 bg-slate-800/90 border border-slate-700 rounded-lg text-xs z-10"
          style={{ left: `${Math.min(Math.max(tooltip.pct * 100, 5), 72)}%` }}
        >
          <p className="text-white font-semibold">
            ${tooltip.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-slate-400">
            {new Date(tooltip.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { markets } = useMarkets();
  const { balance: buyingPower, wallet, loading: walletLoading, refetch: refetchWallet } = useWallet();
  const [selectedRange, setSelectedRange] = useState('1D');
  const [activeFilter, setActiveFilter] = useState('all');
  const [predictions, setPredictions] = useState([]);
  const [allPredictions, setAllPredictions] = useState([]);
  const [sellingKey, setSellingKey] = useState(null); // 'marketId__outcomeId'
  const [sellAmount, setSellAmount] = useState('');
  const [sellLoading, setSellLoading] = useState(false);
  const [sellMsg, setSellMsg] = useState('');

  const fetchPredictions = useCallback(() => {
    api.getPredictions()
      .then(data => {
        const allPreds = Array.isArray(data) ? data : [];
        const userId = session?.user?.id || 'demo_user';
        const userPredictions = allPreds.filter(p => p.user_id === userId);
        const activePredictions = userPredictions.filter(p => p.status === 'active');
        setAllPredictions(userPredictions);
        setPredictions(activePredictions);
      })
      .catch(() => {
        setPredictions([]);
        setAllPredictions([]);
      });
    refetchWallet();
  }, [session, refetchWallet]);

  useEffect(() => {
    fetchPredictions();
    // Auto-refresh every 60 seconds so the chart and portfolio value stay live
    const interval = setInterval(fetchPredictions, 60_000);
    return () => clearInterval(interval);
  }, [fetchPredictions]);

  // Calculate portfolio metrics
  const startingBalance = wallet.paperStartingBalance || 100000;
  const totalStaked = predictions.reduce((sum, p) => sum + (p.stake_amount || 0), 0);
  const settledPredictions = allPredictions.filter(p => p.status === 'won' || p.status === 'lost');
  const availableBalance = buyingPower;

  // Mark-to-market valuation using user-specified formula:
  //   R_max     = S + S(1 - p_entry)          ← win payout
  //   R_min     = S - S(1 - p_entry)          ← loss refund  (= S × p_entry)
  //   R_current = R_min + (R_max - R_min) × p_current
  const activeMtmValue = predictions.reduce((sum, p) => {
    const market  = markets.find(m => m.id === p.market_id);
    const outcome = market?.outcomes?.find(o => o.id === p.outcome_id);
    const pCurrent = (outcome?.probability ?? p.odds_at_prediction ?? 50) / 100;
    const pEntry   = (p.odds_at_prediction || 50) / 100;
    const S        = p.stake_amount || 0;
    const R_max     = S + S * (1 - pEntry);
    const R_min     = S - S * (1 - pEntry);
    const R_current = R_min + (R_max - R_min) * pCurrent;
    return sum + R_current;
  }, 0);

  const portfolioValue = availableBalance + activeMtmValue;
  const unrealizedPnl = activeMtmValue - totalStaked;
  const todayChange = portfolioValue - startingBalance;
  const todayChangePercent = startingBalance > 0 ? (todayChange / startingBalance) * 100 : 0;

  // Forecasting stats
  const totalPredictionCount = allPredictions.length;
  const wonCount = allPredictions.filter(p => p.status === 'won').length;
  const settledCount = settledPredictions.length;
  const accuracyPercent = settledCount > 0 ? Math.round((wonCount / settledCount) * 100) : 0;

  // Build equity curve — one data point per trade placed throughout the day.
  // For each trade (sorted by time), we compute the full portfolio value AT
  // that moment: settled P&L + MTM of all active positions up to that point.
  // MTM uses current market probabilities (best available — no historical prices stored).
  // This gives a proper N-point line graph instead of a flat 2-point line.
  const buildEquityPoints = (preds) => {
    if (!preds.length) return [];

    const sorted = preds
      .filter(p => p.created_at || p.createdAt)
      .map(p => ({ ...p, created_at: p.created_at || p.createdAt }))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // Guard: if no predictions have timestamps, bail out
    if (!sorted.length) return [];

    // R_current = R_min + (R_max - R_min) × p_current
    const getMtm = (p) => {
      const market  = markets.find(m => m.id === p.market_id);
      const outcome = market?.outcomes?.find(o => o.id === p.outcome_id);
      const pCurrent = (outcome?.probability ?? p.odds_at_prediction ?? 50) / 100;
      const pEntry   = (p.odds_at_prediction || 50) / 100;
      const S        = p.stake_amount || 0;
      const R_max     = S + S * (1 - pEntry);
      const R_min     = S - S * (1 - pEntry);
      return R_min + (R_max - R_min) * pCurrent;
    };

    // Anchor at start of the day of the first trade
    const startOfDay = new Date(sorted[0].created_at);
    startOfDay.setHours(0, 0, 0, 0);
    const points = [{ date: startOfDay.toISOString(), value: startingBalance }];

    // One point per trade — portfolio value at that moment in time
    for (let i = 0; i < sorted.length; i++) {
      const tradesUpTo = sorted.slice(0, i + 1);

      let settledPnL  = 0;
      let stakedSoFar = 0;
      let activeMtm   = 0;

      tradesUpTo.forEach(p => {
        if (['won', 'lost', 'sold', 'refunded'].includes(p.status)) {
          settledPnL += (p.actual_return || 0) - (p.stake_amount || 0);
        } else if (p.status === 'active') {
          stakedSoFar += p.stake_amount || 0;
          activeMtm   += getMtm(p);
        }
      });

      const equity = (startingBalance + settledPnL - stakedSoFar) + activeMtm;
      points.push({ date: sorted[i].created_at, value: equity });
    }

    // Final point pinned to portfolioValue now — chart always matches header
    points.push({ date: new Date().toISOString(), value: portfolioValue });
    return points;
  };

  const equityPoints = buildEquityPoints(allPredictions);

  // Group predictions by market
  const groupedPredictions = predictions.reduce((acc, pred) => {
    if (!acc[pred.market_id]) {
      acc[pred.market_id] = [];
    }
    acc[pred.market_id].push(pred);
    return acc;
  }, {});

  const recentActivities = allPredictions
    .map(pred => {
      const market = markets.find(m => m.id === pred.market_id);
      const outcome = market?.outcomes?.find(o => o.id === pred.outcome_id);
      const isSettled = ['won', 'lost'].includes(pred.status);
      const isSold = pred.status === 'sold';
      return {
        id: pred.id,
        type: isSettled ? 'resolution' : isSold ? 'trade' : 'trade',
        label: isSettled ? (pred.status === 'won' ? 'Resolved Won' : 'Resolved Lost') : isSold ? 'Sold' : 'Bought',
        marketId: pred.market_id,
        marketTitle: market?.title || 'Unknown Market',
        outcomeTitle: outcome?.title || 'Unknown',
        amount: isSettled || isSold ? (pred.actual_return || 0) : (pred.stake_amount || 0),
        pnl: isSettled || isSold ? (pred.actual_return || 0) - (pred.stake_amount || 0) : null,
        status: pred.status,
        date: pred.resolved_at || pred.sold_at || pred.updated_at || pred.created_at || new Date().toISOString()
      };
    })
    .filter(activity => activeFilter === 'all' || activity.type === activeFilter)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8);

  return (
    <div className="max-w-7xl mx-auto p-6 lg:p-8">
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Main Content (Left Side) */}
        <div className="flex-1">
          {/* Account Selector & Value */}
          <div className="mb-2">
            <button className="flex items-center gap-2 text-white hover:bg-slate-800/50 px-3 py-2 rounded-lg transition-colors -ml-3">
              <span className="text-2xl font-semibold">Portfolio</span>
              <span className="text-slate-400">▾</span>
            </button>
          </div>

          {/* Portfolio Value */}
          <div className="mb-1">
            <h1 className="text-5xl font-bold text-white">${portfolioValue.toFixed(2)}</h1>
          </div>
          <div className="flex items-center gap-2 mb-8">
            <span className={`font-medium ${todayChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {todayChange >= 0 ? '+' : ''}${todayChange.toFixed(2)} ({todayChange >= 0 ? '+' : ''}{todayChangePercent.toFixed(2)}%)
            </span>
            <span className="text-slate-400">All Time</span>
          </div>

          {/* Portfolio Chart */}
          <div className="mb-6">
            <div className="h-64 relative">
              <EquityChart
                equityPoints={equityPoints}
                startingBalance={startingBalance}
                currentValue={portfolioValue}
              />
            </div>
          </div>

          {/* Time Range Selector */}
          <div className="flex items-center justify-between mb-8 border-b border-slate-800 pb-4">
            <div className="flex gap-1">
              {['1D', '1W', '1M', '3M', 'YTD', '1Y', 'ALL'].map(range => (
                <button
                  key={range}
                  onClick={() => setSelectedRange(range)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${selectedRange === range
                    ? 'text-green-400 border-b-2 border-green-400'
                    : 'text-slate-400 hover:text-white'
                    }`}
                >
                  {range}
                </button>
              ))}
            </div>
            <button className="p-2 hover:bg-slate-800 rounded-lg transition-colors" style={{ color: 'rgb(212, 175, 55)' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>

          {/* Paper Trading Balance */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 mb-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span style={{ color: 'rgb(212, 175, 55)' }}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                  </svg>
                </span>
                <span className="text-white font-medium">Paper Trading Balance</span>
                <span className="text-slate-500 cursor-help text-sm" title="Virtual money for practice trading">ⓘ</span>
              </div>
              <span className="text-2xl font-bold text-yellow-400">
                {walletLoading ? '...' : `$${availableBalance.toFixed(2)}`}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-500 sm:grid-cols-3">
              <span>Starting: ${startingBalance.toFixed(2)}</span>
              <span>In positions: ${wallet.activeStakes.toFixed(2)}</span>
              <span>Cash before positions: ${wallet.cashBalance.toFixed(2)}</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">This buying power is virtual money for practice. No real funds are involved.</p>
          </div>

          {/* Forecasting Statistics */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 mb-8">
            <div className="flex items-center gap-2 mb-4">
              <span style={{ color: 'rgb(212, 175, 55)' }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </span>
              <span className="text-white font-medium">Your Forecasting Stats</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-yellow-400">{totalPredictionCount}</p>
                <p className="text-slate-500 text-xs">Predictions</p>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-400">{accuracyPercent}%</p>
                <p className="text-slate-500 text-xs">Accuracy</p>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-blue-400">0%</p>
                <p className="text-slate-500 text-xs">Calibration</p>
              </div>
            </div>
            <p className="text-slate-600 text-xs text-center mt-3">
              Accuracy = correct predictions • Calibration = confidence matches outcomes
            </p>
          </div>

          {/* Get More Section */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4">Get more out of Samsa</h2>
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 flex items-start gap-4">
              <div className="w-16 h-16 bg-gradient-to-br from-yellow-400 to-amber-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg className="w-8 h-8 text-slate-900" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-slate-400 text-sm mb-1">Did you know?</p>
                    <p className="text-white">You can explore trending markets and make predictions on events you care about.</p>
                  </div>
                  <button className="text-slate-500 hover:text-white p-1">✕</button>
                </div>
                <button
                  onClick={() => navigate('/explore')}
                  className="text-yellow-400 hover:text-yellow-300 text-sm font-medium mt-3 transition-colors"
                >
                  Explore markets
                </button>
              </div>
            </div>
          </div>

          {/* Recent Activity with Filters */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Recent Activity</h2>
              <div className="flex gap-1">
                {['all', 'trade', 'resolution'].map(filter => (
                  <button
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${activeFilter === filter
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:bg-slate-800/50'
                      }`}
                  >
                    {filter === 'all' ? 'All' : filter === 'trade' ? 'Trades' : 'Resolutions'}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {recentActivities.length === 0 ? (
                <div className="text-slate-500 text-sm text-center py-8">
                  <p>No activity yet</p>
                  <p className="text-xs mt-1">Your trades and resolutions will appear here</p>
                </div>
              ) : recentActivities.map(activity => (
                <button
                  key={activity.id}
                  onClick={() => navigate(`/markets/${activity.marketId}`)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-left transition-colors hover:border-slate-700"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold ${activity.type === 'resolution' ? 'text-yellow-400' : 'text-slate-400'}`}>
                          {activity.label}
                        </span>
                        {activity.type === 'resolution' && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${activity.status === 'won' ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>
                            {activity.status}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-white">{activity.marketTitle}</p>
                      <p className="text-xs text-slate-500">{activity.outcomeTitle}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-white">{formatCurrency(activity.amount)}</p>
                      {activity.pnl !== null && (
                        <p className={`text-xs ${activity.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {activity.pnl >= 0 ? '+' : ''}{formatCurrency(activity.pnl)}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <button className="w-full mt-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
              View all activity →
            </button>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="w-full lg:w-80 space-y-4">
          {/* Positions Section */}
          <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700 transition-colors">
            <div className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
                <h3 className="text-white font-semibold">Positions</h3>
                <span className="text-slate-500 text-xs">{Object.keys(groupedPredictions).length} active</span>
              </div>
              {Object.keys(groupedPredictions).length === 0 ? (
                <p className="text-slate-500 text-sm">No open positions</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(groupedPredictions).map(([marketId, marketPredictions]) => {
                    const market = markets.find(m => m.id === marketId);

                    // Aggregate by outcome
                    const outcomeMap = {};
                    marketPredictions.forEach(pred => {
                      const oid = pred.outcome_id;
                      if (!outcomeMap[oid]) {
                        outcomeMap[oid] = { totalStake: 0, weightedOdds: 0 };
                      }
                      const s = pred.stake_amount || 0;
                      outcomeMap[oid].totalStake += s;
                      outcomeMap[oid].weightedOdds += (pred.odds_at_prediction || 50) * s;
                    });

                    return (
                      <div key={marketId} className="bg-slate-800/30 rounded-lg p-3">
                        <p
                          className="text-white text-sm font-medium mb-2 line-clamp-2 cursor-pointer hover:text-yellow-400 transition-colors"
                          onClick={() => navigate(`/markets/${marketId}`)}
                        >
                          {market?.title || 'Unknown Market'}
                        </p>
                        <div className="space-y-2">
                          {Object.entries(outcomeMap).map(([outcomeId, data]) => {
                            const outcome = market?.outcomes?.find(o => o.id === outcomeId);
                            const currentProb = outcome?.probability ?? 50;
                            const avgEntry = data.totalStake > 0 ? data.weightedOdds / data.totalStake : 50;
                            // R_max = S + S(1-p_entry), R_min = S - S(1-p_entry)
                            // R_current = R_min + (R_max - R_min) * p_current
                            const pCurrent = currentProb / 100;
                            const pEntry   = avgEntry / 100;
                            const S = data.totalStake;
                            const R_max     = S + S * (1 - pEntry);
                            const R_min     = S - S * (1 - pEntry);
                            const mtmValue  = R_min + (R_max - R_min) * pCurrent;
                            const unrealizedPnl = mtmValue - S;
                            const sellKey = `${marketId}__${outcomeId}`;
                            const isSelling = sellingKey === sellKey;
                            const sellAmt = parseFloat(sellAmount) || 0;
                            const previewReturn = isSelling && sellAmt > 0
                              ? Math.min(sellAmt * (currentProb / avgEntry), sellAmt * 2).toFixed(2)
                              : null;
                            const previewPnl = previewReturn !== null
                              ? (parseFloat(previewReturn) - sellAmt).toFixed(2)
                              : null;

                            const handleSell = async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!sellAmt || sellAmt <= 0) return;
                              setSellLoading(true); setSellMsg('');
                              try {
                                const userId = session?.user?.id || 'demo_user';
                                await api.sellPosition({
                                  market_id: marketId,
                                  outcome_id: outcomeId,
                                  user_id: userId,
                                  sell_amount: sellAmt,
                                });
                                setSellMsg(`✅ Sold $${sellAmt.toFixed(2)}`);
                                setTimeout(() => window.location.reload(), 1000);
                              } catch (err) {
                                setSellMsg(`❌ ${err.message}`);
                              } finally {
                                setSellLoading(false);
                              }
                            };

                            return (
                              <div key={outcomeId}>
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-400">{outcome?.title || 'Unknown'}</span>
                                  <div className="flex items-center gap-2">
                                    <div className="text-right">
                                      {/* Live MTM value — red if below cost, green if above */}
                                      <span className={`font-semibold ${
                                        mtmValue < data.totalStake ? 'text-red-400' :
                                        mtmValue > data.totalStake ? 'text-green-400' : 'text-slate-300'
                                      }`}>
                                        ${mtmValue.toFixed(2)}
                                      </span>
                                      {/* Unrealized P&L delta */}
                                      <span className={`block text-[10px] leading-tight ${
                                        unrealizedPnl < 0 ? 'text-red-500' :
                                        unrealizedPnl > 0 ? 'text-green-500' : 'text-slate-500'
                                      }`}>
                                        {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
                                      </span>
                                    </div>
                                    <button
                                      onClick={e => {
                                        e.stopPropagation();
                                        if (isSelling) {
                                          setSellingKey(null); setSellAmount(''); setSellMsg('');
                                        } else {
                                          setSellingKey(sellKey); setSellAmount(''); setSellMsg('');
                                        }
                                      }}
                                      className={`px-2 py-0.5 rounded text-xs font-semibold transition-all ${
                                        isSelling
                                          ? 'bg-slate-700 text-slate-300'
                                          : 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30'
                                      }`}
                                    >
                                      {isSelling ? 'Cancel' : 'Sell'}
                                    </button>
                                  </div>
                                </div>

                                {/* Inline sell panel */}
                                {isSelling && (
                                  <form
                                    onSubmit={handleSell}
                                    onClick={e => e.stopPropagation()}
                                    className="mt-2 space-y-2"
                                  >
                                    <p className="text-slate-500 text-xs">Current: {currentProb.toFixed(1)}% · Entry: {avgEntry.toFixed(1)}%</p>
                                    <div className="flex gap-1">
                                      <div className="relative flex-1">
                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                                        <input
                                          type="number"
                                          min="0.01"
                                          max={data.totalStake}
                                          step="0.01"
                                          value={sellAmount}
                                          onChange={e => setSellAmount(e.target.value)}
                                          placeholder={`Max $${data.totalStake.toFixed(2)}`}
                                          className="w-full bg-slate-800 border border-slate-600 rounded pl-5 pr-2 py-1.5 text-white text-xs placeholder:text-slate-600 focus:outline-none focus:border-red-500"
                                        />
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => setSellAmount(data.totalStake.toFixed(2))}
                                        className="px-2 py-1.5 text-xs bg-slate-800 border border-slate-600 rounded text-slate-400 hover:text-white transition-colors"
                                      >
                                        Max
                                      </button>
                                    </div>

                                    {previewReturn && (
                                      <div className="bg-slate-800 rounded p-2 space-y-1 text-xs">
                                        <div className="flex justify-between">
                                          <span className="text-slate-500">Receive:</span>
                                          <span className="text-white font-medium">${previewReturn}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-slate-500">P&L:</span>
                                          <span className={`font-medium ${
                                            parseFloat(previewPnl) >= 0 ? 'text-green-400' : 'text-red-400'
                                          }`}>
                                            {parseFloat(previewPnl) >= 0 ? '+' : ''}${previewPnl}
                                          </span>
                                        </div>
                                      </div>
                                    )}

                                    {sellMsg && (
                                      <p className={`text-xs ${sellMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
                                        {sellMsg}
                                      </p>
                                    )}

                                    <button
                                      type="submit"
                                      disabled={sellLoading || !sellAmt || sellAmt <= 0 || sellAmt > data.totalStake}
                                      className="w-full py-1.5 rounded text-xs font-semibold bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                                    >
                                      {sellLoading ? 'Selling...' : 'Confirm Sell'}
                                    </button>
                                  </form>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Following Section */}
          <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700 transition-colors">
            <div className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                <h3 className="text-white font-semibold">Following</h3>
                <span className="text-slate-500 text-xs">0 markets</span>
              </div>
              <p className="text-slate-500 text-sm">No markets followed</p>
            </div>
          </div>

          {/* Watchlist Section */}
          <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700 transition-colors">
            <div className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                </svg>
                <h3 className="text-white font-semibold">Watchlist</h3>
                <span className="text-slate-500 text-xs">0 items</span>
              </div>
              <p className="text-slate-500 text-sm">No watchlist items</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
