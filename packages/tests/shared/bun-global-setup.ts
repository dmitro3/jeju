/**
 * Bun Global Test Setup
 *
 * Uses `jeju dev --minimal` to start all infrastructure.
 * The jeju CLI handles:
 * - Localnet (L1 + L2)
 * - Docker services (SQLit, IPFS)
 * - Contract bootstrap
 *
 * Usage in bunfig.toml:
 *   preload = ["@jejunetwork/tests/bun-global-setup"]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CORE_PORTS,
  getDWSComputeUrl,
  getDWSUrl,
  getIpfsApiUrl,
  getLocalhostHost,
  getServiceUrl,
  getSQLitBlockProducerUrl,
  getStorageApiEndpoint,
  INFRA_PORTS,
} from '@jejunetwork/config'

import { execa } from 'execa'
import type { Subprocess } from 'bun'
import type { InfraStatus } from './schemas'
import {
  checkContractsDeployed,
  findJejuWorkspaceRoot,
  isRpcAvailable,
  isServiceAvailable,
} from './utils'

// Well-known dev deployer private key (Anvil default)
const DEPLOYER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// Infrastructure state
let jejuDevProcess: Subprocess | null = null
let setupComplete = false
let isExternalInfra = false

// Default ports - use standard Jeju ports
const L1_PORT = INFRA_PORTS.L1_RPC.get()
const L2_PORT = INFRA_PORTS.L2_RPC.get()

// Docker service ports
const DOCKER_SERVICES = {
  sqlit: {
    port: INFRA_PORTS.SQLit.get(),
    healthPath: '/v1/status',
    name: 'SQLit',
  },
  ipfs: {
    port: CORE_PORTS.IPFS_API.DEFAULT,
    healthPath: '/api/v0/id',
    name: 'IPFS',
  },
} as const

// Environment URLs - use network-aware config for localnet
const DWS_URL = getDWSUrl('localnet')

async function checkDockerService(
  port: number,
  healthPath: string,
): Promise<boolean> {
  const host = getLocalhostHost()
  const url = `http://${host}:${port}${healthPath}`
  return isServiceAvailable(url, 3000)
}

async function checkDockerServices(): Promise<{ [key: string]: boolean }> {
  const results: { [key: string]: boolean } = {}

  await Promise.all(
    Object.entries(DOCKER_SERVICES).map(async ([key, config]) => {
      results[key] = await checkDockerService(config.port, config.healthPath)
    }),
  )

  return results
}

async function checkInfrastructure(): Promise<InfraStatus> {
  const host = getLocalhostHost()
  const l1RpcUrl = `http://${host}:${L1_PORT}`
  const l2RpcUrl = `http://${host}:${L2_PORT}`

  const [_l1Rpc, l2Rpc, dws, docker] = await Promise.all([
    isRpcAvailable(l1RpcUrl),
    isRpcAvailable(l2RpcUrl),
    isServiceAvailable(`${DWS_URL}/health`, 2000),
    checkDockerServices(),
  ])

  // L2 is required, L1 is optional
  const rpc = l2Rpc

  return { rpc, dws, docker, rpcUrl: l2RpcUrl, dwsUrl: DWS_URL }
}

async function startJejuDev(rootDir: string): Promise<boolean> {
  console.log('🚀 Starting jeju dev --minimal...')

  // Find the CLI
  const cliPath = join(rootDir, 'packages', 'cli', 'src', 'index.ts')
  if (!existsSync(cliPath)) {
    console.error('❌ Jeju CLI not found at:', cliPath)
    return false
  }

  // Start jeju dev --minimal (localnet + infrastructure, no apps)
  // Use detached mode so it survives the test process
  jejuDevProcess = Bun.spawn(['bun', 'run', cliPath, 'dev', '--minimal'], {
    cwd: rootDir,
    stdout: 'pipe', // Don't inherit to avoid cluttering test output
    stderr: 'pipe',
    env: {
      ...process.env,
      FORCE_COLOR: '0', // Disable colors in piped output
    },
  })

  // Wait for infrastructure to be ready
  const host = getLocalhostHost()
  const l2RpcUrl = `http://${host}:${L2_PORT}`

  console.log(`  Waiting for localnet on ${l2RpcUrl}...`)

  for (let i = 0; i < 120; i++) {
    if (await isRpcAvailable(l2RpcUrl)) {
      console.log('  ✅ Localnet ready')

      // Wait for contracts to be deployed (jeju dev should handle this)
      console.log('  Waiting for contracts...')
      for (let j = 0; j < 60; j++) {
        if (await checkContractsDeployed(l2RpcUrl)) {
          console.log('  ✅ Contracts deployed')
          return true
        }
        await Bun.sleep(1000)
      }
      console.log('  ⚠️  Contracts not deployed after 60s, will deploy now...')

      // Deploy contracts ourselves if jeju dev didn't do it
      const deployed = await deployContractsIfNeeded(rootDir, l2RpcUrl)
      if (deployed) {
        console.log('  ✅ Contracts deployed')
        return true
      }

      console.error('❌ Failed to deploy contracts')
      return false
    }
    await Bun.sleep(1000)
  }

  console.error('❌ Localnet failed to start within 120 seconds')
  console.error('   Try running manually: bun run jeju dev --minimal')
  return false
}

async function stopProcess(proc: Subprocess | null): Promise<void> {
  if (!proc) return

  try {
    proc.kill('SIGTERM')
    await proc.exited
  } catch {
    // Process may already be dead
  }
}

/**
 * Deploy contracts if they aren't already deployed
 */
