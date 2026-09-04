/**
 * Polygon Network Client
 * 
 * Provides comprehensive interface for interacting with Polygon blockchain,
 * including USDC token operations, transaction management, and network utilities.
 * 
 * @module clients/polygon-client
 */

import { ethers, Contract, Provider, JsonRpcProvider, Wallet, TransactionResponse } from 'ethers';
import { EventEmitter } from 'events';
import { 
  BlockchainError,
  TransactionError,
  ValidationError,
  NetworkError,
  InsufficientFundsError
} from '../types';
import { createLogger, formatAmount, retryWithBackoff } from '../utils';
import { ErrorHandler } from '../errors';

// ERC20 ABI for USDC and other tokens
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)'
];

// Polygon RPC endpoints
const POLYGON_RPC_ENDPOINTS = {
  mainnet: [
    'https://polygon-rpc.com',
    'https://rpc-mainnet.matic.network',
    'https://matic-mainnet.chainstacklabs.com',
    'https://rpc-mainnet.maticvigil.com'
  ],
  testnet: [
    'https://rpc-mumbai.maticvigil.com',
    'https://matic-mumbai.chainstacklabs.com'
  ]
};

// USDC contract addresses
const USDC_ADDRESSES = {
  mainnet: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  testnet: '0x2058A9D7613eEE744279e3856Ef0eAda5FCbaA7e'
};

interface PolygonClientConfig {
  network?: 'mainnet' | 'testnet';
  rpcUrl?: string;
  privateKey?: string;
  provider?: Provider;
  useFallbackRpc?: boolean;
  gasLimitMultiplier?: number;
  maxGasPriceGwei?: number;
  confirmations?: number;
  timeout?: number;
}

interface TokenBalance {
  address: string;
  symbol: string;
  name: string;
  balance: bigint;
  decimals: number;
  formattedBalance: string;
}

interface TransactionDetails {
  hash: string;
  from: string;
  to: string;
  value: bigint;
  gasPrice: bigint;
  gasLimit: bigint;
  nonce: number;
  data?: string;
}

interface GasEstimate {
  gasPrice: bigint;
  gasLimit: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  estimatedCost: bigint;
  estimatedCostUSD?: number;
}

/**
 * Polygon Network Client
 * 
 * Handles all interactions with Polygon blockchain:
 * - USDC token operations (balance, transfer, approve)
 * - Transaction signing and broadcasting
 * - Gas price estimation
 * - Network status monitoring
 * - Multi-RPC fallback support
 */
export class PolygonClient extends EventEmitter {
  private provider: Provider;
  private signer?: Wallet;
  private config: PolygonClientConfig;
  private logger: ReturnType<typeof createLogger>;
  private errorHandlers: typeof ErrorHandler;
  
  private usdcContract?: Contract;
  private isConnected: boolean = false;
  private networkId?: number;
  private currentRpcIndex: number = 0;
  private fallbackRpcUrls: string[] = [];

  constructor(config: PolygonClientConfig) {
    super();
    
    this.config = {
      network: config.network || 'mainnet',
      rpcUrl: config.rpcUrl,
      privateKey: config.privateKey,
      provider: config.provider,
      useFallbackRpc: config.useFallbackRpc ?? true,
      gasLimitMultiplier: config.gasLimitMultiplier || 1.2,
      maxGasPriceGwei: config.maxGasPriceGwei || 500,
      confirmations: config.confirmations || 1,
      timeout: config.timeout || 30000
    };
    
    this.logger = createLogger('PolygonClient');
    this.errorHandlers = ErrorHandler;
    
    // Setup RPC endpoints
    if (this.config.rpcUrl) {
      this.fallbackRpcUrls = [this.config.rpcUrl];
    } else {
      this.fallbackRpcUrls = POLYGON_RPC_ENDPOINTS[this.config.network!];
    }
    
    // Initialize provider
    if (config.provider) {
      this.provider = config.provider;
    } else {
      this.provider = new JsonRpcProvider(
        this.fallbackRpcUrls[0],
        undefined,
        {
          staticNetwork: true,
          pollingInterval: 4000
        }
      );
    }
    
    // Initialize signer if private key provided
    if (this.config.privateKey) {
      this.signer = new Wallet(this.config.privateKey, this.provider);
      this.logger.info('Signer initialized', {
        address: this.signer.address
      });
    }
    
    this.logger.info('PolygonClient initialized', {
      network: this.config.network,
      rpcUrl: this.fallbackRpcUrls[0],
      hasSigner: !!this.signer,
      fallbackEnabled: this.config.useFallbackRpc
    });
  }

