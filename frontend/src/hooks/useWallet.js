import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from './useAuth';

const PAPER_TRADING_STARTING_BALANCE = 100000;

export function useWallet() {
  const { session } = useAuth();
  const userId = session?.user?.id || 'demo_user';
  const [wallet, setWallet] = useState({
    balance: PAPER_TRADING_STARTING_BALANCE,
    buyingPower: PAPER_TRADING_STARTING_BALANCE,
    rawBalance: PAPER_TRADING_STARTING_BALANCE,
    cashBalance: PAPER_TRADING_STARTING_BALANCE,
    paperStartingBalance: PAPER_TRADING_STARTING_BALANCE,
    totalDeposited: 0,
    totalWithdrawn: 0,
    activeStakes: 0,
    realizedPnl: 0,
    realizedStake: 0,
    realizedReturn: 0,
  });
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchWallet = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getBalance(userId);
      const buyingPower = data.buying_power ?? data.balance ?? PAPER_TRADING_STARTING_BALANCE;
      setWallet({
        balance: buyingPower,
        buyingPower,
        rawBalance: data.raw_balance ?? buyingPower,
        cashBalance: data.cash_balance ?? (data.paper_starting_balance ?? PAPER_TRADING_STARTING_BALANCE),
        paperStartingBalance: data.paper_starting_balance ?? PAPER_TRADING_STARTING_BALANCE,
        totalDeposited: data.total_deposited ?? 0,
        totalWithdrawn: data.total_withdrawn ?? 0,
        activeStakes: data.active_stakes ?? 0,
        realizedPnl: data.realized_pnl ?? 0,
        realizedStake: data.realized_stake ?? 0,
        realizedReturn: data.realized_return ?? 0,
      });
    } catch {
      setWallet({
        balance: PAPER_TRADING_STARTING_BALANCE,
        buyingPower: PAPER_TRADING_STARTING_BALANCE,
        rawBalance: PAPER_TRADING_STARTING_BALANCE,
        cashBalance: PAPER_TRADING_STARTING_BALANCE,
        paperStartingBalance: PAPER_TRADING_STARTING_BALANCE,
        totalDeposited: 0,
        totalWithdrawn: 0,
        activeStakes: 0,
        realizedPnl: 0,
        realizedStake: 0,
        realizedReturn: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const fetchTransactions = useCallback(async () => {
    try {
      const data = await api.getTransactions(userId);
      setTransactions(Array.isArray(data) ? data : []);
    } catch { setTransactions([]); }
  }, [userId]);

  useEffect(() => {
    fetchWallet();
    fetchTransactions();
  }, [fetchWallet, fetchTransactions]);

  const refetch = useCallback(async () => {
    await Promise.all([fetchWallet(), fetchTransactions()]);
  }, [fetchWallet, fetchTransactions]);

  return { balance: wallet.balance, wallet, transactions, loading, refetch };
}
