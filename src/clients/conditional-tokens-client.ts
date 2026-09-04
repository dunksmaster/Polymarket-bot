/**
 * Polymarket Conditional Tokens API Client
 * 
 * Interface for interacting with Polymarket's Conditional Tokens smart contracts
 * on Polygon blockchain. Handles token minting, redeeming, splitting, and merging.
 * 
 * @module clients/conditional-tokens-client
 */

import { ethers, Contract, Provider, JsonRpcProvider, Wallet } from 'ethers';
import { EventEmitter } from 'events';
import { 
  Condition,
  PositionId,
  OutcomeToken,
  SplitOperation,
  MergeOperation,
  RedeemOperation,
  BlockchainError,
  TransactionError,
  ValidationError,
  NetworkError
} from '../types';
import { createLogger, formatAmount, retryWithBackoff } from '../utils';
import { ErrorHandler } from '../errors';

// Conditional Tokens ABI (simplified)
const CONDITIONAL_TOKENS_ABI = [
  'function getConditionId(bytes32 questionId, bytes32 outcomeSlotCount, bytes32[] memory outcomes) view returns (bytes32)',
  'function prepareCondition(bytes32 questionId, bytes32[] memory outcomes, uint256 outcomeSlotCount) external',
  'function splitPosition(bytes32 conditionId, bytes memory parentCollectionId, bytes32[] memory partition, uint256 amount) external',
  'function mergePositions(bytes32 conditionId, bytes memory parentCollectionId, bytes32[] memory partition, uint256 amount) external',
  'function redeemPositions(bytes32 conditionId, bytes memory parentCollectionId, bytes32[] memory outcomes) external',
  'function getPositionId(bytes32 conditionId, bytes memory parentCollectionId, bytes32[] memory partition) pure returns (bytes32)',
  'function balanceOf(address owner, uint256 tokenId) view returns (uint256)',
  'event ConditionPreparation(bytes32 indexed conditionId, bytes32 indexed questionId, bytes32[] outcomes)',
  'event PositionSplit(bytes32 indexed conditionId, bytes indexed parentCollectionId, bytes32[] partition, uint256 amount)',
  'event PositionsMerged(bytes32 indexed conditionId, bytes indexed parentCollectionId, bytes32[] partition, uint256 amount)',
  'event PositionRedeemed(bytes32 indexed conditionId, bytes indexed parentCollectionId, bytes32[] outcomes)'
];

interface ConditionalTokensClientConfig {
  rpcUrl: string;
  contractAddress: string;
  privateKey?: string;
  provider?: Provider;
  gasLimitMultiplier?: number;
  maxGasPrice?: bigint;
  confirmations?: number;
}

interface TransactionReceipt {
  hash: string;
  blockNumber: number;
  status: number;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  logs: any[];
}

/**
 * Conditional Tokens Client for Polymarket
 * 
 * Provides interface to interact with conditional tokens on Polygon:
 * - Prepare conditions
 * - Split positions into outcome tokens
 * - Merge outcome tokens back
 * - Redeem winning positions
 * - Query balances and positions
 */
export class ConditionalTokensClient extends EventEmitter {
  private provider: Provider;
  private contract: Contract;
  private signer?: Wallet;
  private config: ConditionalTokensClientConfig;
  private logger: ReturnType<typeof createLogger>;
  private errorHandlers: typeof ErrorHandler;
  
  private isConnected: boolean = false;
  private networkId?: number;

  constructor(config: ConditionalTokensClientConfig) {
    super();
    
    this.config = {
      rpcUrl: config.rpcUrl || 'https://polygon-rpc.com',
      contractAddress: config.contractAddress,
      privateKey: config.privateKey,
      gasLimitMultiplier: config.gasLimitMultiplier || 1.2,
      maxGasPrice: config.maxGasPrice,
      confirmations: config.confirmations || 1
    };
    
    this.logger = createLogger('ConditionalTokensClient');
    this.errorHandlers = ErrorHandler;
    
    // Initialize provider
    if (config.provider) {
      this.provider = config.provider;
    } else {
      this.provider = new JsonRpcProvider(this.config.rpcUrl);
    }
    
    // Initialize contract
    this.contract = new Contract(
      this.config.contractAddress,
      CONDITIONAL_TOKENS_ABI,
      this.provider
    );
    
    // Initialize signer if private key provided
    if (this.config.privateKey) {
      this.signer = new Wallet(this.config.privateKey, this.provider);
      this.contract = this.contract.connect(this.signer);
    }
    
    this.logger.info('ConditionalTokensClient initialized', {
      contractAddress: this.config.contractAddress,
      hasSigner: !!this.signer,
      rpcUrl: this.config.rpcUrl
    });
  }

