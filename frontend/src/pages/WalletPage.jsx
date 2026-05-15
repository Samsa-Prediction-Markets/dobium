import { useWallet } from '../hooks/useWallet';
import { useAuth } from '../hooks/useAuth';
import { formatCurrency, formatRelativeTime } from '../store/storage';
import { useState } from 'react';
import { api } from '../api/client';

export default function WalletPage() {
  const { balance, transactions, loading, refetch } = useWallet();
  const { session } = useAuth();
  const [amount, setAmount] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const userId = session?.user?.id || 'demo_user';

  const handleDeposit = async (e) => {
    e.preventDefault();
    setMsg('');
    setActionLoading(true);
    try {
      await api.deposit(userId, parseFloat(amount));
      setMsg('Deposit processed!');
      setAmount('');
      refetch();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault();
    setMsg('');
    setActionLoading(true);
    try {
      await api.withdraw(userId, parseFloat(amount));
      setMsg('Withdrawal processed!');
      setAmount('');
      refetch();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="page-header">
        <h1 className="page-title">Wallet</h1>
        <p className="page-subtitle">Manage your funds</p>
      </div>

      <div className="wallet-hero">
        <div className="wallet-balance-label">Available Balance</div>
        <div className="wallet-balance-amount">{formatCurrency(balance)}</div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-title">Quick Transfer</div>
        <form style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Amount (USD)</label>
            <input
              className="form-input"
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="100.00"
            />
          </div>
          <button className="btn btn-primary" onClick={handleDeposit} disabled={actionLoading || !amount}>
            Deposit
          </button>
          <button className="btn btn-secondary" onClick={handleWithdraw} disabled={actionLoading || !amount}>
            Withdraw
          </button>
        </form>
        {msg && (
          <p style={{ marginTop: 10, fontSize: 13, color: msg.endsWith('processed!') ? 'var(--green)' : 'var(--red)' }}>
            {msg}
          </p>
        )}
      </div>

      <div className="section-title">Transaction History</div>
      {loading
        ? <div className="loading-center"><div className="spinner" /></div>
        : transactions.length === 0
          ? <div className="empty-state"><p>No transactions yet.</p></div>
          : (
            <div className="tx-list">
              {transactions.map(tx => {
                const isDebit = tx.type === 'withdrawal';
                return (
                  <div key={tx.id} className="tx-item">
                    <div className={`tx-icon ${tx.type}`}>
                      {isDebit ? '-' : '+'}
                    </div>
                    <div className="tx-info">
                      <div className="tx-type">{tx.type}</div>
                      <div className="tx-date">{formatRelativeTime(tx.created_at)}</div>
                    </div>
                    <div className={`tx-amount ${tx.type}`}>
                      {isDebit ? '-' : '+'}{formatCurrency(tx.amount)}
                    </div>
                  </div>
                );
              })}
            </div>
          )
      }
    </div>
  );
}
