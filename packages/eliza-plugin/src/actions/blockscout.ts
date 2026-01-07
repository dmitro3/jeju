/**
 * POLL_BLOCKSCOUT Action
 *
 * Discovers recently verified smart contracts on Base chain via Blockscout API.
 * Supports cursor-based pagination for continuous monitoring.
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { z } from 'zod'
import { fetchWithTimeout, isUrlSafeToFetch } from '../validation'

// Blockscout API base URL for Base chain
const BLOCKSCOUT_BASE_URL = 'https://base.blockscout.com'

// Schema for address object in Blockscout response
const blockscoutAddressSchema = z.object({
  hash: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  name: z.string().nullable(),
  is_verified: z.boolean().optional(),
  is_contract: z.boolean().optional(),
})

// Schema for individual contract item in list response
const blockscoutContractItemSchema = z.object({
  address: blockscoutAddressSchema,
  compiler_version: z.string().optional(),
  verified_at: z.string(),
  language: z.string().optional(),
  optimization_enabled: z.boolean().optional(),
  license_type: z.string().optional(),
})

// Schema for pagination params
const blockscoutNextPageParamsSchema = z
  .object({
    items_count: z.number(),
    smart_contract_id: z.number(),
  })
  .nullable()
  .optional()

// Schema for the full API response
const blockscoutContractsResponseSchema = z.object({
  items: z.array(blockscoutContractItemSchema),
  next_page_params: blockscoutNextPageParamsSchema,
})

// Type exports
export type BlockscoutContractItem = z.infer<typeof blockscoutContractItemSchema>
export type BlockscoutContractsResponse = z.infer<
  typeof blockscoutContractsResponseSchema
>

// Parsed contract info for output
export interface VerifiedContract {
  address: string
  name: string
  verifiedAt: string
  compilerVersion: string
  language: string
  blockscoutUrl: string
}

// Cursor for pagination
export interface BlockscoutCursor {
  itemsCount: number
  smartContractId: number
}

// Action result
export interface PollBlockscoutResult {
  contracts: VerifiedContract[]
  nextCursor: BlockscoutCursor | null
  totalReturned: number
}

/**
 * Build the API URL with optional pagination params
 */
function buildContractsApiUrl(cursor?: BlockscoutCursor): string {
  const url = new URL(`${BLOCKSCOUT_BASE_URL}/api/v2/smart-contracts`)

  if (cursor) {
    url.searchParams.set('items_count', cursor.itemsCount.toString())
    url.searchParams.set('smart_contract_id', cursor.smartContractId.toString())
  }

  return url.toString()
}

/**
 * Build the user-facing Blockscout URL for a contract
 */
function buildContractViewUrl(address: string): string {
  return `${BLOCKSCOUT_BASE_URL}/address/${address}`
}

/**
 * Fetch verified contracts from Blockscout
 */
async function fetchVerifiedContracts(
  cursor?: BlockscoutCursor,
  limit = 10,
): Promise<PollBlockscoutResult> {
  const apiUrl = buildContractsApiUrl(cursor)

  // Security check
  if (!isUrlSafeToFetch(apiUrl)) {
    throw new Error('URL failed security validation')
  }

  const response = await fetchWithTimeout(
    apiUrl,
    {
      headers: { Accept: 'application/json' },
    },
    30000,
  )

  if (!response.ok) {
    throw new Error(
      `Blockscout API error: ${response.status} ${response.statusText}`,
    )
  }

  const json = await response.json()
  const parsed = blockscoutContractsResponseSchema.safeParse(json)

  if (!parsed.success) {
    throw new Error(`Invalid Blockscout response: ${parsed.error.message}`)
  }

  const { items, next_page_params } = parsed.data

  // Map to our output format, limiting to requested count
  const contracts: VerifiedContract[] = items.slice(0, limit).map((item) => ({
    address: item.address.hash,
    name: item.address.name ?? 'Unknown',
    verifiedAt: item.verified_at,
    compilerVersion: item.compiler_version ?? 'unknown',
    language: item.language ?? 'solidity',
    blockscoutUrl: buildContractViewUrl(item.address.hash),
  }))

  // Build next cursor if available
  const nextCursor: BlockscoutCursor | null = next_page_params
    ? {
        itemsCount: next_page_params.items_count,
        smartContractId: next_page_params.smart_contract_id,
      }
    : null

  return {
    contracts,
    nextCursor,
    totalReturned: contracts.length,
  }
}

