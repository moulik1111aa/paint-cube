// The Paint Cube look: geometry, materials and procedural textures shared by every
// scene. Cells are rounded, glossy dark casings; paint is cel-shaded (three tones)
// with an ink outline; the Core is an emissive gem bright enough to bloom.
// Everything is generated at startup: no image files to license or load.

import type { Three } from './three.ts';

export const PAINT = { orange: '#ff6a13', blue: '#1aa0ff' } as const;
export const PLAYER_COLORS = [PAINT.orange, PAINT.blue] as const;
export const CORE_COLOR = '#ffd84a';
export const INK = '#07060b';

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

/** A white paint splat on transparent: a lumpy core, arms, and flung droplets. */
export function splatTexture(T: Three, seed: number, size = 256): any {
  const [c, g] = canvas(size, size);
  const r = rand(seed + 1);
  const m = size / 2;
  g.fillStyle = '#fff';
  g.beginPath();
  const lobes = 14;
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const rr = size * (0.2 + r() * 0.08);
    const x = m + Math.cos(a) * rr;
    const y = m + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y);
    else g.quadraticCurveTo(m + Math.cos(a - 0.2) * rr * 1.25, m + Math.sin(a - 0.2) * rr * 1.25, x, y);
  }
  g.fill();
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    const len = size * (0.18 + r() * 0.22);
    const w = size * (0.025 + r() * 0.035);
    g.lineCap = 'round';
    g.lineWidth = w;
    g.strokeStyle = '#fff';
    g.beginPath();
    g.moveTo(m + Math.cos(a) * size * 0.15, m + Math.sin(a) * size * 0.15);
    g.lineTo(m + Math.cos(a) * len, m + Math.sin(a) * len);
    g.stroke();
    g.beginPath();
    g.arc(m + Math.cos(a) * len, m + Math.sin(a) * len, w * 0.9, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 22; i++) {
    const a = r() * Math.PI * 2;
    const d = size * (0.3 + r() * 0.18);
    g.beginPath();
    g.arc(m + Math.cos(a) * d, m + Math.sin(a) * d, size * (0.006 + r() * 0.018), 0, Math.PI * 2);
    g.fill();
  }
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
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
  ink: any;
  drop: any;
  ramp: any;
}

export function makeMaterials(T: Three, env: any): Materials {
  const ramp = toonRamp(T);
  return {
    ramp,
    casing: new T.MeshStandardMaterial({ color: '#a9a4bb', roughness: 0.7, metalness: 0.0, envMap: env, envMapIntensity: 0.45 }),
    casingEdge: new T.MeshBasicMaterial({ color: '#5b4fd6', transparent: true, opacity: 0.55 }),
    core: new T.MeshStandardMaterial({ color: CORE_COLOR, emissive: CORE_COLOR, emissiveIntensity: 2.4, roughness: 0.3 }),
    paint: [
      new T.MeshToonMaterial({ color: PAINT.orange, gradientMap: ramp, emissive: PAINT.orange, emissiveIntensity: 0.05 }),
      new T.MeshToonMaterial({ color: PAINT.blue, gradientMap: ramp, emissive: PAINT.blue, emissiveIntensity: 0.05 }),
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
