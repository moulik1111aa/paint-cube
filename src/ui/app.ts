// The app: screens over the 3D board, and the local (pass-and-play) game controller.
// Screens: nickname (first launch) → home → local setup → match → round/match result.
// The board runs behind every screen; on menus it plays a bot-vs-bot demo.
// `?manual` freezes the clock for tests (window.__game steps it).

import { loadThree } from '../render/three.ts';
import { createBoard, type Board } from '../render/board.ts';
import { fontsReady } from '../render/street.ts';
import { Sfx } from '../audio/sfx.ts';
import { coord, type Player } from '../core/geometry.ts';
import type { Twist } from '../core/twist.ts';
import type { IllegalReason } from '../core/events.ts';
import { applyMove, checkMove, newMatch, nextRound, type MatchState, type Mode, type Move } from '../core/match.ts';
import { rotatingBotMove, cascadeBotMove } from '../sim/bot.ts';
import { rng } from '../core/rng.ts';
import { cleanName, loadPrefs, savePrefs, type Prefs } from '../storage/prefs.ts';

declare global {
  interface Window {
    __BUILD__?: { version: string; build?: string; builtAt: string };
    __game?: {
      ready: boolean;
      screen: () => string;
      tap: (cell: number) => Promise<void>;
      busy: () => boolean;
      swipe: (cell: number, dx: number, dy: number) => boolean;
      advance: (sec: number, draw?: boolean) => void;
      state: () => MatchState | null;
    };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const COLORS = ['p1', 'p2'] as const;

const REASONS: Partial<Record<IllegalReason, string>> = {
  core: "That's the Core. Nobody can paint it.",
  occupied: 'Already painted. Pick an empty cell.',
  'column-full': 'That column is full.',
  'twisted-last-turn': 'You twisted last turn.',
  'undoes-last-twist': "Can't undo the last twist.",
};

export function startApp(app: HTMLElement): void {
  const manual = new URLSearchParams(location.search).has('manual');
  const root = document.createElement('div');
  root.className = 'game';
  root.innerHTML = '<div class="stage"></div><div class="ui"></div><div class="toast" role="status"></div>';
  app.appendChild(root);
  const stage = root.querySelector('.stage') as HTMLElement;
  const ui = root.querySelector('.ui') as HTMLElement;
  const toastEl = root.querySelector('.toast') as HTMLElement;
  const sfx = new Sfx();
  let prefs: Prefs = loadPrefs();
  sfx.enabled = prefs.sound;
  let board: Board | null = null;
  let screen = 'loading';
  let match: MatchState | null = null;
  let names: [string, string] = ['Player 1', 'Player 2'];
  let busy = false;

  ui.innerHTML = '<div class="screen loading"><h1 class="logo"><span class="p1">Paint</span><span class="p2">Cube</span></h1></div>';

  let toastTimer = 0;
  const toast = (msg: string) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 1800);
  };

  // ---- menus demo: two bots paint the cube behind the menus ----
  let demo: MatchState | null = null;
  let demoTimer = 0;
  const demoRandom = rng(Date.now() % 100000);
  function startDemo(): void {
    if (!board || manual) return;
    stopDemo();
    board.attract = true;
    const mode: Mode = Math.random() < 0.5 ? 'rotating' : 'cascade';
    demo = newMatch(mode, 0);
    board.setMode(mode);
    board.sync(demo.round.cells);
    const step = async () => {
      if (!demo || !board) return;
      if (demo.round.result) {
        demo = newMatch(demo.mode === 'rotating' ? 'cascade' : 'rotating', 0);
        board.setMode(demo.mode);
        board.sync(demo.round.cells);
      } else {
        const r = demo.round;
        const mv: Move = r.mode === 'rotating' ? rotatingBotMove(r, demoRandom, 2) : cascadeBotMove(r, demoRandom, 2);
        const out = applyMove(demo, mv);
        demo = out.state;
        await board.play(out.events);
      }
      if (demo) demoTimer = window.setTimeout(() => void step(), 900 + Math.random() * 700);
    };
    demoTimer = window.setTimeout(() => void step(), 600);
  }
  function stopDemo(): void {
    clearTimeout(demoTimer);
    demo = null;
    if (board) board.twistEnabled = false;
  }

  // ---- screens ----
  function show(name: string, html: string): void {
    screen = name;
    ui.innerHTML = `<div class="screen ${name}">${html}</div>`;
  }

  function nicknameScreen(): void {
    startDemo();
    show(
      'nickname',
      `<h1 class="sr-only">Paint Cube</h1><form class="card"><label for="nick">What do we call you?</label>` +
        `<input id="nick" name="nick" maxlength="14" autocomplete="nickname" placeholder="Your tag" value="${esc(prefs.nickname)}" required>` +
        '<button class="btn big" type="submit">Let\'s go</button></form>',
    );
    const form = ui.querySelector('form') as HTMLFormElement;
    const input = ui.querySelector('#nick') as HTMLInputElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      sfx.unlock();
      const n = cleanName(input.value);
      if (!n) return input.focus();
      prefs = { ...prefs, nickname: n };
      savePrefs(prefs);
      homeScreen();
    });
  }

  function homeScreen(): void {
    if (screen !== 'nickname') startDemo();
    show(
      'home',
      `<h1 class="sr-only">Paint Cube</h1><p class="hello">Yo, <b>${esc(prefs.nickname)}</b></p>` +
        '<div class="stack"><button class="btn big" data-go="local">Play local</button>' +
        '<button class="btn big alt" data-go="online" disabled>Play online <small>soon</small></button></div>' +
        `<div class="row"><button class="link" data-go="rename">Change name</button>` +
        `<button class="link" data-go="sound">Sound: ${prefs.sound ? 'on' : 'off'}</button></div>`,
    );
    ui.querySelector('[data-go="local"]')!.addEventListener('click', () => (sfx.unlock(), localSetup()));
    ui.querySelector('[data-go="rename"]')!.addEventListener('click', nicknameScreen);
    ui.querySelector('[data-go="sound"]')!.addEventListener('click', () => {
      prefs = { ...prefs, sound: !prefs.sound };
      sfx.enabled = prefs.sound;
      savePrefs(prefs);
      homeScreen();
    });
  }

  function localSetup(): void {
    let mode: Mode = prefs.mode;
    show(
      'setup',
      '<button class="back" aria-label="Back">←</button><h2 class="tag">Local match</h2>' +
        `<div class="players"><span class="chip p1">${esc(prefs.nickname)}</span><span class="vs">vs</span>` +
        `<input class="chip p2" id="p2" maxlength="14" placeholder="Player 2" value="${esc(prefs.player2)}"></div>` +
        '<div class="modes">' +
        '<button class="mode" data-mode="rotating"><b>Twist</b><span>Place paint or twist a layer. Max 3 marks each: your oldest fades. First line of 3 wins.</span></button>' +
        '<button class="mode" data-mode="cascade"><b>Cascade</b><span>Drop paint down columns. Lines burst and score; falls chain into combos. First to 5.</span></button>' +
        '</div><button class="btn big" data-go="start">Start · best of 3</button>',
    );
    const mark = () => ui.querySelectorAll<HTMLElement>('.mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    mark();
    ui.querySelectorAll<HTMLElement>('.mode').forEach((b) =>
      b.addEventListener('click', () => {
        mode = b.dataset.mode as Mode;
        mark();
      }),
    );
    ui.querySelector('.back')!.addEventListener('click', homeScreen);
    ui.querySelector('[data-go="start"]')!.addEventListener('click', () => {
      const p2 = cleanName((ui.querySelector('#p2') as HTMLInputElement).value);
      prefs = { ...prefs, player2: p2, mode };
      savePrefs(prefs);
      names = [prefs.nickname, p2 || 'Player 2'];
      startMatch(mode);
    });
  }

  function startMatch(mode: Mode): void {
    stopDemo();
    match = newMatch(mode, 0);
    busy = false;
    if (board) {
      board.attract = false;
      board.setMode(mode);
      board.sync(match.round.cells);
    }
    matchScreen();
  }

  function matchScreen(): void {
    show(
      'match',
      '<button class="back" aria-label="Leave match">✕</button>' +
        `<div class="hud">${[0, 1].map((p) => `<div class="tagbox ${COLORS[p]}" data-p="${p}"><b>${esc(names[p])}</b><span class="dots"></span><span class="score"></span></div>`).join('<span class="round"></span>')}</div>` +
        '<p class="turn"></p>',
    );
    ui.querySelector('.back')!.addEventListener('click', () => {
      if (confirm('Leave this match?')) homeScreen();
    });
    updateHud();
  }

  function updateHud(): void {
    if (!match || screen !== 'match') return;
    const r = match.round;
    ui.querySelectorAll<HTMLElement>('.tagbox').forEach((el) => {
      const p = Number(el.dataset.p) as Player;
      el.classList.toggle('active', !r.result && r.turn === p);
      (el.querySelector('.dots') as HTMLElement).innerHTML = [0, 1].map((k) => `<i class="${k < match!.wins[p] ? 'won' : ''}"></i>`).join('');
      (el.querySelector('.score') as HTMLElement).textContent = r.mode === 'cascade' ? `${r.scores[p]} pts` : '';
    });
    (ui.querySelector('.round') as HTMLElement).textContent = `R${match.roundNumber}`;
    const turn = ui.querySelector('.turn') as HTMLElement;
    turn.className = `turn ${COLORS[r.turn]}`;
    turn.textContent = r.result ? '' : `${names[r.turn]} · ${r.mode === 'rotating' ? 'tap to paint · swipe to twist' : 'tap a column to drop'}`;
    if (board) board.twistEnabled = r.mode === 'rotating' && !r.result && !busy;
  }

  // Twists: a swipe on the cube asks first, then holds a preview until confirmed.
  function onTwistIntent(t: Twist): boolean {
    if (!match || screen !== 'match' || busy || match.round.result) return false;
    const why = checkMove(match, { kind: 'twist', twist: t });
    if (why) {
      toast(REASONS[why] ?? 'Not allowed.');
      return false;
    }
    return true;
  }
  function onTwistReady(t: Twist): void {
    const bar = document.createElement('div');
    bar.className = 'confirm';
    bar.innerHTML = '<button class="btn" data-ok>✓ Twist</button><button class="btn alt" data-no aria-label="Cancel twist">✕</button>';
    ui.querySelector('.screen')?.appendChild(bar);
    const turnEl = ui.querySelector('.turn') as HTMLElement | null;
    if (turnEl) turnEl.style.visibility = 'hidden';
    const close = () => {
      bar.remove();
      if (turnEl) turnEl.style.visibility = '';
    };
    bar.querySelector('[data-ok]')!.addEventListener('click', () => {
      close();
      void doMove({ kind: 'twist', twist: t });
    });
    bar.querySelector('[data-no]')!.addEventListener('click', () => {
      close();
      void board?.cancelTwist();
    });
  }

  async function onTap(cell: number): Promise<void> {
    if (!match || !board || screen !== 'match' || busy || match.round.result) return;
    const move: Move = match.round.mode === 'rotating' ? { kind: 'place', cell } : { kind: 'drop', column: coord(cell)[0] + 3 * coord(cell)[1] };
    const why = checkMove(match, move);
    if (why) {
      board.refuse(cell);
      toast(REASONS[why] ?? 'Not allowed.');
      return;
    }
    await doMove(move);
  }

  async function doMove(move: Move): Promise<void> {
    if (!match || !board || busy || checkMove(match, move)) return;
    busy = true;
    board.twistEnabled = false;
    const out = applyMove(match, move);
    match = out.state;
    const turnEl = ui.querySelector('.turn') as HTMLElement | null;
    if (turnEl) turnEl.textContent = '';
    await board.play(out.events);
    busy = false;
    updateHud();
    if (match.round.result) roundOver();
  }

  function roundOver(): void {
    if (!match) return;
    const w = match.round.result!.winner;
    const over = match.winner !== null;
    const title =
      w === null ? 'Draw · replay the round' : over ? `${esc(names[w])} wins the match` : `${esc(names[w])} takes round ${match.roundNumber}`;
    const overlay = document.createElement('div');
    overlay.className = `result ${w === null ? '' : COLORS[w]}`;
    overlay.innerHTML =
      `<h2>${title}</h2><p class="score">${match.wins[0]} – ${match.wins[1]}</p>` +
      (over
        ? '<div class="stack"><button class="btn big" data-go="rematch">Rematch</button><button class="btn alt" data-go="home">Home</button></div>'
        : '<button class="btn big" data-go="next">Next round</button>');
    ui.querySelector('.screen')!.appendChild(overlay);
    overlay.querySelector('[data-go="next"]')?.addEventListener('click', () => {
      match = nextRound(match!);
      board?.sync(match.round.cells);
      overlay.remove();
      updateHud();
    });
    overlay.querySelector('[data-go="rematch"]')?.addEventListener('click', () => startMatch(match!.mode));
    overlay.querySelector('[data-go="home"]')?.addEventListener('click', homeScreen);
  }

  // ---- boot ----
  Promise.all([loadThree(), fontsReady()])
    .then(([T]) => {
      board = createBoard(T, stage, sfx, manual);
      board.onTap = (c) => void onTap(c);
      board.onTwistIntent = onTwistIntent;
      board.onTwistReady = onTwistReady;
      root.dataset.threeD = 'ok';
    })
    .catch((e) => {
      console.warn(e);
      root.dataset.threeD = 'off';
      stage.innerHTML = '<div class="no3d">3D is not available on this device</div>';
    })
    .finally(() => {
      if (prefs.nickname) homeScreen();
      else nicknameScreen();
      window.__game = {
        ready: true,
        screen: () => screen,
        tap: (c) => onTap(c),
        busy: () => busy,
        swipe: (c, dx, dy) => !!board?.swipe(c, dx, dy),
        advance: (sec, draw = true) => board?.advance(sec, draw),
        state: () => match,
      };
    });
}
