/**
 * @jejunetwork/cache - Type Definitions
 *
 * Decentralized serverless cache with Redis compatibility and IPFS persistence.
 * Uses MPC-based encryption instead of centralized key management.
 */

import type { Address, Hex } from 'viem'
import { z } from 'zod'

/**
 * Cache entry wrapper that includes IPFS CID for persistence
 */
export interface CacheEntry<T = string> {
  /** The actual data */
  data: T
  /** IPFS CID where data is backed up ('pending' if backup in progress) */
  cid: string
  /** Timestamp when entry was created */
  createdAt: number
  /** Timestamp when entry was last accessed */
  lastAccessedAt: number
  /** TTL in seconds (0 = no expiration) */
  ttlSeconds: number
}

/**
 * Encrypted cache entry for MPC-protected data
 */
export interface EncryptedCacheEntry {
  /** Encrypted data (AES-GCM ciphertext) */
  encryptedData: Hex
  /** IV for AES-GCM */
  iv: Hex
  /** Auth tag for AES-GCM */
  tag: Hex
  /** Owner address that can decrypt */
  ownerAddress: Address
  /** Optional: Key ID for MPC key derivation */
  keyId?: string
  /** Whether MPC threshold signing was used for encryption key */
  mpc: boolean
}

/**
 * Response wrapper for cache operations (similar to redis-ipfs RipWrapped)
 */
export interface CacheResponse<T = string> {
  /** The data value */
  data: T
  /** IPFS CID for persistent backup */
  cid: string
  /** Timestamp when set */
  setAtTimestamp: number
  /** Duration of the operation in ms */
  duration?: number
}

/**
 * Cache client configuration
 */
export interface CacheClientConfig {
  /** DWS cache server URL */
  serverUrl: string
  /** Enable MPC-based encryption */
  enableEncryption?: boolean
  /** MPC threshold for encryption (default: 2) */
  mpcThreshold?: number
  /** Total MPC parties for encryption (default: 3) */
  mpcTotalParties?: number
  /** Default TTL in seconds (default: 3600) */
  defaultTtlSeconds?: number
  /** Custom IPFS gateway URL for direct retrieval */
  ipfsGatewayUrl?: string
}

/**
 * Cache server configuration
 */
export interface CacheServerConfig {
  /** Maximum memory in MB (default: 256) */
  maxMemoryMb?: number
  /** Default TTL in seconds (default: 3600) */
  defaultTtlSeconds?: number
  /** Maximum TTL in seconds (default: 30 days) */
  maxTtlSeconds?: number
  /** IPFS API URL for backup */
  ipfsApiUrl?: string
  /** IPFS gateway URL for retrieval */
  ipfsGatewayUrl?: string
  /** Enable MPC key management */
  enableMpc?: boolean
}

/**
 * Options for cache set operations
 */
export interface CacheSetOptions {
  /** TTL in seconds */
  ttl?: number
  /** Only set if key does not exist */
  nx?: boolean
  /** Only set if key exists */
  xx?: boolean
  /** Encrypt the value using MPC */
  encrypt?: boolean
  /** Owner address for encrypted data */
  ownerAddress?: Address
}

/**
 * Options for cache get operations
 */
export interface CacheGetOptions {
  /** Decrypt the value if encrypted */
  decrypt?: boolean
  /** Auth signature for decryption */
  authSig?: AuthSignature
}

/**
 * Auth signature for proving identity (replaces Lit Protocol's AuthSig)
 */
export interface AuthSignature {
  /** Ethereum address */
  address: Address
  /** Signature */
  sig: Hex
  /** Signed message */
  signedMessage: string
  /** Signature method */
  derivedVia: 'web3.eth.personal.sign' | 'EIP712' | 'siwe'
}

/**
 * Access control conditions for encrypted data
 */