  /**
   * Connect to Polygon network and verify connectivity
   */
  public async connect(): Promise<void> {
    try {
      const network = await this.provider.getNetwork();
      this.networkId = Number(network.chainId);
      
      // Verify network matches expected
      const expectedChainId = this.config.network === 'mainnet' ? 137 : 80001;
      if (this.networkId !== expectedChainId) {
        this.logger.warn('Connected to unexpected network', {
          expected: expectedChainId,
          actual: this.networkId
        });
      }
      
      // Initialize USDC contract
      const usdcAddress = USDC_ADDRESSES[this.config.network!];
      this.usdcContract = new Contract(usdcAddress, ERC20_ABI, this.provider);
      
      if (this.signer) {
        this.usdcContract = this.usdcContract.connect(this.signer);
      }
      
      this.isConnected = true;
      this.logger.info('Connected to Polygon', {
        networkId: this.networkId,
        network: this.config.network,
        usdcAddress: usdcAddress
      });
      
      this.emit('connected', { networkId: this.networkId, network: this.config.network });
    } catch (error) {
      this.logger.error('Failed to connect to Polygon', error);
      this.isConnected = false;
      this.emit('connection_error', error);
      
      // Try fallback RPC if enabled
      if (this.config.useFallbackRpc) {
        await this.tryFallbackRpc();
      } else {
        throw error;
      }
    }
  }

  /**
   * Try connecting to fallback RPC endpoints
   */
  private async tryFallbackRpc(): Promise<void> {
    for (let i = 1; i < this.fallbackRpcUrls.length; i++) {
      try {
        this.logger.info('Trying fallback RPC', { url: this.fallbackRpcUrls[i] });
        
        const fallbackProvider = new JsonRpcProvider(
          this.fallbackRpcUrls[i],
          undefined,
          { staticNetwork: true }
        );
        
        const network = await fallbackProvider.getNetwork();
        
        // Switch to working provider
        this.provider = fallbackProvider;
        if (this.signer) {
          this.signer = this.signer.connect(fallbackProvider);
        }
        
        this.currentRpcIndex = i;
        await this.connect(); // Retry connection
        
        return;
      } catch (error) {
        this.logger.warn('Fallback RPC failed', { 
          url: this.fallbackRpcUrls[i],
          error: error instanceof Error ? error.message : error 
        });
      }
    }
    
    throw new NetworkError('All RPC endpoints failed');
  }

  /**
   * Disconnect from network
   */
  public disconnect(): void {
    this.logger.info('Disconnecting from Polygon');
    this.isConnected = false;
    this.removeAllListeners();
  }

  /**
   * Get connection status
   */
  public isConnectionValid(): boolean {
    return this.isConnected && !!this.networkId;
  }

  // ==================== USDC TOKEN OPERATIONS ====================

