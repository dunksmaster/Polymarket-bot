/**
 * Grade A Error Handling System
 * Comprehensive error hierarchy with structured logging and recovery
 */

import { z } from 'zod';

// ============================================================================
// Error Metadata Schema
// ============================================================================

const ErrorMetadataSchema = z.object({
  timestamp: z.string().datetime(),
  service: z.string(),
  operation: z.string(),
  correlationId: z.string().uuid(),
  retryable: z.boolean().optional(),
  retryAfter: z.number().optional(),
  context: z.record(z.unknown()).optional(),
  cause: z.unknown().optional(),
  stack: z.string().optional()
});

type ErrorMetadata = z.infer<typeof ErrorMetadataSchema>;

// ============================================================================
// Base Error Class
// ============================================================================

export class BaseError extends Error {
  public readonly metadata: ErrorMetadata;
  public readonly code: string;
  public readonly severity: 'low' | 'medium' | 'high' | 'critical';
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: string,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
    context?: Record<string, unknown>,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.severity = severity;
    this.isOperational = isOperational;
    this.metadata = {
      timestamp: new Date().toISOString(),
      service: process.env.SERVICE_NAME || 'polymarket-bot',
      operation: 'unknown',
      correlationId: this.generateCorrelationId(),
      context,
      stack: this.stack
    };

    Error.captureStackTrace(this, this.constructor);
  }

  private generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  public withOperation(operation: string): this {
    this.metadata.operation = operation;
    return this;
  }

  public withContext(context: Record<string, unknown>): this {
    this.metadata.context = { ...this.metadata.context, ...context };
    return this;
  }

  public withRetry(retryAfter: number): this {
    this.metadata.retryable = true;
    this.metadata.retryAfter = retryAfter;
    return this;
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      severity: this.severity,
      isOperational: this.isOperational,
      ...this.metadata,
      stack: process.env.NODE_ENV === 'development' ? this.stack : undefined
    };
  }
}

// ============================================================================
// API Errors
// ============================================================================

export class ApiError extends BaseError {
  public readonly statusCode: number;
  public readonly responseBody?: unknown;

  constructor(
    message: string,
    statusCode: number,
    responseBody?: unknown,
    context?: Record<string, unknown>
  ) {
    super(message, `API_${statusCode}`, 'high', context, true);
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export class RateLimitError extends ApiError {
  public readonly retryAfter: number;

  constructor(retryAfter: number, context?: Record<string, unknown>) {
    super(
      `Rate limit exceeded. Retry after ${retryAfter} seconds`,
      429,
      { retryAfter },
      context,
      true
    );
    this.retryAfter = retryAfter;
    this.metadata.retryable = true;
    this.metadata.retryAfter = retryAfter;
  }
}

export class AuthenticationError extends ApiError {
  constructor(message: string = 'Authentication failed', context?: Record<string, unknown>) {
    super(message, 401, { error: 'authentication_failed' }, context, false);
  }
}

export class AuthorizationError extends ApiError {
  constructor(message: string = 'Authorization failed', context?: Record<string, unknown>) {
    super(message, 403, { error: 'authorization_failed' }, context, false);
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string, id: string, context?: Record<string, unknown>) {
    super(`${resource} not found: ${id}`, 404, { resource, id }, context, true);
  }
}

export class ValidationError extends ApiError {
  public readonly validationErrors: Array<{ field: string; message: string }>;

  constructor(
    validationErrors: Array<{ field: string; message: string }>,
    context?: Record<string, unknown>
  ) {
    super(
      'Validation failed',
      400,
      { errors: validationErrors },
      context,
      true
    );
    this.validationErrors = validationErrors;
  }
}

// ============================================================================
// Trading Errors
// ============================================================================

export class TradingError extends BaseError {
  public readonly strategy?: string;
  public readonly marketId?: string;

  constructor(
    message: string,
    strategy?: string,
    marketId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'TRADING_ERROR', 'high', { strategy, marketId, ...context }, true);
    this.strategy = strategy;
    this.marketId = marketId;
  }
}

export class InsufficientLiquidityError extends TradingError {
  constructor(
    marketId: string,
    required: number,
    available: number,
    strategy?: string
  ) {
    super(
      `Insufficient liquidity in market ${marketId}. Required: ${required}, Available: ${available}`,
      strategy,
      marketId,
      { required, available }
    );
  }
}

export class SlippageError extends TradingError {
  constructor(
    marketId: string,
    expectedPrice: number,
    actualPrice: number,
    maxSlippage: number,
    strategy?: string
  ) {
    super(
      `Slippage exceeded in market ${marketId}. Expected: ${expectedPrice}, Actual: ${actualPrice}, Max: ${maxSlippage}`,
      strategy,
      marketId,
      { expectedPrice, actualPrice, maxSlippage }
    );
  }
}

export class OrderExecutionError extends TradingError {
  constructor(
    orderId: string,
    reason: string,
    strategy?: string,
    marketId?: string
  ) {
    super(`Order ${orderId} execution failed: ${reason}`, strategy, marketId, { orderId, reason });
  }
}

export class BalanceError extends TradingError {
  constructor(
    asset: string,
    required: number,
    available: number,
    strategy?: string
  ) {
    super(
      `Insufficient ${asset} balance. Required: ${required}, Available: ${available}`,
      strategy,
      undefined,
      { asset, required, available }
    );
  }
}

// ============================================================================
// Market Data Errors
// ============================================================================

export class MarketDataError extends BaseError {
  public readonly marketId?: string;

