require('dotenv').config();
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs').promises;
const { nanoid } = require('nanoid');
const { Op, DataTypes, Sequelize } = require('sequelize');

// Import database models
const {
  sequelize,
  User,
  Transaction,
  Market,
  Outcome,
  Prediction,
  PriceHistory,
  initializeDatabase
} = require('./lib/database/models');
const { sendEmail } = require('./lib/email');
const { registerDailyDigestJob } = require('./jobs/daily-digest');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.STRING(12),
    primaryKey: true
  },
  user_id: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  type: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  title: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  link: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  is_read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: Sequelize.NOW
  }
}, {
  tableName: 'notifications',
  timestamps: false,
  underscored: true
});

const app = express();
const PORT = process.env.PORT || 3001;
const Stripe = require('stripe');
const stripeSecret = (process.env.STRIPE_SECRET_KEY || '').trim();
const stripe = stripeSecret ? Stripe(stripeSecret) : null;
const PAPER_TRADING_STARTING_BALANCE = Number(process.env.PAPER_TRADING_STARTING_BALANCE || 10000);

// CORS — allow dobium.com (Vercel frontend), Render preview URLs, and local dev
const ALLOWED_ORIGINS = [
  'https://dobium.com',
  'https://www.dobium.com',
  /\.vercel\.app$/,
  /\.onrender\.com$/,
  /\.railway\.app$/,
  /\.netlify\.app$/,
  'http://localhost:5173',
  'http://localhost:3000',
];
app.use(cors({
  origin: (origin, cb) => {
    // Allow non-browser requests (curl, Postman, server-to-server)
    if (!origin) return cb(null, true);
    const allowed = ALLOWED_ORIGINS.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    cb(allowed ? null : new Error(`CORS: ${origin} not allowed`), allowed);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(morgan('dev'));

// --- SSE Setup for Real-time Notifications ---
let clients = [];

function broadcastNotification(notification) {
  const eventData = JSON.stringify(notification);
  clients.forEach(client => client.res.write(`data: ${eventData}\n\n`));
}

app.get('/api/notifications/stream', (req, res) => {
  // Vercel serverless functions cannot hold persistent SSE connections.
  // Return 503 immediately so the frontend knows to fall back to polling.
  if (process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'SSE not available in serverless mode. Use polling.' });
  }

  // Railway / local dev — full SSE support
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  clients.push(newClient);
  console.log(`[SSE] Client connected: ${clientId}. Total clients: ${clients.length}`);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients = clients.filter(client => client.id !== clientId);
    console.log(`[SSE] Client disconnected: ${clientId}. Total clients: ${clients.length}`);
  });
});

// Serve the React frontend from ../frontend/dist/
const REACT_BUILD = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(REACT_BUILD));

app.get('/config/supabase.js', (req, res) => {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    '';
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    '';
  res.type('application/javascript').send(`window.SUPABASE_CONFIG = { url: ${JSON.stringify(url)}, anonKey: ${JSON.stringify(anonKey)} };`);
});
app.get('/config/stripe.js', (req, res) => {
  const publishableKey =
    process.env.STRIPE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    process.env.VITE_STRIPE_PUBLISHABLE_KEY ||
    '';
  const defaultPriceId =
    process.env.STRIPE_DEFAULT_PRICE_ID ||
    process.env.NEXT_PUBLIC_STRIPE_DEFAULT_PRICE_ID ||
    process.env.VITE_STRIPE_DEFAULT_PRICE_ID ||
    '';
  res
    .type('application/javascript')
    .send(`window.STRIPE_CONFIG = { publishableKey: ${JSON.stringify(publishableKey)}, defaultPriceId: ${JSON.stringify(defaultPriceId)} };`);
});
// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate user balance from transactions
 */
async function calculateBalanceFromTransactions(userId, transaction = null) {
  let userAliases = [userId];
  const user = await User.findOne({
    where: { [Op.or]: [{ id: userId }, { email: userId }] },
    ...(transaction ? { transaction } : {})
  });
  if (user) {
    userAliases.push(user.id);
    if (user.email && user.email !== `${user.id}@placeholder.com`) userAliases.push(user.email);
  }
  userAliases = [...new Set(userAliases)];

  const transactions = await Transaction.findAll({
    where: { user_id: { [Op.in]: userAliases } },
    ...(transaction ? { transaction } : {})
  });

  const activePredictions = await Prediction.findAll({
    where: { user_id: { [Op.in]: userAliases } },
    ...(transaction ? { transaction } : {})
  });

  // Deposits/withdrawals are external paper-wallet adjustments.
  // Trade P&L is derived from prediction records so dashboard, market page,
  // and server-side buying-power checks all share one ledger.
  const totalDeposits = transactions
    .filter(t => t.type === 'deposit' && t.status === 'completed' && t.payment_method !== 'sell_return')
    .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

  // Sum withdrawals (completed only)
  const totalWithdrawals = transactions
    .filter(t => t.type === 'withdrawal' && t.status === 'completed')
    .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

  const activePredictionStakes = activePredictions
    .filter(p => p.status === 'active')
    .reduce((sum, p) => sum + parseFloat(p.stake_amount || 0), 0);

  const realizedPredictions = activePredictions
    .filter(p => ['won', 'lost', 'sold', 'refunded'].includes(p.status));
  const realizedStake = realizedPredictions
    .reduce((sum, p) => sum + parseFloat(p.stake_amount || 0), 0);
  const realizedReturn = realizedPredictions
    .reduce((sum, p) => {
      let ret = parseFloat(p.actual_return || 0);
      // Self-heal historical losses that were incorrectly given 0 return
      if (p.status === 'lost' && ret === 0) {
        const pEntry = parseFloat(p.odds_at_prediction || 50) / 100;
        ret = parseFloat(p.stake_amount || 0) * pEntry;
      }
      return sum + ret;
    }, 0);
  const realizedPnl = realizedReturn - realizedStake;

  const cashBalance = PAPER_TRADING_STARTING_BALANCE + totalDeposits - totalWithdrawals + realizedPnl;
  const rawBalance = cashBalance - activePredictionStakes;
  const buyingPower = Math.max(0, rawBalance);

  return {
    balance: buyingPower,
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

async function refreshMarketPricing(marketId, transaction) {
  const market = await Market.findByPk(marketId, { transaction });
  if (!market) return null;

  const outcomes = await Outcome.findAll({ where: { market_id: marketId }, transaction });
  const outcomesData = outcomes.map(o => o.toJSON());
  const totalVolume = outcomesData.reduce((sum, o) => sum + parseFloat(o.total_stake || 0), 0);

  await market.update({ total_volume: totalVolume }, { transaction });

  const pricedOutcomes = recomputeProbabilities(outcomesData, totalVolume, market.market_type);
  for (const po of pricedOutcomes) {
    await Outcome.update({ probability: po.probability }, { where: { id: po.id }, transaction });
  }

  const prices = Object.fromEntries(pricedOutcomes.map(o => [o.id, o.probability]));
  await PriceHistory.create({ market_id: marketId, timestamp: new Date(), prices }, { transaction });

  return { marketId, totalVolume, prices };
}

async function removeTradesCausingNegativeBuyingPower(userId, transaction) {
  const balanceBefore = await calculateBalanceFromTransactions(userId, transaction);
  if (balanceBefore.rawBalance >= 0) {
    return {
      balance_before: balanceBefore.balance,
      raw_balance_before: balanceBefore.rawBalance,
      balance_after: balanceBefore.balance,
      raw_balance_after: balanceBefore.rawBalance,
      removed_predictions: 0,
      removed_prediction_ids: []
    };
  }

  let deficit = Math.abs(balanceBefore.rawBalance);
  const affectedMarketIds = new Set();
  const removedPredictionIds = [];

  let userAliases = [userId];
  const user = await User.findOne({
    where: { [Op.or]: [{ id: userId }, { email: userId }] },
    transaction
  });
  if (user) {
    userAliases.push(user.id);
    if (user.email && user.email !== `${user.id}@placeholder.com`) userAliases.push(user.email);
  }
  userAliases = [...new Set(userAliases)];

  const activePredictions = await Prediction.findAll({
    where: { user_id: { [Op.in]: userAliases }, status: 'active' },
    order: [['created_at', 'DESC']],
    transaction
  });

  for (const prediction of activePredictions) {
    if (deficit <= 0) break;

    const stake = parseFloat(prediction.stake_amount || 0);
    const outcome = await Outcome.findByPk(prediction.outcome_id, { transaction });
    if (outcome) {
      const nextStake = Math.max(0, parseFloat(outcome.total_stake || 0) - stake);
      await outcome.update({ total_stake: nextStake }, { transaction });
    }

    affectedMarketIds.add(prediction.market_id);
    removedPredictionIds.push(prediction.id);
    await prediction.destroy({ transaction });
    deficit -= stake;
  }

  for (const marketId of affectedMarketIds) {
    await refreshMarketPricing(marketId, transaction);
  }

  const balanceAfter = await calculateBalanceFromTransactions(userId, transaction);

  return {
    balance_before: balanceBefore.balance,
    raw_balance_before: balanceBefore.rawBalance,
    balance_after: balanceAfter.balance,
    raw_balance_after: balanceAfter.rawBalance,
    removed_predictions: removedPredictionIds.length,
    removed_prediction_ids: removedPredictionIds
  };
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'dobium-api', database: 'postgresql' });
});

