import { expectValid } from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { verifyMessage } from 'viem'
import {
  BountySeveritySchema,
  type BountySubmissionDraft,
  BountySubmissionStatusSchema,
  toAddress,
  ValidationResultSchema,
  VulnerabilityTypeSchema,
} from '../../lib'
import { assessSubmission, getBugBountyService } from '../bug-bounty-service'
import { getSandboxStats } from '../sandbox-executor'
import {
  type ValidationContext,
  validateSubmission,
} from '../security-validation-agent'
import { auditLog } from '../security'

// Authorization helper - verify signature for privileged operations
async function verifyOperatorSignature(
  address: Address,
  signature: `0x${string}`,
  action: string,
  submissionId: string,
): Promise<boolean> {
  const message = `Autocrat Bug Bounty\nAction: ${action}\nSubmission: ${submissionId}\nTimestamp: ${Math.floor(Date.now() / 60000)}` // 1-minute window
  return verifyMessage({ address, message, signature })
}

const BountySubmissionDraftSchema = t.Object({
  title: t.String({ minLength: 1 }),
  summary: t.String({ minLength: 50 }),
  description: t.String({ minLength: 200 }),
  severity: t.Number({ minimum: 0, maximum: 3 }),
  vulnType: t.Number({ minimum: 0, maximum: 5 }),
  affectedComponents: t.Array(t.String()),
  stepsToReproduce: t.Array(t.String()),
  proofOfConcept: t.Optional(t.String()),
  suggestedFix: t.Optional(t.String()),
  impact: t.Optional(t.String()),
})

