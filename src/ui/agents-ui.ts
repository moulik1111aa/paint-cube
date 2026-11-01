// Agents mode presentation: the four writers drawn in code (original graffiti
// characters: hooded, masked, each with an accent colour and an emblem), the words for
// every power, small icons, and looping mini-board previews of each power.

import type { AbilityId, AgentId } from '../core/agents.ts';
import type { Mode } from '../core/match.ts';
import { playerCss } from '../theme.ts';

export const AGENT_LOOK: Record<AgentId, { accent: string; deep: string; light: string }> = {
  blitz: { accent: '#ff3d6e', deep: '#7a0f2e', light: '#ffc2d2' },
  stencil: { accent: '#ffd23f', deep: '#6b5200', light: '#fff2b8' },
  drift: { accent: '#2ee6c9', deep: '#0b5a50', light: '#c6fff5' },
  echo: { accent: '#a66bff', deep: '#3d1a78', light: '#e3d2ff' },
};

export interface AbilityText {
  name: string;
  /** One line for the button tooltip / HUD hint. */
  short: string;
  rotating: string;
  cascade: string;
}

export const ABILITY_TEXT: Record<AbilityId, AbilityText> = {
  doubleTap: { name: 'Double Tap', short: 'Paint a second cell', rotating: 'Paint a second empty cell (wet), then make your move.', cascade: 'A second drop (wet), then your normal drop.' },
  shove: { name: 'Shove', short: 'Push an enemy mark', rotating: 'Push one enemy mark one step into an empty neighbouring cell. Your move this turn is wet.', cascade: 'Move an enemy top cube onto a neighbouring column. Your drop this turn is wet.' },
  overspray: { name: 'Overspray', short: 'Wipe an enemy mark', rotating: 'Wipe one enemy mark off the cube. Your move this turn is wet.', cascade: 'Wipe an enemy cube; cubes above it fall (wet). Your drop this turn is wet.' },
  chrome: { name: 'Chrome', short: 'Next marks never fade', rotating: 'ULTIMATE. Your next marks are chrome: they never fade, and no power can move or wipe them.', cascade: 'ULTIMATE. Your next cube is chrome: a line with it scores double, and no power can touch it.' },
  tape: { name: 'Tape', short: 'Block a cell', rotating: 'Tape off an empty cell: nobody can paint there for a few turns.', cascade: 'Tape off a whole column: nobody can drop there for a few turns.' },
  fixative: { name: 'Fixative', short: 'Seal your mark', rotating: 'Seal one of your marks: it can’t fade, be moved or wiped, and its layers can’t twist. Your move this turn is wet.', cascade: 'Seal one of your cubes: it can’t be wiped or moved, and stays (and scores again) when its line bursts. Your drop is wet.' },
  wetFloor: { name: 'Wet Floor', short: 'Block a line', rotating: 'Pick a line: it can’t count for your opponent for 2 turns.', cascade: 'Pick a line: it can’t score for your opponent for 2 turns.' },
  lockdown: { name: 'Lockdown', short: 'No powers, no twists', rotating: 'ULTIMATE. Your opponent can’t use powers or twist for their next turns.', cascade: 'ULTIMATE. No powers for your opponent, and their lines wait to burst until Lockdown ends.' },
  spin: { name: 'Spin', short: 'An extra twist', rotating: 'Twist a layer before your move, even if you twisted last turn. Moved marks are wet, and so is your move.', cascade: 'Twist a layer of the stack, then everything falls (all wet). Your drop is wet.' },
  swap: { name: 'Swap', short: 'Trade places', rotating: 'Swap one of your marks with a touching enemy mark. Both are wet.', cascade: 'Swap one of your cubes with a touching enemy cube. Both are wet.' },
  trap: { name: 'Paint Trap', short: 'Mark a trap', rotating: 'Mark an empty cell. If your opponent paints it, the mark turns into yours.', cascade: 'Mark an empty cell. If your opponent’s paint lands there, it turns into yours.' },
  flip: { name: 'Flip', short: 'Two twists at once', rotating: 'ULTIMATE. Twist any two layers at once, ignoring the twist rules. What it moves is wet, and so is your move.', cascade: 'ULTIMATE. The cube flips upside down; everything falls to the new floor and every line scores, chaining as usual.' },
  afterimage: { name: 'Afterimage', short: 'Bring a mark back', rotating: 'Bring back your most recently lost mark to its old cell, if it’s empty (wet).', cascade: 'Bring back your most recently lost cube: it drops into its old column (wet).' },
  delay: { name: 'Delay', short: 'Their next mark is wet', rotating: 'Your opponent’s next mark is wet: it can’t complete a line straight away.', cascade: 'Your opponent’s next cube is wet: its lines wait to burst.' },
  reverb: { name: 'Reverb', short: 'Mirror your move', rotating: 'After your move, paint the cell straight through the Core from your mark (wet).', cascade: 'After your drop, a second cube drops into the mirrored column (wet).' },
  shield: { name: 'Shield', short: 'Protect your mark', rotating: 'Tap one of your marks: for 3 turns it can’t fade, and no power can move or wipe it.', cascade: 'Tap one of your cubes: for 3 turns no power can move or wipe it, and when its line bursts it stays.' },
  relocate: { name: 'Relocate', short: 'Move your mark', rotating: 'Slide one of your marks into an empty cell next to it.', cascade: 'Pick up one of your top cubes and drop it on another column.' },
  freeze: { name: 'Freeze', short: 'No powers for them', rotating: 'Your opponent can’t use a power or their ultimate on their next turn.', cascade: 'Your opponent can’t use a power or their ultimate on their next turn.' },
  rewind: { name: 'Rewind', short: 'Undo their turn', rotating: 'ULTIMATE. Undo your opponent’s whole last turn (move and power), then take your turn. Your move after it is wet.', cascade: 'ULTIMATE. Undo your opponent’s whole last turn, scoring and all, then take your turn.' },
};

