// End-to-end: the real page in Chromium at phone size.
import { test, expect } from 'playwright/test';

test('title screen loads with the 3D cube and no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await expect(page.locator('.title-screen h1')).toHaveText('Paint Cube');
  await expect(page.locator('.title-screen')).toHaveAttribute('data-three-d', /^(ok|off)$/, { timeout: 15_000 });
  expect(await page.locator('.title-screen').getAttribute('data-three-d')).toBe('ok');
  await expect(page.locator('.title-screen .gl')).toBeVisible();
  expect(errors).toEqual([]);
});
