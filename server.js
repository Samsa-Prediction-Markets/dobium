const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { nanoid } = require('nanoid');
const { readJson, writeJson } = require('./lib/datastore');

const app = express();
const PORT = process.env.PORT || 3001;
const PAPER_TRADING_STARTING_BALANCE = Number(process.env.PAPER_TRADING_STARTING_BALANCE || 100000);

const DATA_DIR = path.join(__dirname, 'data');
const MARKETS_PATH = path.join(DATA_DIR, 'markets.json');
const PREDICTIONS_PATH = path.join(DATA_DIR, 'predictions.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const TRANSACTIONS_PATH = path.join(DATA_DIR, 'transactions.json');

// CORS configuration - allow requests from Railway frontend
const corsOptions = {
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://dobium.up.railway.app',
    /\.railway\.app$/  // Allow all Railway domains
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(morgan('dev'));

// Serve the frontend bundle from root
app.use(express.static(__dirname));

// Root route to load the app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function recomputeMarketStats(market) {
  const totalStake = market.outcomes.reduce((sum, o) => sum + (o.total_stake || 0), 0);
  market.total_volume = totalStake;
  if (totalStake > 0) {
    market.outcomes.forEach((o) => {
      o.probability = Math.round(((o.total_stake || 0) / totalStake) * 100);
    });
  }
}

function calculatePositionValue(stake, entryProbability, currentProbability) {
  const S = Number(stake || 0);
  const pEntry = Math.max(0, Math.min(100, Number(entryProbability || 0))) / 100;
  const pCurrent = Math.max(0, Math.min(100, Number(currentProbability || 0))) / 100;
  const maxReturn = S + S * (1 - pEntry);
  const minReturn = S * pEntry;
  return Number((minReturn + (maxReturn - minReturn) * pCurrent).toFixed(2));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'samsa-api' });
});

// ============================================================================
// LEAGUE STATS
// ============================================================================

// Get stats for a specific league (active markets, volume, predictions)
app.get('/api/leagues/:leagueId/stats', async (req, res) => {
  const { leagueId } = req.params;
  const markets = await readJson(MARKETS_PATH);
  const predictions = await readJson(PREDICTIONS_PATH);

  // Filter markets that belong to this league (by matching league ID in market data)
  // For now, markets don't have league_id, so we return aggregated defaults
  // When markets have league associations, filter by: m.league_id === leagueId
  const leagueMarkets = markets.filter(m => m.league_id === leagueId && m.status === 'active');

  // Calculate stats
  const activeMarkets = leagueMarkets.length;
  const totalVolume = leagueMarkets.reduce((sum, m) => sum + (m.total_volume || 0), 0);

  // Count predictions for league markets
  const leagueMarketIds = leagueMarkets.map(m => m.id);
  const leaguePredictions = predictions.filter(p => leagueMarketIds.includes(p.market_id)).length;

  res.json({
    league_id: leagueId,
    active_markets: activeMarkets,
    total_volume: totalVolume,
    predictions: leaguePredictions
  });
});

// ============================================================================
// CURRENT EVENTS / TRENDING MARKETS
// ============================================================================

// Get markets based on current events (closing soon, high volume, trending topics)
app.get('/api/markets/current-events', async (req, res) => {
  const markets = await readJson(MARKETS_PATH);
  const now = new Date();
  const sixMonthsFromNow = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);

  // Filter markets that are:
  // 1. Active
  // 2. Closing within the next 6 months (timely)
  // 3. Have significant volume or are newly created
  const currentEventMarkets = markets
    .filter(m => m.status === 'active')
    .filter(m => {
      if (!m.close_date) return true;
      const closeDate = new Date(m.close_date);
      return closeDate <= sixMonthsFromNow && closeDate > now;
    })
    .sort((a, b) => {
      // Sort by a combination of volume and how soon they close
      const aClose = new Date(a.close_date || '2099-12-31');
      const bClose = new Date(b.close_date || '2099-12-31');
      const aUrgency = (aClose - now) / (1000 * 60 * 60 * 24); // days until close
      const bUrgency = (bClose - now) / (1000 * 60 * 60 * 24);

      // Score: higher volume + sooner closing = higher score
      const aScore = (a.total_volume || 0) / 1000 - aUrgency / 10;
      const bScore = (b.total_volume || 0) / 1000 - bUrgency / 10;
      return bScore - aScore;
    });

  res.json(currentEventMarkets);
});

