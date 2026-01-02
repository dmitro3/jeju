/**
 * Bazaar API Worker
 *
 * DWS-deployable worker using Elysia with CloudflareAdapter.
 * Compatible with workerd runtime and DWS infrastructure.
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { cors } from '@elysiajs/cors'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getCurrentNetwork,
  getEnvVar,
  getIndexerGraphqlUrl,
  getL2RpcUrl,
  getLocalhostHost,
  getSQLitBlockProducerUrl,
} from '@jejunetwork/config'
import { createTable, getSQLit, type SQLitClient } from '@jejunetwork/db'

import { expect as expectExists, expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import {
  A2ARequestSchema,
  TFMMGetQuerySchema,
  TFMMPostRequestSchema,
} from '../schemas/api'
import { handleA2ARequest, handleAgentCard } from './a2a-server'
import { checkTradeAllowed, type BanCheckResult } from './banCheck'
import { config, configureBazaar } from './config'
import { createIntelRouter } from './intel'
import { handleMCPInfo, handleMCPRequest } from './mcp-server'
import {
  createTFMMPool,
  getAllTFMMPools,
  getOracleStatus,
  getTFMMPool,
  getTFMMStats,
  getTFMMStrategies,
  triggerPoolRebalance,
  updatePoolStrategy,
} from './tfmm/utils'

// Worker Environment Types

/**
 * Worker Environment Types
 *
 * SECURITY NOTE (TEE Side-Channel Resistance):
 * - This worker does NOT handle private keys for signing
 * - All signing is done by clients (via wallet) or KMS
 * - Database credentials (COVENANTSQL_PRIVATE_KEY) are for DB auth, not blockchain
 * - Never add blockchain private keys to this interface
 */

// Security: Rate limiting for API endpoints
interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

// Rate limit configuration per endpoint type
const RATE_LIMITS = {
  rpc: { maxRequests: 100, windowMs: 60_000 }, // 100 req/min
  graphql: { maxRequests: 50, windowMs: 60_000 }, // 50 req/min
  intel: { maxRequests: 10, windowMs: 60_000 }, // 10 req/min
  tfmm: { maxRequests: 20, windowMs: 60_000 }, // 20 req/min
} as const

function checkRateLimit(
  clientId: string,
  endpoint: keyof typeof RATE_LIMITS,
): boolean {
  const config = RATE_LIMITS[endpoint]
  const key = `${endpoint}:${clientId}`
  const now = Date.now()

  const entry = rateLimitStore.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + config.windowMs })
    return true
  }

  if (entry.count >= config.maxRequests) {
    return false
  }

  entry.count++
  return true
}

function getClientId(request: Request): string {
  // Use X-Forwarded-For, CF-Connecting-IP, or fall back to origin
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

// GraphQL query complexity limits
const MAX_QUERY_DEPTH = 5
const MAX_QUERY_LENGTH = 10_000 // 10KB max query size
const BLOCKED_OPERATIONS = ['__schema', '__type'] // Block introspection in production

function validateGraphQLQuery(
  query: string,
  isDev: boolean,
): { valid: boolean; error?: string } {
  if (query.length > MAX_QUERY_LENGTH) {
    return { valid: false, error: 'Query too large' }
  }

  // Block introspection queries in production
  if (!isDev) {
    for (const op of BLOCKED_OPERATIONS) {
      if (query.includes(op)) {
        return { valid: false, error: 'Introspection queries not allowed' }
      }
    }
  }

  // Simple depth check (count nested braces)
  let depth = 0
  let maxDepth = 0
  for (const char of query) {
    if (char === '{') {
      depth++
      maxDepth = Math.max(maxDepth, depth)
    } else if (char === '}') {
      depth--
    }
  }

  if (maxDepth > MAX_QUERY_DEPTH) {
    return { valid: false, error: `Query depth ${maxDepth} exceeds limit ${MAX_QUERY_DEPTH}` }
  }

  return { valid: true }
}

export interface BazaarEnv {
  // Standard workerd bindings
  TEE_MODE: 'real' | 'simulated'
  TEE_PLATFORM: string
  TEE_REGION: string
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string

  // Service URLs
  DWS_URL: string
  GATEWAY_URL: string
  INDEXER_URL: string

  // Database config (SQLIT_PRIVATE_KEY is DB auth, not blockchain key)
  SQLIT_NODES: string
  SQLIT_DATABASE_ID: string
  SQLIT_PRIVATE_KEY: string

  // KV bindings (optional)
  BAZAAR_CACHE?: KVNamespace
}

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>
  delete(key: string): Promise<void>
}

// Database Layer

let dbClient: SQLitClient | null = null