/**
 * Parse cursor from message text or content
 */
function parseCursor(message: Memory): BlockscoutCursor | undefined {
  const content = message.content

  // Check structured content first
  if (
    content.cursor &&
    typeof content.cursor === 'object' &&
    'itemsCount' in content.cursor &&
    'smartContractId' in content.cursor
  ) {
    return content.cursor as BlockscoutCursor
  }

  // Check text for cursor JSON
  const text = (content.text as string) ?? ''
  const cursorMatch = text.match(/cursor[:\s]*(\{[^}]+\})/i)
  if (cursorMatch) {
    try {
      const parsed = JSON.parse(cursorMatch[1])
      if (
        typeof parsed.itemsCount === 'number' &&
        typeof parsed.smartContractId === 'number'
      ) {
        return parsed as BlockscoutCursor
      }
    } catch {
      // Ignore parse errors, continue without cursor
    }
  }

  return undefined
}

/**
 * Parse limit from message
 */
function parseLimit(message: Memory): number {
  const content = message.content

  // Check structured content
  if (typeof content.limit === 'number') {
    return Math.min(Math.max(content.limit, 1), 50) // Clamp to 1-50
  }

  // Check text
  const text = (content.text as string) ?? ''
  const limitMatch = text.match(/limit[:\s]*(\d+)/i)
  if (limitMatch) {
    const limit = parseInt(limitMatch[1], 10)
    return Math.min(Math.max(limit, 1), 50)
  }

  return 10 // Default
}

/**
 * Format contracts list for display
 */
function formatContractsOutput(result: PollBlockscoutResult): string {
  if (result.contracts.length === 0) {
    return 'No verified contracts found.'
  }

  const lines: string[] = [
    `**Recently Verified Contracts on Base**\n`,
    `Found ${result.totalReturned} contract(s):\n`,
  ]

  for (const contract of result.contracts) {
    const verifiedDate = new Date(contract.verifiedAt).toLocaleString()
    lines.push(
      `- **${contract.name}** (\`${contract.address.slice(0, 10)}...${contract.address.slice(-8)}\`)`,
    )
    lines.push(`  Verified: ${verifiedDate} | Compiler: ${contract.compilerVersion}`)
    lines.push(`  [View on Blockscout](${contract.blockscoutUrl})\n`)
  }

  if (result.nextCursor) {
    lines.push(`---`)
    lines.push(`More contracts available. Next cursor:`)
    lines.push('```json')
    lines.push(JSON.stringify(result.nextCursor))
    lines.push('```')
  }

  return lines.join('\n')
}

export const pollBlockscoutAction: Action = {
  name: 'POLL_BLOCKSCOUT',
  description:
    'Discover recently verified smart contracts on Base chain from Blockscout',
  similes: [
    'poll blockscout',
    'list verified contracts',
    'find new contracts',
    'discover contracts',
    'check blockscout',
    'get verified contracts',
    'blockscout contracts',
  ],

  validate: async (_runtime: IAgentRuntime): Promise<boolean> => true,

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const cursor = parseCursor(message)
    const limit = parseLimit(message)

    callback?.({
      text: `Fetching verified contracts from Blockscout${cursor ? ' (continuing from cursor)' : ''}...`,
    })

    try {
      const result = await fetchVerifiedContracts(cursor, limit)

      callback?.({
        text: formatContractsOutput(result),
        content: {
          type: 'blockscout_contracts',
          ...result,
        },
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      callback?.({
        text: `Failed to fetch contracts from Blockscout: ${errorMessage}`,
      })
    }
  },

  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Poll blockscout for new verified contracts',
        },
      },
      {
        name: 'agent',
        content: {
          text: '**Recently Verified Contracts on Base**\n\nFound 10 contract(s):\n\n- **MetalToken** (`0x8538fE88...AB621CE07616`)\n  Verified: 1/7/2025, 7:32:49 PM | Compiler: 0.8.30...',
        },
      },
    ],
    [
      {
        name: 'user',
        content: {
          text: 'Get more contracts with cursor: {"itemsCount": 50, "smartContractId": 2223915}',
        },
      },
      {
        name: 'agent',
        content: {
          text: '**Recently Verified Contracts on Base**\n\nFound 10 contract(s):\n\n- **PaidCounter** (`0xc89E9cB6...091A8C13436E`)...',
        },
      },
    ],
  ],
}