export const bugBountyRoutes = new Elysia({ prefix: '/api/v1/bug-bounty' })
  // Stats
  .get(
    '/stats',
    async () => {
      const service = getBugBountyService()
      const stats = await service.getPoolStats()
      const sandboxStats = getSandboxStats()

      return {
        totalPool: stats.totalPool.toString(),
        totalPaidOut: stats.totalPaidOut.toString(),
        pendingPayouts: stats.pendingPayouts.toString(),
        activeSubmissions: stats.activeSubmissions,
        guardianCount: stats.guardianCount,
        sandbox: sandboxStats,
      }
    },
    {
      detail: { tags: ['bug-bounty'], summary: 'Get bug bounty pool stats' },
    },
  )
  // Submissions
  .get(
    '/submissions',
    async ({ query }) => {
      const service = getBugBountyService()
      const status = query.status
        ? expectValid(
            BountySubmissionStatusSchema,
            parseInt(query.status, 10),
            'submission status',
          )
        : undefined
      const limit = query.limit ? parseInt(query.limit, 10) : 50
      const researcher = query.researcher
        ? toAddress(query.researcher)
        : undefined
      const submissions = await service.list(status, researcher, limit)

      return {
        submissions: submissions.map((s) => ({
          submissionId: s.submissionId,
          title: s.title,
          severity: s.severity,
          vulnType: s.vulnType,
          status: s.status,
          submittedAt: s.submittedAt,
          researcher: s.researcher,
          stake: s.stake.toString(),
          rewardAmount: s.rewardAmount.toString(),
          guardianApprovals: s.guardianApprovals,
          guardianRejections: s.guardianRejections,
        })),
        total: submissions.length,
      }
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        researcher: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { tags: ['bug-bounty'], summary: 'List bug bounty submissions' },
    },
  )
  .get(
    '/submissions/:id',
    async ({ params }) => {
      const service = getBugBountyService()
      const submission = await service.get(params.id)

      if (!submission) {
        throw new Error('Submission not found')
      }

      const votes = await service.getGuardianVotes(params.id)

      return {
        submission: {
          ...submission,
          stake: submission.stake.toString(),
          rewardAmount: submission.rewardAmount.toString(),
          researcherAgentId: submission.researcherAgentId.toString(),
        },
        guardianVotes: votes.map((v) => ({
          ...v,
          suggestedReward: v.suggestedReward.toString(),
          guardianAgentId: v.guardianAgentId.toString(),
        })),
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'Get submission by ID' },
    },
  )
  // Assessment
  .post(
    '/assess',
    async ({ body }) => {
      const draft: BountySubmissionDraft = {
        title: body.title,
        summary: body.summary,
        description: body.description,
        severity: expectValid(BountySeveritySchema, body.severity, 'severity'),
        vulnType: expectValid(
          VulnerabilityTypeSchema,
          body.vulnType,
          'vulnerability type',
        ),
        affectedComponents: body.affectedComponents,
        stepsToReproduce: body.stepsToReproduce,
        proofOfConcept: body.proofOfConcept,
        suggestedFix: body.suggestedFix,
        impact: body.impact,
      }

      const assessment = assessSubmission(draft)

      return {
        severity: assessment.severity,
        estimatedReward: assessment.estimatedReward,
        qualityScore: assessment.qualityScore,
        issues: assessment.issues,
        readyToSubmit: assessment.readyToSubmit,
      }
    },
    {
      body: BountySubmissionDraftSchema,
      detail: { tags: ['bug-bounty'], summary: 'Assess submission quality' },
    },
  )
  // Submit
  .post(
    '/submit',
    async ({ body }) => {
      const service = getBugBountyService()

      const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
      if (!body.researcher || body.researcher === ZERO_ADDR) {
        throw new Error('Valid researcher address is required')
      }

      const draft: BountySubmissionDraft = {
        title: body.title,
        summary: body.summary,
        description: body.description,
        severity: expectValid(BountySeveritySchema, body.severity, 'severity'),
        vulnType: expectValid(
          VulnerabilityTypeSchema,
          body.vulnType,
          'vulnerability type',
        ),
        affectedComponents: body.affectedComponents,
        stepsToReproduce: body.stepsToReproduce,
        proofOfConcept: body.proofOfConcept,
        suggestedFix: body.suggestedFix,
        impact: body.impact,
      }

      const submission = await service.submit(
        draft,
        toAddress(body.researcher),
        BigInt(body.researcherAgentId ?? '0'),
      )

      return {
        submissionId: submission.submissionId,
        status: submission.status,
        message: 'Submission received. Validation will begin shortly.',
      }
    },
    {
      body: t.Intersect([
        BountySubmissionDraftSchema,
        t.Object({
          researcher: t.String(),
          researcherAgentId: t.Optional(t.String()),
        }),
      ]),
      detail: { tags: ['bug-bounty'], summary: 'Submit bug bounty report' },
    },
  )
  // Validation - REQUIRES API KEY (admin/operator only)
  // Protected by security middleware for POST to /api/v1/bug-bounty paths
  .post(
    '/validate/:id',
    async ({ params, request }) => {
      const service = getBugBountyService()
      const submission = await service.get(params.id)

      if (!submission) {
        throw new Error('Submission not found')
      }

      auditLog('validation_triggered', 'operator', request, true, {
        submissionId: params.id,
      })

      await service.triggerValidation(params.id)

      return {
        submissionId: params.id,
        status: 'validating',
        message: 'Validation started',
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'Trigger validation (requires API key)' },
    },
  )
  // Complete validation - REQUIRES API KEY (admin/operator only)
  .post(
    '/validate/:id/complete',
    async ({ params, body, request }) => {
      const service = getBugBountyService()

      auditLog('validation_completed', 'operator', request, true, {
        submissionId: params.id,
        result: body.result,
      })

      const submission = await service.completeValidation(
        params.id,
        expectValid(ValidationResultSchema, body.result, 'validation result'),
        body.notes ?? '',
      )

      return {
        submissionId: params.id,
        status: submission.status,
        validationResult: submission.validationResult,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        result: t.Number({ minimum: 0, maximum: 4 }),
        notes: t.Optional(t.String()),
      }),
      detail: { tags: ['bug-bounty'], summary: 'Complete validation (requires API key)' },
    },
  )
  // AI Validation
  .post(
    '/ai-validate/:id',
    async ({ params }) => {
      const service = getBugBountyService()
      const submission = await service.get(params.id)

      if (!submission) {
        throw new Error('Submission not found')
      }

      const context: ValidationContext = {
        submissionId: submission.submissionId,
        severity: submission.severity,
        vulnType: submission.vulnType,
        title: submission.title,
        description: submission.description,
        affectedComponents: submission.affectedComponents,
        stepsToReproduce: submission.stepsToReproduce,
        proofOfConcept: submission.proofOfConcept ?? '',
        suggestedFix: submission.suggestedFix ?? '',
      }

      const report = await validateSubmission(context)

      await service.completeValidation(
        params.id,
        report.result,
        report.securityNotes.join('\n'),
      )

      return {
        submissionId: params.id,
        result: report.result,
        confidence: report.confidence,
        exploitVerified: report.exploitVerified,
        severityAssessment: report.severityAssessment,
        impactAssessment: report.impactAssessment,
        suggestedReward: report.suggestedReward.toString(),
        notes: report.securityNotes,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'AI validation' },
    },
  )
  // Guardian Voting - REQUIRES SIGNATURE to prove guardian owns the address
  .post(
    '/vote/:id',
    async ({ params, body, request }) => {
      const service = getBugBountyService()
      const guardianAddr = toAddress(body.guardian)

      // SECURITY: Verify signature to prove caller owns the guardian address
      if (!body.signature) {
        throw new Error('Signature required for guardian votes')
      }
      const validSig = await verifyOperatorSignature(
        guardianAddr,
        body.signature as `0x${string}`,
        'guardian_vote',
        params.id,
      )
      if (!validSig) {
        auditLog(
          'guardian_vote_invalid_signature',
          guardianAddr,
          request,
          false,
          { submissionId: params.id },
        )
        throw new Error('Invalid signature - cannot verify guardian ownership')
      }

      await service.guardianVote(
        params.id,
        guardianAddr,
        BigInt(body.agentId),
        body.approved,
        BigInt(body.suggestedReward),
        body.feedback ?? '',
      )

      auditLog('guardian_vote', guardianAddr, request, true, {
        submissionId: params.id,
        approved: body.approved,
      })

      const submission = await service.get(params.id)
      if (!submission) {
        throw new Error('Submission not found')
      }

      return {
        submissionId: params.id,
        submissionStatus: submission.status,
        guardianApprovals: submission.guardianApprovals,
        guardianRejections: submission.guardianRejections,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        guardian: t.String(),
        agentId: t.String(),
        approved: t.Boolean(),
        suggestedReward: t.String(),
        feedback: t.Optional(t.String()),
        signature: t.String(), // Required: proves guardian owns the address
      }),
      detail: { tags: ['bug-bounty'], summary: 'Guardian vote (requires signature)' },
    },
  )
  .get(
    '/votes/:id',
    async ({ params }) => {
      const service = getBugBountyService()
      const votes = await service.getGuardianVotes(params.id)

      return {
        votes: votes.map((v) => ({
          ...v,
          suggestedReward: v.suggestedReward.toString(),
          guardianAgentId: v.guardianAgentId.toString(),
        })),
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'Get guardian votes' },
    },
  )
  // CEO/Director Decision - REQUIRES API KEY (admin only)
  // Note: This endpoint is protected by security middleware API key validation
  // Only operators with AUTOCRAT_API_KEY can call this endpoint
  .post(
    '/ceo-decision/:id',
    async ({ params, body, request }) => {
      const service = getBugBountyService()

      // Additional signature verification for CEO decisions
      if (!body.ceoAddress || !body.signature) {
        throw new Error('CEO address and signature required for decisions')
      }

      const ceoAddr = toAddress(body.ceoAddress)
      const validSig = await verifyOperatorSignature(
        ceoAddr,
        body.signature as `0x${string}`,
        'ceo_decision',
        params.id,
      )
      if (!validSig) {
        auditLog('ceo_decision_invalid_signature', ceoAddr, request, false, {
          submissionId: params.id,
        })
        throw new Error('Invalid CEO signature')
      }

      const submission = await service.ceoDecision(
        params.id,
        body.approved,
        BigInt(body.rewardAmount),
        body.notes ?? '',
      )

      auditLog('ceo_decision', ceoAddr, request, true, {
        submissionId: params.id,
        approved: body.approved,
        rewardAmount: body.rewardAmount,
      })

      return {
        submissionId: params.id,
        status: submission.status,
        rewardAmount: submission.rewardAmount.toString(),
        approved: body.approved,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        approved: t.Boolean(),
        rewardAmount: t.String(),
        notes: t.Optional(t.String()),
        ceoAddress: t.String(), // Required: CEO wallet address
        signature: t.String(), // Required: proves CEO owns the address
      }),
      detail: { tags: ['bug-bounty'], summary: 'CEO decision (requires API key + signature)' },
    },
  )
  // Payout - REQUIRES API KEY (admin only operation)
  // Protected by security middleware - only operators can process payouts
  .post(
    '/payout/:id',
    async ({ params, request }) => {
      const service = getBugBountyService()

      // Payout is protected by API key middleware in security.ts
      // Additional audit logging for this sensitive operation
      const submission = await service.get(params.id)
      if (!submission) {
        throw new Error('Submission not found')
      }

      auditLog('payout_initiated', submission.researcher, request, true, {
        submissionId: params.id,
        expectedAmount: submission.rewardAmount.toString(),
      })

      const result = await service.payReward(params.id)

      auditLog('payout_completed', submission.researcher, request, true, {
        submissionId: params.id,
        txHash: result.txHash,
        amount: result.amount.toString(),
      })

      return {
        submissionId: params.id,
        txHash: result.txHash,
        amount: result.amount.toString(),
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'Process payout (requires API key)' },
    },
  )
  // Fix & Disclosure
  .post(
    '/fix/:id',
    async ({ params, body }) => {
      const service = getBugBountyService()
      const submission = await service.recordFix(params.id, body.commitHash)

      return {
        submissionId: params.id,
        fixCommitHash: submission.fixCommitHash,
        disclosureDate: submission.disclosureDate,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ commitHash: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'Record fix' },
    },
  )
  // Researcher Disclosure - REQUIRES SIGNATURE to prove researcher identity
  .post(
    '/disclose/:id',
    async ({ params, body, request }) => {
      const service = getBugBountyService()
      const researcherAddr = toAddress(body.researcher)

      // SECURITY: Verify signature to prove caller is the researcher
      if (!body.signature) {
        throw new Error('Signature required to prove researcher identity')
      }
      const validSig = await verifyOperatorSignature(
        researcherAddr,
        body.signature as `0x${string}`,
        'researcher_disclose',
        params.id,
      )
      if (!validSig) {
        auditLog(
          'disclosure_invalid_signature',
          researcherAddr,
          request,
          false,
          { submissionId: params.id },
        )
        throw new Error('Invalid signature - cannot verify researcher identity')
      }

      const submission = await service.researcherDisclose(params.id, researcherAddr)

      auditLog('researcher_disclosure', researcherAddr, request, true, {
        submissionId: params.id,
      })

      return {
        submissionId: params.id,
        researcherDisclosed: submission.researcherDisclosed,
        disclosureDate: submission.disclosureDate,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        researcher: t.String(),
        signature: t.String(), // Required: proves researcher owns the address
      }),
      detail: { tags: ['bug-bounty'], summary: 'Researcher disclosure (requires signature)' },
    },
  )
  // Researcher Stats
  .get(
    '/researcher/:address',
    async ({ params }) => {
      const service = getBugBountyService()
      const stats = await service.getResearcherStats(toAddress(params.address))

      return {
        ...stats,
        totalEarned: stats.totalEarned.toString(),
        averageReward: stats.averageReward.toString(),
      }
    },
    {
      params: t.Object({ address: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'Get researcher stats' },
    },
  )
  // Researcher Leaderboard
  .get(
    '/leaderboard',
    async ({ query }) => {
      const limit = query.limit ? Number.parseInt(query.limit, 10) : 10
      const service = getBugBountyService()
      const entries = await service.getLeaderboard(limit)

      return {
        entries: entries.map((e) => ({
          researcher: e.researcher,
          totalSubmissions: e.totalSubmissions,
          approvedSubmissions: e.approvedSubmissions,
          totalEarned: e.totalEarned.toString(),
          successRate: e.successRate,
        })),
        total: entries.length,
      }
    },
    {
      query: t.Object({ limit: t.Optional(t.String()) }),
      detail: { tags: ['bug-bounty'], summary: 'Get researcher leaderboard' },
    },
  )
  // Sandbox Stats
  .get(
    '/sandbox/stats',
    () => {
      return getSandboxStats()
    },
    {
      detail: { tags: ['bug-bounty'], summary: 'Get sandbox stats' },
    },
  )
