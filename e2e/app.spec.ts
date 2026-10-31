// End-to-end: the real page in Chromium at phone size.
import { test, expect } from 'playwright/test';

test('look test loads the 3D scene and every effect runs without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/?manual');
  await expect(page.locator('.look h1')).toHaveText('Paint Cube');
  await expect(page.locator('.look .meta')).toContainText('Look test');
  await expect(page.locator('.look')).toHaveAttribute('data-three-d', 'ok', { timeout: 15_000 });
  await expect(page.locator('.look .gl')).toBeVisible();
  for (const act of ['splat', 'splat', 'twist', 'line', 'fade', 'win', 'reset']) {
    await page.evaluate((a) => void window.__look!.act(a), act);
    for (let i = 0; i < 120; i++) await page.evaluate(() => window.__look!.advance(1 / 30, false));
  }
  await page.evaluate(() => window.__look!.advance(1 / 60, true));
  expect(errors).toEqual([]);
});
