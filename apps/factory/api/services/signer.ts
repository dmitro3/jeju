import { getFarcasterHubUrl } from '@jejunetwork/config'
import { FarcasterPoster } from '@jejunetwork/messaging'
import { createLogger } from '@jejunetwork/shared'
import { ed25519 } from '@noble/curves/ed25519'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils'
import type { Address, Hex } from 'viem'
import { getFactoryConfig } from '../config'
import {
  activateSigner,
  createFarcasterSigner,
  type FarcasterSignerRow,
  getFarcasterSigner,
  listFarcasterSigners,
  updateSignerState,
} from '../db/client'

const log = createLogger('signer-service')

const HUB_URL = getFarcasterHubUrl()

/**
 * Get encryption key from config
 * SECURITY: No fallback - key MUST be configured
 */
function getEncryptionKey(): Uint8Array {
  const config = getFactoryConfig()
  if (!config.signerEncryptionKey) {
    throw new Error(
      'SIGNER_ENCRYPTION_KEY is required. Generate with: openssl rand -hex 32',
    )
  }
  const key = hexToBytes(config.signerEncryptionKey.replace('0x', ''))
  if (key.length !== 32) {
    throw new Error('SIGNER_ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
  }
  return key
}

/**
 * Encrypt signer private key using AES-256-GCM
 * SECURITY: Uses proper authenticated encryption
 */
function encryptPrivateKey(privateKey: Uint8Array): {
  encrypted: string
  iv: string
} {
  const key = getEncryptionKey()
  const iv = randomBytes(12) // 96-bit IV for GCM

  // Use Node.js crypto for AES-256-GCM
  const crypto = require('node:crypto')
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  const ciphertext = Buffer.concat([
    cipher.update(privateKey),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Concatenate ciphertext + authTag (16 bytes)
  const encrypted = Buffer.concat([ciphertext, authTag])

  return {
    encrypted: `0x${encrypted.toString('hex')}`,
    iv: `0x${bytesToHex(iv)}`,
  }
}

/**
 * Decrypt signer private key using AES-256-GCM
 * SECURITY: Uses proper authenticated decryption
 */
function decryptPrivateKey(encrypted: string, ivHex: string): Uint8Array {
  const key = getEncryptionKey()
  const iv = hexToBytes(ivHex.replace('0x', ''))
  const encryptedData = Buffer.from(encrypted.replace('0x', ''), 'hex')

  // Split ciphertext and authTag (last 16 bytes)
  const authTagLength = 16
  if (encryptedData.length < authTagLength) {
    throw new Error('Invalid encrypted data: too short')
  }

  const ciphertext = encryptedData.subarray(0, -authTagLength)
  const authTag = encryptedData.subarray(-authTagLength)

  // Use Node.js crypto for AES-256-GCM decryption
  const crypto = require('node:crypto')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return new Uint8Array(decrypted)
}

/**
 * Generated signer information
 */
export interface GeneratedSigner {
  publicKey: Hex
  privateKeyEncrypted: string
  encryptionIv: string
}

/**
 * Signer with poster instance
 */
export interface ActiveSigner {
  signer: FarcasterSignerRow
  poster: FarcasterPoster
}

/**
 * Generate a new Ed25519 signer key pair
 */
export function generateSignerKeys(): GeneratedSigner {
  const privateKey = ed25519.utils.randomPrivateKey()
  const publicKey = ed25519.getPublicKey(privateKey)

  const { encrypted, iv } = encryptPrivateKey(privateKey)

  return {
    publicKey: `0x${bytesToHex(publicKey)}` as Hex,
    privateKeyEncrypted: encrypted,
    encryptionIv: iv,
  }
}

/**
 * Create and store a new signer for a user
 */
export async function createSigner(
  address: Address,
  fid: number,
): Promise<FarcasterSignerRow> {
  const keys = generateSignerKeys()

  const signer = createFarcasterSigner({
    address,
    fid,
    signerPublicKey: keys.publicKey,
    encryptedPrivateKey: keys.privateKeyEncrypted,
    encryptionIv: keys.encryptionIv,
  })

  log.info('Created signer', {
    address,
    fid,
    publicKey: `${keys.publicKey.slice(0, 20)}...`,
  })

  return signer
}

/**
 * Get message to sign for signer registration
 */
export function getSignerRegistrationMessage(
  fid: number,
  signerPublicKey: Hex,
  deadline: number,
): string {
  return JSON.stringify({
    fid,
    signerPublicKey,
    deadline,
    message:
      'I authorize this signer key to post on my behalf on Farcaster via Factory',
  })
}

/**
 * Verify signature and activate signer
 */
export async function verifyAndActivateSigner(
  signerPublicKey: Hex,
  signature: Hex,
): Promise<boolean> {
  const success = activateSigner(signerPublicKey, signature)
  if (success) {
    log.info('Activated signer', {
      publicKey: `${signerPublicKey.slice(0, 20)}...`,
    })
  }
  return success
}

/**
 * Get active signer for a user
 */
export function getActiveSigner(address: Address): FarcasterSignerRow | null {
  return getFarcasterSigner(address)
}

/**
 * Get all signers for a user
 */
export function getUserSigners(address: Address): FarcasterSignerRow[] {
  return listFarcasterSigners(address)
}

/**
 * Create a poster instance from a stored signer
 */
export function createPosterFromSigner(
  signer: FarcasterSignerRow,
): FarcasterPoster {
  const privateKey = decryptPrivateKey(
    signer.encrypted_private_key,
    signer.encryption_iv,
  )

  return new FarcasterPoster({
    fid: signer.fid,
    signerPrivateKey: privateKey,
    hubUrl: HUB_URL,
  })
}

/**
 * Get active signer with poster instance
 */
export function getActiveSignerWithPoster(
  address: Address,
): ActiveSigner | null {
  const signer = getActiveSigner(address)
  if (!signer) return null

  const poster = createPosterFromSigner(signer)
  return { signer, poster }
}

/**
 * Revoke a signer
 */
export function revokeSigner(signerId: string): boolean {
  const success = updateSignerState(signerId, 'revoked')
  if (success) {
    log.info('Revoked signer', { signerId })
  }
  return success
}

/**
 * Check if a user has an active signer
 */
export function hasActiveSigner(address: Address): boolean {
  const signer = getActiveSigner(address)
  return signer !== null && signer.key_state === 'active'
}

/**
 * Get signer status for a user
 */
export interface SignerStatus {
  hasSigner: boolean
  isActive: boolean
  publicKey: Hex | null
  fid: number | null
  createdAt: number | null
}

export function getSignerStatus(address: Address): SignerStatus {
  const signer = getActiveSigner(address)

  if (!signer) {
    return {
      hasSigner: false,
      isActive: false,
      publicKey: null,
      fid: null,
      createdAt: null,
    }
  }

  return {
    hasSigner: true,
    isActive: signer.key_state === 'active',
    publicKey: signer.signer_public_key as Hex,
    fid: signer.fid,
    createdAt: signer.created_at,
  }
}

/**
 * Decode private key for signing (internal use only)
 * Returns the raw private key bytes for signing operations
 */
export function getSignerPrivateKey(signer: FarcasterSignerRow): Uint8Array {
  return decryptPrivateKey(signer.encrypted_private_key, signer.encryption_iv)
}

/**
 * Sign a message with a signer's private key
 */
export function signMessage(
  signer: FarcasterSignerRow,
  message: Uint8Array,
): Hex {
  const privateKey = getSignerPrivateKey(signer)
  const signature = ed25519.sign(message, privateKey)
  return `0x${bytesToHex(signature)}` as Hex
}