// ============================================================================
// MARKET HELPERS
// ============================================================================

// Virtual liquidity added to every outcome to prevent extreme 0%/100% prices.
const BASE_LIQUIDITY = 200;

/**
 * Recompute outcome probabilities.
 *
 * - binary / multi_single: liquidity-smoothed proportional formula, sums to 100%
 * - multi_multiple: each outcome is independent, anchored at 50%
 */
function recomputeProbabilities(outcomes, totalVolume, marketType) {
  if (marketType === 'multi_multiple') {
    const priced = [];
    for (let i = 0; i < outcomes.length; i += 2) {
      const yes = outcomes[i];
      const no = outcomes[i + 1];
      if (!yes || !no) {
        if (yes) priced.push(yes);
        continue;
      }
      const total = parseFloat(yes.total_stake || 0) + parseFloat(no.total_stake || 0);
      const denom = 2 * BASE_LIQUIDITY + total;
      const pYes = (BASE_LIQUIDITY + parseFloat(yes.total_stake || 0)) / denom * 100;
      const pNo = 100 - pYes;

      priced.push({ ...yes, probability: parseFloat(pYes.toFixed(2)) });
      priced.push({ ...no, probability: parseFloat(pNo.toFixed(2)) });
    }
    return priced;
  }
  const n = outcomes.length;
  const denom = n * BASE_LIQUIDITY + totalVolume;
  const raw = outcomes.map(o => (BASE_LIQUIDITY + parseFloat(o.total_stake || 0)) / denom * 100);
  const sum = raw.reduce((a, b) => a + b, 0);
  return outcomes.map((o, i) => ({
    ...o,
    probability: parseFloat((raw[i] + (i === outcomes.length - 1 ? 100 - sum : 0)).toFixed(2))
  }));
}

function calculatePositionValue(stake, entryProbability, currentProbability) {
  const S = Number(stake || 0);
  const pEntry = Math.max(0, Math.min(100, Number(entryProbability || 0))) / 100;
  const pCurrent = Math.max(0, Math.min(100, Number(currentProbability || 0))) / 100;
  const maxReturn = S + S * (1 - pEntry);
  const minReturn = S * pEntry;
  return parseFloat((minReturn + (maxReturn - minReturn) * pCurrent).toFixed(2));
}

/**
 * Fetch a market by ID with outcomes and price_history included
 */
async function fetchMarketWithRelations(marketId, transaction = null) {
  const opts = {
    include: [
      { model: Outcome, as: 'outcomes' },
      { model: PriceHistory, as: 'price_history', order: [['timestamp', 'ASC']] }
    ]
  };
  if (transaction) opts.transaction = transaction;
  return Market.findByPk(marketId, opts);
}

/**
 * Format a Sequelize market instance into the JSON shape the frontend expects
 */
function formatMarketResponse(market) {
  const m = market.toJSON ? market.toJSON() : market;
  let winning_outcome_ids = [];
  if (m.winning_outcome_ids && Array.isArray(m.winning_outcome_ids)) {
    winning_outcome_ids = m.winning_outcome_ids;
  } else if (m.winning_outcome_id) {
    try {
      const parsed = JSON.parse(m.winning_outcome_id);
      winning_outcome_ids = Array.isArray(parsed) ? parsed : [m.winning_outcome_id];
    } catch {
      winning_outcome_ids = [m.winning_outcome_id];
    }
  }
  return {
    ...m,
    total_volume: parseFloat(m.total_volume || 0),
    winning_outcome_ids,
    outcomes: (m.outcomes || []).map(o => ({
      ...o,
      probability: parseFloat(o.probability || 0),
      total_stake: parseFloat(o.total_stake || 0)
    })),
    price_history: (m.price_history || []).map(ph => ({
      timestamp: ph.timestamp,
      prices: ph.prices
    }))
  };
}

const ICEMAN_RESOLUTION_DATE = '2026-05-15T05:00:00.000Z';

const KNOWN_MARKET_RESOLUTIONS = {
  drake_iceman_release: {
    winningOutcomeIds: ['yes'],
    resolutionDate: ICEMAN_RESOLUTION_DATE
  },
  drake_iceman_features: {
    winningOutcomeIds: ['21savage', 'future'],
    resolutionDate: ICEMAN_RESOLUTION_DATE
  }
};

function getRawOutcomeId(outcomeId, marketId) {
  const prefix = `${marketId}_`;
  return outcomeId && outcomeId.startsWith(prefix) ? outcomeId.slice(prefix.length) : outcomeId;
}

function serializeWinningOutcomeIds(winningOutcomeIds) {
  return winningOutcomeIds.length === 1
    ? winningOutcomeIds[0]
    : JSON.stringify(winningOutcomeIds);
}

function resolveOutcomeIds(market, requestedOutcomeIds) {
  const ids = Array.isArray(requestedOutcomeIds)
    ? requestedOutcomeIds.filter(Boolean)
    : [requestedOutcomeIds].filter(Boolean);

  if (ids.length === 0) {
    throw Object.assign(new Error('winning_outcome_id or winning_outcome_ids is required'), { status: 400 });
  }

  if (market.market_type !== 'multi_multiple' && ids.length > 1) {
    throw Object.assign(new Error('Only multi-select markets can resolve with multiple winning outcomes'), { status: 400 });
  }

  const resolvedIds = ids.map((id) => {
    const match = market.outcomes.find((outcome) => (
      outcome.id === id || outcome.id === `${market.id}_${id}` || getRawOutcomeId(outcome.id, market.id) === id
    ));
    if (!match) {
      throw Object.assign(new Error(`Invalid winning outcome: ${id}`), { status: 400 });
    }
    return match.id;
  });

  return [...new Set(resolvedIds)];
}

async function resolveMarketInstance(market, requestedOutcomeIds, options = {}) {
  const transaction = options.transaction;
  const resolutionDate = options.resolutionDate ? new Date(options.resolutionDate) : new Date();
  const winningOutcomeIds = resolveOutcomeIds(market, requestedOutcomeIds);
  const winningSet = new Set(winningOutcomeIds);

  await market.update({
    status: 'resolved',
    winning_outcome_id: serializeWinningOutcomeIds(winningOutcomeIds),
    resolution_date: resolutionDate
  }, { transaction });

  for (const outcome of market.outcomes) {
    await outcome.update({
      probability: winningSet.has(outcome.id) ? 100 : 0
    }, { transaction });
  }

  const predictions = await Prediction.findAll({
    where: { market_id: market.id, status: 'active' },
    transaction
  });

  const users = await User.findAll({ transaction });
  const resolutionNotifications = users.map(u => ({
    id: nanoid(12),
    user_id: u.id,
    type: 'market_resolved',
    title: 'Market Resolved',
    message: `The market "${market.title}" has been resolved.`,
    link: `/markets/${market.id}`,
    is_read: false,
    created_at: resolutionDate
  }));
  if (resolutionNotifications.length > 0) {
    const created = await Notification.bulkCreate(resolutionNotifications, { transaction, returning: true });
    created.forEach(n => broadcastNotification(n.toJSON()));
  }

  for (const prediction of predictions) {
    const won = winningSet.has(prediction.outcome_id);
    const pEntry = parseFloat(prediction.odds_at_prediction || 50) / 100;
    const stakeAmount = parseFloat(prediction.stake_amount || 0);
    let actualReturn = 0;
    if (won) {
      actualReturn = parseFloat(prediction.potential_return || 0);
    } else {
      actualReturn = stakeAmount * pEntry;
    }
    await prediction.update({
      status: won ? 'won' : 'lost',
      actual_return: actualReturn,
      resolved_at: resolutionDate
    }, { transaction });

    if (actualReturn > 0) {
      await User.findOrCreate({
        where: { id: prediction.user_id },
        defaults: {
          id: prediction.user_id,
          username: prediction.user_id.substring(0, 20),
          email: `${prediction.user_id}@placeholder.com`
        },
        transaction
      });
      await Transaction.findOrCreate({
        where: { id: `payout_${prediction.id}` },
        defaults: {
          id: `payout_${prediction.id}`,
          user_id: prediction.user_id,
          type: 'payout',
          amount: actualReturn,
          payment_method: 'market_resolution',
          status: 'completed',
          completed_at: resolutionDate
        },
        transaction
      });

      const notification = await Notification.create({
        id: nanoid(12),
        user_id: prediction.user_id,
        type: 'prediction_won',
        title: 'Prediction Won!',
        message: `Your position in "${market.title}" won! You received a return of $${actualReturn.toFixed(2)}.`,
        link: `/markets/${market.id}`,
        is_read: false,
        created_at: resolutionDate
      }, { transaction });
      broadcastNotification(notification.toJSON());
    }
  }

  return {
    market,
    winningOutcomeIds
  };
}

