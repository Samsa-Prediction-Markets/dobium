import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AdminUserDashboard from '../components/AdminUserDashboard';

// Helper to properly format UTC database dates for the local datetime input
const formatDateTimeLocal = (dateString) => {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '';
  const offset = d.getTimezoneOffset() * 60000;
  const localDate = new Date(d.getTime() - offset);
  return localDate.toISOString().slice(0, 16);
};

export default function AdminDashboard() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);

  // Email form state
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailHeading, setEmailHeading] = useState('A message from Dobium');
  const [emailGreeting, setEmailGreeting] = useState('');
  const [emailText, setEmailText] = useState('');
  const [emailCallout, setEmailCallout] = useState('');
  const [emailCta, setEmailCta] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Risk Management & System state
  const [negativeUsers, setNegativeUsers] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [fixLoading, setFixLoading] = useState(false);
  const [riskMessage, setRiskMessage] = useState('');
  const [health, setHealth] = useState(null);

  // Market Creation state
  const [marketTitle, setMarketTitle] = useState('');
  const [marketCategory, setMarketCategory] = useState('technology');
  const [marketType, setMarketType] = useState('binary');
  const [marketCloseDate, setMarketCloseDate] = useState('');
  const [marketOutcomes, setMarketOutcomes] = useState([{ title: 'Yes', probability: 50 }, { title: 'No', probability: 50 }]);
  const [createMarketLoading, setCreateMarketLoading] = useState(false);
  const [createMarketMessage, setCreateMarketMessage] = useState('');

  // Market Resolution state
  const [activeMarkets, setActiveMarkets] = useState([]);
  const [resolvingMarket, setResolvingMarket] = useState(null);
  const [resolveSelections, setResolveSelections] = useState({});
  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolveMessage, setResolveMessage] = useState('');

  // Market Edit state
  const [editingMarket, setEditingMarket] = useState(null);
  const [editMarketLoading, setEditMarketLoading] = useState(false);
  const [editMarketMessage, setEditMarketMessage] = useState('');

  // Users list state
  const [users, setUsers] = useState([]);
  const [viewingUser, setViewingUser] = useState(null);

  // Position monitoring state
  const [allPredictions, setAllPredictions] = useState([]);

  // Resolution confirmation modal state
  const [confirmModal, setConfirmModal] = useState(null); // { market, winnerLabel, winnerIds }

  // Market status action state
  const [statusLoading, setStatusLoading] = useState(null); // marketId currently being changed

  // ── Broadcast Campaign state ────────────────────────────────────────────────
  const [broadcastTab, setBroadcastTab] = useState('presets');          // 'presets' | 'custom'
  const [broadcastPreview, setBroadcastPreview] = useState(null);       // { previewHtml, recipientCount, recipients, campaign }
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [showBroadcastConfirm, setShowBroadcastConfirm] = useState(false);
  const [broadcastSending, setBroadcastSending] = useState(false);
  const previewFrameRef = useRef(null);

  // Custom compose fields
  const [customSubject, setCustomSubject] = useState('');
  const [customHeading, setCustomHeading] = useState('');
  const [customHeroIcon, setCustomHeroIcon] = useState('✦');
  const [customBody, setCustomBody] = useState('');
  const [customCallout, setCustomCallout] = useState('');
  const [customCtaLabel, setCustomCtaLabel] = useState('');
  const [customCtaUrl, setCustomCtaUrl] = useState('');

  const adminAccount = 'donotreply.dobium@gmail.com';
  const rawApiUrl = import.meta.env.VITE_API_URL || '';
  const API_URL = rawApiUrl.endsWith('/') ? rawApiUrl.slice(0, -1) : rawApiUrl;

  const fetchMarkets = () =>
    fetch(`${API_URL}/api/markets`)
      .then(res => res.json())
      .then(data => setActiveMarkets(Array.isArray(data) ? data.filter(m => m.status === 'active') : []))
      .catch(console.error);

  const fetchPredictions = () =>
    fetch(`${API_URL}/api/predictions`)
      .then(res => res.json())
      .then(data => setAllPredictions(Array.isArray(data) ? data : []))
      .catch(console.error);

  useEffect(() => {
    const userEmail = session?.user?.email;
    if (userEmail === adminAccount) {
      setIsAdmin(true);
      fetch(`${API_URL}/api/health`)
        .then(res => res.json())
        .then(data => setHealth(data))
        .catch(() => setHealth({ ok: false, error: 'Cannot connect to API' }));
      fetchMarkets();
      fetchPredictions();
      fetch(`${API_URL}/api/admin/users?adminEmail=${encodeURIComponent(adminAccount)}`)
        .then(res => res.json())
        .then(data => setUsers(Array.isArray(data) ? data : []))
        .catch(console.error);
    } else if (session) {
      navigate('/');
    }
  }, [session, navigate]);

  const handleSendEmail = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/api/admin/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emailTo,
          subject: emailSubject,
          heading: emailHeading,
          greeting: emailGreeting,
          text: emailText,
          callout: emailCallout,
          cta: emailCta,
          adminEmail: session?.user?.email
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setMessage('Email sent successfully!');
        setEmailTo('');
        setEmailSubject('');
        setEmailHeading('A message from Dobium');
        setEmailGreeting('');
        setEmailText('');
        setEmailCallout('');
        setEmailCta('');
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch (error) {
      setMessage('Failed to send email. Ensure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  // ── Broadcast handlers ─────────────────────────────────────────────────────
  const handleBroadcastPreview = async (campaignId, customFields = null) => {
    setBroadcastLoading(true);
    setBroadcastMessage('');
    setBroadcastPreview(null);
    try {
      const payload = {
        campaignId,
        adminEmail: session?.user?.email,
        dryRun: true,
        ...(customFields || {})
      };
      const res = await fetch(`${API_URL}/api/admin/send-broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        // Stash custom fields alongside the preview so the live send can replay them
        setBroadcastPreview({ ...data, _customFields: customFields });
      } else {
        setBroadcastMessage(`Error: ${data.error}`);
      }
    } catch (err) {
      setBroadcastMessage('Failed to connect to backend.');
    } finally {
      setBroadcastLoading(false);
    }
  };

  const handleBroadcastSend = async () => {
    if (!broadcastPreview) return;
    setBroadcastSending(true);
    setShowBroadcastConfirm(false);
    setBroadcastMessage('');
    try {
      const payload = {
        campaignId: broadcastPreview.campaign.id,
        adminEmail: session?.user?.email,
        dryRun: false,
        ...(broadcastPreview._customFields || {})
      };
      const res = await fetch(`${API_URL}/api/admin/send-broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setBroadcastMessage(`✅ Campaign sent — ${data.sent} delivered, ${data.failed} failed.`);
        setBroadcastPreview(null);
      } else {
        setBroadcastMessage(`Error: ${data.error}`);
      }
    } catch (err) {
      setBroadcastMessage('Failed to connect to backend.');
    } finally {
      setBroadcastSending(false);
    }
  };

  const handleCustomPreview = () => {
    handleBroadcastPreview('custom', {
      subject: customSubject,
      heading: customHeading,
      heroIcon: customHeroIcon || '✦',
      body: customBody,
      callout: customCallout,
      ctaLabel: customCtaLabel,
      ctaUrl: customCtaUrl,
    });
  };

  const handleScanBalances = async () => {
    setScanLoading(true);
    setRiskMessage('');
    try {
      const res = await fetch(`${API_URL}/api/users/negative-buying-power`);
      const data = await res.json();
      if (res.ok) {
        setNegativeUsers(data.users || []);
        if (data.count === 0) {
          setRiskMessage('All user balances are healthy (>= $0.00).');
        } else {
          setRiskMessage(`Found ${data.count} user(s) with negative buying power.`);
        }
      } else {
        setRiskMessage(`Error: ${data.error}`);
      }
    } catch (err) {
      setRiskMessage('Failed to connect to server.');
    } finally {
      setScanLoading(false);
    }
  };

  const handleFixBalances = async () => {
    if (!window.confirm('Are you sure you want to auto-cancel trades for these users to restore their balances?')) return;
    setFixLoading(true);
    setRiskMessage('');
    try {
      const res = await fetch(`${API_URL}/api/users/fix-negative-buying-power`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setRiskMessage(`Successfully repaired ${data.repaired_users} user(s). Cancelled ${data.removed_predictions} predictions.`);
        setNegativeUsers([]);
      } else {
        setRiskMessage(`Error: ${data.error}`);
      }
    } catch (err) {
      setRiskMessage('Failed to connect to server.');
    } finally {
      setFixLoading(false);
    }
  };

  const handleMarketTypeChange = (e) => {
    const type = e.target.value;
    setMarketType(type);
    if (type === 'binary') {
      setMarketOutcomes([{ title: 'Yes', probability: 50 }, { title: 'No', probability: 50 }]);
    } else if (type === 'multi_multiple') {
      setMarketOutcomes([
        { title: '', probability: 50 },
        { title: '', probability: 50 },
        { title: '', probability: 50 },
        { title: '', probability: 50 }
      ]);
    } else {
      setMarketOutcomes([
        { title: '', probability: 25 },
        { title: '', probability: 25 },
        { title: '', probability: 25 },
        { title: '', probability: 25 }
      ]);
    }
  };

  const handleOutcomeChange = (index, field, value) => {
    const newOutcomes = [...marketOutcomes];
    newOutcomes[index][field] = value;
    setMarketOutcomes(newOutcomes);
  };

  const addOutcome = () => {
    setMarketOutcomes([...marketOutcomes, { title: '', probability: 0 }]);
  };

  const removeOutcome = (index) => {
    setMarketOutcomes(marketOutcomes.filter((_, i) => i !== index));
  };

  const handleCreateMarket = async (e) => {
    e.preventDefault();
    setCreateMarketLoading(true);
    setCreateMarketMessage('');

    try {
      const formattedOutcomes = marketOutcomes.map(o => ({
        title: o.title,
        probability: parseFloat(o.probability) || 0
      }));

      const res = await fetch(`${API_URL}/api/markets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: marketTitle,
          description: '',
          category: marketCategory,
          market_type: marketType,
          close_date: marketCloseDate ? new Date(marketCloseDate).toISOString() : null,
          resolution_date: marketCloseDate ? new Date(marketCloseDate).toISOString() : null,
          outcomes: formattedOutcomes
        })
      });

      const data = await res.json();
      if (res.ok) {
        setCreateMarketMessage(`Successfully created market: ${data.title}`);
        setMarketTitle('');
        setMarketCloseDate('');
      } else {
        setCreateMarketMessage(`Error: ${data.error}`);
      }
    } catch (err) {
      setCreateMarketMessage('Failed to connect to server.');
    } finally {
      setCreateMarketLoading(false);
    }
  };

  const handleResolveMarket = async (e) => {
    e.preventDefault();
    setResolveLoading(true);
    setResolveMessage('');

    try {
      let winning_outcome_ids = [];

      if (resolvingMarket.market_type === 'multi_multiple') {
        winning_outcome_ids = Object.values(resolveSelections);
        if (winning_outcome_ids.length !== resolvingMarket.outcomes.length / 2) {
          setResolveMessage('Error: Please select Yes or No for all options.');
          setResolveLoading(false);
          return;
        }
      } else {
        if (!resolveSelections.winner) {
          setResolveMessage('Error: Please select a winning outcome.');
          setResolveLoading(false);
          return;
        }
        winning_outcome_ids = [resolveSelections.winner];
      }

      const res = await fetch(`${API_URL}/api/markets/${resolvingMarket.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winning_outcome_ids })
      });

      const data = await res.json();
      if (res.ok) {
        setResolveMessage('Market resolved successfully!');
        setTimeout(() => {
          setResolvingMarket(null);
          setActiveMarkets(prev => prev.filter(m => m.id !== resolvingMarket.id));
        }, 1500);
      } else {
        setResolveMessage(`Error: ${data.error}`);
      }
    } catch (err) {
      setResolveMessage('Failed to connect to server.');
    } finally {
      setResolveLoading(false);
    }
  };

  // Change market status (pause → active toggle, or archive)
  const handleStatusChange = async (market, newStatus) => {
    setStatusLoading(market.id);
    try {
      const res = await fetch(`${API_URL}/api/markets/${market.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        // Remove from active list if no longer active
        setActiveMarkets(prev => prev.filter(m => m.id !== market.id));
      } else {
        alert('Failed to update market status. Backend endpoint may be missing.');
      }
    } catch (err) {
      console.error('Status change failed', err);
      alert('Failed to update market status. Ensure the backend is running.');
    } finally {
      setStatusLoading(null);
    }
  };

  // Open resolution confirm modal
  const handleOpenResolveConfirm = (e) => {
    e.preventDefault();
    let winning_outcome_ids = [];
    let winnerLabel = '';
    if (resolvingMarket.market_type === 'multi_multiple') {
      winning_outcome_ids = Object.values(resolveSelections);
      if (winning_outcome_ids.length !== resolvingMarket.outcomes.length / 2) {
        setResolveMessage('Error: Please select Yes or No for all options.');
        return;
      }
      const labels = winning_outcome_ids.map(id => resolvingMarket.outcomes.find(o => o.id === id)?.title);
      winnerLabel = labels.join(', ');
    } else {
      if (!resolveSelections.winner) {
        setResolveMessage('Error: Please select a winning outcome.');
        return;
      }
      winning_outcome_ids = [resolveSelections.winner];
      const w = resolvingMarket.outcomes.find(o => o.id === resolveSelections.winner);
      winnerLabel = w ? w.title : resolveSelections.winner;
    }
    setConfirmModal({ market: resolvingMarket, winnerLabel, winnerIds: winning_outcome_ids });
  };

  const handleConfirmResolve = async () => {
    if (!confirmModal) return;
    setConfirmModal(null);
    setResolveLoading(true);
    setResolveMessage('');
    try {
      const res = await fetch(`${API_URL}/api/markets/${confirmModal.market.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winning_outcome_ids: confirmModal.winnerIds })
      });
      const data = await res.json();
      if (res.ok) {
        setResolveMessage('Market resolved successfully!');
        setTimeout(() => {
          setResolvingMarket(null);
          setActiveMarkets(prev => prev.filter(m => m.id !== confirmModal.market.id));
        }, 1500);
      } else {
        setResolveMessage(`Error: ${data.error}`);
      }
    } catch (err) {
      setResolveMessage('Failed to connect to server.');
    } finally {
      setResolveLoading(false);
    }
  };

  const handleEditMarketChange = (field, value) => {
    setEditingMarket(prev => ({ ...prev, [field]: value }));
  };

  const handleEditOutcomeChange = (index, field, value) => {
    const newOutcomes = [...editingMarket.outcomes];
    newOutcomes[index] = { ...newOutcomes[index], [field]: value };
    setEditingMarket(prev => ({ ...prev, outcomes: newOutcomes }));
  };

  const handleUpdateMarket = async (e) => {
    e.preventDefault();
    setEditMarketLoading(true);
    setEditMarketMessage('');
    try {
      const res = await fetch(`${API_URL}/api/markets/${editingMarket.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editingMarket.title,
          category: editingMarket.category,
          description: editingMarket.description,
          image_url: editingMarket.image_url,
          close_date: editingMarket.close_date ? new Date(editingMarket.close_date).toISOString() : null,
          resolution_date: editingMarket.close_date ? new Date(editingMarket.close_date).toISOString() : null,
          outcomes: editingMarket.outcomes.map(o => ({
            id: o.id,
            title: o.title,
            probability: parseFloat(o.probability)
          }))
        })
      });
      const data = await res.json();
      if (res.ok) {
        setEditMarketMessage('Market updated successfully!');
        setActiveMarkets(prev => prev.map(m => m.id === data.id ? data : m));
        setTimeout(() => {
          setEditingMarket(null);
          setEditMarketMessage('');
        }, 1500);
      } else {
        setEditMarketMessage(`Error: ${data.error}`);
      }
    } catch (err) {
      setEditMarketMessage('Failed to connect to server.');
    } finally {
      setEditMarketLoading(false);
    }
  };

  if (!isAdmin) {
    return <div className="p-8 text-center text-slate-400">Checking permissions...</div>;
  }

  if (viewingUser) {
    return <AdminUserDashboard user={viewingUser} onBack={() => setViewingUser(null)} />;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Admin Dashboard</h1>
        <p className="text-slate-400 text-sm">Manage markets, users, and system settings.</p>
      </div>

      {/* Top Row: 3-col grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">

        {/* Left Column: System & Risk */}
        <div className="space-y-6">
          <div className="bg-slate-800 p-6 rounded-lg shadow-lg">
            <h2 className="text-xl font-semibold mb-4 text-white">System Overview</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-slate-700">
                <span className="text-slate-400">API Status</span>
                {health?.ok ? <span className="text-green-400 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>Online</span> : <span className="text-red-400">Offline</span>}
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-700">
                <span className="text-slate-400">Database</span>
                <span className="text-slate-300 capitalize">{health?.database || 'Unknown'}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-slate-400">Service</span>
                <span className="text-slate-300 font-mono text-sm">{health?.service || '—'}</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-800 p-6 rounded-lg shadow-lg">
            <h2 className="text-xl font-semibold mb-2 text-white">Risk Management</h2>
            <p className="text-sm text-slate-400 mb-4">
              Scan the database for users whose active stakes exceed their available balance, causing negative buying power.
            </p>

            <div className="flex flex-wrap gap-3 mb-4">
              <button
                onClick={handleScanBalances}
                disabled={scanLoading || fixLoading}
                className="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2 px-4 rounded text-sm transition-colors disabled:opacity-50"
              >
                {scanLoading ? 'Scanning...' : 'Scan Balances'}
              </button>

              {negativeUsers && negativeUsers.length > 0 && (
                <button
                  onClick={handleFixBalances}
                  disabled={fixLoading || scanLoading}
                  className="bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30 font-semibold py-2 px-4 rounded text-sm transition-colors disabled:opacity-50"
                >
                  {fixLoading ? 'Repairing...' : `Fix ${negativeUsers.length} Users`}
                </button>
              )}
            </div>

            {riskMessage && (
              <div className={`p-3 rounded text-sm ${riskMessage.startsWith('Error') || riskMessage.startsWith('Failed') ? 'bg-red-500/10 text-red-400 border border-red-500/30' : 'bg-slate-900/50 text-slate-300 border border-slate-700'}`}>
                {riskMessage}
              </div>
            )}

            {negativeUsers && negativeUsers.length > 0 && (
              <div className="mt-4 max-h-64 overflow-y-auto custom-scrollbar border border-slate-700 rounded bg-slate-900/50">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-800/80 text-slate-400 sticky top-0">
                    <tr>
                      <th className="p-2 font-medium border-b border-slate-700">User</th>
                      <th className="p-2 font-medium border-b border-slate-700">Deficit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {negativeUsers.map(u => (
                      <tr key={u.user_id}>
                        <td className="p-2 text-slate-300 truncate max-w-[150px]" title={u.user_id}>{u.username || u.user_id.substring(0, 8)}</td>
                        <td className="p-2 text-red-400">-${Math.abs(u.raw_balance).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Middle + Right Column: Email Composer (spans 2 cols on xl) */}
        <div className="xl:col-span-2">
          <div className="bg-slate-800 rounded-lg shadow-lg overflow-hidden">
            <div className="px-6 pt-5 pb-4 border-b border-slate-700">
              <h2 className="text-xl font-semibold text-white">Compose System Email</h2>
              <p className="text-slate-400 text-xs mt-0.5">Live preview updates as you type</p>
            </div>
            <div className="flex flex-col lg:flex-row">

              {/* Left: fields */}
              <form onSubmit={handleSendEmail} className="flex flex-col gap-3 p-5 lg:w-64 xl:w-72 flex-shrink-0 border-r border-slate-700">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-400 uppercase tracking-wide">To</label>
                  <input type="email" className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-white text-sm outline-none focus:border-amber-400 transition-colors" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="user@example.com" required />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-400 uppercase tracking-wide">Subject Line</label>
                  <input type="text" className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-white text-sm outline-none focus:border-amber-400 transition-colors" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Important update" required />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-400 uppercase tracking-wide">Hero Heading</label>
                  <input type="text" className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-white text-sm outline-none focus:border-amber-400 transition-colors" value={emailHeading} onChange={e => setEmailHeading(e.target.value)} placeholder="A message from Dobium" />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-400 uppercase tracking-wide">Greeting Name</label>
                  <input type="text" className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-white text-sm outline-none focus:border-amber-400 transition-colors" value={emailGreeting} onChange={e => setEmailGreeting(e.target.value)} placeholder="e.g. John (optional)" />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-400 uppercase tracking-wide">Message Body</label>
                  <textarea className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-white text-sm h-28 outline-none focus:border-amber-400 resize-none transition-colors" value={emailText} onChange={e => setEmailText(e.target.value)} placeholder="Write your message here..." required />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-400 uppercase tracking-wide">Callout Box <span className="text-slate-600 normal-case font-normal">(optional)</span></label>
                  <input type="text" className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-white text-sm outline-none focus:border-amber-400 transition-colors" value={emailCallout} onChange={e => setEmailCallout(e.target.value)} placeholder="Tip: Check out new markets" />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-400 uppercase tracking-wide">CTA Button Label <span className="text-slate-600 normal-case font-normal">(optional)</span></label>
                  <input type="text" className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-white text-sm outline-none focus:border-amber-400 transition-colors" value={emailCta} onChange={e => setEmailCta(e.target.value)} placeholder="Open Dobium →" />
                </div>
                {message && <p className={`text-xs ${message.startsWith('Error') || message.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>{message}</p>}
                <button type="submit" disabled={loading} className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-2.5 rounded-md transition-colors disabled:opacity-50 text-sm mt-1">
                  {loading ? 'Sending...' : 'Send Email'}
                </button>
              </form>

              {/* Right: live preview */}
              <div className="flex-1 p-5 bg-slate-900/40 overflow-auto">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-3 font-semibold">Preview</p>
                <div style={{ fontFamily: "Arial,sans-serif", maxWidth: 380, margin: "0 auto", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(212,175,55,0.2)", boxShadow: "0 4px 24px rgba(0,0,0,0.4)" }}>
                  {/* Gold top bar */}
                  <div style={{ height: 4, background: "linear-gradient(90deg,#b8952a,#d4af37,#f0cc6a,#d4af37,#b8952a)" }} />
                  {/* Header */}
                  <div style={{ background: "#071428", padding: "18px 20px", textAlign: "center" }}>
                    <img src="/Logo-Title.png" alt="Dobium" style={{ height: 30, width: "auto", display: "inline-block" }} />
                  </div>
                  {/* Hero */}
                  <div style={{ background: "#0d1f3c", padding: "20px 24px 16px", textAlign: "center", borderBottom: "1px solid rgba(212,175,55,0.15)" }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(212,175,55,0.15)", border: "1px solid rgba(212,175,55,0.4)", margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ color: "#d4af37", fontSize: 16 }}>✦</span>
                    </div>
                    <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{emailHeading || 'A message from Dobium'}</div>
                    <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>{emailSubject || 'Subject line will appear here'}</div>
                  </div>
                  {/* Body */}
                  <div style={{ background: "#ffffff", padding: "18px 24px" }}>
                    {emailGreeting && <p style={{ color: "#1e293b", fontSize: 13, marginBottom: 10, fontWeight: 500 }}>Hi {emailGreeting},</p>}
                    <p style={{ color: "#334155", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap", margin: 0 }}>{emailText || 'Your message will appear here...'}</p>
                    {emailCallout && (
                      <div style={{ margin: "14px 0", padding: "10px 14px", borderLeft: "3px solid #d4af37", background: "#fefce8", borderRadius: "0 6px 6px 0" }}>
                        <p style={{ margin: 0, color: "#92400e", fontSize: 11, lineHeight: 1.5 }}>{emailCallout}</p>
                      </div>
                    )}
                    {emailCta && (
                      <div style={{ textAlign: "center", margin: "16px 0 4px" }}>
                        <span style={{ display: "inline-block", padding: "10px 24px", background: "linear-gradient(135deg,#b8952a,#d4af37)", color: "#0f172a", fontWeight: 700, fontSize: 12, borderRadius: 7, cursor: "pointer" }}>{emailCta}</span>
                      </div>
                    )}
                  </div>
                  {/* Footer */}
                  <div style={{ background: "#f8fafc", padding: "12px 24px", borderTop: "1px solid #e2e8f0", textAlign: "center" }}>
                    <p style={{ color: "#94a3b8", fontSize: 10, margin: 0 }}>© {new Date().getFullYear()} Dobium · All rights reserved</p>
                    <p style={{ color: "#cbd5e1", fontSize: 10, margin: "4px 0 0" }}>You received this as a registered Dobium user.</p>
                  </div>
                  {/* Gold bottom bar */}
                  <div style={{ height: 3, background: "linear-gradient(90deg,#b8952a,#d4af37,#f0cc6a,#d4af37,#b8952a)" }} />
                </div>
              </div>

            </div>
          </div>
        </div>


      </div>

      {/* Registered Users — full-width */}
      <div className="bg-slate-800 p-6 rounded-lg shadow-lg mt-6">
        <h2 className="text-xl font-semibold mb-4 text-white">Registered Users ({users.length})</h2>
        <div className="overflow-y-auto custom-scrollbar border border-slate-700 rounded bg-slate-900/50" style={{ maxHeight: 400 }}>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-800/80 text-slate-400 sticky top-0">
              <tr>
                <th className="p-3 font-medium border-b border-slate-700 w-1/4">Username</th>
                <th className="p-3 font-medium border-b border-slate-700 w-1/2">Email</th>
                <th className="p-3 font-medium border-b border-slate-700 text-right w-1/4">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-slate-800/30 transition-colors cursor-pointer" onClick={() => setViewingUser(u)}>
                  <td className="p-3 text-slate-300 font-medium">{u.username}</td>
                  <td className="p-3 text-slate-400">{u.email || 'N/A'}</td>
                  <td className="p-3 text-slate-500 text-right whitespace-nowrap">{new Date(u.created_at || u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Market Creation Section */}
      <div className="bg-slate-800 p-6 rounded-lg shadow-lg mt-6">
        <h2 className="text-xl font-semibold mb-4 text-white">Create New Market</h2>
        <form onSubmit={handleCreateMarket} className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-slate-400">Title</label>
              <input
                type="text"
                className="w-full bg-slate-900/50 border border-slate-700 rounded p-2 text-white outline-none focus:border-amber-400 transition-colors"
                value={marketTitle}
                onChange={(e) => setMarketTitle(e.target.value)}
                placeholder="e.g. Will SpaceX reach Mars by 2027?"
                required
              />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1 text-slate-400">Category</label>
                <select
                  className="w-full bg-slate-900/50 border border-slate-700 rounded p-2 text-white outline-none focus:border-amber-400 transition-colors"
                  value={marketCategory}
                  onChange={(e) => setMarketCategory(e.target.value)}
                >
                  <option value="technology">Technology</option>
                  <option value="politics">Politics</option>
                  <option value="sports">Sports</option>
                  <option value="entertainment">Entertainment</option>
                  <option value="finance">Finance</option>
                  <option value="crypto">Crypto</option>
                  <option value="science">Science</option>
                  <option value="health">Health</option>
                  <option value="environment">Environment</option>
                  <option value="international">International</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1 text-slate-400">Type</label>
                <select
                  className="w-full bg-slate-900/50 border border-slate-700 rounded p-2 text-white outline-none focus:border-amber-400 transition-colors"
                  value={marketType}
                  onChange={handleMarketTypeChange}
                >
                  <option value="binary">Binary (Yes/No)</option>
                  <option value="multi_single">Multi (Single Choice)</option>
                  <option value="multi_multiple">Multi (Multiple Choice)</option>
                </select>
                {marketType === 'multi_single' && <p className="text-[10px] text-slate-500 mt-1">Resolves to exactly one winning outcome.</p>}
                {marketType === 'multi_multiple' && <p className="text-[10px] text-slate-500 mt-1">Each outcome becomes an independent Yes/No binary contract.</p>}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-slate-400">Close / Resolution Date</label>
              <input
                type="datetime-local"
                className="w-full bg-slate-900/50 border border-slate-700 rounded p-2 text-white outline-none focus:border-amber-400 transition-colors [&::-webkit-calendar-picker-indicator]:invert"
                value={marketCloseDate}
                onChange={(e) => setMarketCloseDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 space-y-4 flex flex-col">
            <div className="flex justify-between items-center mb-1">
              <label className="block text-sm font-medium text-slate-400">Outcomes</label>
              {marketType !== 'binary' && (
                <button
                  type="button"
                  onClick={addOutcome}
                  className="text-xs text-amber-400 hover:text-amber-300 font-semibold transition-colors"
                >
                  + Add Outcome
                </button>
              )}
            </div>
            <div className="space-y-3 max-h-64 overflow-y-auto custom-scrollbar pr-2 flex-1">
              {marketOutcomes.map((outcome, index) => (
                <div key={index} className="flex gap-2 items-center bg-slate-900/30 p-2 rounded border border-slate-700/50">
                  <input
                    type="text"
                    className="flex-1 bg-slate-900/50 border border-slate-700 rounded p-2 text-white outline-none focus:border-amber-400 transition-colors text-sm"
                    placeholder="Outcome Title"
                    value={outcome.title}
                    onChange={(e) => handleOutcomeChange(index, 'title', e.target.value)}
                    required
                    disabled={marketType === 'binary'}
                  />
                  <div className="relative w-24">
                    <input
                      type="number"
                      className="w-full bg-slate-900/50 border border-slate-700 rounded p-2 pr-6 text-white outline-none focus:border-amber-400 transition-colors text-sm"
                      placeholder="Prob"
                      min="0"
                      max="100"
                      step="0.1"
                      value={outcome.probability}
                      onChange={(e) => handleOutcomeChange(index, 'probability', e.target.value)}
                      required
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-sm">%</span>
                  </div>
                  {marketType !== 'binary' && marketOutcomes.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOutcome(index)}
                      className="text-red-400 hover:text-red-300 p-1 w-6 h-6 flex items-center justify-center rounded transition-colors"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            {createMarketMessage && (
              <p className={`text-sm py-1 ${createMarketMessage.startsWith('Error') || createMarketMessage.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>
                {createMarketMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={createMarketLoading}
              className="w-full mt-auto bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-2.5 px-4 rounded transition-colors disabled:opacity-50"
            >
              {createMarketLoading ? 'Creating...' : 'Publish Market'}
            </button>
          </div>
        </form>
      </div>

      {/* Active Markets Section */}
      <div className="bg-slate-800 p-6 rounded-lg shadow-lg mt-6">
        <h2 className="text-xl font-semibold mb-4 text-white">Manage Active Markets</h2>
        {!resolvingMarket && !editingMarket ? (
          <div className="space-y-3 max-h-[480px] overflow-y-auto custom-scrollbar">
            {activeMarkets.length === 0 ? (
              <p className="text-slate-400 text-sm">No active markets available.</p>
            ) : (
              activeMarkets.map(m => {
                const mPreds = allPredictions.filter(p => p.market_id === m.id && p.status === 'active');
                const traderCount = new Set(mPreds.map(p => p.user_id).filter(Boolean)).size;
                const topOutcome = (m.outcomes || []).slice().sort((a, b) => b.probability - a.probability)[0];
                return (
                  <div key={m.id} className="bg-slate-900/50 p-4 rounded border border-slate-700">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-white font-medium truncate">{m.title}</h3>
                        <p className="text-slate-500 text-xs mt-0.5">{m.market_type || 'binary'} · ID: {m.id.slice(0, 8)}</p>
                        {/* Inline stats */}
                        <div className="flex flex-wrap gap-3 mt-2">
                          <span className="text-xs text-slate-400">
                            <span className="text-amber-400 font-semibold">${(m.total_volume || 0).toLocaleString()}</span> volume
                          </span>
                          <span className="text-xs text-slate-400">
                            <span className="text-amber-400 font-semibold">{traderCount}</span> trader{traderCount !== 1 ? 's' : ''}
                          </span>
                          {topOutcome && (
                            <span className="text-xs text-slate-400">
                              <span className="text-green-400 font-semibold">{topOutcome.title}: {topOutcome.probability}%</span>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0 flex-wrap justify-end">
                        <button
                          onClick={() => setEditingMarket({ ...m, close_date: formatDateTimeLocal(m.close_date) })}
                          className="bg-blue-500/20 text-blue-400 border border-blue-500/50 hover:bg-blue-500/30 px-3 py-1.5 rounded font-semibold text-xs transition-colors"
                        >Edit</button>
                        <button
                          onClick={() => handleStatusChange(m, 'paused')}
                          disabled={statusLoading === m.id}
                          className="bg-slate-600/40 text-slate-300 border border-slate-600 hover:bg-slate-600/70 px-3 py-1.5 rounded font-semibold text-xs transition-colors disabled:opacity-40"
                        >{statusLoading === m.id ? '…' : 'Pause'}</button>
                        <button
                          onClick={() => handleStatusChange(m, 'archived')}
                          disabled={statusLoading === m.id}
                          className="bg-slate-700/40 text-slate-400 border border-slate-600 hover:bg-red-900/30 hover:text-red-400 hover:border-red-700/50 px-3 py-1.5 rounded font-semibold text-xs transition-colors disabled:opacity-40"
                        >Archive</button>
                        <button
                          onClick={() => { setResolvingMarket(m); setResolveSelections({}); setResolveMessage(''); }}
                          className="bg-amber-500/20 text-amber-400 border border-amber-500/50 hover:bg-amber-500/30 px-3 py-1.5 rounded font-semibold text-xs transition-colors"
                        >Resolve</button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : editingMarket ? (
          <div className="bg-slate-900/50 p-6 rounded border border-slate-700">
            <button
              onClick={() => { setEditingMarket(null); setEditMarketMessage(''); }}
              className="text-slate-400 hover:text-white text-sm mb-4 flex items-center gap-1"
            >
              ← Back to markets
            </button>
            <h3 className="text-lg font-semibold text-white mb-4">Edit Market: {editingMarket.id}</h3>

            <form onSubmit={handleUpdateMarket} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-400">Title</label>
                <input type="text" value={editingMarket.title} onChange={e => handleEditMarketChange('title', e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-white outline-none focus:border-blue-400 transition-colors" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-400">Description</label>
                <textarea value={editingMarket.description || ''} onChange={e => handleEditMarketChange('description', e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-white outline-none focus:border-blue-400 transition-colors h-24 resize-none" placeholder="Provide additional details..." />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-400">Image URL</label>
                <input type="url" value={editingMarket.image_url || ''} onChange={e => handleEditMarketChange('image_url', e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-white outline-none focus:border-blue-400 transition-colors" placeholder="https://..." />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-400">Category</label>
                <select
                  className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-white outline-none focus:border-blue-400 transition-colors"
                  value={editingMarket.category || 'technology'}
                  onChange={e => handleEditMarketChange('category', e.target.value)}
                >
                  <option value="technology">Technology</option>
                  <option value="politics">Politics</option>
                  <option value="sports">Sports</option>
                  <option value="entertainment">Entertainment</option>
                  <option value="finance">Finance</option>
                  <option value="crypto">Crypto</option>
                  <option value="science">Science</option>
                  <option value="health">Health</option>
                  <option value="environment">Environment</option>
                  <option value="international">International</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-400">Close / Resolution Date</label>
                <input type="datetime-local" value={editingMarket.close_date || ''} onChange={e => handleEditMarketChange('close_date', e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-white outline-none focus:border-blue-400 transition-colors [&::-webkit-calendar-picker-indicator]:invert" />
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium mb-2 text-slate-400">Outcomes</label>
                <div className="space-y-2">
                  {editingMarket.outcomes.map((o, idx) => (
                    <div key={o.id} className="flex gap-2 items-center bg-slate-900/30 p-2 rounded border border-slate-700/50">
                      <input type="text" value={o.title} onChange={e => handleEditOutcomeChange(idx, 'title', e.target.value)} className="flex-1 bg-slate-800/50 border border-slate-700 rounded p-2 text-white text-sm outline-none focus:border-blue-400 transition-colors" required />
                      <div className="relative w-24">
                        <input type="number" step="0.1" value={o.probability} onChange={e => handleEditOutcomeChange(idx, 'probability', e.target.value)} className="w-full bg-slate-800/50 border border-slate-700 rounded p-2 pr-6 text-white text-sm outline-none focus:border-blue-400 transition-colors" required />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-sm">%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {editMarketMessage && <p className={`text-sm py-1 ${editMarketMessage.startsWith('Error') || editMarketMessage.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>{editMarketMessage}</p>}

              <button type="submit" disabled={editMarketLoading} className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2.5 px-4 rounded transition-colors disabled:opacity-50 mt-4">
                {editMarketLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </div>
        ) : (
          <div className="bg-slate-900/50 p-6 rounded border border-slate-700">
            <button
              onClick={() => setResolvingMarket(null)}
              className="text-slate-400 hover:text-white text-sm mb-4 flex items-center gap-1"
            >
              ← Back to markets
            </button>
            <h3 className="text-lg font-semibold text-white mb-2">{resolvingMarket.title}</h3>
            <p className="text-slate-400 text-sm mb-6">
              {resolvingMarket.market_type === 'multi_multiple'
                ? 'Select Yes or No for each independent option to finalize this market.'
                : 'Select the single winning outcome to finalize this market.'}
            </p>

            <form onSubmit={handleOpenResolveConfirm} className="space-y-6">
              {resolvingMarket.market_type === 'multi_multiple' ? (
                // Grouped Binary Resolution
                Array.from({ length: Math.ceil(resolvingMarket.outcomes.length / 2) }).map((_, i) => {
                  const yes = resolvingMarket.outcomes[i * 2];
                  const no = resolvingMarket.outcomes[i * 2 + 1];
                  if (!yes || !no) return null;
                  const baseTitle = yes.title.replace(/\s*\(Yes\)$/i, '');
                  return (
                    <div key={yes.id} className="bg-slate-800/50 p-4 rounded border border-slate-700">
                      <p className="text-white font-medium mb-3">{baseTitle}</p>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name={`pair_${i}`} value={yes.id} checked={resolveSelections[i] === yes.id} onChange={() => setResolveSelections(prev => ({ ...prev, [i]: yes.id }))} className="text-amber-500 focus:ring-amber-500" />
                          <span className="text-green-400">Yes Occurred</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name={`pair_${i}`} value={no.id} checked={resolveSelections[i] === no.id} onChange={() => setResolveSelections(prev => ({ ...prev, [i]: no.id }))} className="text-amber-500 focus:ring-amber-500" />
                          <span className="text-red-400">No / Did Not Occur</span>
                        </label>
                      </div>
                    </div>
                  );
                })
              ) : (
                // Standard single-winner resolution
                <div className="space-y-2">
                  {resolvingMarket.outcomes.map(o => (
                    <label key={o.id} className="flex items-center gap-3 bg-slate-800/50 p-3 rounded border border-slate-700 cursor-pointer hover:bg-slate-800 transition-colors">
                      <input type="radio" name="winner" value={o.id} checked={resolveSelections.winner === o.id} onChange={() => setResolveSelections({ winner: o.id })} className="text-amber-500 focus:ring-amber-500 w-4 h-4" />
                      <span className="text-white">{o.title}</span>
                    </label>
                  ))}
                </div>
              )}

              {resolveMessage && <p className={`text-sm py-1 ${resolveMessage.startsWith('Error') || resolveMessage.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>{resolveMessage}</p>}

              <button type="submit" disabled={resolveLoading} className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-2.5 px-4 rounded transition-colors disabled:opacity-50">
                {resolveLoading ? 'Processing...' : 'Review & Resolve'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Position Monitoring */}
      {allPredictions.length > 0 && (
        <div className="bg-slate-800 p-6 rounded-lg shadow-lg mt-6">
          <h2 className="text-xl font-semibold mb-4 text-white">Position Monitoring</h2>
          <div className="space-y-2">
            {activeMarkets.slice(0, 8).map(m => {
              const mPreds = allPredictions.filter(p => p.market_id === m.id && p.status === 'active');
              if (mPreds.length === 0) return null;
              const totalExposure = mPreds.reduce((s, p) => s + (p.stake_amount || 0), 0);
              const uniqueTraders = new Set(mPreds.map(p => p.user_id).filter(Boolean)).size;
              // find largest single holder
              const holderMap = {};
              mPreds.forEach(p => { if (p.user_id) holderMap[p.user_id] = (holderMap[p.user_id] || 0) + (p.stake_amount || 0); });
              const maxHolder = Math.max(0, ...Object.values(holderMap));
              const concentration = totalExposure > 0 ? (maxHolder / totalExposure) * 100 : 0;
              return (
                <div key={m.id} className="flex items-center gap-3 bg-slate-900/50 px-4 py-3 rounded border border-slate-700">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{m.title}</p>
                  </div>
                  <div className="flex gap-4 text-xs flex-shrink-0">
                    <span className="text-slate-400">Exposure <span className="text-amber-400 font-semibold">${totalExposure.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></span>
                    <span className="text-slate-400">Traders <span className="text-amber-400 font-semibold">{uniqueTraders}</span></span>
                    <span className={`font-semibold ${concentration > 70 ? 'text-red-400' : concentration > 40 ? 'text-yellow-400' : 'text-green-400'}`}>
                      Top {concentration.toFixed(0)}%
                    </span>
                  </div>
                </div>
              );
            }).filter(Boolean)}
          </div>
        </div>
      )}

      {/* Resolution Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold text-lg">Confirm Resolution</h3>
                <p className="text-slate-400 text-sm">This action cannot be undone.</p>
              </div>
            </div>
            <div className="bg-slate-900/60 rounded-lg p-4 mb-5 border border-slate-700">
              <p className="text-slate-300 text-sm mb-1">Market</p>
              <p className="text-white font-medium">{confirmModal.market.title}</p>
              <p className="text-slate-300 text-sm mt-3 mb-1">Resolving as</p>
              <p className="text-amber-400 font-semibold">{confirmModal.winnerLabel}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2.5 rounded transition-colors"
              >Cancel</button>
              <button
                onClick={handleConfirmResolve}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-2.5 rounded transition-colors"
              >Confirm Resolution</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Broadcast Campaign Panel ──────────────────────────────────────────── */}
      <div className="bg-slate-800 rounded-lg shadow-lg mt-6 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-0 border-b border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Broadcast Campaigns</h2>
              <p className="text-slate-400 text-xs mt-0.5">Send bulk emails to all registered users</p>
            </div>
            <span className="text-xs font-bold px-2.5 py-1 bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-full">
              {users.length} users
            </span>
          </div>
          {/* Tabs */}
          <div className="flex gap-1">
            {[
              { id: 'presets', label: '📋 Preset Campaigns' },
              { id: 'custom', label: '✏️ Custom Compose' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => { setBroadcastTab(tab.id); setBroadcastPreview(null); setBroadcastMessage(''); }}
                className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors border-b-2 ${broadcastTab === tab.id
                  ? 'text-amber-400 border-amber-400 bg-slate-900/40'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
                  }`}
              >{tab.label}</button>
            ))}
          </div>
        </div>

        <div className="p-6">

          {/* ── PRESET TAB ── */}
          {broadcastTab === 'presets' && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-14 h-14 rounded-xl bg-slate-700/50 border border-slate-600 flex items-center justify-center text-2xl mb-4">📭</div>
              <p className="text-white font-semibold mb-1">No preset campaigns</p>
              <p className="text-slate-400 text-sm max-w-xs leading-relaxed">
                Preset campaigns will appear here when configured. Use <span className="text-amber-400 font-semibold">Custom Compose</span> to write and send a broadcast to all users.
              </p>
              <button
                onClick={() => { setBroadcastTab('custom'); setBroadcastPreview(null); setBroadcastMessage(''); }}
                className="mt-5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-2 px-5 rounded-lg text-sm transition-colors"
              >
                ✏️ Go to Custom Compose
              </button>
            </div>
          )}

          {/* ── CUSTOM COMPOSE TAB ── */}
          {broadcastTab === 'custom' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Subject line */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold mb-1.5 text-slate-400 uppercase tracking-wide">
                    Subject Line <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={customSubject}
                    onChange={e => setCustomSubject(e.target.value)}
                    placeholder="e.g. New markets just opened — check them out"
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-amber-400 transition-colors"
                  />
                </div>

                {/* Hero heading */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-slate-400 uppercase tracking-wide">
                    Hero Heading
                  </label>
                  <input
                    type="text"
                    value={customHeading}
                    onChange={e => setCustomHeading(e.target.value)}
                    placeholder="e.g. Markets Are Live"
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-amber-400 transition-colors"
                  />
                </div>

                {/* Hero icon */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-slate-400 uppercase tracking-wide">
                    Hero Emoji / Icon
                  </label>
                  <input
                    type="text"
                    value={customHeroIcon}
                    onChange={e => setCustomHeroIcon(e.target.value)}
                    placeholder="e.g. 🎯 or ✦"
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-amber-400 transition-colors"
                  />
                </div>
              </div>

              {/* Body */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-slate-400 uppercase tracking-wide">
                  Message Body <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={customBody}
                  onChange={e => setCustomBody(e.target.value)}
                  placeholder="Write your announcement here. Press Enter for new lines."
                  rows={5}
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-amber-400 resize-none transition-colors"
                />
              </div>

              {/* Callout box */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-slate-400 uppercase tracking-wide">
                  Callout Box <span className="text-slate-600 normal-case font-normal">(optional — appears in gold sidebar)</span>
                </label>
                <input
                  type="text"
                  value={customCallout}
                  onChange={e => setCustomCallout(e.target.value)}
                  placeholder="e.g. 📌 Paper trading mode — all positions use virtual funds."
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-amber-400 transition-colors"
                />
              </div>

              {/* CTA */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-slate-400 uppercase tracking-wide">
                    CTA Button Label <span className="text-slate-600 normal-case font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={customCtaLabel}
                    onChange={e => setCustomCtaLabel(e.target.value)}
                    placeholder="e.g. Start Trading →"
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-amber-400 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-slate-400 uppercase tracking-wide">
                    CTA Button URL <span className="text-slate-600 normal-case font-normal">(optional)</span>
                  </label>
                  <input
                    type="url"
                    value={customCtaUrl}
                    onChange={e => setCustomCtaUrl(e.target.value)}
                    placeholder="https://dobium.up.railway.app/explore"
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-amber-400 transition-colors"
                  />
                </div>
              </div>

              <button
                id="preview-custom-btn"
                onClick={handleCustomPreview}
                disabled={broadcastLoading || !customSubject || !customBody}
                className="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2.5 px-6 rounded-lg text-sm transition-colors disabled:opacity-40"
              >
                {broadcastLoading ? 'Generating preview…' : '🔍 Preview & Prepare Send'}
              </button>
            </div>
          )}

          {/* Status message */}
          {broadcastMessage && (
            <div className={`mt-5 px-4 py-3 rounded-lg text-sm border ${broadcastMessage.startsWith('✅')
              ? 'bg-green-500/10 text-green-400 border-green-500/30'
              : 'bg-red-500/10 text-red-400 border-red-500/30'
              }`}>
              {broadcastMessage}
            </div>
          )}

          {/* ── Shared preview panel (both tabs) ── */}
          {broadcastPreview && (
            <div className="mt-5 border border-amber-500/20 rounded-xl overflow-hidden bg-slate-900/40">
              {/* Preview header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700/60 bg-slate-800/60">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-white text-sm font-semibold">Email Preview</span>
                  <span className="text-slate-500 text-xs">·</span>
                  <span className="text-slate-400 text-xs truncate max-w-xs">{broadcastPreview.campaign.subject}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 bg-slate-700/60 rounded-lg px-3 py-1.5">
                    <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    <span className="text-amber-400 font-bold text-xs">{broadcastPreview.recipientCount}</span>
                    <span className="text-slate-400 text-xs">recipients</span>
                  </div>
                  <button
                    onClick={() => { setBroadcastPreview(null); setBroadcastMessage(''); }}
                    className="text-slate-500 hover:text-slate-300 text-xs transition-colors"
                  >✕ Close</button>
                </div>
              </div>

              {/* Two-column: iframe + sidebar */}
              <div className="flex flex-col xl:flex-row">
                <div className="flex-1 p-4 min-h-[480px]">
                  <iframe
                    ref={previewFrameRef}
                    title="Email Preview"
                    srcDoc={broadcastPreview.previewHtml}
                    className="w-full h-full min-h-[480px] rounded-lg border-0"
                    sandbox="allow-same-origin"
                    style={{ background: '#0a0f1e' }}
                  />
                </div>

                <div className="xl:w-64 border-t xl:border-t-0 xl:border-l border-slate-700/60 flex flex-col">
                  <div className="px-4 pt-4 pb-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Recipients</p>
                    <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-1.5">
                      {broadcastPreview.recipients.map((email, i) => (
                        <div key={i} className="flex items-center gap-2 py-1 px-2 rounded-lg bg-slate-800/50">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                          <span className="text-slate-300 text-xs truncate" title={email}>{email}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-auto p-4 border-t border-slate-700/60">
                    <div className="bg-amber-500/10 border border-amber-500/25 rounded-lg p-3 mb-3">
                      <p className="text-amber-400 text-xs font-semibold mb-0.5">⚠️ Live Send</p>
                      <p className="text-slate-400 text-xs leading-relaxed">
                        Sends real emails to all <strong className="text-white">{broadcastPreview.recipientCount}</strong> recipients. Cannot be undone.
                      </p>
                    </div>
                    <button
                      id="send-broadcast-btn"
                      onClick={() => setShowBroadcastConfirm(true)}
                      disabled={broadcastSending}
                      className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
                    >
                      {broadcastSending ? 'Sending…' : `Send to ${broadcastPreview.recipientCount} Users →`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Broadcast Confirm Modal ───────────────────────────────────────────── */}
      {showBroadcastConfirm && broadcastPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-800 border border-amber-500/30 rounded-2xl p-7 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-4 mb-5">
              <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-2xl flex-shrink-0">📤</div>
              <div>
                <h3 className="text-white font-bold text-lg">Confirm Broadcast</h3>
                <p className="text-slate-400 text-sm">This will send live emails. Cannot be undone.</p>
              </div>
            </div>

            <div className="bg-slate-900/70 rounded-xl p-4 mb-5 border border-slate-700 space-y-3">
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Campaign</p>
                <p className="text-white font-semibold text-sm">{broadcastPreview.campaign.name}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Subject</p>
                <p className="text-amber-400 text-sm font-mono">{broadcastPreview.campaign.subject}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Recipients</p>
                <p className="text-white font-bold text-xl">{broadcastPreview.recipientCount} <span className="text-slate-400 text-sm font-normal">users</span></p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowBroadcastConfirm(false)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl transition-colors"
              >Cancel</button>
              <button
                id="confirm-broadcast-send-btn"
                onClick={handleBroadcastSend}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-3 rounded-xl transition-colors"
              >
                ✅ Confirm & Send
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