// Get trending markets (highest 24h volume)
app.get('/api/markets/trending', async (req, res) => {
  const markets = await readJson(MARKETS_PATH);
  const limit = parseInt(req.query.limit) || 10;

  const trendingMarkets = markets
    .filter(m => m.status === 'active')
    .sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0))
    .slice(0, limit);

  res.json(trendingMarkets);
});

// Get markets by category
app.get('/api/markets/category/:category', async (req, res) => {
  const markets = await readJson(MARKETS_PATH);
  const { category } = req.params;

  const categoryMarkets = markets.filter(m =>
    m.status === 'active' &&
    m.category.toLowerCase() === category.toLowerCase()
  );

  res.json(categoryMarkets);
});

// Generate suggested markets based on current news topics
app.get('/api/markets/suggestions', async (req, res) => {
  // This returns template suggestions for new markets based on trending topics
  const suggestions = [
    {
      topic: "Technology",
      suggestions: [
        { title: "Will OpenAI release GPT-5 by Q2 2025?", category: "technology" },
        { title: "Will Apple's Vision Pro 2 launch in 2025?", category: "technology" },
        { title: "Will TikTok be banned in the US?", category: "technology" }
      ]
    },
    {
      topic: "Politics",
      suggestions: [
        { title: "Will there be a government shutdown in Q1 2025?", category: "politics" },
        { title: "Will immigration reform pass in 2025?", category: "politics" },
        { title: "Will the debt ceiling be raised without crisis?", category: "politics" }
      ]
    },
    {
      topic: "Sports",
      suggestions: [
        { title: "Super Bowl LIX predictions", category: "sports" },
        { title: "2025 NBA All-Star Game MVP", category: "sports" },
        { title: "College Football Playoff Champion", category: "sports" }
      ]
    },
    {
      topic: "Entertainment",
      suggestions: [
        { title: "2025 Grammy Awards predictions", category: "entertainment" },
        { title: "Golden Globes Best Picture", category: "entertainment" },
        { title: "2025 Oscar Best Picture", category: "entertainment" }
      ]
    },
    {
      topic: "Finance",
      suggestions: [
        { title: "Fed interest rate decisions", category: "finance" },
        { title: "S&P 500 performance predictions", category: "finance" },
        { title: "Cryptocurrency price predictions", category: "crypto" }
      ]
    },
    {
      topic: "International",
      suggestions: [
        { title: "Ukraine-Russia conflict resolution", category: "international" },
        { title: "Middle East developments", category: "international" },
        { title: "Global trade agreements", category: "international" }
      ]
    }
  ];

  res.json(suggestions);
});

app.get('/api/markets', async (req, res) => {
  const markets = await readJson(MARKETS_PATH);
  res.json(markets);
});

app.get('/api/markets/:id', async (req, res) => {
  const markets = await readJson(MARKETS_PATH);
  const market = markets.find((m) => m.id === req.params.id);
  if (!market) return res.status(404).json({ error: 'Market not found' });
  res.json(market);
});

app.post('/api/markets', async (req, res) => {
  const {
    title,
    description,
    category,
    outcomes = [],
    image_url = '',
    search_keywords = '',
    close_date = null,
    resolution_date = null
  } = req.body;

  if (!title || !description || !category || !Array.isArray(outcomes) || outcomes.length < 2) {
    return res.status(400).json({ error: 'Invalid market payload' });
  }

  const markets = await readJson(MARKETS_PATH);

  const normalizedOutcomes = outcomes.map((o) => ({
    id: o.id || nanoid(8),
    title: o.title,
    probability: typeof o.probability === 'number' ? o.probability : Math.round(100 / outcomes.length),
    total_stake: typeof o.total_stake === 'number' ? o.total_stake : 0
  }));

  const market = {
    id: nanoid(12),
    title,
    description,
    category,
    status: 'active',
    close_date,
    resolution_date,
    outcomes: normalizedOutcomes,
    total_volume: 0,
    image_url,
    winning_outcome_id: null,
    search_keywords
  };

  recomputeMarketStats(market);
  markets.push(market);
  await writeJson(MARKETS_PATH, markets);
  res.status(201).json(market);
});

app.get('/api/predictions', async (req, res) => {
  const predictions = await readJson(PREDICTIONS_PATH);
  const { market_id } = req.query;
  if (market_id) {
    return res.json(predictions.filter((p) => p.market_id === market_id));
  }
  res.json(predictions);
});

