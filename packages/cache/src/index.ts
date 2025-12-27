/**
 * @jejunetwork/cache
 *
 * Decentralized serverless cache with Redis compatibility and IPFS persistence.
 *
 * Features:
 * - Redis-compatible API (GET, SET, HSET, LPUSH, SADD, ZADD, etc.)
 * - IPFS persistence for data durability
 * - MPC-based encryption (using Jeju KMS instead of Lit Protocol)
 * - LRU eviction with configurable memory limits
 * - Namespace isolation for multi-tenancy
 * - Works in browser, Node.js, and serverless environments
 *
 * @example Browser/Serverless Client
 * ```typescript
 * import { CacheClient } from '@jejunetwork/cache'
 *
 * const cache = new CacheClient({
 *   serverUrl: 'https://cache.dws.jeju.network',
 *   enableEncryption: true,
 * })
 *
 * // Authenticate for encryption
 * await cache.signMessageForEncryption(address, signMessage)
 *
 * // Set with encryption
 * await cache.set('secret', { password: 'hunter2' }, { encrypt: true })
 *
 * // Get and decrypt
 * const { data } = await cache.get('secret', { decrypt: true })
 * ```
 *
 * @example DWS Node Server
 * ```typescript
 * import { CacheServer } from '@jejunetwork/cache'
 *
 * const server = new CacheServer({
 *   maxMemoryMb: 512,
 *   ipfsApiUrl: 'http://localhost:5001',
 * })
 *
 * // Set with automatic IPFS backup
 * await server.set('ns', 'key', { hello: 'world' })
 *
 * // Get (from memory or IPFS fallback)
 * const value = await server.get('ns', 'key')
 * ```
 */

// Client
export { CacheClient, createCacheClient } from './client'

// Server
export { CacheServer, createCacheServer } from './server'

// Encryption
export {
  CacheEncryption,
  createAuthSignature,
  getCacheEncryption,
  initializeCacheEncryption,
  resetCacheEncryption,
  verifyAuthSignature,
  type CacheEncryptionConfig,
} from './encryption'

// Types
export {
  // Error handling
  CacheError,
  CacheErrorCode,
  // Schemas
  AuthSignatureSchema,
  CacheResponseSchema,
  CacheSetOptionsSchema,
  CacheStatsSchema,
  EncryptedCacheEntrySchema,
  // Types
  type AccessCondition,
  type AuthSignature,
  type CacheClientConfig,
  type CacheEntry,
  type CacheGetOptions,
  type CacheNodeInfo,
  type CacheResponse,
  type CacheServerConfig,
  type CacheSetOptions,
  type CacheStats,
  type EncryptedCacheEntry,
} from './types'