  /**
   * Connect to the blockchain and verify contract
   */
  public async connect(): Promise<void> {
    try {
      const network = await this.provider.getNetwork();
      this.networkId = Number(network.chainId);
      
      // Verify contract exists
      const code = await this.provider.getCode(this.config.contractAddress);
      if (code === '0x') {
        throw new BlockchainError('Contract not deployed at specified address');
      }
      
      this.isConnected = true;
      this.logger.info('Connected to blockchain', {
        networkId: this.networkId,
        chainId: network.chainId
      });
      
      this.emit('connected', { networkId: this.networkId });
    } catch (error) {
      this.logger.error('Failed to connect', error);
      this.isConnected = false;
      this.emit('connection_error', error);
      throw error;
    }
  }

  /**
   * Disconnect from blockchain
   */
  public disconnect(): void {
    this.logger.info('Disconnecting from blockchain');
    this.isConnected = false;
    this.removeAllListeners();
  }

  /**
   * Get current connection status
   */
  public isConnectionValid(): boolean {
    return this.isConnected && !!this.networkId;
  }

  /**
   * Prepare a new condition
   */
  public async prepareCondition(
    questionId: string,
    outcomes: string[],
    outcomeSlotCount: number
  ): Promise<{ conditionId: string; txHash: string }> {
    if (!this.signer) {
      throw new ValidationError('Signer not configured - cannot write to blockchain');
    }

    this.logger.info('Preparing condition', {
      questionId,
      outcomes: outcomes.length,
      outcomeSlotCount
    });

    try {
      // Estimate gas
      const gasEstimate = await this.contract.prepareCondition.estimateGas(
        questionId,
        outcomes,
        outcomeSlotCount
      );

      const gasLimit = BigInt(
        Math.floor(Number(gasEstimate) * (this.config.gasLimitMultiplier || 1.2))
      );

      // Send transaction
      const tx = await this.contract.prepareCondition(
        questionId,
        outcomes,
        outcomeSlotCount,
        { gasLimit }
      );

      this.logger.debug('Transaction sent', { hash: tx.hash });

      // Wait for confirmation
      const receipt = await tx.wait(this.config.confirmations);
      
      // Extract condition ID from logs
      const conditionId = this.extractConditionIdFromLogs(receipt.logs);

      this.logger.info('Condition prepared successfully', {
        conditionId,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber
      });

      this.emit('condition_prepared', { conditionId, txHash: receipt.hash });

      return {
        conditionId,
        txHash: receipt.hash
      };
    } catch (error) {
      this.logger.error('Failed to prepare condition', error);
      this.emit('error', { operation: 'prepare_condition', error });
      throw this.handleBlockchainError(error);
    }
  }

  /**
   * Split a position into outcome tokens
   */
  public async splitPosition(
    conditionId: string,
    parentCollectionId: string | null,
    partition: string[],
    amount: bigint
  ): Promise<{ txHash: string; positionIds: string[] }> {
    if (!this.signer) {
      throw new ValidationError('Signer not configured');
    }

    if (amount <= 0n) {
      throw new ValidationError('Amount must be positive');
    }

    this.logger.info('Splitting position', {
      conditionId,
      parentCollectionId,
      partition: partition.length,
      amount: amount.toString()
    });

    try {
      const parentCollectionBytes = parentCollectionId || '0x';
      
      // Estimate gas
      const gasEstimate = await this.contract.splitPosition.estimateGas(
        conditionId,
        parentCollectionBytes,
        partition,
        amount
      );

      const gasLimit = BigInt(
        Math.floor(Number(gasEstimate) * (this.config.gasLimitMultiplier || 1.2))
      );

      const tx = await this.contract.splitPosition(
        conditionId,
        parentCollectionBytes,
        partition,
        amount,
        { gasLimit }
      );

      this.logger.debug('Split transaction sent', { hash: tx.hash });

      const receipt = await tx.wait(this.config.confirmations);

      // Calculate position IDs
      const positionIds = partition.map(outcome => 
        this.calculatePositionId(conditionId, parentCollectionBytes, [outcome])
      );

      this.logger.info('Position split successfully', {
        txHash: receipt.hash,
        positionIds
      });

      this.emit('position_split', {
        conditionId,
        positionIds,
        amount,
        txHash: receipt.hash
      });

      return {
        txHash: receipt.hash,
        positionIds
      };
    } catch (error) {
      this.logger.error('Failed to split position', error);
      this.emit('error', { operation: 'split_position', error });
      throw this.handleBlockchainError(error);
    }
  }

