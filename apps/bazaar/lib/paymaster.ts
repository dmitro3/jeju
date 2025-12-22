/**
 * Paymaster Integration for Bazaar
 * Re-exports shared implementation
 */

// Re-export all shared paymaster functionality
export {
  type PaymasterInfo,
  type PaymasterConfig,
  type PaymasterOption,
  getAvailablePaymasters,
  getPaymasterForToken,
  getPaymasterOptions,
  estimateTokenCost,
  checkPaymasterApproval,
  getTokenBalance,
  preparePaymasterData,
  generatePaymasterData,
  getApprovalTxData,
  loadPaymasterConfig,
} from '@jejunetwork/deployment/scripts/shared/paymaster';
