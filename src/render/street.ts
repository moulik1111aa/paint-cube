// Street-art set dressing, all drawn procedurally at startup: a graffiti-covered
// concrete wall (with our own "PAINT CUBE" piece), a stained concrete ground, comic
// starburst captions, and spray-paint splat shapes. Nothing here copies a real artwork.

import type { Three } from './three.ts';

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
};

function seeded(seed: number): () => number {
  let s = (seed * 2654435761) % 4294967296 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const FONT = '"Inter Display", Inter, system-ui, sans-serif';

/** Make sure the display font is ready before drawing text into canvases. */
export async function fontsReady(): Promise<void> {
  try {
    await Promise.all([document.fonts.load(`900 120px ${FONT}`), document.fonts.load(`700 60px ${FONT}`)]);
  } catch {
    /* fall back to the system font */
  }
}

function concrete(g: CanvasRenderingContext2D, w: number, h: number, base: string, r: () => number, specks = 9000): void {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < specks; i++) {
    const v = Math.floor(r() * 60);
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${0.04 + r() * 0.08})` : `rgba(${150 + v},${150 + v},${170 + v},${0.03 + r() * 0.05})`;
    const s = 1 + r() * 4;
    g.fillRect(r() * w, r() * h, s, s);
  }
  // Large soft blotches of grime.
  for (let i = 0; i < 40; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = 40 + r() * 220;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(0,0,0,${0.08 + r() * 0.12})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

/** Spray-can dust: a soft round puff. */
function puff(g: CanvasRenderingContext2D, x: number, y: number, rad: number, color: string, alpha: number): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, rad);
  gr.addColorStop(0, color.replace('ALPHA', String(alpha)));
  gr.addColorStop(1, color.replace('ALPHA', '0'));
  g.fillStyle = gr;
  g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}

/** Drips running down from a painted edge. */
function drips(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, color: string, r: () => number, n = 6): void {
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * (x1 - x0);
    const len = 20 + r() * 110;
    const w = 4 + r() * 7;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y + len);
    g.stroke();
    g.beginPath();
    g.arc(x, y + len, w * 0.75, 0, Math.PI * 2);
    g.fill();
  }
}

/** Big bubble letters with an outline, a 3D shadow, a highlight and drips. */
function bubbleText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, r: () => number, rot = -0.07): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.font = `900 ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  // Drop shadow block.
  g.fillStyle = '#120b1f';
  for (let k = 1; k <= 14; k++) g.fillText(text, k * 1.4, k * 1.6);
  // Fat outline, then fill, then a lighter inner stroke.
  g.lineWidth = size * 0.16;
  g.strokeStyle = '#0d0a14';
  g.strokeText(text, 0, 0);
  g.fillStyle = fill;
  g.fillText(text, 0, 0);
  g.lineWidth = size * 0.035;
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.save();
  g.translate(-size * 0.02, -size * 0.03);
  g.beginPath();
  g.rect(-size * 4, -size, size * 8, size * 0.62);
  g.clip();
  g.strokeText(text, 0, 0);
  g.restore();
  const wd = g.measureText(text).width;
  drips(g, -wd / 2 + 10, wd / 2 - 10, size * 0.38, fill, r, 9);
  g.restore();
}

function star(g: CanvasRenderingContext2D, x: number, y: number, rad: number, color: string): void {
  g.save();
  g.translate(x, y);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? rad * 0.45 : rad;
    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.lineWidth = rad * 0.12;
  g.strokeStyle = '#0d0a14';
  g.stroke();
  g.restore();
}

/** Scribbled tag strokes (abstract, no readable words). */
function scribble(g: CanvasRenderingContext2D, x: number, y: number, w: number, color: string, r: () => number): void {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 5 + r() * 5;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(x, y);
  let cx = x;
  for (let i = 0; i < 9; i++) {
    cx += w / 9;
    g.bezierCurveTo(cx - w / 18, y - 40 - r() * 50, cx - w / 30, y + 30 + r() * 40, cx, y + (r() - 0.5) * 30);
  }
  g.stroke();
  g.restore();
}

