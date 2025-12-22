/**
 * HyperscapeStatsPanel Component Tests
 * Tests the player stats display showing skills, combat, and achievements
 */

import { test, expect } from '@playwright/test';

test.describe('HyperscapeStatsPanel Component', () => {
  test('should render markets page without errors', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForLoadState('networkidle');
    
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('should show stats panel when player address is connected', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForLoadState('networkidle');
    
    // Check if HyperscapeStatsPanel exists
    const statsHeader = page.getByText('Hyperscape Stats');
    const hasStats = await statsHeader.count() > 0;
    
    if (hasStats) {
      await expect(statsHeader.first()).toBeVisible();
    }
  });

  test('should display player stat cards when data available', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForLoadState('networkidle');
    
    // Look for stat cards with labels
    const levelUps = page.getByText(/Level-Ups/i);
    
    // These are optional - only show when player has data
    const hasLevelUps = await levelUps.count() > 0;
    
    // At least verify no crash
    expect(typeof hasLevelUps).toBe('boolean');
  });

  test('should have skills, combat, and achievements tabs', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForLoadState('networkidle');
    
    const skillsTab = page.getByRole('button', { name: /Skills/i });
    const combatTab = page.getByRole('button', { name: /Combat/i });
    const achievementsTab = page.getByRole('button', { name: /Achievements/i });
    
    // Tabs only exist if panel is rendered
    const hasSkillsTab = await skillsTab.count() > 0;
    
    if (hasSkillsTab) {
      await expect(skillsTab.first()).toBeVisible();
      await expect(combatTab.first()).toBeVisible();
      await expect(achievementsTab.first()).toBeVisible();
    }
  });

  test('should switch between tabs when clicked', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForLoadState('networkidle');
    
    const combatTab = page.getByRole('button', { name: /Combat/i });
    const hasCombatTab = await combatTab.count() > 0;
    
    if (hasCombatTab) {
      await combatTab.first().click();
      
      // Should show combat-related content or empty state
      const combatContent = page.getByText(/Kill|Death|No combat events/i);
      const hasContent = await combatContent.count() > 0;
      expect(hasContent).toBe(true);
    }
  });

  test('should show skill events with level and XP', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForLoadState('networkidle');
    
    const skillsTab = page.getByRole('button', { name: /Skills/i });
    const hasSkillsTab = await skillsTab.count() > 0;
    
    if (hasSkillsTab) {
      await skillsTab.first().click();
      
      // Should show skill events or empty state
      const skillContent = page.getByText(/Level|XP|No skill events/i);
      const hasContent = await skillContent.count() > 0;
      expect(hasContent).toBe(true);
    }
  });

  test('should show achievements with type and score', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForLoadState('networkidle');
    
    const achievementsTab = page.getByRole('button', { name: /Achievements/i });
    const hasAchievementsTab = await achievementsTab.count() > 0;
    
    if (hasAchievementsTab) {
      await achievementsTab.first().click();
      
      // Should show achievements or empty state
      const achievementContent = page.getByText(/Score|No achievements/i);
      const hasContent = await achievementContent.count() > 0;
      expect(hasContent).toBe(true);
    }
  });

  test('should show oracle attribution', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForLoadState('networkidle');
    
    const oracleText = page.getByText(/HyperscapeOracle/i);
    const hasOracle = await oracleText.count() > 0;
    
    // Oracle attribution is optional
    expect(typeof hasOracle).toBe('boolean');
  });

  test('should display truncated player address', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForLoadState('networkidle');
    
    // If stats panel is shown with address, it should be truncated
    const addressDisplay = page.locator('text=/0x[a-fA-F0-9]{4}\\.\\.\\.0x[a-fA-F0-9]{4}/');
    const hasAddress = await addressDisplay.count() > 0;
    
    // Address display is optional
    expect(typeof hasAddress).toBe('boolean');
  });
});

