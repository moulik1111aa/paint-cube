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
  await page.fill('#nick', '  Moulik  ');
  await page.click('form .btn');
  await expect(page.locator('.hello')).toContainText('Moulik');
  // First time: the welcome question. Skip it; it doesn't come back.
  await expect(page.locator('.welcome h2')).toHaveText('Playing for the first time?');
  await page.click('.welcome [data-go="skip"]');
  await expect(page.locator('.welcome')).toHaveCount(0);

  // Local setup: Twist, Player 2 named.
  await page.click('[data-go="local"]');
  await page.fill('#p2', 'Riya');
  await page.click('[data-mode="rotating"]');
  await page.click('[data-go="start"]');
  // First Twist match: the how-to-play cards come up; read one, skip the rest.
  await expect(page.locator('.help h2')).toHaveText('Spray a cell');
  await page.click('.help [data-next]');
  await expect(page.locator('.help h2')).toHaveText('Only 3 marks');
  await page.click('.help [data-skip]');
  await expect(page.locator('.help')).toHaveCount(0);
  await expect(page.locator('.tagbox.p1 b')).toHaveText('Moulik');
  await expect(page.locator('.tagbox.p2 b')).toHaveText('Riya');
  await expect(page.locator('.tagbox.p1')).toHaveClass(/active/);

  // The Core is refused with a reason.
  await tap(page, 13);
  await expect(page.locator('.toast')).toContainText('Core');

  // Round 1 (Moulik starts): Moulik paints 0, 1, 2.
  for (const c of [0, 9, 1, 10, 2]) await tap(page, c);
  await expect(page.locator('.result h2')).toContainText('Moulik takes round 1');
  await page.click('[data-go="next"]');
  await expect(page.locator('.tagbox.p2')).toHaveClass(/active/);

  // Round 2 (Riya starts): Riya paints 0, 1, 2.
  for (const c of [0, 9, 1, 10, 2]) await tap(page, c);
  await expect(page.locator('.result h2')).toContainText('Riya takes round 2');
  await page.click('[data-go="next"]');

  // Round 3: Moulik wins the match 2-1.
  for (const c of [0, 9, 1, 10, 2]) await tap(page, c);
  await expect(page.locator('.result h2')).toContainText('Moulik wins the match');
  await expect(page.locator('.result .score')).toHaveText('2 – 1');

  // Home, then a Cascade match: Moulik completes the bottom row and scores.
  await page.click('[data-go="home"]');
  await page.click('[data-go="local"]');
  await page.click('[data-mode="cascade"]');
  await page.click('[data-go="start"]');
  await page.click('.help [data-skip]');
  for (const c of [0, 3, 1, 4, 2]) await tap(page, c);
  await expect(page.locator('.tagbox.p1 .score')).toHaveText('1 pts');
  expect(await page.evaluate(() => window.__game!.state()!.round.cells.slice(0, 3))).toEqual([null, null, null]);

  // Back leaves the match, which is saved: Resume brings it back as it was.
  await page.goBack();
  await expect(page.locator('.hello')).toContainText('Moulik');
  await expect(page.locator('[data-go="resume"]')).toContainText('Moulik vs Riya · R1');
  await page.click('[data-go="resume"]');
  await expect(page.locator('.tagbox.p1 .score')).toHaveText('1 pts');
  await page.click('.back');
  // The help is not shown again.
  await page.click('[data-go="local"]');
  await page.click('[data-mode="cascade"]');
  await page.click('[data-go="start"]');
  await expect(page.locator('.help')).toHaveCount(0);

  // Reload (the app was closed): the nickname and the match in progress are remembered.
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready);
  await expect(page.locator('.hello')).toContainText('Moulik');
  await expect(page.locator('[data-go="resume"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('twisting: swipe, confirm, refused when you twisted last turn, cancel changes nothing', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('paintcube.prefs', JSON.stringify({ welcomed: true, nickname: 'Moulik', player2: 'Riya', mode: 'rotating', sound: false, seenHelp: ['rotating', 'cascade'] })));
  await page.goto('/?manual');
  await page.waitForFunction(() => window.__game?.ready);
  await page.click('[data-go="local"]');
  await page.click('[data-go="start"]');

  await tap(page, 0); // Moulik paints a corner

  // Riya swipes across the top of a corner cell: a preview holds, then she confirms.
  expect(await page.evaluate(() => window.__game!.swipe(18, 140, 0))).toBe(true);
  await expect(page.locator('.confirm [data-ok]')).toBeVisible();
  await page.click('.confirm [data-ok]');
  await settle(page);
  const after = await page.evaluate(() => window.__game!.state()!.round);
  expect(after.mode).toBe('rotating');
  expect((after as { lastTwist: unknown }).lastTwist).not.toBeNull();
  expect((after as { twistedLast: boolean[] }).twistedLast[1]).toBe(true);

  // Moulik paints; Riya cannot twist again straight away.
  const empty = await page.evaluate(() => window.__game!.state()!.round.cells.findIndex((c, i) => c === null && i !== 13));
  await tap(page, empty);
  expect(await page.evaluate(() => window.__game!.swipe(18, 140, 0))).toBe(false);
  await expect(page.locator('.toast')).toContainText('twisted last turn');
  await expect(page.locator('.confirm')).toHaveCount(0);

  // Riya paints instead; Moulik starts a twist and cancels: nothing changes.
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
  await page.addInitScript(() => localStorage.setItem('paintcube.prefs', JSON.stringify({ welcomed: true, nickname: 'Moulik', player2: '', mode: 'rotating', sound: false, seenHelp: ['rotating', 'cascade'] })));
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
  await expect(page.locator('.result h2')).toContainText('Moulik takes round 1');
  await page.click('[data-go="next"]');
  await settle(page);
  await expect(page.locator('.turn')).toContainText("Riya's turn");
  await expect(page.locator('.result')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('agents (Pro abilities): toggle on, both players lock in, a targeted power, cooldown, the ultimate charges and fires', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem('paintcube.prefs', JSON.stringify({ welcomed: true, nickname: 'Moulik', player2: 'Riya', mode: 'rotating', sound: false, seenHelp: ['rotating', 'cascade'], pro: true })),
  );
  await page.goto('/?manual');
  await page.waitForFunction(() => window.__game?.ready);
  await page.click('[data-go="local"]');
  await page.click('[data-mode="rotating"]');
  await expect(page.locator('[data-agents]')).not.toHaveClass(/on/);
  await page.click('[data-agents]');
  await expect(page.locator('[data-go="start"]')).toHaveText('Pick agents');
  await page.click('[data-go="start"]');

  // Moulik browses to STENCIL, peeks at a power preview, and locks in.
  await expect(page.locator('.agentcard .who b')).toHaveText('BLITZ');
  await page.click('[data-next]');
  await expect(page.locator('.agentcard .who b')).toHaveText('STENCIL');
  await page.click('[data-pw="tape"]');
  await expect(page.locator('.preview canvas')).toBeVisible();
  await page.click('[data-go="lock"]');
  await expect(page.locator('.splash')).toContainText('LOCKED IN');
  await expect(page.locator('.passcard h2')).toHaveText('Riya');
  await page.click('[data-go="ready"]');
  // Riya picks BLITZ (left of STENCIL).
  await expect(page.locator('.tag')).toContainText('Riya');
  await expect(page.locator('.agentcard .who b')).toHaveText('STENCIL');
  await page.click('[data-prev]');
  await expect(page.locator('.agentcard .who b')).toHaveText('BLITZ');
  await page.click('[data-go="lock"]');

  // The first agents match opens the show-me tutorial on the cube; close it.
  await expect(page.locator('.lesson .kicker')).toContainText('Using a power');
  await expect(page.locator('.lesson .say p')).toContainText('Blitz');
  await page.click('.lesson [data-close]');
  await expect(page.locator('.lesson')).toHaveCount(0);

  // The Powers button reviews both writers, with a show-me for each power.
  await page.click('.powersbtn');
  await expect(page.locator('.review .rlist li')).toHaveCount(4);
  await page.click('.review [data-tab="1"]');
  await expect(page.locator('.review .rlist')).toContainText('Overspray');
  await page.click('.review [data-show="overspray"]');
  await expect(page.locator('.lesson .kicker')).toContainText('Overspray');
  expect(await page.evaluate(() => window.__game!.lesson())).toBe(true);
  await page.click('.lesson [data-close]');
  await expect(page.locator('.review')).toBeVisible();
  await page.click('.review [data-close]');
  expect(await page.evaluate(() => window.__game!.state()!.round.cells.every((c) => c === null))).toBe(true);
  await expect(page.locator('.abilities .ab')).toHaveCount(4);
  await expect(page.locator('.tagbox.p1 .agent')).toContainText('STENCIL');
  await expect(page.locator('.tagbox.p2 .agent')).toContainText('BLITZ');
  expect(await page.evaluate(() => window.__game!.state()!.agents!.picks)).toEqual(['stencil', 'blitz']);

  // Tape with targeting: tap the power, cells glow, tap one.
  await page.click('.ab[data-ab="tape"]');
  await expect(page.locator('.hint')).toContainText('Tape');
  await expect(page.locator('.ab[data-ab="tape"]')).toHaveClass(/on/);
  await tap(page, 4);
  const effects = await page.evaluate(() => window.__game!.state()!.agents!.effects);
  expect(effects).toEqual([expect.objectContaining({ kind: 'tape', cell: 4, by: 0 })]);
  await expect(page.locator('.ab[data-ab="tape"] .cd')).toHaveText('2');
  await expect(page.locator('.ab[data-ab="fixative"]')).toHaveClass(/off/); // one power per turn
  await tap(page, 0); // then the normal move

  // Riya can't paint the taped cell.
  await tap(page, 4);
  await expect(page.locator('.toast')).toContainText('Taped');
  await tap(page, 9);

  // Two more rounds of moves: the cooldown ticks down, the ultimate ring fills.
  // (A cooldown counts the turns it stays out: 2 now, 1 next turn, then ready.)
  await expect(page.locator('.ab[data-ab="tape"] .cd')).toHaveText('2');
  await expect(page.locator('.ab[data-ab="tape"]')).toHaveClass(/off/);
  await expect(page.locator('.ab[data-ab="lockdown"] em')).toHaveText('1/6');
  await tap(page, 20);
  await tap(page, 11);
  await expect(page.locator('.ab[data-ab="tape"] .cd')).toHaveText('1');
  await expect(page.locator('.ab[data-ab="lockdown"] em')).toHaveText('2/6');
  await tap(page, 24);
  await tap(page, 15);
  await expect(page.locator('.ab[data-ab="tape"] .cd')).toHaveCount(0);
  await expect(page.locator('.ab[data-ab="tape"]')).not.toHaveClass(/off/);
  await expect(page.locator('.ab[data-ab="lockdown"] em')).toHaveText('3/6');
  await tap(page, 26);
  await tap(page, 17);
  await tap(page, 2);
  await tap(page, 7);
  await tap(page, 20);
  await tap(page, 11);
  await expect(page.locator('.ab[data-ab="lockdown"] em')).toHaveText('READY');

  // Fire the ultimate: confirm, splash, and Riya is locked down.
  await page.click('.ab[data-ab="lockdown"]');
  await page.click('.confirm [data-ok]');
  await expect(page.locator('.splash')).toContainText('LOCKDOWN');
  await settle(page);
  expect(await page.evaluate(() => window.__game!.state()!.agents!.effects.some((e) => e.kind === 'lockdown'))).toBe(true);
  expect(await page.evaluate(() => window.__game!.state()!.agents!.ult[0])).toBe(0);
  await tap(page, 18);
  await expect(page.locator('.abilities')).toHaveClass(/p2/);
  await expect(page.locator('.ab[data-ab="shove"]')).toHaveClass(/off/);
  expect(await page.evaluate(() => window.__game!.swipe(2, 140, 0))).toBe(false);
  await expect(page.locator('.toast')).toContainText('Locked down');

  // Leaving and resuming keeps the agents match.
  await page.click('.back');
  await page.click('[data-go="resume"]');
  await expect(page.locator('.tagbox.p1 .agent')).toContainText('STENCIL');
  await expect(page.locator('.abilities')).toHaveClass(/p2/);
  expect(errors).toEqual([]);
});

test('vs PC: the PC answers every move, in Classic and with agents, and the match resumes against it', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem('paintcube.prefs', JSON.stringify({ welcomed: true, nickname: 'Moulik', mode: 'rotating', sound: false, voice: false, seenHelp: ['rotating', 'cascade', 'agents'] })),
  );
  await page.goto('/?manual');
  await page.waitForFunction(() => window.__game?.ready);
  await page.click('[data-go="pc"]');
  await expect(page.locator('.tag')).toHaveText('Vs PC');
  await page.click('[data-level="easy"]');
  await expect(page.locator('[data-level="easy"]')).toHaveClass(/on/);
  await page.click('[data-mode="rotating"]');
  await page.click('[data-go="start"]');
  await expect(page.locator('.tagbox.p2 b')).toHaveText('PC');

  const painted = () => page.evaluate(() => window.__game!.state()!.round.cells.filter((c) => c !== null).length);
  await tap(page, 0);
  await settle(page);
  expect(await painted()).toBe(2);
  await expect(page.locator('.tagbox.p1')).toHaveClass(/active/);
  // It's not the player's turn while the PC moves, and the PC's mark is player 2's.
  expect(await page.evaluate(() => window.__game!.state()!.round.cells.filter((c) => c === 1).length)).toBe(1);

  // Leave and resume: still against the PC.
  await page.click('.back');
  await expect(page.locator('[data-go="resume"]')).toContainText('vs PC (easy)');
  await page.click('[data-go="resume"]');
  await page.waitForFunction(() => !window.__game!.busy());
  // An empty cell (the easy PC plays loosely, so it may have taken any of them).
  const free = await page.evaluate(() => [2, 6, 8, 18, 20, 24, 26].find((c) => window.__game!.state()!.round.cells[c] === null)!);
  await tap(page, free);
  await settle(page);
  expect(await painted()).toBe(4);

  // Agents vs PC: pick a writer, the PC picks its own, and it plays its turns.
  await page.click('.back');
  await page.click('[data-go="pc"]');
  await page.click('[data-agents]');
  await page.click('[data-go="start"]');
  await page.click('[data-go="lock"]');
  await expect(page.locator('.splash')).toContainText('PC PICKS');
  await expect(page.locator('.abilities .ab')).toHaveCount(4);
  expect(await page.evaluate(() => !!window.__game!.state()!.agents)).toBe(true);
  await tap(page, 0);
  await settle(page);
  await expect(page.locator('.tagbox.p1')).toHaveClass(/active/);
  expect(await page.evaluate(() => window.__game!.state()!.round.turns)).toBe(2);
  expect(errors).toEqual([]);
});

