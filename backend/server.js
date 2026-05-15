require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs').promises;
const { nanoid } = require('nanoid');
const { Op } = require('sequelize');

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

const app = express();
const PORT = process.env.PORT || 3001;
const Stripe = require('stripe');
const stripeSecret = (process.env.STRIPE_SECRET_KEY || '').trim();
const stripe = stripeSecret ? Stripe(stripeSecret) : null;
const PAPER_TRADING_STARTING_BALANCE = Number(process.env.PAPER_TRADING_STARTING_BALANCE || 100000);

// CORS configuration - allow all origins temporarily for debugging
app.use(cors({
  origin: true,  // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(morgan('dev'));

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
  const transactions = await Transaction.findAll({
    where: { user_id: userId },
    ...(transaction ? { transaction } : {})
  });

  const activePredictions = await Prediction.findAll({
    where: { user_id: userId },
    ...(transaction ? { transaction } : {})
  });

  // Deposits/withdrawals are external paper-wallet adjustments.
  // Trade P&L is derived from prediction records so dashboard, market page,
  // and server-side buying-power checks all share one ledger.
  const totalDeposits = transactions
    .filter(t => t.type === 'deposit' && t.status === 'completed')
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
    .reduce((sum, p) => sum + parseFloat(p.actual_return || 0), 0);
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

  const activePredictions = await Prediction.findAll({
    where: { user_id: userId, status: 'active' },
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
  res.json({ ok: true, service: 'samsa-api', database: 'postgresql' });
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
    return outcomes.map(o => ({
      ...o,
      probability: parseFloat(
        ((BASE_LIQUIDITY + parseFloat(o.total_stake || 0)) / (2 * BASE_LIQUIDITY + parseFloat(o.total_stake || 0)) * 100).toFixed(2)
      )
    }));
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
  return {
    ...m,
    total_volume: parseFloat(m.total_volume || 0),
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
    const { title, description, category, outcomes = [], image_url = '', search_keywords = '', close_date = null, resolution_date = null, market_type = 'binary' } = req.body;
    if (!title || !description || !category || !Array.isArray(outcomes) || outcomes.length < 2) {
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

      const outcomeRecords = outcomes.map(o => ({
        id: `${marketId}_${o.id || nanoid(8)}`,
        market_id: marketId,
        title: o.title,
        probability: typeof o.probability === 'number' ? o.probability : Math.round(100 / outcomes.length),
        total_stake: 0
      }));
      await Outcome.bulkCreate(outcomeRecords, { transaction: t });

      // Initial price snapshot
      const prices = Object.fromEntries(outcomeRecords.map(o => [o.id, o.probability]));
      await PriceHistory.create({
        market_id: marketId,
        timestamp: new Date(),
        prices
      }, { transaction: t });

      return await fetchMarketWithRelations(marketId, t);
    });

    res.status(201).json(formatMarketResponse(result));
  } catch (error) {
    console.error('Create market error:', error);
    res.status(500).json({ error: 'Failed to create market' });
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
    stake_amount:       parseFloat(json.stake_amount)       || 0,
    odds_at_prediction: parseFloat(json.odds_at_prediction) || 0,
    potential_return:   parseFloat(json.potential_return)   || 0,
    actual_return:      parseFloat(json.actual_return)      || 0,
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
        defaults: { id: user_id, username: user_id.substring(0, 20), email: null }
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

      // Find all active predictions for this user/market/outcome
      const userPositions = await Prediction.findAll({
        where: { user_id, market_id, outcome_id, status: 'active' },
        order: [['created_at', 'ASC']],
        transaction: t
      });

      const totalStake = userPositions.reduce((sum, p) => sum + parseFloat(p.stake_amount || 0), 0);
      if (totalStake === 0) throw Object.assign(new Error('No active position to sell'), { status: 400 });
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
    const { winning_outcome_id } = req.body;

    const result = await sequelize.transaction(async (t) => {
      // Find market with outcomes
      const market = await Market.findByPk(req.params.id, {
        include: [{ model: Outcome, as: 'outcomes' }],
        transaction: t
      });

      if (!market) {
        throw new Error('Market not found');
      }

      const winOutcome = market.outcomes.find((o) => o.id === winning_outcome_id);
      if (!winOutcome) {
        throw new Error('Invalid winning_outcome_id');
      }

      // Update market status
      await market.update({
        status: 'resolved',
        winning_outcome_id,
        resolution_date: new Date()
      }, { transaction: t });

      // Update all predictions for this market
      const predictions = await Prediction.findAll({
        where: { market_id: market.id },
        transaction: t
      });

      for (const prediction of predictions) {
        const won = prediction.outcome_id === winning_outcome_id;
        await prediction.update({
          status: won ? 'won' : 'lost',
          actual_return: won ? prediction.potential_return : 0,
          resolved_at: new Date()
        }, { transaction: t });
      }

      return market;
    });

    res.json({ ok: true, market: formatMarketResponse(result) });
  } catch (error) {
    console.error('Resolve market error:', error);
    if (error.message === 'Market not found') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === 'Invalid winning_outcome_id') {
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
        username: 'user',
        email: ''
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
          username: 'user',
          email: ''
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
          username: 'user',
          email: ''
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
          username: 'user',
          email: ''
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

async function initDatabase() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');
    await sequelize.sync({ alter: true });
    console.log('✅ Database synchronized (all tables created/updated)');

    // Only seed markets that don't already exist — never wipe live data
    const marketCount = await Market.count();
    console.log(`📊 Markets in database: ${marketCount}`);
    console.log('🌱 Seeding missing markets from JSON...');
    await seedMarketsFromJson();
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    console.error('   Markets, predictions, and positions require a PostgreSQL database.');
    console.error('   Set DATABASE_URL in your environment variables.');
  }
}

const server = app.listen(PORT, () => {
  console.log(`✅ Samsa API listening on http://localhost:${PORT}`);
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

initDatabase();
