import { useState, useEffect } from 'react';

export default function PaperTradingDisclaimer() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if user has dismissed the disclaimer today
    const lastDismissed = localStorage.getItem('paperTradingDisclaimerDismissed');
    const today = new Date().toDateString();

    if (lastDismissed !== today) {
      setIsVisible(true);
    }
  }, []);

  const handleDismiss = () => {
    const today = new Date().toDateString();
    localStorage.setItem('paperTradingDisclaimerDismissed', today);
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="disclaimer-overlay">
      <div className="disclaimer-modal">
        <div className="disclaimer-header">
          <h2 className="disclaimer-title">⚠️ Paper Trading Simulation</h2>
        </div>

        <div className="disclaimer-content">
          <p>
            <strong>Dobium is currently operating in paper trading mode.</strong> This means:
          </p>
          <ul className="disclaimer-list">
            <li>All trades are simulated with virtual funds</li>
            <li>No real money or assets are involved</li>
            <li>This is for learning and testing purposes only</li>
            <li>Market data may not reflect real-time prices</li>
          </ul>
          <p style={{ marginTop: 16, fontSize: 13, color: '#94a3b8' }}>
            When the platform transitions to live trading, you will be notified. Real capital will be required to participate in live markets.
          </p>
        </div>

        <button className="btn btn-primary btn-full" onClick={handleDismiss}>
          I Understand
        </button>
      </div>

      <style>{`
        .disclaimer-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        }

        .disclaimer-modal {
          background: #0f172a;
          border: 1px solid rgba(212, 175, 55, 0.3);
          border-radius: 16px;
          padding: 32px;
          max-width: 480px;
          width: 90%;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
        }

        .disclaimer-header {
          margin-bottom: 24px;
        }

        .disclaimer-title {
          font-family: "DM Serif Text", serif;
          font-size: 20px;
          font-weight: 700;
          color: #f1f5f9;
          margin: 0;
          text-align: center;
        }

        .disclaimer-content {
          margin-bottom: 24px;
          font-size: 14px;
          color: #cbd5e1;
          line-height: 1.6;
        }

        .disclaimer-content p {
          margin: 0 0 12px 0;
        }

        .disclaimer-list {
          list-style: none;
          padding: 0;
          margin: 12px 0;
        }

        .disclaimer-list li {
          padding-left: 24px;
          position: relative;
          margin-bottom: 8px;
        }

        .disclaimer-list li:before {
          content: "→";
          position: absolute;
          left: 0;
          color: #d4af37;
          font-weight: bold;
        }
      `}</style>
    </div>
  );
}
