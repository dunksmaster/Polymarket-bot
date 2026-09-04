# Database Initialization Script
# This script runs when the PostgreSQL container starts for the first time

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create custom types
CREATE TYPE market_status AS ENUM ('OPEN', 'CLOSED', 'RESOLVED', 'PENDING');
CREATE TYPE market_type AS ENUM ('BINARY', 'CATEGORICAL', 'SCALAR');
CREATE TYPE order_side AS ENUM ('BUY', 'SELL');
CREATE TYPE order_type AS ENUM ('MARKET', 'LIMIT', 'STOP_LOSS', 'TAKE_PROFIT');
CREATE TYPE order_status AS ENUM ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED');
CREATE TYPE strategy_type AS ENUM ('ARBITRAGE', 'DIP_ARB', 'MARKET_MAKING', 'MOMENTUM', 'MEAN_REVERSION', 'SMART_MONEY', 'SENTIMENT', 'CUSTOM');
CREATE TYPE strategy_status AS ENUM ('ACTIVE', 'PAUSED', 'STOPPED', 'ERROR');

-- Markets table
CREATE TABLE IF NOT EXISTS markets (
    id VARCHAR PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    category VARCHAR(100),
    tags TEXT[],
    type market_type NOT NULL,
    status market_status NOT NULL DEFAULT 'OPEN',
    min_bet DECIMAL(20, 8) NOT NULL,
    max_bet DECIMAL(20, 8) NOT NULL,
    fee_rate INTEGER NOT NULL,
    volume_24h DECIMAL(20, 8) DEFAULT 0,
    volume_total DECIMAL(20, 8) DEFAULT 0,
    liquidity DECIMAL(20, 8) DEFAULT 0,
    open_interest DECIMAL(20, 8) DEFAULT 0,
    creation_time BIGINT NOT NULL,
    close_time BIGINT,
    resolution_time BIGINT,
    resolved_time BIGINT,
    result VARCHAR,
    creator VARCHAR(42) NOT NULL,
    oracle_address VARCHAR(42) NOT NULL,
    condition_id VARCHAR NOT NULL,
    collateral_token VARCHAR(42) NOT NULL,
    image_url TEXT,
    rules_url TEXT,
    last_updated BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Market outcomes table
CREATE TABLE IF NOT EXISTS market_outcomes (
    id VARCHAR PRIMARY KEY,
    market_id VARCHAR NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    name VARCHAR NOT NULL,
    price DECIMAL(5, 2) NOT NULL,
    probability DECIMAL(5, 4) NOT NULL,
    volume DECIMAL(20, 8) DEFAULT 0,
    open_interest DECIMAL(20, 8) DEFAULT 0,
    last_trade_price DECIMAL(5, 2),
    last_trade_time BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(market_id, name)
);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR PRIMARY KEY,
    market_id VARCHAR NOT NULL REFERENCES markets(id),
    outcome_id VARCHAR NOT NULL,
    side order_side NOT NULL,
    type order_type NOT NULL,
    status order_status NOT NULL DEFAULT 'PENDING',
    price DECIMAL(5, 2) NOT NULL,
    amount DECIMAL(20, 8) NOT NULL,
    filled_amount DECIMAL(20, 8) DEFAULT 0,
    remaining_amount DECIMAL(20, 8) NOT NULL,
    average_fill_price DECIMAL(5, 2),
    fees DECIMAL(20, 8) DEFAULT 0,
    client_order_id VARCHAR,
    strategy VARCHAR,
    expires_at BIGINT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    metadata JSONB
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
    id VARCHAR PRIMARY KEY,
    market_id VARCHAR NOT NULL REFERENCES markets(id),
    outcome_id VARCHAR NOT NULL,
    order_id VARCHAR REFERENCES orders(id),
    side order_side NOT NULL,
    price DECIMAL(5, 2) NOT NULL,
    amount DECIMAL(20, 8) NOT NULL,
    fees DECIMAL(20, 8) DEFAULT 0,
    buyer VARCHAR(42),
    seller VARCHAR(42),
    tx_hash VARCHAR(66),
    timestamp BIGINT NOT NULL,
    strategy VARCHAR,
    pnl DECIMAL(20, 8),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Positions table
CREATE TABLE IF NOT EXISTS positions (
    id VARCHAR PRIMARY KEY,
    market_id VARCHAR NOT NULL REFERENCES markets(id),
    outcome_id VARCHAR NOT NULL,
    side order_side NOT NULL,
    quantity DECIMAL(20, 8) NOT NULL,
    average_entry_price DECIMAL(5, 2) NOT NULL,
    current_value DECIMAL(20, 8) DEFAULT 0,
    unrealized_pnl DECIMAL(20, 8) DEFAULT 0,
    realized_pnl DECIMAL(20, 8) DEFAULT 0,
    fees DECIMAL(20, 8) DEFAULT 0,
    strategy VARCHAR,
    opened_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    closed_at BIGINT,
    is_active BOOLEAN DEFAULT true
);

-- Strategies table
CREATE TABLE IF NOT EXISTS strategies (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    type strategy_type NOT NULL,
    status strategy_status NOT NULL DEFAULT 'ACTIVE',
    markets TEXT[] DEFAULT '{}',
    parameters JSONB NOT NULL DEFAULT '{}',
    risk_limits JSONB NOT NULL,
    allocation DECIMAL(5, 2) NOT NULL,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    total_pnl DECIMAL(20, 8) DEFAULT 0,
    total_volume DECIMAL(20, 8) DEFAULT 0,
    total_fees DECIMAL(20, 8) DEFAULT 0,
    sharpe_ratio DECIMAL(10, 4),
    max_drawdown DECIMAL(10, 4),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

-- Account stats table
CREATE TABLE IF NOT EXISTS account_stats (
    id SERIAL PRIMARY KEY,
    address VARCHAR(42) NOT NULL UNIQUE,
    total_volume DECIMAL(20, 8) DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    total_pnl DECIMAL(20, 8) DEFAULT 0,
    total_fees DECIMAL(20, 8) DEFAULT 0,
    win_rate DECIMAL(5, 4) DEFAULT 0,
    avg_bet_size DECIMAL(20, 8),
    largest_win DECIMAL(20, 8),
    largest_loss DECIMAL(20, 8),
    active_positions INTEGER DEFAULT 0,
    closed_positions INTEGER DEFAULT 0,
    member_since BIGINT,
    last_active_at BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Metrics table for time-series data
CREATE TABLE IF NOT EXISTS metrics (
    id BIGSERIAL PRIMARY KEY,
    metric_name VARCHAR NOT NULL,
    metric_value DECIMAL NOT NULL,
    labels JSONB,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Error logs table
CREATE TABLE IF NOT EXISTS error_logs (
    id BIGSERIAL PRIMARY KEY,
    correlation_id VARCHAR NOT NULL,
    error_code VARCHAR NOT NULL,
    severity VARCHAR NOT NULL,
    message TEXT NOT NULL,
    service VARCHAR,
    operation VARCHAR,
    context JSONB,
    stack TEXT,
    retryable BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);
CREATE INDEX IF NOT EXISTS idx_markets_created_time ON markets(creation_time);
CREATE INDEX IF NOT EXISTS idx_markets_volume ON markets(volume_24h DESC);
CREATE INDEX IF NOT EXISTS idx_markets_search ON markets USING gin(title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_outcomes_market_id ON market_outcomes(market_id);

CREATE INDEX IF NOT EXISTS idx_orders_market_id ON orders(market_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_strategy ON orders(strategy);
CREATE INDEX IF NOT EXISTS idx_orders_client_id ON orders(client_order_id);

CREATE INDEX IF NOT EXISTS idx_trades_market_id ON trades(market_id);
CREATE INDEX IF NOT EXISTS idx_trades_order_id ON trades(order_id);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy);

CREATE INDEX IF NOT EXISTS idx_positions_market_id ON positions(market_id);
CREATE INDEX IF NOT EXISTS idx_positions_active ON positions(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_positions_strategy ON positions(strategy);

CREATE INDEX IF NOT EXISTS idx_strategies_type ON strategies(type);
CREATE INDEX IF NOT EXISTS idx_strategies_status ON strategies(status);

CREATE INDEX IF NOT EXISTS idx_metrics_name_timestamp ON metrics(metric_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_error_logs_severity ON error_logs(severity);
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_correlation ON error_logs(correlation_id);

-- Create functions
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION calculate_position_pnl()
RETURNS TRIGGER AS $$
BEGIN
    -- Get current market price
    SELECT COALESCE(avg(price), 0) INTO NEW.current_value
    FROM market_outcomes
    WHERE market_id = NEW.market_id AND id = NEW.outcome_id;
    
    -- Calculate unrealized PnL
    IF NEW.side = 'BUY' THEN
        NEW.unrealized_pnl := (NEW.current_value - NEW.average_entry_price) * NEW.quantity;
    ELSE
        NEW.unrealized_pnl := (NEW.average_entry_price - NEW.current_value) * NEW.quantity;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER update_markets_updated_at
    BEFORE UPDATE ON markets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_positions_pnl
    BEFORE UPDATE ON positions
    FOR EACH ROW
    EXECUTE FUNCTION calculate_position_pnl();

-- Insert default data
INSERT INTO account_stats (address, member_since, last_active_at)
VALUES ('0x0000000000000000000000000000000000000000', EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT, EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::BIGINT)
ON CONFLICT (address) DO NOTHING;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "user";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "user";