/** Simple rules: the same powers in plain words (no wet paint). */
const SIMPLE_TEXT: Partial<Record<AbilityId, { rotating: string; cascade: string }>> = {
  doubleTap: { rotating: 'Paint an extra empty cell, then make your normal move.', cascade: 'Drop an extra cube, then make your normal drop.' },
  shove: { rotating: 'Tap an enemy mark: it’s pushed into an empty cell next to it.', cascade: 'Tap an enemy top cube: it’s pushed onto a column next to it.' },
  overspray: { rotating: 'Tap an enemy mark to wipe it off the cube.', cascade: 'Tap an enemy cube to wipe it. Cubes above it fall.' },
  chrome: { rotating: 'ULTIMATE. Your next 2 marks are chrome: they never fade, and no power can move or wipe them.', cascade: 'ULTIMATE. Your next cube is chrome: a line with it scores double.' },
  tape: { rotating: 'Tape an empty cell: nobody can paint there for 3 turns.', cascade: 'Tape a column: nobody can drop there for 3 turns.' },
  lockdown: { rotating: 'ULTIMATE. For 2 turns your opponent can’t use powers or twist.', cascade: 'ULTIMATE. For 2 turns your opponent can’t use powers, and their lines wait to burst.' },
  spin: { rotating: 'Swipe a layer for an extra twist, then make your normal move.', cascade: 'Twist a layer of the stack and everything falls. Then your normal drop.' },
  swap: { rotating: 'Tap an enemy mark next to one of yours: they trade places.', cascade: 'Tap an enemy cube next to one of yours: they trade places.' },
  trap: { rotating: 'Mark an empty cell. If your opponent paints it, it turns into yours.', cascade: 'Mark an empty cell. If your opponent’s paint lands there, it turns into yours.' },
  flip: { rotating: 'ULTIMATE. Twist any two layers at once, ignoring the twist rules.', cascade: 'ULTIMATE. The cube flips upside down; everything falls and lines score as usual.' },
  afterimage: { rotating: 'Bring back your last lost mark, if its cell is empty.', cascade: 'Bring back your last lost cube into its old column.' },
  reverb: { rotating: 'After your move, the cell straight through the Core gets your paint too.', cascade: 'After your drop, the mirrored column gets a cube too.' },
  rewind: { rotating: 'ULTIMATE. Undo your opponent’s whole last turn, then take yours.', cascade: 'ULTIMATE. Undo your opponent’s whole last turn, scoring and all, then take yours.' },
};

