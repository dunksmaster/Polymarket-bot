/**
 * Polymarket Gamma API Client
 * 
 * Provides comprehensive access to Polymarket's Gamma API for market data,
 * order management, and trading operations.
 * 
 * @module clients/gamma-client
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { EventEmitter } from 'events';
import { 
  Market, 
  Order, 
  OrderType, 
  OrderSide, 
  OrderStatus,
  Position,
  Trade,
  UserPortfolio,
  MarketOrderBook,
  MarketTradeHistory,
  PriceLevel,
  GammaMarketParams,
  GammaOrderParams,
  ApiError,
  RateLimitError,
  AuthenticationError,
  ValidationError,
  NetworkError,
  RetryConfig
} from '../types';
import { createLogger, formatPrice, formatAmount, calculateTotalCost, retryWithBackoff } from '../utils';
import { ErrorHandler } from '../errors';

interface GammaClientConfig {
  baseUrl: string;
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  rateLimitPerSecond?: number;
}

interface CachedData<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * Gamma API Client for Polymarket
 * 
 * Handles all interactions with Polymarket's Gamma API including:
 * - Market data retrieval
 * - Order placement and management
 * - Portfolio tracking
 * - Trade history
 * - Real-time updates via polling
 */
export class GammaClient extends EventEmitter {
  private client: AxiosInstance;
  private config: GammaClientConfig;
  private logger: ReturnType<typeof createLogger>;
  private errorHandlers: typeof ErrorHandler;
  
  // Rate limiting
  private requestQueue: Array<() => Promise<any>> = [];
  private processingQueue: boolean = false;
  private lastRequestTime: number = 0;
  private requestsThisSecond: number = 0;
  
  // Caching
  private cache: Map<string, CachedData<any>> = new Map();
  private cacheTTL: number = 5000; // 5 seconds default
  
  // Authentication
  private isAuthenticated: boolean = false;
  