app.post('/api/predictions', async (req, res) => {
  const {
    market_id,
    outcome_id,
    stake_amount,
    odds_at_prediction,
    user_id = null
  } = req.body;

  if (!market_id || !outcome_id || typeof stake_amount !== 'number' || typeof odds_at_prediction !== 'number') {
    return res.status(400).json({ error: 'Invalid prediction payload' });
  }

  if (stake_amount <= 0) {
    return res.status(400).json({ error: 'Stake amount must be greater than zero' });
  }

  const markets = await readJson(MARKETS_PATH);
  const predictions = await readJson(PREDICTIONS_PATH);

  const market = markets.find((m) => m.id === market_id);
  if (!market) return res.status(404).json({ error: 'Market not found' });

  if (market.status !== 'active') return res.status(400).json({ error: 'Market is not active' });

  const outcome = market.outcomes.find((o) => o.id === outcome_id);
  if (!outcome) return res.status(404).json({ error: 'Outcome not found' });

  // ── Buying-power check ──────────────────────────────────────────────────────
  // Only enforce if a user_id is provided (skip for anonymous / demo trades)
  if (user_id && user_id !== 'demo_user') {
    const balanceInfo = await calculateBalanceFromTransactions(user_id);
    if (stake_amount > balanceInfo.balance) {
      return res.status(402).json({
        error: `Insufficient buying power. Available: $${balanceInfo.balance.toFixed(2)}, Required: $${stake_amount.toFixed(2)}`,
        available_balance: balanceInfo.balance,
        required: stake_amount
      });
    }
  }
  // ───────────────────────────────────────────────────────────────────────────

  const potential_return = Number((stake_amount * (100 / Math.max(odds_at_prediction, 1))).toFixed(2));

  const prediction = {
    id: nanoid(12),
    market_id,
    outcome_id,
    stake_amount,
    odds_at_prediction,
    potential_return,
    status: 'active',
    actual_return: 0,
    user_id,
    created_at: new Date().toISOString()
  };

  predictions.push(prediction);

  outcome.total_stake = (outcome.total_stake || 0) + stake_amount;
  recomputeMarketStats(market);

  await writeJson(PREDICTIONS_PATH, predictions);
  await writeJson(MARKETS_PATH, markets);

  res.status(201).json(prediction);
});

app.post('/api/markets/:id/resolve', async (req, res) => {
  const { winning_outcome_id } = req.body;
  const markets = await readJson(MARKETS_PATH);
  const predictions = await readJson(PREDICTIONS_PATH);

  const market = markets.find((m) => m.id === req.params.id);
  if (!market) return res.status(404).json({ error: 'Market not found' });

  const winOutcome = market.outcomes.find((o) => o.id === winning_outcome_id);
  if (!winOutcome) return res.status(400).json({ error: 'Invalid winning_outcome_id' });

  market.status = 'resolved';
  market.winning_outcome_id = winning_outcome_id;
  market.resolution_date = new Date().toISOString();

  const updated = predictions.map((p) => {
    if (p.market_id !== market.id) return p;
    const won = p.outcome_id === winning_outcome_id;
    return {
      ...p,
      status: won ? 'won' : 'lost',
      actual_return: won ? p.potential_return : 0
    };
  });

  await writeJson(PREDICTIONS_PATH, updated);
  await writeJson(MARKETS_PATH, markets);

  res.json({ ok: true, market });
});

// ============================================================================
// POSITIONS — SELL
// ============================================================================

/**
 * Sell (partially or fully) an active position on a given outcome.
 * The sell return = sell_amount * (current_probability / avg_entry_probability).
 * The sold portion is marked settled and the net return is credited via a
 * synthetic deposit transaction so buying power updates immediately.
 */
