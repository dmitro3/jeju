import { test, expect } from '@playwright/test'
import { captureScreenshot, captureUserFlow } from '@jejunetwork/tests/playwright-only'

test.describe('Perpetuals Trading Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/perps')
  })

  test('should display perpetuals page with all main elements', async ({ page }) => {
    await captureUserFlow(page, {
      appName: 'bazaar',
      feature: 'perps',
      steps: [
        {
          name: 'initial-load',
          action: async () => {
            // Check page title
            await expect(page.getByRole('heading', { name: /Perpetuals/i })).toBeVisible()
            
            // Check demo mode banner
            await expect(page.getByText(/Demo Mode/i)).toBeVisible()
          },
          waitFor: 500,
        },
        {
          name: 'market-elements',
          action: async () => {
            // Check market selector buttons
            await expect(page.getByRole('button', { name: 'BTC-PERP' })).toBeVisible()
            await expect(page.getByRole('button', { name: 'ETH-PERP' })).toBeVisible()
          },
        },
      ],
    })
  })

  test('should display price information', async ({ page }) => {
    await captureScreenshot(page, {
      appName: 'bazaar',
      feature: 'perps',
      step: '01-price-display',
    })

    // Check price display elements
    await expect(page.getByText('Mark Price')).toBeVisible()
    await expect(page.getByText('Index Price')).toBeVisible()
    await expect(page.getByText('Funding (1h)')).toBeVisible()
  })

  test('should switch between markets', async ({ page }) => {
    await captureUserFlow(page, {
      appName: 'bazaar',
      feature: 'perps-market-switch',
      steps: [
        {
          name: 'initial-btc',
          action: async () => {
            // BTC-PERP should be selected by default
            const btcButton = page.getByRole('button', { name: 'BTC-PERP' })
            await expect(btcButton).toBeVisible()
          },
        },
        {
          name: 'switch-to-eth',
          action: async () => {
            // Click ETH-PERP button
            await page.getByRole('button', { name: 'ETH-PERP' }).click()
          },
          waitFor: 300,
        },
        {
          name: 'verify-eth-selected',
          action: async () => {
            // Verify ETH is now selected (has primary background class)
            const ethButton = page.getByRole('button', { name: 'ETH-PERP' })
            await expect(ethButton).toHaveClass(/bg-bazaar-primary/)
          },
        },
      ],
    })
  })

  test('should display trading panel with long/short buttons', async ({ page }) => {
    await captureScreenshot(page, {
      appName: 'bazaar',
      feature: 'perps',
      step: '02-trading-panel',
    })

    // Check trading panel elements
    await expect(page.getByRole('button', { name: 'Long' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Short' })).toBeVisible()
    
    // Check leverage slider
    await expect(page.getByText('Leverage')).toBeVisible()
    await expect(page.getByText('1x')).toBeVisible()
    await expect(page.getByText('50x')).toBeVisible()
  })

  test('should toggle between long and short positions', async ({ page }) => {
    await captureUserFlow(page, {
      appName: 'bazaar',
      feature: 'perps-position-toggle',
      steps: [
        {
          name: 'initial-long',
          action: async () => {
            // Long should be selected by default
            const longButton = page.getByRole('button', { name: 'Long' })
            await expect(longButton).toHaveClass(/bg-green-500/)
          },
        },
        {
          name: 'click-short',
          action: async () => {
            await page.getByRole('button', { name: 'Short' }).click()
          },
          waitFor: 200,
        },
        {
          name: 'verify-short-selected',
          action: async () => {
            const shortButton = page.getByRole('button', { name: 'Short' })
            await expect(shortButton).toHaveClass(/bg-red-500/)
          },
        },
      ],
    })
  })

  test('should update order summary when entering size', async ({ page }) => {
    await captureUserFlow(page, {
      appName: 'bazaar',
      feature: 'perps-order-summary',
      steps: [
        {
          name: 'initial-no-summary',
          action: async () => {
            // Order summary should not be visible without size
            await expect(page.getByText('Entry Price')).not.toBeVisible()
          },
        },
        {
          name: 'enter-size',
          action: async () => {
            // Find and fill the size input
            const sizeInput = page.locator('input[type="number"]').first()
            await sizeInput.fill('0.1')
          },
          waitFor: 300,
        },
        {
          name: 'verify-summary-visible',
          action: async () => {
            // Order summary should now be visible
            await expect(page.getByText('Entry Price')).toBeVisible()
            await expect(page.getByText('Required Margin')).toBeVisible()
            await expect(page.getByText('Est. Liq. Price')).toBeVisible()
            await expect(page.getByText(/Fee/)).toBeVisible()
          },
        },
      ],
    })
  })

  test('should adjust leverage slider', async ({ page }) => {
    await captureUserFlow(page, {
      appName: 'bazaar',
      feature: 'perps-leverage',
      steps: [
        {
          name: 'initial-leverage',
          action: async () => {
            // Default leverage should be 10x
            await expect(page.getByText('10x')).toBeVisible()
          },
        },
        {
          name: 'adjust-leverage',
          action: async () => {
            // Find the range input and change its value
            const leverageSlider = page.locator('input[type="range"]')
            await leverageSlider.fill('25')
          },
          waitFor: 200,
        },
        {
          name: 'verify-leverage-changed',
          action: async () => {
            await expect(page.getByText('25x')).toBeVisible()
          },
        },
      ],
    })
  })

  test('should display market info panel', async ({ page }) => {
    // Market info is in the sidebar
    await expect(page.getByText('Market Info')).toBeVisible()
    await expect(page.getByText('Max Leverage')).toBeVisible()
    await expect(page.getByText('Taker Fee')).toBeVisible()
    await expect(page.getByText('Maker Fee')).toBeVisible()
    await expect(page.getByText('Funding Interval')).toBeVisible()
    await expect(page.getByText('Open Interest')).toBeVisible()

    await captureScreenshot(page, {
      appName: 'bazaar',
      feature: 'perps',
      step: '03-market-info',
    })
  })

  test('should display open positions panel', async ({ page }) => {
    // Check positions panel
    await expect(page.getByText('Open Positions')).toBeVisible()
    
    // When no positions, should show empty state
    await expect(page.getByText('No open positions')).toBeVisible()

    await captureScreenshot(page, {
      appName: 'bazaar',
      feature: 'perps',
      step: '04-positions-panel',
    })
  })

  test('should show connect wallet button when not connected', async ({ page }) => {
    // Fill in a size to see the trade button
    const sizeInput = page.locator('input[type="number"]').first()
    await sizeInput.fill('0.1')

    // The trade button should show "Connect Wallet" when not connected
    await expect(page.getByRole('button', { name: 'Connect Wallet' })).toBeVisible()

    await captureScreenshot(page, {
      appName: 'bazaar',
      feature: 'perps',
      step: '05-connect-wallet-button',
    })
  })

  test('should show error when trying to trade with invalid size', async ({ page }) => {
    // Enter invalid size (0 or negative)
    const sizeInput = page.locator('input[type="number"]').first()
    await sizeInput.fill('0')

    // Trade button should remain disabled or show error state
    const tradeButton = page.getByRole('button', { name: /Connect Wallet|Long|Short/ })
    await expect(tradeButton).toBeDisabled()
  })

  test('should display cross-chain deposit panel when EIL is available', async ({ page }) => {
    // Cross-chain deposit panel might not be visible if EIL is not configured
    // Check for the panel or its absence gracefully
    const crossChainPanel = page.getByText('Cross-Chain Deposit')
    const isVisible = await crossChainPanel.isVisible().catch(() => false)
    
    if (isVisible) {
      await expect(page.getByText('Source Chain')).toBeVisible()
      await expect(page.getByText('Amount (USDC)')).toBeVisible()
      
      await captureScreenshot(page, {
        appName: 'bazaar',
        feature: 'perps',
        step: '06-cross-chain-deposit',
      })
    }
  })

  test('mobile view should show tab navigation', async ({ page }) => {
    // Set viewport to mobile size
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/perps')

    await captureUserFlow(page, {
      appName: 'bazaar',
      feature: 'perps-mobile',
      steps: [
        {
          name: 'mobile-initial',
          action: async () => {
            // Check for tab buttons on mobile
            await expect(page.getByRole('button', { name: 'Trade' })).toBeVisible()
            await expect(page.getByRole('button', { name: 'Positions' })).toBeVisible()
            await expect(page.getByRole('button', { name: 'Orders' })).toBeVisible()
          },
          waitFor: 300,
        },
        {
          name: 'switch-to-positions',
          action: async () => {
            await page.getByRole('button', { name: 'Positions' }).click()
          },
          waitFor: 200,
        },
        {
          name: 'verify-positions-visible',
          action: async () => {
            // Positions tab content should be visible
            await expect(page.getByText('No open positions')).toBeVisible()
          },
        },
      ],
    })
  })

  test('should calculate margin and liquidation price correctly', async ({ page }) => {
    await captureUserFlow(page, {
      appName: 'bazaar',
      feature: 'perps-calculations',
      steps: [
        {
          name: 'enter-position-details',
          action: async () => {
            // Enter size
            const sizeInput = page.locator('input[type="number"]').first()
            await sizeInput.fill('1')
            
            // Set leverage to 10x
            const leverageSlider = page.locator('input[type="range"]')
            await leverageSlider.fill('10')
          },
          waitFor: 300,
        },
        {
          name: 'verify-calculations',
          action: async () => {
            // Check that required margin and liquidation price are displayed
            await expect(page.getByText('Required Margin')).toBeVisible()
            await expect(page.getByText('Est. Liq. Price')).toBeVisible()
            
            // The values should be numeric (contain $)
            const marginText = page.locator('text=Required Margin').locator('..').getByText(/\$[\d,]+/)
            await expect(marginText).toBeVisible()
          },
        },
      ],
    })
  })

  test('should display fee estimation', async ({ page }) => {
    // Enter a position size to see fee calculation
    const sizeInput = page.locator('input[type="number"]').first()
    await sizeInput.fill('1')

    // Wait for calculations
    await page.waitForTimeout(300)

    // Check fee is displayed
    const feeText = page.getByText(/Fee/)
    await expect(feeText).toBeVisible()

    await captureScreenshot(page, {
      appName: 'bazaar',
      feature: 'perps',
      step: '07-fee-estimation',
    })
  })
})
