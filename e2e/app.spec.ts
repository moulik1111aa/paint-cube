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

test('twisting: swipe, confirm, refused when you twisted last turn, cancel changes nothing', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('paintcube.prefs', JSON.stringify({ nickname: 'Akshat', player2: 'Riya', mode: 'rotating', sound: false })));
  await page.goto('/?manual');
  await page.waitForFunction(() => window.__game?.ready);
  await page.click('[data-go="local"]');
  await page.click('[data-go="start"]');

  await tap(page, 0); // Akshat paints a corner

  // Riya swipes across the top of a corner cell: a preview holds, then she confirms.
  expect(await page.evaluate(() => window.__game!.swipe(18, 140, 0))).toBe(true);
  await expect(page.locator('.confirm [data-ok]')).toBeVisible();
  await page.click('.confirm [data-ok]');
  await settle(page);
  const after = await page.evaluate(() => window.__game!.state()!.round);
  expect(after.mode).toBe('rotating');
  expect((after as { lastTwist: unknown }).lastTwist).not.toBeNull();
  expect((after as { twistedLast: boolean[] }).twistedLast[1]).toBe(true);

  // Akshat paints; Riya cannot twist again straight away.
  const empty = await page.evaluate(() => window.__game!.state()!.round.cells.findIndex((c, i) => c === null && i !== 13));
  await tap(page, empty);
  expect(await page.evaluate(() => window.__game!.swipe(18, 140, 0))).toBe(false);
  await expect(page.locator('.toast')).toContainText('twisted last turn');
  await expect(page.locator('.confirm')).toHaveCount(0);

  // Riya paints instead; Akshat starts a twist and cancels: nothing changes.
  const empty2 = await page.evaluate(() => window.__game!.state()!.round.cells.findIndex((c, i) => c === null && i !== 13));
  await tap(page, empty2);
  const before = await page.evaluate(() => JSON.stringify(window.__game!.state()));
  expect(await page.evaluate(() => window.__game!.swipe(2, 0, 140))).toBe(true);
  await page.click('.confirm [data-no]');
  await settle(page);
  expect(await page.evaluate(() => JSON.stringify(window.__game!.state()))).toBe(before);
  expect(errors).toEqual([]);
});

test('online: create a room, a guest joins by code, moves flow both ways, host runs the rounds', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('paintcube.prefs', JSON.stringify({ nickname: 'Akshat', player2: '', mode: 'rotating', sound: false })));
  await page.goto('/?manual&memrelay');
  await page.waitForFunction(() => window.__game?.ready);
  await page.click('[data-go="online"]');
  await page.click('[data-mode="rotating"]');
  await page.click('[data-go="create"]');
  await expect(page.locator('.screen.lobby .code')).toHaveText(/^[A-HJKMNP-Z2-9]{5}$/);
  const code = (await page.locator('.screen.lobby .code').textContent())!;

  type Mem = { join: (c: string, n: string) => Promise<void>; submit: (m: unknown) => unknown };
  await page.evaluate((c) => (window as unknown as { __mem: Mem }).__mem.join(c.toLowerCase(), 'Riya'), code);
  await expect(page.locator('.tagbox.p2 b')).toHaveText('Riya');
  await expect(page.locator('.tagbox.p1')).toHaveClass(/me/);
  await expect(page.locator('.turn')).toContainText('Your turn');

  const guest = async (cell: number) => {
    expect(await page.evaluate((c) => (window as unknown as { __mem: Mem }).__mem.submit({ kind: 'place', cell: c }), cell)).toBeNull();
    // The host's state arrives and animates on the manual clock: keep stepping until it lands.
    for (let i = 0; i < 400; i++) {
      await page.evaluate(() => window.__game!.advance(1 / 20, false));
      if (await page.evaluate((c) => window.__game!.state()!.round.cells[c] === 1 && !window.__game!.busy(), cell)) break;
    }
    await settle(page);
  };
  await tap(page, 0);
  await expect(page.locator('.turn')).toContainText("Riya's turn");
  await tap(page, 4); // not my turn: refused
  await expect(page.locator('.toast')).toContainText("Riya's turn");
  await guest(9);
  await tap(page, 1);
  await guest(10);
  await tap(page, 2);
  await expect(page.locator('.result h2')).toContainText('Akshat takes round 1');
  await page.click('[data-go="next"]');
  await settle(page);
  await expect(page.locator('.turn')).toContainText("Riya's turn");
  await expect(page.locator('.result')).toHaveCount(0);
  expect(errors).toEqual([]);
});
