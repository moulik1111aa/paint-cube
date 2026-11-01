// The Paint Cube look: geometry, materials and procedural textures shared by every
// scene. Cells are rounded, glossy dark casings; paint is cel-shaded (three tones)
// with an ink outline; the Core is an emissive gem bright enough to bloom.
// Everything is generated at startup: no image files to license or load.

import type { Three } from './three.ts';
import { theme } from '../theme.ts';
import { doodleTexture, washiTexture } from './notebook.ts';

export const PAINT = { orange: '#ff6a13', blue: '#1aa0ff' } as const;
/** Player colours in the 3D scene (the Notebook theme swaps them for blue and red ink). */
export const PLAYER_COLORS: string[] = [PAINT.orange, PAINT.blue];
export let CORE_COLOR = '#ffd84a';
export let INK = '#07060b';

/** Apply the current theme's colours (call before building a scene). */
export function applyThemeColors(): void {
  const nb = theme() === 'notebook';
  PLAYER_COLORS[0] = nb ? '#2350d8' : PAINT.orange;
  PLAYER_COLORS[1] = nb ? '#d63b33' : PAINT.blue;
  CORE_COLOR = nb ? '#e2a622' : '#ffd84a'; // Notebook: a kintsugi-gold Core
  INK = nb ? '#1f3fa8' : '#07060b';
}

/** A box with rounded edges: a subdivided box whose vertices are pulled onto a rounded shell. */
export function roundedBox(T: Three, size: number, radius: number, seg = 5): any {
  const g = new T.BoxGeometry(size, size, size, seg, seg, seg);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const h = size / 2;
  const inner = h - radius;
  const v = new T.Vector3();
  const c = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(Math.max(-inner, Math.min(inner, v.x)), Math.max(-inner, Math.min(inner, v.y)), Math.max(-inner, Math.min(inner, v.z)));
    const d = v.sub(c).normalize();
    n.setXYZ(i, d.x, d.y, d.z);
    p.setXYZ(i, c.x + d.x * radius, c.y + d.y * radius, c.z + d.z * radius);
  }
  g.computeBoundingSphere();
  return g;
}

/** Three hard light bands for cel shading. */
export function toonRamp(T: Three): any {
  const t = new T.DataTexture(new Uint8Array([70, 160, 255]), 3, 1, T.RedFormat);
  t.minFilter = T.NearestFilter;
  t.magFilter = T.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
};