  /**
   * Get USDC balance for an address
   */
  public async getUSDCBalance(address?: string): Promise<TokenBalance> {
    if (!this.usdcContract) {
      throw new BlockchainError('USDC contract not initialized');
    }

    const targetAddress = address || (this.signer?.address);
    
    if (!targetAddress) {
      throw new ValidationError('No address provided and no signer configured');
    }

    try {
      const [balance, decimals, symbol, name] = await Promise.all([
        this.usdcContract.balanceOf(targetAddress),
        this.usdcContract.decimals(),
        this.usdcContract.symbol(),
        this.usdcContract.name()
      ]);

      const formattedBalance = ethers.formatUnits(balance, decimals);

      const result: TokenBalance = {
        address: targetAddress,
        symbol,
        name,
        balance,
        decimals,
        formattedBalance
      };

      this.logger.debug('USDC balance retrieved', {
        address: targetAddress,
        balance: formattedBalance
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to get USDC balance', error);
      throw this.handleBlockchainError(error);
    }
  }

  /**
   * Transfer USDC tokens
   */
  public async transferUSDC(
    to: string,
    amount: string | bigint,
    options?: {
      gasLimit?: bigint;
      gasPrice?: bigint;
      nonce?: number;
    }
  ): Promise<{ hash: string; confirmation: any }> {
    if (!this.signer) {
      throw new ValidationError('Signer not configured - cannot send transactions');
    }

    if (!this.usdcContract) {
      throw new BlockchainError('USDC contract not initialized');
    }

    // Validate recipient address
    if (!ethers.isAddress(to)) {
      throw new ValidationError('Invalid recipient address');
    }

    // Parse amount
    const decimals = await this.usdcContract.decimals();
    const amountWei = typeof amount === 'string' 
      ? ethers.parseUnits(amount, decimals)
      : amount;

    if (amountWei <= 0n) {
      throw new ValidationError('Transfer amount must be positive');
    }

    this.logger.info('Transferring USDC', {
      to,
      amount: ethers.formatUnits(amountWei, decimals),
      symbol: await this.usdcContract.symbol()
    });

    try {
      // Estimate gas
      const gasEstimate = await this.usdcContract.transfer.estimateGas(to, amountWei);
      const gasLimit = options?.gasLimit || BigInt(
        Math.floor(Number(gasEstimate) * (this.config.gasLimitMultiplier || 1.2))
      );

      // Get gas price
      const gasPrice = options?.gasPrice || await this.getOptimalGasPrice();

      // Check balance
      const balance = await this.getUSDCBalance(this.signer.address);
      if (balance.balance < amountWei) {
        throw new InsufficientFundsError(
          `Insufficient USDC balance. Required: ${ethers.formatUnits(amountWei, decimals)}, Available: ${balance.formattedBalance}`
        );
      }

      // Send transaction
      const tx = await this.usdcContract.transfer(to, amountWei, {
        gasLimit,
        gasPrice,
        nonce: options?.nonce
      });

      this.logger.debug('USDC transfer sent', { hash: tx.hash });

      // Wait for confirmation
      const confirmation = await tx.wait(this.config.confirmations);

      this.logger.info('USDC transfer confirmed', {
        hash: tx.hash,
        blockNumber: confirmation?.blockNumber
      });

      this.emit('usdc_transfer', {
        hash: tx.hash,
        to,
        amount: ethers.formatUnits(amountWei, decimals),
        blockNumber: confirmation?.blockNumber
      });

      return {
        hash: tx.hash,
        confirmation
      };
    } catch (error) {
      this.logger.error('USDC transfer failed', error);
      this.emit('error', { operation: 'usdc_transfer', error });
      throw this.handleBlockchainError(error);
    }
  }

  /**
   * Approve USDC spending for a spender
   */
  public async approveUSDC(
    spender: string,
    amount: string | bigint,
    options?: {
      gasLimit?: bigint;
      gasPrice?: bigint;
    }
  ): Promise<{ hash: string; confirmation: any }> {
    if (!this.signer) {
      throw new ValidationError('Signer not configured');
    }

    if (!this.usdcContract) {
      throw new BlockchainError('USDC contract not initialized');
    }

    if (!ethers.isAddress(spender)) {
      throw new ValidationError('Invalid spender address');
    }

    const decimals = await this.usdcContract.decimals();
    const amountWei = typeof amount === 'string' 
      ? ethers.parseUnits(amount, decimals)
      : amount;

    this.logger.info('Approving USDC spending', {
      spender,
      amount: ethers.formatUnits(amountWei, decimals)
    });

    try {
      const gasEstimate = await this.usdcContract.approve.estimateGas(spender, amountWei);
      const gasLimit = options?.gasLimit || BigInt(
        Math.floor(Number(gasEstimate) * (this.config.gasLimitMultiplier || 1.2))
      );

      const gasPrice = options?.gasPrice || await this.getOptimalGasPrice();

      const tx = await this.usdcContract.approve(spender, amountWei, {
        gasLimit,
        gasPrice
      });

      this.logger.debug('USDC approval sent', { hash: tx.hash });

      const confirmation = await tx.wait(this.config.confirmations);

      this.logger.info('USDC approval confirmed', {
        hash: tx.hash,
        blockNumber: confirmation?.blockNumber
      });

      this.emit('usdc_approval', {
        hash: tx.hash,
        spender,
        amount: ethers.formatUnits(amountWei, decimals)
      });

      return {
        hash: tx.hash,
        confirmation
      };
    } catch (error) {
      this.logger.error('USDC approval failed', error);
      throw this.handleBlockchainError(error);
    }
  }

  /**
   * Get USDC allowance for a spender
   */
  public async getUSDCAllowance(
    owner: string,
    spender: string
  ): Promise<{ allowance: bigint; formattedAllowance: string }> {
    if (!this.usdcContract) {
      throw new BlockchainError('USDC contract not initialized');
    }

    try {
      const [allowance, decimals] = await Promise.all([
        this.usdcContract.allowance(owner, spender),
        this.usdcContract.decimals()
      ]);

      return {
        allowance,
        formattedAllowance: ethers.formatUnits(allowance, decimals)
      };
    } catch (error) {
      this.logger.error('Failed to get USDC allowance', error);
      throw this.handleBlockchainError(error);
    }
  }

  // ==================== TRANSACTION MANAGEMENT ====================

  /**
   * Send a raw transaction
   */
  public async sendTransaction(
    to: string,
    value: bigint,
    data?: string,
    options?: {
      gasLimit?: bigint;
      gasPrice?: bigint;
      nonce?: number;
    }
  ): Promise<TransactionResponse> {
    if (!this.signer) {
      throw new ValidationError('Signer not configured');
    }

    if (!ethers.isAddress(to)) {
      throw new ValidationError('Invalid recipient address');
    }

    this.logger.info('Sending transaction', {
      to,
      value: ethers.formatEther(value),
      hasData: !!data
    });

    try {
      const tx: TransactionDetails = {
        hash: '',
        from: this.signer.address,
        to,
        value,
        gasPrice: options?.gasPrice || await this.getOptimalGasPrice(),
        gasLimit: options?.gasLimit || await this.estimateGasLimit(to, value, data),
        nonce: options?.nonce ?? (await this.signer.getNonce()),
        data
      };

      const response = await this.signer.sendTransaction(tx);

      this.logger.debug('Transaction sent', { hash: response.hash });

      this.emit('transaction_sent', {
        hash: response.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value
      });

      return response;
    } catch (error) {
      this.logger.error('Transaction failed', error);
      throw this.handleBlockchainError(error);
    }
  }

  /**
   * Estimate gas limit for a transaction
   */
  public async estimateGasLimit(
    to: string,
    value: bigint,
    data?: string
  ): Promise<bigint> {
    if (!this.signer) {
      throw new ValidationError('Signer required for gas estimation');
    }

    try {
      const estimate = await this.provider.estimateGas({
        from: this.signer.address,
        to,
        value,
        data
      });

      return BigInt(
        Math.floor(Number(estimate) * (this.config.gasLimitMultiplier || 1.2))
      );
    } catch (error) {
      this.logger.error('Gas estimation failed', error);
      throw error;
    }
  }

  /**
   * Get optimal gas price based on network conditions
   */
  public async getOptimalGasPrice(): Promise<bigint> {
    try {
      const feeData = await this.provider.getFeeData();
      
      let gasPrice = feeData.gasPrice || 0n;
      
      // Apply max gas price cap if configured
      const maxGasPriceWei = BigInt(this.config.maxGasPriceGwei! * 1e9);
      if (gasPrice > maxGasPriceWei) {
        this.logger.warn('Gas price exceeds maximum, using cap', {
          current: gasPrice.toString(),
          max: maxGasPriceWei.toString()
        });
        gasPrice = maxGasPriceWei;
      }

      this.logger.debug('Gas price retrieved', {
        gasPrice: gasPrice.toString(),
        gasPriceGwei: Number(gasPrice) / 1e9
      });

      return gasPrice;
    } catch (error) {
      this.logger.error('Failed to get gas price', error);
      // Return default gas price
      return BigInt(30 * 1e9); // 30 Gwei
    }
  }

  /**
   * Get detailed gas estimate
   */
  public async getGasEstimate(
    to: string,
    value: bigint,
    data?: string
  ): Promise<GasEstimate> {
    const [gasPrice, gasLimit] = await Promise.all([
      this.getOptimalGasPrice(),
      this.estimateGasLimit(to, value, data)
    ]);

    const estimatedCost = gasPrice * gasLimit;

    return {
      gasPrice,
      gasLimit,
      estimatedCost,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice / 2n
    };
  }

  /**
   * Wait for transaction confirmation
   */
  public async waitForTransaction(
    hash: string,
    confirmations?: number
  ): Promise<any> {
    try {
      const receipt = await this.provider.waitForTransaction(
        hash,
        confirmations || this.config.confirmations,
        this.config.timeout
      );

      if (!receipt) {
        throw new TransactionError('Transaction receipt not found');
      }

      if (receipt.status === 0) {
        throw new TransactionError('Transaction reverted', { hash });
      }

      this.logger.info('Transaction confirmed', {
        hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      return receipt;
    } catch (error) {
      this.logger.error('Transaction confirmation failed', error);
      throw error;
    }
  }

  /**
   * Get transaction by hash
   */
  public async getTransaction(hash: string): Promise<any> {
    return this.provider.getTransaction(hash);
  }

  /**
   * Get transaction receipt
   */
  public async getTransactionReceipt(hash: string): Promise<any> {
    return this.provider.getTransactionReceipt(hash);
  }

  // ==================== ACCOUNT OPERATIONS ====================

  /**
   * Get native MATIC balance
   */
  public async getMaticBalance(address?: string): Promise<bigint> {
    const targetAddress = address || (this.signer?.address);
    
    if (!targetAddress) {
      throw new ValidationError('No address provided');
    }

    return this.provider.getBalance(targetAddress);
  }

  /**
   * Get formatted MATIC balance
   */
  public async getFormattedMaticBalance(address?: string): Promise<string> {
    const balance = await this.getMaticBalance(address);
    return ethers.formatEther(balance);
  }

  /**
   * Get nonce for an address
   */
  public async getNonce(address?: string): Promise<number> {
    const targetAddress = address || (this.signer?.address);
    
    if (!targetAddress) {
      throw new ValidationError('No address provided');
    }

    return this.provider.getTransactionCount(targetAddress);
  }

  /**
   * Get signer address
   */
  public getAddress(): string | undefined {
    return this.signer?.address;
  }

  // ==================== NETWORK UTILITIES ====================

  /**
   * Get current block number
   */
  public async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  /**
   * Get latest block
   */
  public async getLatestBlock(): Promise<any> {
    return this.provider.getBlock('latest');
  }

  /**
   * Get network ID
   */
  public getNetworkId(): number | undefined {
    return this.networkId;
  }

  /**
   * Get current network name
   */
  public getNetworkName(): string | undefined {
    return this.config.network;
  }

  /**
   * Check if connected to mainnet
   */
  public isMainnet(): boolean {
    return this.config.network === 'mainnet' && this.networkId === 137;
  }

  /**
   * Check if connected to testnet
   */
  public isTestnet(): boolean {
    return this.config.network === 'testnet' && this.networkId === 80001;
  }

  // ==================== ERROR HANDLING ====================

  /**
   * Handle blockchain errors
   */
  private handleBlockchainError(error: any): Error {
    if (error.code === 'CALL_EXCEPTION') {
      return new BlockchainError('Contract call failed', {
        reason: error.reason,
        transaction: error.transaction
      });
    }

    if (error.code === 'INSUFFICIENT_FUNDS') {
      return new InsufficientFundsError('Insufficient MATIC for gas fees');
    }

    if (error.code === 'NONCE_EXPIRED') {
      return new TransactionError('Nonce expired - please retry with new nonce');
    }

    if (error.code === 'REPLACEMENT_UNDERPRICED') {
      return new TransactionError('Replacement transaction underpriced');
    }

    if (error.code === 'TIMEOUT') {
      return new NetworkError('Transaction timeout');
    }

    if (error.code === 'NETWORK_ERROR') {
      return new NetworkError('Network connection error');
    }

    return error;
  }

  /**
   * Set gas limit multiplier
   */
  public setGasLimitMultiplier(multiplier: number): void {
    if (multiplier < 1.0 || multiplier > 2.0) {
      throw new ValidationError('Gas limit multiplier must be between 1.0 and 2.0');
    }
    this.config.gasLimitMultiplier = multiplier;
    this.logger.info('Gas limit multiplier updated', { multiplier });
  }

  /**
   * Set max gas price in Gwei
   */
  public setMaxGasPriceGwei(maxGwei: number): void {
    if (maxGwei < 1 || maxGwei > 10000) {
      throw new ValidationError('Max gas price must be between 1 and 10000 Gwei');
    }
    this.config.maxGasPriceGwei = maxGwei;
    this.logger.info('Max gas price updated', { maxGwei });
  }

  /**
   * Enable debug logging
   */
  public setDebugMode(enabled: boolean): void {
    this.logger.level = enabled ? 'debug' : 'info';
  }
}

export default PolygonClient;
