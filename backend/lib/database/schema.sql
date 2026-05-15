-- ============================================================================
-- SAMSA PREDICTION MARKETS - DATABASE SCHEMA
-- ============================================================================
-- PostgreSQL Schema for migrating from JSON files to relational database

-- Markets Table
CREATE TABLE IF NOT EXISTS markets (
    id VARCHAR(12) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'closed')),
    close_date TIMESTAMP,
    resolution_date TIMESTAMP,
    total_volume DECIMAL(10,2) DEFAULT 0 CHECK (total_volume >= 0),
    image_url TEXT,
    winning_outcome_id TEXT,
    search_keywords TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Outcomes Table (market options)
CREATE TABLE IF NOT EXISTS outcomes (
    id VARCHAR(8) PRIMARY KEY,
    market_id VARCHAR(12) NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL,
    probability INTEGER DEFAULT 0 CHECK (probability >= 0 AND probability <= 100),
    total_stake DECIMAL(10,2) DEFAULT 0 CHECK (total_stake >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(market_id, title)
);

-- Predictions (Trades) Table
CREATE TABLE IF NOT EXISTS predictions (
    id VARCHAR(12) PRIMARY KEY,
    market_id VARCHAR(12) NOT NULL REFERENCES markets(id),
    outcome_id VARCHAR(8) NOT NULL REFERENCES outcomes(id),
    user_id VARCHAR(50) NOT NULL,
    stake_amount DECIMAL(10,2) NOT NULL CHECK (stake_amount > 0),
    odds_at_prediction DECIMAL(5,2) NOT NULL CHECK (odds_at_prediction >= 0 AND odds_at_prediction <= 100),
    potential_return DECIMAL(10,2),
    actual_return DECIMAL(10,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost', 'refunded')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
);

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    username VARCHAR(100),
    email VARCHAR(255) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transactions Table (deposits, withdrawals, payouts)
CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(12) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL REFERENCES users(id),
    type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'payout', 'refund')),
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(50),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Market indexes
CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);
CREATE INDEX IF NOT EXISTS idx_markets_close_date ON markets(close_date);
CREATE INDEX IF NOT EXISTS idx_markets_created_at ON markets(created_at DESC);

-- Outcome indexes
CREATE INDEX IF NOT EXISTS idx_outcomes_market ON outcomes(market_id);

-- Prediction indexes
CREATE INDEX IF NOT EXISTS idx_predictions_market ON predictions(market_id);
CREATE INDEX IF NOT EXISTS idx_predictions_user ON predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status);
CREATE INDEX IF NOT EXISTS idx_predictions_created_at ON predictions(created_at DESC);

-- Transaction indexes
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

-- ============================================================================
-- USEFUL VIEWS
-- ============================================================================

-- View: Active Markets with Stats
CREATE OR REPLACE VIEW v_active_markets AS
SELECT 
    m.*,
    COUNT(DISTINCT p.id) as prediction_count,
    COUNT(DISTINCT p.user_id) as unique_traders
FROM markets m
LEFT JOIN predictions p ON m.id = p.market_id AND p.status = 'active'
WHERE m.status = 'active'
GROUP BY m.id;

-- View: User Portfolio
CREATE OR REPLACE VIEW v_user_portfolio AS
SELECT 
    p.user_id,
    p.id as prediction_id,
    p.stake_amount,
    p.potential_return,
    p.actual_return,
    p.status,
    m.title as market_title,
    m.category,
    m.status as market_status,
    o.title as outcome_title,
    p.created_at
FROM predictions p
JOIN markets m ON p.market_id = m.id
JOIN outcomes o ON p.outcome_id = o.id
ORDER BY p.created_at DESC;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function: Update market updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger: Auto-update updated_at for markets
CREATE TRIGGER update_markets_updated_at BEFORE UPDATE ON markets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger: Auto-update updated_at for users
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- INITIAL DATA (Optional)
-- ============================================================================

-- Create default user
INSERT INTO users (id, username, email) 
VALUES ('user_default', 'Demo User', 'demo@samsa.com')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- HELPFUL QUERIES
-- ============================================================================

-- Get market stats
-- SELECT 
--     category, 
--     COUNT(*) as total_markets,
--     SUM(total_volume) as total_volume
-- FROM markets 
-- WHERE status = 'active'
-- GROUP BY category;

-- Get top traders
-- SELECT 
--     user_id,
--     COUNT(*) as total_predictions,
--     SUM(stake_amount) as total_staked,
--     SUM(CASE WHEN status = 'won' THEN actual_return ELSE 0 END) as total_winnings
-- FROM predictions
-- GROUP BY user_id
-- ORDER BY total_winnings DESC
-- LIMIT 10;