async function deployContractsIfNeeded(
  rootDir: string,
  rpcUrl: string,
): Promise<boolean> {
  // Check if already deployed
  if (await checkContractsDeployed(rpcUrl)) {
    return true
  }

  const bootstrapFile = join(
    rootDir,
    'packages/contracts/deployments/localnet-complete.json',
  )
  const bootstrapScript = join(
    rootDir,
    'packages/deployment/scripts/bootstrap-localnet-complete.ts',
  )

  // If bootstrap file exists with valid contracts, they should be deployed
  if (existsSync(bootstrapFile)) {
    const data = JSON.parse(readFileSync(bootstrapFile, 'utf-8'))
    const contracts = data?.contracts ?? {}
    const hasValidContracts =
      contracts.jnsRegistry &&
      contracts.jnsRegistry !== '0x0000000000000000000000000000000000000000'

    if (hasValidContracts) {
      // Contract file exists but not on chain - chain may have been reset
      console.log('  Contract file exists but chain reset detected, redeploying...')
    }
  }

  // Run bootstrap script
  if (!existsSync(bootstrapScript)) {
    console.error(`Bootstrap script not found: ${bootstrapScript}`)
    return false
  }

  try {
    console.log('  Running bootstrap script...')
    await execa('bun', ['run', bootstrapScript], {
      cwd: rootDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        JEJU_RPC_URL: rpcUrl,
        L2_RPC_URL: rpcUrl,
        DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY,
      },
      timeout: 300000, // 5 minute timeout
    })

    // Verify deployment
    return await checkContractsDeployed(rpcUrl)
  } catch (error) {
    console.error('Contract deployment failed:', error)
    return false
  }
}

/**
 * Get the identity registry address from deployment file
 */
function getDeployedIdentityRegistry(rootDir: string): string | null {
  const bootstrapFile = join(
    rootDir,
    'packages/contracts/deployments/localnet-complete.json',
  )
  if (!existsSync(bootstrapFile)) return null
  try {
    const data = JSON.parse(readFileSync(bootstrapFile, 'utf-8'))
    const addr = data?.contracts?.identityRegistry
    if (addr && addr !== '0x0000000000000000000000000000000000000000') {
      return addr
    }
  } catch {
    // File parsing error
  }
  return null
}

/**
 * Wait for contracts to be deployed, or deploy them
 */
