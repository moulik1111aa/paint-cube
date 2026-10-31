// The app: screens over the 3D board, and the local (pass-and-play) game controller.
// Screens: nickname (first launch) → home → local setup → match → round/match result.
// The board runs behind every screen; on menus it plays a bot-vs-bot demo.
// `?manual` freezes the clock for tests (window.__game steps it).

import { loadThree } from '../render/three.ts';
import { createBoard, type Board } from '../render/board.ts';
import { fontsReady } from '../render/street.ts';
import { Sfx } from '../audio/sfx.ts';
import { coord, type Player } from '../core/geometry.ts';
import { MAX_MARKS } from '../core/rotating.ts';
import { landing } from '../core/cascade.ts';
import type { Twist } from '../core/twist.ts';
import type { GameEvent, IllegalReason } from '../core/events.ts';
import { applyMove, checkMove, newMatch, nextRound, type MatchState, type Mode, type Move } from '../core/match.ts';
import { rotatingBotMove, cascadeBotMove } from '../sim/bot.ts';
import { rng } from '../core/rng.ts';
import { cleanName, loadMatch, loadPrefs, saveMatch, savePrefs, type Prefs } from '../storage/prefs.ts';
import { haptics } from '../platform/haptics.ts';
import { OnlineSession, CODE_LENGTH, normaliseCode, type JoinError, type RoomView } from '../net/room.ts';
import { connectFirebase } from '../net/firebase.ts';
import { FIREBASE } from '../net/config.ts';
import { MemoryHub, MemoryRelay, type Relay } from '../net/relay.ts';