export interface AccessCondition {
  /** Condition type */
  type: 'address' | 'balance' | 'contract' | 'timestamp'
  /** Chain ID */
  chain?: string
  /** Contract address (for contract conditions) */
  contractAddress?: Address
  /** Method to call (for contract conditions) */
  method?: string
  /** Parameters for the method */
  parameters?: (string | number | boolean)[]
  /** Return value test */
  returnValueTest?: {
    comparator: '=' | '!=' | '>' | '<' | '>=' | '<='
    value: string | number
  }
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total keys in cache */
  totalKeys: number
  /** Used memory in bytes */
  usedMemoryBytes: number
  /** Maximum memory in bytes */
  maxMemoryBytes: number
  /** Cache hits */
  hits: number
  /** Cache misses */
  misses: number
  /** Hit rate (0-1) */
  hitRate: number
  /** Total evictions */
  evictions: number
  /** Expired keys cleaned up */
  expiredKeys: number
  /** Keys backed up to IPFS */
  ipfsBackedKeys: number
  /** Uptime in ms */
  uptime: number
}

/**
 * Node info for distributed cache network
 */
export interface CacheNodeInfo {
  /** Node ID */
  nodeId: string
  /** Node address */
  address: Address
  /** Endpoint URL */
  endpoint: string
  /** Geographic region */
  region: string
  /** Maximum memory in MB */
  maxMemoryMb: number
  /** Used memory in MB */
  usedMemoryMb: number
  /** Node status */
  status: 'online' | 'offline' | 'draining'
  /** Last heartbeat timestamp */
  lastHeartbeat: number
  /** MPC party index (if participating in MPC) */
  mpcPartyIndex?: number
}

// Zod schemas for validation

export const AuthSignatureSchema = z.object({
  address: z.string().startsWith('0x') as z.ZodType<Address>,
  sig: z.string().startsWith('0x') as z.ZodType<Hex>,
  signedMessage: z.string(),
  derivedVia: z.enum(['web3.eth.personal.sign', 'EIP712', 'siwe']),
})

export const CacheSetOptionsSchema = z.object({
  ttl: z.number().optional(),
  nx: z.boolean().optional(),
  xx: z.boolean().optional(),
  encrypt: z.boolean().optional(),
  ownerAddress: z
    .string()
    .startsWith('0x')
    .optional() as z.ZodOptional<z.ZodType<Address>>,
})

export const CacheResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    cid: z.string(),
    setAtTimestamp: z.number(),
    duration: z.number().optional(),
  })

export const EncryptedCacheEntrySchema = z.object({
  encryptedData: z.string().startsWith('0x') as z.ZodType<Hex>,
  iv: z.string().startsWith('0x') as z.ZodType<Hex>,
  tag: z.string().startsWith('0x') as z.ZodType<Hex>,
  ownerAddress: z.string().startsWith('0x') as z.ZodType<Address>,
  keyId: z.string().optional(),
  mpc: z.boolean(),
})

export const CacheStatsSchema = z.object({
  totalKeys: z.number(),
  usedMemoryBytes: z.number(),
  maxMemoryBytes: z.number(),
  hits: z.number(),
  misses: z.number(),
  hitRate: z.number(),
  evictions: z.number(),
  expiredKeys: z.number(),
  ipfsBackedKeys: z.number(),
  uptime: z.number(),
})

/**
 * Error codes for cache operations
 */
export const CacheErrorCode = {
  KEY_NOT_FOUND: 'KEY_NOT_FOUND',
  ENCRYPTION_FAILED: 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  IPFS_BACKUP_FAILED: 'IPFS_BACKUP_FAILED',
  IPFS_RETRIEVAL_FAILED: 'IPFS_RETRIEVAL_FAILED',
  MPC_ERROR: 'MPC_ERROR',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INVALID_TTL: 'INVALID_TTL',
  SERVER_ERROR: 'SERVER_ERROR',
} as const

export type CacheErrorCode = (typeof CacheErrorCode)[keyof typeof CacheErrorCode]

/**
 * Cache error class
 */
export class CacheError extends Error {
  constructor(
    public readonly code: CacheErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'CacheError'
  }
}

