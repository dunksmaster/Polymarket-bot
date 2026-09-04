/**
 * Grade A Type System
 * Comprehensive TypeScript types for Polymarket trading bot
 */

import { z } from 'zod';

// ============================================================================
// Basic Types
// ============================================================================

export type Timestamp = number; // Unix timestamp in milliseconds
export type Address = `0x${string}`;
export type TxHash = `0x${string}`;
export type MarketId = string;
export type OutcomeId = string;

export interface TimeRange {
  startTime: Timestamp;
  endTime: Timestamp;
}

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

// ============================================================================
// Market Types
// ============================================================================

export enum MarketStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  RESOLVED = 'RESOLVED',
  PENDING = 'PENDING'
}

export enum MarketType {
  BINARY = 'BINARY',
  CATEGORICAL = 'CATEGORICAL',
  SCALAR = 'SCALAR'
}

export interface MarketOutcome {
  id: OutcomeId;
  name: string;
  price: number; // Price in cents (0-100)
  probability: number; // 0-1
  volume: number;
  openInterest: number;
  lastTradePrice: number;
  lastTradeTime: Timestamp;
}

export interface Market {
  id: MarketId;
  title: string;
  description: string;
  category: string;
  tags: string[];
  type: MarketType;
  status: MarketStatus;
  outcomes: MarketOutcome[];
  minBet: number;
  maxBet: number;
  feeRate: number; // Basis points
  volume24h: number;
  volumeTotal: number;
  liquidity: number;
  openInterest: number;
  creationTime: Timestamp;
  closeTime?: Timestamp;
  resolutionTime?: Timestamp;
  resolvedTime?: Timestamp;
  result?: string;
  creator: Address;
  oracleAddress: Address;
  conditionId: string;
  collateralToken: Address;
  imageUrl?: string;
  rulesUrl?: string;
}

export interface MarketOrderBook {
  marketId: MarketId;
  bids: Array<{
    price: number;
    size: number;
    total: number;
  }>;
  asks: Array<{
    price: number;
    size: number;
    total: number;
  }>;
  spread: number;
  midPrice: number;
  timestamp: Timestamp;
}

export interface MarketTrade {
  id: string;
  marketId: MarketId;
  outcomeId: OutcomeId;
  side: 'BUY' | 'SELL';
  price: number;
  amount: number;
  buyer: Address;
  seller: Address;
  timestamp: Timestamp;
  txHash: TxHash;
}

// ============================================================================
// Order Types
// ============================================================================

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL'
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP_LOSS = 'STOP_LOSS',
  TAKE_PROFIT = 'TAKE_PROFIT'
}

export enum OrderStatus {
  PENDING = 'PENDING',
  OPEN = 'OPEN',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED'
}

export interface Order {
  id: string;
  marketId: MarketId;
  outcomeId: OutcomeId;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  price: number;
  amount: number;
  filledAmount: number;
  remainingAmount: number;
  averageFillPrice: number;
  fees: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt?: Timestamp;
  clientOrderId?: string;
  strategy?: string;
}

export interface OrderRequest {
  marketId: MarketId;
  outcomeId: OutcomeId;
  side: OrderSide;
  type: OrderType;
  price?: number; // Required for limit orders
  amount: number;
  expiresAt?: Timestamp;
  clientOrderId?: string;
  strategy?: string;
}

export interface OrderUpdate {
  price?: number;
  amount?: number;
  status?: OrderStatus;
}

// ============================================================================
// Position Types
// ============================================================================

export interface Position {
  id: string;
  marketId: MarketId;
  outcomeId: OutcomeId;
  side: OrderSide;
  quantity: number;
  averageEntryPrice: number;
  currentValue: number;
  unrealizedPnL: number;
  realizedPnL: number;
  fees: number;
  openedAt: Timestamp;
  updatedAt: Timestamp;
  strategy?: string;
}

export interface Portfolio {
  totalValue: number;
  cashBalance: number;
  positionsValue: number;
  totalPnL: number;
  totalFees: number;
  positions: Position[];
  timestamp: Timestamp;
}

// ============================================================================
// Trading Strategy Types
// ============================================================================

export enum StrategyType {
  ARBITRAGE = 'ARBITRAGE',
  DIP_ARB = 'DIP_ARB',
  MARKET_MAKING = 'MARKET_MAKING',
  MOMENTUM = 'MOMENTUM',
  MEAN_REVERSION = 'MEAN_REVERSION',
  SMART_MONEY = 'SMART_MONEY',
  SENTIMENT = 'SENTIMENT',
  CUSTOM = 'CUSTOM'
}

export enum StrategyStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
  ERROR = 'ERROR'
}

export interface StrategyConfig {
  id: string;
  name: string;
  type: StrategyType;
  status: StrategyStatus;
  markets: MarketId[];
  parameters: Record<string, unknown>;
  riskLimits: RiskLimits;
  allocation: number; // Percentage of portfolio
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RiskLimits {
  maxPositionSize: number;
  maxDailyLoss: number;
  maxDrawdown: number;
  maxExposure: number;
  maxOrdersPerMinute: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
}

export interface StrategyMetrics {
  strategyId: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  totalVolume: number;
  totalFees: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  period: TimeRange;
}

// ============================================================================
// Account & Wallet Types
// ============================================================================

export interface Wallet {
  address: Address;
  balance: number;
  usdcBalance: number;
  shares: Array<{
    marketId: MarketId;
    outcomeId: OutcomeId;
    amount: number;
  }>;
  nonce: number;
}

export interface AccountStats {
  address: Address;
  totalVolume: number;
  totalTrades: number;
  totalPnL: number;
  totalFees: number;
  winRate: number;
  avgBetSize: number;
  largestWin: number;
  largestLoss: number;
  activePositions: number;
  closedPositions: number;
  memberSince: Timestamp;
  lastActiveAt: Timestamp;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    requestId: string;
    timestamp: Timestamp;
    duration: number;
  };
}