  /**
   * Merge outcome tokens back into parent position
   */
  public async mergePositions(
    conditionId: string,
    parentCollectionId: string | null,
    partition: string[],
    amount: bigint
  ): Promise<{ txHash: string }> {
    if (!this.signer) {
      throw new ValidationError('Signer not configured');
    }

    if (amount <= 0n) {
      throw new ValidationError('Amount must be positive');
    }

    this.logger.info('Merging positions', {
      conditionId,
      partition: partition.length,
      amount: amount.toString()
    });

    try {
      const parentCollectionBytes = parentCollectionId || '0x';
      
      const gasEstimate = await this.contract.mergePositions.estimateGas(
        conditionId,
        parentCollectionBytes,
        partition,
        amount
      );

      const gasLimit = BigInt(
        Math.floor(Number(gasEstimate) * (this.config.gasLimitMultiplier || 1.2))
      );

      const tx = await this.contract.mergePositions(
        conditionId,
        parentCollectionBytes,
        partition,
        amount,
        { gasLimit }
      );

      this.logger.debug('Merge transaction sent', { hash: tx.hash });

      const receipt = await tx.wait(this.config.confirmations);

      this.logger.info('Positions merged successfully', {
        txHash: receipt.hash
      });

      this.emit('positions_merged', {
        conditionId,
        amount,
        txHash: receipt.hash
      });

      return {
        txHash: receipt.hash
      };
    } catch (error) {
      this.logger.error('Failed to merge positions', error);
      this.emit('error', { operation: 'merge_positions', error });
      throw this.handleBlockchainError(error);
    }
  }

  /**
   * Redeem winning positions after resolution
   */
  public async redeemPositions(
    conditionId: string,
    parentCollectionId: string | null,
    outcomes: string[]
  ): Promise<{ txHash: string; payout: bigint }> {
    if (!this.signer) {
      throw new ValidationError('Signer not configured');
    }

    this.logger.info('Redeeming positions', {
      conditionId,
      outcomes: outcomes.length
    });

    try {
      const parentCollectionBytes = parentCollectionId || '0x';
      
      const gasEstimate = await this.contract.redeemPositions.estimateGas(
        conditionId,
        parentCollectionBytes,
        outcomes
      );

      const gasLimit = BigInt(
        Math.floor(Number(gasEstimate) * (this.config.gasLimitMultiplier || 1.2))
      );

      const tx = await this.contract.redeemPositions(
        conditionId,
        parentCollectionBytes,
        outcomes,
        { gasLimit }
      );

      this.logger.debug('Redeem transaction sent', { hash: tx.hash });

      const receipt = await tx.wait(this.config.confirmations);

      // Calculate payout from logs
      const payout = this.extractPayoutFromLogs(receipt.logs);

      this.logger.info('Positions redeemed successfully', {
        txHash: receipt.hash,
        payout: payout.toString()
      });

      this.emit('positions_redeemed', {
        conditionId,
        payout,
        txHash: receipt.hash
      });

      return {
        txHash: receipt.hash,
        payout
      };
    } catch (error) {
      this.logger.error('Failed to redeem positions', error);
      this.emit('error', { operation: 'redeem_positions', error });
      throw this.handleBlockchainError(error);
    }
  }

