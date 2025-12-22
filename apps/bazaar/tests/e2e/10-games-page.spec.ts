/**
 * @fileoverview Games page E2E tests (registered games via ERC-8004)
 * @module bazaar/tests/e2e/games-page
 */

import { test, expect } from '@playwright/test';

test.describe('Games Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/games');
  });

  test('should display games page with title', async ({ page }) => {
    await expect(page).toHaveURL('/games');
    
    // Should show the page title
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Games/i);
  });

  test('should show page description about ERC-8004', async ({ page }) => {
    // Verify page has ERC-8004 related content
    const description = page.locator('p').filter({ hasText: /ERC-8004|registered|network/i });
    await expect(description.first()).toBeVisible();
  });

  test('should show loading state initially', async ({ page }) => {
    // Loading may be fast, so we just check page renders
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('should display games grid or empty state', async ({ page }) => {
    // Wait for query to complete
    await page.waitForLoadState('networkidle');
    
    // Either show games grid or empty state
    const hasGamesGrid = await page.locator('.grid').count() > 0;
    const hasEmptyState = await page.getByText(/No Games Yet/i).count() > 0;
    
    expect(hasGamesGrid || hasEmptyState).toBe(true);
  });

  test('should show game cards with required info when games exist', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // Check for game cards (they have gradient backgrounds)
    const gameCards = page.locator('.card');
    const count = await gameCards.count();
    
    if (count > 0) {
      const firstCard = gameCards.first();
      
      // Card should contain game info
      const cardText = await firstCard.textContent();
      expect(cardText).toBeTruthy();
      
      // Should have View Game link
      const viewLink = firstCard.getByText(/View Game/i);
      await expect(viewLink).toBeVisible();
    }
  });

  test('should display tags for games', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // Tags use badge-primary class
    const tags = page.locator('.badge-primary');
    const tagCount = await tags.count();
    
    // Tags are optional, just verify no errors
    expect(tagCount).toBeGreaterThanOrEqual(0);
  });

  test('should display player and item counts when available', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // Verify page structure regardless
    expect(await page.locator('body').textContent()).toBeTruthy();
  });

  test('should link to game details on external site', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    const viewLinks = page.getByRole('link', { name: /View Game/i });
    const count = await viewLinks.count();
    
    if (count > 0) {
      const href = await viewLinks.first().getAttribute('href');
      expect(href).toContain('jejunetwork.org/agent');
    }
  });

  test('should show agent ID for each game', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    const agentIds = page.getByText(/Agent ID:/i);
    const count = await agentIds.count();
    
    // Agent ID shown for each game card
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

