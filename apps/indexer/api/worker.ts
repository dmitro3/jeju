/**
 * Indexer API Worker
 *
 * Blockchain indexer with REST APIs - workerd-compatible.
 * Queries SQLit for data storage.
 *
 * WARNING: This worker mode has limited functionality compared to the full indexer.
 * For full functionality including GraphQL, deploy the full indexer stack.
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { cors } from '@elysiajs/cors'
import {
  getCoreAppUrl,
  getCurrentNetwork,
  getLocalhostHost,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { config } from './config'
import { count, find, query } from './db'
import type { Block, RegisteredAgent, Transaction } from './db'

/**
 * Worker Environment Types
 */
export interface IndexerEnv {
  // Network configuration
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string

  // Database
  SQLIT_NODES: string
  SQLIT_DATABASE_ID: string

  // KV bindings (optional)
  INDEXER_CACHE?: KVNamespace
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

// Pagination schema for query parameters
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

/**
 * Create the Indexer Elysia app
 */
export function createIndexerApp(env?: Partial<IndexerEnv>) {
  const network = env?.NETWORK ?? getCurrentNetwork()

  // SECURITY: Don't allow wildcard CORS in production
  const allowedOrigins = [
    'https://indexer.jejunetwork.org',
    'https://indexer.testnet.jejunetwork.org',
    'https://jejunetwork.org',
    'https://gateway.testnet.jejunetwork.org',
    'https://gateway.jejunetwork.org',
    getCoreAppUrl('INDEXER_GRAPHQL'),
  ]

  // Only add localhost in development
  if (network === 'localnet') {
    allowedOrigins.push('http://localhost:4355', 'http://127.0.0.1:4355')
  }

  const app = new Elysia()
    .use(
      cors({
        origin: allowedOrigins,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-API-Key',
          'X-Jeju-Address',
        ],
        credentials: true,
      }),
    )

    // Health check
    .get('/health', () => ({
      status: 'ok',
      service: 'indexer-api',
      version: '2.0.0',
      network,
      runtime: 'workerd',
      mode: 'sqlit-read',
      endpoints: {
        rest: '/api',
        a2a: '/a2a',
        mcp: '/mcp',
      },
      note: 'Worker mode - GraphQL not available. Use full indexer for GraphQL.',
    }))