/** The alley wall: concrete, bricks showing through, graffiti and the Paint Cube piece. */
export function wallTexture(T: Three): any {
  const W = 1024;
  const H = 1536;
  const [c, g] = canvas(W, H);
  const r = seeded(11);
  concrete(g, W, H, '#3b3846', r, 12000);
  // Faint brick courses where the render has worn away.
  g.strokeStyle = 'rgba(10,8,16,0.35)';
  g.lineWidth = 3;
  for (let y = 0; y < H; y += 30) {
    if (r() < 0.45) continue;
    const x0 = r() * W;
    const len = 120 + r() * 300;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x0 + len, y);
    g.stroke();
    for (let x = x0 + (y % 60 ? 0 : 32); x < x0 + len; x += 64) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + 30);
      g.stroke();
    }
  }
  // Background color fields, sprayed.
  const fields = ['rgba(255,61,139,ALPHA)', 'rgba(56,214,255,ALPHA)', 'rgba(245,230,99,ALPHA)', 'rgba(124,77,255,ALPHA)', 'rgba(255,122,26,ALPHA)'];
  for (let i = 0; i < 30; i++) puff(g, r() * W, r() * H, 60 + r() * 200, fields[i % fields.length], 0.2 + r() * 0.25);
  // Abstract tags.
  const tagColors = ['#f4f1ea', '#0d0a14', '#ff3d8b', '#38d6ff', '#f5e663'];
  for (let i = 0; i < 18; i++) scribble(g, r() * W * 0.85, 80 + r() * (H - 160), 90 + r() * 180, tagColors[i % tagColors.length], r);
  // Stars and dots.
  for (let i = 0; i < 10; i++) star(g, r() * W, r() * H * 0.9, 14 + r() * 28, ['#f5e663', '#ff3d8b', '#38d6ff'][i % 3]);
  // The piece: centered above the cube.
  // The wall is 12 x 18 world units; the cube hides its middle, so the piece sits above.
  bubbleText(g, 'PAINT', W / 2 - 6, H * 0.39, 112, '#ff7a1a', r, -0.08);
  bubbleText(g, 'CUBE', W / 2 + 22, H * 0.47, 104, '#1aa0ff', r, -0.04);
  // Side pieces for wide screens.
  bubbleText(g, '3x3', W * 0.1, H * 0.42, 110, '#f5e663', r, 0.06);
  bubbleText(g, 'WIN!', W * 0.9, H * 0.38, 110, '#ff3d8b', r, -0.1);
  drips(g, 0, W, 0, 'rgba(13,10,20,0.6)', r, 24);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.wrapS = T.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** The ground: stained concrete with old paint spills. */
export function groundTexture(T: Three): any {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const r = seeded(29);
  concrete(g, S, S, '#2a2733', r, 9000);
  const spills = ['#ff7a1a', '#1aa0ff', '#ff3d8b', '#f5e663'];
  for (let i = 0; i < 14; i++) {
    const x = r() * S;
    const y = r() * S;
    g.fillStyle = spills[i % spills.length];
    g.globalAlpha = 0.35 + r() * 0.3;
    g.beginPath();
    const rad = 14 + r() * 50;
    for (let k = 0; k <= 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const rr = rad * (0.7 + r() * 0.5);
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.7);
    }
    g.fill();
    for (let k = 0; k < 8; k++) {
      g.beginPath();
      g.arc(x + (r() - 0.5) * rad * 4, y + (r() - 0.5) * rad * 3, 2 + r() * 6, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  // Expansion joints.
  g.strokeStyle = 'rgba(5,4,10,0.6)';
  g.lineWidth = 4;
  for (let k = 1; k < 4; k++) {
    g.beginPath();
    g.moveTo(0, (S * k) / 4);
    g.lineTo(S, (S * k) / 4);
    g.stroke();
    g.beginPath();
    g.moveTo((S * k) / 4, 0);
    g.lineTo((S * k) / 4, S);
    g.stroke();
  }
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(3, 2);
  t.anisotropy = 4;
  return t;
}

/** A comic starburst caption ("LINE!", "WIN!"). */
export function burstTexture(T: Three, text: string, fill = '#f5e663'): any {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.translate(S / 2, S / 2);
  g.rotate(-0.12);
  g.beginPath();
  const spikes = 16;
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const rr = i % 2 ? 150 + (i % 3) * 8 : 238 - (i % 5) * 10;
    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.8);
  }
  g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = 16;
  g.strokeStyle = '#0d0a14';
  g.stroke();
  g.fillStyle = fill;
  g.fill();
  g.font = `900 ${text.length > 4 ? 104 : 128}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#0d0a14';
  g.fillText(text, 6, 12);
  g.lineWidth = 14;
  g.strokeText(text, 0, 4);
  g.fillStyle = '#ffffff';
  g.fillText(text, 0, 4);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}