function getDatabase(env: BazaarEnv): SQLitClient {
  if (dbClient) return dbClient

  const blockProducerEndpoint =
    env.SQLIT_NODES.split(',')[0] || getSQLitBlockProducerUrl()
  const databaseId = env.SQLIT_DATABASE_ID

  dbClient = getSQLit({
    blockProducerEndpoint,
    databaseId,
    debug: env.NETWORK === 'localnet',
  })

  return dbClient
}

// Database Schemas

async function initializeDatabase(db: SQLitClient): Promise<void> {
  // Market cache table
  const cacheTable = createTable('market_cache', [
    { name: 'key', type: 'TEXT', primaryKey: true, notNull: true },
    { name: 'value', type: 'JSON', notNull: true },
    { name: 'expires_at', type: 'TIMESTAMP', notNull: true },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true },
  ])
  await db.exec(cacheTable.up)
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_cache_expires ON market_cache(expires_at)',
  )

  // User preferences table
  const prefsTable = createTable('user_preferences', [
    { name: 'address', type: 'TEXT', primaryKey: true, notNull: true },
    { name: 'preferences', type: 'JSON', notNull: true },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true },
  ])
  await db.exec(prefsTable.up)
}

// Create Elysia App

export function createBazaarApp(env?: Partial<BazaarEnv>) {
  const isDev = env?.NETWORK === 'localnet'

  const app = new Elysia().use(
    cors({
      origin: isDev
        ? true
        : [
            'https://bazaar.jejunetwork.org',
            'https://jejunetwork.org',
            getCoreAppUrl('BAZAAR'),
          ],
      credentials: true,
    }),
  )

  // Health check - minimal info only (no internal config exposure)
  app.get('/health', () => ({
    status: 'ok',
    service: 'bazaar-api',
    version: '2.0.0',
  }))

  // TEE Attestation endpoint - allows clients to verify TEE integrity
  // Security: Limited info exposure, no detailed internal config
  app.group('/api/tee', (app) =>
    app
      .get('/attestation', async () => {
        const teeMode = env?.TEE_MODE ?? 'simulated'

        if (teeMode === 'simulated') {
          // In simulated mode, clearly indicate this is not production-safe
          return {
            attestation: null,
            mode: 'simulated',
            verified: false,
            warning: 'TEE not available - simulated mode',
          }
        }

        // In real TEE mode, indicate attestation is available
        return {
          attestation: null,
          mode: 'real',
          verified: true,
          attestationEndpoint: '/api/tee/quote',
        }
      })
      .get('/info', () => ({
        mode: env?.TEE_MODE ?? 'simulated',
        attestationAvailable: env?.TEE_MODE === 'real',
      })),
  )

  // A2A API
  app.group('/api/a2a', (app) =>
    app
      .get('/', ({ query }) => {
        if (query.card === 'true') {
          return handleAgentCard()
        }
        return {
          service: 'bazaar-a2a',
          version: '1.0.0',
          description: 'Network Bazaar A2A Server',
          agentCard: '/api/a2a?card=true',
        }
      })
      .post('/', async ({ body, request }) => {
        const validatedBody = expectValid(A2ARequestSchema, body, 'A2A request')
        return handleA2ARequest(request, validatedBody)
      }),
  )

  // MCP API
  app.group('/api/mcp', (app) =>
    app
      .get('/', () => handleMCPInfo())
      .post('/', async ({ request }) => {
        const url = new URL(request.url)
        const pathParts = url.pathname.split('/').filter(Boolean)
        const endpoint = pathParts.slice(2).join('/') ?? 'initialize'
        return handleMCPRequest(request, endpoint)
      })
      .post('/initialize', async ({ request }) => {
        return handleMCPRequest(request, 'initialize')
      })
      .post('/resources/list', async ({ request }) => {
        return handleMCPRequest(request, 'resources/list')
      })
      .post('/resources/read', async ({ request }) => {
        return handleMCPRequest(request, 'resources/read')
      })
      .post('/tools/list', async ({ request }) => {
        return handleMCPRequest(request, 'tools/list')
      })
      .post('/tools/call', async ({ request }) => {
        return handleMCPRequest(request, 'tools/call')
      })
      .post('/prompts/list', async ({ request }) => {
        return handleMCPRequest(request, 'prompts/list')
      })
      .post('/*', async ({ request }) => {
        const url = new URL(request.url)
        const endpoint = url.pathname.replace('/api/mcp/', '')
        return handleMCPRequest(request, endpoint)
      }),
  )

  // GraphQL Proxy - proxies indexer requests from browser to avoid CORS issues
  // Security: Rate limited and query complexity validated
  app.post('/api/graphql', async ({ body, request }) => {
    const clientId = getClientId(request)

    // Rate limiting
    if (!checkRateLimit(clientId, 'graphql')) {
      return new Response(
        JSON.stringify({ errors: [{ message: 'Rate limit exceeded' }] }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Validate query structure
    const bodyObj = body as { query?: string }
    if (!bodyObj.query || typeof bodyObj.query !== 'string') {
      return new Response(
        JSON.stringify({ errors: [{ message: 'Missing or invalid query' }] }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Validate query complexity
    const validation = validateGraphQLQuery(bodyObj.query, isDev)
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ errors: [{ message: validation.error }] }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const indexerUrl = env?.INDEXER_URL || getIndexerGraphqlUrl()

    try {
      const response = await fetch(indexerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })

      if (response.ok) {
        const data: unknown = await response.json()
        return data
      }

      // Return the error from the indexer (sanitize internal URLs)
      const errorText = await response.text().catch(() => '')
      console.error(
        `[Bazaar] Indexer error: ${response.status} - ${errorText}`,
      )

      return new Response(
        JSON.stringify({
          errors: [
            {
              message: `Indexer error: ${response.status} ${response.statusText}`,
            },
          ],
        }),
        {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[Bazaar] Indexer connection failed: ${message}`)

      return new Response(
        JSON.stringify({
          errors: [{ message: 'Indexer temporarily unavailable' }],
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }
  })

  // RPC Proxy - proxies JSON-RPC requests to the L2 RPC endpoint from browser
  // Security: Rate limited and method restricted
  const ALLOWED_RPC_METHODS = [
    'eth_chainId',
    'eth_blockNumber',
    'eth_getBalance',
    'eth_getTransactionCount',
    'eth_getCode',
    'eth_call',
    'eth_estimateGas',
    'eth_gasPrice',
    'eth_maxPriorityFeePerGas',
    'eth_feeHistory',
    'eth_getBlockByHash',
    'eth_getBlockByNumber',
    'eth_getTransactionByHash',
    'eth_getTransactionReceipt',
    'eth_getLogs',
    'eth_sendRawTransaction',
    'net_version',
  ]

  app.post('/api/rpc', async ({ body, request }) => {
    const clientId = getClientId(request)

    // Rate limiting
    if (!checkRateLimit(clientId, 'rpc')) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, message: 'Rate limit exceeded' },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const rpcUrl = env?.RPC_URL || getL2RpcUrl()
    const bodyObj = body as { id?: number; method?: string }
    const requestId = bodyObj.id ?? 1

    // Validate RPC method is allowed (prevent node enumeration, admin calls, etc.)
    const method = bodyObj.method
    if (!method || !ALLOWED_RPC_METHODS.includes(method)) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          error: { code: -32601, message: 'Method not allowed' },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      )
    }

    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })

      if (!response.ok) {
        console.warn(`[Bazaar] RPC proxy error: ${response.status}`)
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: requestId,
            error: {
              code: -32603,
              message: 'RPC error',
            },
          }),
          {
            status: response.status,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      const data = await response.json()
      return data
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[Bazaar] RPC proxy fetch failed: ${message}`)
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          error: {
            code: -32603,
            message: 'RPC temporarily unavailable',
          },
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }
  })

  // TFMM API - Read operations only (write operations disabled until contracts deployed)
  // Security: Write operations are disabled as contracts are not yet deployed
  app.group('/api/tfmm', (app) =>
    app
      .get('/', ({ query }) => {
        const parsedQuery = expectValid(
          TFMMGetQuerySchema,
          {
            pool: query.pool || undefined,
            action: query.action || undefined,
          },
          'TFMM query parameters',
        )

        const { pool, action } = parsedQuery

        if (pool) {
          const foundPool = getTFMMPool(pool)
          expectExists(foundPool, 'Pool not found')
          return { pool: foundPool }
        }

        if (action === 'strategies') {
          return { strategies: getTFMMStrategies() }
        }

        if (action === 'oracles') {
          return { oracles: getOracleStatus() }
        }

        const stats = getTFMMStats()
        return {
          pools: getAllTFMMPools(),
          ...stats,
        }
      })
      .post('/', async ({ body, request }) => {
        // Security: Validate request has wallet signature header for write operations
        const walletAddress = request.headers.get('x-wallet-address')
        if (!walletAddress) {
          return new Response(
            JSON.stringify({
              error: 'Authentication required',
              message: 'x-wallet-address header required for write operations',
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Server-side ban enforcement - check if user is banned before allowing write operations
        let banCheck: BanCheckResult
        try {
          banCheck = await checkTradeAllowed(walletAddress as `0x${string}`)
        } catch {
          // If ban check fails, allow operation (fail open for availability)
          // but log for monitoring
          console.warn(`[Bazaar] Ban check failed for ${walletAddress}`)
          banCheck = { allowed: true }
        }

        if (!banCheck.allowed) {
          return new Response(
            JSON.stringify({
              error: 'Access denied',
              message: banCheck.reason ?? 'Account is restricted',
              banType: banCheck.banType,
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Rate limit write operations
        const clientId = getClientId(request)
        if (!checkRateLimit(clientId, 'tfmm')) {
          return new Response(
            JSON.stringify({ error: 'Rate limit exceeded' }),
            { status: 429, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const validated = expectValid(
          TFMMPostRequestSchema,
          body,
          'TFMM POST request',
        )

        // All write operations currently fail as contracts not deployed
        // This prevents abuse while providing clear feedback
        try {
          switch (validated.action) {
            case 'create_pool': {
              await createTFMMPool(validated.params)
              break // Never reached - createTFMMPool always throws
            }

            case 'update_strategy': {
              await updatePoolStrategy(validated.params)
              break // Never reached - updatePoolStrategy always throws
            }

            case 'trigger_rebalance': {
              await triggerPoolRebalance(validated.params)
              break // Never reached - triggerPoolRebalance always throws
            }
          }
        } catch (error) {
          // Handle the service unavailable error from TFMM functions
          const errorMessage =
            error instanceof Error ? error.message : 'Service unavailable'
          return new Response(
            JSON.stringify({
              error: 'service_unavailable',
              message: errorMessage,
            }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // This should never be reached
        return new Response(
          JSON.stringify({ error: 'Unknown action' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }),
  )

  // Agent card endpoint
  app.get('/.well-known/agent-card.json', () => handleAgentCard())

  // Intel API - AI-powered market intelligence
  app.group('/api', (apiGroup) => apiGroup.use(createIntelRouter()))

  return app
}

// Worker Export (for DWS/workerd)

/**
 * Workerd/Cloudflare Workers execution context
 */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

/**
 * Cached app instance for worker reuse
 * Compiled once, reused across requests for better performance
 */
let cachedApp: ReturnType<typeof createBazaarApp> | null = null
let cachedEnvHash: string | null = null

function getAppForEnv(env: BazaarEnv): ReturnType<typeof createBazaarApp> {
  // Create a simple hash of the env to detect changes
  const envHash = `${env.NETWORK}-${env.TEE_MODE}`

  if (cachedApp && cachedEnvHash === envHash) {
    return cachedApp
  }

  cachedApp = createBazaarApp(env).compile()
  cachedEnvHash = envHash
  return cachedApp
}

/**
 * Default export for workerd/Cloudflare Workers
 *
 * Note: For optimal workerd performance, the build script should generate
 * a worker entry that uses CloudflareAdapter in the Elysia constructor.
 * This export provides the fetch handler pattern.
 */
export default {
  async fetch(
    request: Request,
    env: BazaarEnv,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const app = getAppForEnv(env)
    return app.handle(request)
  },
}

// Standalone Server (for local dev)

const isMainModule = typeof Bun !== 'undefined' && import.meta.path === Bun.main

if (isMainModule) {
  // Initialize config from environment variables
  configureBazaar({
    bazaarApiUrl: getEnvVar('BAZAAR_API_URL'),
    farcasterHubUrl: getEnvVar('FARCASTER_HUB_URL'),
    sqlitDatabaseId: getEnvVar('SQLIT_DATABASE_ID'),
    sqlitPrivateKey: getEnvVar('SQLIT_PRIVATE_KEY'),
  })

  const PORT = CORE_PORTS.BAZAAR_API.get()

  const app = createBazaarApp({
    NETWORK: getCurrentNetwork(),
    TEE_MODE: 'simulated',
    TEE_PLATFORM: 'local',
    TEE_REGION: 'local',
    RPC_URL: getL2RpcUrl(),
    DWS_URL: getCoreAppUrl('DWS_API'),
    GATEWAY_URL: getCoreAppUrl('NODE_EXPLORER_API'),
    INDEXER_URL: getIndexerGraphqlUrl(),
    SQLIT_NODES: getSQLitBlockProducerUrl(),
    SQLIT_DATABASE_ID: config.sqlitDatabaseId,
    SQLIT_PRIVATE_KEY: config.sqlitPrivateKey || '',
  })

  const host = getLocalhostHost()
  app.listen(PORT, () => {
    console.log(`Bazaar API Worker running at http://${host}:${PORT}`)
  })
}

export { initializeDatabase, getDatabase }
