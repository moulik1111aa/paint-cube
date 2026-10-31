// usage: node shot.mjs out.png [dpr] [mode]
import { chromium } from 'playwright';
const [out, dprArg, mode = 'rotating'] = process.argv.slice(2);
const dpr = Number(dprArg ?? 2.5);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 412, height: 906 }, deviceScaleFactor: dpr });
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.addInitScript((m) => localStorage.setItem('paintcube.prefs', JSON.stringify({ nickname: 'Moulik', player2: 'Riya', mode: m, sound: false, seenHelp: ['rotating', 'cascade'] })), mode);
await p.goto('http://localhost:4180/?manual');
await p.waitForFunction(() => window.__game?.ready);
await p.click('[data-go="local"]');
await p.click(`[data-mode="${mode}"]`);
await p.click('[data-go="start"]');
const settle = async () => { for (let i = 0; i < 300; i++) { await p.evaluate(() => window.__game.advance(1 / 20, false)); if (!(await p.evaluate(() => window.__game.busy()))) break; } };
for (const c of (mode === 'rotating' ? [0, 4, 22, 10, 26] : [0, 4, 1, 4, 8])) { await p.evaluate((c) => void window.__game.tap(c), c); await settle(); }
await p.evaluate(() => window.__game.advance(1, false));
const t0 = Date.now();
for (let i = 0; i < 10; i++) await p.evaluate(() => window.__game.advance(1 / 60, true));
console.log('ms/frame', (Date.now() - t0) / 10);
await p.screenshot({ path: out, timeout: 180000 });
await b.close();
