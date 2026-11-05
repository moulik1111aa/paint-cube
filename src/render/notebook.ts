// The Notebook look: a lined notebook page behind the cube, graph paper under it, white
// washi-paper blocks with torn fibrous edges, and marks hatched in ballpoint ink. All
// drawn on canvases at startup (no image files).

import type { Three } from './three.ts';

const INK_BLUE = '#1f3fa8';

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
};

function seeded(seed: number): () => number {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const tex = (T: Three, c: HTMLCanvasElement, repeat = false): any => {
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  if (repeat) t.wrapS = T.RepeatWrapping;
  t.anisotropy = 8;
  return t;
};

/** Paper: warm white with faint fibres. */
function paper(g: CanvasRenderingContext2D, w: number, h: number, r: () => number, base = '#f7f5ee', fibres = 900): void {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  g.lineCap = 'round';
  for (let i = 0; i < fibres; i++) {
    const x = r() * w;
    const y = r() * h;
    const a = r() * Math.PI * 2;
    const len = 6 + r() * 26;
    g.strokeStyle = r() < 0.6 ? `rgba(150,130,100,${0.05 + r() * 0.08})` : `rgba(255,255,255,${0.4 + r() * 0.4})`;
    g.lineWidth = 0.6 + r() * 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.6) * len * 0.5, y + Math.sin(a + 0.6) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
}

/** A ballpoint line: thin, slightly wobbly, a little darker where the pen pressed. */
function pen(g: CanvasRenderingContext2D, pts: [number, number][], r: () => number, color = INK_BLUE, width = 3, wobble = 1.6): void {
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let pass = 0; pass < 2; pass++) {
    g.globalAlpha = pass ? 0.35 : 0.85;
    g.lineWidth = pass ? width * 0.6 : width;
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const jx = x + (r() - 0.5) * wobble;
      const jy = y + (r() - 0.5) * wobble;
      if (i === 0) g.moveTo(jx, jy);
      else g.lineTo(jx, jy);
    });
    g.stroke();
  }
  g.globalAlpha = 1;
}

/** Hatching across a rectangle at an angle, like shading with a ballpoint. */
function hatch(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, angle: number, gap: number, r: () => number, color: string, width: number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const cx = x + w / 2;
  const cy = y + h / 2;
  const L = Math.hypot(w, h);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (let d = -L / 2; d < L / 2; d += gap * (0.8 + r() * 0.4)) {
    const px = cx - dy * d;
    const py = cy + dx * d;
    pen(g, [[px - dx * L, py - dy * L], [px + dx * L, py + dy * L]], r, color, width * (0.7 + r() * 0.6), 2.5);
  }
  g.restore();
}