async function ensureContractsDeployed(
  rootDir: string,
  rpcUrl: string,
): Promise<boolean> {
  // Get the actual deployed address to check
  const identityRegistry = getDeployedIdentityRegistry(rootDir)
  
  // First check if already deployed using actual address
  if (identityRegistry && await checkContractsDeployed(rpcUrl, identityRegistry)) {
    return true
  }
  // Also check the default address
  if (await checkContractsDeployed(rpcUrl)) {
    return true
  }

  // Wait a bit for jeju dev to deploy them
  console.log('Waiting for contracts to be deployed...')
  for (let i = 0; i < 30; i++) {
    const addr = getDeployedIdentityRegistry(rootDir)
    if (addr && await checkContractsDeployed(rpcUrl, addr)) {
      return true
    }
    if (await checkContractsDeployed(rpcUrl)) {
      return true
    }
    await Bun.sleep(1000)
  }

  // Deploy ourselves
  console.log('Contracts not deployed, deploying now...')
  return await deployContractsIfNeeded(rootDir, rpcUrl)
}

/**
 * Setup test infrastructure
 * Uses jeju CLI to start everything
 */
export async function setup(): Promise<void> {
  if (setupComplete) return

  console.log(
    '\n╔══════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                    Jeju Test Setup                           ║',
  )
  console.log(
    '╚══════════════════════════════════════════════════════════════╝\n',
  )

  const rootDir = findJejuWorkspaceRoot()
  console.log(`Monorepo root: ${rootDir}`)

  // Check if infrastructure already running
  let status = await checkInfrastructure()

  if (status.rpc) {
    console.log('✅ Localnet already running (from jeju dev)')
    isExternalInfra = true
  } else {
    console.log('⚠️  Localnet not running')
    console.log('')
    console.log('Please start infrastructure first:')
    console.log('  bun run jeju dev --minimal')
    console.log('')
    console.log('Or use the jeju CLI to run tests:')
    console.log('  bun run jeju test --mode integration')
    console.log('')

    // Try to start jeju dev --minimal in the background
    console.log('Attempting to start jeju dev --minimal...')
    const started = await startJejuDev(rootDir)
    if (!started) {
      console.error('')
      console.error(
        '╔══════════════════════════════════════════════════════════════╗',
      )
      console.error(
        '║  ❌ TESTS CANNOT RUN: Jeju CLI infrastructure required       ║',
      )
      console.error(
        '╠══════════════════════════════════════════════════════════════╣',
      )
      console.error(
        '║  Please start the infrastructure first:                      ║',
      )
      console.error(
        '║                                                              ║',
      )
      console.error(
        '║    bun run jeju dev --minimal                                ║',
      )
      console.error(
        '║                                                              ║',
      )
      console.error(
        '║  Or run tests through the CLI:                               ║',
      )
      console.error(
        '║                                                              ║',
      )
      console.error(
        '║    bun run jeju test --mode integration                      ║',
      )
      console.error(
        '╚══════════════════════════════════════════════════════════════╝',
      )
      console.error('')
      throw new Error(
        'Jeju CLI infrastructure required. Run: bun run jeju dev --minimal',
      )
    }
  }

  // Re-check and set environment variables
  status = await checkInfrastructure()

  // Final check - infrastructure MUST be running
  if (!status.rpc) {
    console.error('')
    console.error(
      '╔══════════════════════════════════════════════════════════════╗',
    )
    console.error(
      '║  ❌ TESTS CANNOT RUN: Localnet RPC not available             ║',
    )
    console.error(
      '╠══════════════════════════════════════════════════════════════╣',
    )
    console.error(
      '║  The Jeju CLI infrastructure is required to run tests.       ║',
    )
    console.error(
      '║                                                              ║',
    )
    console.error(
      '║  Start with: bun run jeju dev --minimal                      ║',
    )
    console.error(
      '╚══════════════════════════════════════════════════════════════╝',
    )
    console.error('')
    throw new Error(
      'Localnet RPC not available. Run: bun run jeju dev --minimal',
    )
  }

  // Contracts MUST be deployed - enforce this
  const contractsReady = await ensureContractsDeployed(rootDir, status.rpcUrl)
  if (!contractsReady) {
    console.error('')
    console.error(
      '╔══════════════════════════════════════════════════════════════╗',
    )
    console.error(
      '║  ❌ TESTS CANNOT RUN: Contracts not deployed                 ║',
    )
    console.error(
      '╠══════════════════════════════════════════════════════════════╣',
    )
    console.error(
      '║  Contracts are required for tests to run.                    ║',
    )
    console.error(
      '║                                                              ║',
    )
    console.error(
      '║  Start with: bun run jeju dev                                ║',
    )
    console.error(
      '║  Or deploy:  bun run packages/deployment/scripts/bootstrap-localnet-complete.ts ║',
    )
    console.error(
      '╚══════════════════════════════════════════════════════════════╝',
    )
    console.error('')
    throw new Error(
      'Contracts not deployed. Run: bun run jeju dev',
    )
  }
  console.log('✅ Contracts deployed and verified')

  setEnvVars(status)

  // Create test output directory
  const outputDir = join(process.cwd(), 'test-results')
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  // Write setup info
  writeFileSync(
    join(outputDir, 'setup.json'),
    JSON.stringify(
      {
        rpcUrl: status.rpcUrl,
        dwsUrl: status.dwsUrl,
        docker: status.docker,
        startTime: new Date().toISOString(),
        external: isExternalInfra,
      },
      null,
      2,
    ),
  )

  setupComplete = true
  console.log('\n=== Setup Complete ===\n')
}

