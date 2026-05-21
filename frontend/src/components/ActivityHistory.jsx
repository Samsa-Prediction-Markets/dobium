import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '../store/storage';

// ─────────────────────────────────────────────────────────────────────────────
// Dobium Payout Bounds (S(1−p) model)
//
//   R_max     = S + S×(1−p_entry)   = S×(2−p_entry)   ← Win upper bound
//   R_min     = S×p_entry                              ← Loss lower bound
//   R_current = R_min + (R_max − R_min)×p_current      ← Midpoint MTM (sell)
//             = S×(p_entry + 2×p_current×(1−p_entry))  ← Simplified
// ─────────────────────────────────────────────────────────────────────────────

/** R_max = S×(2 − p_entry) — full win payout */
function calcRmax(stake, entryProbPct) {
  const p = entryProbPct / 100;
  return stake * (2 - p);
}

/** R_min = S×p_entry — loss refund */
function calcRmin(stake, entryProbPct) {
  const p = entryProbPct / 100;
  return stake * p;
}

export default function ActivityHistory({ predictions, markets, onBack }) {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState('all');

  // Explicitly filter out active positions so only past history/resolutions are shown
  // Group predictions by market, outcome, and action to show "overall entry price" based on total invested
  const grouped = new Map();

  predictions
    .filter(pred => pred.status !== 'active')
    .forEach(pred => {
      const isSettled = ['won', 'lost'].includes(pred.status);
      const isSold = pred.status === 'sold';

      let action = 'Other';
      if (isSettled) action = 'Resolved';
      else if (isSold) action = 'Sold';
      else if (pred.status === 'cancelled') action = 'Cancelled';
      else if (pred.status === 'refunded') action = 'Refunded';

      const S = pred.stake_amount || 0;
      const entryProbPct = pred.odds_at_prediction || 50;

      let returnAmount;
      if (pred.status === 'won') {
        // Upper bound: R_max = S×(2 − p_entry)
        // Use stored actual_return if available; fallback to formula
        returnAmount = (pred.actual_return && pred.actual_return > 0)
          ? pred.actual_return
          : calcRmax(S, entryProbPct);
      } else if (pred.status === 'lost') {
        // Lower bound: R_min = S×p_entry
        // Use stored actual_return if available; fallback to formula
        returnAmount = (pred.actual_return && pred.actual_return > 0)
          ? pred.actual_return
          : calcRmin(S, entryProbPct);
      } else if (isSold) {
        // Midpoint MTM value at time of sale (stored as actual_return)
        returnAmount = pred.actual_return || 0;
      } else {
        returnAmount = 0;
      }

      const key = `${pred.market_id}_${pred.outcome_id}_${action}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          id: pred.id,
          marketId: pred.market_id,
          outcomeId: pred.outcome_id,
          date: pred.resolved_at || pred.sold_at || pred.updated_at || pred.created_at || new Date().toISOString(),
          action,
          status: pred.status,
          totalStake: 0,
          weightedOdds: 0,
          returnAmount: 0
        });
      }

      const g = grouped.get(key);
      g.totalStake += S;
      g.weightedOdds += entryProbPct * S;
      g.returnAmount += returnAmount;

      const predDate = new Date(pred.resolved_at || pred.sold_at || pred.updated_at || pred.created_at || new Date().toISOString());
      if (predDate > new Date(g.date)) {
        g.date = predDate.toISOString();
      }
    });

  const activities = Array.from(grouped.values())
    .map(g => {
      const market = markets.find(m => m.id === g.marketId);
      const outcome = market?.outcomes?.find(o => o.id === g.outcomeId);

      // Weighted-average entry probability (¢)
      const entryPrice = g.totalStake > 0 ? g.weightedOdds / g.totalStake : 50;

      // End price (¢) derived from the payout-bounds formula:
      //   Won  → R_max  → end price = 100¢ (full win)
      //   Lost → R_min  → end price = p_entry¢  (refund fraction)
      //   Sold → midpoint MTM → returnAmount / totalStake × 100
      let endPrice = 0;
      if (g.status === 'won') {
        endPrice = 100;
      } else if (g.status === 'lost') {
        // R_min = S×p_entry  →  per-dollar = p_entry = entryPrice¢
        endPrice = entryPrice; // already in ¢
      } else if (g.status === 'sold') {
        // Midpoint MTM: returnAmount / stake × 100 gives the per-dollar return in ¢
        endPrice = g.totalStake > 0 ? (g.returnAmount / g.totalStake) * 100 : 0;
      }

      return {
        id: g.id,
        marketId: g.marketId,
        date: g.date,
        marketTitle: market?.title || 'Unknown Market',
        outcomeTitle: outcome?.title || 'Unknown Outcome',
        action: g.action,
        status: g.status,
        entryPrice,
        endPrice,
        amount: g.totalStake,
        returnAmount: g.returnAmount
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const filteredActivities = activities.filter(act => {
    if (activeFilter === 'trades') return act.action === 'Sold' || act.action === 'Bought';
    if (activeFilter === 'resolutions') return act.action === 'Resolved' || act.action === 'Refunded';
    return true;
  });

  // Group activities by market after filtering
  const marketGroupsMap = new Map();
  filteredActivities.forEach(act => {
    if (!marketGroupsMap.has(act.marketId)) {
      marketGroupsMap.set(act.marketId, {
        marketId: act.marketId,
        marketTitle: act.marketTitle,
        latestDate: act.date,
        activities: []
      });
    }
    const group = marketGroupsMap.get(act.marketId);
    group.activities.push(act);
    if (new Date(act.date) > new Date(group.latestDate)) {
      group.latestDate = act.date;
    }
  });

  const groupedActivities = Array.from(marketGroupsMap.values())
    .sort((a, b) => new Date(b.latestDate) - new Date(a.latestDate));

  return (
    <div className="max-w-7xl mx-auto p-6 lg:p-8 animate-fadeIn">
      <button
        onClick={onBack}
        className="mb-8 flex items-center gap-2 text-slate-400 hover:text-white font-medium transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        <span>Back to Dashboard</span>
      </button>

      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Activity History</h1>
          <p className="text-slate-400">View your past trades and market resolutions.</p>
        </div>

        <div className="flex bg-slate-900/80 p-1 rounded-lg border border-slate-800">
          {['all', 'trades', 'resolutions'].map(filter => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeFilter === filter
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
            >
              {filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {groupedActivities.length === 0 ? (
          <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-16 text-center text-slate-500">
            <div className="flex flex-col items-center justify-center">
              <svg className="w-12 h-12 text-slate-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-base font-medium text-slate-400">No past activity found</p>
              <p className="text-sm mt-1">Your trades and resolutions will appear here</p>
            </div>
          </div>
        ) : (
          groupedActivities.map(group => (
            <div key={group.marketId} className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
              <div
                className="px-6 py-4 bg-slate-800/40 border-b border-slate-700 cursor-pointer hover:bg-slate-800/60 transition-colors flex items-center justify-between group/header"
                onClick={() => navigate(`/markets/${group.marketId}`)}
              >
                <h2 className="text-lg font-semibold text-white group-hover/header:text-yellow-400 transition-colors">
                  {group.marketTitle}
                </h2>
                <div className="flex items-center gap-2 text-slate-500 group-hover/header:text-yellow-400 transition-colors">
                  <span className="text-sm font-medium">View Market</span>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[800px]">
                  <thead className="bg-slate-800/20 text-slate-400 border-b border-slate-700/50">
                    <tr>
                      <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[11px]">Date</th>
                      <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[11px]">Contract</th>
                      <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[11px] text-right">Cost</th>
                      <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[11px] text-right"
                        title="Won → R_max = S×(2−p_entry) | Lost → R_min = S×p_entry | Sold → Midpoint MTM">Return</th>
                      <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[11px] text-right">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {group.activities.map(act => {
                      const diff = (act.returnAmount || 0) - (act.amount || 0);
                      const isPositive = diff > 0;
                      const isNegative = diff < 0;

                      // Label describing which bound applies
                      const boundLabel = act.status === 'won'
                        ? 'R_max'
                        : act.status === 'lost'
                          ? 'R_min'
                          : act.status === 'sold'
                            ? 'MTM'
                            : null;

                      const boundColor = act.status === 'won'
                        ? 'text-green-500'
                        : act.status === 'lost'
                          ? 'text-red-500'
                          : 'text-slate-500';

                      return (
                        <tr key={act.id} className="hover:bg-slate-800/40 transition-colors group">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-white font-medium">{new Date(act.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                            <div className="text-slate-500 text-xs mt-1">{new Date(act.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              {act.action === 'Resolved' ? (
                                <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                  act.status === 'won'
                                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                }`}>{act.status === 'won' ? 'Won' : 'Lost'}</span>
                              ) : act.action === 'Sold' ? (
                                <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">Sold</span>
                              ) : act.action !== 'Other' ? (
                                <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20">{act.action}</span>
                              ) : null}
                              <span className="bg-slate-800/80 px-2.5 py-1 rounded text-slate-300 font-medium border border-slate-700">{act.outcomeTitle}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="text-white font-semibold">{formatCurrency(act.amount)}</div>
                            <div className="text-slate-500 text-xs mt-0.5">@ {Math.round(act.entryPrice)}¢</div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="text-white font-semibold">{formatCurrency(act.returnAmount || 0)}</div>
                            {boundLabel && (
                              <div className={`text-[10px] mt-0.5 font-mono ${boundColor}`}>
                                {boundLabel} · {act.endPrice.toFixed(1)}¢
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className={`font-bold ${isPositive ? 'text-green-400' : isNegative ? 'text-red-400' : 'text-slate-400'}`}>
                              {isPositive ? '+' : isNegative ? '-' : ''}{formatCurrency(Math.abs(diff))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-800/30 border-t border-slate-700/50">
                    {(() => {
                      const totalCost = group.activities.reduce((sum, act) => sum + (act.amount || 0), 0);
                      const totalReturn = group.activities.reduce((sum, act) => sum + (act.returnAmount || 0), 0);
                      const totalDiff = totalReturn - totalCost;
                      const isPositive = totalDiff > 0;
                      const isNegative = totalDiff < 0;
                      return (
                        <tr>
                          <td colSpan="2" className="px-6 py-4 text-right font-semibold text-slate-400 uppercase tracking-wider text-[11px]">Total</td>
                          <td className="px-6 py-4 text-right font-semibold text-white">{formatCurrency(totalCost)}</td>
                          <td className="px-6 py-4 text-right font-semibold text-white">{formatCurrency(totalReturn)}</td>
                          <td className="px-6 py-4 text-right">
                            <div className={`font-bold ${isPositive ? 'text-green-400' : isNegative ? 'text-red-400' : 'text-slate-400'}`}>
                              {isPositive ? '+' : isNegative ? '-' : ''}{formatCurrency(Math.abs(totalDiff))}
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
                  </tfoot>
                  {/* Formula legend */}
                  <caption className="caption-bottom px-6 py-2 text-left">
                    <span className="text-[10px] text-slate-600 font-mono">
                      Return: Won → R<sub>max</sub>=S×(2−p) · Lost → R<sub>min</sub>=S×p · Sold → Midpoint MTM
                    </span>
                  </caption>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}