export interface WebSocketMessage<T> {
  type: string;
  payload: T;
  timestamp: Timestamp;
}

// ============================================================================
// Event Types
// ============================================================================

export interface MarketEvent {
  type: 'MARKET_CREATED' | 'MARKET_UPDATED' | 'MARKET_CLOSED' | 'MARKET_RESOLVED';
  marketId: MarketId;
  data: Partial<Market>;
  timestamp: Timestamp;
}

export interface TradeEvent {
  type: 'TRADE_EXECUTED';
  trade: MarketTrade;
  timestamp: Timestamp;
}

export interface OrderEvent {
  type: 'ORDER_CREATED' | 'ORDER_UPDATED' | 'ORDER_FILLED' | 'ORDER_CANCELLED';
  order: Order;
  timestamp: Timestamp;
}

export interface PositionEvent {
  type: 'POSITION_OPENED' | 'POSITION_UPDATED' | 'POSITION_CLOSED';
  position: Position;
  timestamp: Timestamp;
}

// ============================================================================
// Monitoring & Metrics Types
// ============================================================================

export interface MetricPoint {
  timestamp: Timestamp;
  value: number;
  labels?: Record<string, string>;
}

export interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkIn: number;
  networkOut: number;
  activeConnections: number;
  requestRate: number;
  errorRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
}

export interface TradingMetrics {
  totalVolume: number;
  totalTrades: number;
  totalPnL: number;
  activeStrategies: number;
  openOrders: number;
  openPositions: number;
  dailyPnL: number;
  weeklyPnL: number;
  monthlyPnL: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface BotConfig {
  apiKey: string;
  apiSecret: string;
  walletPrivateKey?: string;
  environment: 'development' | 'staging' | 'production';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  strategies: StrategyConfig[];
  riskManagement: {
    enabled: boolean;
    globalMaxExposure: number;
    globalMaxDailyLoss: number;
    circuitBreakerEnabled: boolean;
  };
  notifications: {
    email?: string;
    slack?: string;
    discord?: string;
    telegram?: string;
  };
  database: {
    url: string;
    poolSize: number;
    ssl: boolean;
  };
  redis: {
    url: string;
    prefix: string;
  };
  monitoring: {
    prometheus: {
      enabled: boolean;
      port: number;
    };
    grafana: {
      enabled: boolean;
      url?: string;
    };
  };
}

// ============================================================================
// Zod Schemas for Runtime Validation
// ============================================================================

export const MarketSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  type: z.nativeEnum(MarketType),
  status: z.nativeEnum(MarketStatus),
  outcomes: z.array(z.object({
    id: z.string(),
    name: z.string(),
    price: z.number().min(0).max(100),
    probability: z.number().min(0).max(1),
    volume: z.number().nonnegative(),
    openInterest: z.number().nonnegative(),
    lastTradePrice: z.number(),
    lastTradeTime: z.number()
  })),
  minBet: z.number().positive(),
  maxBet: z.number().positive(),
  feeRate: z.number().min(0).max(10000),
  volume24h: z.number().nonnegative(),
  volumeTotal: z.number().nonnegative(),
  liquidity: z.number().nonnegative(),
  openInterest: z.number().nonnegative(),
  creationTime: z.number(),
  closeTime: z.number().optional(),
  resolutionTime: z.number().optional(),
  resolvedTime: z.number().optional(),
  result: z.string().optional(),
  creator: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  oracleAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  conditionId: z.string(),
  collateralToken: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  imageUrl: z.string().url().optional(),
  rulesUrl: z.string().url().optional()
});

export const OrderSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  outcomeId: z.string(),
  side: z.nativeEnum(OrderSide),
  type: z.nativeEnum(OrderType),
  status: z.nativeEnum(OrderStatus),
  price: z.number().positive(),
  amount: z.number().positive(),
  filledAmount: z.number().nonnegative(),
  remainingAmount: z.number().nonnegative(),
  averageFillPrice: z.number().positive(),
  fees: z.number().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
  expiresAt: z.number().optional(),
  clientOrderId: z.string().optional(),
  strategy: z.string().optional()
});

export const PositionSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  outcomeId: z.string(),
  side: z.nativeEnum(OrderSide),
  quantity: z.number().nonnegative(),
  averageEntryPrice: z.number().positive(),
  currentValue: z.number().nonnegative(),
  unrealizedPnL: z.number(),
  realizedPnL: z.number(),
  fees: z.number().nonnegative(),
  openedAt: z.number(),
  updatedAt: z.number(),
  strategy: z.string().optional()
});

// ============================================================================
// Type Utilities
// ============================================================================

export type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type RequireOnlyOne<T, Keys extends keyof T = keyof T> = Pick<T, Exclude<keyof T, Keys>> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Record<Exclude<Keys, K>, undefined>>;
  }[Keys];

export type AtLeastOne<T> = {
  [K in keyof T]: Pick<T, K>;
}[keyof T];

export type ValueOf<T> = T[keyof T];

export type Nullable<T> = T | null;

export type Optional<T> = T | undefined;
