/**
 * Cache Server
 *
 * In-memory cache with IPFS persistence for DWS nodes.
 * Provides Redis-compatible operations with automatic IPFS backup.
 *
 * Inspired by redis-ipfs but uses:
 * - DWS storage infrastructure
 * - Automatic async IPFS backup
 * - LRU eviction with configurable memory limits
 *
 * @example
 * ```typescript
 * import { CacheServer } from '@jejunetwork/cache'
 *
 * const server = new CacheServer({
 *   maxMemoryMb: 512,
 *   ipfsApiUrl: 'http://localhost:5001',
 * })
 *
 * // Set with automatic IPFS backup
 * const entry = await server.set('key', { hello: 'world' })
 * console.log(entry.cid) // 'pending' or IPFS CID
 *
 * // Get (from memory or IPFS fallback)
 * const value = await server.get('key')
 *
 * // Purge memory (keeps IPFS)
 * await server.purge('key')
 * ```
 */

import type { CacheResponse, CacheServerConfig, CacheStats } from './types'
import { CacheError, CacheErrorCode } from './types'

interface StorageEntry {
  data: unknown
  cid: string
  createdAt: number
  expiresAt: number
  accessCount: number
  lastAccessedAt: number
  sizeBytes: number
}

interface LRUNode {
  key: string
  namespace: string
  prev: LRUNode | null
  next: LRUNode | null
}

interface NamespaceData {
  entries: Map<string, StorageEntry>
  usedBytes: number
  hits: number
  misses: number
}

/**
 * Cache server with Redis-compatible operations and IPFS persistence
 */