function setEnvVars(status: InfraStatus): void {
  const host = getLocalhostHost()

  // Set RPC URLs for child processes
  process.env.L1_RPC_URL = `http://${host}:${L1_PORT}`
  process.env.L2_RPC_URL = status.rpcUrl
  process.env.JEJU_RPC_URL = status.rpcUrl
  process.env.JEJU_L1_RPC_URL = `http://${host}:${L1_PORT}`
  process.env.DWS_URL = status.dwsUrl

  // Use config helpers for service URLs
  process.env.STORAGE_API_URL =
    getStorageApiEndpoint() || `${status.dwsUrl}/storage`
  process.env.COMPUTE_MARKETPLACE_URL =
    getDWSComputeUrl() ||
    getServiceUrl('compute', 'marketplace') ||
    `${status.dwsUrl}/compute`
  process.env.IPFS_GATEWAY =
    getServiceUrl('storage', 'ipfsGateway') || `${status.dwsUrl}/cdn`
  process.env.CDN_URL = `${status.dwsUrl}/cdn`

  // Docker service URLs - use config helpers
  const sqlitUrl = getSQLitBlockProducerUrl()
  process.env.SQLIT_URL = sqlitUrl
  process.env.SQLIT_BLOCK_PRODUCER_ENDPOINT = sqlitUrl
  process.env.IPFS_API_URL = getIpfsApiUrl() || `http://${host}:5001`
}

/**
 * Teardown test infrastructure
 */
export async function teardown(): Promise<void> {
  if (!setupComplete) return

  // Don't stop externally managed infrastructure
  if (isExternalInfra) {
    console.log('Skipping teardown (external infrastructure)')
    return
  }

  console.log('\n=== Test Teardown ===\n')

  // Stop jeju dev process (it will clean up its children)
  await stopProcess(jejuDevProcess)
  jejuDevProcess = null

  setupComplete = false
  console.log('Teardown complete')
}

/**
 * Get current infrastructure status
 */
export async function getStatus(): Promise<InfraStatus> {
  return checkInfrastructure()
}

/**
 * Check if setup has been run
 */
export function isReady(): boolean {
  return setupComplete
}

// Handle process exit
process.on('beforeExit', async () => {
  await teardown()
})

process.on('SIGINT', async () => {
  await teardown()
  process.exit(130)
})

process.on('SIGTERM', async () => {
  await teardown()
  process.exit(143)
})

// Auto-run setup when imported as preload
// Always run setup - the bunfig.toml preload ensures this only runs for tests
await setup()

export default { setup, teardown, getStatus, isReady }
