/**
 * Crucible API Worker
 *
 * Agent orchestration platform - workerd-compatible API worker.
 * Handles agent registration, rooms, triggers, and execution.
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { cors } from '@elysiajs/cors'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getCurrentNetwork,
  getLocalhostHost,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { characters, getCharacter, listCharacters } from './characters'

/**
 * Worker Environment Types
 */
export interface CrucibleEnv {
  // Network configuration
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string

  // Service URLs
  DWS_URL: string
  KMS_URL: string
  INDEXER_URL: string

  // Database
  SQLIT_NODES: string
  SQLIT_DATABASE_ID: string

  // KV bindings (optional)
  CRUCIBLE_CACHE?: KVNamespace
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

/**
 * Create the Crucible Elysia app
 */
export function createCrucibleApp(env?: Partial<CrucibleEnv>) {
  const network = env?.NETWORK ?? getCurrentNetwork()
  const isDev = network === 'localnet'

  const app = new Elysia()
    .use(
      cors({
        origin: isDev
          ? true
          : [
              'https://crucible.jejunetwork.org',
              'https://crucible.testnet.jejunetwork.org',
              'https://jejunetwork.org',
              getCoreAppUrl('CRUCIBLE_API'),
            ],
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-API-Key',
          'X-Jeju-Address',
          'X-Jeju-Signature',
          'X-Jeju-Timestamp',
        ],
        credentials: true,
      }),
    )

    // Root info endpoint
    .get('/', () => ({
      service: 'crucible',
      version: '1.0.0',
      description: 'Decentralized agent orchestration platform',
      docs: '/api/v1',
      endpoints: {
        health: '/health',
        info: '/info',
        characters: '/api/v1/characters',
        chat: '/api/v1/chat/:characterId',
        agents: '/api/v1/agents',
        rooms: '/api/v1/rooms',
      },
    }))

    // Health check - matches server.ts format for frontend compatibility
    .get('/health', () => ({
      status: 'healthy',
      service: 'crucible',
      network,
      timestamp: new Date().toISOString(),
    }))

    // Info endpoint
    .get('/info', () => ({
      service: 'crucible',
      version: '1.0.0',
      network,
      hasSigner: false,
      dwsAvailable: true,
      runtimes: Object.keys(characters).length,
    }))

    // ============================================
    // Character Templates API
    // ============================================
    .get('/api/v1/characters', () => {
      const characterList = listCharacters()
        .map((id) => {
          const char = getCharacter(id)
          return char
            ? { id: char.id, name: char.name, description: char.description }
            : null
        })
        .filter(Boolean)
      return { characters: characterList }
    })

    .get('/api/v1/characters/:id', ({ params }) => {
      const id = params.id
      const character = getCharacter(id)
      if (!character) {
        return { error: `Character not found: ${id}` }
      }
      return { character }
    })

    // Chat characters (with runtime status)
    .get('/api/v1/chat/characters', () => {
      const characterList = listCharacters().map((id) => {
        const char = getCharacter(id)
        return {
          id,
          name: char?.name ?? id,
          description: char?.description ?? '',
          hasRuntime: true, // In worker mode, all characters are available
        }
      })
      return { characters: characterList }
    })