/** Seeded random, so each splat variant always looks the same. */
function rand(seed: number): () => number {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** A white spray-paint splat: a fuzzy core, speckled overspray, and drips running down. */
export function splatTexture(T: Three, seed: number, size = 256): any {
  const [c, g] = canvas(size, size);
  const r = rand(seed + 1);
  const m = size / 2;
  g.fillStyle = '#fff';
  // Core: a lumpy blob.
  g.beginPath();
  const lobes = 16;
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const rr = size * (0.16 + r() * 0.08);
    const x = m + Math.cos(a) * rr;
    const y = m * 0.9 + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y);
    else g.quadraticCurveTo(m + Math.cos(a - 0.2) * rr * 1.3, m * 0.9 + Math.sin(a - 0.2) * rr * 1.3, x, y);
  }
  g.fill();
  // Overspray: dense specks fading out from the core.
  for (let i = 0; i < 1400; i++) {
    const a = r() * Math.PI * 2;
    const d = size * (0.16 + Math.pow(r(), 1.8) * 0.3);
    g.globalAlpha = 0.25 + r() * 0.75;
    g.beginPath();
    g.arc(m + Math.cos(a) * d, m * 0.9 + Math.sin(a) * d, 0.6 + r() * 1.8, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  // Drips run down the screen.
  g.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const x = m + (r() - 0.5) * size * 0.32;
    const y0 = m * 0.9 + size * 0.1;
    const len = size * (0.12 + r() * 0.26);
    const w = size * (0.018 + r() * 0.02);
    g.lineWidth = w;
    g.strokeStyle = '#fff';
    g.beginPath();
    g.moveTo(x, y0);
    g.lineTo(x, y0 + len);
    g.stroke();
    g.beginPath();
    g.arc(x, y0 + len, w * 0.85, 0, Math.PI * 2);
    g.fill();
  }
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

/**
 * A spray-painted fill for one face of a paint shell: a fade from a lighter tint at the
 * top to the base colour, spray grain, a darker overspray rim, and the classic white
 * graffiti shine (two diagonal strokes and a sparkle) in the top-left corner.
 */
export function sprayFillTexture(T: Three, base: string, light: string, seed: number, size = 1024): any {
  const [c, g] = canvas(size, size);
  const r = rand(seed + 5);
  const gr = g.createLinearGradient(0, 0, size * 0.3, size);
  gr.addColorStop(0, light);
  gr.addColorStop(0.65, base);
  gr.addColorStop(1, base);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  // Grain: light and dark specks, like a can sprayed from a distance.
  const k = size / 256;
  for (let i = 0; i < 1400 * k * k; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${r() * 0.12})` : `rgba(0,0,0,${r() * 0.1})`;
    const s = (0.8 + r() * 1.8) * k * 0.5;
    g.fillRect(r() * size, r() * size, s, s);
  }
  // Overspray rim: a soft dark band at the edges.
  const rim = g.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size * 0.74);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(10,5,20,0.45)');
  g.fillStyle = rim;
  g.fillRect(0, 0, size, size);
  // Shine.
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.lineCap = 'round';
  g.lineWidth = size * 0.07;
  g.beginPath();
  g.moveTo(size * 0.2, size * 0.42);
  g.lineTo(size * 0.42, size * 0.2);
  g.stroke();
  g.lineWidth = size * 0.035;
  g.beginPath();
  g.moveTo(size * 0.2, size * 0.56);
  g.lineTo(size * 0.3, size * 0.46);
  g.stroke();
  const sx = size * 0.62;
  const sy = size * 0.18;
  const sr = size * 0.07;
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 ? sr * 0.22 : sr;
    g.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
  }
  g.fill();
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Subtle concrete grain for the blank blocks (the "wall" the paint goes on). */
export function concreteTexture(T: Three, size = 1024): any {
  const [c, g] = canvas(size, size);
  const r = rand(77);
  const k = size / 256;
  g.fillStyle = '#b4afc4';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 900 * k * k; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${r() * 0.06})` : `rgba(255,255,255,${r() * 0.08})`;
    const s = (0.6 + r() * 1.6) * k * 0.6;
    g.fillRect(r() * size, r() * size, s, s);
  }
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A soft shock ring. */
export function ringTexture(T: Three, size = 256): any {
  const [c, g] = canvas(size, size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.62, 'rgba(255,255,255,0)');
  gr.addColorStop(0.8, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.92, 'rgba(255,255,255,0)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return new T.CanvasTexture(c);
}

/** A dark backdrop: deep violet at the top fading to near black, with a faint warm glow behind the cube. */
export function backdropTexture(T: Three): any {
  const [c, g] = canvas(16, 512);
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#2b1660');
  gr.addColorStop(0.45, '#160d33');
  gr.addColorStop(1, '#07060e');
  g.fillStyle = gr;
  g.fillRect(0, 0, 16, 512);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

export interface Materials {
  casing: any;
  casingEdge: any;
  core: any;
  paint: [any, any];
  drip: [any, any];
  ink: any;
  drop: any;
  ramp: any;
}

export function makeMaterials(T: Three, env: any): Materials {
  const ramp = toonRamp(T);
  if (theme() === 'notebook') {
    // Paper blocks and ballpoint marks: matte, no gloss.
    return {
      ramp,
      casing: new T.MeshStandardMaterial({ color: '#ffffff', map: washiTexture(T), roughness: 0.97, metalness: 0 }),
      casingEdge: new T.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.4 }),
      core: new T.MeshStandardMaterial({ color: CORE_COLOR, emissive: CORE_COLOR, emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.6, envMap: env, envMapIntensity: 0.8 }),
      paint: [
        new T.MeshStandardMaterial({ color: '#ffffff', map: doodleTexture(T, 'maru', PLAYER_COLORS[0], 1), roughness: 0.95 }),
        new T.MeshStandardMaterial({ color: '#ffffff', map: doodleTexture(T, 'batsu', PLAYER_COLORS[1], 2), roughness: 0.95 }),
      ],
      drip: [new T.MeshBasicMaterial({ color: PLAYER_COLORS[0] }), new T.MeshBasicMaterial({ color: PLAYER_COLORS[1] })],
      ink: new T.MeshBasicMaterial({ color: INK, side: T.BackSide }),
      drop: new T.MeshToonMaterial({ color: '#ffffff', gradientMap: ramp }),
    };
  }
  return {
    ramp,
    // Smooth satin blocks with a fine, faint grain (heavy grain read as blur on a phone).
    casing: new T.MeshStandardMaterial({ color: '#ffffff', map: concreteTexture(T), roughness: 0.62, metalness: 0.0, envMap: env, envMapIntensity: 0.5 }),
    casingEdge: new T.MeshBasicMaterial({ color: '#5b4fd6', transparent: true, opacity: 0.55 }),
    core: new T.MeshStandardMaterial({ color: CORE_COLOR, emissive: CORE_COLOR, emissiveIntensity: 2.4, roughness: 0.3 }),
    paint: [
      new T.MeshToonMaterial({ color: '#ffffff', map: sprayFillTexture(T, PAINT.orange, '#ffc23d', 1), gradientMap: ramp, emissive: PAINT.orange, emissiveIntensity: 0.04 }),
      new T.MeshToonMaterial({ color: '#ffffff', map: sprayFillTexture(T, PAINT.blue, '#7ff0ff', 2), gradientMap: ramp, emissive: PAINT.blue, emissiveIntensity: 0.04 }),
    ],
    /** Plain paint for drips and paintballs (no shine strokes). */
    drip: [
      new T.MeshToonMaterial({ color: PAINT.orange, gradientMap: ramp }),
      new T.MeshToonMaterial({ color: PAINT.blue, gradientMap: ramp }),
    ],
    ink: new T.MeshBasicMaterial({ color: INK, side: T.BackSide }),
    drop: new T.MeshToonMaterial({ color: '#ffffff', gradientMap: ramp }),
  };
}

/** A soft radial glow, used as a light pool behind the cube. */
export function glowTexture(T: Three, size = 256): any {
  const [c, g] = canvas(size, size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return new T.CanvasTexture(c);
}

/** Hairline cracks on transparent, laid over a mark that fades next turn. */
export function crackTexture(T: Three, size = 512): any {
  const [c, g] = canvas(size, size);
  const r = rand(311);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    g.lineWidth = w;
    g.strokeStyle = 'rgba(12,8,18,0.92)';
    g.beginPath();
    g.moveTo(x, y);
    let cx = x;
    let cy = y;
    const segs = 5 + Math.floor(r() * 4);
    for (let i = 0; i < segs; i++) {
      a += (r() - 0.5) * 0.9;
      cx += Math.cos(a) * (len / segs);
      cy += Math.sin(a) * (len / segs);
      g.lineTo(cx, cy);
      if (depth > 0 && r() < 0.3) {
        g.stroke();
        branch(cx, cy, a + (r() < 0.5 ? 0.9 : -0.9), len * 0.45, w * 0.6, depth - 1);
        g.lineWidth = w;
        g.strokeStyle = 'rgba(12,8,18,0.92)';
        g.beginPath();
        g.moveTo(cx, cy);
      }
    }
    g.stroke();
  };
  for (let k = 0; k < 5; k++) {
    const x = size * (0.25 + r() * 0.5);
    const y = size * (0.25 + r() * 0.5);
    branch(x, y, r() * Math.PI * 2, size * (0.35 + r() * 0.3), size * 0.012, 2);
  }
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