/**
 * Fetch all markets formatted for the frontend
 */
async function getAllMarketsFormatted(whereClause = {}) {
  const markets = await Market.findAll({
    where: whereClause,
    include: [
      { model: Outcome, as: 'outcomes' },
      { model: PriceHistory, as: 'price_history' }
    ],
    order: [['created_at', 'DESC'], [{ model: PriceHistory, as: 'price_history' }, 'timestamp', 'ASC']]
  });
  return markets.map(formatMarketResponse);
}

// ============================================================================
// LEAGUE STATS
// ============================================================================

app.get('/api/leagues/:leagueId/stats', async (req, res) => {
  try {
    const { leagueId } = req.params;
    const leagueMarkets = await Market.findAll({ where: { status: 'active' } });
    const activeMarkets = leagueMarkets.length;
    const totalVolume = leagueMarkets.reduce((sum, m) => sum + parseFloat(m.total_volume || 0), 0);
    const leagueMarketIds = leagueMarkets.map(m => m.id);
    const predictionCount = await Prediction.count({
      where: { market_id: { [Op.in]: leagueMarketIds } }
    });
    res.json({
      league_id: leagueId,
      active_markets: activeMarkets,
      total_volume: totalVolume,
      predictions: predictionCount
    });
  } catch (error) {
    console.error('League stats error:', error);
    res.status(500).json({ error: 'Failed to fetch league stats' });
  }
});

// ============================================================================
// MARKETS — Database backed
// ============================================================================

// Current events — active markets closing within 6 months
app.get('/api/markets/current-events', async (req, res) => {
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
    const markets = await getAllMarketsFormatted({ status: 'active' });
    const filtered = markets.filter(m => {
      if (!m.close_date) return true;
      const d = new Date(m.close_date);
      return d > now && d <= cutoff;
    });
    res.json(filtered);
  } catch (error) {
    console.error('Current events error:', error);
    res.status(500).json({ error: 'Failed to fetch current events' });
  }
});

// Trending — top N by total_volume
app.get('/api/markets/trending', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const markets = await getAllMarketsFormatted({ status: 'active' });
    const trending = markets
      .sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0))
      .slice(0, limit);
    res.json(trending);
  } catch (error) {
    console.error('Trending markets error:', error);
    res.status(500).json({ error: 'Failed to fetch trending markets' });
  }
});

// By category
app.get('/api/markets/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const markets = await getAllMarketsFormatted({
      status: 'active',
      category: category.toLowerCase()
    });
    res.json(markets);
  } catch (error) {
    console.error('Category markets error:', error);
    res.status(500).json({ error: 'Failed to fetch category markets' });
  }
});

