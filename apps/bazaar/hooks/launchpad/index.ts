// Hook exports
export {
  useTokenLaunchpad,
  useLaunchInfo,
  useCreatorLaunches,
  type BondingCurveConfig,
  type ICOConfig,
  type LaunchInfo,
} from './useTokenLaunchpad'

export {
  useBondingCurve,
  useBondingCurveQuote,
  formatBondingCurvePrice,
  formatProgress,
  type BondingCurveStats,
  type BondingCurveQuote,
} from './useBondingCurve'

export {
  useICOPresale,
  formatPresaleProgress,
  formatTimeRemaining,
  type PresaleStatus,
  type UserContribution,
} from './useICOPresale'

// Re-export useful utilities and presets from lib
export {
  DEFAULT_BONDING_CONFIG,
  DEFAULT_ICO_CONFIG,
  DEGEN_ICO_CONFIG,
  calculateInitialPrice,
  calculateGraduationMarketCap,
  calculateBuyPriceImpact,
  calculateTokensOut,
  calculateEthOut,
  validateBondingCurveLaunch,
  validateICOLaunch,
} from '@/lib/launchpad'

