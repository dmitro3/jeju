/**
 * Cache Client
 *
 * Isomorphic client for the Jeju decentralized cache.
 * Works in browser, Node.js, and serverless environments.
 *
 * Inspired by redis-ipfs but uses:
 * - Jeju DWS for cache nodes
 * - Jeju KMS for MPC encryption (instead of Lit Protocol)
 * - DWS IPFS storage for persistence
 *
 * @example
 * ```typescript
 * import { CacheClient } from '@jejunetwork/cache'
 *
 * const cache = new CacheClient({
 *   serverUrl: 'https://cache.dws.jeju.network',
 *   enableEncryption: true,
 * })
 *
 * // Simple set/get
 * await cache.set('key', { hello: 'world' })
 * const { data } = await cache.get('key')
 *
 * // With encryption
 * await cache.set('secret', { password: 'hunter2' }, { encrypt: true })
 * const { data } = await cache.get('secret', { decrypt: true })
 *
 * // Purge from memory (keeps IPFS backup)
 * await cache.purge('key')
 * ```
 */

import type { Address } from 'viem'
import {
  CacheEncryption,
  createAuthSignature,
  getCacheEncryption,
} from './encryption'
import type {
  AuthSignature,
  CacheClientConfig,
  CacheGetOptions,
  CacheResponse,
  CacheSetOptions,
  CacheStats,
  EncryptedCacheEntry,
} from './types'
import { CacheError, CacheErrorCode, EncryptedCacheEntrySchema } from './types'

/**
 * Isomorphic cache client for Jeju decentralized cache
 */
export class CacheClient {
  private serverUrl: string
  private encryption: CacheEncryption | null = null
  private authSig: AuthSignature | null = null
  private defaultTtlSeconds: number
  private ipfsGatewayUrl: string | null

  constructor(config: CacheClientConfig) {
    this.serverUrl = config.serverUrl.replace(/\/$/, '')
    this.defaultTtlSeconds = config.defaultTtlSeconds ?? 3600
    this.ipfsGatewayUrl = config.ipfsGatewayUrl ?? null

    if (config.enableEncryption) {
      this.encryption = getCacheEncryption()
    }
  }

  /**
   * Sign a message to authenticate for encryption/decryption
   *
   * Required before using encryption features in browser.
   */
  async signMessageForEncryption(
    address: Address,
    signMessage: (message: string) => Promise<`0x${string}`>,
  ): Promise<AuthSignature> {
    if (!this.encryption) {
      throw new CacheError(
        CacheErrorCode.ENCRYPTION_FAILED,
        'Encryption not enabled - set enableEncryption: true in config',
      )
    }

    this.authSig = await createAuthSignature(address, signMessage)
    await this.encryption.initializeFromAuthSig(this.authSig)
    return this.authSig
  }

  /**
   * Get the current auth signature
   */
  getAuthSignature(): AuthSignature | null {
    return this.authSig
  }

  /**
   * Set a value in the cache
   */
  async set<T>(
    key: string,
    value: T,
    options: CacheSetOptions = {},
  ): Promise<CacheResponse<T | EncryptedCacheEntry>> {
    let dataToSet: T | EncryptedCacheEntry = value

    // Encrypt if requested
    if (options.encrypt) {
      if (!this.encryption) {
        throw new CacheError(
          CacheErrorCode.ENCRYPTION_FAILED,
          'Encryption not enabled',
        )
      }
      if (!this.authSig && !options.ownerAddress) {
        throw new CacheError(
          CacheErrorCode.ENCRYPTION_FAILED,
          'Call signMessageForEncryption() first or provide ownerAddress',
        )
      }

      const ownerAddress = options.ownerAddress ?? this.authSig?.address
      if (!ownerAddress) {
        throw new CacheError(
          CacheErrorCode.ENCRYPTION_FAILED,
          'No owner address available',
        )
      }

      const keyId = CacheEncryption.generateKeyId('default', key)
      const encrypted = await this.encryption.encrypt(
        JSON.stringify(value),
        ownerAddress,
        keyId,
      )
      dataToSet = encrypted
    }

    const response = await this.fetch<CacheResponse<T | EncryptedCacheEntry>>({
      path: `set/${encodeURIComponent(key)}`,
      method: 'POST',
      body: {
        value: dataToSet,
        ttl: options.ttl ?? this.defaultTtlSeconds,
        nx: options.nx,
        xx: options.xx,
      },
    })

    return response
  }

