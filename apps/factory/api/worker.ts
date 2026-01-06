/**
 * Factory API Worker
 *
 * DWS-deployable worker using Elysia with workerd compatibility.
 * Compatible with workerd runtime and DWS infrastructure.
 */

import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import {
  CORE_PORTS,
  getCurrentNetwork,
  getLocalhostHost,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { a2aRoutes } from './routes/a2a'
import { agentsRoutes } from './routes/agents'
import { bountiesRoutes } from './routes/bounties'
import { ciRoutes } from './routes/ci'
import { containersRoutes } from './routes/containers'
import { datasetsRoutes } from './routes/datasets'
import { discussionsRoutes } from './routes/discussions'
import { farcasterRoutes } from './routes/farcaster'
import { feedRoutes } from './routes/feed'
import { gitRoutes } from './routes/git'
import { healthRoutes } from './routes/health'
import { issuesRoutes } from './routes/issues'
import { jobsRoutes } from './routes/jobs'
import { leaderboardRoutes } from './routes/leaderboard'
import { mcpRoutes } from './routes/mcp'
import { messagesRoutes } from './routes/messages'
import { modelsRoutes } from './routes/models'
import { packageSettingsRoutes } from './routes/package-settings'
import { packagesRoutes } from './routes/packages'
import { projectsRoutes } from './routes/projects'
import { pullsRoutes } from './routes/pulls'
import { releasesRoutes } from './routes/releases'
import { repoSettingsRoutes } from './routes/repo-settings'

/**
 * Worker Environment Types
 */
export interface FactoryEnv {
  TEE_MODE: 'real' | 'simulated'
  TEE_PLATFORM: string
  TEE_REGION: string
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string
  DWS_URL: string
  GATEWAY_URL: string
  INDEXER_URL: string
  SQLIT_NODES: string
  SQLIT_DATABASE_ID: string
}

/**
 * Create the Factory Elysia app
 */
export function createFactoryApp(env?: Partial<FactoryEnv>) {
  const isDev = env?.NETWORK === 'localnet'
  const network = env?.NETWORK ?? getCurrentNetwork()

  const app = new Elysia()
    .use(
      cors({
        origin: isDev
          ? true
          : [
              'https://factory.jejunetwork.org',
              'https://factory.testnet.jejunetwork.org',
              'https://jejunetwork.org',
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
    .use(
      openapi({
        provider: 'swagger-ui',
        path: '/swagger',
        documentation: {
          info: {
            title: 'Factory API',
            version: '1.0.0',
            description:
              'Developer coordination hub - bounties, jobs, git, packages, containers, models',
          },
        },
      }),
    )

  // Health check
  app.get('/health', () => ({
    status: 'ok',
    service: 'factory-api',
    version: '1.0.0',
    teeMode: env?.TEE_MODE ?? 'simulated',
    teePlatform: env?.TEE_PLATFORM ?? 'dws',
    teeRegion: env?.TEE_REGION ?? 'global',
    network,
    endpoints: {
      a2a: '/a2a',
      mcp: '/mcp',
      bounties: '/api/bounties',
      jobs: '/api/jobs',
      git: '/api/git',
      packages: '/api/packages',
      containers: '/api/containers',
      models: '/api/models',
    },
  }))

  // Mount all routes
  app.use(healthRoutes)
  app.use(bountiesRoutes)
  app.use(gitRoutes)
  app.use(repoSettingsRoutes)
  app.use(packagesRoutes)
  app.use(packageSettingsRoutes)
  app.use(containersRoutes)
  app.use(modelsRoutes)
  app.use(datasetsRoutes)
  app.use(jobsRoutes)
  app.use(projectsRoutes)
  app.use(ciRoutes)
  app.use(agentsRoutes)
  app.use(farcasterRoutes)
  app.use(feedRoutes)
  app.use(messagesRoutes)
  app.use(discussionsRoutes)
  app.use(issuesRoutes)
  app.use(pullsRoutes)
  app.use(releasesRoutes)
  app.use(a2aRoutes)
  app.use(leaderboardRoutes)
  app.use(mcpRoutes)

  // Root route - API info
  app.get('/', () => ({
    name: 'Factory API',
    version: '1.0.0',
    description:
      'Developer coordination hub - bounties, jobs, git, packages, containers, models',
    runtime: 'workerd',
    network,
    endpoints: {
      a2a: '/a2a',
      mcp: '/mcp',
      bounties: '/api/bounties',
      jobs: '/api/jobs',
      git: '/api/git',
      packages: '/api/packages',
      containers: '/api/containers',
      models: '/api/models',
      datasets: '/api/datasets',
      projects: '/api/projects',
      feed: '/api/feed',
      health: '/health',
      swagger: '/swagger',
    },
  }))

  // Agent card endpoint
  app.get('/.well-known/agent-card.json', () => ({
    name: 'Factory',
    description:
      'Developer coordination hub for bounties, jobs, git, packages, containers, and AI models',
    version: '1.0.0',
    skills: [
      {
        id: 'list-bounties',
        name: 'List Bounties',
        description: 'List available bounties',
      },
      {
        id: 'create-bounty',
        name: 'Create Bounty',
        description: 'Create a new bounty',
      },
      {
        id: 'list-packages',
        name: 'List Packages',
        description: 'List packages in registry',
      },
      {
        id: 'list-models',
        name: 'List Models',
        description: 'List AI models',
      },
    ],
    endpoints: {
      a2a: '/a2a',
      mcp: '/mcp',
    },
  }))

  return app
}

// Worker Export (for DWS/workerd)

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

let cachedApp: ReturnType<typeof createFactoryApp> | null = null
let cachedEnvHash: string | null = null

function getAppForEnv(env: FactoryEnv): ReturnType<typeof createFactoryApp> {
  const envHash = `${env.NETWORK}-${env.TEE_MODE}`

  if (cachedApp && cachedEnvHash === envHash) {
    return cachedApp
  }

  cachedApp = createFactoryApp(env).compile()
  cachedEnvHash = envHash
  return cachedApp
}

/**
 * Default export for workerd/Cloudflare Workers
 */
export default {
  async fetch(
    request: Request,
    env: FactoryEnv,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const app = getAppForEnv(env)
    return app.handle(request)
  },
}

// Standalone Server (for local dev)

const isMainModule = typeof Bun !== 'undefined' && import.meta.path === Bun.main

if (isMainModule) {
  const PORT = CORE_PORTS.FACTORY.get()
  const network = getCurrentNetwork()

  const app = createFactoryApp({
    NETWORK: network,
    TEE_MODE: 'simulated',
    TEE_PLATFORM: 'local',
    TEE_REGION: 'local',
    RPC_URL: process.env.RPC_URL || '',
    DWS_URL: process.env.DWS_URL || '',
    GATEWAY_URL: process.env.GATEWAY_URL || '',
    INDEXER_URL: process.env.INDEXER_URL || '',
    SQLIT_NODES: process.env.SQLIT_NODES || '',
    SQLIT_DATABASE_ID: process.env.SQLIT_DATABASE_ID || 'factory',
  })

  const host = getLocalhostHost()
  app.listen(PORT, () => {
    console.log(`[Factory] Worker running at http://${host}:${PORT}`)
    console.log(`[Factory] Network: ${network}`)
  })
}