  constructor(
    message: string,
    marketId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'MARKET_DATA_ERROR', 'medium', { marketId, ...context }, true);
    this.marketId = marketId;
  }
}

export class StaleDataError extends MarketDataError {
  constructor(marketId: string, age: number, maxAge: number) {
    super(
      `Stale market data for ${marketId}. Age: ${age}ms, Max: ${maxAge}ms`,
      marketId,
      { age, maxAge }
    );
  }
}

export class MarketClosedError extends MarketDataError {
  constructor(marketId: string) {
    super(`Market ${marketId} is closed or resolved`, marketId);
  }
}

// ============================================================================
// Database Errors
// ============================================================================

export class DatabaseError extends BaseError {
  public readonly query?: string;

  constructor(
    message: string,
    query?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'DATABASE_ERROR', 'critical', { query, ...context }, false);
    this.query = query;
  }
}

export class ConnectionError extends DatabaseError {
  constructor(host: string, port: number) {
    super(`Database connection failed to ${host}:${port}`, undefined, { host, port });
  }
}

export class TransactionError extends DatabaseError {
  constructor(reason: string, transactionId?: string) {
    super(`Transaction failed: ${reason}`, undefined, { transactionId });
  }
}

// ============================================================================
// Configuration Errors
// ============================================================================

export class ConfigurationError extends BaseError {
  public readonly missingKeys?: string[];

  constructor(
    message: string,
    missingKeys?: string[],
    context?: Record<string, unknown>
  ) {
    super(message, 'CONFIGURATION_ERROR', 'critical', { missingKeys, ...context }, false);
    this.missingKeys = missingKeys;
  }
}

export class MissingEnvironmentVariableError extends ConfigurationError {
  constructor(variableName: string) {
    super(`Missing required environment variable: ${variableName}`, [variableName]);
  }
}

export class InvalidConfigurationError extends ConfigurationError {
  constructor(key: string, expected: string, actual: unknown) {
    super(
      `Invalid configuration for ${key}. Expected: ${expected}, Got: ${JSON.stringify(actual)}`,
      [key],
      { expected, actual }
    );
  }
}

// ============================================================================
// System Errors
// ============================================================================

export class SystemError extends BaseError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
    isOperational: boolean = false
  ) {
    super(message, 'SYSTEM_ERROR', 'critical', context, isOperational);
  }
}

export class ResourceExhaustedError extends SystemError {
  constructor(resource: string, limit: number, current: number) {
    super(
      `Resource exhausted: ${resource}. Limit: ${limit}, Current: ${current}`,
      { resource, limit, current }
    );
  }
}

