// The app: screens over the 3D board, and the local (pass-and-play) game controller.
// Screens: nickname (first launch) → home → local setup → match → round/match result.
// The board runs behind every screen; on menus it plays a bot-vs-bot demo.
// `?manual` freezes the clock for tests (window.__game steps it).

import { loadThree } from '../render/three.ts';
import { createBoard, type Board } from '../render/board.ts';
import { fontsReady } from '../render/street.ts';
import { Sfx } from '../audio/sfx.ts';
import { Music, TRACKS, type TrackId } from '../audio/music.ts';
import { coord, type Player } from '../core/geometry.ts';
import { MAX_MARKS } from '../core/rotating.ts';
import { landing } from '../core/cascade.ts';
import type { Twist } from '../core/twist.ts';
import type { GameEvent, IllegalReason } from '../core/events.ts';
import { applyMove, checkMove, legalMoves, newMatch, nextRound, type MatchState, type Mode, type Move } from '../core/match.ts';
import { rotatingBotMove, cascadeBotMove, agentBotTurn } from '../sim/bot.ts';
import { rng } from '../core/rng.ts';
import { cleanName, loadMatch, loadPrefs, saveMatch, savePrefs, type HelpTopic, type PcLevel, type Prefs } from '../storage/prefs.ts';
import {
  AGENTS, AGENT_IDS, abilitiesOf, abilityBlocked, abilityStatus, abilityUses, decorOf, isUlt, lineThrough,
  ONCE, type AbilityId, type AbilityUse, type AgentId, type AgentsState, type AgentRound,
} from '../core/agents.ts';
import { CENTER, LINES } from '../core/geometry.ts';
import { ABILITY_TEXT, AGENT_LOOK, abilityIcon, abilityText, agentArt, playPreview } from './agents-ui.ts';
import { haptics } from '../platform/haptics.ts';
import { voice } from '../platform/voice.ts';
import { abilityLesson, lessonMove, lessonStart, stepMoves, topicLesson, topicsFor, type Lesson, type Topic } from './lessons.ts';
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
      lesson: () => boolean;
    };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const COLORS = ['p1', 'p2'] as const;
import { THEMES, playerCss, setTheme, theme, type ThemeId } from '../theme.ts';
let PLAYER_COLORS_CSS = playerCss();

/** How to play, per mode (and for Agents): short cards, one idea each. */
/** Agents how-to cards for the Simple rules. */
const HELP_SIMPLE: { title: string; cards: [string, string, Topic?][] } = {
  title: 'Agents',
  cards: [
    ['Using a power', 'Your writer has 3 powers and an ultimate, in the bar at the bottom. On your turn: tap a power, tap a glowing cell, then make your normal move.', 'powers'],
    ['Power turns', 'One rule to remember: on a turn you use a power, you can’t finish a line of your own. Finish it on a later turn, if it’s still open.', 'powerTurn'],
    ['Once a round', 'Each power works once per round. A used power shows a tick. Every new round, they’re all ready again.', 'timers'],
    ['Ultimate', 'The last button’s ring fills a bit every turn. When it says READY, fire it: it’s your writer’s big move.', 'ult'],
  ],
};