declare global {
  interface Window {
    __BUILD__?: { version: string; build?: string; builtAt: string };
    __game?: {
      ready: boolean;
      screen: () => string;
      tap: (cell: number) => Promise<void>;
      busy: () => boolean;
      swipe: (cell: number, dx: number, dy: number) => boolean;
      aim: (cell: number | null) => void;
      advance: (sec: number, draw?: boolean) => void;
      state: () => MatchState | null;
    };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const COLORS = ['p1', 'p2'] as const;

/** How to play, per mode: short cards, one idea each. */
const HELP: Record<Mode, { title: string; cards: [string, string][] }> = {
  rotating: {
    title: 'Twist',
    cards: [
      ['Spray a cell', 'Tap any cell to paint it. Get 3 in a row in any direction: across a face, through the layers, or corner to corner.'],
      ['Only 3 marks', 'You can hold 3 marks. Paint a 4th and your oldest fades away. It dries out and cracks first, so you can see it coming.'],
      ['Or twist a layer', 'Swipe across the cube to turn a layer, then tap ✓. Everything on it moves. No twisting twice in a row, and no undoing the last twist.'],
      ['The Core', 'The glowing middle cell can never be painted. Best of 3 rounds, and the starter swaps each round.'],
    ],
  },
  cascade: {
    title: 'Cascade',
    cards: [
      ['Drop paint', 'Tap a column to drop your paint. It lands on the lowest free cell.'],
      ['Lines burst', 'Three in a row in any direction scores a point. The line bursts and everything above it falls.'],
      ['Chain combos', 'Falling paint can finish more lines: wave 2 scores 2 each, wave 3 scores 3. Careful, a fall can finish their lines too.'],
      ['First to 5', 'First to 5 points takes the round. Best of 3, and the starter swaps each round.'],
    ],
  },
};

const REASONS: Partial<Record<IllegalReason, string>> = {
  core: "That's the Core. Nobody can paint it.",
  'not-your-turn': 'Not your turn yet.',
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
  haptics.enabled = prefs.sound;
  let board: Board | null = null;
  let screen = 'loading';
  let match: MatchState | null = null;
  let names: [string, string] = ['Player 1', 'Player 2'];
  let busy = false;
  // Online: the session, its latest view, and animation bookkeeping.
  let online: OnlineSession | null = null;
  let view: RoomView | null = null;
  let relay: Promise<Relay> | null = null;
  let tickTimer = 0;
  let chain: Promise<void> = Promise.resolve();
  let awaiting = 0;
  let shown = '';
  const meOf = () => (online ? online.me : null);
  const isMyTurn = () => !online || (match ? match.round.turn === online.me : false);

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
    board.setTurn(null);
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
  // Android back: while off the home screen we keep one history entry, so back
  // comes here instead of closing the app. In a match it asks first.
  let deep = false;
  const HOMEISH = new Set(['home', 'nickname', 'loading']);
  window.addEventListener('popstate', () => {
    deep = false;
    const helpOpen = ui.querySelector('.help');
    if (helpOpen) {
      helpOpen.remove();
      enterDeep();
      return;
    }
    if (screen === 'match' && online && !confirm('Leave the room? The match ends.')) {
      enterDeep();
      return;
    }
    if (!HOMEISH.has(screen)) homeScreen();
  });
  function enterDeep(): void {
    if (deep) return;
    deep = true;
    try {
      history.pushState({ paintcube: 'deep' }, '');
    } catch {
      /* history unavailable */
    }
  }

  function show(name: string, html: string): void {
    if (!HOMEISH.has(name)) enterDeep();
    else if (deep) {
      // Leaving to home from a button: drop our extra entry quietly.
      deep = false;
      history.back();
    }
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
    const saved = loadMatch();
    if (screen !== 'nickname') startDemo();
    show(
      'home',
      `<h1 class="sr-only">Paint Cube</h1><p class="hello">Yo, <b>${esc(prefs.nickname)}</b></p>` +
        '<div class="stack">' +
        (saved ? `<button class="btn big resume" data-go="resume">Resume · ${esc(saved.names[0])} vs ${esc(saved.names[1])} · R${saved.match.roundNumber}</button>` : '') +
        '<button class="btn big" data-go="local">Play local</button>' +
        (onlineReady()
          ? '<button class="btn big alt" data-go="online">Play online</button></div>'
          : '<button class="btn big alt" data-go="online" disabled>Play online <small>soon</small></button></div>') +
        `<div class="row"><button class="link" data-go="rename">Change name</button>` +
        `<button class="link" data-go="sound">Sound &amp; buzz: ${prefs.sound ? 'on' : 'off'}</button></div>` +
        `<p class="build">v${esc(window.__BUILD__?.version ?? '0')} · build ${esc(String(window.__BUILD__?.build ?? 'dev'))}</p>`,
    );
    void leaveOnline();
    ui.querySelector('[data-go="local"]')!.addEventListener('click', () => (sfx.unlock(), localSetup()));
    ui.querySelector('[data-go="online"]')?.addEventListener('click', () => (sfx.unlock(), onlineMenu()));
    ui.querySelector('[data-go="resume"]')?.addEventListener('click', () => {
      if (!saved) return;
      sfx.unlock();
      names = saved.names;
      resumeMatch(saved.match);
    });
    ui.querySelector('[data-go="rename"]')!.addEventListener('click', nicknameScreen);
    ui.querySelector('[data-go="sound"]')!.addEventListener('click', () => {
      prefs = { ...prefs, sound: !prefs.sound };
      sfx.enabled = prefs.sound;
      haptics.enabled = prefs.sound;
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

  /** The how-to-play cards; `then` runs when they're closed. */
  function help(mode: Mode, then?: () => void): void {
    const h = HELP[mode];
    let i = 0;
    const overlay = document.createElement('div');
    overlay.className = 'help';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', `How to play ${h.title}`);
    const draw = () => {
      const [t, body] = h.cards[i];
      overlay.innerHTML =
        `<div class="sheet"><p class="kicker">How to play · ${h.title}</p><h2>${t}</h2><p>${body}</p>` +
        `<div class="pips">${h.cards.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>` +
        `<div class="row"><button class="link" data-skip>${i < h.cards.length - 1 ? 'Skip' : ''}</button>` +
        `<button class="btn" data-next>${i < h.cards.length - 1 ? 'Next' : "Let's play"}</button></div></div>`;
      overlay.querySelector('[data-next]')!.addEventListener('click', () => (i < h.cards.length - 1 ? (i++, draw()) : close()));
      overlay.querySelector('[data-skip]')!.addEventListener('click', close);
    };
    const close = () => {
      overlay.remove();
      if (!prefs.seenHelp.includes(mode)) {
        prefs = { ...prefs, seenHelp: [...prefs.seenHelp, mode] };
        savePrefs(prefs);
      }
      then?.();
    };
    draw();
    ui.appendChild(overlay);
  }

  function resumeMatch(m: MatchState): void {
    stopDemo();
    match = m;
    busy = false;
    if (board) {
      board.attract = false;
      board.setMode(m.mode);
      board.sync(m.round.cells, crackingOf(m));
    }
    matchScreen();
    if (m.round.result) roundOver();
  }

  /** Keep the local match on the device after every change. */
  const persist = () => {
    if (!online && match) saveMatch({ match, names });
  };

  function startMatch(mode: Mode): void {
    stopDemo();
    match = newMatch(mode, 0);
    saveMatch({ match, names });
    busy = false;
    if (board) {
      board.attract = false;
      board.setMode(mode);
      board.sync(match.round.cells);
    }
    matchScreen();
    if (!prefs.seenHelp.includes(mode)) help(mode);
  }

  function matchScreen(): void {
    show(
      'match',
      '<button class="back" aria-label="Leave match">✕</button><button class="ask" aria-label="How to play">?</button>' +
        `<div class="hud">${[0, 1].map((p) => `<div class="tagbox ${COLORS[p]}" data-p="${p}"><b>${esc(names[p])}</b><span class="dots"></span><span class="score"></span></div>`).join('<span class="round"></span>')}</div>` +
        '<p class="turn"></p>',
    );
    ui.querySelector('.back')!.addEventListener('click', () => {
      if (online ? confirm('Leave the room? The match ends.') : true) homeScreen();
    });
    ui.querySelector('.ask')!.addEventListener('click', () => match && help(match.mode));
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
    const how = r.mode === 'rotating' ? 'tap to paint · swipe to twist' : 'tap a column to drop';
    if (r.result) turn.textContent = '';
    else if (!online) turn.textContent = `${names[r.turn]} · ${how}`;
    else {
      const t = view?.timeLeft;
      const clock = t === null || t === undefined ? '' : ` · ${t}s`;
      turn.textContent = r.turn === online.me ? `Your turn${clock} · ${how}` : `${names[r.turn]}'s turn${clock}`;
    }
    ui.querySelectorAll<HTMLElement>('.tagbox').forEach((el) => el.classList.toggle('me', meOf() === Number(el.dataset.p)));
    let away = ui.querySelector('.away') as HTMLElement | null;
    if (online && view?.awayLeft !== null && view?.awayLeft !== undefined && !view.ended) {
      if (!away) {
        away = document.createElement('p');
        away.className = 'away';
        ui.querySelector('.screen')?.appendChild(away);
      }
      away.textContent = `${names[online.me === 0 ? 1 : 0]} dropped · waiting ${view.awayLeft}s`;
    } else away?.remove();
    if (board) {
      board.twistEnabled = r.mode === 'rotating' && !r.result && !busy && !awaiting && isMyTurn();
      board.setTurn(r.result || busy || !isMyTurn() ? null : r.turn);
      board.names = [names[0], names[1]];
    }
  }

  /** Marks that fade on their owner's next placement (shown cracked). */
  const crackingOf = (m: MatchState): number[] =>
    m.round.mode === 'rotating' ? m.round.marks.flatMap((ms) => (ms.length >= MAX_MARKS ? [ms[0]] : [])) : [];

  /** Aim marker: the cell a tap would paint (Cascade: where the drop lands), if legal. */
  function aimAt(cell: number): number | null {
    if (!match || screen !== 'match' || busy || awaiting || match.round.result || !isMyTurn()) return null;
    const r = match.round;
    if (r.mode === 'rotating') return checkMove(match, { kind: 'place', cell }) ? null : cell;
    const column = coord(cell)[0] + 3 * coord(cell)[1];
    return checkMove(match, { kind: 'drop', column }) ? null : landing(r.cells, column);
  }

  // Twists: a swipe on the cube asks first, then holds a preview until confirmed.
  function onTwistIntent(t: Twist): boolean {
    if (!match || screen !== 'match' || busy || awaiting || match.round.result) return false;
    if (!isMyTurn()) {
      toast(`${names[match.round.turn]}'s turn.`);
      return false;
    }
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
    if (!match || !board || screen !== 'match' || busy || awaiting || match.round.result) return;
    if (!isMyTurn()) {
      board.refuse(cell);
      toast(`${names[match.round.turn]}'s turn.`);
      return;
    }
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
    if (online) {
      // The new state (and its events) comes back through onView: at once for the
      // host, after a round trip for the guest.
      awaiting = Date.now();
      board.twistEnabled = false;
      const turnEl = ui.querySelector('.turn') as HTMLElement | null;
      if (turnEl && online.me === 1) turnEl.textContent = 'Sending…';
      const why = online.submit(move);
      if (why) {
        awaiting = 0;
        toast(REASONS[why] ?? 'Not allowed.');
        void board.cancelTwist();
        updateHud();
      }
      return;
    }
    busy = true;
    board.twistEnabled = false;
    board.setTurn(null);
    const out = applyMove(match, move);
    match = out.state;
    persist();
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
    const guest = online && online.me === 1;
    overlay.innerHTML =
      `<h2>${title}</h2><p class="score">${match.wins[0]} – ${match.wins[1]}</p>` +
      (guest
        ? `<p class="wait">Waiting for ${esc(names[0])}…</p>${over ? '<button class="btn alt" data-go="home">Home</button>' : ''}`
        : over
          ? '<div class="stack"><button class="btn big" data-go="rematch">Rematch</button><button class="btn alt" data-go="home">Home</button></div>'
          : '<button class="btn big" data-go="next">Next round</button>');
    ui.querySelector('.result')?.remove();
    ui.querySelector('.screen')!.appendChild(overlay);
    if (online) {
      overlay.querySelector('[data-go="next"]')?.addEventListener('click', () => online?.next());
      overlay.querySelector('[data-go="rematch"]')?.addEventListener('click', () => online?.next());
      overlay.querySelector('[data-go="home"]')?.addEventListener('click', homeScreen);
      return;
    }
    overlay.querySelector('[data-go="next"]')?.addEventListener('click', () => {
      match = nextRound(match!);
      persist();
      board?.sync(match.round.cells);
      overlay.remove();
      updateHud();
    });
    overlay.querySelector('[data-go="rematch"]')?.addEventListener('click', () => startMatch(match!.mode));
    overlay.querySelector('[data-go="home"]')?.addEventListener('click', homeScreen);
  }

  // ---- online ----
  // Tests: `?memrelay` plays online against an in-page relay; window.__mem drives a guest.
  const memHub = new URLSearchParams(location.search).has('memrelay') ? new MemoryHub() : null;
  const onlineReady = () => !!FIREBASE || !!memHub;
  function getRelay(): Promise<Relay> {
    if (memHub) return Promise.resolve(new MemoryRelay(memHub, 'uid-me'));
    if (!FIREBASE) return Promise.reject(new Error('online is not set up'));
    relay ??= connectFirebase(FIREBASE).catch((e) => {
      relay = null;
      throw e;
    });
    return relay;
  }

  function onlineMenu(): void {
    let mode: Mode = prefs.mode;
    show(
      'setup',
      '<button class="back" aria-label="Back">←</button><h2 class="tag">Play online</h2>' +
        '<div class="modes">' +
        '<button class="mode" data-mode="rotating"><b>Twist</b><span>Paint or twist a layer. Max 3 marks; first line of 3 wins.</span></button>' +
        '<button class="mode" data-mode="cascade"><b>Cascade</b><span>Drop paint; lines burst and chain. First to 5.</span></button>' +
        '</div><button class="btn big" data-go="create">Create room</button>' +
        `<form class="card join"><label for="code">Got a code?</label><input id="code" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC23">` +
        '<button class="btn" type="submit">Join room</button></form>',
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
    ui.querySelector('[data-go="create"]')!.addEventListener('click', () => void createRoom(mode));
    const input = ui.querySelector('#code') as HTMLInputElement;
    input.addEventListener('input', () => (input.value = normaliseCode(input.value)));
    ui.querySelector('form.join')!.addEventListener('submit', (e) => {
      e.preventDefault();
      void joinRoom(input.value);
    });
  }

  async function createRoom(mode: Mode): Promise<void> {
    prefs = { ...prefs, mode };
    savePrefs(prefs);
    toast('Opening a room…');
    try {
      const s = await OnlineSession.host(await getRelay(), prefs.nickname, mode);
      begin(s);
      lobby(s.code);
    } catch {
      toast("Couldn't reach the server. Check your internet.");
    }
  }

  async function joinRoom(typed: string): Promise<void> {
    if (normaliseCode(typed).length !== CODE_LENGTH) return toast(`Codes are ${CODE_LENGTH} characters.`);
    toast('Joining…');
    try {
      begin(await OnlineSession.join(await getRelay(), typed, prefs.nickname));
    } catch (e) {
      const msg: Record<JoinError, string> = { 'no-room': 'No room with that code.', full: 'That room is full.', expired: 'That room has closed.' };
      toast(msg[e as JoinError] ?? "Couldn't reach the server. Check your internet.");
    }
  }

  function lobby(code: string): void {
    show(
      'lobby',
      '<button class="back" aria-label="Close room">✕</button><h2 class="tag">Your room</h2>' +
        `<p class="code" aria-label="Room code">${esc(code)}</p><p class="wait">Waiting for a friend to join…</p>` +
        '<button class="btn big" data-go="share">Share code</button>',
    );
    ui.querySelector('.back')!.addEventListener('click', homeScreen);
    ui.querySelector('[data-go="share"]')!.addEventListener('click', async () => {
      const text = `Join my Paint Cube room: ${code}`;
      try {
        if (navigator.share) await navigator.share({ text });
        else {
          await navigator.clipboard.writeText(code);
          toast('Code copied.');
        }
      } catch {
        /* share sheet dismissed */
      }
    });
  }

  function begin(s: OnlineSession): void {
    online = s;
    view = null;
    shown = '';
    awaiting = 0;
    chain = Promise.resolve();
    s.connect(onView);
    clearInterval(tickTimer);
    tickTimer = window.setInterval(() => {
      online?.tick();
      // A request that got no answer: let the player try again.
      if (awaiting && Date.now() - awaiting > 6000) {
        awaiting = 0;
        void board?.cancelTwist();
        toast('Connection is slow. Try again.');
        updateHud();
      }
    }, 500);
  }

  async function leaveOnline(): Promise<void> {
    clearInterval(tickTimer);
    const s = online;
    online = null;
    view = null;
    awaiting = 0;
    if (s) await s.leave();
  }

  function onView(v: RoomView, events: GameEvent[]): void {
    view = v;
    names = v.names;
    if (v.phase === 'ended') return endedOnline(v);
    if (v.phase !== 'playing' || !v.match) return;
    if (screen !== 'match') {
      stopDemo();
      match = v.match;
      board?.setMode(match.mode);
      board?.sync(match.round.cells);
      shown = JSON.stringify(match.round.cells);
      matchScreen();
      if (!prefs.seenHelp.includes(match.mode)) help(match.mode);
      return;
    }
    const next = v.match;
    if (events.length) {
      awaiting = 0;
      chain = chain.then(async () => {
        busy = true;
        board!.twistEnabled = false;
        await board!.play(events);
        busy = false;
        match = next;
        shown = JSON.stringify(next.round.cells);
        afterOnlineUpdate();
      });
    } else
      chain = chain.then(() => {
        const roundChanged = !match || match.roundNumber !== next.roundNumber || match.winner !== next.winner;
        match = next;
        const cells = JSON.stringify(next.round.cells);
        if (cells !== shown) {
          // A new round, or a state we missed (reconnect): just show it.
          board?.sync(next.round.cells, crackingOf(next));
          shown = cells;
        }
        if (roundChanged) ui.querySelector('.result')?.remove();
        afterOnlineUpdate();
      });
  }

  function afterOnlineUpdate(): void {
    updateHud();
    if (match?.round.result && !ui.querySelector('.result')) roundOver();
    if (match && !match.round.result) ui.querySelector('.result')?.remove();
  }

  function endedOnline(v: RoomView): void {
    clearInterval(tickTimer);
    const e = v.ended!;
    const other = names[v.me === 0 ? 1 : 0];
    const title = e.reason === 'forfeit' ? (e.winner === v.me ? `${esc(other)} left · you win` : 'You were away too long') : e.reason === 'host-left' ? `${esc(names[0])} closed the room` : 'Room closed';
    if (screen !== 'match') {
      toast(title.replace(/&#\d+;/g, ''));
      if (screen === 'lobby') homeScreen();
      return;
    }
    ui.querySelector('.result')?.remove();
    const overlay = document.createElement('div');
    overlay.className = `result ${e.winner === null ? '' : COLORS[e.winner]}`;
    overlay.innerHTML = `<h2>${title}</h2><button class="btn big" data-go="home">Home</button>`;
    ui.querySelector('.screen')!.appendChild(overlay);
    overlay.querySelector('[data-go="home"]')!.addEventListener('click', homeScreen);
  }

  // ---- boot ----
  Promise.all([loadThree(), fontsReady()])
    .then(([T]) => {
      board = createBoard(T, stage, sfx, manual);
      board.onTap = (c) => void onTap(c);
      board.onTwistIntent = onTwistIntent;
      board.onTwistReady = onTwistReady;
      board.aimAt = aimAt;
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
      if (memHub) {
        let guest: OnlineSession | null = null;
        (window as unknown as { __mem: unknown }).__mem = {
          join: async (code: string, name: string) => {
            guest = await OnlineSession.join(new MemoryRelay(memHub, 'uid-guest'), code, name);
            guest.connect(() => {});
            setInterval(() => guest?.tick(), 500);
          },
          submit: (move: Move) => (guest ? guest.submit(move) : 'no guest'),
          code: () => online?.code ?? null,
        };
      }
      window.__game = {
        ready: true,
        screen: () => screen,
        tap: (c) => onTap(c),
        busy: () => busy,
        swipe: (c, dx, dy) => !!board?.swipe(c, dx, dy),
        aim: (c) => board?.aim(c),
        advance: (sec, draw = true) => board?.advance(sec, draw),
        state: () => match,
      };
    });
}