app.post('/api/positions/sell', async (req, res) => {
  const { market_id, outcome_id, user_id, sell_amount } = req.body;

  if (!market_id || !outcome_id || !user_id || typeof sell_amount !== 'number' || sell_amount <= 0) {
    return res.status(400).json({ error: 'Invalid sell payload' });
  }

  const markets = await readJson(MARKETS_PATH);
  let predictions = await readJson(PREDICTIONS_PATH);

  const market = markets.find((m) => m.id === market_id);
  if (!market) return res.status(404).json({ error: 'Market not found' });
  if (market.status !== 'active') return res.status(400).json({ error: 'Market is not active' });

  const outcome = market.outcomes.find((o) => o.id === outcome_id);
  if (!outcome) return res.status(404).json({ error: 'Outcome not found' });

  // Collect the user's active predictions for this outcome
  const userPreds = predictions.filter(
    (p) => p.user_id === user_id && p.market_id === market_id && p.outcome_id === outcome_id && p.status === 'active'
  );

  const totalStake = userPreds.reduce((sum, p) => sum + (p.stake_amount || 0), 0);
  if (sell_amount > totalStake + 0.001) {
    return res.status(400).json({ error: `Cannot sell more than your position size ($${totalStake.toFixed(2)})` });
  }

  // Weighted-average entry probability
  const weightedSum = userPreds.reduce((sum, p) => sum + (p.odds_at_prediction || 50) * (p.stake_amount || 0), 0);
  const avgEntryProb = totalStake > 0 ? weightedSum / totalStake : 50;
  const currentProb = outcome.probability || 50;

  const sell_return = calculatePositionValue(sell_amount, avgEntryProb, currentProb);

  // Reduce / close predictions FIFO
  let remaining = sell_amount;
  for (let i = 0; i < userPreds.length && remaining > 0; i++) {
    const pred = predictions.find((p) => p.id === userPreds[i].id);
    if (!pred) continue;
    if (pred.stake_amount <= remaining + 0.001) {
      remaining -= pred.stake_amount;
      pred.status = 'sold';
      pred.actual_return = calculatePositionValue(pred.stake_amount, avgEntryProb, currentProb);
      pred.sold_at = new Date().toISOString();
      // Reduce market stake
      outcome.total_stake = Math.max(0, (outcome.total_stake || 0) - pred.stake_amount);
    } else {
      // Partial sell – split the prediction
      const splitStake = remaining;
      const splitReturn = calculatePositionValue(splitStake, avgEntryProb, currentProb);
      const splitPred = {
        ...pred,
        id: nanoid(12),
        stake_amount: splitStake,
        status: 'sold',
        actual_return: splitReturn,
        sold_at: new Date().toISOString()
      };
      pred.stake_amount = Number((pred.stake_amount - splitStake).toFixed(2));
      predictions.push(splitPred);
      outcome.total_stake = Math.max(0, (outcome.total_stake || 0) - splitStake);
      remaining = 0;
    }
  }

  recomputeMarketStats(market);

  // Credit the sell return as a deposit so buying power updates
  let transactions = [];
  try { transactions = await readJson(TRANSACTIONS_PATH); } catch (e) { transactions = []; }
  const creditTx = {
    id: nanoid(12),
    user_id,
    type: 'deposit',
    amount: sell_return,
    payment_method: 'sell_return',
    status: 'completed',
    created_at: new Date().toISOString(),
    note: `Sell return for ${market.title} — ${outcome.title}`
  };
  transactions.push(creditTx);

  await writeJson(PREDICTIONS_PATH, predictions);
  await writeJson(MARKETS_PATH, markets);
  await writeJson(TRANSACTIONS_PATH, transactions);

  res.json({ ok: true, sell_amount, sell_return, avg_entry_prob: avgEntryProb, current_prob: currentProb });
});

// ============================================================================
// WALLET / USER ENDPOINTS
// ============================================================================

/**
 * Calculate user balance from transactions
 * Balance = sum of deposits - sum of withdrawals - sum of active predictions
 */
async function calculateBalanceFromTransactions(userId) {
  let transactions = [];
  let predictions = [];

  try {
    transactions = await readJson(TRANSACTIONS_PATH);
  } catch (e) {
    transactions = [];
  }

  try {
    predictions = await readJson(PREDICTIONS_PATH);
  } catch (e) {
    predictions = [];
  }

  // Filter transactions for this user
  const userTransactions = transactions.filter(t => t.user_id === userId);

  // Deposits/withdrawals are external paper-wallet adjustments. Trade P&L is
  // derived from prediction records so the UI and server share one ledger.
  const totalDeposits = userTransactions
    .filter(t => t.type === 'deposit' && t.status === 'completed' && t.payment_method !== 'sell_return')
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  // Sum withdrawals (completed only)
  const totalWithdrawals = userTransactions
    .filter(t => t.type === 'withdrawal' && t.status === 'completed')
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  // Sum active prediction stakes (money locked in trades)
  const activePredictionStakes = predictions
    .filter(p => p.user_id === userId && p.status === 'active')
    .reduce((sum, p) => sum + (p.stake_amount || 0), 0);

  const realizedPredictions = predictions
    .filter(p => p.user_id === userId && ['won', 'lost', 'sold', 'refunded'].includes(p.status));
  const realizedStake = realizedPredictions
    .reduce((sum, p) => sum + (p.stake_amount || 0), 0);
  const realizedReturn = realizedPredictions
    .reduce((sum, p) => sum + (p.actual_return || 0), 0);
  const realizedPnl = realizedReturn - realizedStake;

  const cashBalance = PAPER_TRADING_STARTING_BALANCE + totalDeposits - totalWithdrawals + realizedPnl;
  const rawBalance = cashBalance - activePredictionStakes;
  const buyingPower = Math.max(0, rawBalance);

  return {
    balance: buyingPower, // Never negative in UI-facing responses
    buyingPower,
    rawBalance,
    cashBalance,
    paperStartingBalance: PAPER_TRADING_STARTING_BALANCE,
    totalDeposits,
    totalWithdrawals,
    activePredictionStakes,
    realizedStake,
    realizedReturn,
    realizedPnl
  };
}

