/**
 * Gateway Backend Server
 *
 * Provides API routes for:
 * - Faucet (status, claim, info)
 * - Health checks
 * - Protocol stats
 */

import { cors } from '@elysiajs/cors'
import { getLocalhostHost } from '@jejunetwork/config'
import Elysia from 'elysia'
import { LRUCache } from 'lru-cache'
import { z } from 'zod'
import { config } from './config'
import {
  claimFromFaucet,
  getFaucetInfo,
  getFaucetStatus,
} from './services/faucet-service'

/**
 * SECURITY: Rate limiting for faucet endpoints to prevent abuse
 */
const rateLimitCache = new LRUCache<string, { count: number; resetAt: number }>({
  max: 50000,
  ttl: 60 * 60 * 1000, // 1 hour TTL
})

const FAUCET_RATE_LIMITS = {
  status: { requests: 30, windowMs: 60000 }, // 30 requests per minute
  claim: { requests: 5, windowMs: 3600000 }, // 5 claims per hour
}

function getClientIp(request: Request): string {
  // Only trust proxy headers in dev or when explicitly enabled
  if (!isProduction || process.env.TRUST_PROXY_HEADERS === 'true') {
    const realIp = request.headers.get('X-Real-IP')
    if (realIp) return realIp.trim()
    const forwarded = request.headers.get('X-Forwarded-For')
    if (forwarded) return forwarded.split(',')[0].trim()
  }
  return 'unknown'
}

function checkFaucetRateLimit(
  clientId: string,
  action: 'status' | 'claim'
): { allowed: boolean; remaining: number; resetAt: number } {
  const config = FAUCET_RATE_LIMITS[action]
  const now = Date.now()
  const key = `faucet:${action}:${clientId}`
  const state = rateLimitCache.get(key)

  if (!state || now > state.resetAt) {
    rateLimitCache.set(key, { count: 1, resetAt: now + config.windowMs })
    return { allowed: true, remaining: config.requests - 1, resetAt: now + config.windowMs }
  }

  if (state.count >= config.requests) {
    return { allowed: false, remaining: 0, resetAt: state.resetAt }
  }

  state.count++
  return { allowed: true, remaining: config.requests - state.count, resetAt: state.resetAt }
}

const PORT = config.gatewayApiPort

const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/)

// SECURITY: Strict CORS origins - block all cross-origin in production if not configured
const CORS_ORIGINS = config.corsOrigins
const isProduction = config.isProduction

/**
 * SECURITY: In production, if CORS_ORIGINS is empty, reject all cross-origin requests
 * rather than falling back to allowing all origins
 */
function getCorsOrigin(): boolean | string[] {
  if (!isProduction) {
    return true // Allow all in development
  }
  if (CORS_ORIGINS.length > 0) {
    return CORS_ORIGINS
  }
  // SECURITY: In production with no configured origins, return empty array
  // which effectively blocks cross-origin requests
  return []
}

const app = new Elysia()
  .use(
    cors({
      origin: getCorsOrigin(),
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
      maxAge: 86400,
    }),
  )
  .get('/health', () => ({ status: 'ok', service: 'gateway' }))

  // Faucet routes with rate limiting
  .get('/api/faucet/info', () => {
    return getFaucetInfo()
  })

  .get('/api/faucet/status/:address', async ({ params, request, set }) => {
    // SECURITY: Rate limit status checks
    const clientId = getClientIp(request)
    const rateLimit = checkFaucetRateLimit(clientId, 'status')
    set.headers['X-RateLimit-Remaining'] = String(rateLimit.remaining)
    set.headers['X-RateLimit-Reset'] = String(Math.ceil(rateLimit.resetAt / 1000))
    
    if (!rateLimit.allowed) {
      set.status = 429
      return { error: 'Rate limit exceeded', retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000) }
    }

    const parsed = AddressSchema.safeParse(params.address)
    if (!parsed.success) {
      set.status = 400
      return { error: 'Invalid address format' }
    }
    const status = await getFaucetStatus(parsed.data as `0x${string}`)
    return status
  })

  .post('/api/faucet/claim', async ({ body, request, set }) => {
    // SECURITY: Strict rate limit on claims to prevent abuse
    const clientId = getClientIp(request)
    const rateLimit = checkFaucetRateLimit(clientId, 'claim')
    set.headers['X-RateLimit-Remaining'] = String(rateLimit.remaining)
    set.headers['X-RateLimit-Reset'] = String(Math.ceil(rateLimit.resetAt / 1000))
    
    if (!rateLimit.allowed) {
      set.status = 429
      return { 
        success: false, 
        error: 'Rate limit exceeded - too many claims', 
        retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000) 
      }
    }

    const bodyParsed = z.object({ address: AddressSchema }).safeParse(body)
    if (!bodyParsed.success) {
      set.status = 400
      return { success: false, error: 'Invalid address format' }
    }
    const result = await claimFromFaucet(
      bodyParsed.data.address as `0x${string}`,
    )
    return result
  })

  .listen(PORT)

const host = getLocalhostHost()
console.log(`Gateway API server running at http://${host}:${PORT}`)

export type App = typeof app