app.get('/api/markets/suggestions', async (req, res) => {
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

// ============================================================================
// MARKETS CRUD — Database backed
// ============================================================================

// GET all markets
app.get('/api/markets', async (req, res) => {
  try {
    const markets = await getAllMarketsFormatted();
    res.json(markets);
  } catch (error) {
    console.error('Get markets error:', error);
    res.status(500).json({ error: 'Failed to fetch markets' });
  }
});

// GET single market by id
app.get('/api/markets/:id', async (req, res) => {
  try {
    const market = await fetchMarketWithRelations(req.params.id);
    if (!market) return res.status(404).json({ error: 'Market not found' });
    res.json(formatMarketResponse(market));
  } catch (error) {
    console.error('Get market error:', error);
    res.status(500).json({ error: 'Failed to fetch market' });
  }
});

// POST create market
app.post('/api/markets', async (req, res) => {
  try {
    const { title, description = '', category, outcomes = [], image_url = '', search_keywords = '', close_date = null, resolution_date = null, market_type = 'binary' } = req.body;
    if (!title || !category || !Array.isArray(outcomes) || outcomes.length < 2) {
      return res.status(400).json({ error: 'Invalid market payload' });
    }

    const result = await sequelize.transaction(async (t) => {
      const marketId = nanoid(12);
      const market = await Market.create({
        id: marketId,
        title, description, category, market_type,
        status: 'active',
        close_date, resolution_date,
        total_volume: 0,
        image_url,
        winning_outcome_id: null,
        search_keywords
      }, { transaction: t });

      let outcomeRecords = [];
      if (market_type === 'multi_multiple') {
        outcomes.forEach(o => {
          const baseId = o.id || nanoid(8);
          const probYes = typeof o.probability === 'number' ? o.probability : 50;
          const probNo = 100 - probYes;
          outcomeRecords.push({
            id: `${marketId}_${baseId}_yes`,
            market_id: marketId,
            title: `${o.title} (Yes)`,
            probability: probYes,
            total_stake: 0
          });
          outcomeRecords.push({
            id: `${marketId}_${baseId}_no`,
            market_id: marketId,
            title: `${o.title} (No)`,
            probability: probNo,
            total_stake: 0
          });
        });
      } else {
        outcomeRecords = outcomes.map(o => ({
          id: `${marketId}_${o.id || nanoid(8)}`,
          market_id: marketId,
          title: o.title,
          probability: typeof o.probability === 'number' ? o.probability : Math.round(100 / outcomes.length),
          total_stake: 0
        }));
      }
      await Outcome.bulkCreate(outcomeRecords, { transaction: t });

      // Initial price snapshot
      const prices = Object.fromEntries(outcomeRecords.map(o => [o.id, o.probability]));
      await PriceHistory.create({
        market_id: marketId,
        timestamp: new Date(),
        prices
      }, { transaction: t });

      const users = await User.findAll({ transaction: t });
      const notifications = users.map(u => ({
        id: nanoid(12),
        user_id: u.id,
        type: 'market_new',
        title: 'New Market Out',
        message: `A new market "${title}" is now available in the ${category} category.`,
        link: `/markets/${marketId}`,
        is_read: false,
        created_at: new Date()
      }));
      if (notifications.length > 0) {
        const created = await Notification.bulkCreate(notifications, { transaction: t, returning: true });
        created.forEach(n => broadcastNotification(n.toJSON()));
      }

      return await fetchMarketWithRelations(marketId, t);
    });

    res.status(201).json(formatMarketResponse(result));
  } catch (error) {
    console.error('Create market error:', error);
    res.status(500).json({ error: 'Failed to create market' });
  }
});

// PUT update market
app.put('/api/markets/:id', async (req, res) => {
  try {
    const { close_date, resolution_date, title, status, outcomes, category, description, image_url } = req.body;
    const result = await sequelize.transaction(async (t) => {
      const market = await Market.findByPk(req.params.id, { transaction: t });
      if (!market) throw Object.assign(new Error('Market not found'), { status: 404 });

      const oldStatus = market.status;

      await market.update({
        ...(close_date !== undefined && { close_date }),
        ...(resolution_date !== undefined && { resolution_date }),
        ...(title !== undefined && { title }),
        ...(status !== undefined && { status }),
        ...(category !== undefined && { category }),
        ...(description !== undefined && { description }),
        ...(image_url !== undefined && { image_url })
      }, { transaction: t });

      if (outcomes && Array.isArray(outcomes)) {
        for (const o of outcomes) {
          const outcome = await Outcome.findByPk(o.id, { transaction: t });
          if (outcome) {
            await outcome.update({
              ...(o.title !== undefined && { title: o.title }),
              ...(o.probability !== undefined && { probability: o.probability })
            }, { transaction: t });
          }
        }
      }

      if (status === 'archived' && oldStatus !== 'archived') {
        const users = await User.findAll({ transaction: t });
        const notifications = users.map(u => ({
          id: nanoid(12),
          user_id: u.id,
          type: 'market_cancelled',
          title: 'Market Cancelled',
          message: `The market "${market.title}" has been cancelled.`,
          link: `/explore`,
          is_read: false,
          created_at: new Date()
        }));
        if (notifications.length > 0) {
          const created = await Notification.bulkCreate(notifications, { transaction: t, returning: true });
          created.forEach(n => broadcastNotification(n.toJSON()));
        }
      }

      return await fetchMarketWithRelations(req.params.id, t);
    });
    res.json(formatMarketResponse(result));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Update market error:', error);
    res.status(500).json({ error: 'Failed to update market' });
  }
});


// ============================================================================
// PREDICTIONS — Database backed
// ============================================================================

/**
 * Normalize a Sequelize Prediction instance:
 * 1. Ensure snake_case timestamps (Sequelize returns camelCase by default)
 * 2. Parse DECIMAL columns to JS numbers (Sequelize returns them as strings from PostgreSQL)
 */
function normalizePrediction(p) {
  const json = p.toJSON ? p.toJSON() : p;
  return {
    ...json,
    // Numeric fields — Sequelize DECIMAL comes back as strings
    stake_amount: parseFloat(json.stake_amount) || 0,
    odds_at_prediction: parseFloat(json.odds_at_prediction) || 0,
    potential_return: parseFloat(json.potential_return) || 0,
    actual_return: parseFloat(json.actual_return) || 0,
    // Timestamps — Sequelize underscored:true still serialises as camelCase
    created_at: json.created_at || json.createdAt || null,
    updated_at: json.updated_at || json.updatedAt || null,
  };
}

app.get('/api/predictions', async (req, res) => {
  try {
    const { market_id } = req.query;
    const where = {};
    if (market_id) where.market_id = market_id;
    const predictions = await Prediction.findAll({
      where,
      order: [['created_at', 'DESC']]
    });
    res.json(predictions.map(normalizePrediction));
  } catch (error) {
    console.error('Get predictions error:', error);
    res.status(500).json({ error: 'Failed to fetch predictions' });
  }
});

app.post('/api/predictions', async (req, res) => {
  try {
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

    // Ensure the user exists in the local DB (Supabase auth users may not be synced yet)
    if (user_id) {
      await User.findOrCreate({
        where: { id: user_id },
        defaults: {
          id: user_id,
          username: user_id.substring(0, 20),
          email: `${user_id}@placeholder.com`
        }
      });
    }

    const result = await sequelize.transaction(async (t) => {
      // Validate market exists and is active
      const market = await Market.findByPk(market_id, {
        include: [{ model: Outcome, as: 'outcomes' }],
        transaction: t
      });
      if (!market) throw Object.assign(new Error('Market not found'), { status: 404 });
      if (market.status !== 'active') throw Object.assign(new Error('Market is not active'), { status: 400 });

      const outcome = market.outcomes.find(o => o.id === outcome_id);
      if (!outcome) throw Object.assign(new Error('Outcome not found'), { status: 400 });

      if (user_id && user_id !== 'demo_user') {
        const balanceInfo = await calculateBalanceFromTransactions(user_id, t);
        if (stake_amount > balanceInfo.balance) {
          throw Object.assign(
            new Error(`Insufficient buying power. Available: $${balanceInfo.balance.toFixed(2)}, Required: $${stake_amount.toFixed(2)}`),
            {
              status: 402,
              details: {
                available_balance: balanceInfo.balance,
                active_stakes: balanceInfo.activePredictionStakes,
                required: stake_amount
              }
            }
          );
        }
      }

      // Calculate potential return using S(1-p) formula
      const p = odds_at_prediction / 100;
      const potential_return = Number((stake_amount + stake_amount * (1 - p)).toFixed(2));

      const prediction = await Prediction.create({
        id: nanoid(12),
        market_id,
        outcome_id,
        user_id,
        stake_amount,
        odds_at_prediction,
        potential_return,
        status: 'active',
        actual_return: 0
      }, { transaction: t });

      // Update outcome total_stake
      const newStake = parseFloat(outcome.total_stake || 0) + stake_amount;
      await outcome.update({ total_stake: newStake }, { transaction: t });

      // Update market total_volume
      const newVolume = parseFloat(market.total_volume || 0) + stake_amount;
      await market.update({ total_volume: newVolume }, { transaction: t });

      // Recompute probabilities for all outcomes
      const allOutcomes = await Outcome.findAll({ where: { market_id }, transaction: t });
      const outcomesData = allOutcomes.map(o => o.toJSON());
      const pricedOutcomes = recomputeProbabilities(outcomesData, newVolume, market.market_type);

      for (const po of pricedOutcomes) {
        await Outcome.update({ probability: po.probability }, { where: { id: po.id }, transaction: t });
      }

      // Record price history snapshot
      const prices = Object.fromEntries(pricedOutcomes.map(o => [o.id, o.probability]));
      await PriceHistory.create({
        market_id,
        timestamp: new Date(),
        prices
      }, { transaction: t });

      if (user_id && user_id !== 'demo_user') {
        const balanceAfterTrade = await calculateBalanceFromTransactions(user_id, t);
        if (balanceAfterTrade.rawBalance < 0) {
          throw Object.assign(new Error('Trade would create negative buying power and was removed.'), {
            status: 402,
            details: {
              available_balance: 0,
              raw_balance: balanceAfterTrade.rawBalance,
              removed_prediction_id: prediction.id
            }
          });
        }
      }

      return prediction;
    });

    res.status(201).json(normalizePrediction(result));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, ...(error.details || {}) });
    console.error('Create prediction error:', error);
    res.status(500).json({ error: 'Failed to create prediction' });
  }
});

// ============================================================================
// SELL POSITION — Database backed
// ============================================================================

/**
 * Calculate the Mark-to-Market (MTM) cash value of selling a position.
 * Based on S(1-p) payout model:
 *   R_min = S × p_entry (loss case)
 *   R_max = S × (2 - p_entry) (win case)
 *   R_current = R_min + (R_max - R_min) × p_current
 *   Simplified: R = S × (p_entry + 2×p_current×(1 - p_entry))
 * 
 * @param {number} stake - Position size in dollars
 * @param {number} entryProb - Entry probability (0-100)
 * @param {number} currentProb - Current probability (0-100)
 * @returns {number} Cash value user receives
 */
function calculatePositionValue(stake, entryProb, currentProb) {
  const pEntry = Math.max(0.01, Math.min(99, entryProb)) / 100; // 0.01 to 0.99
  const pCurrent = Math.max(0.01, Math.min(99, currentProb)) / 100; // 0.01 to 0.99

  // R = S × (p_entry + 2×p_current×(1 - p_entry))
  const returnValue = stake * (pEntry + 2 * pCurrent * (1 - pEntry));

  return Number(Math.max(0, returnValue).toFixed(2));
}

