// three.js on demand: the library ships as inert text in the page (see scripts/build.mjs)
// and is only parsed the first time a 3D scene opens. Shared helpers for the 3D scenes:
// a renderer that fits its host, 2D cut-out / glow / text textures, and a render loop
// that sleeps when the screen is hidden, scrolled away or idle, and is disposed with
// its screen (nothing keeps running after its work is done).

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Three = any;

let loading: Promise<Three> | null = null;
/** Whether WebGL works here at all (checked once). */
let webgl: boolean | null = null;

export function webglOk(): boolean {
  if (webgl === null) {
    try {
      const c = document.createElement('canvas');
      webgl = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

export function loadThree(): Promise<Three> {
  if (!loading) {
    loading = (async () => {
      const src = document.getElementById('three-src')?.textContent;
      if (!src || !webglOk()) throw new Error('3D not available');
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      // A real dynamic import (the bundler would otherwise turn import() into require()).
      const mod = await (new Function('u', 'return import(u)') as (u: string) => Promise<Three>)(url);
      URL.revokeObjectURL(url);
      return mod;
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}

/** A renderer drawing into `host` (sized to it), with soft tone mapping. */
export function makeRenderer(T: Three, host: HTMLElement): { r: any; w: number; h: number; resize: () => void } {
  const r = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  r.toneMapping = T.ACESFilmicToneMapping;
  r.outputColorSpace = T.SRGBColorSpace;
  r.domElement.className = 'gl';
  host.appendChild(r.domElement);
  const out = { r, w: 1, h: 1, resize: () => {} };
  out.resize = () => {
    // Size to the canvas as laid out by CSS (it may not fill the whole host).
    out.w = Math.max(1, r.domElement.clientWidth || host.clientWidth);
    out.h = Math.max(1, r.domElement.clientHeight || host.clientHeight);
    r.setSize(out.w, out.h, false);
  };
  out.resize();
  return out;
}

/** A soft studio environment so glossy and metal materials have something to reflect. */
export function softEnv(T: Three, r: any, top = '#fdf4ff', bottom = '#1e1b4b'): any {
  const s = new T.Scene();
  const g = new T.SphereGeometry(10, 32, 16);
  const col: number[] = [];
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const c = new T.Color().lerpColors(new T.Color(bottom), new T.Color(top), (p.getY(i) / 10 + 1) / 2);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  s.add(new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
  const light = new T.Mesh(new T.SphereGeometry(2, 16, 8), new T.MeshBasicMaterial({ color: '#ffffff' }));
  light.position.set(-4, 6, 6);
  s.add(light);
  const pm = new T.PMREMGenerator(r);
  const tex = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  g.dispose();
  return tex;
}

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
};
const tex = (T: Three, c: HTMLCanvasElement): any => {
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
};

/** An emoji as a paper cut-out (white edge). */
export function cutoutTex(T: Three, emoji: string, size = 192, edge = 12): any {
  const [c, g] = canvas(size, size);
  g.font = `${size * 0.7}px "Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let a = 0; a < 12; a++) {
    g.save();
    g.translate((Math.cos((a / 12) * Math.PI * 2) * edge) / 2, (Math.sin((a / 12) * Math.PI * 2) * edge) / 2);
    g.filter = 'brightness(0) invert(1)';
    g.fillText(emoji, size / 2, size * 0.54);
    g.restore();
  }
  g.filter = 'none';
  g.fillText(emoji, size / 2, size * 0.54);
  return tex(T, c);
}

/** An SVG string drawn as a cut-out texture (white edge). */
export async function svgCutoutTex(T: Three, svg: string, w: number, h: number, edge = 10): Promise<any> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const [c, g] = canvas(w + edge * 2, h + edge * 2);
  if (edge) {
    for (let a = 0; a < 12; a++) {
      g.save();
      g.filter = 'brightness(0) invert(1)';
      g.drawImage(img, edge + Math.cos((a / 12) * Math.PI * 2) * edge * 0.6, edge + Math.sin((a / 12) * Math.PI * 2) * edge * 0.6, w, h);
      g.restore();
    }
  }
  g.drawImage(img, edge, edge, w, h);
  return tex(T, c);
}

/** A soft round glow (for additive sprites). */
export function glowTex(T: Three, rgb = '255,240,180'): any {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(${rgb},1)`);
  gr.addColorStop(0.35, `rgba(${rgb},.5)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return tex(T, c);
}

/** Bold outlined text. */
export function textTex(T: Three, txt: string, o: { size?: number; color?: string; stroke?: string; w?: number; h?: number } = {}): any {
  const size = o.size ?? 80;
  const [c, g] = canvas(o.w ?? 256, o.h ?? 128);
  g.font = `700 ${size}px "Inter Display", Inter, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.18;
  g.strokeStyle = o.stroke ?? '#0F1530';
  g.strokeText(txt, c.width / 2, c.height / 2);
  g.fillStyle = o.color ?? '#fff';
  g.fillText(txt, c.width / 2, c.height / 2);
  return tex(T, c);
}

/** A soft cloud. */
export function cloudTex(T: Three, color = '#ffffff'): any {
  const [c, g] = canvas(256, 128);
  g.fillStyle = color;
  for (const [x, y, rr] of [[75, 80, 35], [125, 60, 48], [175, 80, 38], [125, 90, 40], [210, 95, 22], [45, 98, 22]]) {
    g.beginPath();
    g.arc(x, y, rr, 0, Math.PI * 2);
    g.fill();
  }
  return tex(T, c);
}

/** Free every geometry, material and texture under an object. */
export function disposeAll(obj: any): void {
  obj?.traverse?.((o: any) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k of Object.keys(m)) if (m[k]?.isTexture) m[k].dispose();
      m.dispose?.();
    }
  });
}

/**
 * Runs `draw(t)` every frame while running; sleeps when the page is hidden, the host is
 * off screen, or (with `idleMs`) after no touches for a while; a touch wakes it.
 */
export class RenderLoop {
  private raf = 0;
  private visible = true;
  private onScreen = true;
  private idle = false;
  private idleTimer = 0;
  private start = performance.now();
  private dead = false;
  private readonly io: IntersectionObserver | null;
  private readonly wake = () => this.touch();
  private readonly vis = () => {
    this.visible = document.visibilityState !== 'hidden';
    this.kick();
  };

  private readonly draw: (t: number) => void;
  private readonly idleMs: number;

  constructor(host: HTMLElement, draw: (t: number) => void, idleMs = 0, watchScroll = true) {
    this.draw = draw;
    this.idleMs = idleMs;
    document.addEventListener('visibilitychange', this.vis);
    document.addEventListener('pointerdown', this.wake, { capture: true, passive: true });
    this.io = watchScroll && typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((e) => {
      this.onScreen = e.some((x) => x.isIntersecting);
      this.kick();
    }) : null;
    this.io?.observe(host);
    this.touch();
  }

  private get running(): boolean {
    return !this.dead && this.visible && this.onScreen && !this.idle;
  }

  private kick(): void {
    if (this.running && !this.raf) {
      const step = () => {
        this.raf = 0;
        if (!this.running) return;
        this.draw((performance.now() - this.start) / 1000);
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    }
  }

  /** Keep drawing (e.g. while an attack plays). */
  touch(): void {
    this.idle = false;
    clearTimeout(this.idleTimer);
    if (this.idleMs) this.idleTimer = window.setTimeout(() => (this.idle = true), this.idleMs);
    this.kick();
  }

  stop(): void {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.idleTimer);
    this.io?.disconnect();
    document.removeEventListener('visibilitychange', this.vis);
    document.removeEventListener('pointerdown', this.wake, { capture: true });
  }
}
