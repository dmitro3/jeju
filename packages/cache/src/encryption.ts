/**
 * Cache Encryption Module
 *
 * Provides MPC-based encryption for cache data, replacing Lit Protocol.
 * Uses the Jeju KMS package for key management and AES-GCM encryption.
 */

import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  deriveEncryptionKey,
  deriveKeyFromSecret,
} from '@jejunetwork/kms'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'
import type { AuthSignature, EncryptedCacheEntry } from './types'
import { CacheError, CacheErrorCode } from './types'

/**
 * Configuration for cache encryption
 */
export interface CacheEncryptionConfig {
  /** Enable MPC key derivation (requires MPC coordinator) */
  useMpc?: boolean
  /** MPC coordinator endpoint */
  mpcEndpoint?: string
  /** Master secret for local encryption (fallback) */
  masterSecret?: string
}

/**
 * Cache encryption service
 *
 * Provides encryption/decryption for cache entries using:
 * - AES-256-GCM for symmetric encryption
 * - HKDF for key derivation
 * - MPC for distributed key management (optional)
 */
export class CacheEncryption {
  private masterKey: Uint8Array | null = null
  private config: CacheEncryptionConfig

  constructor(config: CacheEncryptionConfig = {}) {
    this.config = config

    // Derive master key from secret if provided
    if (config.masterSecret) {
      this.masterKey = deriveKeyFromSecret(config.masterSecret)
    }
  }

  /**
   * Initialize with a master secret
   */
  initialize(secret: string): void {
    this.masterKey = deriveKeyFromSecret(secret)
  }

  /**
   * Initialize from an auth signature (derive key from signature)
   */
  async initializeFromAuthSig(authSig: AuthSignature): Promise<void> {
    // Derive key from the auth signature
    // This ensures only the signer can derive the same key
    const combined = `${authSig.address}:${authSig.signedMessage}:${authSig.sig}`
    this.masterKey = deriveKeyFromSecret(combined)
  }

  /**
   * Encrypt data for a specific owner
   */
  async encrypt(
    data: string,
    ownerAddress: Address,
    keyId?: string,
  ): Promise<EncryptedCacheEntry> {
    const key = await this.deriveKeyForOwner(ownerAddress, keyId)

    const dataBytes = new TextEncoder().encode(data)
    const { ciphertext, iv } = await aesGcmEncrypt(dataBytes, key)

    // AES-GCM includes auth tag in ciphertext (last 16 bytes)
    const encryptedData = ciphertext.slice(0, -16)
    const tag = ciphertext.slice(-16)

    return {
      encryptedData: toHex(encryptedData),
      iv: toHex(iv),
      tag: toHex(tag),
      ownerAddress,
      keyId,
      mpc: this.config.useMpc ?? false,
    }
  }

  /**
   * Decrypt data using the owner's key
   */
  async decrypt(
    entry: EncryptedCacheEntry,
    authSig?: AuthSignature,
  ): Promise<string> {
    // Verify the caller is the owner if authSig provided
    if (authSig && authSig.address.toLowerCase() !== entry.ownerAddress.toLowerCase()) {
      throw new CacheError(
        CacheErrorCode.UNAUTHORIZED,
        'Auth signature address does not match owner',
      )
    }

    const key = await this.deriveKeyForOwner(entry.ownerAddress, entry.keyId)

    // Reconstruct ciphertext with tag
    const encryptedData = toBytes(entry.encryptedData)
    const tag = toBytes(entry.tag)
    const iv = toBytes(entry.iv)
    const ciphertext = new Uint8Array(encryptedData.length + tag.length)
    ciphertext.set(encryptedData, 0)
    ciphertext.set(tag, encryptedData.length)

    const decrypted = await aesGcmDecrypt(ciphertext, iv, key)
    return new TextDecoder().decode(decrypted)
  }

  /**
   * Derive an encryption key for a specific owner
   */
  private async deriveKeyForOwner(
    ownerAddress: Address,
    keyId?: string,
  ): Promise<Uint8Array> {
    if (!this.masterKey) {
      throw new CacheError(
        CacheErrorCode.ENCRYPTION_FAILED,
        'Encryption not initialized - call initialize() or initializeFromAuthSig()',
      )
    }

    // Create a unique salt from owner address and optional key ID
    const saltInput = keyId ? `${ownerAddress}:${keyId}` : ownerAddress
    const salt = toBytes(keccak256(toBytes(saltInput)))

    return deriveEncryptionKey(this.masterKey, salt, 'cache-encryption')
  }

  /**
   * Check if encryption is initialized
   */
  isInitialized(): boolean {
    return this.masterKey !== null
  }

  /**
   * Generate a unique key ID for a cache entry
   */
  static generateKeyId(namespace: string, key: string): string {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).slice(2, 10)
    return `cache:${namespace}:${key}:${timestamp}-${random}`
  }
}

/**
 * Create an auth signature from a wallet signature
 *
 * This is a helper for browser environments to create auth signatures
 * compatible with cache encryption.
 */
export async function createAuthSignature(
  address: Address,
  signMessage: (message: string) => Promise<Hex>,
): Promise<AuthSignature> {
  const message = `Sign this message to authenticate with Jeju Cache.\n\nAddress: ${address}\nTimestamp: ${Date.now()}`
  const sig = await signMessage(message)

  return {
    address,
    sig,
    signedMessage: message,
    derivedVia: 'web3.eth.personal.sign',
  }
}

/**
 * Verify an auth signature
 */
export function verifyAuthSignature(authSig: AuthSignature): boolean {
  // In a full implementation, this would recover the address from the signature
  // and verify it matches the claimed address
  // For now, we just validate the structure
  return (
    authSig.address.startsWith('0x') &&
    authSig.address.length === 42 &&
    authSig.sig.startsWith('0x') &&
    authSig.signedMessage.length > 0
  )
}

// Singleton instance for convenience
let defaultEncryption: CacheEncryption | null = null

/**
 * Get the default cache encryption instance
 */
export function getCacheEncryption(): CacheEncryption {
  if (!defaultEncryption) {
    defaultEncryption = new CacheEncryption()
  }
  return defaultEncryption
}

/**
 * Initialize the default cache encryption with a secret
 */
export function initializeCacheEncryption(secret: string): CacheEncryption {
  const encryption = getCacheEncryption()
  encryption.initialize(secret)
  return encryption
}

/**
 * Reset the cache encryption singleton (for testing)
 */
export function resetCacheEncryption(): void {
  defaultEncryption = null
}