app.post('/api/positions/sell', async (req, res) => {
  try {
    const { market_id, outcome_id, user_id, sell_amount } = req.body;

    if (!market_id || !outcome_id || !user_id || typeof sell_amount !== 'number' || sell_amount <= 0) {
      return res.status(400).json({ error: 'Invalid sell payload' });
    }

    const result = await sequelize.transaction(async (t) => {
      const market = await Market.findByPk(market_id, {
        include: [{ model: Outcome, as: 'outcomes' }],
        transaction: t
      });
      if (!market) throw Object.assign(new Error('Market not found'), { status: 404 });
      if (market.status !== 'active') throw Object.assign(new Error('Cannot sell on a resolved market'), { status: 400 });

      const outcome = market.outcomes.find(o => o.id === outcome_id);
      if (!outcome) throw Object.assign(new Error('Outcome not found'), { status: 400 });

      const currentProb = parseFloat(outcome.probability || 50);

      let userAliases = [user_id];
      const user = await User.findOne({
        where: { [Op.or]: [{ id: user_id }, { email: user_id }] },
        transaction: t
      });
      if (user) {
        userAliases.push(user.id);
        if (user.email && user.email !== `${user_id}@placeholder.com`) userAliases.push(user.email);
      }
      userAliases = [...new Set(userAliases)];

      // Find all active predictions for this user/market/outcome
      const userPositions = await Prediction.findAll({
        where: { user_id: { [Op.in]: userAliases }, market_id, outcome_id, status: 'active' },
        order: [['created_at', 'ASC']],
        transaction: t
      });

      const totalStake = userPositions.reduce((sum, p) => sum + parseFloat(p.stake_amount || 0), 0);

      if (totalStake === 0) {
        // Diagnostic: check if predictions exist with any status
        const anyPreds = await Prediction.count({ where: { user_id, market_id, outcome_id }, transaction: t });
        throw Object.assign(
          new Error(`No active position to sell (found ${anyPreds} prediction(s) total for this user/market/outcome, 0 with status=active)`),
          { status: 400 }
        );
      }
      if (sell_amount > totalStake) throw Object.assign(new Error(`Cannot sell more than your position ($${totalStake.toFixed(2)})`), { status: 400 });

      // Weighted average entry probability
      const weightedOddsSum = userPositions.reduce((sum, p) => sum + parseFloat(p.odds_at_prediction || 50) * parseFloat(p.stake_amount || 0), 0);
      const avgEntryProb = weightedOddsSum / totalStake;

      const sellReturn = calculatePositionValue(sell_amount, avgEntryProb, currentProb);

      // Reduce stakes across predictions (oldest first)
      let remaining = sell_amount;
      for (const p of userPositions) {
        if (remaining <= 0) break;
        const stake = parseFloat(p.stake_amount || 0);
        if (stake <= remaining) {
          remaining -= stake;
          await p.update({
            status: 'sold',
            actual_return: calculatePositionValue(stake, avgEntryProb, currentProb),
            sold_at: new Date()
          }, { transaction: t });
        } else {
          const splitStake = parseFloat(remaining.toFixed(2));
          const splitReturn = calculatePositionValue(splitStake, avgEntryProb, currentProb);
          await Prediction.create({
            id: nanoid(12),
            market_id: p.market_id,
            outcome_id: p.outcome_id,
            user_id: p.user_id,
            stake_amount: splitStake,
            odds_at_prediction: p.odds_at_prediction,
            potential_return: parseFloat((splitStake + splitStake * (1 - (parseFloat(p.odds_at_prediction || 50) / 100))).toFixed(2)),
            actual_return: splitReturn,
            status: 'sold',
            sold_at: new Date()
          }, { transaction: t });

          await p.update({
            stake_amount: parseFloat((stake - splitStake).toFixed(2))
          }, { transaction: t });
          remaining = 0;
        }
      }

      // Update outcome total_stake and market total_volume
      const newOutcomeStake = Math.max(0, parseFloat(outcome.total_stake || 0) - sell_amount);
      await outcome.update({ total_stake: newOutcomeStake }, { transaction: t });

      const newTotalVolume = Math.max(0, parseFloat(market.total_volume || 0) - sell_amount);
      await market.update({ total_volume: newTotalVolume }, { transaction: t });

      // Recompute probabilities
      const allOutcomes = await Outcome.findAll({ where: { market_id }, transaction: t });
      const outcomesData = allOutcomes.map(o => o.toJSON());
      const pricedOutcomes = recomputeProbabilities(outcomesData, newTotalVolume, market.market_type);

      for (const po of pricedOutcomes) {
        await Outcome.update({ probability: po.probability }, { where: { id: po.id }, transaction: t });
      }

      // Record price history snapshot
      const prices = Object.fromEntries(pricedOutcomes.map(o => [o.id, o.probability]));
      await PriceHistory.create({ market_id, timestamp: new Date(), prices }, { transaction: t });

      // Record sell return as a transaction (credit back to user's cash)
      if (sellReturn > 0) {
        await Transaction.create({
          id: nanoid(12),
          user_id: user_id,
          type: 'deposit',
          amount: sellReturn,
          payment_method: 'sell_return',
          status: 'completed',
          completed_at: new Date()
        }, { transaction: t });
      }

      const updatedMarket = await fetchMarketWithRelations(market_id, t);

      return {
        sell_amount,
        sell_return: sellReturn,
        net_pnl: parseFloat((sellReturn - sell_amount).toFixed(2)),
        current_probability: currentProb,
        avg_entry_probability: parseFloat(avgEntryProb.toFixed(2)),
        market: formatMarketResponse(updatedMarket)
      };
    });

    res.json({ ok: true, ...result });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Sell position error:', error);
    res.status(500).json({ error: 'Failed to sell position' });
  }
});

// ============================================================================
// MARKET RESOLUTION
// ============================================================================

app.post('/api/markets/:id/resolve', async (req, res) => {
  try {
    const { winning_outcome_id, winning_outcome_ids } = req.body;

    const result = await sequelize.transaction(async (t) => {
      const market = await Market.findByPk(req.params.id, {
        include: [{ model: Outcome, as: 'outcomes' }],
        transaction: t
      });

      if (!market) {
        throw new Error('Market not found');
      }

      return resolveMarketInstance(market, winning_outcome_ids || winning_outcome_id, { transaction: t });
    });

    const refreshed = await fetchMarketWithRelations(req.params.id);
    res.json({
      ok: true,
      winning_outcome_ids: result.winningOutcomeIds,
      market: formatMarketResponse(refreshed)
    });
  } catch (error) {
    console.error('Resolve market error:', error);
    if (error.message === 'Market not found') {
      return res.status(404).json({ error: error.message });
    }
    if (error.status) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to resolve market' });
  }
});

// ============================================================================
// WALLET / USER ENDPOINTS
// ============================================================================

app.get('/api/users/:id/balance', async (req, res) => {
  try {
    let user = await User.findByPk(req.params.id);

    if (!user) {
      // Create default user if not found
      user = await User.create({
        id: req.params.id,
        username: req.params.id.substring(0, 20),
        email: `${req.params.id}@placeholder.com`
      });
    }

    // Calculate balance from transactions
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
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

app.get('/api/users/negative-buying-power', async (req, res) => {
  try {
    const users = await User.findAll({ order: [['created_at', 'DESC']] });
    const negativeUsers = [];

    for (const user of users) {
      const balanceInfo = await calculateBalanceFromTransactions(user.id);
      if (balanceInfo.rawBalance < 0) {
        negativeUsers.push({
          user_id: user.id,
          username: user.username,
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
          realized_pnl: balanceInfo.realizedPnl
        });
      }
    }

    res.json({
      count: negativeUsers.length,
      users: negativeUsers
    });
  } catch (error) {
    console.error('Negative buying power scan error:', error);
    res.status(500).json({ error: 'Failed to scan negative buying power users' });
  }
});

app.post('/api/users/fix-negative-buying-power', async (req, res) => {
  try {
    const users = await User.findAll({ order: [['created_at', 'DESC']] });
    const repairedUsers = [];

    for (const user of users) {
      const repair = await sequelize.transaction((t) => removeTradesCausingNegativeBuyingPower(user.id, t));
      if (repair.removed_predictions > 0) {
        repairedUsers.push({
          user_id: user.id,
          username: user.username,
          ...repair
        });
      }
    }

    res.json({
      ok: true,
      repaired_users: repairedUsers.length,
      removed_predictions: repairedUsers.reduce((sum, user) => sum + user.removed_predictions, 0),
      users: repairedUsers
    });
  } catch (error) {
    console.error('Bulk fix negative buying power error:', error);
    res.status(500).json({ error: 'Failed to fix negative buying power users' });
  }
});

app.post('/api/users/:id/fix-balance', async (req, res) => {
  try {
    const repair = await sequelize.transaction(async (t) => {
      let user = await User.findByPk(req.params.id, { transaction: t });
      if (!user) {
        user = await User.create({
          id: req.params.id,
          username: req.params.id.substring(0, 20),
          email: `${req.params.id}@placeholder.com`
        }, { transaction: t });
      }

      return removeTradesCausingNegativeBuyingPower(req.params.id, t);
    });

    res.json({
      ok: true,
      message: repair.removed_predictions > 0
        ? `Removed ${repair.removed_predictions} trade(s) to restore non-negative buying power.`
        : 'Buying power is already non-negative.',
      ...repair,
      cancelled_predictions: repair.removed_predictions
    });
  } catch (error) {
    console.error('Fix balance error:', error);
    res.status(500).json({ error: 'Failed to fix balance' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    console.log(`\n🗑️  DELETE /api/users/${userId} — Account deletion requested`);

    // Delete user transactions from local DB
    try {
      await Transaction.destroy({ where: { user_id: userId } });
      console.log('  ✓ Transactions deleted from local DB');
    } catch (e) { console.log('  ✗ Transaction cleanup:', e.message); }

    // Delete user from local DB
    try {
      await User.destroy({ where: { id: userId } });
      console.log('  ✓ User deleted from local DB');
    } catch (e) { console.log('  ✗ User cleanup:', e.message); }

    // Delete from Supabase auth (requires service role key)
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    console.log(`  Supabase URL: ${supabaseUrl ? '✓ found' : '✗ MISSING'}`);
    console.log(`  Service Role Key: ${serviceRoleKey ? '✓ found (' + serviceRoleKey.substring(0, 20) + '...)' : '✗ MISSING'}`);

    if (supabaseUrl && serviceRoleKey) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false }
        });

        // Delete profile data from Supabase tables
        const profileRes = await supabaseAdmin.from('profiles').delete().eq('id', userId);
        console.log(`  Profiles delete: ${profileRes.error ? '✗ ' + profileRes.error.message : '✓ done'}`);

        const usersRes = await supabaseAdmin.from('users').delete().eq('id', userId);
        console.log(`  Users table delete: ${usersRes.error ? '✗ ' + usersRes.error.message : '✓ done'}`);

        // Delete the auth user entirely
        console.log(`  Deleting auth user ${userId}...`);
        const { data, error } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (error) {
          console.error(`  ✗ Supabase auth.admin.deleteUser FAILED: ${error.message}`);
          console.error('    Full error:', JSON.stringify(error));
        } else {
          console.log(`  ✅ User ${userId} FULLY DELETED from Supabase auth`);
        }
      } catch (e) {
        console.error('  ✗ Supabase admin error:', e.message);
        console.error('    Stack:', e.stack);
      }
    } else {
      console.warn('  ⚠️  SUPABASE_SERVICE_ROLE_KEY not set — auth user NOT deleted');
    }

    console.log('  → Sending success response\n');
    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

app.post('/api/users/:id/deposit', async (req, res) => {
  try {
    const { amount, payment_method = 'card' } = req.body;

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Invalid deposit amount' });
    }

    if (amount > 10000) {
      return res.status(400).json({ error: 'Maximum deposit is $10,000' });
    }
    const result = await sequelize.transaction(async (t) => {
      // Get or create user
      let user = await User.findByPk(req.params.id, { transaction: t });

      if (!user) {
        user = await User.create({
          id: req.params.id,
          username: req.params.id.substring(0, 20),
          email: `${req.params.id}@placeholder.com`
        }, { transaction: t });
      }

      // Create transaction
      const transaction = await Transaction.create({
        id: nanoid(12),
        user_id: req.params.id,
        type: 'deposit',
        amount,
        payment_method,
        status: 'completed',
        completed_at: new Date()
      }, { transaction: t });

      return transaction;
    });

    // Calculate new balance
    const balanceInfo = await calculateBalanceFromTransactions(req.params.id);

    res.status(201).json({
      success: true,
      transaction: result,
      new_balance: balanceInfo.balance
    });
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ error: 'Failed to process deposit' });
  }
});

