// End-to-end: the real app in Chromium at phone size, on the manual clock
// (?manual): window.__game.advance steps the animations deterministically.
import { test, expect, type Page } from 'playwright/test';

async function settle(page: Page): Promise<void> {
  for (let i = 0; i < 400; i++) {
    await page.evaluate(() => window.__game!.advance(1 / 20, false));
    if (!(await page.evaluate(() => window.__game!.busy()))) break;
  }
  await page.evaluate(() => window.__game!.advance(1 / 60, true));
}

async function tap(page: Page, cell: number): Promise<void> {
  await page.evaluate((c) => void window.__game!.tap(c), cell);
  await settle(page);
}

test('first launch to a finished local Twist match, then a Cascade line', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => void d.accept());

  await page.goto('/?manual');
  await page.waitForFunction(() => window.__game?.ready);
  await expect(page.locator('.game')).toHaveAttribute('data-three-d', 'ok');

  // Nickname, then home.
  await page.fill('#nick', '  Akshat  ');
  await page.click('form .btn');
  await expect(page.locator('.hello')).toContainText('Akshat');

  // Local setup: Twist, Player 2 named.
  await page.click('[data-go="local"]');
  await page.fill('#p2', 'Riya');
  await page.click('[data-mode="rotating"]');
  await page.click('[data-go="start"]');
  await expect(page.locator('.tagbox.p1 b')).toHaveText('Akshat');
  await expect(page.locator('.tagbox.p2 b')).toHaveText('Riya');
  await expect(page.locator('.tagbox.p1')).toHaveClass(/active/);

  // The Core is refused with a reason.
  await tap(page, 13);
  await expect(page.locator('.toast')).toContainText('Core');

  // Round 1 (Akshat starts): Akshat paints 0, 1, 2.
  for (const c of [0, 9, 1, 10, 2]) await tap(page, c);
  await expect(page.locator('.result h2')).toContainText('Akshat takes round 1');
  await page.click('[data-go="next"]');
  await expect(page.locator('.tagbox.p2')).toHaveClass(/active/);

  // Round 2 (Riya starts): Riya paints 0, 1, 2.
  for (const c of [0, 9, 1, 10, 2]) await tap(page, c);
  await expect(page.locator('.result h2')).toContainText('Riya takes round 2');
  await page.click('[data-go="next"]');

  // Round 3: Akshat wins the match 2-1.
  for (const c of [0, 9, 1, 10, 2]) await tap(page, c);
  await expect(page.locator('.result h2')).toContainText('Akshat wins the match');
  await expect(page.locator('.result .score')).toHaveText('2 – 1');

  // Home, then a Cascade match: Akshat completes the bottom row and scores.
  await page.click('[data-go="home"]');
  await page.click('[data-go="local"]');
  await page.click('[data-mode="cascade"]');
  await page.click('[data-go="start"]');
  for (const c of [0, 3, 1, 4, 2]) await tap(page, c);
  await expect(page.locator('.tagbox.p1 .score')).toHaveText('1 pts');
  expect(await page.evaluate(() => window.__game!.state()!.round.cells.slice(0, 3))).toEqual([null, null, null]);

  // Reload: the nickname is remembered.
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready);
  await expect(page.locator('.hello')).toContainText('Akshat');
  expect(errors).toEqual([]);
});