  /**
   * Get a value from the cache
   */
  async get<T>(
    key: string,
    options: CacheGetOptions = {},
  ): Promise<CacheResponse<T> | null> {
    const response = await this.fetch<CacheResponse<T | EncryptedCacheEntry> | null>({
      path: `get/${encodeURIComponent(key)}`,
      method: 'GET',
    })

    if (!response) {
      return null
    }

    // Check if data is encrypted
    const parseResult = EncryptedCacheEntrySchema.safeParse(response.data)
    if (parseResult.success && options.decrypt) {
      if (!this.encryption) {
        throw new CacheError(
          CacheErrorCode.DECRYPTION_FAILED,
          'Encryption not enabled',
        )
      }

      const decrypted = await this.encryption.decrypt(
        parseResult.data,
        options.authSig ?? this.authSig ?? undefined,
      )

      return {
        ...response,
        data: JSON.parse(decrypted) as T,
      }
    }

    return response as CacheResponse<T>
  }

  /**
   * Delete a key from the cache
   */
  async del(key: string): Promise<boolean> {
    const response = await this.fetch<{ deleted: number }>({
      path: `del/${encodeURIComponent(key)}`,
      method: 'DELETE',
    })
    return response.deleted > 0
  }

  /**
   * Purge a key from memory cache but keep IPFS backup
   *
   * Use this to reclaim memory for data that's no longer "hot".
   * The data can still be retrieved from IPFS if needed.
   */
  async purge(key: string): Promise<{ cid: string }> {
    return this.fetch<{ cid: string }>({
      path: `purge/${encodeURIComponent(key)}`,
      method: 'POST',
    })
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    const response = await this.fetch<{ exists: boolean }>({
      path: `exists/${encodeURIComponent(key)}`,
      method: 'GET',
    })
    return response.exists
  }

  /**
   * Get TTL for a key (in seconds)
   */
  async ttl(key: string): Promise<number> {
    const response = await this.fetch<{ ttl: number }>({
      path: `ttl/${encodeURIComponent(key)}`,
      method: 'GET',
    })
    return response.ttl
  }

  /**
   * Set TTL for a key
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    const response = await this.fetch<{ success: boolean }>({
      path: `expire/${encodeURIComponent(key)}`,
      method: 'POST',
      body: { ttl: seconds },
    })
    return response.success
  }

  /**
   * Get multiple keys at once
   */
  async mget<T>(keys: string[]): Promise<Map<string, T | null>> {
    const response = await this.fetch<{ entries: Record<string, T | null> }>({
      path: 'mget',
      method: 'POST',
      body: { keys },
    })

    return new Map(Object.entries(response.entries))
  }

  /**
   * Set multiple keys at once
   */
  async mset<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<boolean> {
    const response = await this.fetch<{ success: boolean }>({
      path: 'mset',
      method: 'POST',
      body: { entries },
    })
    return response.success
  }

  /**
   * Increment a numeric value
   */
  async incr(key: string, by = 1): Promise<number> {
    const response = await this.fetch<{ value: number }>({
      path: `incr/${encodeURIComponent(key)}`,
      method: 'POST',
      body: { by },
    })
    return response.value
  }

  /**
   * Decrement a numeric value
   */
  async decr(key: string, by = 1): Promise<number> {
    const response = await this.fetch<{ value: number }>({
      path: `decr/${encodeURIComponent(key)}`,
      method: 'POST',
      body: { by },
    })
    return response.value
  }

  // Hash operations

  /**
   * Set a hash field
   */
  async hset(key: string, field: string, value: string): Promise<number> {
    const response = await this.fetch<{ added: number }>({
      path: 'hset',
      method: 'POST',
      body: { key, field, value },
    })
    return response.added
  }

  /**
   * Get a hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    const response = await this.fetch<{ value: string | null }>({
      path: `hget?key=${encodeURIComponent(key)}&field=${encodeURIComponent(field)}`,
      method: 'GET',
    })
    return response.value
  }

  /**
   * Get all hash fields
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    const response = await this.fetch<{ hash: Record<string, string> }>({
      path: `hgetall?key=${encodeURIComponent(key)}`,
      method: 'GET',
    })
    return response.hash
  }

  // List operations

  /**
   * Push to the left of a list
   */
  async lpush(key: string, ...values: string[]): Promise<number> {
    const response = await this.fetch<{ length: number }>({
      path: 'lpush',
      method: 'POST',
      body: { key, values },
    })
    return response.length
  }

  /**
   * Push to the right of a list
   */
  async rpush(key: string, ...values: string[]): Promise<number> {
    const response = await this.fetch<{ length: number }>({
      path: 'rpush',
      method: 'POST',
      body: { key, values },
    })
    return response.length
  }