app.post('/api/payments/create-intent', async (req, res) => {
  const { userId, amount, currency = 'usd' } = req.body;
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }
  const cents = Math.round(amount * 100);
  if (cents > 100000000) {
    return res.status(400).json({ error: 'Amount too large' });
  }
  let pi;
  try {
    pi = await stripe.paymentIntents.create({
      amount: cents,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: { userId },
      description: 'Wallet deposit'
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Failed to create intent' });
  }
  await Transaction.create({
    id: nanoid(12),
    user_id: userId,
    type: 'deposit',
    amount,
    payment_method: 'card',
    status: 'pending'
  });
  res.json({ client_secret: pi.client_secret, intent_id: pi.id });
});

app.post('/api/payments/create-checkout-session', async (req, res) => {
  const { userId, priceId, quantity = 1 } = req.body;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  if (!priceId || typeof priceId !== 'string') {
    return res.status(400).json({ error: 'Invalid priceId' });
  }
  const origin = `${req.protocol}://${req.get('host')}`;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity }],
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=canceled`,
      subscription_data: { metadata: { userId } }
    });
    res.json({ id: session.id, url: session.url || null });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to create checkout session' });
  }
});

app.post('/api/users/:id/withdraw', async (req, res) => {
  try {
    const { amount, withdrawal_method = 'bank' } = req.body;

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Invalid withdrawal amount' });
    }

    // Calculate current balance
    const currentBalanceInfo = await calculateBalanceFromTransactions(req.params.id);

    if (currentBalanceInfo.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const result = await sequelize.transaction(async (t) => {
      // Ensure user exists
      let user = await User.findByPk(req.params.id, { transaction: t });

      if (!user) {
        user = await User.create({
          id: req.params.id,
          username: req.params.id.substring(0, 20),
          email: `${req.params.id}@placeholder.com`
        }, { transaction: t });
      }

      // Create withdrawal transaction
      const transaction = await Transaction.create({
        id: nanoid(12),
        user_id: req.params.id,
        type: 'withdrawal',
        amount,
        payment_method: withdrawal_method,
        status: 'completed',
        completed_at: new Date()
      }, { transaction: t });

      return transaction;
    });

    // Calculate new balance
    const balanceInfo = await calculateBalanceFromTransactions(req.params.id);

    res.status(201).json({
      success: true,
      transaction: result,
      new_balance: balanceInfo.balance
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ error: 'Failed to process withdrawal' });
  }
});

app.get('/api/users/:id/transactions', async (req, res) => {
  try {
    const transactions = await Transaction.findAll({
      where: { user_id: req.params.id },
      order: [['created_at', 'DESC']]
    });

    res.json(transactions);
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ============================================================================
// NOTIFICATIONS
// ============================================================================

app.get('/api/users/:id/notifications', async (req, res) => {
  try {
    const notifications = await Notification.findAll({
      where: { user_id: req.params.id },
      order: [['created_at', 'DESC']],
      limit: 50
    });
    res.json(notifications);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    const notification = await Notification.findByPk(req.params.id);
    if (notification) {
      await notification.update({ is_read: true });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Update notification error:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

app.put('/api/users/:id/notifications/read-all', async (req, res) => {
  try {
    await Notification.update(
      { is_read: true },
      { where: { user_id: req.params.id, is_read: false } }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Update all notifications error:', error);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

app.delete('/api/users/:id/notifications', async (req, res) => {
  try {
    await Notification.destroy({ where: { user_id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete notifications error:', error);
    res.status(500).json({ error: 'Failed to delete notifications' });
  }
});

// ============================================================================
// ADMIN ENDPOINTS
// ============================================================================

app.get('/api/admin/users', async (req, res) => {
  try {
    const { adminEmail } = req.query;
    if (adminEmail !== 'donotreply.dobium@gmail.com') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if (supabaseUrl && serviceRoleKey) {
      const { createClient } = require('@supabase/supabase-js');
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });

      const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
      if (error) {
        console.error('Supabase admin listUsers error:', error);
      } else {
        const formattedUsers = users.map(u => ({
          id: u.id,
          email: u.email,
          username: u.user_metadata?.name || u.user_metadata?.full_name || u.user_metadata?.username || (u.email ? u.email.split('@')[0] : 'Unknown'),
          created_at: u.created_at
        }));

        formattedUsers.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return res.json(formattedUsers);
      }
    }

    const users = await User.findAll({
      attributes: ['id', 'username', 'email', 'created_at'],
      order: [['created_at', 'DESC']]
    });
    res.json(users);
  } catch (error) {
    console.error('Admin fetch users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/admin/send-email', async (req, res) => {
  try {
    const { to, subject, text, html, adminEmail } = req.body;

    // Verify admin identity
    if (adminEmail !== 'donotreply.dobium@gmail.com') {
      return res.status(403).json({ error: 'Forbidden — admin access required' });
    }

    if (!to || !subject) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const styledHtml = html || `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 20px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #d4af37; margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.5px;">Dobium</h1>
          <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Prediction Markets</p>
        </div>
        <div style="color: #334155; font-size: 16px; line-height: 1.6; white-space: pre-wrap; background-color: #f8fafc; padding: 24px; border-radius: 8px;">
          ${text}
        </div>
        <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e2e8f0; text-align: center;">
          <p style="color: #94a3b8; font-size: 13px; margin: 0;">&copy; ${new Date().getFullYear()} Dobium. All rights reserved.</p>
          <p style="color: #cbd5e1; font-size: 12px; margin-top: 8px;">You are receiving this system notification because you are a registered user of Dobium.</p>
        </div>
      </div>
    `;

    const info = await sendEmail({ to, subject, text, html: styledHtml });
    res.json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error('Admin email error:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// ============================================================================
// ADMIN — BROADCAST CAMPAIGNS
// ============================================================================

// Known campaigns — each defines the email payload
const BROADCAST_CAMPAIGNS = {
  iceman_launch: {
    id: 'iceman_launch',
    name: "Drake's Iceman — Live Markets",
    subject: "New live markets now open for Drake's Iceman 📊",
    buildHtml: (username, platformUrl) => {
      const year = new Date().getFullYear();
      const ctaUrl = `${platformUrl}/explore`;
      const questions = [
        { emoji: '📦', label: 'First-Week Sales', question: 'How many units will <em>Iceman</em> sell in its first week?' },
        { emoji: '📊', label: 'Billboard', question: 'Will Iceman debut at number 1 on the Billboard 200?' },
        { emoji: '🎧', label: 'Most Streamed', question: 'Most streamed song on <em>Iceman</em>?' },
      ];
      const questionsHtml = questions.map(q => `
        <tr><td style="padding:12px 16px;border-bottom:1px solid #1e3a5f;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="36" style="vertical-align:top;padding-top:2px;">
              <div style="width:28px;height:28px;border-radius:6px;background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.3);text-align:center;line-height:28px;font-size:14px;">${q.emoji}</div>
            </td>
            <td style="padding-left:10px;">
              <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#d4af37;margin-bottom:2px;">${q.label}</div>
              <div style="font-size:13px;color:#cbd5e1;line-height:1.5;">${q.question}</div>
            </td>
          </tr></table>
        </td></tr>`).join('');

      return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${BROADCAST_CAMPAIGNS.iceman_launch.subject}</title></head>
<body style="margin:0;padding:0;background-color:#0a0f1e;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0f1e;padding:32px 16px 48px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;border-radius:16px;overflow:hidden;border:1px solid rgba(212,175,55,0.2);box-shadow:0 0 48px rgba(212,175,55,0.06);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#7a5c10,#b8952a,#d4af37,#f0cc6a,#d4af37,#b8952a,#7a5c10);font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td align="center" style="padding:20px 32px 18px;background-color:#071428;">
          <img src="${platformUrl}/Logo-Title.png" alt="Dobium" width="130" style="display:block;height:auto;border:0;margin:0 auto;" />
        </td></tr>
        <tr><td align="center" style="padding:36px 32px 32px;background:linear-gradient(160deg,#0c1e40 0%,#071428 60%,#04101f 100%);">
          <div style="width:56px;height:56px;border-radius:14px;background:rgba(212,175,55,0.1);border:1.5px solid rgba(212,175,55,0.4);margin:0 auto 20px;text-align:center;line-height:56px;font-size:26px;">📊</div>
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;color:#f1f5f9;line-height:1.2;letter-spacing:-0.5px;">Drake's Iceman — Live Markets Are Open</h1>
          <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;max-width:380px;">The album dropped. The data is moving. Be first to trade it.</p>
        </td></tr>
        <tr><td style="background:#0a1628;padding:22px 32px;border-top:1px solid rgba(212,175,55,0.1);border-bottom:1px solid rgba(212,175,55,0.1);">
          ${username ? `<p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#f1f5f9;">Hey ${username},</p>` : ''}
          <p style="margin:0;font-size:14px;color:#94a3b8;line-height:1.8;">Drake's <strong>Iceman</strong> is officially out — and real performance data is already shaping up.</p>
          <p style="margin:12px 0 0;font-size:14px;color:#94a3b8;line-height:1.8;">We've opened a set of short-term prediction markets on <strong style="color:#d4af37;">Dobium</strong> so you can track what happens next in real time.</p>
        </td></tr>
        <tr><td style="background:#071428;padding:20px 32px 4px;">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#475569;">Right now, you can trade on</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #1e3a5f;border-radius:10px;overflow:hidden;background:#0a1628;">
            ${questionsHtml}
          </table>
        </td></tr>
        <tr><td style="background:#071428;padding:20px 32px 8px;">
          <p style="margin:0;font-size:13px;color:#64748b;line-height:1.8;">These markets close soon — prices will move as more data comes in. The earlier you trade, the more edge you have.</p>
        </td></tr>
        <tr><td align="center" style="background:#071428;padding:28px 32px 36px;">
          <p style="margin:0 0 18px;font-size:13px;color:#64748b;">You can view and trade all live markets on Dobium</p>
          <a href="${ctaUrl}" style="display:inline-block;padding:15px 52px;background:linear-gradient(135deg,#b8952a 0%,#d4af37 50%,#e8c645 100%);color:#0a0f1e;font-size:15px;font-weight:900;text-decoration:none;border-radius:10px;letter-spacing:0.3px;box-shadow:0 4px 20px rgba(212,175,55,0.3);">Start Trading →</a>
        </td></tr>
        <tr><td align="center" style="padding:22px 32px 24px;background:#04101f;border-top:1px solid rgba(255,255,255,0.04);">
          <p style="margin:0 0 4px;font-size:11px;color:#334155;">© ${year} Dobium &middot; All rights reserved.</p>
          <p style="margin:0;font-size:10px;color:#1e293b;line-height:1.6;">You received this because you are a registered user of Dobium Prediction Markets.<br/>This is an automated platform update.</p>
        </td></tr>
        <tr><td style="height:3px;background:linear-gradient(90deg,#7a5c10,#b8952a,#d4af37,#f0cc6a,#d4af37,#b8952a,#7a5c10);font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
    },
    buildText: () => `Drake's Iceman is officially out — and the first wave of real performance data is already shaping up.

We've opened a set of short-term prediction markets on Dobium so you can track what happens next in real time.

Right now, you can trade on questions like:

  📦 First-Week Sales — How many units will Iceman sell in its first week?
  📊 Billboard  — Will Iceman debut at number 1 on the Billboard 200?
  🎧 Most Streams — Most streamed song on <em>Iceman</em>?

These markets close soon — prices will move as more data comes in. The earlier you trade, the more edge you have.

Start Trading: ${platformUrl}/explore`
  }
};