// Get user balance (calculated from transactions)
app.get('/api/users/:id/balance', async (req, res) => {
  const users = await readJson(USERS_PATH);
  let user = users.find((u) => u.id === req.params.id);

  if (!user) {
    // Create default user if not found
    user = {
      id: req.params.id,
      username: 'user',
      email: '',
      created_at: new Date().toISOString()
    };
    users.push(user);
    await writeJson(USERS_PATH, users);
  }

  // Calculate balance from transactions (not stored value)
  const balanceInfo = await calculateBalanceFromTransactions(req.params.id);

  res.json({
    balance: balanceInfo.balance,
    buying_power: balanceInfo.buyingPower,
    raw_balance: balanceInfo.rawBalance,
    cash_balance: balanceInfo.cashBalance,
    paper_starting_balance: balanceInfo.paperStartingBalance,
    total_deposited: balanceInfo.totalDeposits,
    total_withdrawn: balanceInfo.totalWithdrawals,
    active_stakes: balanceInfo.activePredictionStakes,
    realized_stake: balanceInfo.realizedStake,
    realized_return: balanceInfo.realizedReturn,
    realized_pnl: balanceInfo.realizedPnl,
    user
  });
});

// Deposit funds
app.post('/api/users/:id/deposit', async (req, res) => {
  const { amount, payment_method = 'card' } = req.body;

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Invalid deposit amount' });
  }

  if (amount > 10000) {
    return res.status(400).json({ error: 'Maximum deposit is $10,000' });
  }

  const users = await readJson(USERS_PATH);
  let user = users.find((u) => u.id === req.params.id);

  if (!user) {
    // Create user if doesn't exist
    user = {
      id: req.params.id,
      username: 'user',
      email: '',
      created_at: new Date().toISOString()
    };
    users.push(user);
    await writeJson(USERS_PATH, users);
  }

  // Record transaction (balance is calculated from transactions, not stored)
  let transactions = [];
  try {
    transactions = await readJson(TRANSACTIONS_PATH);
  } catch (e) {
    transactions = [];
  }

  const transaction = {
    id: nanoid(12),
    user_id: req.params.id,
    type: 'deposit',
    amount,
    payment_method,
    status: 'completed',
    created_at: new Date().toISOString()
  };

  transactions.push(transaction);
  await writeJson(TRANSACTIONS_PATH, transactions);

  // Calculate new balance from all transactions
  const balanceInfo = await calculateBalanceFromTransactions(req.params.id);

  res.status(201).json({
    success: true,
    transaction,
    new_balance: balanceInfo.balance
  });
});

// Withdraw funds
app.post('/api/users/:id/withdraw', async (req, res) => {
  const { amount, withdrawal_method = 'bank' } = req.body;

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Invalid withdrawal amount' });
  }

  // Calculate current balance from transactions
  const currentBalanceInfo = await calculateBalanceFromTransactions(req.params.id);

  if (currentBalanceInfo.balance < amount) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  // Ensure user exists
  const users = await readJson(USERS_PATH);
  let user = users.find((u) => u.id === req.params.id);

  if (!user) {
    user = {
      id: req.params.id,
      username: 'user',
      email: '',
      created_at: new Date().toISOString()
    };
    users.push(user);
    await writeJson(USERS_PATH, users);
  }

  // Record transaction (balance is calculated from transactions, not stored)
  let transactions = [];
  try {
    transactions = await readJson(TRANSACTIONS_PATH);
  } catch (e) {
    transactions = [];
  }

  const transaction = {
    id: nanoid(12),
    user_id: req.params.id,
    type: 'withdrawal',
    amount,
    withdrawal_method,
    status: 'completed', // For demo, mark as completed immediately
    created_at: new Date().toISOString()
  };

  transactions.push(transaction);
  await writeJson(TRANSACTIONS_PATH, transactions);

  // Calculate new balance from all transactions
  const balanceInfo = await calculateBalanceFromTransactions(req.params.id);

  res.status(201).json({
    success: true,
    transaction,
    new_balance: balanceInfo.balance
  });
});

