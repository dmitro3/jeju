/**
 * AUDIT_CONTRACT Action
 *
 * Combined action that fetches Solidity source from GitHub and
 * performs systematic security analysis in a single turn.
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
import {
  type AuditFinding,
  type AuditReport,
  auditFindingsArraySchema,
  fetchWithTimeout,
  isUrlSafeToFetch,
  type Severity,
  type SeverityCounts,
  truncateOutput,
} from '../validation'

// Domain allowlist for security
const ALLOWED_DOMAINS = new Set([
  'raw.githubusercontent.com',
  'gist.githubusercontent.com',
  'base.blockscout.com',
])

function isAllowedDomain(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    return ALLOWED_DOMAINS.has(url.hostname)
  } catch {
    return false
  }
}

// Blockscout API response schemas
const blockscoutAdditionalSourceSchema = z.object({
  file_path: z.string(),
  source_code: z.string(),
})

const blockscoutContractResponseSchema = z.object({
  name: z.string(),
  source_code: z.string(),
  additional_sources: z.array(blockscoutAdditionalSourceSchema).optional(),
  compiler_version: z.string().optional(),
  is_verified: z.boolean().optional(),
})

// Blockscout URL detection and parsing
const BLOCKSCOUT_DOMAINS = ['base.blockscout.com'] as const

function isBlockscoutUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    return BLOCKSCOUT_DOMAINS.some((domain) => url.hostname === domain)
  } catch {
    return false
  }
}

function extractAddressFromBlockscoutUrl(urlString: string): string | null {
  try {
    const url = new URL(urlString)

    // Pattern 1: /address/0x... (user-facing)
    const addressMatch = url.pathname.match(/\/address\/(0x[a-fA-F0-9]{40})/)
    if (addressMatch) return addressMatch[1]

    // Pattern 2: /api/v2/smart-contracts/0x... (API URL)
    const apiMatch = url.pathname.match(
      /\/api\/v2\/smart-contracts\/(0x[a-fA-F0-9]{40})/,
    )
    if (apiMatch) return apiMatch[1]

    return null
  } catch {
    return null
  }
}

function buildBlockscoutApiUrl(hostname: string, address: string): string {
  return `https://${hostname}/api/v2/smart-contracts/${address}`
}

interface BlockscoutSourceResult {
  contractName: string
  source: string
  compilerVersion?: string
  additionalSources?: Array<{ filePath: string; source: string }>
}

async function fetchBlockscoutSource(
  hostname: string,
  address: string,
): Promise<BlockscoutSourceResult> {
  const apiUrl = buildBlockscoutApiUrl(hostname, address)

  const response = await fetchWithTimeout(
    apiUrl,
    {
      headers: { Accept: 'application/json' },
    },
    30000,
  )

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Contract not found or not verified: ${address}`)
    }
    throw new Error(
      `Blockscout API error: ${response.status} ${response.statusText}`,
    )
  }

  const json = await response.json()
  const parsed = blockscoutContractResponseSchema.safeParse(json)

  if (!parsed.success) {
    throw new Error(`Invalid Blockscout response: ${parsed.error.message}`)
  }

  const { name, source_code, additional_sources, compiler_version } =
    parsed.data

  if (!source_code || source_code.trim() === '') {
    throw new Error(`Contract ${address} has no source code (not verified?)`)
  }

  return {
    contractName: name,
    source: source_code,
    compilerVersion: compiler_version,
    additionalSources: additional_sources?.map((s) => ({
      filePath: s.file_path,
      source: s.source_code,
    })),
  }
}

function combineBlockscoutSources(result: BlockscoutSourceResult): string {
  // For single-file contracts, return as-is
  if (!result.additionalSources || result.additionalSources.length === 0) {
    return result.source
  }

  // For multi-file contracts, combine with file headers
  const parts: string[] = []

  // Main contract first
  parts.push(`// === Main Contract: ${result.contractName} ===\n`)
  parts.push(result.source)

  // Additional sources
  for (const additional of result.additionalSources) {
    parts.push(`\n\n// === File: ${additional.filePath} ===\n`)
    parts.push(additional.source)
  }

  return parts.join('')
}

// Analysis prompts for each vulnerability category
const ANALYSIS_PROMPTS = {
  reentrancy: (
    source: string,
  ) => `Analyze this Solidity contract for REENTRANCY vulnerabilities only.

Look for:
- External calls (call, send, transfer) before state updates
- Callbacks that could re-enter the contract
- Cross-function reentrancy via shared state

Contract:
\`\`\`solidity
${source}
\`\`\`

Output ONLY a JSON array of findings. Each finding: { id, severity, title, location, description, recommendation }
If no issues: []

JSON:`,

  accessControl: (
    source: string,
  ) => `Analyze this Solidity contract for ACCESS CONTROL vulnerabilities only.

Look for:
- Missing onlyOwner/role checks on sensitive functions
- Unprotected selfdestruct or delegatecall
- tx.origin authentication
- Centralization risks

Contract:
\`\`\`solidity
${source}
\`\`\`

Output ONLY a JSON array of findings. Each finding: { id, severity, title, location, description, recommendation }
If no issues: []

JSON:`,

  arithmetic: (
    source: string,
  ) => `Analyze this Solidity contract for ARITHMETIC vulnerabilities only.

Look for:
- Integer overflow/underflow (pre-0.8.0 without SafeMath)
- Unchecked blocks with risky arithmetic
- Division by zero

Contract:
\`\`\`solidity
${source}
\`\`\`

Output ONLY a JSON array of findings. Each finding: { id, severity, title, location, description, recommendation }
If no issues: []

JSON:`,

  general: (
    source: string,
  ) => `Analyze this Solidity contract for GENERAL security issues.

Look for:
- Unchecked return values from low-level calls
- Front-running vulnerabilities
- Denial of Service vectors
- Missing events, floating pragma

Contract:
\`\`\`solidity
${source}
\`\`\`

Output ONLY a JSON array of findings. Each finding: { id, severity, title, location, description, recommendation }
If no issues: []

JSON:`,
}

function extractContractName(source: string): string {
  const match = source.match(/contract\s+(\w+)/)
  return match?.[1] ?? 'Unknown'
}

function parseFindingsFromResponse(response: string): AuditFinding[] {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const parsed = JSON.parse(jsonMatch[0])
    const validated = auditFindingsArraySchema.safeParse(parsed)

    if (validated.success) return validated.data

    if (Array.isArray(parsed)) {
      return parsed
        .filter((f) => f?.title && f?.description)
        .map((f, i) => ({
          id: f.id ?? `FINDING-${i + 1}`,
          severity: ([
            'critical',
            'high',
            'medium',
            'low',
            'informational',
          ].includes(f.severity?.toLowerCase())
            ? f.severity.toLowerCase()
            : 'medium') as Severity,
          title: String(f.title),
          location: String(f.location ?? 'Unknown'),
          description: String(f.description),
          recommendation: String(f.recommendation ?? 'Review and fix'),
        }))
    }
    return []
  } catch {
    return []
  }
}

function countBySeverity(findings: AuditFinding[]): SeverityCounts {
  const counts: SeverityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  }
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity]++
  }
  return counts
}

function generateReportMarkdown(report: AuditReport): string {
  const emoji: Record<Severity, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🔵',
    informational: '⚪',
  }

  let md = `# Security Audit Report

**Contract:** ${report.contractName}
${report.contractUrl ? `**Source:** ${report.contractUrl}` : ''}
**Date:** ${report.date}

---

## Executive Summary

${report.summary}

---

## Findings Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | ${report.severityCounts.critical} |
| 🟠 High | ${report.severityCounts.high} |
| 🟡 Medium | ${report.severityCounts.medium} |
| 🔵 Low | ${report.severityCounts.low} |
| ⚪ Info | ${report.severityCounts.informational} |

**Total:** ${report.findings.length}

---

## Detailed Findings

`

  if (report.findings.length === 0) {
    md += `*No security issues identified.*\n`
  } else {
    const order: Severity[] = [
      'critical',
      'high',
      'medium',
      'low',
      'informational',
    ]
    const sorted = [...report.findings].sort(
      (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
    )

    for (const f of sorted) {
      md += `### ${emoji[f.severity]} [${f.severity.toUpperCase()}] ${f.title}

**Location:** \`${f.location}\`

${f.description}

**Fix:** ${f.recommendation}

---

`
    }
  }

  return md
}

function generateSummary(findings: AuditFinding[], name: string): string {
  const counts = countBySeverity(findings)
  const total = findings.length

  if (total === 0) {
    return `The ${name} contract appears well-structured with no obvious vulnerabilities in this automated scan.`
  }

  const parts: string[] = []
  if (counts.critical > 0) parts.push(`**${counts.critical} critical**`)
  if (counts.high > 0) parts.push(`${counts.high} high`)
  if (counts.medium > 0) parts.push(`${counts.medium} medium`)
  if (counts.low + counts.informational > 0)
    parts.push(`${counts.low + counts.informational} low/info`)

  const risk =
    counts.critical > 0
      ? 'HIGH RISK'
      : counts.high > 0
        ? 'MEDIUM RISK'
        : 'LOW RISK'

  return `Found ${total} issue${total > 1 ? 's' : ''}: ${parts.join(', ')}. Risk: **${risk}**`
}

export const auditContractAction: Action = {
  name: 'AUDIT_CONTRACT',
  description:
    'Fetch Solidity contract from GitHub raw URL or Blockscout URL and perform full security audit',
  similes: [
    'audit contract',
    'security audit',
    'analyze contract',
    'check contract security',
    'review contract',
    'audit blockscout contract',
  ],

  validate: async (_runtime: IAgentRuntime): Promise<boolean> => true,

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const text = (message.content.text as string) ?? ''

    // Extract URL
    const urlMatch = text.match(/https?:\/\/[^\s]+/)
    if (!urlMatch) {
      callback?.({
        text: 'Please provide a GitHub raw URL or Blockscout URL to audit.',
      })
      return
    }

    const targetUrl = urlMatch[0]

    // Security checks
    if (!isUrlSafeToFetch(targetUrl)) {
      callback?.({ text: 'Cannot fetch from internal or private URLs.' })
      return
    }

    if (!isAllowedDomain(targetUrl)) {
      callback?.({
        text: `Only GitHub raw URLs or Blockscout URLs allowed: ${[...ALLOWED_DOMAINS].join(', ')}`,
      })
      return
    }

    callback?.({ text: `Fetching contract from ${targetUrl}...` })

    // Fetch source - branch based on URL type
    let contractSource: string
    let contractName: string

    if (isBlockscoutUrl(targetUrl)) {
      // Blockscout path: extract address and fetch via API
      const url = new URL(targetUrl)
      const address = extractAddressFromBlockscoutUrl(targetUrl)

      if (!address) {
        callback?.({
          text: `Could not extract contract address from Blockscout URL. Expected format: https://base.blockscout.com/address/0x...`,
        })
        return
      }

      try {
        const blockscoutResult = await fetchBlockscoutSource(
          url.hostname,
          address,
        )
        contractSource = combineBlockscoutSources(blockscoutResult)
        contractName = blockscoutResult.contractName

        if (blockscoutResult.compilerVersion) {
          console.log(
            `[AUDIT_CONTRACT] Blockscout contract ${contractName} compiled with ${blockscoutResult.compilerVersion}`,
          )
        }
        if (
          blockscoutResult.additionalSources &&
          blockscoutResult.additionalSources.length > 0
        ) {
          console.log(
            `[AUDIT_CONTRACT] Contract has ${blockscoutResult.additionalSources.length} additional source files`,
          )
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        callback?.({ text: `Blockscout fetch failed: ${errorMessage}` })
        return
      }
    } else {
      // GitHub path: fetch raw source directly
      const response = await fetchWithTimeout(targetUrl, {}, 30000)
      if (!response.ok) {
        callback?.({
          text: `Fetch failed: ${response.status} ${response.statusText}`,
        })
        return
      }

      contractSource = await response.text()
      contractName = extractContractName(contractSource)
    }

    if (contractSource.length > 50 * 1024) {
      callback?.({
        text: `Contract too large (${contractSource.length} bytes). Max 50KB.`,
      })
      return
    }
    callback?.({
      text: `Analyzing ${contractName} (${contractSource.length} bytes)...\n\nRunning security checks:\n• Reentrancy\n• Access control\n• Arithmetic\n• General issues`,
    })

    // Run analysis passes
    const allFindings: AuditFinding[] = []
    const categories = [
      'reentrancy',
      'accessControl',
      'arithmetic',
      'general',
    ] as const

    // Check which LLM method is available
    const hasUseModel =
      'useModel' in runtime && typeof runtime.useModel === 'function'
    const hasGenerateText =
      'generateText' in runtime && typeof runtime.generateText === 'function'
    console.log(
      `[AUDIT_CONTRACT] LLM methods available: useModel=${hasUseModel}, generateText=${hasGenerateText}`,
    )

    if (!hasUseModel && !hasGenerateText) {
      console.error(
        '[AUDIT_CONTRACT] ERROR: No LLM methods available on runtime!',
      )
      callback?.({
        text: `Error: No LLM inference available. The runtime is missing generateText/useModel methods.`,
      })
      return
    }

    for (const category of categories) {
      try {
        console.log(`[AUDIT_CONTRACT] Starting ${category} analysis pass...`)
        const prompt = ANALYSIS_PROMPTS[category](
          truncateOutput(contractSource, 35000),
        )

        let response: string
        if (hasUseModel) {
          console.log(
            `[AUDIT_CONTRACT] Calling useModel('TEXT_ANALYSIS') for ${category}...`,
          )
          response = await (
            runtime as unknown as {
              useModel: (t: string, o: { prompt: string }) => Promise<string>
            }
          ).useModel('TEXT_ANALYSIS', { prompt })
        } else {
          console.log(
            `[AUDIT_CONTRACT] Calling generateText() for ${category}...`,
          )
          response = await (
            runtime as unknown as {
              generateText: (p: string) => Promise<string>
            }
          ).generateText(prompt)
        }

        console.log(
          `[AUDIT_CONTRACT] ${category} response length: ${response.length}`,
        )
        console.log(
          `[AUDIT_CONTRACT] ${category} response preview: ${response.slice(0, 500)}`,
        )

        const findings = parseFindingsFromResponse(response)
        console.log(
          `[AUDIT_CONTRACT] ${category} parsed findings: ${findings.length}`,
        )
        allFindings.push(...findings)
      } catch (err) {
        console.error(`[AUDIT_CONTRACT] Analysis pass ${category} failed:`, err)
      }
    }

    console.log(
      `[AUDIT_CONTRACT] Total findings across all passes: ${allFindings.length}`,
    )

    // De-duplicate by title
    const seen = new Set<string>()
    const unique = allFindings.filter((f) => {
      const key = f.title.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const report: AuditReport = {
      contractName,
      contractUrl: targetUrl,
      date: new Date().toISOString().split('T')[0],
      summary: generateSummary(unique, contractName),
      findings: unique,
      severityCounts: countBySeverity(unique),
    }

    callback?.({
      text: generateReportMarkdown(report),
      content: { report, type: 'security_audit' },
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Audit https://raw.githubusercontent.com/.../Contract.sol',
        },
      },
      {
        name: 'agent',
        content: {
          text: '# Security Audit Report\n\n**Contract:** MyContract...',
        },
      },
    ],
    [
      {
        name: 'user',
        content: {
          text: 'Audit this contract https://base.blockscout.com/address/0x1234567890abcdef1234567890abcdef12345678',
        },
      },
      {
        name: 'agent',
        content: {
          text: '# Security Audit Report\n\n**Contract:** VerifiedContract...',
        },
      },
    ],
  ],
}