  /**
   * Get balance of outcome tokens for an address
   */
  public async getTokenBalance(
    owner: string,
    conditionId: string,
    outcomeIndex: number
  ): Promise<bigint> {
    try {
      const positionId = await this.getPositionId(
        conditionId,
        null,
        [outcomeIndex.toString()]
      );

      const balance = await this.contract.balanceOf(owner, positionId);
      
      this.logger.debug('Token balance retrieved', {
        owner,
        conditionId,
        outcomeIndex,
        balance: balance.toString()
      });

      return balance;
    } catch (error) {
      this.logger.error('Failed to get token balance', error);
      throw this.handleBlockchainError(error);
    }
  }

  /**
   * Get position ID for a specific outcome
   */
  public async getPositionId(
    conditionId: string,
    parentCollectionId: string | null,
    partition: string[]
  ): Promise<string> {
    try {
      const parentCollectionBytes = parentCollectionId || '0x';
      
      const positionId = await this.contract.getPositionId.staticCall(
        conditionId,
        parentCollectionBytes,
        partition
      );

      return positionId;
    } catch (error) {
      this.logger.error('Failed to get position ID', error);
      throw this.handleBlockchainError(error);
    }
  }

  /**
   * Calculate position ID locally (pure function)
   */
  public calculatePositionId(
    conditionId: string,
    parentCollectionId: string,
    partition: string[]
  ): string {
    // Simplified calculation - in production use proper keccak256 hashing
    const data = ethers.solidityPacked(
      ['bytes32', 'bytes', 'bytes32[]'],
      [conditionId, parentCollectionId, partition]
    );
    
    return ethers.keccak256(data);
  }

  /**
   * Get condition ID from question ID and outcomes
   */
  public async getConditionId(
    questionId: string,
    outcomes: string[]
  ): Promise<string> {
    try {
      const conditionId = await this.contract.getConditionId.staticCall(
        questionId,
        outcomes.length,
        outcomes
      );

      return conditionId;
    } catch (error) {
      this.logger.error('Failed to get condition ID', error);
      throw this.handleBlockchainError(error);
    }
  }

  /**
   * Extract condition ID from transaction logs
   */
  private extractConditionIdFromLogs(logs: any[]): string {
    // Find ConditionPreparation event
    const prepLog = logs.find(log => 
      log.topics?.[0] === ethers.id('ConditionPreparation(bytes32,bytes32,bytes32[])')
    );

    if (prepLog) {
      return prepLog.topics?.[1] || '0x0';
    }

    return '0x0';
  }

  /**
   * Extract payout amount from transaction logs
   */
  private extractPayoutFromLogs(logs: any[]): bigint {
    // Find PositionRedeemed event and extract payout
    // Simplified - in production parse actual event data
    return 0n;
  }

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
      return new TransactionError('Insufficient funds for transaction');
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
   * Wait for transaction confirmation
   */
  public async waitForTransaction(
    txHash: string,
    confirmations?: number
  ): Promise<TransactionReceipt> {
    const receipt = await this.provider.waitForTransaction(
      txHash,
      confirmations || this.config.confirmations
    );

    if (!receipt) {
      throw new TransactionError('Transaction receipt not found');
    }

    return {
      hash: receipt.hash,
      blockNumber: Number(receipt.blockNumber),
      status: receipt.status,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.gasPrice || 0n,
      logs: receipt.logs || []
    };
  }

  /**
   * Get current gas price
   */
  public async getGasPrice(): Promise<bigint> {
    const feeData = await this.provider.getFeeData();
    return feeData.gasPrice || 0n;
  }

  /**
   * Get recommended gas limit for operations
   */
  public async estimateGasLimit(operation: string, params: any[]): Promise<bigint> {
    try {
      const estimate = await this.contract[operation].estimateGas(...params);
      return BigInt(
        Math.floor(Number(estimate) * (this.config.gasLimitMultiplier || 1.2))
      );
    } catch (error) {
      this.logger.error('Gas estimation failed', error);
      throw error;
    }
  }

  /**
   * Get contract address
   */
  public getContractAddress(): string {
    return this.config.contractAddress;
  }

  /**
   * Get network ID
   */
  public getNetworkId(): number | undefined {
    return this.networkId;
  }

  /**
   * Set maximum gas price
   */
  public setMaxGasPrice(maxGasPrice: bigint): void {
    this.config.maxGasPrice = maxGasPrice;
    this.logger.info('Max gas price updated', { maxGasPrice: maxGasPrice.toString() });
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
}

export default ConditionalTokensClient;
