// Live check of online rooms against the real Firebase project (run in CI, which can
// reach Firebase): two separate phones (browser contexts, so two anonymous players)
// play a Twist round through a real room. Run with: npx playwright test -c e2e-live
import { test, expect, type Page, type Browser } from 'playwright/test';

async function phone(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 906 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message));
  await page.addInitScript((n) => localStorage.setItem('paintcube.prefs', JSON.stringify({ nickname: n, mode: 'rotating', sound: false, voice: false, music: 'off', seenHelp: ['rotating', 'cascade', 'agents'] })), name);
  await page.goto('/?manual');
  await page.waitForFunction(() => window.__game?.ready);
  return page;
}

/** Step the clock until `cell` shows `who`'s mark and nothing is animating. */
async function waitMark(page: Page, cell: number, who: 0 | 1): Promise<void> {
  for (let i = 0; i < 600; i++) {
    await page.evaluate(() => window.__game!.advance(1 / 20, false));
    if (await page.evaluate(([c, w]) => window.__game!.state()?.round.cells[c] === w && !window.__game!.busy(), [cell, who] as const)) return;
    await page.waitForTimeout(25);
  }
  throw new Error(`cell ${cell} never showed player ${who}`);
}

async function tap(page: Page, cell: number): Promise<void> {
  await page.evaluate((c) => void window.__game!.tap(c), cell);
}

test('two phones play a Twist round through a real Firebase room', async ({ browser }) => {
  test.setTimeout(180_000);
  const host = await phone(browser, 'Moulik');
  const guest = await phone(browser, 'Riya');

  await host.click('[data-go="online"]');
  await host.click('[data-mode="rotating"]');
  await host.click('[data-go="create"]');
  await expect(host.locator('.screen.lobby .code')).toHaveText(/^[A-HJKMNP-Z2-9]{5}$/, { timeout: 30_000 });
  const code = (await host.locator('.screen.lobby .code').textContent())!;
  console.log('room', code);

  await guest.click('[data-go="online"]');
  await guest.fill('#code', code);
  await guest.click('form.join button[type="submit"]');

  await expect(host.locator('.tagbox.p2 b')).toHaveText('Riya', { timeout: 30_000 });
  await expect(guest.locator('.tagbox.p1 b')).toHaveText('Moulik', { timeout: 30_000 });
  await expect(host.locator('.turn')).toContainText('Your turn');

  // Host 0, guest 9, host 1, guest 10, host 2: the host takes round 1 on both phones.
  const moves: [Page, Page, number, 0 | 1][] = [
    [host, guest, 0, 0],
    [guest, host, 9, 1],
    [host, guest, 1, 0],
    [guest, host, 10, 1],
    [host, guest, 2, 0],
  ];
  for (const [me, other, cell, who] of moves) {
    await expect(me.locator('.turn')).toContainText('Your turn', { timeout: 30_000 });
    await tap(me, cell);
    await waitMark(me, cell, who);
    await waitMark(other, cell, who);
  }
  await expect(host.locator('.result h2')).toContainText('Moulik takes round 1', { timeout: 30_000 });
  await expect(guest.locator('.result h2')).toContainText('Moulik takes round 1', { timeout: 30_000 });

  // The host starts round 2; the guest follows.
  await host.click('[data-go="next"]');
  await expect(guest.locator('.result')).toHaveCount(0, { timeout: 30_000 });
  await expect(guest.locator('.turn')).toContainText('Your turn', { timeout: 30_000 });
});