  /**
   * Pop from the left of a list
   */
  async lpop(key: string): Promise<string | null> {
    const response = await this.fetch<{ value: string | null }>({
      path: `lpop?key=${encodeURIComponent(key)}`,
      method: 'GET',
    })
    return response.value
  }

  /**
   * Pop from the right of a list
   */
  async rpop(key: string): Promise<string | null> {
    const response = await this.fetch<{ value: string | null }>({
      path: `rpop?key=${encodeURIComponent(key)}`,
      method: 'GET',
    })
    return response.value
  }

  /**
   * Get a range from a list
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const response = await this.fetch<{ values: string[] }>({
      path: 'lrange',
      method: 'POST',
      body: { key, start, stop },
    })
    return response.values
  }

  // Set operations

  /**
   * Add members to a set
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    const response = await this.fetch<{ added: number }>({
      path: 'sadd',
      method: 'POST',
      body: { key, members },
    })
    return response.added
  }

  /**
   * Get all members of a set
   */
  async smembers(key: string): Promise<string[]> {
    const response = await this.fetch<{ members: string[] }>({
      path: `smembers?key=${encodeURIComponent(key)}`,
      method: 'GET',
    })
    return response.members
  }

  /**
   * Check if a member is in a set
   */
  async sismember(key: string, member: string): Promise<boolean> {
    const response = await this.fetch<{ isMember: boolean }>({
      path: `sismember?key=${encodeURIComponent(key)}&member=${encodeURIComponent(member)}`,
      method: 'GET',
    })
    return response.isMember
  }

  // Sorted set operations

  /**
   * Add members to a sorted set
   */
  async zadd(key: string, ...members: Array<{ member: string; score: number }>): Promise<number> {
    const response = await this.fetch<{ added: number }>({
      path: 'zadd',
      method: 'POST',
      body: { key, members },
    })
    return response.added
  }

  /**
   * Get a range from a sorted set
   */
  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const response = await this.fetch<{ members: string[] }>({
      path: `zrange?key=${encodeURIComponent(key)}&start=${start}&stop=${stop}`,
      method: 'GET',
    })
    return response.members
  }

  // Utility operations

  /**
   * Get all keys matching a pattern
   */
  async keys(pattern = '*'): Promise<string[]> {
    const response = await this.fetch<{ keys: string[] }>({
      path: `keys?pattern=${encodeURIComponent(pattern)}`,
      method: 'GET',
    })
    return response.keys
  }

  /**
   * Get cache statistics
   */
  async stats(): Promise<CacheStats> {
    return this.fetch<CacheStats>({
      path: 'stats',
      method: 'GET',
    })
  }

  /**
   * Check if cache is healthy
   */
  async health(): Promise<{ status: string; uptime: number }> {
    return this.fetch<{ status: string; uptime: number }>({
      path: 'health',
      method: 'GET',
    })
  }

  /**
   * Flush all keys in a namespace
   */
  async flushdb(namespace = 'default'): Promise<boolean> {
    const response = await this.fetch<{ success: boolean }>({
      path: `clear?namespace=${encodeURIComponent(namespace)}`,
      method: 'DELETE',
    })
    return response.success
  }

  /**
   * Retrieve directly from IPFS (bypasses cache)
   */
  async retrieveFromIPFS<T>(cid: string): Promise<T> {
    const gatewayUrl = this.ipfsGatewayUrl ?? `${this.serverUrl}/ipfs`
    const response = await fetch(`${gatewayUrl}/${cid}`)

    if (!response.ok) {
      throw new CacheError(
        CacheErrorCode.IPFS_RETRIEVAL_FAILED,
        `Failed to retrieve from IPFS: ${response.status}`,
      )
    }

    return response.json() as Promise<T>
  }

  /**
   * Internal fetch helper
   */
  private async fetch<T>(options: {
    path: string
    method: 'GET' | 'POST' | 'DELETE'
    body?: Record<string, unknown>
  }): Promise<T> {
    const url = `${this.serverUrl}/cache/${options.path}`

    const init: RequestInit = {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
      },
    }

    if (options.body) {
      init.body = JSON.stringify(options.body)
    }

    const response = await fetch(url, init)

    if (!response.ok) {
      if (response.status === 404) {
        return null as T
      }
      const error = await response.text()
      throw new CacheError(
        CacheErrorCode.SERVER_ERROR,
        `Cache request failed: ${response.status} ${error}`,
      )
    }

    return response.json() as Promise<T>
  }
}

/**
 * Create a cache client with sensible defaults
 */
export function createCacheClient(
  serverUrl: string,
  options?: Partial<CacheClientConfig>,
): CacheClient {
  return new CacheClient({
    serverUrl,
    ...options,
  })
}