export class TimeoutError extends SystemError {
  constructor(operation: string, timeout: number) {
    super(`Operation timed out: ${operation} after ${timeout}ms`, { operation, timeout });
    this.metadata.retryable = true;
  }
}

// ============================================================================
// Error Handler Utility
// ============================================================================

export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorHandlers: Map<string, (error: BaseError) => void> = new Map();
  private errorLog: Array<{ error: BaseError; handledAt: string }> = [];

  private constructor() {}

  public static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  public registerHandler(errorCode: string, handler: (error: BaseError) => void): void {
    this.errorHandlers.set(errorCode, handler);
  }

  public async handleError(error: unknown): Promise<void> {
    const baseError = error instanceof BaseError ? error : this.wrapError(error);
    
    // Log error
    this.logError(baseError);
    
    // Execute handler if registered
    const handler = this.errorHandlers.get(baseError.code);
    if (handler) {
      handler(baseError);
    }

    // Critical errors should trigger alerts
    if (baseError.severity === 'critical') {
      await this.triggerAlert(baseError);
    }

    // Store in error log for analysis
    this.errorLog.push({ error: baseError, handledAt: new Date().toISOString() });
    
    // Keep only last 1000 errors
    if (this.errorLog.length > 1000) {
      this.errorLog.shift();
    }
  }

  private wrapError(error: unknown): BaseError {
    if (error instanceof BaseError) {
      return error;
    }
    
    if (error instanceof Error) {
      return new SystemError(error.message, { originalStack: error.stack });
    }
    
    return new SystemError(`Unknown error: ${String(error)}`);
  }

  private logError(error: BaseError): void {
    const logEntry = {
      level: error.severity === 'critical' || error.severity === 'high' ? 'error' : 'warn',
      timestamp: error.metadata.timestamp,
      service: error.metadata.service,
      operation: error.metadata.operation,
      correlationId: error.metadata.correlationId,
      code: error.code,
      message: error.message,
      context: error.metadata.context,
      stack: error.stack,
      retryable: error.metadata.retryable
    };

    console.error(JSON.stringify(logEntry));
  }

  private async triggerAlert(error: BaseError): Promise<void> {
    // In production, this would send to PagerDuty, Slack, etc.
    console.error('🚨 CRITICAL ALERT:', JSON.stringify(error.toJSON()));
    
    // TODO: Implement alerting integration
    // await alertingService.send({
    //   severity: error.severity,
    //   title: error.message,
    //   details: error.toJSON(),
    //   timestamp: error.metadata.timestamp
    // });
  }

  public getErrorLog(): Array<{ error: BaseError; handledAt: string }> {
    return [...this.errorLog];
  }

  public clearErrorLog(): void {
    this.errorLog = [];
  }
}

// ============================================================================
// Retry Utility with Exponential Backoff
// ============================================================================

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  jitter: boolean;
  retryableErrors?: string[];
}

const defaultRetryOptions: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  jitter: true,
  retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'CONNECTION']
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...defaultRetryOptions, ...options };
  let lastError: Error;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === opts.maxRetries) {
        break;
      }

      const baseError = error instanceof BaseError ? error : null;
      
      // Check if error is retryable
      if (baseError && !baseError.metadata.retryable) {
        throw error;
      }

      // Check error code
      if (baseError && opts.retryableErrors && !opts.retryableErrors.some(code => baseError.code.includes(code))) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        opts.baseDelay * Math.pow(2, attempt),
        opts.maxDelay
      );

      // Add jitter
      const finalDelay = opts.jitter 
        ? delay * (0.5 + Math.random() * 0.5)
        : delay;

      console.warn(`Retry attempt ${attempt + 1}/${opts.maxRetries} after ${Math.round(finalDelay)}ms`);
      
      await new Promise(resolve => setTimeout(resolve, finalDelay));
    }
  }

  throw lastError!;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isBaseError(error: unknown): error is BaseError {
  return error instanceof BaseError;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isTradingError(error: unknown): error is TradingError {
  return error instanceof TradingError;
}

export function isRetryableError(error: unknown): boolean {
  if (!isBaseError(error)) {
    return false;
  }
  return error.metadata.retryable === true;
}