    // ============================================
    // GraphQL Endpoint - Not available in worker mode
    // ============================================
    .get('/graphql', () => {
      return new Response(
        JSON.stringify({
          error: 'GraphQL not available in worker mode',
          message: 'Use REST API at /api/* or deploy full indexer stack.',
          fullIndexerUrl: 'https://indexer.testnet.jejunetwork.org/graphql',
        }),
        {
          status: 501,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    })
    .get('/playground', () => {
      return Response.redirect(
        'https://indexer.testnet.jejunetwork.org/graphql',
        302,
      )
    })
    .post('/graphql', () => ({
      data: null,
      errors: [
        {
          message:
            'GraphQL not available in worker mode. Use REST API or full indexer.',
          extensions: {
            code: 'GRAPHQL_UNAVAILABLE',
            restApiEndpoint: '/api',
            fullIndexerUrl: 'https://indexer.testnet.jejunetwork.org/graphql',
          },
        },
      ],
    }))

    // ============================================
    // REST API Routes - Connected to SQLit
    // ============================================
    .group('/api', (api) =>
      api
        .get('/health', () => ({ status: 'ok' }))

        // Blocks - query from SQLit
        .get('/blocks', async ({ query: q }) => {
          const params = paginationSchema.parse(q)
          const blocks = await find<Block>('Block', {
            order: { number: 'DESC' },
            take: params.limit,
            skip: params.offset,
          })
          const total = await count('Block')
          return {
            blocks: blocks.map((b) => ({
              number: b.number,
              hash: b.hash,
              timestamp: b.timestamp,
              transactionCount: b.transactionCount,
            })),
            total,
          }
        })
        .get('/blocks/latest', async () => {
          const blocks = await find<Block>('Block', {
            order: { number: 'DESC' },
            take: 1,
          })
          return { block: blocks[0] ?? null }
        })
        .get('/blocks/:blockNumber', async ({ params }) => {
          const blockNum = parseInt(params.blockNumber, 10)
          if (Number.isNaN(blockNum) || blockNum < 0) {
            return { error: 'Invalid block number' }
          }
          const blocks = await find<Block>('Block', {
            where: { number: blockNum },
            take: 1,
          })
          return { block: blocks[0] ?? null }
        })

        // Transactions - query from SQLit
        .get('/transactions', async ({ query: q }) => {
          const params = paginationSchema.parse(q)
          const transactions = await find<Transaction>('Transaction', {
            order: { blockNumber: 'DESC' },
            take: params.limit,
            skip: params.offset,
          })
          const total = await count('Transaction')
          return {
            transactions: transactions.map((t) => ({
              hash: t.hash,
              blockNumber: t.blockNumber,
              from: t.fromAddress,
              to: t.toAddress,
              value: t.value,
              status: t.status,
            })),
            total,
          }
        })
        .get('/transactions/:hash', async ({ params }) => {
          if (!/^0x[a-fA-F0-9]{64}$/.test(params.hash)) {
            return { error: 'Invalid transaction hash' }
          }
          const transactions = await find<Transaction>('Transaction', {
            where: { hash: params.hash.toLowerCase() },
            take: 1,
          })
          return { transaction: transactions[0] ?? null }
        })

        // Agents - query from SQLit
        .get('/agents', async ({ query: q }) => {
          const params = paginationSchema.parse(q)
          const agents = await find<RegisteredAgent>('RegisteredAgent', {
            where: { active: true },
            order: { stakeAmount: 'DESC' },
            take: params.limit,
            skip: params.offset,
          })
          const total = await count('RegisteredAgent', { active: true })
          return {
            agents: agents.map((a) => ({
              agentId: a.agentId,
              name: a.name,
              active: a.active,
              stakeTier: a.stakeTier,
            })),
            total,
          }
        })

        // Stats - actual counts from SQLit
        .get('/stats', async () => {
          const [totalBlocks, totalTransactions, totalAgents] =
            await Promise.all([
              count('Block'),
              count('Transaction'),
              count('RegisteredAgent', { active: true }),
            ])
          const latestBlocks = await find<Block>('Block', {
            order: { number: 'DESC' },
            take: 1,
          })
          return {
            totalBlocks,
            totalTransactions,
            totalAgents,
            lastBlockTime: latestBlocks[0]?.timestamp ?? null,
          }
        }),
    )

    // ============================================
    // A2A Protocol
    // ============================================
    .group('/a2a', (a2a) =>
      a2a
        .get('/', () => ({
          name: 'Indexer',
          description: 'Blockchain Indexer with REST API (worker mode)',
          version: '2.0.0',
          protocol: 'a2a',
          capabilities: ['query', 'historical-data'],
          note: 'Worker mode - limited functionality. Use full indexer for streaming.',
        }))
        .post('/invoke', async ({ body }) => {
          const parsed = z
            .object({
              skill: z.string().max(100),
              params: z.record(z.string(), z.unknown()).optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid A2A request',
              message: parsed.error.issues.map((i) => i.message).join(', '),
            }
          }

          // Execute skills against SQLit
          const { skill, params } = parsed.data
          switch (skill) {
            case 'get-blocks': {
              const limit = Math.min(
                Number(params?.limit) || 10,
                100,
              )
              const blocks = await find<Block>('Block', {
                order: { number: 'DESC' },
                take: limit,
              })
              return { skill, result: blocks }
            }
            case 'get-agents': {
              const limit = Math.min(
                Number(params?.limit) || 10,
                100,
              )
              const agents = await find<RegisteredAgent>('RegisteredAgent', {
                where: { active: true },
                order: { stakeAmount: 'DESC' },
                take: limit,
              })
              return { skill, result: agents }
            }
            default:
              return {
                error: 'Unknown skill',
                availableSkills: ['get-blocks', 'get-agents'],
              }
          }
        }),
    )

    // ============================================
    // MCP Protocol
    // ============================================
    .group('/mcp', (mcp) =>
      mcp
        .get('/', () => ({
          name: 'Indexer MCP Server',
          version: '1.0.0',
          mode: 'worker',
          tools: [
            {
              name: 'indexer_query_blocks',
              description: 'Query recent blocks from SQLit',
              parameters: {
                type: 'object',
                properties: {
                  limit: { type: 'number', default: 10, maximum: 100 },
                  offset: { type: 'number', default: 0 },
                },
              },
            },
            {
              name: 'indexer_query_agents',
              description: 'Query registered agents from SQLit',
              parameters: {
                type: 'object',
                properties: {
                  limit: { type: 'number', default: 10, maximum: 100 },
                  active: { type: 'boolean', default: true },
                },
              },
            },
          ],
        }))
        .post('/invoke', async ({ body }) => {
          const parsed = z
            .object({
              tool: z.string().max(100),
              arguments: z.record(z.string(), z.unknown()).optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            return {
              error: 'Invalid MCP request',
              message: parsed.error.issues.map((i) => i.message).join(', '),
            }
          }

          const { tool, arguments: args } = parsed.data
          switch (tool) {
            case 'indexer_query_blocks': {
              const limit = Math.min(Number(args?.limit) || 10, 100)
              const offset = Math.max(Number(args?.offset) || 0, 0)
              const blocks = await find<Block>('Block', {
                order: { number: 'DESC' },
                take: limit,
                skip: offset,
              })
              return { tool, result: blocks }
            }
            case 'indexer_query_agents': {
              const limit = Math.min(Number(args?.limit) || 10, 100)
              const active = args?.active !== false
              const agents = await find<RegisteredAgent>('RegisteredAgent', {
                where: active ? { active: true } : undefined,
                order: { stakeAmount: 'DESC' },
                take: limit,
              })
              return { tool, result: agents }
            }
            default:
              return {
                error: 'Unknown tool',
                availableTools: ['indexer_query_blocks', 'indexer_query_agents'],
              }
          }
        }),
    )

  return app
}

/**
 * Default export for workerd
 */
const app = createIndexerApp()

export default {
  fetch: app.fetch,
}

/**
 * Bun server entry point (for local development)
 */
if (typeof Bun !== 'undefined') {
  const port = process.env.PORT ?? process.env.INDEXER_PORT ?? 4352
  const host = getLocalhostHost()

  console.log(`[Indexer Worker] Starting on http://${host}:${port}`)
  console.log(`[Indexer Worker] Network: ${getCurrentNetwork()}`)
  console.log('[Indexer Worker] Mode: SQLit-read (limited functionality)')
  console.log('[Indexer Worker] Note: GraphQL not available in worker mode')

  Bun.serve({
    port: Number(port),
    hostname: host,
    fetch: app.fetch,
  })
}
