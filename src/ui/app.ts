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
import { applyMove, checkMove, legalMoves, newMatch, nextRound, type MatchState, type Mode, type Move } from '../core/match.ts';
import { rotatingBotMove, cascadeBotMove } from '../sim/bot.ts';
import { rng } from '../core/rng.ts';
import { cleanName, loadMatch, loadPrefs, saveMatch, savePrefs, type HelpTopic, type Prefs } from '../storage/prefs.ts';
import {
  AGENTS, AGENT_IDS, abilitiesOf, abilityBlocked, abilityStatus, abilityUses, decorOf, isUlt, lineThrough,
  type AbilityId, type AbilityUse, type AgentId,
} from '../core/agents.ts';
import { LINES } from '../core/geometry.ts';
import { ABILITY_TEXT, AGENT_LOOK, abilityIcon, abilityText, agentArt, playPreview } from './agents-ui.ts';
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
const PLAYER_COLORS_CSS = ['#ff7a1a', '#1aa3ff'];

/** How to play, per mode (and for Agents): short cards, one idea each. */
const HELP: Record<HelpTopic, { title: string; cards: [string, string][] }> = {
  agents: {
    title: 'Agents',
    cards: [
      ['Powers', 'Each writer has 3 powers and an ultimate. On your turn use ONE of them (tap it, then tap a target), then make your normal move.'],
      ['Timers', 'A used power cools down: the number on it is how many of your turns until it’s back. Some only unlock later in a round. Every round starts fresh.'],
      ['Wet paint', 'Paint a power puts down or moves is wet (it drips), and so is your move after Shove, Overspray, Spin or Fixative. A line with wet paint only counts once it dries, a couple of its owner’s turns later, if it’s still there. So the other side always gets a reply.'],
      ['Ultimate', 'The ring fills a little every turn, and faster when you’re losing. When it’s full, your ultimate is ready. Ultimates aren’t wet: they hit straight away.'],
    ],
  },
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
  taped: 'Taped off. Nobody can paint there.',
  'locked-down': 'Locked down: no powers or twists right now.',
  sealed: 'Sealed paint: that layer can’t turn.',
  'power-used': 'One power per turn.',
  'ult-not-ready': 'Ultimate not charged yet.',
  cooldown: 'Still cooling down.',
  'no-target': 'Nothing to use that on right now.',
  'bad-target': 'Not a valid target.',
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
  /** Agents mode: the power being aimed (cells picked so far, twists for Spin/Flip). */
  let targeting: { id: AbilityId; uses: AbilityUse[]; picked: number[]; twists: Twist[] } | null = null;
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
    board.decorate(null);
    board.highlight(null);
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
    if (targeting) {
      targeting = null;
      board?.highlight(null);
    }
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
        '</div>' +
        '<button class="toggle" data-agents role="switch"><span class="txt"><b>Agents</b><span>Pick a writer with powers. Off = Classic.</span></span><i class="knob"></i></button>' +
        '<button class="btn big" data-go="start">Start · best of 3</button>',
    );
    let agentsOn = prefs.agents;
    const mark = () => {
      ui.querySelectorAll<HTMLElement>('.mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
      const t = ui.querySelector('[data-agents]') as HTMLElement;
      t.classList.toggle('on', agentsOn);
      t.setAttribute('aria-checked', String(agentsOn));
      (ui.querySelector('[data-go="start"]') as HTMLElement).textContent = agentsOn ? 'Pick agents' : 'Start · best of 3';
    };
    mark();
    ui.querySelector('[data-agents]')!.addEventListener('click', () => {
      agentsOn = !agentsOn;
      mark();
    });
    ui.querySelectorAll<HTMLElement>('.mode').forEach((b) =>
      b.addEventListener('click', () => {
        mode = b.dataset.mode as Mode;
        mark();
      }),
    );
    ui.querySelector('.back')!.addEventListener('click', homeScreen);
    ui.querySelector('[data-go="start"]')!.addEventListener('click', () => {
      const p2 = cleanName((ui.querySelector('#p2') as HTMLInputElement).value);
      prefs = { ...prefs, player2: p2, mode, agents: agentsOn };
      savePrefs(prefs);
      names = [prefs.nickname, p2 || 'Player 2'];
      if (!agentsOn) return startMatch(mode);
      const picks: [AgentId, AgentId] = [prefs.picks[0], prefs.picks[1]];
      agentSelect(0, mode, picks, () => passTo(1, () => agentSelect(1, mode, picks, () => {
        prefs = { ...prefs, picks };
        savePrefs(prefs);
        startMatch(mode, picks);
      })));
    });
  }

  // ---- Agents: select screen ----
  function agentSelect(p: Player, mode: Mode, picks: [AgentId, AgentId], then: () => void): void {
    let i = AGENT_IDS.indexOf(picks[p]);
    let stopPreview: (() => void) | null = null;
    let open: AbilityId | null = null;
    show(
      'select',
      '<button class="back" aria-label="Back">←</button>' +
        `<h2 class="tag ${COLORS[p]}">${esc(names[p])} · pick</h2>` +
        '<div class="agentcard" aria-live="polite"></div>' +
        `<div class="pickrow"><button class="arrow" data-prev aria-label="Previous agent">‹</button><div class="dots"></div><button class="arrow" data-next aria-label="Next agent">›</button></div>` +
        '<button class="btn big lockin" data-go="lock">Lock in</button>',
    );
    const card = ui.querySelector('.agentcard') as HTMLElement;
    const draw = () => {
      stopPreview?.();
      stopPreview = null;
      const id = AGENT_IDS[i];
      const a = AGENTS[id];
      const L = AGENT_LOOK[id];
      card.style.setProperty('--accent', L.accent);
      card.dataset.agent = id;
      card.innerHTML =
        `<img class="art" alt="" src="${agentArt(id)}">` +
        `<div class="who"><b>${a.name}</b><span class="role">${a.role}</span><span class="line">“${a.tagline}”</span></div>` +
        `<ul class="powers">${abilitiesOf(id)
          .map(
            (ab) =>
              `<li><button class="pw ${isUlt(ab) ? 'ult' : ''} ${open === ab ? 'open' : ''}" data-pw="${ab}">${abilityIcon(ab)}<b>${ABILITY_TEXT[ab].name}</b>` +
              `<span>${isUlt(ab) ? 'ULT · ' : ''}${ABILITY_TEXT[ab].short}</span></button>` +
              (open === ab ? `<div class="preview"><canvas width="220" height="190"></canvas><p>${abilityText(ab, mode)}</p></div>` : '') +
              '</li>',
          )
          .join('')}</ul>`;
      ui.querySelector('.pickrow .dots')!.innerHTML = AGENT_IDS.map((x, k) => `<i class="${k === i ? 'on' : ''}" style="--c:${AGENT_LOOK[x].accent}"></i>`).join('');
      card.querySelectorAll<HTMLElement>('[data-pw]').forEach((b) =>
        b.addEventListener('click', () => {
          const ab = b.dataset.pw as AbilityId;
          open = open === ab ? null : ab;
          draw();
        }),
      );
      const cv = card.querySelector('.preview canvas') as HTMLCanvasElement | null;
      if (cv && open) stopPreview = playPreview(cv, open, manual);
    };
    const step = (d: number) => {
      i = (i + d + AGENT_IDS.length) % AGENT_IDS.length;
      open = null;
      draw();
    };
    draw();
    ui.querySelector('[data-prev]')!.addEventListener('click', () => step(-1));
    ui.querySelector('[data-next]')!.addEventListener('click', () => step(1));
    let x0: number | null = null;
    card.addEventListener('pointerdown', (e) => (x0 = e.clientX));
    card.addEventListener('pointerup', (e) => {
      if (x0 !== null && Math.abs(e.clientX - x0) > 50) step(e.clientX < x0 ? 1 : -1);
      x0 = null;
    });
    ui.querySelector('.back')!.addEventListener('click', () => {
      stopPreview?.();
      localSetup();
    });
    ui.querySelector('[data-go="lock"]')!.addEventListener('click', () => {
      stopPreview?.();
      picks[p] = AGENT_IDS[i];
      sfx.unlock();
      sfx.stinger();
      haptics.win();
      splash(picks[p], 'LOCKED IN', COLORS[p], then);
    });
  }

  /** Full-screen graffiti splash with a writer's art (lock-in and ultimates). */
  function splash(id: AgentId, word: string, cls: string, then?: () => void): void {
    const el = document.createElement('div');
    el.className = `splash ${cls}`;
    el.style.setProperty('--accent', AGENT_LOOK[id].accent);
    el.innerHTML = `<img alt="" src="${agentArt(id)}"><b>${AGENTS[id].name}</b><span>${esc(word)}</span>`;
    ui.appendChild(el);
    window.setTimeout(() => {
      el.remove();
      then?.();
    }, 1000);
  }

  function passTo(p: Player, then: () => void): void {
    show(
      'pass',
      `<div class="card passcard"><p class="kicker">Pass the phone</p><h2 class="${COLORS[p]}">${esc(names[p])}</h2>` +
        `<p>Your turn to pick. No peeking, ${esc(names[p === 0 ? 1 : 0])}.</p><button class="btn big" data-go="ready">I’m ${esc(names[p])}</button></div>`,
    );
    ui.querySelector('[data-go="ready"]')!.addEventListener('click', then);
  }

  /** The how-to-play cards; `then` runs when they're closed. */
  function help(mode: HelpTopic, then?: () => void): void {
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
      board.decorate(m.agents ? decorOf(m.round, m.agents) : null);
    }
    matchScreen();
    if (m.round.result) roundOver();
  }

  /** Keep the local match on the device after every change. */
  const persist = () => {
    if (!online && match) saveMatch({ match, names });
  };

  function startMatch(mode: Mode, picks?: [AgentId, AgentId]): void {
    stopDemo();
    match = newMatch(mode, 0, picks);
    saveMatch({ match, names });
    busy = false;
    if (board) {
      board.attract = false;
      board.setMode(mode);
      board.sync(match.round.cells);
      board.decorate(match.agents ? decorOf(match.round, match.agents) : null);
    }
    matchScreen();
    const agentsHelp = () => {
      if (match?.agents && !prefs.seenHelp.includes('agents')) help('agents');
    };
    if (!prefs.seenHelp.includes(mode)) help(mode, agentsHelp);
    else agentsHelp();
  }

  function matchScreen(): void {
    show(
      'match',
      '<button class="back" aria-label="Leave match">✕</button><button class="ask" aria-label="How to play">?</button>' +
        `<div class="hud">${[0, 1]
          .map((p) => {
            const ag = match?.agents?.picks[p];
            const badge = ag ? `<span class="agent" style="--accent:${AGENT_LOOK[ag].accent}"><img alt="" src="${agentArt(ag, 60, 72, true)}">${AGENTS[ag].name}</span>` : '';
            return `<div class="tagbox ${COLORS[p]}" data-p="${p}"><b>${esc(names[p])}</b>${badge}<span class="dots"></span><span class="score"></span></div>`;
          })
          .join('<span class="round"></span>')}</div>` +
        (match?.agents ? '<div class="abilities" role="toolbar" aria-label="Powers"></div>' : '') +
        '<p class="turn"></p>',
    );
    ui.querySelector('.back')!.addEventListener('click', () => {
      if (online ? confirm('Leave the room? The match ends.') : true) homeScreen();
    });
    ui.querySelector('.ask')!.addEventListener('click', () => match && help(match.mode, () => match?.agents && help('agents')));
    updateHud();
  }

  // ---- Agents: the ability bar and targeting ----
  function renderAbilities(): void {
    const bar = ui.querySelector('.abilities') as HTMLElement | null;
    if (!bar || !match?.agents) return;
    const r = match.round;
    const p = r.turn;
    const agent = match.agents.picks[p];
    const st = abilityStatus(r, match.agents, p);
    bar.className = `abilities ${COLORS[p]}`;
    bar.style.setProperty('--accent', AGENT_LOOK[agent].accent);
    bar.hidden = !!r.result;
    bar.innerHTML = st
      .map((a) => {
        const off = !!a.blocked || busy;
        const badge = a.ult
          ? `<span class="meter" style="--f:${Math.min(1, a.pips / a.cost)}"></span><em>${a.pips >= a.cost ? 'READY' : `${a.pips}/${a.cost}`}</em>`
          : a.cooldown > 0
            ? `<em class="cd">${a.cooldown}</em>`
            : '';
        return (
          `<button class="ab ${a.ult ? 'ult' : ''} ${off ? 'off' : ''} ${targeting?.id === a.id ? 'on' : ''} ${match!.agents!.used === a.id ? 'used' : ''}" data-ab="${a.id}" ` +
          `aria-label="${ABILITY_TEXT[a.id].name}${a.cooldown ? `, ready in ${a.cooldown}` : ''}${a.ult ? `, ${a.pips} of ${a.cost}` : ''}">` +
          `${abilityIcon(a.id)}<b>${ABILITY_TEXT[a.id].name}</b>${badge}</button>`
        );
      })
      .join('');
    bar.querySelectorAll<HTMLElement>('[data-ab]').forEach((b) => b.addEventListener('click', () => onAbility(b.dataset.ab as AbilityId)));
  }

  function hint(text: string | null, withCancel = true): void {
    ui.querySelector('.hint')?.remove();
    if (!text) return;
    const el = document.createElement('div');
    el.className = 'hint';
    el.innerHTML = `<span>${text}</span>${withCancel ? '<button class="x" aria-label="Cancel power">✕</button>' : ''}`;
    ui.querySelector('.screen')?.appendChild(el);
    el.querySelector('.x')?.addEventListener('click', () => cancelTargeting());
  }

  function cancelTargeting(redraw = true): void {
    if (!targeting) return;
    targeting = null;
    board?.highlight(null);
    hint(null);
    ui.querySelector('.confirm')?.remove();
    void board?.cancelTwist();
    if (redraw) updateHud();
  }

  /** The uses still possible after the cells picked so far. */
  function consistent(t: NonNullable<typeof targeting>): AbilityUse[] {
    if (t.id === 'wetFloor') return t.uses.filter((u) => t.picked.every((c) => LINES[lineThrough(u.cells![0], u.cells![1])].includes(c)));
    return t.uses.filter((u) => t.picked.every((c, k) => u.cells![k] === c));
  }
  function candidates(t: NonNullable<typeof targeting>): number[] {
    const us = consistent(t);
    if (t.id === 'wetFloor') return [...new Set(us.flatMap((u) => [...LINES[lineThrough(u.cells![0], u.cells![1])]]))].filter((c) => !t.picked.includes(c));
    return [...new Set(us.map((u) => u.cells![t.picked.length]).filter((c) => c !== undefined))];
  }

  function onAbility(id: AbilityId): void {
    if (!match?.agents || !board || screen !== 'match' || busy || match.round.result) return;
    if (targeting?.id === id) return cancelTargeting();
    cancelTargeting(false);
    const why = abilityBlocked(match.round, match.agents, id);
    if (why) {
      toast(REASONS[why] ?? 'Not now.');
      updateHud();
      return;
    }
    const uses = abilityUses(match.round, match.agents, id);
    targeting = { id, uses, picked: [], twists: [] };
    const name = ABILITY_TEXT[id].name;
    const color = PLAYER_COLORS_CSS[match.round.turn];
    if (uses.every((u) => !u.cells?.length && !u.twists?.length)) {
      confirmUse(uses[0], `✓ ${name}`);
      hint(`${name}: ${ABILITY_TEXT[id].short.toLowerCase()}`);
    } else if (uses[0].twists?.length) {
      board.twistEnabled = true;
      hint(id === 'flip' ? 'Flip: swipe the first layer' : `${name}: swipe a layer to turn it`);
    } else {
      board.highlight(candidates(targeting), color);
      const what: Partial<Record<AbilityId, string>> = {
        shove: 'tap an enemy mark, then where it goes',
        swap: 'tap your mark, then the enemy mark next to it',
        wetFloor: 'tap cells of the line to block',
        fixative: 'tap your mark to seal',
        overspray: 'tap an enemy mark',
      };
      hint(`${name}: ${what[id] ?? 'tap a glowing cell'}`);
    }
    updateHud();
  }

  function targetTap(cell: number): void {
    const t = targeting!;
    if (t.uses[0].twists?.length && !t.uses[0].cells?.length) return; // Spin/Flip use swipes
    const cand = candidates(t);
    let c = cell;
    if (!cand.includes(c) && match!.mode === 'cascade') c = cand.find((x) => x % 9 === cell % 9) ?? cell;
    if (!cand.includes(c)) {
      board?.refuse(cell);
      toast('Pick a glowing cell.');
      return;
    }
    t.picked.push(c);
    const left = consistent(t);
    const done = t.id === 'wetFloor' ? left.length === 1 : left.length === 1 && left[0].cells!.length === t.picked.length;
    if (done) {
      void doAbility(left[0]);
      return;
    }
    board?.highlight(candidates(t), PLAYER_COLORS_CSS[match!.round.turn]);
  }

  function confirmUse(use: AbilityUse, label: string): void {
    ui.querySelector('.confirm')?.remove();
    const bar = document.createElement('div');
    bar.className = 'confirm';
    bar.innerHTML = `<button class="btn" data-ok>${esc(label)}</button><button class="btn alt" data-no aria-label="Cancel">✕</button>`;
    ui.querySelector('.screen')?.appendChild(bar);
    bar.querySelector('[data-ok]')!.addEventListener('click', () => {
      bar.remove();
      void doAbility(use);
    });
    bar.querySelector('[data-no]')!.addEventListener('click', () => {
      bar.remove();
      cancelTargeting();
    });
  }

  async function doAbility(use: AbilityUse): Promise<void> {
    if (!match?.agents || !board || busy || checkMove(match, use)) return;
    const p = match.round.turn;
    const agent = match.agents.picks[p];
    targeting = null;
    board.highlight(null);
    hint(null);
    ui.querySelector('.confirm')?.remove();
    busy = true;
    board.twistEnabled = false;
    board.setTurn(null);
    const out = applyMove(match, use);
    match = out.state;
    persist();
    renderAbilities();
    if (isUlt(use.id)) splash(agent, ABILITY_TEXT[use.id].name.toUpperCase(), COLORS[p]);
    await board.play(out.events);
    busy = false;
    board.decorate(decorOf(match.round, match.agents!));
    updateHud();
    if (match.round.result) roundOver();
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
    const how = match.agents
      ? r.mode === 'rotating'
        ? match.agents.used ? 'now paint or twist' : 'paint, twist or a power'
        : match.agents.used ? 'now drop' : 'drop or use a power'
      : r.mode === 'rotating' ? 'tap to paint · swipe to twist' : 'tap a column to drop';
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
    if (match.agents) renderAbilities();
    if (board) {
      board.twistEnabled = (r.mode === 'rotating' || (targeting?.uses[0].twists?.length ?? 0) > 0) && !r.result && !busy && !awaiting && isMyTurn();
      board.setTurn(r.result || busy || !isMyTurn() ? null : r.turn);
      board.names = [names[0], names[1]];
    }
  }

  /** Marks that fade on their owner's next placement (shown cracked). */
  const crackingOf = (m: MatchState): number[] =>
    m.round.mode === 'rotating' ? m.round.marks.flatMap((ms) => (ms.length >= MAX_MARKS ? [ms[0]] : [])) : [];

  /** Aim marker: the cell a tap would paint (Cascade: where the drop lands), if legal. */
  function aimAt(cell: number): number | null {
    if (!match || screen !== 'match' || busy || awaiting || match.round.result || !isMyTurn() || targeting) return null;
    const r = match.round;
    if (r.mode === 'rotating') return checkMove(match, { kind: 'place', cell }) ? null : cell;
    const column = coord(cell)[0] + 3 * coord(cell)[1];
    return checkMove(match, { kind: 'drop', column }) ? null : landing(r.cells, column);
  }

  // Twists: a swipe on the cube asks first, then holds a preview until confirmed.
  function onTwistIntent(t: Twist): boolean {
    if (!match || screen !== 'match' || busy || awaiting || match.round.result) return false;
    if (targeting) {
      const tg = targeting;
      const ok = tg.uses.some((u) => u.twists && JSON.stringify(u.twists[tg.twists.length]) === JSON.stringify(t));
      if (!ok) toast(REASONS.sealed && tg.id === 'spin' ? 'That layer can’t spin.' : 'Not that layer.');
      return ok;
    }
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
    if (targeting) {
      const tg = targeting;
      const twists = [...tg.twists, t];
      const need = tg.uses[0].twists!.length;
      const label = need > twists.length ? '✓ 1st layer' : `✓ ${ABILITY_TEXT[tg.id].name}`;
      const bar = document.createElement('div');
      bar.className = 'confirm';
      bar.innerHTML = `<button class="btn" data-ok>${label}</button><button class="btn alt" data-no aria-label="Cancel">✕</button>`;
      ui.querySelector('.confirm')?.remove();
      ui.querySelector('.screen')?.appendChild(bar);
      bar.querySelector('[data-ok]')!.addEventListener('click', () => {
        bar.remove();
        if (twists.length < need) {
          tg.twists = twists;
          void board?.cancelTwist();
          hint('Flip: now swipe the second layer');
          return;
        }
        if (need > 1) void board?.cancelTwist();
        const use = tg.uses.find((u) => JSON.stringify(u.twists) === JSON.stringify(twists));
        if (use) void doAbility(use);
        else cancelTargeting();
      });
      bar.querySelector('[data-no]')!.addEventListener('click', () => {
        bar.remove();
        void board?.cancelTwist();
      });
      return;
    }
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
    if (targeting) return targetTap(cell);
    if (!isMyTurn()) {
      board.refuse(cell);
      toast(`${names[match.round.turn]}'s turn.`);
      return;
    }
    if (match.agents && legalMoves(match)[0]?.kind === 'pass') {
      await doMove({ kind: 'pass' });
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
    if (match.agents) board.decorate(decorOf(match.round, match.agents));
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
      board?.decorate(match.agents ? decorOf(match.round, match.agents) : null);
      overlay.remove();
      updateHud();
    });
    overlay.querySelector('[data-go="rematch"]')?.addEventListener('click', () => startMatch(match!.mode, match!.agents?.picks));
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
      board.abilityName = (id) => ABILITY_TEXT[id].name;
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
