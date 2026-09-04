/**
 * Grade A Utility Functions
 * Comprehensive utilities for logging, formatting, calculations, and more
 */

import { createHash } from 'crypto';
import { EventEmitter } from 'events';

// ============================================================================
// Logger Utility
// ============================================================================

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogContext {
  service?: string;
  operation?: string;
  correlationId?: string;
  userId?: string;
  marketId?: string;
  orderId?: string;
  strategy?: string;
  [key: string]: unknown;
}

export class Logger {
  private static instance: Logger;
  private level: LogLevel;
  private service: string;
  private defaultContext: LogContext;
  private eventEmitter: EventEmitter;

  private constructor() {
    this.level = this.parseLogLevel(process.env.LOG_LEVEL || 'info');
    this.service = process.env.SERVICE_NAME || 'polymarket-bot';
    this.defaultContext = {};
    this.eventEmitter = new EventEmitter();
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private parseLogLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'debug': return LogLevel.DEBUG;
      case 'info': return LogLevel.INFO;
      case 'warn': return LogLevel.WARN;
      case 'error': return LogLevel.ERROR;
      default: return LogLevel.INFO;
    }
  }

  public setLevel(level: LogLevel | string): void {
    this.level = typeof level === 'string' ? this.parseLogLevel(level) : level;
  }

  public setDefaultContext(context: LogContext): void {
    this.defaultContext = { ...this.defaultContext, ...context };
  }

  public onLog(callback: (entry: LogEntry) => void): void {
    this.eventEmitter.on('log', callback);
  }

  private createEntry(
    level: LogLevel,
    message: string,
    context?: LogContext
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      service: this.service,
      message,
      context: { ...this.defaultContext, ...context },
      pid: process.pid,
      hostname: process.env.HOSTNAME || 'unknown'
    };
  }

  private formatEntry(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  private output(entry: LogEntry): void {
    const formatted = this.formatEntry(entry);
    
    switch (entry.level) {
      case 'DEBUG':
        console.debug(formatted);
        break;
      case 'INFO':
        console.info(formatted);
        break;
      case 'WARN':
        console.warn(formatted);
        break;
      case 'ERROR':
        console.error(formatted);
        break;
    }

    this.eventEmitter.emit('log', entry);
  }

  public debug(message: string, context?: LogContext): void {
    if (this.level <= LogLevel.DEBUG) {
      this.output(this.createEntry(LogLevel.DEBUG, message, context));
    }
  }

  public info(message: string, context?: LogContext): void {
    if (this.level <= LogLevel.INFO) {
      this.output(this.createEntry(LogLevel.INFO, message, context));
    }
  }

  public warn(message: string, context?: LogContext): void {
    if (this.level <= LogLevel.WARN) {
      this.output(this.createEntry(LogLevel.WARN, message, context));
    }
  }

  public error(message: string, error?: Error, context?: LogContext): void {
    if (this.level <= LogLevel.ERROR) {
      const entry = this.createEntry(LogLevel.ERROR, message, {
        ...context,
        error: error?.message,
        stack: error?.stack
      });
      this.output(entry);
    }
  }

  public child(context: LogContext): Logger {
    const childLogger = new Logger();
    childLogger.setLevel(this.level);
    childLogger.setDefaultContext({ ...this.defaultContext, ...context });
    return childLogger;
  }
}

export interface LogEntry {
  timestamp: string;
  level: string;
  service: string;
  message: string;
  context: LogContext;
  pid: number;
  hostname: string;
}

// ============================================================================
// Formatting Utilities
// ============================================================================

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

export function formatNumber(num: number, decimals: number = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(num);
}

export function formatPercentage(value: number, decimals: number = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  }
  
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(2);
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let size = bytes;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// ============================================================================
// Mathematical Utilities
// ============================================================================

export function calculatePercentageChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 1 : 0;
  }
  return (current - previous) / previous;
}

export function calculatePnL(entryPrice: number, exitPrice: number, quantity: number): number {
  return (exitPrice - entryPrice) * quantity;
}

export function calculateROI(profit: number, investment: number): number {
  if (investment === 0) {
    return 0;
  }
  return profit / investment;
}

export function calculateSharpeRatio(
  returns: number[],
  riskFreeRate: number = 0.02
): number {
  if (returns.length === 0) {
    return 0;
  }
  
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const excessReturn = avgReturn - riskFreeRate;
  
  if (returns.length === 1) {
    return excessReturn > 0 ? 1 : -1;
  }
  
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  
  if (stdDev === 0) {
    return excessReturn > 0 ? Infinity : -Infinity;
  }
  
  return excessReturn / stdDev;
}