test('trial: try a writer against an easy PC with every power ready each turn; wet rows say when they count (Pro)', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem('paintcube.prefs', JSON.stringify({ welcomed: true, nickname: 'Moulik', mode: 'rotating', sound: false, voice: false, pro: true, seenHelp: ['rotating', 'cascade', 'agents'] })),
  );
  await page.goto('/?manual');
  await page.waitForFunction(() => window.__game?.ready);
  await page.click('[data-go="trial"]');
  await expect(page.locator('.tag')).toHaveText('Trial mode');
  await page.click('[data-mode="rotating"]');
  await page.click('[data-go="start"]');
  await page.click('[data-go="lock"]'); // BLITZ
  await expect(page.locator('.turn')).toContainText('Trial');
  // Double Tap is ready on turn one (normally it unlocks later), and so is the ultimate.
  await expect(page.locator('.ab[data-ab="doubleTap"]')).not.toHaveClass(/off/);
  await expect(page.locator('.ab[data-ab="chrome"] em')).toHaveText('READY');
  await page.click('.ab[data-ab="doubleTap"]');
  await tap(page, 1);
  await tap(page, 2);
  await settle(page);
  // After the PC's turn, Double Tap is ready again.
  await expect(page.locator('.tagbox.p1')).toHaveClass(/active/);
  await expect(page.locator('.ab[data-ab="doubleTap"] .cd')).toHaveCount(0);
  await expect(page.locator('.ab[data-ab="doubleTap"]')).not.toHaveClass(/off/);
  // Finish the top-back row with a wet mark if it's open: the note says when it counts.
  if (await page.evaluate(() => window.__game!.state()!.round.cells[0] === null)) {
    await page.click('.ab[data-ab="doubleTap"]');
    await tap(page, 0);
    await expect(page.locator('.wetnote')).toContainText('is wet');
    await expect(page.locator('.wetnote')).toContainText('turn after next');
  }
  // Trial matches aren't saved.
  await page.click('.back');
  await expect(page.locator('[data-go="resume"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Simple abilities (default): once per round, no finishing your own row on a power turn, age numbers', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem('paintcube.prefs', JSON.stringify({ welcomed: true, nickname: 'Moulik', player2: 'Riya', mode: 'rotating', sound: false, voice: false, seenHelp: ['rotating', 'cascade', 'agents'], agents: true, picks: ['blitz', 'stencil'] })),
  );
  await page.goto('/?manual');
  await page.waitForFunction(() => window.__game?.ready);
  await page.click('[data-go="local"]');
  await expect(page.locator('[data-pro]')).not.toHaveClass(/on/);
  await page.click('[data-go="start"]');
  await page.click('[data-go="lock"]'); // Moulik: BLITZ
  await page.click('[data-go="ready"]');
  await page.click('[data-go="lock"]'); // Riya: STENCIL
  await expect(page.locator('.abilities .ab')).toHaveCount(4);
  expect(await page.evaluate(() => window.__game!.state()!.agents!.simple)).toBe(true);
  await expect(page.locator('.tagbox.p2 .agent')).toContainText('STENCIL');
  // Moulik: 0, Riya: 9, Moulik: 1, Riya: 10. Now Moulik could finish 0-1-2...
  for (const c of [0, 9, 1, 10]) await tap(page, c);
  // ...but after a power (Overspray on 9) the row can't be finished this turn.
  await page.click('.ab[data-ab="overspray"]');
  await tap(page, 9);
  await tap(page, 2);
  await expect(page.locator('.toast')).toContainText('Power turn');
  expect(await page.evaluate(() => window.__game!.state()!.round.cells[2])).toBeNull();
  await expect(page.locator('.ab[data-ab="overspray"] .cd.done')).toHaveCount(1);
  await tap(page, 20);
  expect(await page.evaluate(() => window.__game!.state()!.round.result)).toBeNull();
  // Stencil has the Simple powers.
  await expect(page.locator('.ab[data-ab="shield"]')).toHaveCount(1);
  await expect(page.locator('.ab[data-ab="relocate"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a match started while the menu demo is mid-twist or mid-burst starts on a clean board', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem('paintcube.prefs', JSON.stringify({ welcomed: true, nickname: 'Moulik', mode: 'rotating', sound: false, voice: false, music: 'off', seenHelp: ['rotating', 'cascade', 'agents'], firstRun: false })),
  );
  await page.goto('/?manual');
  await page.waitForFunction(() => window.__game?.ready);
  // The demo board: marks all over the left layer (x = 0) plus a few more, then a twist of
  // that layer starts animating, the way the menu demo does it.
  const cells: (0 | 1 | null)[] = Array(27).fill(null);
  [0, 6, 18, 24].forEach((c) => (cells[c] = 0));
  [3, 9, 21, 1].forEach((c) => (cells[c] = 1));
  await page.evaluate((cs) => window.__game!.demoPlay(cs, [{ type: 'twisted', twist: { axis: 0, slice: 0, dir: 1 }, moves: [], player: 0 }]), cells);
  await page.evaluate(() => window.__game!.advance(0.15, true)); // mid-turn
  expect((await page.evaluate(() => window.__game!.marksShown())).length).toBe(8);

  await page.click('[data-go="local"]');
  await page.click('[data-mode="rotating"]');
  await page.click('[data-go="start"]');
  for (let i = 0; i < 30; i++) await page.evaluate(() => window.__game!.advance(1 / 20, false));
  expect(await page.evaluate(() => window.__game!.state()!.round.cells.filter((c) => c !== null).length)).toBe(0);
  expect(await page.evaluate(() => window.__game!.marksShown())).toEqual([]);

  // The same with a line bursting (Cascade's demo) and a mark fading (Twist's 3-mark cap).
  await page.click('.back');
  const line: (0 | 1 | null)[] = Array(27).fill(null);
  [0, 1, 2].forEach((c) => (line[c] = 0));
  line[5] = 1;
  await page.evaluate(
    (cs) =>
      window.__game!.demoPlay(cs, [
        { type: 'faded', cell: 5, player: 1 },
        { type: 'lineCompleted', cells: [0, 1, 2], player: 0, wave: 1 },
      ] as never),
    line,
  );
  await page.evaluate(() => window.__game!.advance(0.1, true));
  await page.click('[data-go="local"]');
  await page.click('[data-mode="rotating"]');
  await page.click('[data-go="start"]');
  for (let i = 0; i < 40; i++) await page.evaluate(() => window.__game!.advance(1 / 20, false));
  expect(await page.evaluate(() => window.__game!.marksShown())).toEqual([]);
  // And the first real mark lands where it was painted, nowhere else.
  await page.evaluate(() => void window.__game!.tap(4));
  for (let i = 0; i < 40; i++) await page.evaluate(() => window.__game!.advance(1 / 20, false));
  expect(await page.evaluate(() => window.__game!.marksShown())).toEqual([4]);
  expect(errors).toEqual([]);
});