// Get transaction history
app.get('/api/users/:id/transactions', async (req, res) => {
  let transactions = [];
  try {
    transactions = await readJson(TRANSACTIONS_PATH);
  } catch (e) {
    transactions = [];
  }

  const userTransactions = transactions.filter((t) => t.user_id === req.params.id);
  res.json(userTransactions);
});

// ============================================================================
// BALANCE REPAIR — fix users whose buying power went negative
// ============================================================================

/**
 * POST /api/users/:id/fix-balance
 *
 * For users who somehow accumulated more active-stake than deposits allow,
 * this endpoint cancels the most-recent active predictions (newest first)
 * until the user's buying power is >= 0, then returns the repaired balance.
 *
 * In a fair-play system this shouldn't happen, but it guards against edge-cases
 * from demo usage, bugs, or data migration issues.
 */
app.post('/api/users/:id/fix-balance', async (req, res) => {
  const userId = req.params.id;

  let predictions = [];
  let transactions = [];
  try { predictions = await readJson(PREDICTIONS_PATH); } catch (e) { predictions = []; }
  try { transactions = await readJson(TRANSACTIONS_PATH); } catch (e) { transactions = []; }

  // Current financial snapshot
  const balanceBefore = await calculateBalanceFromTransactions(userId);

  if (balanceBefore.rawBalance >= 0) {
    return res.json({
      ok: true,
      message: 'Balance is already non-negative — no fix needed.',
      balance: balanceBefore.balance,
      cancelled_predictions: 0
    });
  }

  // The raw deficit before Math.max(0,...) hides it
  const totalDeposits = balanceBefore.totalDeposits;
  const totalWithdrawals = balanceBefore.totalWithdrawals;
  const trueBalance = balanceBefore.rawBalance;

  let deficit = Math.abs(trueBalance); // amount we need to claw back
  const cancelledIds = [];

  // Sort active predictions newest-first (cancel most recent excess trades)
  const userActivePreds = predictions
    .filter((p) => p.user_id === userId && p.status === 'active')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  for (const pred of userActivePreds) {
    if (deficit <= 0) break;
    // Cancel this prediction — refund the stake to restore buying power
    const idx = predictions.findIndex((p) => p.id === pred.id);
    if (idx === -1) continue;
    cancelledIds.push(pred.id);
    deficit -= pred.stake_amount;
  }

  predictions = predictions.filter((p) => !cancelledIds.includes(p.id));

  const markets = await readJson(MARKETS_PATH);
  const affectedMarketIds = new Set(userActivePreds.filter((p) => cancelledIds.includes(p.id)).map((p) => p.market_id));
  for (const market of markets) {
    if (!affectedMarketIds.has(market.id)) continue;
    for (const outcome of market.outcomes || []) {
      outcome.total_stake = predictions
        .filter((p) => p.market_id === market.id && p.outcome_id === outcome.id && p.status === 'active')
        .reduce((sum, p) => sum + (p.stake_amount || 0), 0);
    }
    recomputeMarketStats(market);
  }

  await writeJson(PREDICTIONS_PATH, predictions);
  await writeJson(MARKETS_PATH, markets);

  const balanceAfter = await calculateBalanceFromTransactions(userId);

  res.json({
    ok: true,
    message: `Removed ${cancelledIds.length} prediction(s) to restore a non-negative balance.`,
    balance_before: balanceBefore.balance,
    raw_balance_before: balanceBefore.rawBalance,
    balance_after: balanceAfter.balance,
    raw_balance_after: balanceAfter.rawBalance,
    cancelled_predictions: cancelledIds.length,
    removed_predictions: cancelledIds.length,
    removed_prediction_ids: cancelledIds,
    cancelled_ids: cancelledIds
  });
});

app.listen(PORT, () => {
  console.log(`Samsa API listening on http://localhost:${PORT}`);
});
