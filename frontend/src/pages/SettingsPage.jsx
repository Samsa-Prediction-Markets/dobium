import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { storage } from '../store/storage';

export default function SettingsPage() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/auth');
  };

  const handleClearData = () => {
    storage.clear();
    window.location.reload();
  };

  const email = session?.user?.email || 'Not logged in';
  const createdAt = session?.user?.created_at ? new Date(session.user.created_at).toLocaleDateString() : '—';

  return (
    <div className="max-w-7xl mx-auto p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
        <p className="text-slate-400">Manage your account and preferences</p>
      </div>

      <div className="max-w-2xl">
        {/* Account Section */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-yellow-400 mb-4">Account</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-3 border-b border-slate-800">
              <div>
                <div className="text-sm font-semibold text-white">Email</div>
                <div className="text-xs text-slate-500 mt-0.5">{email}</div>
              </div>
            </div>
            <div className="flex justify-between items-center py-3">
              <div>
                <div className="text-sm font-semibold text-white">Member Since</div>
                <div className="text-xs text-slate-500 mt-0.5">{createdAt}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Preferences Section */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-yellow-400 mb-4">Preferences</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-3 border-b border-slate-800">
              <div>
                <div className="text-sm font-semibold text-white">Theme</div>
                <div className="text-xs text-slate-500 mt-0.5">Dark (default)</div>
              </div>
              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-500/20 text-blue-400">Dark</span>
            </div>
            <div className="flex justify-between items-center py-3">
              <div>
                <div className="text-sm font-semibold text-white">Currency</div>
                <div className="text-xs text-slate-500 mt-0.5">US Dollar</div>
              </div>
              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-700/30 text-slate-400">USD</span>
            </div>
          </div>
        </div>

        {/* Data Section */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-yellow-400 mb-4">Data</h2>
          <div className="flex justify-between items-center py-3">
            <div>
              <div className="text-sm font-semibold text-white">Clear Local Data</div>
              <div className="text-xs text-slate-500 mt-0.5">Removes favorites and cache</div>
            </div>
            <button
              onClick={handleClearData}
              className="px-4 py-2 text-sm font-semibold bg-slate-800 border border-slate-700 hover:border-slate-600 text-white rounded-lg transition-all"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Paper Trading Disclaimer Section */}
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-5 mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-yellow-400 mb-4">⚠️ Paper Trading Mode</h2>
          <div className="space-y-2 text-sm text-slate-300">
            <p className="font-semibold text-white">Dobium is currently in paper trading mode.</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>All trades use virtual funds only</li>
              <li>No real money or assets are involved</li>
              <li>This is for learning and testing purposes</li>
              <li>Market data may not be real-time</li>
            </ul>
            <p className="text-xs text-slate-400 mt-3">
              When live trading becomes available, you will be notified and real capital will be required.
            </p>
          </div>
        </div>

        {/* Session Section */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-yellow-400 mb-4">Session</h2>
          {session ? (
            <button
              onClick={handleLogout}
              className="w-full px-4 py-3 bg-red-500/20 border border-red-500/30 text-red-400 font-semibold rounded-lg hover:bg-red-500/30 transition-all"
            >
              Log out
            </button>
          ) : (
            <button
              onClick={() => navigate('/auth')}
              className="w-full px-4 py-3 bg-gradient-to-r from-yellow-500 to-yellow-600 text-slate-950 font-semibold rounded-lg hover:brightness-110 transition"
            >
              Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
