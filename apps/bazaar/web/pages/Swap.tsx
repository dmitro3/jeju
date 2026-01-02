import { SUPPORTED_CHAINS } from '@jejunetwork/shared'
import { erc20Abi } from 'viem'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { formatEther, parseEther } from 'viem'
import { useAccount, useBalance, useReadContract, useSwitchChain } from 'wagmi'
import {
  getSwapButtonText,
  getTokenBySymbol,
  isSwapButtonDisabled,
  SWAP_TOKENS,
  validateSwap,
} from '../../api/swap'
import { InfoCard } from '../components/ui'
import { JEJU_CHAIN_ID } from '../config/chains'
import { wagmiConfig } from '../config/wagmi'
import {
  type ChainInfo,
  isCrossChainSwap as checkCrossChain,
  useCrossChainSwap,
  useEILConfig,
  useSwapFeeEstimate,
} from '../hooks/useEIL'
import { useSameChainSwap } from '../hooks/useSameChainSwap'

export default function SwapPage() {
  const { isConnected, chain, address } = useAccount()
  const { switchChain } = useSwitchChain()
  const [inputAmount, setInputAmount] = useState('')
  const [inputToken, setInputToken] = useState('ETH')
  const [outputToken, setOutputToken] = useState('ETH')
  const [sourceChainId, setSourceChainId] = useState(JEJU_CHAIN_ID)
  const [destChainId, setDestChainId] = useState(JEJU_CHAIN_ID)

  const isCorrectChain = chain?.id === JEJU_CHAIN_ID

  const handleSwitchNetwork = async () => {
    if (!switchChain) {
      toast.error('Please switch to the correct network in MetaMask')
      return
    }
    try {
      const targetChain = wagmiConfig.chains.find(
        (c) => c.id === JEJU_CHAIN_ID,
      )
      if (!targetChain) {
        toast.error('Chain not configured in wallet')
        return
      }
      await switchChain({ chainId: JEJU_CHAIN_ID })
      toast.success(`Switched to ${targetChain.name}`)
    } catch (error) {
      const err = error as Error
      // User rejection is expected, don't show error
      if (err.message?.includes('reject') || err.message?.includes('denied')) {
        return
      }
      toast.error(err.message || 'Failed to switch network')
    }
  }

  const eilConfig = useEILConfig()
  const eilAvailable = eilConfig?.isAvailable ?? false
  const crossChainPaymaster = eilConfig?.crossChainPaymaster
  const {
    executeCrossChainSwap,
    swapStatus: crossChainStatus,
    isLoading: isCrossChainSwapping,
    hash: crossChainHash,
  } = useCrossChainSwap(crossChainPaymaster)
  
  const {
    executeSameChainSwap,
    swapStatus: sameChainStatus,
    isLoading: isSameChainSwapping,
    hash: sameChainHash,
  } = useSameChainSwap()
  
  const isCrossChainSwap = checkCrossChain(sourceChainId, destChainId)
  const isSwapping = isCrossChainSwapping || isSameChainSwapping
  const hash = crossChainHash || sameChainHash
  // Use the appropriate status based on swap type
  const swapStatus = isCrossChainSwap ? crossChainStatus : sameChainStatus
  
  // Get input and output token info first
  const inputTokenInfo = getTokenBySymbol(inputToken)
  const outputTokenInfo = getTokenBySymbol(outputToken)
  const inputDecimals = inputTokenInfo?.decimals ?? 18
  const outputDecimals = outputTokenInfo?.decimals ?? 18
  const amount = inputAmount 
    ? BigInt(Math.floor(parseFloat(inputAmount) * 10 ** inputDecimals))
    : 0n
  const feeEstimate = useSwapFeeEstimate(sourceChainId, destChainId, amount)

  // Get balances for input and output tokens
  const isInputETH = inputToken === 'ETH' || inputTokenInfo?.address === '0x0000000000000000000000000000000000000000'
  const isOutputETH = outputToken === 'ETH' || outputTokenInfo?.address === '0x0000000000000000000000000000000000000000'
  
  // ETH balance
  const { data: ethBalance, refetch: refetchEthBalance } = useBalance({
    address,
    query: {
      enabled: !!address && (isInputETH || isOutputETH),
      refetchInterval: 5000, // Refresh every 5 seconds
    },
  })

  // Input token balance (ERC20)
  const { data: inputTokenBalance, refetch: refetchInputBalance } = useReadContract({
    address: isInputETH ? undefined : (inputTokenInfo?.address as `0x${string}` | undefined),
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!inputTokenInfo && !isInputETH,
      refetchInterval: 5000, // Refresh every 5 seconds
    },
  })

  // Output token balance (ERC20)
  const { data: outputTokenBalance, refetch: refetchOutputBalance } = useReadContract({
    address: isOutputETH ? undefined : (outputTokenInfo?.address as `0x${string}` | undefined),
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!outputTokenInfo && !isOutputETH,
      refetchInterval: 5000, // Refresh every 5 seconds
    },
  })

  // Format balances for display
  const inputBalance = isInputETH 
    ? ethBalance?.value ?? 0n
    : (inputTokenBalance as bigint | undefined) ?? 0n
  const inputBalanceFormatted = inputBalance > 0n
    ? (Number(inputBalance) / 10 ** inputDecimals).toFixed(6).replace(/\.?0+$/, '')
    : '0'

  const outputBalance = isOutputETH
    ? ethBalance?.value ?? 0n
    : (outputTokenBalance as bigint | undefined) ?? 0n
  const outputBalanceFormatted = outputBalance > 0n
    ? (Number(outputBalance) / 10 ** outputDecimals).toFixed(6).replace(/\.?0+$/, '')
    : '0'

  // Refetch balances when swap completes or transaction hash changes
  useEffect(() => {
    if (swapStatus === 'complete' || hash) {
      // Immediate refetch, then again after delay to ensure transaction is mined
      refetchEthBalance()
      refetchInputBalance()
      refetchOutputBalance()
      
      const timer1 = setTimeout(() => {
        refetchEthBalance()
        refetchInputBalance()
        refetchOutputBalance()
      }, 1000)
      
      const timer2 = setTimeout(() => {
        refetchEthBalance()
        refetchInputBalance()
        refetchOutputBalance()
      }, 3000)
      
      return () => {
        clearTimeout(timer1)
        clearTimeout(timer2)
      }
    }
  }, [swapStatus, hash, refetchEthBalance, refetchInputBalance, refetchOutputBalance])

  // Also refetch when token selection changes
  useEffect(() => {
    if (isConnected) {
      refetchInputBalance()
      refetchOutputBalance()
    }
  }, [inputToken, outputToken, isConnected, refetchInputBalance, refetchOutputBalance])

  const sourceChain = SUPPORTED_CHAINS.find(
    (c: ChainInfo) => c.id === sourceChainId,
  )
  const destChain = SUPPORTED_CHAINS.find(
    (c: ChainInfo) => c.id === destChainId,
  )

  // Calculate output - for different tokens, use 1:1 rate (placeholder until oracle)
  // For same token, output equals input minus fees
  // Note: outputTokenInfo and outputDecimals are already declared above
  
  let outputAmount = ''
  if (inputAmount && amount > 0n) {
    if (inputToken === outputToken) {
      // Same token: output = input - fees
      const outputWei = amount > feeEstimate.totalFee ? amount - feeEstimate.totalFee : 0n
      outputAmount = (Number(outputWei) / 10 ** outputDecimals).toFixed(outputDecimals)
    } else {
      // Different tokens: use 1:1 rate (placeholder until oracle integration)
      // Convert input amount to output token decimals
      const inputAmountScaled = Number(amount) / 10 ** inputDecimals
      const outputAmountScaled = inputAmountScaled * (10 ** outputDecimals / 10 ** inputDecimals)
      const outputWei = BigInt(Math.floor(outputAmountScaled * 10 ** outputDecimals))
      const afterFees = outputWei > feeEstimate.totalFee ? outputWei - feeEstimate.totalFee : 0n
      outputAmount = (Number(afterFees) / 10 ** outputDecimals).toFixed(outputDecimals)
    }
  }

  const handleSwap = async () => {
    const validation = validateSwap(
      isConnected,
      inputAmount,
      inputToken,
      outputToken,
      sourceChainId,
      destChainId,
      isCorrectChain,
      eilAvailable,
    )

    if (!validation.valid) {
      toast.error(validation.error)
      return
    }

    const sourceTokenInfo = getTokenBySymbol(inputToken)
    const destTokenInfo = getTokenBySymbol(outputToken)

    if (!sourceTokenInfo || !destTokenInfo) {
      toast.error('Token not supported')
      return
    }

    // Parse amount based on token decimals
    const inputAmountParsed = parseFloat(inputAmount)
    const decimals = sourceTokenInfo.decimals
    const amount = BigInt(Math.floor(inputAmountParsed * 10 ** decimals))

    // For same-chain swaps, we need a different approach since EIL isn't configured
    // For now, show a message that same-chain swaps need a DEX or direct transfer
    if (isCrossChainSwap) {
      if (!eilAvailable) {
        toast.error('Cross-chain swaps require EIL integration')
        return
      }
      await executeCrossChainSwap({
        sourceToken: sourceTokenInfo.address,
        destinationToken: destTokenInfo.address,
        amount,
        sourceChainId,
        destinationChainId: destChainId,
      })
    } else {
      // Same-chain swap - execute token-to-token swap
      try {
        await executeSameChainSwap({
          sourceToken: sourceTokenInfo.address,
          destinationToken: destTokenInfo.address,
          amount,
          sourceDecimals: sourceTokenInfo.decimals,
          destDecimals: destTokenInfo.decimals,
          rate: 1.0, // 1:1 rate for now
        })
        toast.success('Swap executed successfully!')
      } catch (error) {
        const err = error as Error
        toast.error(err.message || 'Swap failed')
      }
    }
  }

  const swapTokens = () => {
    setInputToken(outputToken)
    setOutputToken(inputToken)
    const temp = sourceChainId
    setSourceChainId(destChainId)
    setDestChainId(temp)
  }

  const buttonText = getSwapButtonText(
    isConnected,
    isSwapping,
    isCorrectChain,
    Boolean(inputAmount),
    isCrossChainSwap,
    destChain?.name ?? 'Unknown',
  )

  const buttonDisabled = isSwapButtonDisabled(
    isConnected,
    isSwapping,
    isCorrectChain,
    Boolean(inputAmount),
    isCrossChainSwap,
  )

  return (
    <div className="max-w-lg mx-auto animate-fade-in">
      {/* Page Header */}
      <header className="text-center mb-8">
        <div className="text-5xl mb-3 animate-float" aria-hidden="true">
          🔄
        </div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gradient-warm mb-2">
          Swap
        </h1>
        <p className="text-secondary">
          Trade tokens instantly with the best rates
        </p>
        {isConnected && address && (
          <div className="mt-3 text-xs text-tertiary font-mono">
            Connected: {address.slice(0, 6)}...{address.slice(-4)}
          </div>
        )}
      </header>

      {/* Warnings */}
      <div className="space-y-3 mb-6">
        {!eilAvailable && isCrossChainSwap && (
          <InfoCard variant="warning">
            Cross-chain swaps require EIL integration. Only same-chain swaps
            are available.
          </InfoCard>
        )}

        {isConnected && !isCorrectChain && !isCrossChainSwap && (
          <InfoCard variant="error">
            <div className="flex items-center justify-between gap-4">
              <span>Switch to the correct network to swap</span>
              <button
                type="button"
                onClick={handleSwitchNetwork}
                className="btn-primary px-4 py-2 text-sm"
              >
                Switch Network
              </button>
            </div>
          </InfoCard>
        )}
      </div>

      {/* Swap Card */}
      <div className="card p-5 md:p-6">
        {/* From Section */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="swap-input-amount"
                className="text-sm text-tertiary"
              >
                From
              </label>
              {isConnected && (
                <span className="text-xs text-secondary">
                  Balance: {inputBalanceFormatted} {inputToken}
                </span>
              )}
            </div>
            {eilAvailable && (
              <select
                value={sourceChainId}
                onChange={(e) => setSourceChainId(Number(e.target.value))}
                className="text-xs px-2 py-1 rounded-lg border-0 bg-surface-secondary text-secondary"
                aria-label="Source chain"
              >
                {SUPPORTED_CHAINS.map((c: ChainInfo) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex gap-2">
            <input
              id="swap-input-amount"
              type="number"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder="0.0"
              className="input flex-1 text-xl font-semibold"
              aria-label="Amount to swap"
            />
            <select
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              className="input w-28 sm:w-32 font-medium"
              aria-label="Token to swap from"
            >
              {SWAP_TOKENS.map((token) => (
                <option key={token.symbol} value={token.symbol}>
                  {token.icon} {token.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Swap Direction Button */}
        <div className="flex justify-center my-3">
          <button
            type="button"
            className="p-2.5 rounded-xl bg-surface-secondary hover:bg-surface-elevated transition-all hover:scale-110 active:scale-95 focus-ring"
            onClick={swapTokens}
            aria-label="Swap tokens"
          >
            <svg
              className="w-5 h-5 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
              />
            </svg>
          </button>
        </div>

        {/* To Section */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="swap-output-amount"
                  className="text-sm text-tertiary"
                >
                  To
                </label>
                {isConnected && (
                  <span className="text-xs text-secondary">
                    Balance: {outputBalanceFormatted} {outputToken}
                  </span>
                )}
              </div>
              {isConnected && (
                <button
                  type="button"
                  onClick={() => {
                    refetchOutputBalance()
                    refetchEthBalance()
                  }}
                  className="text-xs text-primary hover:text-primary/80 transition-colors"
                  title="Refresh balance"
                >
                  ↻
                </button>
              )}
            </div>
            {eilAvailable && (
              <select
                value={destChainId}
                onChange={(e) => setDestChainId(Number(e.target.value))}
                className="text-xs px-2 py-1 rounded-lg border-0 bg-surface-secondary text-secondary"
                aria-label="Destination chain"
              >
                {SUPPORTED_CHAINS.map((c: ChainInfo) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex gap-2">
            <input
              id="swap-output-amount"
              type="number"
              value={outputAmount}
              placeholder="0.0"
              readOnly
              className="input flex-1 text-xl font-semibold bg-surface-secondary"
              aria-label="Amount you will receive"
            />
            <select
              value={outputToken}
              onChange={(e) => setOutputToken(e.target.value)}
              className="input w-28 sm:w-32 font-medium"
              aria-label="Token to receive"
            >
              {SWAP_TOKENS.map((token) => (
                <option key={token.symbol} value={token.symbol}>
                  {token.icon} {token.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Cross-chain Info */}
        {isCrossChainSwap && (
          <div className="mb-4 p-4 rounded-xl bg-surface-secondary animate-fade-in">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg" aria-hidden="true">
                🌉
              </span>
              <span className="font-medium text-primary">
                Cross-Chain Transfer
              </span>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-tertiary">Route</dt>
                <dd className="text-primary">
                  {sourceChain?.icon} → {destChain?.icon}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-tertiary">Estimated Time</dt>
                <dd className="text-primary">~{feeEstimate.estimatedTime}s</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-tertiary">Bridge Fee</dt>
                <dd className="text-primary">
                  {formatEther(feeEstimate.totalFee)} ETH
                </dd>
              </div>
            </dl>
          </div>
        )}

        {/* Same-chain Summary */}
        {inputAmount && outputAmount && !isCrossChainSwap && (
          <div className="mb-4 p-4 rounded-xl bg-surface-secondary animate-fade-in">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-tertiary">Rate</dt>
                <dd className="text-primary">1:1 (same token)</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-tertiary">Network Fee</dt>
                <dd className="text-primary">
                  {formatEther(feeEstimate.totalFee)} ETH
                </dd>
              </div>
            </dl>
          </div>
        )}

        {/* Swap Button */}
        <button
          type="button"
          onClick={handleSwap}
          disabled={buttonDisabled}
          className="btn-primary w-full py-4 text-lg font-semibold"
        >
          {buttonText}
        </button>

        {/* Success Message */}
        {swapStatus === 'complete' && hash && (
          <div className="mt-4 p-4 rounded-xl border border-green-500/30 bg-green-500/10 text-center animate-scale-in">
            <span className="text-success font-medium">
              ✓ Transfer initiated successfully
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