// ── Custom campaign HTML builder ──────────────────────────────────────────────
function buildCustomBroadcastHtml({ heading, heroIcon = '✦', body, callout, ctaLabel, ctaUrl, username, subject, platformUrl }) {
  const year = new Date().getFullYear();
  const safeBody = (body || '').replace(/\n/g, '<br/>');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${subject || 'A message from Dobium'}</title></head>
<body style="margin:0;padding:0;background-color:#0a0f1e;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0f1e;padding:32px 16px 48px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;border-radius:16px;overflow:hidden;border:1px solid rgba(212,175,55,0.2);box-shadow:0 0 48px rgba(212,175,55,0.06);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#7a5c10,#b8952a,#d4af37,#f0cc6a,#d4af37,#b8952a,#7a5c10);font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td align="center" style="padding:20px 32px 18px;background-color:#071428;">
          <img src="${platformUrl}/Logo-Title.png" alt="Dobium" width="130" style="display:block;height:auto;border:0;margin:0 auto;" />
        </td></tr>
        <tr><td align="center" style="padding:36px 32px 32px;background:linear-gradient(160deg,#0c1e40 0%,#071428 60%,#04101f 100%);">
          <div style="width:52px;height:52px;border-radius:14px;background:rgba(212,175,55,0.1);border:1.5px solid rgba(212,175,55,0.4);margin:0 auto 18px;text-align:center;line-height:52px;font-size:24px;">${heroIcon}</div>
          <h1 style="margin:0 0 6px;font-size:22px;font-weight:900;color:#f1f5f9;line-height:1.25;letter-spacing:-0.3px;">${heading || 'A message from Dobium'}</h1>
          <p style="margin:0;font-size:12px;color:#475569;line-height:1.5;">${subject || ''}</p>
        </td></tr>
        <tr><td style="background:#0a1628;padding:24px 32px;border-top:1px solid rgba(212,175,55,0.1);border-bottom:1px solid rgba(212,175,55,0.1);">
          ${username ? `<p style="margin:0 0 10px;font-size:15px;font-weight:600;color:#f1f5f9;">Hi ${username},</p>` : ''}
          <p style="margin:0;font-size:14px;color:#94a3b8;line-height:1.85;">${safeBody}</p>
        </td></tr>
        ${callout ? `<tr><td style="background:#071428;padding:18px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="border-left:3px solid #d4af37;background:rgba(212,175,55,0.06);border-radius:0 8px 8px 0;padding:12px 16px;">
              <p style="margin:0;font-size:13px;color:#a78040;line-height:1.6;">${callout}</p>
            </td>
          </tr></table>
        </td></tr>` : ''}
        ${ctaLabel && ctaUrl ? `<tr><td align="center" style="background:#071428;padding:28px 32px 36px;">
          <a href="${ctaUrl}" style="display:inline-block;padding:14px 48px;background:linear-gradient(135deg,#b8952a 0%,#d4af37 50%,#e8c645 100%);color:#0a0f1e;font-size:14px;font-weight:900;text-decoration:none;border-radius:10px;box-shadow:0 4px 20px rgba(212,175,55,0.3);">${ctaLabel}</a>
        </td></tr>` : ''}
        <tr><td align="center" style="padding:22px 32px 24px;background:#04101f;border-top:1px solid rgba(255,255,255,0.04);">
          <p style="margin:0 0 4px;font-size:11px;color:#334155;">© ${year} Dobium &middot; All rights reserved.</p>
          <p style="margin:0;font-size:10px;color:#1e293b;line-height:1.6;">You received this because you are a registered user of Dobium Prediction Markets.</p>
        </td></tr>
        <tr><td style="height:3px;background:linear-gradient(90deg,#7a5c10,#b8952a,#d4af37,#f0cc6a,#d4af37,#b8952a,#7a5c10);font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * POST /api/admin/send-broadcast
 * Body:
 *   Preset:  { campaignId, adminEmail, dryRun? }
 *   Custom:  { campaignId: 'custom', adminEmail, dryRun?,
 *              subject, heading, heroIcon, body, callout, ctaLabel, ctaUrl }
 */
app.post('/api/admin/send-broadcast', async (req, res) => {
  try {
    const {
      campaignId, adminEmail, dryRun = true,
      // Custom campaign fields
      subject, heading, heroIcon, body: bodyText, callout, ctaLabel, ctaUrl
    } = req.body;

    if (adminEmail !== 'donotreply.dobium@gmail.com') {
      return res.status(403).json({ error: 'Forbidden — admin access required' });
    }

    const platformUrl = process.env.PLATFORM_URL || 'https://dobium.com';

    // ── Resolve campaign ────────────────────────────────────────────────────
    let campaign;
    if (campaignId === 'custom') {
      if (!subject || !bodyText) {
        return res.status(400).json({ error: 'Custom campaign requires at least subject and body.' });
      }
      campaign = {
        id: 'custom',
        name: subject,
        subject,
        buildHtml: (username) => buildCustomBroadcastHtml({
          heading, heroIcon, body: bodyText, callout, ctaLabel,
          ctaUrl: ctaUrl || platformUrl,
          username, subject, platformUrl
        }),
        buildText: () => `${heading ? heading + '\n\n' : ''}${bodyText}${callout ? '\n\n' + callout : ''}${ctaLabel && ctaUrl ? '\n\n' + ctaLabel + ': ' + ctaUrl : ''}`
      };
    } else {
      campaign = BROADCAST_CAMPAIGNS[campaignId];
      if (!campaign) {
        return res.status(400).json({ error: `Unknown campaign: ${campaignId}` });
      }
    }

    // ── Fetch recipients ────────────────────────────────────────────────────
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ error: 'Supabase credentials not configured' });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) return res.status(500).json({ error: 'Failed to fetch users: ' + error.message });

    const SKIP = new Set(['donotreply.dobium@gmail.com', 'peepeeeepooopoo@gmail.com', 'hebdhdbdbsbhbbbhhdhdhsh@gmail.com']);
    const recipients = data.users
      .filter(u => u.email && !SKIP.has(u.email))
      .map(u => ({
        email: u.email,
        username: u.user_metadata?.name || u.user_metadata?.full_name || null
      }));

    // ── Dry-run ─────────────────────────────────────────────────────────────
    if (dryRun) {
      return res.json({
        dryRun: true,
        campaign: { id: campaign.id, name: campaign.name, subject: campaign.subject },
        recipientCount: recipients.length,
        recipients: recipients.map(r => r.email),
        previewHtml: campaign.buildHtml(null, platformUrl)
      });
    }

    // ── Live send ───────────────────────────────────────────────────────────
    const results = { sent: 0, failed: 0, errors: [] };

    for (const recipient of recipients) {
      try {
        await sendEmail({
          to: recipient.email,
          subject: campaign.subject,
          text: campaign.buildText(),
          html: campaign.buildHtml(recipient.username, platformUrl)
        });
        results.sent++;
        await new Promise(r => setTimeout(r, 700));
      } catch (err) {
        results.failed++;
        results.errors.push({ email: recipient.email, error: err.message });
      }
    }

    res.json({ dryRun: false, campaign: campaign.name, ...results });
  } catch (error) {
    console.error('Broadcast error:', error);
    res.status(500).json({ error: 'Broadcast failed: ' + error.message });
  }
});