export function calculateMaxDrawdown(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  
  let peak = values[0];
  let maxDrawdown = 0;
  
  for (const value of values) {
    if (value > peak) {
      peak = value;
    }
    
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  
  return maxDrawdown;
}

export function calculateMovingAverage(values: number[], period: number): number[] {
  if (values.length < period) {
    return [];
  }
  
  const result: number[] = [];
  
  for (let i = period - 1; i < values.length; i++) {
    const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    result.push(sum / period);
  }
  
  return result;
}

export function calculateEMA(values: number[], period: number): number[] {
  if (values.length < period) {
    return [];
  }
  
  const multiplier = 2 / (period + 1);
  const ema: number[] = [];
  
  // Start with SMA
  const sma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(sma);
  
  // Calculate EMA for remaining values
  for (let i = period; i < values.length; i++) {
    const nextEma = (values[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
    ema.push(nextEma);
  }
  
  return ema;
}

export function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) {
    return 50; // Neutral RSI
  }
  
  const gains: number[] = [];
  const losses: number[] = [];
  
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(Math.max(0, change));
    losses.push(Math.max(0, -change));
  }
  
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  
  if (avgLoss === 0) {
    return 100;
  }
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ============================================================================
// Cryptographic Utilities
// ============================================================================

export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function generateOrderId(prefix: string = 'ord'): string {
  return `${prefix}_${generateCorrelationId()}`;
}

export function hashData(data: string, algorithm: string = 'sha256'): string {
  return createHash(algorithm).update(data).digest('hex');
}

export function generateSignature(data: string, secret: string): string {
  return hashData(`${data}.${secret}`, 'sha256');
}

export function verifySignature(data: string, signature: string, secret: string): boolean {
  const expectedSignature = generateSignature(data, secret);
  return signature === expectedSignature;
}

// ============================================================================
// Array & Collection Utilities
// ============================================================================

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function uniqueBy<T, K extends keyof T>(array: T[], key: K): T[] {
  const seen = new Set<T[K]>();
  return array.filter(item => {
    const value = item[key];
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

export function groupBy<T, K extends string | number | symbol>(
  array: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  return array.reduce((result, item) => {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
    return result;
  }, {} as Record<K, T[]>);
}

export function sortBy<T>(array: T[], keyFn: (item: T) => number | string, ascending: boolean = true): T[] {
  return [...array].sort((a, b) => {
    const aKey = keyFn(a);
    const bKey = keyFn(b);
    
    if (aKey < bKey) {
      return ascending ? -1 : 1;
    }
    if (aKey > bKey) {
      return ascending ? 1 : -1;
    }
    return 0;
  });
}

export function partition<T>(array: T[], predicate: (item: T) => boolean): [T[], T[]] {
  const truthy: T[] = [];
  const falsy: T[] = [];
  
  for (const item of array) {
    if (predicate(item)) {
      truthy.push(item);
    } else {
      falsy.push(item);
    }
  }
  
  return [truthy, falsy];
}

// ============================================================================
// Time Utilities
// ============================================================================

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    
    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

export function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  return fn().catch(error => {
    if (maxRetries <= 0) {
      throw error;
    }
    
    return sleep(delay).then(() => retry(fn, maxRetries - 1, delay * 2));
  });
}

export function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    )
  ]);
}

// ============================================================================
// Validation Utilities
// ============================================================================

export function isNullOrUndefined(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

export function isArray<T>(value: unknown, typeGuard?: (item: unknown) => item is T): value is T[] {
  if (!Array.isArray(value)) {
    return false;
  }
  
  if (typeGuard) {
    return value.every(typeGuard);
  }
  
  return true;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function validateMarketId(marketId: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(marketId) || /^[0-9]+$/.test(marketId);
}

// ============================================================================
// Environment Utilities
// ============================================================================

export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function getOptionalEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

export function getBooleanEnv(key: string, defaultValue: boolean = false): boolean {
  const value = process.env[key]?.toLowerCase();
  if (value === undefined) {
    return defaultValue;
  }
  return ['true', '1', 'yes'].includes(value);
}

export function getNumberEnv(key: string, defaultValue: number = 0): number {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }
  
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    return defaultValue;
  }
  
  return num;
}

// ============================================================================
// Performance Monitoring
// ============================================================================

export class PerformanceTracker {
  private static instance: PerformanceTracker;
  private metrics: Map<string, number[]> = new Map();

  public static getInstance(): PerformanceTracker {
    if (!PerformanceTracker.instance) {
      PerformanceTracker.instance = new PerformanceTracker();
    }
    return PerformanceTracker.instance;
  }

  public startTimer(label: string): () => number {
    const start = performance.now();
    
    return () => {
      const duration = performance.now() - start;
      
      if (!this.metrics.has(label)) {
        this.metrics.set(label, []);
      }
      
      this.metrics.get(label)!.push(duration);
      
      // Keep only last 1000 measurements
      const arr = this.metrics.get(label)!;
      if (arr.length > 1000) {
        arr.shift();
      }
      
      return duration;
    };
  }

  public getStats(label: string): {
    count: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    const values = this.metrics.get(label);
    
    if (!values || values.length === 0) {
      return null;
    }
    
    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    
    return {
      count,
      min: sorted[0],
      max: sorted[count - 1],
      avg: sum / count,
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)]
    };
  }

  public getAllStats(): Map<string, ReturnType<PerformanceTracker['getStats']>> {
    const result = new Map<string, ReturnType<PerformanceTracker['getStats']>>();
    
    for (const label of this.metrics.keys()) {
      result.set(label, this.getStats(label));
    }
    
    return result;
  }

  public reset(label?: string): void {
    if (label) {
      this.metrics.delete(label);
    } else {
      this.metrics.clear();
    }
  }
}

// Export singleton instances
export const logger = Logger.getInstance();
export const performanceTracker = PerformanceTracker.getInstance();