const HELP: Record<HelpTopic, { title: string; cards: [string, string, Topic?][] }> = {
  agents: {
    title: 'Agents',
    cards: [
      ['Using a power', 'Your writer has 3 powers and an ultimate, in the bar at the bottom. On your turn: tap a power, tap a glowing cell, then make your normal move.', 'powers'],
      ['Wet paint', '<b>What it does:</b> wet paint drips. A row with wet paint in it doesn’t count yet (in Cascade, it doesn’t burst or score yet).<br><b>What makes paint wet:</b> paint a power puts down or moves; your move on a turn you used Shove, Overspray, Spin or Fixative (in Twist, also Flip or Rewind); your next mark after the other player uses Delay.<br><b>When it dries:</b> at the start of your turn after next. If the row is still whole then, it counts. So the other player gets two turns to break it.', 'wet'],
      ['Timers', 'After you use a power, a number shows on it: how many of your turns until it’s back. Every round starts fresh.', 'timers'],
      ['Ultimate', 'The last button’s ring fills every turn, and faster when you lose a round. When it says READY, fire it: it’s your writer’s big move.', 'ult'],
    ],
  },
  rotating: {
    title: 'Twist',
    cards: [
      ['Spray a cell', 'Tap any cell to paint it. Get 3 in a row in any direction: across a face, through the layers, or corner to corner.'],
      ['Only 3 marks', 'You can hold 3 marks. Paint a 4th and your oldest fades away. The numbers on your marks show their order: 1 is your oldest, the next to fade. It cracks first, so you can see it coming.'],
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
  'power-turn': 'Power turn: you can’t finish your own line this turn.',
  frozen: 'Frozen: no powers this turn.',
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
  setTheme(prefs.theme);
  PLAYER_COLORS_CSS = playerCss();
  sfx.enabled = prefs.sound;
  haptics.enabled = prefs.buzz;
  voice.enabled = prefs.voice;
  const music = new Music();
  music.setLevel(prefs.musicVol);
  // Music starts on the first tap (browsers and WebViews need a gesture for sound).
  if (!manual) {
    const startMusic = () => {
      document.removeEventListener('pointerdown', startMusic, true);
      music.set(prefs.music);
    };
    document.addEventListener('pointerdown', startMusic, true);
  }
  let board: Board | null = null;
  let screen = 'loading';
  let match: MatchState | null = null;
  let names: [string, string] = ['Player 1', 'Player 2'];
  /** Playing against the PC (it is player 2), at this difficulty. */
  let pc: PcLevel | null = null;
  let pcBusy = false;
  /** Simple rules for the current (or last) agents match. */
  const simpleNow = () => (match?.agents ? !!match.agents.simple : !prefs.pro);
  /** Trial: your powers and ultimate are always ready (vs an easy PC; not saved). */
  let trial = false;
  const pcRandom = rng(Date.now() % 100000);
  let busy = false;
  /** A show-me lesson is playing on the cube (the game's input is paused). */
  let lessonOn: (() => void) | null = null;
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
  const isMyTurn = () => (online ? (match ? match.round.turn === online.me : false) : !(pc && match && match.round.turn === 1));

  ui.innerHTML = '<div class="screen loading"><h1 class="logo"><span class="p1">Tic Tac</span><span class="p2">Three</span><small class="by">by Moulik</small></h1></div>';

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
    board.ages(null);
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
    if (lessonOn) {
      lessonOn();
      enterDeep();
      return;
    }
    const reviewOpen = ui.querySelector('.review');
    if (reviewOpen) {
      reviewOpen.remove();
      enterDeep();
      return;
    }
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
      `<h1 class="sr-only">Tic Tac Three by Moulik</h1><form class="card"><label for="nick">What do we call you?</label>` +
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
    pc = null;
    trial = false;
    const saved = loadMatch();
    if (screen !== 'nickname') startDemo();
    show(
      'home',
      `<h1 class="sr-only">Tic Tac Three by Moulik</h1><p class="hello">Yo, <b>${esc(prefs.nickname)}</b></p>` +
        '<div class="stack">' +
        (saved ? `<button class="btn big resume" data-go="resume">Resume · ${esc(saved.names[0])} vs ${esc(saved.names[1])}${saved.pc ? ` (${saved.pc})` : ''} · R${saved.match.roundNumber}</button>` : '') +
        '<button class="btn big" data-go="pc">Play vs PC</button>' +
        '<button class="btn big" data-go="local">Play a friend</button>' +
        '<button class="btn alt" data-go="trial">Trial · try the powers</button>' +
        (onlineReady()
          ? '<button class="btn big alt" data-go="online">Play online</button></div>'
          : '<button class="btn big alt" data-go="online" disabled>Play online <small>soon</small></button></div>') +
        `<div class="row"><button class="link" data-go="rename">Change name</button>` +
        '<button class="link" data-go="settings">⚙ Settings</button></div>' +
        `<p class="build">v${esc(window.__BUILD__?.version ?? '0')} · build ${esc(String(window.__BUILD__?.build ?? 'dev'))}</p>`,
    );
    void leaveOnline();
    ui.querySelector('[data-go="local"]')!.addEventListener('click', () => (sfx.unlock(), localSetup(false)));
    ui.querySelector('[data-go="pc"]')!.addEventListener('click', () => (sfx.unlock(), localSetup(true)));
    ui.querySelector('[data-go="trial"]')!.addEventListener('click', () => (sfx.unlock(), trialSetup()));
    ui.querySelector('[data-go="online"]')?.addEventListener('click', () => (sfx.unlock(), onlineMenu()));
    ui.querySelector('[data-go="resume"]')?.addEventListener('click', () => {
      if (!saved) return;
      sfx.unlock();
      names = saved.names;
      pc = saved.pc ?? null;
      resumeMatch(saved.match);
    });
    // Tap the build number: how the 3D is running on this phone (for troubleshooting).
    ui.querySelector('.build')!.addEventListener('click', () => {
      const s = board?.stats();
      toast(s ? `3D: ${s.ratio.toFixed(2)}x sharpness · ${s.fps || '…'} fps · quality ${s.levels - s.level}/${s.levels}` : '3D is still loading');
    });
    ui.querySelector('[data-go="rename"]')!.addEventListener('click', nicknameScreen);
    ui.querySelector('[data-go="settings"]')!.addEventListener('click', settingsSheet);
  }

  // ---- settings: sound, vibration, music, voice and the look, in one sheet ----
  function settingsSheet(): void {
    ui.querySelector('.settings')?.remove();
    const sheet = document.createElement('div');
    sheet.className = 'review settings';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Settings');
    const onOff = (key: string, label: string, on: boolean) =>
      `<li class="srow"><b>${label}</b><button class="sw ${on ? 'on' : ''}" data-set="${key}" role="switch" aria-checked="${on}" aria-label="${label}"><span class="knob"></span></button></li>`;
    const pick = (key: string, label: string, opts: { id: string | number; name: string }[], cur: string | number) =>
      `<li class="srow col"><b>${label}</b><div class="opts" role="radiogroup" aria-label="${label}">${opts
        .map((o) => `<button class="opt ${o.id === cur ? 'on' : ''}" data-${key}="${o.id}" role="radio" aria-checked="${o.id === cur}">${o.name}</button>`)
        .join('')}</div></li>`;
    const draw = () => {
      sheet.innerHTML =
        '<div class="sheet"><div class="top"><p class="kicker">Settings</p><button class="x" data-close aria-label="Close">✕</button></div><ul class="rlist">' +
        pick('look', 'Look', THEMES.map((t) => ({ id: t.id, name: t.id === 'notebook' ? '✒️ Pen & paper' : '🎨 Street' })), prefs.theme) +
        pick('track', 'Music', TRACKS, prefs.music) +
        (prefs.music === 'off' ? '' : pick('vol', 'Music volume', [{ id: 1, name: 'Soft' }, { id: 2, name: 'Normal' }, { id: 3, name: 'Loud' }], prefs.musicVol)) +
        onOff('sound', 'Sound effects', prefs.sound) +
        onOff('buzz', 'Vibration', prefs.buzz) +
        onOff('voice', 'Read tutorials aloud', prefs.voice) +
        '</ul></div>';
      sheet.querySelector('[data-close]')!.addEventListener('click', () => sheet.remove());
      sheet.addEventListener('click', (e) => e.target === sheet && sheet.remove());
      sheet.querySelectorAll<HTMLElement>('[data-look]').forEach((b) =>
        b.addEventListener('click', () => {
          const t = b.dataset.look as ThemeId;
          if (t === prefs.theme) return;
          prefs = { ...prefs, theme: t, themePicked: true };
          savePrefs(prefs);
          // The 3D scene is built in its look: start again in the new one.
          location.reload();
        }),
      );
      sheet.querySelectorAll<HTMLElement>('[data-track]').forEach((b) =>
        b.addEventListener('click', () => {
          prefs = { ...prefs, music: b.dataset.track as TrackId };
          savePrefs(prefs);
          if (!manual) music.set(prefs.music);
          draw();
        }),
      );
      sheet.querySelectorAll<HTMLElement>('[data-vol]').forEach((b) =>
        b.addEventListener('click', () => {
          prefs = { ...prefs, musicVol: Number(b.dataset.vol) as 1 | 2 | 3 };
          savePrefs(prefs);
          music.setLevel(prefs.musicVol);
          draw();
        }),
      );
      sheet.querySelectorAll<HTMLElement>('[data-set]').forEach((b) =>
        b.addEventListener('click', () => {
          const k = b.dataset.set;
          if (k === 'sound') {
            prefs = { ...prefs, sound: !prefs.sound };
            sfx.enabled = prefs.sound;
          } else if (k === 'buzz') {
            prefs = { ...prefs, buzz: !prefs.buzz };
            haptics.enabled = prefs.buzz;
            if (prefs.buzz) haptics.tap();
          } else if (k === 'voice') {
            setVoice(!prefs.voice);
            return draw();
          }
          savePrefs(prefs);
          draw();
        }),
      );
    };
    draw();
    ui.appendChild(sheet);
  }

  function localSetup(vsPc: boolean): void {
    let mode: Mode = prefs.mode;
    let level: PcLevel = prefs.pcLevel;
    show(
      'setup',
      `<button class="back" aria-label="Back">←</button><h2 class="tag">${vsPc ? 'Vs PC' : 'Local match'}</h2>` +
        `<div class="players"><span class="chip p1">${esc(prefs.nickname)}</span><span class="vs">vs</span>` +
        (vsPc
          ? '<span class="chip p2">PC</span></div>' +
            `<div class="levels" role="radiogroup" aria-label="Difficulty">${(['easy', 'normal', 'hard'] as const)
              .map((l) => `<button class="level" data-level="${l}" role="radio">${l === 'easy' ? 'Easy' : l === 'normal' ? 'Normal' : 'Hard'}</button>`)
              .join('')}</div>`
          : `<input class="chip p2" id="p2" maxlength="14" placeholder="Player 2" value="${esc(prefs.player2)}"></div>`) +
        '<div class="modes">' +
        '<button class="mode" data-mode="rotating"><b>Twist</b><span>Place paint or twist a layer. Max 3 marks each: your oldest fades. First line of 3 wins.</span></button>' +
        '<button class="mode" data-mode="cascade"><b>Cascade</b><span>Drop paint down columns. Lines burst and score; falls chain into combos. First to 5.</span></button>' +
        '</div>' +
        '<button class="toggle" data-agents role="switch"><span class="txt"><b>Agents</b><span>Pick a writer with powers. Off = Classic.</span></span><i class="knob"></i></button>' +
        '<button class="toggle small" data-pro role="switch"><span class="txt"><b>Pro abilities</b><span>The full set: wet paint, cooldowns, trickier powers.</span></span><i class="knob"></i></button>' +
        '<button class="btn big" data-go="start">Start · best of 3</button>',
    );
    let agentsOn = prefs.agents;
    let pro = prefs.pro;
    const mark = () => {
      ui.querySelectorAll<HTMLElement>('.mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
      const t = ui.querySelector('[data-agents]') as HTMLElement;
      t.classList.toggle('on', agentsOn);
      t.setAttribute('aria-checked', String(agentsOn));
      const pr = ui.querySelector('[data-pro]') as HTMLElement;
      pr.hidden = !agentsOn;
      pr.classList.toggle('on', pro);
      pr.setAttribute('aria-checked', String(pro));
      ui.querySelectorAll<HTMLElement>('.level').forEach((b) => {
        b.classList.toggle('on', b.dataset.level === level);
        b.setAttribute('aria-checked', String(b.dataset.level === level));
      });
      (ui.querySelector('[data-go="start"]') as HTMLElement).textContent = agentsOn ? 'Pick agents' : 'Start · best of 3';
    };
    mark();
    ui.querySelector('[data-agents]')!.addEventListener('click', () => {
      agentsOn = !agentsOn;
      mark();
    });
    ui.querySelector('[data-pro]')!.addEventListener('click', () => {
      pro = !pro;
      mark();
    });
    ui.querySelectorAll<HTMLElement>('.mode').forEach((b) =>
      b.addEventListener('click', () => {
        mode = b.dataset.mode as Mode;
        mark();
      }),
    );
    ui.querySelectorAll<HTMLElement>('.level').forEach((b) =>
      b.addEventListener('click', () => {
        level = b.dataset.level as PcLevel;
        mark();
      }),
    );
    ui.querySelector('.back')!.addEventListener('click', homeScreen);
    ui.querySelector('[data-go="start"]')!.addEventListener('click', () => {
      if (vsPc) {
        prefs = { ...prefs, mode, agents: agentsOn, pcLevel: level, pro };
        savePrefs(prefs);
        names = [prefs.nickname, 'PC'];
        pc = level;
        if (!agentsOn) return startMatch(mode);
        const picks: [AgentId, AgentId] = [prefs.picks[0], AGENT_IDS[Math.floor(Math.random() * AGENT_IDS.length)]];
        agentSelect(0, mode, picks, () => {
          prefs = { ...prefs, picks: [picks[0], prefs.picks[1]] };
          savePrefs(prefs);
          splash(picks[1], 'PC PICKS', COLORS[1], () => startMatch(mode, picks));
        });
        return;
      }
      pc = null;
      const p2 = cleanName((ui.querySelector('#p2') as HTMLInputElement).value);
      prefs = { ...prefs, player2: p2, mode, agents: agentsOn, pro };
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

  // ---- Show-me lessons: scripted plays on the real cube, narrated ----
  const sleep = (sec: number) => new Promise<void>((res) => window.setTimeout(res, manual ? 0 : sec * 1000));

  /** The full Agents tutorial: every idea, each shown on the cube. */
  function agentsTutorial(then?: () => void): void {
    const simple = simpleNow();
    runLessons(topicsFor(simple).map((t) => topicLesson(t, simple)), () => then?.());
  }

  /**
   * Play lessons one after another over the current screen (which is hidden meanwhile),
   * then put the board back as it was and run `back`.
   */
  function runLessons(lessons: Lesson[], back: () => void): void {
    // Lessons call the players Orange and Blue; in the Notebook look the pens are blue and red.
    const penWords = (text: string) =>
      theme() === 'notebook' ? text.replace(/\bBlue\b/g, '\u0000').replace(/\bOrange\b/g, 'Blue').replace(/\u0000/g, 'Red') : text;
    if (!board || lessons.length === 0) return back();
    const b = board;
    const wasMatch = screen === 'match' && match ? match : null;
    cancelTargeting(false);
    stopDemo();
    b.attract = false;
    b.twistEnabled = false;
    b.setTurn(null);
    voice.stop();
    ui.classList.add('lessoning');
    const el = document.createElement('div');
    el.className = 'lesson';
    el.setAttribute('role', 'dialog');
    ui.appendChild(el);
    let token = 0;
    let li = 0;
    let si = 0;
    let m: MatchState | null = null;
    let running = false;

    const close = () => {
      token++;
      lessonOn = null;
      voice.stop();
      b.highlight(null);
      el.remove();
      ui.classList.remove('lessoning');
      if (wasMatch && match) {
        b.setMode(match.mode);
        b.sync(match.round.cells, crackingOf(match));
        b.decorate(match.agents ? decorOf(match.round, match.agents) : null);
        updateHud();
      } else {
        b.sync(Array(27).fill(null));
        b.decorate(null);
        b.ages(null);
      }
      back();
    };
    lessonOn = close;

    const bar = (on: AbilityId | null) => {
      const x = el.querySelector('.abilities') as HTMLElement | null;
      if (!x || !m?.agents) return;
      const p = m.round.turn;
      x.className = `abilities demo ${COLORS[p]}`;
      x.style.setProperty('--accent', AGENT_LOOK[m.agents.picks[p]].accent);
      x.innerHTML = abilityButtons(m.round, m.agents, p, on, false);
      if (on) x.querySelector(`[data-ab="${on}"]`)?.classList.add('tapme');
    };

    const draw = () => {
      const l = lessons[li];
      const st = l.steps[si];
      const last = si === l.steps.length - 1;
      const lastAll = last && li === lessons.length - 1;
      const who = m?.agents ? `<span class="whoacts ${COLORS[m.round.turn]}">${penWords(m.round.turn === 0 ? 'Orange' : 'Blue')} · ${AGENTS[m.agents.picks[m.round.turn]].name}</span>` : '';
      el.innerHTML =
        `<div class="top"><p class="kicker">Show me · ${esc(l.title)}${lessons.length > 1 ? ` · ${li + 1}/${lessons.length}` : ''}</p>${voiceBtn()}<button class="x" data-close aria-label="Close">✕</button></div>` +
        `<div class="say">${who}<p>${esc(penWords(st.say))}</p>` +
        `<div class="pips">${l.steps.map((_, k) => `<i class="${k === si ? 'on' : k < si ? 'done' : ''}"></i>`).join('')}</div>` +
        `<div class="row"><button class="link" data-replay>↺ Replay</button>` +
        `<button class="btn" data-next ${running ? 'disabled' : ''}>${lastAll ? 'Done' : last ? 'Next lesson' : 'Next'}</button></div></div>` +
        '<div class="abilities demo" aria-hidden="true"></div>';
      bar(null);
      el.querySelector('[data-close]')!.addEventListener('click', close);
      el.querySelector('[data-voice]')!.addEventListener('click', () => {
        setVoice(!prefs.voice);
        const v = el.querySelector('[data-voice]') as HTMLElement;
        v.textContent = prefs.voice ? '🔊' : '🔇';
        v.setAttribute('aria-pressed', String(prefs.voice));
        if (prefs.voice) voice.say(penWords(st.say));
      });
      el.querySelector('[data-replay]')!.addEventListener('click', () => void start(li));
      el.querySelector('[data-next]')!.addEventListener('click', () => {
        if (running) return;
        if (!last) void step(si + 1);
        else if (!lastAll) void start(li + 1);
        else close();
      });
    };

    const show = (cells: number[], color = '#ffffff') => b.highlight(cells.length ? cells : null, color);

    async function step(i: number): Promise<void> {
      const my = ++token;
      const l = lessons[li];
      si = i;
      const st = l.steps[i];
      if (st.reset) {
        m = lessonStart(l, st.reset);
        b.sync(m.round.cells, crackingOf(m));
        b.ages(agesOf(m));
        b.decorate(decorOf(m.round, m.agents!));
      }
      running = true;
      draw();
      voice.say(penWords(st.say));
      show(st.focus ?? []);
      const moves = stepMoves(l, st, m!);
      if (moves.length) await sleep(1.4);
      for (const mv of moves) {
        if (my !== token || !m) return;
        const color = PLAYER_COLORS_CSS[m.round.turn];
        if (mv.kind === 'ability') {
          bar(mv.id);
          await sleep(0.7);
          if (my !== token) return;
          if (mv.cells?.length) {
            show(mv.cells, color);
            await sleep(0.9);
          }
          if (isUlt(mv.id)) splash(m.agents!.picks[m.round.turn], ABILITY_TEXT[mv.id].name.toUpperCase(), COLORS[m.round.turn]);
        } else if (mv.kind === 'place') {
          show([mv.cell], color);
          await sleep(0.5);
        } else if (mv.kind === 'drop') {
          const land = landing(m.round.cells, mv.column);
          if (land >= 0) show([land], color);
          await sleep(0.5);
        }
        if (my !== token) return;
        show([]);
        const out = lessonMove(m, mv, l.realTimers);
        m = out.state;
        bar(null);
        await b.play(out.events);
        if (my !== token) return;
        b.decorate(decorOf(m.round, m.agents!));
        b.ages(agesOf(m));
        bar(null);
        await sleep(0.35);
      }
      if (my !== token) return;
      show(st.focus ?? []);
      running = false;
      const next = el.querySelector('[data-next]') as HTMLButtonElement | null;
      if (next) next.disabled = false;
    }

    async function start(i: number): Promise<void> {
      li = i;
      const l = lessons[li];
      m = lessonStart(l);
      b.setMode(l.mode);
      b.sync(m.round.cells, crackingOf(m));
      b.decorate(decorOf(m.round, m.agents!));
      b.ages(agesOf(m));
      await step(0);
    }
    void start(0);
  }

  /** Quick review in a match: both writers' powers, with a show-me for each. */
  function review(tab: Player | null = null): void {
    if (!match?.agents) return;
    if (busy || pcBusy) return void toast('Wait for the move to finish.');
    const a = match.agents;
    const mode = match.mode;
    const simple = !!a.simple;
    let t: Player = tab ?? match.round.turn;
    const sheet = document.createElement('div');
    sheet.className = 'review';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Powers');
    const draw = () => {
      const id = a.picks[t];
      const st = abilityStatus(match!.round, a, t);
      sheet.innerHTML =
        '<div class="sheet"><div class="top"><p class="kicker">Powers</p><button class="x" data-close aria-label="Close">✕</button></div>' +
        `<div class="tabs">${([0, 1] as const)
          .map((p) => `<button class="tab ${COLORS[p]} ${p === t ? 'on' : ''}" data-tab="${p}"><img alt="" src="${agentArt(a.picks[p], 60, 72, true)}">${esc(names[p])} · ${AGENTS[a.picks[p]].name}</button>`)
          .join('')}</div>` +
        `<ul class="rlist" style="--accent:${AGENT_LOOK[id].accent}">${st
          .map((x) => {
            const state = x.ult ? (x.pips >= x.cost ? 'READY' : `${x.pips}/${x.cost}`) : x.cooldown >= ONCE ? 'used this round' : x.cooldown > 0 ? `${simple ? 'from turn' : 'back in'} ${x.cooldown}` : 'ready';
            return (
              `<li><div class="rhead"><span class="ic ${x.ult ? 'ult' : ''}">${abilityIcon(x.id)}</span><b>${ABILITY_TEXT[x.id].name}</b><em>${x.ult ? 'ULT · ' : ''}${state}</em></div>` +
              `<p>${abilityText(x.id, mode, simple).replace(/^ULTIMATE\. /, '')}</p>` +
              `<button class="link showme" data-show="${x.id}">▶ Show me</button></li>`
            );
          })
          .join('')}</ul>` +
        (simple
          ? '<div class="wetbox"><b>⚡ Power turns</b><p>On a turn you use a power, you can’t finish a line of your own. Each power works once per round.</p></div>'
          : '<div class="wetbox"><b>💧 Wet paint</b><p>A row with wet paint doesn’t count yet. Paint is wet when a power puts it down or moves it, on your move after Shove, Overspray, Spin or Fixative (in Twist, also Flip or Rewind), and on your next mark after the other player’s Delay. It dries at the start of its owner’s turn after next: if the row is still whole then, it counts.</p></div>') +
        `<div class="topics">${topicsFor(simple).map((k) => `<button class="chip" data-topic="${k}">▶ ${topicLesson(k, simple).title}</button>`).join('')}</div></div>`;
      sheet.querySelector('[data-close]')!.addEventListener('click', () => {
        sheet.remove();
        maybePc();
      });
      sheet.querySelectorAll<HTMLElement>('[data-tab]').forEach((x) => x.addEventListener('click', () => ((t = Number(x.dataset.tab) as Player), draw())));
      sheet.querySelectorAll<HTMLElement>('[data-show]').forEach((x) =>
        x.addEventListener('click', () => {
          sheet.remove();
          runLessons([abilityLesson(x.dataset.show as AbilityId, mode, simple)], () => review(t));
        }),
      );
      sheet.querySelectorAll<HTMLElement>('[data-topic]').forEach((x) =>
        x.addEventListener('click', () => {
          sheet.remove();
          runLessons([topicLesson(x.dataset.topic as Topic, simple)], () => review(t));
        }),
      );
    };
    draw();
    ui.appendChild(sheet);
  }

  // ---- Agents: select screen ----
  function agentSelect(p: Player, mode: Mode, picks: [AgentId, AgentId], then: () => void): void {
    const simple = !prefs.pro;
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
        `<ul class="powers">${abilitiesOf(id, simple)
          .map(
            (ab) =>
              `<li><button class="pw ${isUlt(ab) ? 'ult' : ''} ${open === ab ? 'open' : ''}" data-pw="${ab}">${abilityIcon(ab)}<b>${ABILITY_TEXT[ab].name}</b>` +
              `<span>${isUlt(ab) ? 'ULT · ' : ''}${ABILITY_TEXT[ab].short}</span></button>` +
              (open === ab
                ? `<div class="preview"><canvas width="220" height="190"></canvas><p>${abilityText(ab, mode, simple)}</p>` +
                  (board ? `<button class="btn alt showme" data-show="${ab}">▶ Show me on the cube</button>` : '') +
                  '</div>'
                : '') +
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
      card.querySelector<HTMLElement>('[data-show]')?.addEventListener('click', (e) => {
        const ab = (e.currentTarget as HTMLElement).dataset.show as AbilityId;
        stopPreview?.();
        runLessons([abilityLesson(ab, mode, simple)], () => draw());
      });
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
      if (trial) trialSetup();
      else localSetup(!!pc);
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
  function setVoice(on: boolean): void {
    prefs = { ...prefs, voice: on };
    voice.enabled = on;
    if (!on) voice.stop();
    savePrefs(prefs);
  }
  const voiceBtn = () => `<button class="voice" data-voice aria-label="Read aloud" aria-pressed="${prefs.voice}">${prefs.voice ? '🔊' : '🔇'}</button>`;

  function help(mode: HelpTopic, then?: () => void, at = 0): void {
    const simple = simpleNow();
    const h = mode === 'agents' && simple ? HELP_SIMPLE : HELP[mode];
    let i = at;
    const overlay = document.createElement('div');
    overlay.className = 'help';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', `How to play ${h.title}`);
    const draw = () => {
      const [t, body, topic] = h.cards[i];
      overlay.innerHTML =
        `<div class="sheet"><div class="top"><p class="kicker">How to play · ${h.title}</p>${voiceBtn()}</div><h2>${t}</h2><p>${body}</p>` +
        (topic && board ? '<button class="btn alt showme" data-show>▶ Show me on the cube</button>' : '') +
        `<div class="pips">${h.cards.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>` +
        `<div class="row"><button class="link" data-skip>${i < h.cards.length - 1 ? 'Skip' : ''}</button>` +
        `<button class="btn" data-next>${i < h.cards.length - 1 ? 'Next' : "Let's play"}</button></div></div>`;
      voice.say(`${t}. ${body.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '')}`);
      overlay.querySelector('[data-next]')!.addEventListener('click', () => (i < h.cards.length - 1 ? (i++, draw()) : close()));
      overlay.querySelector('[data-skip]')!.addEventListener('click', close);
      overlay.querySelector('[data-voice]')!.addEventListener('click', () => {
        setVoice(!prefs.voice);
        draw();
      });
      overlay.querySelector('[data-show]')?.addEventListener('click', () => {
        overlay.remove();
        runLessons([topicLesson(topic!, simple)], () => help(mode, then, i));
      });
    };
    const close = () => {
      voice.stop();
      overlay.remove();
      window.setTimeout(maybePc, 0);
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
    if (!online && match && !trial) saveMatch({ match, names, ...(pc ? { pc } : {}) });
  };

  function startMatch(mode: Mode, picks?: [AgentId, AgentId], simple = !prefs.pro): void {
    stopDemo();
    match = newMatch(mode, 0, picks, simple);
    persist();
    busy = false;
    if (board) {
      board.attract = false;
      board.setMode(mode);
      board.sync(match.round.cells);
      board.decorate(match.agents ? decorOf(match.round, match.agents) : null);
    }
    matchScreen();
    const agentsHelp = () => {
      if (match?.agents && !prefs.seenHelp.includes('agents')) {
        prefs = { ...prefs, seenHelp: [...prefs.seenHelp, 'agents'] };
        savePrefs(prefs);
        agentsTutorial();
      }
    };
    if (!prefs.seenHelp.includes(mode)) help(mode, agentsHelp);
    else agentsHelp();
  }

  function matchScreen(): void {
    show(
      'match',
      '<button class="back" aria-label="Leave match">✕</button><button class="ask" aria-label="How to play">?</button>' +
        (match?.agents ? '<button class="powersbtn" aria-label="Review powers">⚡<span>Powers</span></button>' : '') +
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
    ui.querySelector('.ask')!.addEventListener('click', () => match && help(match.mode));
    ui.querySelector('.powersbtn')?.addEventListener('click', () => review());
    updateHud();
  }

  // ---- Agents: the ability bar and targeting ----
  /** The four ability buttons for player `p` (also drawn, read-only, in lessons). */
  function abilityButtons(r: AgentRound, a: AgentsState, p: Player, on: AbilityId | null, allOff: boolean): string {
    return abilityStatus(r, a, p)
      .map((x) => {
        const off = !!x.blocked || allOff;
        const badge = x.ult
          ? `<span class="meter" style="--f:${Math.min(1, x.pips / x.cost)}"></span><em>${x.pips >= x.cost ? 'READY' : `${x.pips}/${x.cost}`}</em>`
          : x.cooldown >= ONCE
            ? '<em class="cd done" aria-hidden="true">✓</em>'
            : x.cooldown > 0
              ? `<em class="cd">${x.cooldown}</em>`
              : '';
        return (
          `<button class="ab ${x.ult ? 'ult' : ''} ${off ? 'off' : ''} ${on === x.id ? 'on' : ''} ${a.used === x.id ? 'used' : ''}" data-ab="${x.id}" ` +
          `aria-label="${ABILITY_TEXT[x.id].name}${x.cooldown >= ONCE ? ', used this round' : x.cooldown ? `, ready in ${x.cooldown}` : ''}${x.ult ? `, ${x.pips} of ${x.cost}` : ''}">` +
          `${abilityIcon(x.id)}<b>${ABILITY_TEXT[x.id].name}</b>${badge}</button>`
        );
      })
      .join('');
  }

  function renderAbilities(): void {
    const bar = ui.querySelector('.abilities') as HTMLElement | null;
    if (!bar || !match?.agents) return;
    const r = match.round;
    const p = r.turn;
    const agent = match.agents.picks[p];
    bar.className = `abilities ${COLORS[p]}`;
    bar.style.setProperty('--accent', AGENT_LOOK[agent].accent);
    bar.hidden = !!r.result;
    bar.innerHTML = abilityButtons(r, match.agents, p, targeting?.id ?? null, busy || !isMyTurn());
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
  /** Simple rules: Shove and Swap take one tap on the enemy mark; the rest is picked for you. */
  const oneTap = (t: NonNullable<typeof targeting>) => !!match?.agents?.simple && (t.id === 'shove' || t.id === 'swap');
  function candidates(t: NonNullable<typeof targeting>): number[] {
    const us = consistent(t);
    if (oneTap(t)) return [...new Set(us.map((u) => (t.id === 'swap' ? u.cells![1] : u.cells![0])))];
    if (t.id === 'wetFloor') return [...new Set(us.flatMap((u) => [...LINES[lineThrough(u.cells![0], u.cells![1])]]))].filter((c) => !t.picked.includes(c));
    return [...new Set(us.map((u) => u.cells![t.picked.length]).filter((c) => c !== undefined))];
  }

  function onAbility(id: AbilityId): void {
    if (lessonOn || !match?.agents || !board || screen !== 'match' || busy || match.round.result) return;
    if (!isMyTurn()) return void toast(`${names[match.round.turn]}'s turn.`);
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
      const one = !!match.agents.simple;
      const what: Partial<Record<AbilityId, string>> = {
        shove: one ? 'tap an enemy mark to push it' : 'tap an enemy mark, then where it goes',
        swap: one ? 'tap an enemy mark next to one of yours' : 'tap your mark, then the enemy mark next to it',
        relocate: 'tap your mark, then an empty cell next to it',
        shield: 'tap your mark to shield it',
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
    if (oneTap(t)) {
      const pick = t.uses.find((u) => (t.id === 'swap' ? u.cells![1] : u.cells![0]) === c);
      if (pick) void doAbility(pick);
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
    board.ages(null);
    await board.play(out.events);
    busy = false;
    board.decorate(decorOf(match.round, match.agents!));
    updateHud();
    if (match.round.result) roundOver();
  }

  function updateHud(): void {
    if (!match || screen !== 'match') return;
    trialRefill();
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
    else if (pc && r.turn === 1) turn.textContent = 'PC is thinking…';
    else if (trial) turn.textContent = `Trial · powers always ready · ${how}`;
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
    wetNote();
    board?.ages(busy ? null : agesOf(match));
    if (board) {
      board.twistEnabled = (r.mode === 'rotating' || (targeting?.uses[0].twists?.length ?? 0) > 0) && !r.result && !busy && !awaiting && isMyTurn();
      board.setTurn(r.result || busy || !isMyTurn() ? null : r.turn);
      board.names = [names[0], names[1]];
    }
    maybePc();
  }

  // ---- Trial: try any writer's powers, always ready, against an easy PC ----
  function trialSetup(): void {
    let mode: Mode = prefs.mode;
    show(
      'setup',
      '<button class="back" aria-label="Back">←</button><h2 class="tag">Trial mode</h2>' +
        '<p class="note">Pick a writer and play an easy PC. Your powers and ultimate are always ready, so you can try every one as often as you like. Nothing is saved.</p>' +
        '<div class="modes">' +
        '<button class="mode" data-mode="rotating"><b>Twist</b><span>Place paint or twist a layer. First line of 3 wins.</span></button>' +
        '<button class="mode" data-mode="cascade"><b>Cascade</b><span>Drop paint down columns. Lines burst and score.</span></button>' +
        '</div><button class="btn big" data-go="start">Pick a writer</button>',
    );
    const mark = () => ui.querySelectorAll<HTMLElement>('.mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    mark();
    ui.querySelectorAll<HTMLElement>('.mode').forEach((b) => b.addEventListener('click', () => ((mode = b.dataset.mode as Mode), mark())));
    ui.querySelector('.back')!.addEventListener('click', homeScreen);
    ui.querySelector('[data-go="start"]')!.addEventListener('click', () => {
      names = [prefs.nickname, 'PC'];
      pc = 'easy';
      trial = true;
      const picks: [AgentId, AgentId] = [prefs.picks[0], AGENT_IDS[Math.floor(Math.random() * AGENT_IDS.length)]];
      agentSelect(0, mode, picks, () => splash(picks[1], 'PC PICKS', COLORS[1], () => startMatch(mode, picks)));
    });
  }
  /** Trial: before each of your turns, every power and the ultimate are ready again. */
  function trialRefill(): void {
    if (!trial || !match?.agents || match.round.turn !== 0 || match.agents.used || match.round.result) return;
    const a = match.agents;
    const cost = abilityStatus(match.round, a, 0).find((x) => x.ult)?.cost ?? 0;
    if (a.cd[0].every((c) => c === 0) && a.ult[0] >= cost) return;
    match = { ...match, agents: { ...a, cd: [[0, 0, 0], a.cd[1]], ult: [Math.max(a.ult[0], cost), a.ult[1]] } };
  }

  /** Wet rows on the board, and when each will count: shown as a note under the HUD. */
  function wetNote(): void {
    let el = ui.querySelector('.wetnote') as HTMLElement | null;
    const lines: string[] = [];
    if (match?.agents && !match.round.result) {
      const r = match.round;
      const a = match.agents;
      for (const p of [0, 1] as const) {
        let left = 0;
        for (const l of LINES) {
          if (r.mode === 'rotating' && l.includes(CENTER)) continue;
          if (!l.every((c) => r.cells[c] === p)) continue;
          const w = Math.max(...l.map((c) => a.wet[c]));
          if (w > 0) left = Math.max(left, w);
        }
        const o = p === 0 ? 1 : 0;
        if (left > 0) {
          const when = left >= 2 ? `at the start of ${esc(names[p])}’s turn after next` : `at the start of ${esc(names[p])}’s next turn`;
          lines.push(`💧 <b>${esc(names[p])}’s ${r.mode === 'rotating' ? 'row' : 'line'} is wet.</b> It counts ${when} if it’s still whole. ${esc(names[o])}: break it!`);
        }
        if (a.delay[p]) lines.push(`💧 <b>Delay:</b> ${esc(names[p])}’s next mark will be wet.`);
      }
    }
    if (!lines.length) return void el?.remove();
    if (!el) {
      el = document.createElement('p');
      el.className = 'wetnote';
      el.setAttribute('role', 'status');
      ui.querySelector('.screen')?.appendChild(el);
    }
    el.innerHTML = lines.join('<br>');
  }

  // ---- vs PC: the PC is player 2 and plays its turn by itself ----
  const PC_OPTS: Record<PcLevel, { noise: number; samples: number; ultChance: number }> = {
    // Easy is close to random; Normal makes real mistakes; Hard plays its best.
    easy: { noise: 3, samples: 2, ultChance: 0.3 },
    normal: { noise: 1.1, samples: 4, ultChance: 0.2 },
    hard: { noise: 0.08, samples: 10, ultChance: 0.1 },
  };
  function maybePc(): void {
    if (!pc || pcBusy || !match || online || screen !== 'match' || busy || lessonOn || match.round.result || match.winner !== null) return;
    if (match.round.turn !== 1 || ui.querySelector('.help, .review, .result')) return;
    pcBusy = true;
    window.setTimeout(() => void pcTurn(), 0);
  }
  async function pcTurn(): Promise<void> {
    const m0 = match;
    if (!m0 || !board || !pc) return void (pcBusy = false);
    busy = true;
    board.twistEnabled = false;
    board.setTurn(null);
    renderAbilities();
    await sleep(0.8);
    const o = PC_OPTS[pc];
    let moves: Move[];
    try {
      moves = m0.agents
        ? agentBotTurn(m0, pcRandom, { noise: o.noise, usePowers: true, ultChance: o.ultChance, samples: o.samples })
        : m0.round.mode === 'rotating'
          ? [rotatingBotMove(m0.round, pcRandom, o.noise)]
          : [cascadeBotMove(m0.round, pcRandom, o.noise)];
    } catch {
      moves = [];
    }
    if (!moves.length || checkMove(m0, moves[0])) moves = [legalMoves(m0)[0]];
    for (const mv of moves) {
      if (moves.indexOf(mv) === 0 && match !== m0) break;
      if (!match || screen !== 'match' || !pc || checkMove(match, mv)) break;
      if (mv.kind === 'ability') {
        const bar = ui.querySelector('.abilities');
        bar?.querySelector(`[data-ab="${mv.id}"]`)?.classList.add('tapme');
        if (mv.cells?.length) board.highlight(mv.cells, PLAYER_COLORS_CSS[1]);
        await sleep(0.8);
        board.highlight(null);
        if (isUlt(mv.id)) splash(match.agents!.picks[1], ABILITY_TEXT[mv.id].name.toUpperCase(), COLORS[1]);
      }
      const out = applyMove(match, mv);
      match = out.state;
      persist();
      renderAbilities();
      board.ages(null);
      await board.play(out.events);
      if (match.agents) board.decorate(decorOf(match.round, match.agents));
      if (match.round.result) break;
      await sleep(0.3);
    }
    busy = false;
    pcBusy = false;
    if (!match || screen !== 'match') return;
    updateHud();
    if (match.round.result) roundOver();
  }

  /** Twist: each player's marks numbered by age (1 = oldest, the next to fade). */
  const agesOf = (m: MatchState | null) =>
    m && m.round.mode === 'rotating' && !m.round.result
      ? ([0, 1] as const).flatMap((p) => (m.round as { marks: number[][] }).marks[p].map((cell, i) => ({ cell, n: i + 1, p })))
      : null;

  /** Marks that fade on their owner's next placement (shown cracked). */
  const crackingOf = (m: MatchState): number[] =>
    m.round.mode === 'rotating' ? m.round.marks.flatMap((ms) => (ms.length >= MAX_MARKS ? [ms[0]] : [])) : [];

  /** Aim marker: the cell a tap would paint (Cascade: where the drop lands), if legal. */
  function aimAt(cell: number): number | null {
    if (lessonOn || !match || screen !== 'match' || busy || awaiting || match.round.result || !isMyTurn() || targeting) return null;
    const r = match.round;
    if (r.mode === 'rotating') return checkMove(match, { kind: 'place', cell }) ? null : cell;
    const column = coord(cell)[0] + 3 * coord(cell)[1];
    return checkMove(match, { kind: 'drop', column }) ? null : landing(r.cells, column);
  }

  // Twists: a swipe on the cube asks first, then holds a preview until confirmed.
  function onTwistIntent(t: Twist): boolean {
    if (lessonOn) return false;
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
    if (lessonOn) return;
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
    board.ages(null);
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
    overlay.querySelector('[data-go="rematch"]')?.addEventListener('click', () => startMatch(match!.mode, match!.agents?.picks, !!match!.agents?.simple));
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
    pc = null;
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
      const text = `Join my Tic Tac Three room: ${code}`;
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
        busy: () => busy || pcBusy,
        swipe: (c, dx, dy) => !!board?.swipe(c, dx, dy),
        aim: (c) => board?.aim(c),
        advance: (sec, draw = true) => board?.advance(sec, draw),
        state: () => match,
        lesson: () => !!lessonOn,
      };
    });
}