// ============================================================================
// SPA FALLBACK — let React Router handle all non-API routes
// ============================================================================

app.get('*', (req, res) => {
  // Only serve the React app for non-API routes
  if (req.path.startsWith('/api/') || req.path.startsWith('/config/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(REACT_BUILD, 'index.html'));
});

// ============================================================================
// START SERVER
// ============================================================================

async function seedMarketsFromJson() {
  const marketsPath = path.join(__dirname, 'data', 'markets.json');
  try {
    const raw = await fs.readFile(marketsPath, 'utf-8');
    const markets = JSON.parse(raw || '[]');
    console.log(`📦 Found ${markets.length} markets in JSON, checking database...`);

    for (const m of markets) {
      const existing = await Market.findByPk(m.id);
      if (existing) {
        console.log(`  ⏭️  "${m.title}" already in DB`);
        continue;
      }
      try {
        await sequelize.transaction(async (t) => {
          await Market.create({
            id: m.id, title: m.title, description: m.description,
            category: m.category, status: m.status || 'active',
            close_date: m.close_date, resolution_date: m.resolution_date,
            market_type: m.market_type || 'binary', total_volume: m.total_volume || 0,
            image_url: m.image_url, winning_outcome_id: m.winning_outcome_id,
            search_keywords: m.search_keywords
          }, { transaction: t });

          if (m.outcomes && m.outcomes.length > 0) {
            await Outcome.bulkCreate(m.outcomes.map(o => ({
              id: `${m.id}_${o.id}`, market_id: m.id, title: o.title,
              probability: o.probability || 0, total_stake: o.total_stake || 0
            })), { transaction: t });
          }

          if (m.price_history && m.price_history.length > 0) {
            await PriceHistory.bulkCreate(m.price_history.map(ph => ({
              market_id: m.id, timestamp: ph.timestamp, prices: ph.prices
            })), { transaction: t });
          }

          console.log(`  ✅ Seeded "${m.title}" (${m.outcomes?.length || 0} outcomes)`);
        });
      } catch (err) {
        console.error(`  ❌ Failed "${m.title}": ${err.message}`);
      }
    }
  } catch (err) {
    console.log(`⚠️  No markets.json found or read error: ${err.message}`);
  }
}

async function applyKnownMarketResolutions() {
  console.log('Applying known Iceman market resolutions...');
  for (const [marketId, resolution] of Object.entries(KNOWN_MARKET_RESOLUTIONS)) {
    try {
      await sequelize.transaction(async (t) => {
        const market = await Market.findByPk(marketId, {
          include: [{ model: Outcome, as: 'outcomes' }],
          transaction: t
        });

        if (!market) {
          console.log(`  Market ${marketId} not found; skipping`);
          return;
        }

        const result = await resolveMarketInstance(market, resolution.winningOutcomeIds, {
          transaction: t,
          resolutionDate: resolution.resolutionDate
        });

        console.log(`  Resolved ${marketId}: ${result.winningOutcomeIds.join(', ')}`);
      });
    } catch (err) {
      console.error(`  Failed to resolve ${marketId}: ${err.message}`);
    }
  }
}

async function initDatabase() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    if (process.env.NODE_ENV !== 'production') {
      // Full schema sync + seeding in development / Railway.
      // alter:true updates existing columns — safe for dev, too slow for serverless.
      await sequelize.sync({ alter: true });
      console.log('✅ Database synchronized (all tables created/updated)');

      const marketCount = await Market.count();
      console.log(`📊 Markets in database: ${marketCount}`);
      console.log('🌱 Seeding missing markets from JSON...');
      await seedMarketsFromJson();
      await applyKnownMarketResolutions();
    } else {
      // Production (Vercel): run a lightweight sync that only CREATEs missing tables.
      // This is fast (~200ms) and ensures tables like 'notifications' exist
      // without any ALTER TABLE statements that would timeout the cold start.
      await sequelize.sync({ alter: false, force: false });
      console.log('⚡ Production sync complete (missing tables created, existing tables untouched)');
    }
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    console.error('   Markets, predictions, and positions require a PostgreSQL database.');
    console.error('   Set DATABASE_URL in your environment variables.');
  }
}

// Always initialize the database (needed for both Railway and Vercel serverless)
initDatabase();

// Only bind to a TCP port when run directly (Railway / local dev).
// When imported as a module by Vercel's api/index.js, skip listen() entirely.
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`✅ Dobium API listening on http://localhost:${PORT}`);

    // Register the daily 12 PM CST digest email job
    registerDailyDigestJob(
      { User, Transaction, Prediction, Outcome, Market },
      sendEmail
    );
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use.`);
      console.error(`   In PowerShell, run:`);
      console.error(`   netstat -ano | findstr :${PORT}`);
      console.error(`   Then kill by PID:  taskkill /PID 12345 /F  (replace 12345 with the actual PID)`);
      process.exit(1);
    } else {
      throw err;
    }
  });
}

// Export the Express app for Vercel serverless (api/index.js)
module.exports = app;