export const abilityText = (id: AbilityId, mode: Mode, simple = false): string => (simple && SIMPLE_TEXT[id]?.[mode]) || ABILITY_TEXT[id][mode];

/** Small line icons (stroke = currentColor). */
const ICON_PATHS: Record<AbilityId, string> = {
  doubleTap: '<circle cx="9" cy="12" r="4"/><circle cx="17" cy="9" r="3"/><path d="M17 12v5"/>',
  shove: '<path d="M4 12h12"/><path d="M12 7l5 5-5 5"/><path d="M20 6v12"/>',
  overspray: '<rect x="4" y="9" width="7" height="11" rx="2"/><path d="M6 9V6h3v3"/><path d="M14 6l2-1M14 9h3M14 12l2 1M19 5l1-1M19 9h2M19 13l1 1"/>',
  chrome: '<path d="M12 3l7 6-7 12-7-12z"/><path d="M5 9h14M9 9l3 12 3-12"/>',
  tape: '<path d="M4 6l16 12M20 6L4 18"/>',
  fixative: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  wetFloor: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  lockdown: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  spin: '<path d="M19 12a7 7 0 1 1-2-5"/><path d="M19 4v4h-4"/>',
  swap: '<path d="M5 8h13l-3-3M19 16H6l3 3"/>',
  trap: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  flip: '<path d="M8 20V5l-3 3M16 4v15l3-3"/>',
  afterimage: '<rect x="3" y="7" width="10" height="10" rx="2" opacity=".45"/><rect x="10" y="5" width="11" height="11" rx="2"/>',
  delay: '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9"/>',
  reverb: '<circle cx="12" cy="12" r="2"/><path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16"/>',
  rewind: '<path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>',
  relocate: '<rect x="3" y="13" width="8" height="8" rx="2" opacity=".45"/><rect x="13" y="3" width="8" height="8" rx="2"/><path d="M7 11V7h4M9 5l2 2-2 2"/>',
  freeze: '<path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17M9 4l3 2 3-2M9 20l3-2 3 2"/>',
};
export const abilityIcon = (id: AbilityId): string =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[id]}</svg>`;

// ---------------------------------------------------------------------------------
// The writers. Everything is paths and gradients on a 2D canvas.

const INK = '#0d0a14';

function seeded(seed: number): () => number {
  let s = seed * 2654435761 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function blobPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, lobes: number, rnd: () => number, squash = 1): void {
  g.beginPath();
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const rr = r * (0.82 + rnd() * 0.3);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * squash;
    if (i === 0) g.moveTo(x, y);
    else g.quadraticCurveTo(cx + Math.cos(a - 0.2) * rr * 1.18, cy + Math.sin(a - 0.2) * rr * 1.18 * squash, x, y);
  }
  g.closePath();
}

function drips(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, color: string, rnd: () => number, n: number, scale: number): void {
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * (x1 - x0);
    const len = (14 + rnd() * 50) * scale;
    const w = (4 + rnd() * 5) * scale;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y + len);
    g.stroke();
    g.beginPath();
    g.arc(x, y + len, w * 0.8, 0, Math.PI * 2);
    g.fill();
  }
}

function stroked(g: CanvasRenderingContext2D, fill: string | CanvasGradient, width: number): void {
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = width;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.stroke();
}

function emblem(g: CanvasRenderingContext2D, id: AgentId, x: number, y: number, s: number, color: string): void {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  if (id === 'blitz') {
    g.moveTo(4, -22);
    g.lineTo(-12, 3);
    g.lineTo(0, 3);
    g.lineTo(-5, 22);
    g.lineTo(13, -5);
    g.lineTo(1, -5);
    g.closePath();
    stroked(g, color, 5);
  } else if (id === 'stencil') {
    for (const r of [Math.PI / 4, -Math.PI / 4]) {
      g.save();
      g.rotate(r);
      g.beginPath();
      g.rect(-22, -6, 44, 12);
      stroked(g, color, 4);
      g.restore();
    }
  } else if (id === 'drift') {
    g.lineWidth = 9;
    g.strokeStyle = INK;
    g.beginPath();
    g.arc(0, 0, 15, 0.3, Math.PI * 1.7);
    g.stroke();
    g.lineWidth = 5;
    g.strokeStyle = color;
    g.stroke();
    g.beginPath();
    g.moveTo(14, -10);
    g.lineTo(22, 2);
    g.lineTo(8, 4);
    g.closePath();
    stroked(g, color, 4);
  } else {
    for (const r of [20, 12]) {
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.lineWidth = 9;
      g.strokeStyle = INK;
      g.stroke();
      g.lineWidth = 5;
      g.strokeStyle = color;
      g.stroke();
    }
    g.beginPath();
    g.arc(0, 0, 4, 0, Math.PI * 2);
    stroked(g, color, 3);
  }
  g.restore();
}

/** Draw a writer into a canvas (any size; the drawing is laid out on 300 x 360). */
export function drawAgent(id: AgentId, c: HTMLCanvasElement, flat = false): void {
  const g = c.getContext('2d')!;
  const L = AGENT_LOOK[id];
  const rnd = seeded(id.length * 97 + id.charCodeAt(0));
  g.save();
  g.clearRect(0, 0, c.width, c.height);
  g.scale(c.width / 300, c.height / 360);

  // The spray burst behind them.
  if (!flat) {
    g.save();
    blobPath(g, 150, 160, 128, 14, rnd, 1.05);
    g.fillStyle = L.accent;
    g.fill();
    for (let i = 0; i < 260; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 120 + Math.pow(rnd(), 2) * 40;
      g.globalAlpha = 0.3 + rnd() * 0.6;
      g.beginPath();
      g.arc(150 + Math.cos(a) * d, 160 + Math.sin(a) * d, 1 + rnd() * 2.5, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    drips(g, 70, 230, 270, L.accent, rnd, 6, 1);
    g.restore();
  }

  // Shoulders: a heavy hoodie.
  g.beginPath();
  g.moveTo(30, 360);
  g.bezierCurveTo(32, 278, 84, 248, 150, 246);
  g.bezierCurveTo(216, 248, 268, 278, 270, 360);
  g.closePath();
  const hoodie = g.createLinearGradient(0, 240, 0, 360);
  hoodie.addColorStop(0, '#2a2338');
  hoodie.addColorStop(1, '#141020');
  stroked(g, hoodie, 7);
  // Drawstrings.
  g.strokeStyle = L.light;
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(128, 262);
  g.lineTo(124, 300);
  g.moveTo(172, 262);
  g.lineTo(176, 300);
  g.stroke();
  emblem(g, id, 150, 318, 1.15, L.accent);

  // The hood.
  g.beginPath();
  g.moveTo(150, 58);
  g.bezierCurveTo(232, 58, 252, 150, 236, 214);
  g.bezierCurveTo(226, 252, 190, 268, 150, 268);
  g.bezierCurveTo(110, 268, 74, 252, 64, 214);
  g.bezierCurveTo(48, 150, 68, 58, 150, 58);
  g.closePath();
  const hood = g.createLinearGradient(60, 60, 240, 260);
  hood.addColorStop(0, '#3a3150');
  hood.addColorStop(1, '#1b1528');
  stroked(g, hood, 7);
  // Face opening: deep shadow.
  g.beginPath();
  g.ellipse(150, 170, 62, 74, 0, 0, Math.PI * 2);
  stroked(g, '#07050c', 5);
  // Hood rim highlight in the accent.
  g.beginPath();
  g.ellipse(150, 170, 70, 82, 0, Math.PI * 1.05, Math.PI * 1.95);
  g.strokeStyle = L.accent;
  g.lineWidth = 6;
  g.stroke();

  // The mask: each writer's own.
  g.save();
  if (id === 'blitz') {
    // Goggles over a zigzag bandana.
    g.beginPath();
    g.moveTo(92, 186);
    g.lineTo(208, 186);
    g.lineTo(204, 236);
    g.quadraticCurveTo(150, 262, 96, 236);
    g.closePath();
    stroked(g, L.accent, 6);
    g.strokeStyle = INK;
    g.lineWidth = 5;
    g.beginPath();
    for (let x = 100; x <= 200; x += 16) g.lineTo(x, x % 32 === 4 ? 206 : 220);
    g.stroke();
    for (const x of [122, 178]) {
      g.beginPath();
      g.ellipse(x, 158, 26, 20, 0, 0, Math.PI * 2);
      stroked(g, '#1f1a2e', 6);
      g.beginPath();
      g.ellipse(x, 158, 18, 13, 0, 0, Math.PI * 2);
      const lens = g.createLinearGradient(x - 18, 145, x + 18, 171);
      lens.addColorStop(0, '#fff');
      lens.addColorStop(0.35, L.light);
      lens.addColorStop(1, L.accent);
      g.fillStyle = lens;
      g.fill();
    }
    g.beginPath();
    g.moveTo(96, 158);
    g.lineTo(204, 158);
    g.strokeStyle = INK;
    g.lineWidth = 6;
    g.stroke();
  } else if (id === 'stencil') {
    // A respirator with two filter cans, hazard tape over the hood.
    g.beginPath();
    g.moveTo(110, 178);
    g.quadraticCurveTo(150, 166, 190, 178);
    g.lineTo(196, 222);
    g.quadraticCurveTo(150, 254, 104, 222);
    g.closePath();
    stroked(g, '#d9d4e4', 6);
    for (const x of [98, 202]) {
      g.beginPath();
      g.ellipse(x, 214, 20, 24, x < 150 ? 0.35 : -0.35, 0, Math.PI * 2);
      stroked(g, L.accent, 6);
      g.beginPath();
      g.ellipse(x, 214, 9, 11, 0, 0, Math.PI * 2);
      g.fillStyle = L.deep;
      g.fill();
    }
    for (const x of [126, 174]) {
      g.beginPath();
      g.ellipse(x, 148, 14, 7, 0, 0, Math.PI * 2);
      g.fillStyle = L.light;
      g.fill();
    }
    g.translate(150, 96);
    g.rotate(-0.25);
    g.beginPath();
    g.rect(-90, -13, 180, 26);
    stroked(g, L.accent, 5);
    g.fillStyle = INK;
    for (let x = -86; x < 86; x += 22) {
      g.beginPath();
      g.moveTo(x, -13);
      g.lineTo(x + 11, -13);
      g.lineTo(x + 2, 13);
      g.lineTo(x - 9, 13);
      g.fill();
    }
  } else if (id === 'drift') {
    // A wraparound visor and a cap peak under the hood.
    g.beginPath();
    g.moveTo(84, 108);
    g.quadraticCurveTo(150, 72, 216, 108);
    g.lineTo(222, 124);
    g.quadraticCurveTo(150, 102, 78, 124);
    g.closePath();
    stroked(g, L.accent, 6);
    g.beginPath();
    g.moveTo(88, 146);
    g.quadraticCurveTo(150, 128, 212, 146);
    g.lineTo(206, 182);
    g.quadraticCurveTo(150, 170, 94, 182);
    g.closePath();
    const visor = g.createLinearGradient(90, 130, 210, 180);
    visor.addColorStop(0, L.light);
    visor.addColorStop(0.5, L.accent);
    visor.addColorStop(1, L.deep);
    stroked(g, visor, 6);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(104, 156);
    g.lineTo(132, 148);
    g.stroke();
    g.beginPath();
    g.moveTo(110, 206);
    g.quadraticCurveTo(150, 230, 190, 206);
    g.lineTo(186, 232);
    g.quadraticCurveTo(150, 252, 114, 232);
    g.closePath();
    stroked(g, '#2a2338', 5);
  } else {
    // A half mask split down the middle: one mirrored side, one painted.
    g.beginPath();
    g.moveTo(150, 112);
    g.bezierCurveTo(200, 112, 212, 170, 204, 206);
    g.bezierCurveTo(196, 236, 170, 248, 150, 250);
    g.closePath();
    const mirror = g.createLinearGradient(150, 110, 210, 250);
    mirror.addColorStop(0, '#ffffff');
    mirror.addColorStop(0.4, L.light);
    mirror.addColorStop(1, '#8c84a3');
    stroked(g, mirror, 6);
    g.beginPath();
    g.moveTo(150, 112);
    g.bezierCurveTo(100, 112, 88, 170, 96, 206);
    g.bezierCurveTo(104, 236, 130, 248, 150, 250);
    g.closePath();
    stroked(g, L.accent, 6);
    for (const [x, col] of [[124, '#07050c'], [176, L.deep]] as const) {
      g.beginPath();
      g.moveTo(x - 18, 162);
      g.quadraticCurveTo(x, 150, x + 18, 162);
      g.quadraticCurveTo(x, 170, x - 18, 162);
      g.fillStyle = col;
      g.fill();
    }
    g.strokeStyle = INK;
    g.lineWidth = 3;
    for (const r of [10, 18]) {
      g.beginPath();
      g.arc(176, 214, r, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    }
  }
  g.restore();

  // A few drips off the mask edge and a shine on the hood.
  drips(g, 112, 188, 246, L.accent, rnd, 3, 0.6);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(92, 104);
  g.quadraticCurveTo(108, 80, 136, 70);
  g.stroke();
  g.restore();
}

const artCache = new Map<string, string>();
/** A data URL of a writer at this size (cached). */
export function agentArt(id: AgentId, w = 300, h = 360, flat = false): string {
  const key = `${id}:${w}:${h}:${flat}`;
  let url = artCache.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    drawAgent(id, c, flat);
    url = c.toDataURL('image/png');
    artCache.set(key, url);
  }
  return url;
}

// ---------------------------------------------------------------------------------
// Power previews: a 3 x 3 face of the cube, looping a short scripted play.

type Mark = 0 | 1 | null;
interface Frame {
  cells: Mark[];
  wet?: number[];
  chrome?: number[];
  tape?: number[];
  trap?: number[];
  seal?: number[];
  ghost?: number[];
  line?: [number, number];
  lock?: boolean;
  flipY?: boolean;
  label?: string;
  hold?: number;
}

const PREVIEWS: Record<AbilityId, Frame[]> = {
  doubleTap: [
    { cells: [0, null, null, null, 1, null, null, null, null] },
    { cells: [0, null, null, null, 1, null, null, null, 0], wet: [8], label: 'TAP' },
    { cells: [0, null, 0, null, 1, null, null, null, 0], wet: [8], label: 'TAP TAP' },
  ],
  shove: [
    { cells: [0, 1, 0, null, null, null, null, null, null] },
    { cells: [0, null, 0, null, 1, null, null, null, null], wet: [4], label: 'SHOVE' },
    { cells: [0, 0, 0, null, 1, null, null, null, null], wet: [4, 1], label: 'wet till next turn' },
  ],
  overspray: [
    { cells: [0, 1, 0, null, 1, null, null, null, null] },
    { cells: [0, null, 0, null, 1, null, null, null, null], ghost: [1], label: 'WIPED' },
  ],
  chrome: [
    { cells: [0, null, null, null, 1, null, null, null, null] },
    { cells: [0, null, 0, null, 1, null, null, null, null], chrome: [2], label: 'CHROME' },
    { cells: [0, 0, 0, null, 1, null, null, null, null], chrome: [2, 1], label: 'never fades' },
  ],
  tape: [
    { cells: [1, 1, null, null, 0, null, null, null, null] },
    { cells: [1, 1, null, null, 0, null, null, null, null], tape: [2], label: 'TAPED' },
  ],
  fixative: [
    { cells: [0, null, null, null, 0, null, null, null, null] },
    { cells: [0, null, null, null, 0, null, null, null, null], seal: [0], label: 'SEALED' },
  ],
  wetFloor: [
    { cells: [1, 1, null, null, 0, null, null, null, null] },
    { cells: [1, 1, null, null, 0, null, null, null, null], line: [0, 2], label: 'WET FLOOR' },
    { cells: [1, 1, 1, null, 0, null, null, null, null], line: [0, 2], label: 'no line' },
  ],
  lockdown: [
    { cells: [1, null, null, null, 1, null, null, null, null] },
    { cells: [1, null, null, null, 1, null, null, null, null], lock: true, label: 'LOCKDOWN' },
  ],
  spin: [
    { cells: [0, 1, null, null, 0, null, 1, null, null] },
    { cells: [null, 0, 0, 1, 0, null, null, null, 1], wet: [1, 2, 3, 8], label: 'SPIN' },
  ],
  swap: [
    { cells: [0, 1, null, null, 0, null, null, null, null] },
    { cells: [1, 0, null, null, 0, null, null, null, null], wet: [0, 1], label: 'SWAP' },
  ],
  trap: [
    { cells: [0, null, null, null, 1, null, null, null, null], trap: [8] },
    { cells: [0, null, null, null, 1, null, null, null, 1], trap: [8], label: 'they paint it…' },
    { cells: [0, null, null, null, 1, null, null, null, 0], wet: [8], label: 'GOTCHA' },
  ],
  flip: [
    { cells: [1, null, null, 0, 0, null, 0, 1, 1] },
    { cells: [0, 1, 1, 0, 0, null, 1, null, null], flipY: true, label: 'FLIP' },
  ],
  afterimage: [
    { cells: [0, null, null, null, 1, null, null, null, null], ghost: [8] },
    { cells: [0, null, null, null, 1, null, null, null, 0], wet: [8], label: 'BACK AGAIN' },
  ],
  delay: [
    { cells: [1, 1, null, null, 0, null, null, null, null], label: 'DELAY' },
    { cells: [1, 1, 1, null, 0, null, null, null, null], wet: [2], label: 'wet: not yet!' },
  ],
  reverb: [
    { cells: [null, null, null, null, 1, null, null, null, null] },
    { cells: [0, null, null, null, 1, null, null, null, null], label: 'move' },
    { cells: [0, null, null, null, 1, null, null, null, 0], wet: [8], label: 'REVERB' },
  ],
  shield: [
    { cells: [0, null, null, null, 1, null, null, null, null] },
    { cells: [0, null, null, null, 1, null, null, null, null], seal: [0], label: 'SHIELD' },
    { cells: [0, null, null, null, 1, null, null, null, null], seal: [0], label: 'can’t be wiped' },
  ],
  relocate: [
    { cells: [0, 1, null, null, null, null, null, null, null] },
    { cells: [null, 1, null, null, null, null, 0, null, null], ghost: [0], label: 'RELOCATE' },
  ],
  freeze: [
    { cells: [0, null, null, null, 1, null, null, null, null] },
    { cells: [0, null, null, null, 1, null, null, null, null], lock: true, label: 'FREEZE: no powers' },
  ],
  rewind: [
    { cells: [0, 0, null, null, 1, null, null, null, null] },
    { cells: [0, 0, 1, null, 1, null, null, null, null], label: 'their move' },
    { cells: [0, 0, null, null, 1, null, null, null, null], label: 'REWIND' },
  ],
};



/** Play a power's preview on `c` in a loop; returns a stop function. */
export function playPreview(c: HTMLCanvasElement, id: AbilityId, manual = false): () => void {
  const P_COLORS = playerCss();
  const g = c.getContext('2d')!;
  const frames = PREVIEWS[id];
  const W = c.width;
  const H = c.height;
  const size = Math.min(W, H - 26) / 3.4;
  const ox = (W - size * 3) / 2;
  const oy = 6;
  let raf = 0;
  const t0 = performance.now();
  const draw = (t: number) => {
    const per = 0.95;
    const total = frames.length * per + 0.6;
    const at = ((t - t0) / 1000) % total;
    const i = Math.min(frames.length - 1, Math.floor(at / per));
    const k = Math.min(1, (at - i * per) / 0.25);
    const f = frames[i];
    g.clearRect(0, 0, W, H);
    g.save();
    if (f.flipY) {
      g.translate(0, oy + size * 1.5);
      g.scale(1, Math.cos(Math.PI * (1 - k)) * -1 || 0.01);
      g.translate(0, -(oy + size * 1.5));
    }
    for (let n = 0; n < 9; n++) {
      const x = ox + (n % 3) * size;
      const y = oy + Math.floor(n / 3) * size;
      g.fillStyle = '#b4afc4';
      g.strokeStyle = INK;
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(x + 3, y + 3, size - 6, size - 6, 8);
      g.fill();
      g.stroke();
      const m = f.cells[n];
      const fresh = i > 0 && frames[i - 1].cells[n] !== m;
      if (m !== null) {
        const s = fresh ? 0.4 + 0.6 * k : 1;
        const pad = (size - 6) * (1 - s) * 0.5 + 6;
        g.fillStyle = f.chrome?.includes(n) ? '#f2f2f7' : P_COLORS[m];
        g.beginPath();
        g.roundRect(x + pad, y + pad, size - pad * 2, size - pad * 2, 7);
        g.fill();
        g.stroke();
        if (f.chrome?.includes(n)) {
          g.strokeStyle = P_COLORS[m];
          g.lineWidth = 4;
          g.stroke();
        }
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x + size * 0.28, y + size * 0.42);
        g.lineTo(x + size * 0.42, y + size * 0.28);
        g.stroke();
        if (f.wet?.includes(n)) {
          g.fillStyle = P_COLORS[m];
          const d = ((t / 600 + n) % 1) * size * 0.35;
          g.beginPath();
          g.arc(x + size * 0.35, y + size - 8 + d, 4, 0, Math.PI * 2);
          g.arc(x + size * 0.65, y + size - 8 + d * 0.6, 3, 0, Math.PI * 2);
          g.fill();
        }
      }
      if (f.ghost?.includes(n)) {
        g.setLineDash([5, 5]);
        g.strokeStyle = 'rgba(255,255,255,0.6)';
        g.lineWidth = 2;
        g.strokeRect(x + 10, y + 10, size - 20, size - 20);
        g.setLineDash([]);
      }
      if (f.tape?.includes(n)) {
        g.strokeStyle = '#ffd23f';
        g.lineWidth = 8;
        g.beginPath();
        g.moveTo(x + 8, y + 8);
        g.lineTo(x + size - 8, y + size - 8);
        g.moveTo(x + size - 8, y + 8);
        g.lineTo(x + 8, y + size - 8);
        g.stroke();
      }
      if (f.trap?.includes(n)) {
        g.strokeStyle = P_COLORS[0];
        g.lineWidth = 4;
        g.beginPath();
        g.arc(x + size / 2, y + size / 2, size * 0.28, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.arc(x + size / 2, y + size / 2, size * 0.1, 0, Math.PI * 2);
        g.stroke();
      }
      if (f.seal?.includes(n)) {
        g.fillStyle = 'rgba(191,243,255,0.45)';
        g.strokeStyle = '#bff3ff';
        g.lineWidth = 3;
        g.beginPath();
        g.roundRect(x + 1, y + 1, size - 2, size - 2, 10);
        g.fill();
        g.stroke();
      }
    }
    if (f.line) {
      const [a, b] = f.line;
      g.strokeStyle = `rgba(255,210,63,${0.5 + 0.4 * Math.sin(t / 120)})`;
      g.lineWidth = 10;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(ox + (a % 3) * size + size / 2, oy + Math.floor(a / 3) * size + size / 2);
      g.lineTo(ox + (b % 3) * size + size / 2, oy + Math.floor(b / 3) * size + size / 2);
      g.stroke();
    }
    if (f.lock) {
      g.fillStyle = 'rgba(13,10,20,0.55)';
      g.fillRect(ox, oy, size * 3, size * 3);
      g.fillStyle = '#ffd23f';
      g.strokeStyle = INK;
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect(W / 2 - 22, oy + size * 1.3, 44, 34, 6);
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(W / 2, oy + size * 1.3, 14, Math.PI, 0);
      g.lineWidth = 7;
      g.stroke();
    }
    g.restore();
    if (f.label) {
      g.font = '900 15px "Inter Display", system-ui, sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 4;
      g.strokeStyle = INK;
      g.strokeText(f.label, W / 2, H - 6);
      g.fillStyle = '#f4f1ea';
      g.fillText(f.label, W / 2, H - 6);
    }
    if (!manual) raf = requestAnimationFrame(draw);
  };
  draw(performance.now() + 1100);
  if (!manual) raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
}