test('first time: say yes, watch the demo, then the coach guides you to a win against the computer', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem('paintcube.prefs', JSON.stringify({ nickname: 'Moulik', mode: 'rotating', sound: false, voice: false, music: 'off', seenHelp: [] })),
  );
  await page.goto('/?manual');
  await page.waitForFunction(() => window.__game?.ready);
  await expect(page.locator('.welcome h2')).toHaveText('Playing for the first time?');
  await page.click('.welcome [data-go="teach"]');

  // The demo: step through to the end (each step plays on the manual clock).
  await expect(page.locator('.lesson .kicker')).toContainText('How to play');
  for (let i = 0; i < 20; i++) {
    const next = page.locator('.lesson [data-next]');
    if (!(await next.count())) break;
    // The step's moves animate on the manual clock: step it until Next is enabled.
    for (let k = 0; k < 600 && (await next.isDisabled()); k++) await page.evaluate(() => window.__game!.advance(1 / 20, false));
    await expect(next).toBeEnabled();
    const label = (await next.textContent()) ?? '';
    await next.click();
    if (label.includes('Now you try')) break;
  }
  // The practice game: the coach card, the first block glowing.
  await expect(page.locator('.coach')).toContainText('Tap the glowing block');
  await expect(page.locator('.tagbox.p2 b')).toHaveText('PC');
  // A different block is refused with a pointer to the glowing one.
  await tap(page, 0);
  await expect(page.locator('.toast')).toContainText('glowing block');
  expect(await page.evaluate(() => window.__game!.state()!.round.cells.filter((c) => c !== null).length)).toBe(0);

  // Follow the coach: 8, 15, 23 (the block), 16 (your oldest fades); the computer replies each time.
  for (const [cell, total] of [[8, 2], [15, 4], [23, 6], [16, 7]] as const) {
    await tap(page, cell);
    for (let i = 0; i < 200; i++) {
      await page.evaluate(() => window.__game!.advance(1 / 20, false));
      const s = await page.evaluate(() => ({ turn: window.__game!.state()!.round.turn, busy: window.__game!.busy() }));
      if (s.turn === 0 && !s.busy) break;
    }
    await settle(page);
    // (After 16 your 4th mark fades your oldest, and the computer's 4th fades its own.)
    expect(await page.evaluate(() => window.__game!.state()!.round.cells.filter((c) => c !== null).length)).toBe(total === 7 ? 6 : total);
  }
  // Last turn: twist. A tap is refused; "Do it for me" makes the twist and wins.
  await expect(page.locator('.coach')).toContainText('twist');
  await tap(page, 25);
  await expect(page.locator('.toast')).toContainText('twist');
  await page.click('.coach [data-showme]');
  await settle(page);
  await expect(page.locator('.result h2')).toContainText('You won');
  expect(await page.evaluate(() => window.__game!.state()!.round.result?.winner)).toBe(0);
  // Practice isn't saved as a match to resume, and the welcome doesn't come back.
  await page.click('.result [data-go="home"]');
  await expect(page.locator('[data-go="resume"]')).toHaveCount(0);
  await expect(page.locator('.welcome')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('read aloud is off by default, even for an old install that had it on, and only Settings turns it on', async ({ page }) => {
  // An install from before build 24: voice was saved as on (the old default).
  await page.addInitScript(() =>
    localStorage.setItem('paintcube.prefs', JSON.stringify({ welcomed: true, nickname: 'Moulik', mode: 'rotating', sound: false, voice: true, music: 'off', seenHelp: [] })),
  );
  await page.goto('/?manual');
  await page.waitForFunction(() => window.__game?.ready);
  await page.click('[data-go="settings"]');
  const sw = page.locator('.settings [data-set="voice"]');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  // No read-aloud buttons in the tutorial or the how-to-play cards.
  await page.click('.settings [data-close]');
  await page.click('[data-go="learn"]');
  await expect(page.locator('.lesson')).toBeVisible();
  await expect(page.locator('[data-voice]')).toHaveCount(0);
  await page.click('.lesson [data-close]');
  // Turned on in Settings, it stays on after a reload.
  await page.click('[data-go="settings"]');
  await page.click('.settings [data-set="voice"]');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('paintcube.prefs')!);
    if (p.voice !== true || p.voicePicked !== true) throw new Error('voice not saved');
  });
});