/** The notebook page behind the cube: ruled lines, a margin, punched holes and doodles. */
export function pageTexture(T: Three): any {
  const W = 1024;
  const H = 1536;
  const [c, g] = canvas(W, H);
  const r = seeded(5);
  paper(g, W, H, r, '#f8f6ef', 2400);
  // Ruled lines and the margin.
  g.strokeStyle = 'rgba(110,150,215,0.45)';
  g.lineWidth = 2;
  for (let y = 140; y < H; y += 44) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.strokeStyle = 'rgba(214,80,80,0.5)';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(96, 0);
  g.lineTo(96, H);
  g.stroke();
  // Punched holes.
  for (const y of [260, 760, 1260]) {
    g.fillStyle = '#e4e0d4';
    g.beginPath();
    g.arc(44, y, 20, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(120,110,90,0.35)';
    g.lineWidth = 2;
    g.stroke();
  }
  // (The title is HTML over the scene now: crisp at any screen size.)
  // Doodles: stars, a spiral, a little cube, arrows, "3x3".
  const star = (x: number, y: number, s: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? s * 0.45 : s;
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    pen(g, pts, r, INK_BLUE, 3);
  };
  star(220, 300, 34);
  star(860, 1000, 26);
  star(800, 260, 18);
  const spiral: [number, number][] = [];
  for (let a = 0; a < Math.PI * 8; a += 0.2) spiral.push([170 + Math.cos(a) * a * 4, 1050 + Math.sin(a) * a * 4]);
  pen(g, spiral, r, INK_BLUE, 2.4);
  // A sketched cube.
  const cx = 860;
  const cy = 560;
  const s = 50;
  const box: [number, number][][] = [
    [[cx - s, cy - s * 0.4], [cx, cy - s], [cx + s, cy - s * 0.4], [cx, cy + s * 0.2], [cx - s, cy - s * 0.4]],
    [[cx - s, cy - s * 0.4], [cx - s, cy + s * 0.7], [cx, cy + s * 1.3], [cx + s, cy + s * 0.7], [cx + s, cy - s * 0.4]],
    [[cx, cy + s * 0.2], [cx, cy + s * 1.3]],
  ];
  for (const p of box) pen(g, p, r, INK_BLUE, 2.6);
  hatch(g, cx - s, cy + s * 0.2, s, s * 0.9, 1.1, 8, r, INK_BLUE, 1.6);
  pen(g, [[160, 820], [300, 790], [285, 770], [300, 790], [285, 812]], r, INK_BLUE, 3);
  g.font = 'italic 700 64px "Inter Display", system-ui, sans-serif';
  g.fillStyle = INK_BLUE;
  g.globalAlpha = 0.8;
  g.save();
  g.translate(200, 640);
  g.rotate(-0.12);
  g.fillText('3×3', 0, 0);
  g.restore();
  g.save();
  g.translate(840, 1180);
  g.rotate(0.1);
  g.font = 'italic 700 46px "Inter Display", system-ui, sans-serif';
  g.fillText('win!', 0, 0);
  g.restore();
  g.globalAlpha = 1;
  // A red hanko seal in the corner, stamped slightly unevenly: ○× in a rounded square.
  g.save();
  g.translate(870, 1360);
  g.rotate(-0.06);
  g.fillStyle = 'rgba(200,48,40,0.85)';
  g.beginPath();
  g.roundRect(-58, -58, 116, 116, 14);
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.lineWidth = 10;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(-24, 0, 20, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(10, -20);
  g.lineTo(44, 20);
  g.moveTo(44, -20);
  g.lineTo(10, 20);
  g.stroke();
  // Worn spots in the ink.
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    g.arc((r() - 0.5) * 110, (r() - 0.5) * 110, 1 + r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  return tex(T, c, true);
}

/** Graph paper under the cube. */
export function gridTexture(T: Three): any {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const r = seeded(17);
  paper(g, S, S, r, '#f2efe6', 1400);
  for (let i = 0; i <= S; i += 32) {
    g.strokeStyle = i % 160 === 0 ? 'rgba(110,150,215,0.4)' : 'rgba(110,150,215,0.2)';
    g.lineWidth = i % 160 === 0 ? 2 : 1;
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, S);
    g.moveTo(0, i);
    g.lineTo(S, i);
    g.stroke();
  }
  const t = tex(T, c);
  t.wrapT = T.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

/** One face of a washi-paper block: fibres, a torn deckled edge, faint pencil guide lines. */
export function washiTexture(T: Three, size = 1024): any {
  const [c, g] = canvas(size, size);
  drawWashi(g, size, seeded(41));
  return tex(T, c);
}

function drawWashi(g: CanvasRenderingContext2D, size: number, r: () => number): void {
  paper(g, size, size, r, '#fbfaf5', 1600);
  // Deckled edge: an irregular cream band, torn on its inner side.
  const band = size * 0.06;
  g.fillStyle = 'rgba(226,216,190,0.85)';
  for (let side = 0; side < 4; side++) {
    g.save();
    g.translate(size / 2, size / 2);
    g.rotate((side * Math.PI) / 2);
    g.translate(-size / 2, -size / 2);
    g.beginPath();
    g.moveTo(0, 0);
    for (let x = 0; x <= size; x += size / 60) g.lineTo(x, band * (0.35 + r() * 0.9));
    g.lineTo(size, 0);
    g.closePath();
    g.fill();
    // Loose fibres sticking out of the torn edge.
    g.strokeStyle = 'rgba(190,175,140,0.6)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 40; i++) {
      const x = r() * size;
      const y = band * (0.4 + r() * 0.9);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 14, y + 4 + r() * 12);
      g.stroke();
    }
    g.restore();
  }
  // Faint pencil guide lines just inside the edge, like a sketch of the box.
  g.strokeStyle = 'rgba(70,90,150,0.18)';
  g.lineWidth = 2;
  const m = size * 0.12;
  for (let k = 0; k < 2; k++) {
    const o = m + k * 6 + (r() - 0.5) * 4;
    g.beginPath();
    g.moveTo(o, o + (r() - 0.5) * 6);
    g.lineTo(size - o, o + (r() - 0.5) * 6);
    g.lineTo(size - o + (r() - 0.5) * 6, size - o);
    g.lineTo(o + (r() - 0.5) * 6, size - o);
    g.closePath();
    g.stroke();
  }
}

/**
 * A handwritten pen stroke: one continuous line that starts thin as the pen lands,
 * swells with pressure, and tapers off as it lifts, with a little ink pooling where it
 * slows down.
 */
function handStroke(g: CanvasRenderingContext2D, pts: [number, number][], width: number, color: string, r: () => number): void {
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const n = pts.length;
  let wobble = 0;
  for (let i = 1; i < n; i++) {
    const t = i / (n - 1);
    wobble = wobble * 0.85 + (r() - 0.5) * 0.15;
    const press = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.55);
    g.globalAlpha = 0.82 + 0.15 * press;
    g.lineWidth = Math.max(width * 0.18, width * (0.35 + 0.65 * press) * (1 + wobble));
    g.beginPath();
    g.moveTo(pts[i - 1][0], pts[i - 1][1]);
    g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
  }
  // A small ink blob where the pen landed.
  g.globalAlpha = 0.9;
  g.beginPath();
  g.arc(pts[0][0], pts[0][1], width * 0.32, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
}

/** Points along a quadratic curve. */
function curve(a: [number, number], c: [number, number], b: [number, number], steps = 60): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

/**
 * A mark as a handwritten pen doodle on a paper face, maru-batsu style: player 1 writes
 * a circle (maru) in blue, player 2 a cross (batsu) in red, each in one quick stroke
 * the way you'd write it in the back of a notebook.
 */
export function doodleTexture(T: Three, kind: 'maru' | 'batsu', color: string, seed: number, size = 1024): any {
  const [c, g] = canvas(size, size);
  const r = seeded(seed + 11);
  drawWashi(g, size, r);
  const m = size / 2;
  const w = size * 0.058;
  if (kind === 'maru') {
    // One stroke, a little more than a full turn: slightly oval and tilted, the end
    // running past the start with a flick, like a fast hand-drawn circle.
    const pts: [number, number][] = [];
    const tilt = -0.35;
    const rx = size * 0.3;
    const ry = size * 0.27;
    const a0 = Math.PI * 1.15;
    const turns = Math.PI * 2 * 1.12;
    for (let i = 0; i <= 140; i++) {
      const t = i / 140;
      const a = a0 + t * turns;
      const grow = 1 + t * 0.06;
      const x = Math.cos(a) * rx * grow;
      const y = Math.sin(a) * ry * grow;
      pts.push([m + x * Math.cos(tilt) - y * Math.sin(tilt), m + x * Math.sin(tilt) + y * Math.cos(tilt)]);
    }
    const [lx, ly] = pts[pts.length - 1];
    const [px, py] = pts[pts.length - 6];
    pts.push([lx + (lx - px) * 2.2, ly + (ly - py) * 2.2 + size * 0.01]);
    handStroke(g, pts, w, color, r);
  } else {
    // Two strokes: down-right with a slight bow, then down-left, each with a small hook
    // where the pen lands.
    const d = size * 0.28;
    const s1 = curve([m - d, m - d * 0.95], [m - d * 0.05, m + d * 0.12], [m + d * 1.02, m + d]);
    s1.unshift([m - d - size * 0.02, m - d * 0.95 + size * 0.03]);
    handStroke(g, s1, w, color, r);
    const s2 = curve([m + d * 0.95, m - d], [m + d * 0.1, m - d * 0.05], [m - d * 0.98, m + d * 1.04]);
    s2.unshift([m + d * 0.95 - size * 0.035, m - d + size * 0.015]);
    handStroke(g, s2, w * 0.92, color, r);
  }
  return tex(T, c);
}

/** A mark: paper hatched and cross-hatched in ballpoint ink of the player's colour. */
export function inkFillTexture(T: Three, color: string, seed: number, size = 1024): any {
  const [c, g] = canvas(size, size);
  const r = seeded(seed + 3);
  paper(g, size, size, r, '#fbfaf5', 600);
  hatch(g, size * 0.06, size * 0.06, size * 0.88, size * 0.88, -0.8, 13, r, color, 3.4);
  hatch(g, size * 0.1, size * 0.1, size * 0.8, size * 0.8, 0.75, 17, r, color, 2.6);
  // Dense scribble in one corner, as if the pen went back over it.
  hatch(g, size * 0.55, size * 0.55, size * 0.35, size * 0.35, -0.2, 8, r, color, 2.8);
  // A quick sketched outline.
  const o = size * 0.08;
  pen(g, [[o, o], [size - o, o + 6], [size - o - 4, size - o], [o + 6, size - o - 4], [o, o]], r, color, 6, 6);
  return tex(T, c);
}