export class CacheServer {
  private namespaces = new Map<string, NamespaceData>()
  private config: Required<CacheServerConfig>
  private lruHead: LRUNode | null = null
  private lruTail: LRUNode | null = null
  private lruNodes = new Map<string, LRUNode>()
  private totalHits = 0
  private totalMisses = 0
  private totalEvictions = 0
  private totalExpiredKeys = 0
  private ipfsBackedKeys = 0
  private startTime = Date.now()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: CacheServerConfig = {}) {
    this.config = {
      maxMemoryMb: config.maxMemoryMb ?? 256,
      defaultTtlSeconds: config.defaultTtlSeconds ?? 3600,
      maxTtlSeconds: config.maxTtlSeconds ?? 86400 * 30,
      ipfsApiUrl: config.ipfsApiUrl ?? '',
      ipfsGatewayUrl: config.ipfsGatewayUrl ?? 'https://ipfs.io',
      enableMpc: config.enableMpc ?? false,
    }

    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 10000)
  }

  /**
   * Stop the cache server
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * Set a value in the cache
   */
  async set<T>(
    namespace: string,
    key: string,
    value: T,
    options: { ttl?: number; nx?: boolean; xx?: boolean } = {},
  ): Promise<CacheResponse<T>> {
    const ns = this.getOrCreateNamespace(namespace)
    const existing = ns.entries.get(key)

    // Handle NX/XX flags
    if (options.nx && existing) {
      throw new CacheError(
        CacheErrorCode.INVALID_TTL,
        'Key already exists (NX flag set)',
      )
    }
    if (options.xx && !existing) {
      throw new CacheError(
        CacheErrorCode.KEY_NOT_FOUND,
        'Key does not exist (XX flag set)',
      )
    }

    const ttl = options.ttl ?? this.config.defaultTtlSeconds
    if (ttl > this.config.maxTtlSeconds) {
      throw new CacheError(
        CacheErrorCode.INVALID_TTL,
        `TTL ${ttl} exceeds maximum ${this.config.maxTtlSeconds}`,
      )
    }

    const now = Date.now()
    const dataStr = JSON.stringify(value)
    const sizeBytes = new TextEncoder().encode(dataStr).length

    const entry: StorageEntry = {
      data: value,
      cid: 'pending',
      createdAt: now,
      expiresAt: now + ttl * 1000,
      accessCount: 0,
      lastAccessedAt: now,
      sizeBytes,
    }

    // Update memory usage
    const oldSize = existing?.sizeBytes ?? 0
    ns.usedBytes = ns.usedBytes - oldSize + sizeBytes

    // Ensure memory limit
    this.ensureMemoryLimit()

    ns.entries.set(key, entry)
    this.updateLRU(namespace, key)

    // Async backup to IPFS
    this.backupToIPFS(namespace, key, value, now)

    return {
      data: value,
      cid: 'pending',
      setAtTimestamp: now,
    }
  }

  /**
   * Get a value from the cache
   */
  async get<T>(namespace: string, key: string): Promise<CacheResponse<T> | null> {
    const ns = this.namespaces.get(namespace)
    if (!ns) {
      this.totalMisses++
      return null
    }

    const entry = ns.entries.get(key)
    if (!entry) {
      this.totalMisses++
      ns.misses++
      return null
    }

    // Check expiration
    if (entry.expiresAt < Date.now()) {
      ns.entries.delete(key)
      ns.usedBytes -= entry.sizeBytes
      this.removeLRU(namespace, key)
      this.totalExpiredKeys++
      this.totalMisses++
      ns.misses++
      return null
    }

    // Update access stats
    entry.accessCount++
    entry.lastAccessedAt = Date.now()
    this.updateLRU(namespace, key)
    this.totalHits++
    ns.hits++

    // Check if data is in memory or needs IPFS fetch
    if (entry.data !== null) {
      return {
        data: entry.data as T,
        cid: entry.cid,
        setAtTimestamp: entry.createdAt,
      }
    }

    // Fetch from IPFS
    if (entry.cid && entry.cid !== 'pending') {
      const data = await this.fetchFromIPFS<T>(entry.cid)
      entry.data = data
      return {
        data,
        cid: entry.cid,
        setAtTimestamp: entry.createdAt,
      }
    }

    return null
  }

  /**
   * Delete keys from the cache
   */
  del(namespace: string, ...keys: string[]): number {
    const ns = this.namespaces.get(namespace)
    if (!ns) return 0

    let deleted = 0
    for (const key of keys) {
      const entry = ns.entries.get(key)
      if (entry) {
        ns.usedBytes -= entry.sizeBytes
        ns.entries.delete(key)
        this.removeLRU(namespace, key)
        deleted++
      }
    }

    return deleted
  }

  /**
   * Purge data from memory but keep IPFS backup
   */
  async purge(namespace: string, key: string): Promise<{ cid: string }> {
    const ns = this.namespaces.get(namespace)
    if (!ns) {
      throw new CacheError(CacheErrorCode.KEY_NOT_FOUND, 'Key not found')
    }

    const entry = ns.entries.get(key)
    if (!entry) {
      throw new CacheError(CacheErrorCode.KEY_NOT_FOUND, 'Key not found')
    }

    if (entry.cid === 'pending') {
      throw new CacheError(
        CacheErrorCode.IPFS_BACKUP_FAILED,
        'Cannot purge before IPFS backup is complete',
      )
    }

    // Clear data but keep metadata for IPFS retrieval
    const oldSize = entry.sizeBytes
    entry.data = null
    entry.sizeBytes = 0
    ns.usedBytes -= oldSize

    return { cid: entry.cid }
  }

  /**
   * Check if key exists
   */
  exists(namespace: string, ...keys: string[]): number {
    const ns = this.namespaces.get(namespace)
    if (!ns) return 0

    let count = 0
    for (const key of keys) {
      const entry = ns.entries.get(key)
      if (entry && entry.expiresAt > Date.now()) {
        count++
      }
    }
    return count
  }

  /**
   * Get TTL for a key (in seconds)
   */
  ttl(namespace: string, key: string): number {
    const ns = this.namespaces.get(namespace)
    if (!ns) return -2

    const entry = ns.entries.get(key)
    if (!entry) return -2

    if (entry.expiresAt === Infinity) return -1

    const remaining = Math.ceil((entry.expiresAt - Date.now()) / 1000)
    return remaining > 0 ? remaining : -2
  }

  /**
   * Set TTL for a key
   */
  expire(namespace: string, key: string, seconds: number): boolean {
    const ns = this.namespaces.get(namespace)
    if (!ns) return false

    const entry = ns.entries.get(key)
    if (!entry) return false

    entry.expiresAt = Date.now() + seconds * 1000
    return true
  }

  /**
   * Increment a numeric value
   */
  incr(namespace: string, key: string, by = 1): number {
    const ns = this.namespaces.get(namespace)
    const entry = ns?.entries.get(key)

    const current = entry?.data
    const num = typeof current === 'string' ? parseInt(current, 10) : 0

    if (Number.isNaN(num)) {
      throw new CacheError(CacheErrorCode.INVALID_TTL, 'Value is not an integer')
    }

    const newValue = num + by
    this.set(namespace, key, String(newValue))
    return newValue
  }

  /**
   * Decrement a numeric value
   */
  decr(namespace: string, key: string, by = 1): number {
    return this.incr(namespace, key, -by)
  }

  // Hash operations

  /**
   * Set hash field
   */
  async hset(namespace: string, key: string, field: string, value: string): Promise<number> {
    const response = await this.get<Record<string, string>>(namespace, key)
    const hash = response?.data ?? {}
    const isNew = !(field in hash)
    hash[field] = value
    await this.set(namespace, key, hash)
    return isNew ? 1 : 0
  }

  /**
   * Get hash field
   */
  async hget(namespace: string, key: string, field: string): Promise<string | null> {
    const response = await this.get<Record<string, string>>(namespace, key)
    return response?.data[field] ?? null
  }

  /**
   * Get all hash fields
   */
  async hgetall(namespace: string, key: string): Promise<Record<string, string>> {
    const response = await this.get<Record<string, string>>(namespace, key)
    return response?.data ?? {}
  }

  // List operations

  /**
   * Push to left of list
   */
  async lpush(namespace: string, key: string, ...values: string[]): Promise<number> {
    const response = await this.get<string[]>(namespace, key)
    const list = response?.data ?? []
    list.unshift(...values.reverse())
    await this.set(namespace, key, list)
    return list.length
  }

  /**
   * Push to right of list
   */
  async rpush(namespace: string, key: string, ...values: string[]): Promise<number> {
    const response = await this.get<string[]>(namespace, key)
    const list = response?.data ?? []
    list.push(...values)
    await this.set(namespace, key, list)
    return list.length
  }

  /**
   * Pop from left of list
   */
  async lpop(namespace: string, key: string): Promise<string | null> {
    const response = await this.get<string[]>(namespace, key)
    if (!response?.data || response.data.length === 0) return null
    const value = response.data.shift()
    await this.set(namespace, key, response.data)
    return value ?? null
  }

  /**
   * Pop from right of list
   */
  async rpop(namespace: string, key: string): Promise<string | null> {
    const response = await this.get<string[]>(namespace, key)
    if (!response?.data || response.data.length === 0) return null
    const value = response.data.pop()
    await this.set(namespace, key, response.data)
    return value ?? null
  }

  /**
   * Get list range
   */
  async lrange(namespace: string, key: string, start: number, stop: number): Promise<string[]> {
    const response = await this.get<string[]>(namespace, key)
    if (!response?.data) return []
    const len = response.data.length
    const normalizedStart = start < 0 ? Math.max(len + start, 0) : start
    const normalizedStop = stop < 0 ? len + stop + 1 : stop + 1
    return response.data.slice(normalizedStart, normalizedStop)
  }

  /**
   * Get list length
   */
  async llen(namespace: string, key: string): Promise<number> {
    const response = await this.get<string[]>(namespace, key)
    return response?.data?.length ?? 0
  }

  // Set operations

  /**
   * Add members to set
   */
  async sadd(namespace: string, key: string, ...members: string[]): Promise<number> {
    const response = await this.get<string[]>(namespace, key)
    const set = new Set(response?.data ?? [])
    let added = 0
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member)
        added++
      }
    }
    await this.set(namespace, key, Array.from(set))
    return added
  }

  /**
   * Remove members from set
   */
  async srem(namespace: string, key: string, ...members: string[]): Promise<number> {
    const response = await this.get<string[]>(namespace, key)
    if (!response?.data) return 0
    const set = new Set(response.data)
    let removed = 0
    for (const member of members) {
      if (set.delete(member)) removed++
    }
    await this.set(namespace, key, Array.from(set))
    return removed
  }

  /**
   * Get all set members
   */
  async smembers(namespace: string, key: string): Promise<string[]> {
    const response = await this.get<string[]>(namespace, key)
    return response?.data ?? []
  }

  /**
   * Check if member is in set
   */
  async sismember(namespace: string, key: string, member: string): Promise<boolean> {
    const response = await this.get<string[]>(namespace, key)
    return response?.data?.includes(member) ?? false
  }

  /**
   * Get set cardinality
   */
  async scard(namespace: string, key: string): Promise<number> {
    const response = await this.get<string[]>(namespace, key)
    return response?.data?.length ?? 0
  }

  // Sorted set operations

  /**
   * Add members to sorted set
   */
  async zadd(
    namespace: string,
    key: string,
    ...members: Array<{ member: string; score: number }>
  ): Promise<number> {
    const response = await this.get<Array<{ member: string; score: number }>>(namespace, key)
    const zset = response?.data ?? []
    let added = 0

    for (const { member, score } of members) {
      const existing = zset.find((m) => m.member === member)
      if (existing) {
        existing.score = score
      } else {
        zset.push({ member, score })
        added++
      }
    }

    zset.sort((a, b) => a.score - b.score)
    await this.set(namespace, key, zset)
    return added
  }

  /**
   * Get sorted set range
   */
  async zrange(namespace: string, key: string, start: number, stop: number): Promise<string[]> {
    const response = await this.get<Array<{ member: string; score: number }>>(namespace, key)
    if (!response?.data) return []
    const len = response.data.length
    const normalizedStart = start < 0 ? Math.max(len + start, 0) : start
    const normalizedStop = stop < 0 ? len + stop + 1 : stop + 1
    return response.data.slice(normalizedStart, normalizedStop).map((m) => m.member)
  }

  /**
   * Get sorted set cardinality
   */
  async zcard(namespace: string, key: string): Promise<number> {
    const response = await this.get<Array<{ member: string; score: number }>>(namespace, key)
    return response?.data?.length ?? 0
  }

  // Utility operations

  /**
   * Get all keys matching pattern
   */
  keys(namespace: string, pattern = '*'): string[] {
    const ns = this.namespaces.get(namespace)
    if (!ns) return []

    const regex = this.patternToRegex(pattern)
    const keys: string[] = []
    const now = Date.now()

    for (const [key, entry] of ns.entries) {
      if (entry.expiresAt > now && regex.test(key)) {
        keys.push(key)
      }
    }

    return keys
  }

  /**
   * Flush namespace
   */
  flushdb(namespace: string): void {
    const ns = this.namespaces.get(namespace)
    if (ns) {
      for (const key of ns.entries.keys()) {
        this.removeLRU(namespace, key)
      }
      ns.entries.clear()
      ns.usedBytes = 0
      ns.hits = 0
      ns.misses = 0
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    let totalKeys = 0
    let usedMemory = 0
    const now = Date.now()

    for (const ns of this.namespaces.values()) {
      for (const entry of ns.entries.values()) {
        if (entry.expiresAt > now) {
          totalKeys++
          usedMemory += entry.sizeBytes
        }
      }
    }

    const totalRequests = this.totalHits + this.totalMisses

    return {
      totalKeys,
      usedMemoryBytes: usedMemory,
      maxMemoryBytes: this.config.maxMemoryMb * 1024 * 1024,
      hits: this.totalHits,
      misses: this.totalMisses,
      hitRate: totalRequests > 0 ? this.totalHits / totalRequests : 0,
      evictions: this.totalEvictions,
      expiredKeys: this.totalExpiredKeys,
      ipfsBackedKeys: this.ipfsBackedKeys,
      uptime: Date.now() - this.startTime,
    }
  }

  // Private methods

  private getOrCreateNamespace(namespace: string): NamespaceData {
    let ns = this.namespaces.get(namespace)
    if (!ns) {
      ns = {
        entries: new Map(),
        usedBytes: 0,
        hits: 0,
        misses: 0,
      }
      this.namespaces.set(namespace, ns)
    }
    return ns
  }

  private async backupToIPFS<T>(
    namespace: string,
    key: string,
    value: T,
    timestamp: number,
  ): Promise<void> {
    if (!this.config.ipfsApiUrl) return

    const dataStr = JSON.stringify(value)
    const blob = new Blob([dataStr], { type: 'application/json' })
    const formData = new FormData()
    formData.append('file', blob, `${namespace}/${key}.json`)

    const response = await fetch(`${this.config.ipfsApiUrl}/api/v0/add`, {
      method: 'POST',
      body: formData,
    }).catch(() => null)

    if (!response?.ok) return

    const data: unknown = await response.json()
    const cid = (data as { Hash?: string }).Hash
    if (!cid) return

    // Update entry with CID if timestamp matches
    const ns = this.namespaces.get(namespace)
    const entry = ns?.entries.get(key)
    if (entry && entry.createdAt === timestamp) {
      entry.cid = cid
      this.ipfsBackedKeys++
    }
  }

  private async fetchFromIPFS<T>(cid: string): Promise<T> {
    const response = await fetch(`${this.config.ipfsGatewayUrl}/ipfs/${cid}`)
    if (!response.ok) {
      throw new CacheError(
        CacheErrorCode.IPFS_RETRIEVAL_FAILED,
        `Failed to fetch from IPFS: ${cid}`,
      )
    }
    return response.json() as Promise<T>
  }

  private getLRUKey(namespace: string, key: string): string {
    return `${namespace}:${key}`
  }

  private updateLRU(namespace: string, key: string): void {
    const lruKey = this.getLRUKey(namespace, key)
    let node = this.lruNodes.get(lruKey)

    if (node) {
      this.removeNodeFromList(node)
    } else {
      node = { key, namespace, prev: null, next: null }
      this.lruNodes.set(lruKey, node)
    }

    this.addToTail(node)
  }

  private removeLRU(namespace: string, key: string): void {
    const lruKey = this.getLRUKey(namespace, key)
    const node = this.lruNodes.get(lruKey)
    if (node) {
      this.removeNodeFromList(node)
      this.lruNodes.delete(lruKey)
    }
  }

  private addToTail(node: LRUNode): void {
    node.prev = this.lruTail
    node.next = null

    if (this.lruTail) {
      this.lruTail.next = node
    }
    this.lruTail = node

    if (!this.lruHead) {
      this.lruHead = node
    }
  }

  private removeNodeFromList(node: LRUNode): void {
    if (node.prev) {
      node.prev.next = node.next
    } else {
      this.lruHead = node.next
    }

    if (node.next) {
      node.next.prev = node.prev
    } else {
      this.lruTail = node.prev
    }
  }

  private evictLRU(): boolean {
    if (!this.lruHead) return false

    const node = this.lruHead
    const ns = this.namespaces.get(node.namespace)
    if (!ns) {
      this.removeNodeFromList(node)
      this.lruNodes.delete(this.getLRUKey(node.namespace, node.key))
      return true
    }

    const entry = ns.entries.get(node.key)
    if (entry) {
      ns.usedBytes -= entry.sizeBytes
      ns.entries.delete(node.key)
      this.totalEvictions++
    }

    this.removeNodeFromList(node)
    this.lruNodes.delete(this.getLRUKey(node.namespace, node.key))
    return true
  }

  private ensureMemoryLimit(): void {
    const maxBytes = this.config.maxMemoryMb * 1024 * 1024

    let totalBytes = 0
    for (const ns of this.namespaces.values()) {
      totalBytes += ns.usedBytes
    }

    while (totalBytes > maxBytes && this.evictLRU()) {
      totalBytes = 0
      for (const ns of this.namespaces.values()) {
        totalBytes += ns.usedBytes
      }
    }
  }

  private cleanupExpired(): void {
    const now = Date.now()

    for (const [namespace, ns] of this.namespaces) {
      const expiredKeys: string[] = []

      for (const [key, entry] of ns.entries) {
        if (entry.expiresAt < now) {
          expiredKeys.push(key)
        }
      }

      for (const key of expiredKeys) {
        const entry = ns.entries.get(key)
        if (entry) {
          ns.usedBytes -= entry.sizeBytes
          ns.entries.delete(key)
          this.removeLRU(namespace, key)
          this.totalExpiredKeys++
        }
      }
    }
  }

  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    return new RegExp(`^${escaped}$`)
  }
}

/**
 * Create a cache server with sensible defaults
 */
export function createCacheServer(config?: CacheServerConfig): CacheServer {
  return new CacheServer(config)
}

