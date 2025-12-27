/**
 * Cache Package Tests
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { CacheServer, createCacheServer } from './server'
import { CacheEncryption, initializeCacheEncryption, resetCacheEncryption } from './encryption'
import { CacheError, CacheErrorCode } from './types'
import type { Address } from 'viem'

describe('CacheServer', () => {
  let server: CacheServer

  beforeEach(() => {
    server = createCacheServer({
      maxMemoryMb: 10,
      defaultTtlSeconds: 60,
    })
  })

  afterEach(() => {
    server.stop()
  })

  describe('basic operations', () => {
    it('should set and get a value', async () => {
      const result = await server.set('default', 'key1', 'value1')
      expect(result.data).toBe('value1')
      expect(result.cid).toBe('pending')

      const retrieved = await server.get<string>('default', 'key1')
      expect(retrieved?.data).toBe('value1')
    })

    it('should set and get JSON objects', async () => {
      const obj = { name: 'test', count: 42 }
      await server.set('default', 'json1', obj)

      const retrieved = await server.get<{ name: string; count: number }>('default', 'json1')
      expect(retrieved?.data.name).toBe('test')
      expect(retrieved?.data.count).toBe(42)
    })

    it('should return null for non-existent key', async () => {
      const result = await server.get('default', 'nonexistent')
      expect(result).toBeNull()
    })

    it('should delete a key', async () => {
      await server.set('default', 'todelete', 'value')
      expect(server.exists('default', 'todelete')).toBe(1)

      const deleted = server.del('default', 'todelete')
      expect(deleted).toBe(1)
      expect(server.exists('default', 'todelete')).toBe(0)
    })

    it('should delete multiple keys', async () => {
      await server.set('default', 'key1', 'value1')
      await server.set('default', 'key2', 'value2')
      await server.set('default', 'key3', 'value3')

      const deleted = server.del('default', 'key1', 'key2', 'key3')
      expect(deleted).toBe(3)
    })
  })

  describe('TTL operations', () => {
    it('should return TTL for a key', async () => {
      await server.set('default', 'ttlkey', 'value', { ttl: 100 })
      const ttl = server.ttl('default', 'ttlkey')
      expect(ttl).toBeLessThanOrEqual(100)
      expect(ttl).toBeGreaterThan(95)
    })

    it('should return -2 for non-existent key', () => {
      const ttl = server.ttl('default', 'nonexistent')
      expect(ttl).toBe(-2)
    })

    it('should update TTL with expire', async () => {
      await server.set('default', 'expirekey', 'value', { ttl: 100 })
      const updated = server.expire('default', 'expirekey', 200)
      expect(updated).toBe(true)

      const ttl = server.ttl('default', 'expirekey')
      expect(ttl).toBeLessThanOrEqual(200)
      expect(ttl).toBeGreaterThan(195)
    })

    it('should expire keys after TTL', async () => {
      await server.set('default', 'shortttl', 'value', { ttl: 1 })
      expect(await server.get('default', 'shortttl')).not.toBeNull()

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100))

      expect(await server.get('default', 'shortttl')).toBeNull()
    })
  })

  describe('NX/XX flags', () => {
    it('should respect NX flag (only set if not exists)', async () => {
      await server.set('default', 'nxkey', 'original')

      await expect(
        server.set('default', 'nxkey', 'new', { nx: true })
      ).rejects.toThrow()

      const result = await server.get<string>('default', 'nxkey')
      expect(result?.data).toBe('original')
    })

    it('should respect XX flag (only set if exists)', async () => {
      await expect(
        server.set('default', 'xxkey', 'value', { xx: true })
      ).rejects.toThrow()

      await server.set('default', 'xxkey', 'original')
      await server.set('default', 'xxkey', 'updated', { xx: true })

      const result = await server.get<string>('default', 'xxkey')
      expect(result?.data).toBe('updated')
    })
  })

  describe('increment/decrement', () => {
    it('should increment a value', async () => {
      await server.set('default', 'counter', '10')
      const result = server.incr('default', 'counter', 5)
      expect(result).toBe(15)
    })

    it('should decrement a value', async () => {
      await server.set('default', 'counter', '10')
      const result = server.decr('default', 'counter', 3)
      expect(result).toBe(7)
    })

    it('should create key if not exists on incr', () => {
      const result = server.incr('default', 'newcounter', 1)
      expect(result).toBe(1)
    })
  })

  describe('hash operations', () => {
    it('should set and get hash fields', async () => {
      await server.hset('default', 'hash1', 'field1', 'value1')
      await server.hset('default', 'hash1', 'field2', 'value2')

      const field1 = await server.hget('default', 'hash1', 'field1')
      const field2 = await server.hget('default', 'hash1', 'field2')

      expect(field1).toBe('value1')
      expect(field2).toBe('value2')
    })

    it('should get all hash fields', async () => {
      await server.hset('default', 'hash2', 'a', '1')
      await server.hset('default', 'hash2', 'b', '2')
      await server.hset('default', 'hash2', 'c', '3')

      const all = await server.hgetall('default', 'hash2')
      expect(all).toEqual({ a: '1', b: '2', c: '3' })
    })
  })

  describe('list operations', () => {
    it('should push and pop from list', async () => {
      await server.lpush('default', 'list1', 'a', 'b', 'c')

      const left = await server.lpop('default', 'list1')
      expect(left).toBe('c')

      const right = await server.rpop('default', 'list1')
      expect(right).toBe('a')
    })

    it('should get list range', async () => {
      await server.rpush('default', 'list2', '1', '2', '3', '4', '5')

      const range = await server.lrange('default', 'list2', 1, 3)
      expect(range).toEqual(['2', '3', '4'])
    })

    it('should get list length', async () => {
      await server.rpush('default', 'list3', 'a', 'b', 'c')
      const len = await server.llen('default', 'list3')
      expect(len).toBe(3)
    })
  })

  describe('set operations', () => {
    it('should add and check members', async () => {
      await server.sadd('default', 'set1', 'a', 'b', 'c')

      expect(await server.sismember('default', 'set1', 'a')).toBe(true)
      expect(await server.sismember('default', 'set1', 'd')).toBe(false)
    })

    it('should get all members', async () => {
      await server.sadd('default', 'set2', 'x', 'y', 'z')

      const members = await server.smembers('default', 'set2')
      expect(members.sort()).toEqual(['x', 'y', 'z'])
    })

    it('should remove members', async () => {
      await server.sadd('default', 'set3', 'a', 'b', 'c')
      const removed = await server.srem('default', 'set3', 'b')
      expect(removed).toBe(1)

      const members = await server.smembers('default', 'set3')
      expect(members.sort()).toEqual(['a', 'c'])
    })

    it('should get cardinality', async () => {
      await server.sadd('default', 'set4', '1', '2', '3')
      const card = await server.scard('default', 'set4')
      expect(card).toBe(3)
    })
  })

  describe('sorted set operations', () => {
    it('should add members with scores', async () => {
      await server.zadd('default', 'zset1',
        { member: 'a', score: 1 },
        { member: 'b', score: 2 },
        { member: 'c', score: 3 }
      )

      const range = await server.zrange('default', 'zset1', 0, -1)
      expect(range).toEqual(['a', 'b', 'c'])
    })

    it('should maintain sorted order', async () => {
      await server.zadd('default', 'zset2',
        { member: 'c', score: 3 },
        { member: 'a', score: 1 },
        { member: 'b', score: 2 }
      )

      const range = await server.zrange('default', 'zset2', 0, -1)
      expect(range).toEqual(['a', 'b', 'c'])
    })

    it('should get cardinality', async () => {
      await server.zadd('default', 'zset3',
        { member: 'x', score: 1 },
        { member: 'y', score: 2 }
      )
      const card = await server.zcard('default', 'zset3')
      expect(card).toBe(2)
    })
  })

  describe('key pattern matching', () => {
    it('should find keys by pattern', async () => {
      await server.set('default', 'user:1', 'alice')
      await server.set('default', 'user:2', 'bob')
      await server.set('default', 'product:1', 'widget')

      const userKeys = server.keys('default', 'user:*')
      expect(userKeys.sort()).toEqual(['user:1', 'user:2'])

      const allKeys = server.keys('default', '*')
      expect(allKeys.length).toBe(3)
    })
  })

  describe('namespace isolation', () => {
    it('should isolate keys between namespaces', async () => {
      await server.set('ns1', 'key', 'value1')
      await server.set('ns2', 'key', 'value2')

      const result1 = await server.get<string>('ns1', 'key')
      const result2 = await server.get<string>('ns2', 'key')

      expect(result1?.data).toBe('value1')
      expect(result2?.data).toBe('value2')
    })

    it('should flush only one namespace', async () => {
      await server.set('ns1', 'key', 'value1')
      await server.set('ns2', 'key', 'value2')

      server.flushdb('ns1')

      expect(await server.get('ns1', 'key')).toBeNull()
      expect(await server.get<string>('ns2', 'key')).not.toBeNull()
    })
  })

  describe('statistics', () => {
    it('should track hits and misses', async () => {
      await server.set('default', 'statkey', 'value')

      await server.get('default', 'statkey')
      await server.get('default', 'statkey')
      await server.get('default', 'nonexistent')

      const stats = server.getStats()
      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(1)
      expect(stats.hitRate).toBeCloseTo(0.667, 1)
    })

    it('should track key count', async () => {
      await server.set('default', 'k1', 'v1')
      await server.set('default', 'k2', 'v2')
      await server.set('default', 'k3', 'v3')

      const stats = server.getStats()
      expect(stats.totalKeys).toBe(3)
    })
  })
})

describe('CacheEncryption', () => {
  beforeEach(() => {
    resetCacheEncryption()
  })

  it('should encrypt and decrypt data', async () => {
    const encryption = initializeCacheEncryption('test-secret-key')
    const ownerAddress = '0x1234567890123456789012345678901234567890' as Address
    const data = 'sensitive data'

    const encrypted = await encryption.encrypt(data, ownerAddress)

    expect(encrypted.encryptedData).toMatch(/^0x/)
    expect(encrypted.iv).toMatch(/^0x/)
    expect(encrypted.tag).toMatch(/^0x/)
    expect(encrypted.ownerAddress).toBe(ownerAddress)

    const decrypted = await encryption.decrypt(encrypted)
    expect(decrypted).toBe(data)
  })

  it('should encrypt and decrypt JSON', async () => {
    const encryption = initializeCacheEncryption('test-secret-key')
    const ownerAddress = '0x1234567890123456789012345678901234567890' as Address
    const data = { password: 'hunter2', secret: true }

    const encrypted = await encryption.encrypt(JSON.stringify(data), ownerAddress)
    const decrypted = JSON.parse(await encryption.decrypt(encrypted))

    expect(decrypted).toEqual(data)
  })

  it('should derive different keys for different owners', async () => {
    const encryption = initializeCacheEncryption('test-secret-key')
    const owner1 = '0x1111111111111111111111111111111111111111' as Address
    const owner2 = '0x2222222222222222222222222222222222222222' as Address
    const data = 'same data'

    const encrypted1 = await encryption.encrypt(data, owner1)
    const encrypted2 = await encryption.encrypt(data, owner2)

    // Same data, different owners = different ciphertext
    expect(encrypted1.encryptedData).not.toBe(encrypted2.encryptedData)
  })

  it('should throw if not initialized', async () => {
    const encryption = new CacheEncryption()
    const ownerAddress = '0x1234567890123456789012345678901234567890' as Address

    await expect(
      encryption.encrypt('data', ownerAddress)
    ).rejects.toThrow('Encryption not initialized')
  })

  it('should generate unique key IDs', () => {
    const id1 = CacheEncryption.generateKeyId('ns', 'key1')
    const id2 = CacheEncryption.generateKeyId('ns', 'key2')
    const id3 = CacheEncryption.generateKeyId('ns', 'key1')

    expect(id1).not.toBe(id2)
    expect(id1).not.toBe(id3) // Same key but different timestamp
  })
})

describe('CacheError', () => {
  it('should create error with code and message', () => {
    const error = new CacheError(
      CacheErrorCode.KEY_NOT_FOUND,
      'Key not found'
    )

    expect(error.code).toBe('KEY_NOT_FOUND')
    expect(error.message).toBe('Key not found')
    expect(error.name).toBe('CacheError')
  })

  it('should include details', () => {
    const error = new CacheError(
      CacheErrorCode.QUOTA_EXCEEDED,
      'Quota exceeded',
      { limit: 100, used: 150 }
    )

    expect(error.details).toEqual({ limit: 100, used: 150 })
  })
})

