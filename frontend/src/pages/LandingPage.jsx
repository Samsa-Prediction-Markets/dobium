import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function LandingPage() {
  const { signup, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  const slides = [
    {
      title: 'Welcome',
      description: 'Trade probabilities, not just prices. Take positions on real-world outcomes using dynamically scaled risk and reward.',
      highlight: 'Probability-based trading',
      icon: '📈',
    },
    {
      title: 'How It Works',
      description: 'Every market has a live probability score. Lower probability positions carry higher exposure, while higher probability positions carry lower exposure.',
      highlight: 'Risk scales with probability',
      icon: '⚙️',
    },
    {
      title: 'Multi-Outcome Markets',
      description: 'Go beyond binary events. Trade on multi-option outcomes, independent events, and build positions across multiple outcomes simultaneously.',
      highlight: 'Flexible market structures',
      icon: '🎯',
    },
    {
      title: 'Structured Risk',
      description: 'Exposure scales with probability instead of all-or-nothing payouts. This creates smoother risk management and more flexible trading behavior.',
      highlight: 'Proportional payouts',
      icon: '💼',
    },
    {
      title: 'Dynamic Pricing',
      description: 'Probabilities update as users trade. Market activity continuously shapes pricing and exposure across outcomes in real time.',
      highlight: 'Live market movements',
      icon: '📊',
    },
    {
      title: 'Portfolio Management',
      description: 'Track positions, manage exposure, and diversify across markets. Designed for probability traders who want strategic position management.',
      highlight: 'Advanced trading tools',
      icon: '💰',
    },
    {
      title: 'Paper Trading Mode',
      description: 'Currently in paper trading mode. Test strategies, explore markets, and learn the platform without risking real money.',
      highlight: 'Risk-free learning',
      icon: '🎓',
    },
    {
      title: 'Get Started',
      description: 'Create positions, follow market movements, and start trading probabilities in real time. Join Dobium today.',
      highlight: 'Begin probability trading',
      icon: '🚀',
    },
  ];

  const handleSignup = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await signup(email, password);
      setInfo('Check your email to verify your account.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setInfo('');
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="landing-page">
      {/* Left Side - Signup Form */}
      <div className="landing-left">
        <div className="landing-form-container">
          <div className="landing-logo">
            <img src="/Logo-Title.png" alt="Dobium Prediction Markets" style={{ height: 64 }} />
          </div>

          <h1 className="landing-main-title">Get Started</h1>
          <p className="landing-main-subtitle">Join the prediction market revolution</p>

          <button className="btn-google" onClick={handleGoogle} disabled={loading}>
            <GoogleIcon />
            <span>Sign up with Google</span>
          </button>

          <div className="auth-divider">or sign up with email</div>

          <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm password</label>
              <input
                className="form-input"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {error && <p className="form-error">{error}</p>}
            {info && <p style={{ fontSize: 12, color: 'var(--green)' }}>{info}</p>}
            <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create account'}
            </button>
          </form>

          <div style={{ marginTop: 24, textAlign: 'center', fontSize: 14, color: '#cbd5e1' }}>
            Already have an account?{' '}
            <button
              className="link-btn"
              onClick={() => navigate('/auth')}
            >
              Sign in
            </button>
          </div>
        </div>
      </div>

      {/* Right Side - Slideshow */}
      <div className="landing-right">
        <div className="slideshow-container">
          <div className="slides-wrapper">
            {slides.map((slide, idx) => (
              <div
                key={idx}
                className={`slide ${idx === currentSlide ? 'active' : ''}`}
              >
                <div className="slide-icon">{slide.icon}</div>
                <h2 className="slide-title">{slide.title}</h2>
                <p className="slide-description">{slide.description}</p>
                <div className="slide-highlight">{slide.highlight}</div>
              </div>
            ))}
          </div>

          {/* Dots Navigation */}
          <div className="slideshow-dots">
            {slides.map((_, idx) => (
              <button
                key={idx}
                className={`dot ${idx === currentSlide ? 'active' : ''}`}
                onClick={() => setCurrentSlide(idx)}
                aria-label={`Go to slide ${idx + 1}`}
              />
            ))}
          </div>

          {/* Auto-advance slide every 5 seconds */}
          {typeof window !== 'undefined' && (
            <Slideshow currentSlide={currentSlide} setCurrentSlide={setCurrentSlide} totalSlides={slides.length} />
          )}
        </div>
      </div>

      <style>{`
        .link-btn { 
          background: none; 
          border: none; 
          color: #d4af37; 
          cursor: pointer; 
          font-size: 13px; 
          padding: 0;
          font-weight: 600;
          font-family: "Jost", sans-serif;
          transition: color 0.2s;
        }
        .link-btn:hover { 
          color: #e4bd3f;
          text-decoration: underline; 
        }
        
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

function Slideshow({ currentSlide, setCurrentSlide, totalSlides }) {
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % totalSlides);
    }, 5000);
    return () => clearInterval(interval);
  }, [totalSlides, setCurrentSlide]);

  return null;
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
