import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '../store/storage';

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

      let returnAmount = (isSettled || isSold) ? (pred.actual_return || 0) : null;
      if (pred.status === 'lost' && returnAmount === 0) {
        returnAmount = (pred.stake_amount || 0) * ((pred.odds_at_prediction || 50) / 100);
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
      g.totalStake += (pred.stake_amount || 0);
      g.weightedOdds += (pred.odds_at_prediction || 50) * (pred.stake_amount || 0);
      g.returnAmount += returnAmount || 0;

      const predDate = new Date(pred.resolved_at || pred.sold_at || pred.updated_at || pred.created_at || new Date().toISOString());
      if (predDate > new Date(g.date)) {
        g.date = predDate.toISOString();
      }
    });

  const activities = Array.from(grouped.values())
    .map(g => {
      const market = markets.find(m => m.id === g.marketId);
      const outcome = market?.outcomes?.find(o => o.id === g.outcomeId);

      const entryPrice = g.totalStake > 0 ? g.weightedOdds / g.totalStake : 50;

      let endPrice = 0;
      if (g.status === 'won') endPrice = 100;
      else if (g.status === 'lost') endPrice = 0;
      else if (g.status === 'sold') {
        endPrice = g.totalStake > 0 ? (g.returnAmount / g.totalStake) * entryPrice : 0;
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

      <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[900px]">
            <thead className="bg-slate-800/80 text-slate-400 border-b border-slate-700">
              <tr>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[11px]">Date</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[11px]">Market</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[11px]">Action</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[11px]">Contract</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[11px] text-right">Entry</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[11px] text-right">End</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[11px] text-right">Price</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[11px] text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filteredActivities.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-6 py-16 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center">
                      <svg className="w-12 h-12 text-slate-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-base font-medium text-slate-400">No past activity found</p>
                      <p className="text-sm mt-1">Your trades and resolutions will appear here</p>
                    </div>
                  </td>
                </tr>
              ) : filteredActivities.map(act => (
                <tr
                  key={act.id}
                  onClick={() => navigate(`/markets/${act.marketId}`)}
                  className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-white font-medium">{new Date(act.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    <div className="text-slate-500 text-xs mt-1">{new Date(act.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="max-w-[280px] truncate text-white font-medium group-hover:text-yellow-400 transition-colors" title={act.marketTitle}>
                      {act.marketTitle}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider ${act.action === 'Bought' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                      act.action === 'Sold' ? 'bg-slate-500/10 text-slate-400 border border-slate-500/20' :
                        'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                      }`}>{act.action}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="bg-slate-800/80 px-2.5 py-1 rounded text-slate-300 font-medium border border-slate-700">{act.outcomeTitle}</span>
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-slate-300">{Math.round(act.entryPrice)}¢</td>
                  <td className="px-6 py-4 text-right font-medium text-slate-300">{Math.round(act.endPrice)}¢</td>
                  <td className="px-6 py-4 text-right">
                    <div className="text-white font-semibold">{formatCurrency(act.amount)}</div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {act.status === 'won' ? (
                      <div className="inline-flex flex-col items-end">
                        <span className="text-green-400 font-bold">Won</span>
                        <span className="text-green-500/80 text-xs font-medium mt-0.5">+{formatCurrency(act.returnAmount - act.amount)}</span>
                      </div>
                    ) : act.status === 'lost' ? (
                      <div className="inline-flex flex-col items-end">
                        <span className="text-red-400 font-bold">Lost</span>
                        <span className="text-red-500/80 text-xs font-medium mt-0.5">-{formatCurrency(act.amount - act.returnAmount)}</span>
                      </div>
                    ) : act.status === 'sold' ? (
                      <div className="inline-flex flex-col items-end">
                        <span className="text-slate-300 font-bold">Sold</span>
                        <span className="text-slate-500 text-xs font-medium mt-0.5">{formatCurrency(act.returnAmount)} returned</span>
                      </div>
                    ) : (
                      <span className="text-slate-500 font-medium capitalize">{act.status}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}