  constructor(config: GammaClientConfig) {
    super();
    
    this.config = {
      baseUrl: config.baseUrl || 'https://gamma-api.polymarket.com',
      apiKey: config.apiKey,
      secretKey: config.secretKey,
      passphrase: config.passphrase,
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      rateLimitPerSecond: config.rateLimitPerSecond || 10
    };
    
    this.logger = createLogger('GammaClient');
    this.errorHandlers = ErrorHandler;
    
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PolymarketSDK/3.1.0'
      }
    });
    
    // Setup interceptors
    this.setupInterceptors();
    
    // Initialize authentication if credentials provided
    if (this.config.apiKey && this.config.secretKey) {
      this.initializeAuth();
    }
    
    this.logger.info('GammaClient initialized', { 
      baseUrl: this.config.baseUrl,
      authenticated: this.isAuthenticated,
      rateLimit: this.config.rateLimitPerSecond 
    });
  }
  
  /**
   * Setup axios interceptors for request/response handling
   */
  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      async (config) => {
        // Apply rate limiting
        await this.applyRateLimit();
        
        // Add authentication headers if available
        if (this.isAuthenticated && this.config.apiKey) {
          config.headers['Authorization'] = `Bearer ${this.config.apiKey}`;
          
          // Add signature for authenticated endpoints
          if (config.method !== 'get') {
            const signature = this.generateSignature(config);
            config.headers['X-Signature'] = signature;
          }
        }
        
        this.logger.debug('Outgoing request', {
          method: config.method,
          url: config.url,
          params: config.params
        });
        
        return config;
      },
      (error) => {
        this.logger.error('Request interceptor error', error);
        return Promise.reject(error);
      }
    );
    
    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        this.logger.debug('Incoming response', {
          status: response.status,
          url: response.config.url,
          duration: response.headers['x-response-time']
        });
        
        return response;
      },
      (error) => {
        this.logger.error('Response error', {
          status: error.response?.status,
          message: error.message,
          url: error.config?.url
        });
        
        return Promise.reject(this.handleError(error));
      }
    );
  }
  
  /**
   * Initialize authentication
   */
  private initializeAuth(): void {
    try {
      if (!this.config.apiKey || !this.config.secretKey) {
        throw new AuthenticationError('Missing API credentials');
      }
      
      // Validate credentials format
      if (this.config.apiKey.length < 10 || this.config.secretKey.length < 20) {
        throw new ValidationError('Invalid API key or secret format');
      }
      
      this.isAuthenticated = true;
      this.logger.info('Authentication initialized successfully');
      this.emit('authenticated');
    } catch (error) {
      this.logger.error('Authentication initialization failed', error);
      this.isAuthenticated = false;
      this.emit('auth_error', error);
    }
  }
  
  /**
   * Generate request signature for authentication
   */
  private generateSignature(config: any): string {
    // Simplified signature generation - in production, use proper HMAC
    const timestamp = Date.now().toString();
    const method = config.method?.toUpperCase() || 'GET';
    const endpoint = config.url || '';
    const body = config.data ? JSON.stringify(config.data) : '';
    
    const payload = `${timestamp}${method}${endpoint}${body}`;
    
    // In production, use crypto.createHmac with secret key
    return Buffer.from(payload).toString('base64');
  }
  
  /**
   * Apply rate limiting to requests
   */
  private async applyRateLimit(): Promise<void> {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    
    // Reset counter if more than a second has passed
    if (now > this.lastRequestTime + 1000) {
      this.requestsThisSecond = 0;
    }
    
    // Check if we've exceeded rate limit
    if (this.requestsThisSecond >= (this.config.rateLimitPerSecond || 10)) {
      const delay = 1000 - (now - this.lastRequestTime);
      if (delay > 0) {
        this.logger.debug('Rate limit reached, waiting', { delay });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      this.requestsThisSecond = 0;
    }
    
    this.lastRequestTime = Date.now();
    this.requestsThisSecond++;
  }
  
  /**
   * Handle API errors and convert to appropriate error types
   */
  private handleError(error: any): Error {
    if (error.response) {
      const { status, data } = error.response;
      
      switch (status) {
        case 401:
          return new AuthenticationError('Invalid API credentials', { status, data });
        case 403:
          return new AuthenticationError('Access forbidden', { status, data });
        case 429:
          return new RateLimitError('Rate limit exceeded', { status, data });
        case 400:
          return new ValidationError('Invalid request parameters', { status, data });
        case 404:
          return new ApiError('Resource not found', { status, data });
        case 500:
        case 502:
        case 503:
          return new NetworkError('Server error', { status, data });
        default:
          return new ApiError(`API error: ${status}`, { status, data });
      }
    } else if (error.code === 'ECONNABORTED') {
      return new NetworkError('Request timeout', { code: error.code });
    } else if (error.code === 'ENOTFOUND') {
      return new NetworkError('Network unreachable', { code: error.code });
    }
    
    return error;
  }
  
  /**
   * Make HTTP request with retry logic
   */
  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    const retryConfig: RetryConfig = {
      maxRetries: this.config.maxRetries || 3,
      retryDelay: this.config.retryDelay || 1000,
      shouldRetry: (error) => {
        return error instanceof NetworkError || 
               error instanceof RateLimitError ||
               (error.response && error.response.status >= 500);
      }
    };
    
    return retryWithBackoff(
      async () => {
        const response: AxiosResponse<T> = await this.client.request(config);
        return response.data;
      },
      retryConfig,
      this.logger
    );
  }
  
  /**
   * Get data from cache or fetch fresh
   */
  private async getCachedOrFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.cache.get(key);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < (ttl || this.cacheTTL)) {
      this.logger.debug('Cache hit', { key });
      return cached.data as T;
    }
    
    this.logger.debug('Cache miss, fetching', { key });
    const data = await fetchFn();
    
    this.cache.set(key, {
      data,
      timestamp: now,
      ttl: ttl || this.cacheTTL
    });
    
    return data;
  }
  
  /**
   * Clear cache for specific key or all cache
   */
  public clearCache(key?: string): void {
    if (key) {
      this.cache.delete(key);
      this.logger.debug('Cache cleared for key', { key });
    } else {
      this.cache.clear();
      this.logger.info('All cache cleared');
    }
  }
  
  // ==================== MARKET DATA METHODS ====================
  
  /**
   * Get list of active markets
   */
  public async getMarkets(params?: GammaMarketParams): Promise<Market[]> {
    const cacheKey = `markets:${JSON.stringify(params)}`;
    
    return this.getCachedOrFetch<Market[]>(cacheKey, async () => {
      const response = await this.request<any>({
        method: 'get',
        url: '/markets',
        params: {
          ...params,
          limit: params?.limit || 100,
          offset: params?.offset || 0
        }
      });
      
      return response.map((m: any) => this.parseMarket(m));
    });
  }
  
  /**
   * Get single market by ID
   */
  public async getMarket(marketId: string): Promise<Market> {
    const cacheKey = `market:${marketId}`;
    
    return this.getCachedOrFetch<Market>(cacheKey, async () => {
      const response = await this.request<any>({
        method: 'get',
        url: `/markets/${marketId}`
      });
      
      return this.parseMarket(response);
    }, 2000); // 2 second TTL for individual markets
  }
  
  /**
   * Parse market data from API response
   */
  private parseMarket(data: any): Market {
    return {
      id: data.id || data.event_id,
      title: data.title || data.question,
      subtitle: data.subtitle,
      category: data.category,
      tags: data.tags || [],
      outcomeNames: data.outcomes || [],
      yesBid: parseFloat(data.yes_bid || '0'),
      yesAsk: parseFloat(data.yes_ask || '0'),
      noBid: parseFloat(data.no_bid || '0'),
      noAsk: parseFloat(data.no_ask || '0'),
      lastPrice: parseFloat(data.last_price || '0'),
      volume: parseFloat(data.volume || '0'),
      openInterest: parseFloat(data.open_interest || '0'),
      liquidity: parseFloat(data.liquidity || '0'),
      endTime: data.end_time ? new Date(data.end_time) : undefined,
      expirationTime: data.expiration_time ? new Date(data.expiration_time) : undefined,
      resolutionTime: data.resolution_time ? new Date(data.resolution_time) : undefined,
      status: data.status || 'active',
      canClosePosition: data.can_close_position || false,
      result: data.result,
      imageUrl: data.image_url,
      description: data.description
    };
  }
  
  /**
   * Get market order book
   */
  public async getOrderBook(marketId: string, depth?: number): Promise<MarketOrderBook> {
    const cacheKey = `orderbook:${marketId}:${depth || 20}`;
    
    return this.getCachedOrFetch<MarketOrderBook>(cacheKey, async () => {
      const response = await this.request<any>({
        method: 'get',
        url: `/markets/${marketId}/orderbook`,
        params: { depth: depth || 20 }
      });
      
      return {
        marketId,
        bids: response.bids.map((level: any) => this.parsePriceLevel(level)),
        asks: response.asks.map((level: any) => this.parsePriceLevel(level)),
        spread: response.spread ? parseFloat(response.spread) : 0,
        timestamp: new Date(response.timestamp || Date.now())
      };
    }, 1000); // 1 second TTL for order books
  }
  
  /**
   * Parse price level from API response
   */
  private parsePriceLevel(data: any): PriceLevel {
    return {
      price: parseFloat(data.price),
      amount: parseFloat(data.amount),
      count: data.count || 1
    };
  }
  
  /**
   * Get recent trade history for a market
   */
  public async getTradeHistory(marketId: string, limit?: number): Promise<MarketTradeHistory> {
    const cacheKey = `trades:${marketId}:${limit || 50}`;
    
    return this.getCachedOrFetch<MarketTradeHistory>(cacheKey, async () => {
      const response = await this.request<any>({
        method: 'get',
        url: `/markets/${marketId}/trades`,
        params: { limit: limit || 50 }
      });
      
      return {
        marketId,
        trades: response.trades.map((t: any) => this.parseTrade(t)),
        totalVolume: parseFloat(response.total_volume || '0'),
        vwap: parseFloat(response.vwap || '0')
      };
    }, 3000); // 3 second TTL for trade history
  }
  
  /**
   * Parse trade data from API response
   */
  private parseTrade(data: any): Trade {
    return {
      id: data.id || data.trade_id,
      marketId: data.market_id,
      price: parseFloat(data.price),
      amount: parseFloat(data.amount),
      side: (data.side as OrderSide) || 'buy',
      timestamp: new Date(data.timestamp || Date.now()),
      makerOrderId: data.maker_order_id,
      takerOrderId: data.taker_order_id
    };
  }
  
  // ==================== ORDER MANAGEMENT METHODS ====================
  
  /**
   * Place a new order
   */
  public async placeOrder(params: GammaOrderParams): Promise<Order> {
    if (!this.isAuthenticated) {
      throw new AuthenticationError('Cannot place order: not authenticated');
    }
    
    // Validate order parameters
    this.validateOrderParams(params);
    
    const orderPayload = {
      market_id: params.marketId,
      side: params.side,
      type: params.type,
      price: params.price ? formatPrice(params.price) : undefined,
      amount: formatAmount(params.amount),
      client_order_id: params.clientOrderId || `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      reduce_only: params.reduceOnly || false,
      post_only: params.postOnly || false,
      expiration: params.expiration ? Math.floor(params.expiration.getTime() / 1000) : undefined
    };
    
    this.logger.info('Placing order', {
      marketId: params.marketId,
      side: params.side,
      type: params.type,
      price: params.price,
      amount: params.amount
    });
    
    try {
      const response = await this.request<any>({
        method: 'post',
        url: '/orders',
        data: orderPayload
      });
      
      const order = this.parseOrder(response);
      this.emit('order_placed', order);
      return order;
    } catch (error) {
      this.logger.error('Failed to place order', error);
      this.emit('order_error', { params, error });
      throw error;
    }
  }
  
  /**
   * Validate order parameters before submission
   */
  private validateOrderParams(params: GammaOrderParams): void {
    if (!params.marketId) {
      throw new ValidationError('Market ID is required');
    }
    
    if (!params.side || !['buy', 'sell'].includes(params.side)) {
      throw new ValidationError('Invalid order side');
    }
    
    if (!params.type || !['limit', 'market', 'stop_limit'].includes(params.type)) {
      throw new ValidationError('Invalid order type');
    }
    
    if (params.amount <= 0) {
      throw new ValidationError('Order amount must be positive');
    }
    
    if (params.type === 'limit' && (!params.price || params.price <= 0)) {
      throw new ValidationError('Limit orders require a valid price');
    }
    
    if (params.stopPrice && params.stopPrice <= 0) {
      throw new ValidationError('Invalid stop price');
    }
  }
  
  /**
   * Parse order data from API response
   */
  private parseOrder(data: any): Order {
    return {
      id: data.id || data.order_id,
      clientId: data.client_order_id,
      marketId: data.market_id,
      side: data.side as OrderSide,
      type: data.type as OrderType,
      price: data.price ? parseFloat(data.price) : undefined,
      amount: parseFloat(data.amount),
      filledAmount: parseFloat(data.filled_amount || '0'),
      remainingAmount: parseFloat(data.remaining_amount || data.amount),
      averagePrice: data.average_price ? parseFloat(data.average_price) : undefined,
      status: data.status as OrderStatus,
      createdAt: new Date(data.created_at || Date.now()),
      updatedAt: new Date(data.updated_at || Date.now()),
      expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
      reduceOnly: data.reduce_only || false,
      postOnly: data.post_only || false,
      fees: data.fees ? parseFloat(data.fees) : 0
    };
  }
  
  /**
   * Cancel an existing order
   */
  public async cancelOrder(orderId: string): Promise<Order> {
    if (!this.isAuthenticated) {
      throw new AuthenticationError('Cannot cancel order: not authenticated');
    }
    
    this.logger.info('Cancelling order', { orderId });
    
    try {
      const response = await this.request<any>({
        method: 'delete',
        url: `/orders/${orderId}`
      });
      
      const order = this.parseOrder(response);
      this.emit('order_cancelled', order);
      return order;
    } catch (error) {
      this.logger.error('Failed to cancel order', error);
      this.emit('order_error', { orderId, error });
      throw error;
    }
  }
  
  /**
   * Cancel all orders for a specific market
   */
  public async cancelAllOrders(marketId?: string): Promise<Order[]> {
    if (!this.isAuthenticated) {
      throw new AuthenticationError('Cannot cancel orders: not authenticated');
    }
    
    this.logger.info('Cancelling all orders', { marketId });
    
    try {
      const response = await this.request<any>({
        method: 'delete',
        url: '/orders',
        params: marketId ? { market_id: marketId } : {}
      });
      
      const orders = response.orders.map((o: any) => this.parseOrder(o));
      this.emit('orders_cancelled', orders);
      return orders;
    } catch (error) {
      this.logger.error('Failed to cancel all orders', error);
      throw error;
    }
  }
  
  /**
   * Get order by ID
   */
  public async getOrder(orderId: string): Promise<Order> {
    const response = await this.request<any>({
      method: 'get',
      url: `/orders/${orderId}`
    });
    
    return this.parseOrder(response);
  }
  
  /**
   * Get all open orders
   */
  public async getOpenOrders(marketId?: string): Promise<Order[]> {
    const params: any = { status: 'open' };
    if (marketId) {
      params.market_id = marketId;
    }
    
    const response = await this.request<any>({
      method: 'get',
      url: '/orders',
      params
    });
    
    return response.map((o: any) => this.parseOrder(o));
  }
  
  /**
   * Get order history
   */
  public async getOrderHistory(params?: {
    marketId?: string;
    status?: OrderStatus;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<Order[]> {
    const queryParams: any = {
      limit: params?.limit || 100
    };
    
    if (params?.marketId) {
      queryParams.market_id = params.marketId;
    }
    
    if (params?.status) {
      queryParams.status = params.status;
    }
    
    if (params?.startTime) {
      queryParams.start_time = Math.floor(params.startTime.getTime() / 1000);
    }
    
    if (params?.endTime) {
      queryParams.end_time = Math.floor(params.endTime.getTime() / 1000);
    }
    
    const response = await this.request<any>({
      method: 'get',
      url: '/orders/history',
      params: queryParams
    });
    
    return response.map((o: any) => this.parseOrder(o));
  }
  
  // ==================== PORTFOLIO & POSITION METHODS ====================
  
  /**
   * Get user portfolio summary
   */
  public async getPortfolio(): Promise<UserPortfolio> {
    if (!this.isAuthenticated) {
      throw new AuthenticationError('Cannot get portfolio: not authenticated');
    }
    
    const cacheKey = 'portfolio';
    
    return this.getCachedOrFetch<UserPortfolio>(cacheKey, async () => {
      const response = await this.request<any>({
        method: 'get',
        url: '/portfolio'
      });
      
      return {
        totalValue: parseFloat(response.total_value || '0'),
        availableBalance: parseFloat(response.available_balance || '0'),
        lockedBalance: parseFloat(response.locked_balance || '0'),
        unrealizedPnl: parseFloat(response.unrealized_pnl || '0'),
        realizedPnl: parseFloat(response.realized_pnl || '0'),
        positions: response.positions?.map((p: any) => this.parsePosition(p)) || [],
        lastUpdated: new Date(response.last_updated || Date.now())
      };
    }, 5000); // 5 second TTL for portfolio
  }
  
  /**
   * Get position for a specific market
   */
  public async getPosition(marketId: string): Promise<Position | null> {
    if (!this.isAuthenticated) {
      throw new AuthenticationError('Cannot get position: not authenticated');
    }
    
    try {
      const response = await this.request<any>({
        method: 'get',
        url: `/positions/${marketId}`
      });
      
      return this.parsePosition(response);
    } catch (error) {
      if (error.response?.status === 404) {
        return null; // No position exists
      }
      throw error;
    }
  }
  
  /**
   * Get all user positions
   */
  public async getPositions(): Promise<Position[]> {
    if (!this.isAuthenticated) {
      throw new AuthenticationError('Cannot get positions: not authenticated');
    }
    
    const response = await this.request<any>({
      method: 'get',
      url: '/positions'
    });
    
    return response.map((p: any) => this.parsePosition(p));
  }
  
  /**
   * Parse position data from API response
   */
  private parsePosition(data: any): Position {
    return {
      marketId: data.market_id,
      marketTitle: data.market_title,
      outcome: data.outcome,
      shares: parseFloat(data.shares || '0'),
      averagePrice: parseFloat(data.average_price || '0'),
      currentValue: parseFloat(data.current_value || '0'),
      unrealizedPnl: parseFloat(data.unrealized_pnl || '0'),
      realizedPnl: parseFloat(data.realized_pnl || '0'),
      totalCost: parseFloat(data.total_cost || '0'),
      percentageOwned: parseFloat(data.percentage_owned || '0'),
      canClose: data.can_close || false,
      lastUpdated: new Date(data.last_updated || Date.now())
    };
  }
  
  /**
   * Close a position
   */
  public async closePosition(marketId: string, percentage?: number): Promise<Order> {
    if (!this.isAuthenticated) {
      throw new AuthenticationError('Cannot close position: not authenticated');
    }
    
    const position = await this.getPosition(marketId);
    if (!position) {
      throw new ValidationError('No position found for this market');
    }
    
    const sharesToClose = position.shares * ((percentage || 100) / 100);
    
    // Place opposite order to close position
    const closeParams: GammaOrderParams = {
      marketId,
      side: position.shares > 0 ? 'sell' : 'buy',
      type: 'market',
      amount: Math.abs(sharesToClose),
      reduceOnly: true
    };
    
    return this.placeOrder(closeParams);
  }
  
  // ==================== UTILITY METHODS ====================
  
  /**
   * Test API connectivity
   */
  public async ping(): Promise<boolean> {
    try {
      await this.request<any>({
        method: 'get',
        url: '/health',
        timeout: 5000
      });
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Get server time
   */
  public async getServerTime(): Promise<Date> {
    const response = await this.request<any>({
      method: 'get',
      url: '/time'
    });
    
    return new Date(response.server_time || Date.now());
  }
  
  /**
   * Get current API rate limit status
   */
  public getRateLimitStatus(): {
    remaining: number;
    resetTime: number;
    limit: number;
  } {
    return {
      remaining: (this.config.rateLimitPerSecond || 10) - this.requestsThisSecond,
      resetTime: this.lastRequestTime + 1000,
      limit: this.config.rateLimitPerSecond || 10
    };
  }
  
  /**
   * Enable/disable request logging
   */
  public setDebugMode(enabled: boolean): void {
    if (enabled) {
      this.logger.level = 'debug';
    } else {
      this.logger.level = 'info';
    }
  }
  
  /**
   * Disconnect client and cleanup
   */
  public disconnect(): void {
    this.logger.info('Disconnecting GammaClient');
    this.clearCache();
    this.requestQueue = [];
    this.removeAllListeners();
  }
}

export default GammaClient;