    // ============================================
    // Agent Routes
    // ============================================
    .group('/api/v1/agents', (agents) =>
      agents
        .get('/', () => ({ agents: [], message: 'List registered agents' }))
        .get('/:agentId', ({ params }) => ({
          agentId: params.agentId,
          message: 'Agent details',
        }))
        .post('/', async ({ body }) => {
          const parsed = z
            .object({
              name: z.string().optional(),
              character: z.object({
                id: z.string(),
                name: z.string(),
                description: z.string(),
                system: z.string(),
                bio: z.array(z.string()),
                messageExamples: z.array(z.array(z.unknown())),
                topics: z.array(z.string()),
                adjectives: z.array(z.string()),
                style: z.object({
                  all: z.array(z.string()),
                  chat: z.array(z.string()),
                  post: z.array(z.string()),
                }),
              }),
              initialFunding: z.string().optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            return { error: 'Invalid agent data', details: parsed.error.issues }
          }

          // In worker mode, we return a simulated response
          // Full registration requires the main server with KMS
          return {
            agentId: crypto.randomUUID(),
            vaultAddress: '0x0000000000000000000000000000000000000000',
            characterCid: 'pending',
            stateCid: 'pending',
          }
        })
        .get('/:agentId/balance', () => ({
          balance: '0',
        }))
        .post('/:agentId/fund', () => ({
          txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        })),
    )

    // ============================================
    // Search API
    // ============================================
    .get('/api/v1/search/agents', () => {
      // Return empty results in worker mode
      return {
        agents: [],
        total: 0,
        hasMore: false,
      }
    })

    // ============================================
    // Room Routes
    // ============================================
    .group('/api/v1/rooms', (rooms) =>
      rooms
        .get('/', () => ({ rooms: [], message: 'List agent rooms' }))
        .get('/:roomId', ({ params }) => ({
          roomId: params.roomId,
          message: 'Room details',
        }))
        .post('/', async ({ body }) => {
          const parsed = z
            .object({
              name: z.string(),
              description: z.string().optional(),
              roomType: z.enum(['collaboration', 'adversarial', 'debate', 'council']),
              config: z.object({
                maxMembers: z.number().optional(),
                turnBased: z.boolean().optional(),
                turnTimeout: z.number().optional(),
              }).optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            return { error: 'Invalid room data', details: parsed.error.issues }
          }

          return { success: true, roomId: crypto.randomUUID(), stateCid: 'pending' }
        })
        .post('/:roomId/message', async ({ params, body }) => {
          const parsed = z.object({ content: z.string() }).safeParse(body)

          if (!parsed.success) {
            return { error: 'Invalid message' }
          }

          return { roomId: params.roomId, messageId: crypto.randomUUID() }
        }),
    )

    // ============================================
    // Chat API (simple echo in worker mode)
    // ============================================
    .post('/api/v1/chat/:characterId', async ({ params, body }) => {
      const characterId = params.characterId
      const character = getCharacter(characterId)

      if (!character) {
        return { error: `Character not found: ${characterId}` }
      }

      const parsed = z
        .object({
          text: z.string().optional(),
          message: z.string().optional(),
          userId: z.string().optional(),
          roomId: z.string().optional(),
        })
        .safeParse(body)

      if (!parsed.success) {
        return { error: 'Invalid chat request' }
      }

      const messageText = parsed.data.text ?? parsed.data.message ?? ''

      // In worker mode, return a placeholder response
      // Full chat requires the ElizaOS runtime from server.ts
      return {
        text: `[${character.name}] I'm running in worker mode. Full AI responses require the main server.`,
        action: null,
        actions: [],
        character: characterId,
      }
    })

    // ============================================
    // A2A Protocol
    // ============================================
    .group('/a2a', (a2a) =>
      a2a
        .get('/', () => ({
          name: 'Crucible',
          description: 'Agent Orchestration Platform',
          version: '1.0.0',
          protocol: 'a2a',
          capabilities: ['agents', 'rooms', 'triggers', 'execution'],
        }))
        .post('/invoke', async ({ body }) => {
          const parsed = z
            .object({
              skill: z.string(),
              params: z.record(z.string(), z.unknown()).optional(),
            })
            .safeParse(body)

          if (!parsed.success) {
            return { error: 'Invalid A2A request', details: parsed.error.issues }
          }

          return { skill: parsed.data.skill, result: 'Skill executed' }
        }),
    )

    // ============================================
    // MCP Protocol
    // ============================================
    .group('/mcp', (mcp) =>
      mcp
        .get('/', () => ({
          name: 'Crucible MCP Server',
          version: '1.0.0',
          tools: [
            {
              name: 'crucible_list_characters',
              description: 'List available character templates',
              parameters: { type: 'object', properties: {} },
            },
            {
              name: 'crucible_create_agent',
              description: 'Create a new agent',
              parameters: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  characterId: { type: 'string' },
                },
                required: ['characterId'],
              },
            },
            {
              name: 'crucible_chat',
              description: 'Chat with an agent',
              parameters: {
                type: 'object',
                properties: {
                  characterId: { type: 'string' },
                  message: { type: 'string' },
                },
                required: ['characterId', 'message'],
              },
            },
          ],
        }))
        .post('/invoke', async ({ body }) => {
          const parsed = z
            .object({
              tool: z.string(),
              arguments: z.record(z.string(), z.unknown()),
            })
            .safeParse(body)

          if (!parsed.success) {
            return { error: 'Invalid MCP request', details: parsed.error.issues }
          }

          return { tool: parsed.data.tool, result: 'Tool executed' }
        }),
    )

    // ============================================
    // Cron Routes (for scheduled tasks)
    // ============================================
    .group('/api/cron', (cron) =>
      cron
        .post('/agent-tick', () => ({
          status: 'executed',
          message: 'Agent tick processed',
          timestamp: new Date().toISOString(),
        }))
        .post('/flush-trajectories', () => ({
          status: 'executed',
          message: 'Trajectories flushed',
          timestamp: new Date().toISOString(),
        }))
        .post('/health-check', () => ({
          status: 'executed',
          message: 'Health check completed',
          timestamp: new Date().toISOString(),
        })),
    )

  return app
}

/**
 * Default export for workerd
 */
const app = createCrucibleApp()

export default {
  fetch: app.fetch,
}

/**
 * Bun server entry point (for local development)
 */
if (typeof Bun !== 'undefined' && Bun.main === import.meta.path) {
  const port = process.env.PORT ?? process.env.CRUCIBLE_PORT ?? CORE_PORTS.CRUCIBLE_API.DEFAULT
  const host = getLocalhostHost()

  console.log(`[Crucible Worker] Starting on http://${host}:${port}`)
  console.log(`[Crucible Worker] Network: ${getCurrentNetwork()}`)

  Bun.serve({
    port: Number(port),
    hostname: host,
    fetch: app.fetch,
  })
}
