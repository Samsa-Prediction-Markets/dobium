import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function AuthPage() {
  const { login, loginWithGoogle, resetPassword } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState('login'); // login | reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const clear = () => { setError(''); setInfo(''); };

  const handleLogin = async (e) => {
    e.preventDefault(); clear(); setLoading(true);
    try { await login(email, password); navigate('/'); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleReset = async (e) => {
    e.preventDefault(); clear(); setLoading(true);
    try { await resetPassword(email); setInfo('Password reset link sent to your email.'); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleGoogle = async () => {
    clear(); setLoading(true);
    try { await loginWithGoogle(); }
    catch (err) { setError(err.message); setLoading(false); }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/Logo-Title.png" alt="Samsa Prediction Markets" style={{ height: 64 }} />
        </div>

        {view === 'login' && (
          <>
            <h1 className="auth-title">Welcome back</h1>
            <p className="auth-subtitle">Sign in to your account</p>

            {/* Google — primary CTA */}
            <button className="btn-google" onClick={handleGoogle} disabled={loading}>
              <GoogleIcon />
              <span>Continue with Google</span>
            </button>

            <div className="auth-divider">or sign in with email</div>

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input id="loginEmail" className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input id="loginPassword" className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
              </div>
              <button
                type="button"
                className="link-btn"
                onClick={() => { clear(); setView('reset'); }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'right',
                  padding: '2px 0',
                  marginTop: '-4px',
                  marginBottom: '6px',
                  color: '#d4af37',
                  fontSize: 13,
                  fontWeight: 600,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Forgot password?
              </button>
              {error && <p className="form-error">{error}</p>}
              {info && <p style={{ fontSize: 12, color: 'var(--green)' }}>{info}</p>}
              <button id="loginSubmit" className="btn btn-primary btn-full" type="submit" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: '#cbd5e1' }}>
              <button className="link-btn" onClick={() => navigate('/')}>Create account</button>
            </div>
          </>
        )}

        {view === 'reset' && (
          <>
            <h1 className="auth-title">Reset password</h1>
            <p className="auth-subtitle">We'll send you a reset link</p>
            <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input id="resetEmail" className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
              </div>
              {error && <p className="form-error">{error}</p>}
              {info && <p style={{ fontSize: 12, color: 'var(--green)' }}>{info}</p>}
              <button id="resetSubmit" className="btn btn-primary btn-full" type="submit" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: '#cbd5e1' }}>
              <button className="link-btn" onClick={() => { clear(); setView('login'); }}>Back to sign in</button>
            </div>
          </>
        )}
      </div>

      <style>{`
        .link-btn { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 13px; padding: 0; }
        .link-btn:hover { text-decoration: underline; }
        .btn-google {
          display: flex; align-items: center; justify-content: center; gap: 10px;
          width: 100%; padding: 11px 16px; border-radius: 10px;
          background: #fff; border: 1.5px solid #e2e8f0; color: #1a1a2e;
          font-size: 14px; font-weight: 600; cursor: pointer;
          transition: background 0.15s, box-shadow 0.15s;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .btn-google:hover:not(:disabled) { background: #f8fafc; box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
        .btn-google:disabled { opacity: 0.6; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
