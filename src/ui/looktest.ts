// Look test: one scene with the full visual stack, to judge the look on a real phone
// before the game screens are built on it. Buttons fire each effect; drag spins the
// cube; tapping a cell paints it. `?manual` freezes the clock so tests can step time
// (window.__look.advance) and capture exact moments.

import { loadThree, makeRenderer, RenderLoop, softEnv, disposeAll, type Three } from '../render/three.ts';
import { Post } from '../render/post.ts';
import { makeMaterials, roundedBox, PLAYER_COLORS, CORE_COLOR, type Materials } from '../render/look.ts';
import { wallTexture, groundTexture, burstTexture, fontsReady } from '../render/street.ts';
import { Fx, Tweens, Clock, Shake, ease } from '../render/fx3d.ts';
import { Sfx } from '../audio/sfx.ts';
import { CELLS, CENTER, LINES, coord, type Line, type Player } from '../core/geometry.ts';
import { TWISTS, permutation, type Twist } from '../core/twist.ts';

declare global {
  interface Window {
    __BUILD__?: { version: string; build?: string; builtAt: string };
    __look?: { act: (name: string) => Promise<void>; advance: (sec: number, draw?: boolean) => void; ready: boolean };
  }
}

const SPACING = 1.0;
const CELL = 0.8;
const ACTIONS = [
  ['splat', 'Splat'],
  ['twist', 'Twist'],
  ['line', 'Line'],
  ['fade', 'Fade'],
  ['win', 'Win'],
  ['reset', 'Reset'],
] as const;

export function showLookTest(app: HTMLElement): () => void {
  const manual = new URLSearchParams(location.search).has('manual');
  const root = document.createElement('div');
  root.className = 'look';
  root.dataset.threeD = 'loading';
  const b = window.__BUILD__;
  root.innerHTML =
    '<div class="stage"></div>' +
    '<header><h1 class="sr-only">Paint Cube</h1>' +
    `<p class="meta">Look test · build ${b?.build ?? 'dev'} · <b class="fps">--</b> fps</p></header>` +
    `<nav class="actions">${ACTIONS.map(([k, l]) => `<button type="button" data-act="${k}">${l}</button>`).join('')}</nav>` +
    '<p class="hint">Drag to spin · tap a cell to paint it</p>';
  app.appendChild(root);
  const stage = root.querySelector('.stage') as HTMLElement;

  let stop: (() => void) | null = null;
  let gone = false;
  Promise.all([loadThree(), fontsReady()])
    .then(([T]) => {
      if (gone) return;
      stop = scene(T, root, stage, manual);
      root.dataset.threeD = 'ok';
    })
    .catch((e) => {
      console.warn(e);
      if (gone) return;
      root.dataset.threeD = 'off';
      stage.insertAdjacentHTML('beforeend', '<div class="no3d">3D is not available on this device</div>');
    });
  return () => {
    gone = true;
    stop?.();
    root.remove();
  };
}

function scene(T: Three, root: HTMLElement, stage: HTMLElement, manual: boolean): () => void {
  const view = makeRenderer(T, stage);
  const r = view.r;
  r.toneMapping = T.NoToneMapping;
  r.shadowMap.enabled = true;
  r.shadowMap.type = T.PCFSoftShadowMap;
  let pixelRatio = Math.min(2, devicePixelRatio || 1);
  r.setPixelRatio(pixelRatio);
  const post = new Post(T, r);
  const sfx = new Sfx();
  const clock = new Clock();
  const tweens = new Tweens();
  const shake = new Shake();

  const world = new T.Scene();
  world.background = new T.Color('#0b0816');
  const env = softEnv(T, r, '#9a8cff', '#0a0912');
  const M: Materials = makeMaterials(T, env);
  const camera = new T.PerspectiveCamera(38, 1, 0.5, 80);
  camera.layers.enable(1);

  // Night alley: cool blue ambience, a warm streetlamp casting shadows, a magenta rim.
  world.add(new T.HemisphereLight('#7c6cff', '#1a1020', 1.1));
  const lamp = new T.SpotLight('#ffd29a', 3.4, 0, 0.62, 0.75, 0);
  lamp.position.set(-4.5, 8, 7);
  lamp.target.position.set(0.5, -1, -2);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.bias = -0.0006;
  lamp.shadow.radius = 4;
  world.add(lamp, lamp.target);
  const rim = new T.DirectionalLight('#ff4fa3', 1.4);
  rim.position.set(5, 3, -4);
  world.add(rim);
  const fill = new T.DirectionalLight('#38d6ff', 0.6);
  fill.position.set(-4, -2, 5);
  world.add(fill);

  // The alley: a graffiti wall behind and a concrete ground under the floating cube.
  const wallTex = wallTexture(T);
  const wall = new T.Mesh(new T.PlaneGeometry(12, 18), new T.MeshStandardMaterial({ map: wallTex, roughness: 0.95 }));
  wall.position.set(0, 3, -5);
  wall.receiveShadow = true;
  world.add(wall);
  const ground = new T.Mesh(new T.PlaneGeometry(40, 30), new T.MeshStandardMaterial({ map: groundTexture(T), roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -2.6, 10);
  ground.receiveShadow = true;
  world.add(ground);

  const cube = new T.Group();
  world.add(cube);
  const fx = new Fx(T, M.drop);
  world.add(fx.group);

  const slot = (i: number) => {
    const [x, y, z] = coord(i);
    return new T.Vector3((x - 1) * SPACING, (z - 1) * SPACING, (y - 1) * SPACING);
  };
  const toWorld = (i: number) => {
    cube.updateMatrixWorld();
    return cube.localToWorld(slot(i));
  };

  // Casings: rounded glossy cells around the Core.
  const casingGeo = roundedBox(T, CELL, 0.14, 4);
  const casings: any[] = [];
  for (let i = 0; i < CELLS; i++) {
    if (i === CENTER) {
      casings.push(null);
      continue;
    }
    const m = new T.Mesh(casingGeo, M.casing);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.copy(slot(i));
    m.userData.cell = i;
    cube.add(m);
    casings.push(m);
  }
  const core = new T.Mesh(new T.IcosahedronGeometry(0.27, 1), M.core);
  core.castShadow = true;
  cube.add(core);
  const coreLight = new T.PointLight(CORE_COLOR, 7, 3.2, 1.6);
  cube.add(coreLight);

  // Paint shells: a cel-shaded blob over the cell, an ink outline, and a few drips.
  const shellGeo = roundedBox(T, 0.86, 0.22, 5);
  const dripGeo = new T.SphereGeometry(1, 14, 10);
  const owners: (Player | null)[] = Array(CELLS).fill(null);
  const shells: (any | null)[] = Array(CELLS).fill(null);
  let order: number[] = [];
  let nextPlayer: Player = 0;

  function makeShell(p: Player, seed: number): any {
    const g = new T.Group();
    const body = new T.Mesh(shellGeo, M.paint[p]);
    body.castShadow = true;
    body.receiveShadow = true;
    const hull = new T.Mesh(shellGeo, M.ink);
    hull.scale.setScalar(1.07);
    g.add(hull, body);
    let s = seed * 7919 + 13;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let k = 0; k < 3; k++) {
      const d = dirs[Math.floor(rnd() * 6)];
      const pos = new T.Vector3(d[0], d[1], d[2]).multiplyScalar(0.44);
      const free = [0, 1, 2].filter((a) => d[a] === 0);
      pos.setComponent(free[0], (rnd() - 0.5) * 0.5);
      pos.setComponent(free[1], (rnd() - 0.5) * 0.5);
      const rad = 0.06 + rnd() * 0.05;
      const drip = new T.Mesh(dripGeo, M.paint[p]);
      drip.position.copy(pos);
      drip.scale.setScalar(rad);
      const dh = new T.Mesh(dripGeo, M.ink);
      dh.position.copy(pos);
      dh.scale.setScalar(rad * 1.3);
      g.add(dh, drip);
    }
    return g;
  }

  // Spray paint runs: drips crawl down the face that looks at the camera.
  const dripRod = new T.CylinderGeometry(1, 1, 1, 8, 1);
  dripRod.translate(0, -0.5, 0);
  function addDrips(shell: any, cell: number, p: Player): void {
    cube.updateMatrixWorld();
    const centre = slot(cell);
    const toCam = cube.worldToLocal(camera.position.clone()).sub(centre).normalize();
    const down = cube.worldToLocal(new T.Vector3(0, -1, 0).add(cube.getWorldPosition(new T.Vector3()))).normalize();
    const axes = [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)];
    const faces = axes.flatMap((a) => [a.clone(), a.clone().negate()]).filter((f) => Math.abs(f.dot(down)) < 0.7);
    faces.sort((a, b) => b.dot(toCam) - a.dot(toCam));
    const face = faces[0];
    if (!face) return;
    const run = down.clone().addScaledVector(face, -down.dot(face)).normalize();
    const across = new T.Vector3().crossVectors(face, run).normalize();
    const count = 1 + Math.floor(Math.random() * 2);
    for (let k = 0; k < count; k++) {
      const start = face.clone().multiplyScalar(0.44).addScaledVector(across, (Math.random() - 0.5) * 0.5).addScaledVector(run, -0.05);
      const len = 0.3 + Math.random() * 0.35;
      const w = 0.035 + Math.random() * 0.025;
      const g = new T.Group();
      g.position.copy(start);
      g.quaternion.setFromUnitVectors(new T.Vector3(0, -1, 0), run);
      const rod = new T.Mesh(dripRod, M.paint[p]);
      const tip = new T.Mesh(dripGeo, M.paint[p]);
      rod.scale.set(w, 0.001, w);
      tip.scale.setScalar(w * 1.5);
      g.add(rod, tip);
      shell.add(g);
      void anim(1.3 + Math.random() * 0.6, (t) => {
        const l = len * ease.outCubic(t);
        rod.scale.y = Math.max(0.001, l);
        tip.position.y = -l;
      });
    }
  }

  // Comic captions ("LINE!", "WIN!"): pop in, hold, fade.
  const captionTex = new Map<string, any>();
  async function caption(text: string, fill: string, at: any, size: number): Promise<void> {
    const key = text + fill;
    if (!captionTex.has(key)) captionTex.set(key, burstTexture(T, text, fill));
    const s = new T.Sprite(new T.SpriteMaterial({ map: captionTex.get(key), transparent: true, depthTest: false, depthWrite: false }));
    s.layers.set(1);
    s.renderOrder = 20;
    s.position.copy(at);
    world.add(s);
    await anim(0.22, (k) => {
      const g = size * ease.outBack(k);
      s.scale.set(g, g, 1);
      s.material.rotation = (1 - k) * 0.5;
    });
    await anim(0.55, (k) => (s.material.rotation = Math.sin(k * 9) * 0.03));
    await anim(0.25, (k) => {
      s.material.opacity = 1 - k;
      s.scale.setScalar(size * (1 + k * 0.15));
    });
    world.remove(s);
    s.material.dispose();
  }

  // Pulses that decay back to the resting look.
  const pulse = { bloom: 0, aberr: 0, flash: 0 };
  const hit = (s: { freeze?: number; shake?: number; bloom?: number; aberr?: number; flash?: number }) => {
    clock.freeze = Math.max(clock.freeze, s.freeze ?? 0);
    shake.add(s.shake ?? 0);
    pulse.bloom = Math.max(pulse.bloom, s.bloom ?? 0);
    pulse.aberr = Math.max(pulse.aberr, s.aberr ?? 0);
    pulse.flash = Math.max(pulse.flash, s.flash ?? 0);
  };

  const anim = (dur: number, step: (k: number) => void, delay = 0) => new Promise<void>((res) => tweens.add(dur, step, res, delay));
  const wait = (sec: number) => new Promise<void>((res) => tweens.wait(sec, res));

  const towardCamera = (pos: any) => camera.position.clone().sub(pos).normalize();

  async function paint(cell: number, p: Player, ball = true): Promise<void> {
    if (owners[cell] !== null || cell === CENTER) return;
    owners[cell] = p;
    order.push(cell);
    const color = PLAYER_COLORS[p];
    const target = toWorld(cell);
    if (ball) {
      const start = camera.position.clone().add(new T.Vector3(0.9 - p * 1.8, -1.6, -1.2));
      const mid = start.clone().lerp(target, 0.5).add(new T.Vector3(0, 1.3, 0));
      const orb = new T.Group();
      const ballMesh = new T.Mesh(dripGeo, M.paint[p]);
      const ballInk = new T.Mesh(dripGeo, M.ink);
      ballInk.scale.setScalar(1.18);
      orb.add(ballInk, ballMesh);
      orb.scale.setScalar(0.15);
      world.add(orb);
      const prev = start.clone();
      await anim(0.26, (k) => {
        const a = start.clone().lerp(mid, k);
        const c = mid.clone().lerp(target, k);
        const pos = a.lerp(c, k);
        orb.position.copy(pos);
        const v = pos.clone().sub(prev);
        if (v.lengthSq() > 1e-6) {
          orb.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), v.clone().normalize());
          orb.scale.set(0.13, 0.13 * (1 + Math.min(1.4, v.length() * 9)), 0.13);
          fx.burst(pos, color, 1, 0.25, 0.035, undefined, 1, 0.3);
        }
        prev.copy(pos);
      });
      world.remove(orb);
    }
    const n = towardCamera(target);
    hit({ freeze: 0.06, shake: 0.32, bloom: 0.9, aberr: 0.006 });
    sfx.splat(0.9 + Math.random() * 0.2);
    fx.burst(target.clone().addScaledVector(n, 0.4), color, 34, 4.4, 0.065, n, 0.95);
    fx.splat(target.clone().addScaledVector(n, 0.5), color, 1.7, 0.5);
    fx.ring(target.clone().addScaledVector(n, 0.45), color, 1.9, 0.32);
    const shell = makeShell(p, cell + order.length * 31);
    shell.position.copy(slot(cell));
    shell.scale.setScalar(0.2);
    cube.add(shell);
    shells[cell] = shell;
    addDrips(shell, cell, p);
    await anim(0.5, (k) => shell.scale.setScalar(0.2 + 0.8 * ease.outElastic(k)));
  }

  function removeShell(cell: number): void {
    const s = shells[cell];
    if (s) cube.remove(s);
    shells[cell] = null;
    owners[cell] = null;
    order = order.filter((c) => c !== cell);
  }

  async function lineBurst(line: Line, p: Player, wave = 1): Promise<void> {
    const color = PLAYER_COLORS[p];
    const [a, , c] = line.map((i) => slot(i));
    // A glowing beam threads the three cells, they flash white, then burst.
    const len = a.distanceTo(c);
    const beam = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, len + 0.5, 12, 1, true), new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(3), transparent: true, opacity: 0.9, depthTest: false, blending: T.AdditiveBlending }));
    beam.renderOrder = 10;
    beam.layers.set(1);
    beam.position.copy(a).lerp(c, 0.5);
    beam.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), c.clone().sub(a).normalize());
    beam.scale.set(0.01, 1, 0.01);
    cube.add(beam);
    const flashMat = new T.MeshBasicMaterial({ color: new T.Color('#ffffff').multiplyScalar(2.6) });
    const bodies = line.map((i) => shells[i]?.children.filter((m: any) => m.material !== M.ink) ?? []).flat();
    const saved = bodies.map((m: any) => m.material);
    sfx.whoosh();
    await anim(0.2, (k) => {
      beam.scale.set(0.2 + k * 1.2, 1, 0.2 + k * 1.2);
      line.forEach((i) => shells[i]?.scale.setScalar(1 + 0.2 * ease.outCubic(k)));
      bodies.forEach((m: any) => (m.material = k > 0.4 ? flashMat : m.material));
    });
    hit({ freeze: 0.09, shake: 0.75, bloom: 1.6, aberr: 0.018, flash: 0.18 });
    sfx.burst(wave);
    const mid = toWorld(line[1]);
    void caption(wave > 1 ? `x${wave}!` : 'LINE!', '#f5e663', mid.clone().addScaledVector(towardCamera(mid), 2.2), 3.4);
    for (const i of line) {
      const pos = toWorld(i);
      fx.burst(pos, color, 70, 6.8, 0.085);
      fx.splat(pos.clone().addScaledVector(towardCamera(pos), 0.6), color, 2.6, 0.7);
      fx.ring(pos, color, 2.4, 0.45);
      removeShell(i);
    }
    bodies.forEach((m: any, k: number) => (m.material = saved[k]));
    await anim(0.25, (k) => beam.scale.set(1.4 * (1 - k), 1, 1.4 * (1 - k)));
    cube.remove(beam);
    beam.geometry.dispose();
    beam.material.dispose();
    flashMat.dispose();
  }

  async function twist(t: Twist): Promise<void> {
    const perm = permutation(t);
    const axisVec = [new T.Vector3(1, 0, 0), new T.Vector3(0, 0, 1), new T.Vector3(0, 1, 0)][t.axis];
    const moving = Array.from({ length: CELLS }, (_, i) => i).filter((i) => coord(i)[t.axis] === t.slice && i !== CENTER);
    // Pick the turn direction that carries a cell onto its slot in the rules' permutation.
    const probe = moving.find((i) => perm[i] !== i)!;
    const plus = slot(probe).applyAxisAngle(axisVec, Math.PI / 2).distanceTo(slot(perm[probe]));
    const sign = plus < 0.01 ? 1 : -1;
    const pivot = new T.Group();
    cube.add(pivot);
    const objs = moving.flatMap((i) => [casings[i], shells[i]].filter(Boolean));
    objs.forEach((o) => pivot.attach(o));
    sfx.whoosh();
    await anim(0.46, (k) => {
      pivot.quaternion.setFromAxisAngle(axisVec, sign * (Math.PI / 2) * ease.outBack(k));
      if (k < 0.85)
        for (const i of moving) {
          const s = shells[i];
          if (s) fx.burst(s.getWorldPosition(new T.Vector3()), PLAYER_COLORS[owners[i]!], 1, 0.6, 0.035);
        }
    });
    objs.forEach((o) => cube.attach(o));
    cube.remove(pivot);
    for (const i of moving) {
      casings[i].position.copy(slot(i));
      casings[i].quaternion.identity();
    }
    const nOwners = owners.slice();
    const nShells = shells.slice();
    for (const i of moving) {
      nOwners[i] = null;
      nShells[i] = null;
    }
    for (const i of moving) {
      nOwners[perm[i]] = owners[i];
      nShells[perm[i]] = shells[i];
      if (shells[i]) shells[i].position.copy(slot(perm[i]));
    }
    owners.splice(0, CELLS, ...nOwners);
    shells.splice(0, CELLS, ...nShells);
    order = order.map((c) => (moving.includes(c) ? perm[c] : c));
    hit({ shake: 0.18 });
  }

  async function fade(cell: number): Promise<void> {
    const s = shells[cell];
    const p = owners[cell];
    if (!s || p === null) return;
    const dry = M.paint[p].clone();
    s.children.forEach((m: any) => m.material !== M.ink && (m.material = dry));
    const from = new T.Color(PLAYER_COLORS[p]);
    const to = new T.Color('#4a4452');
    sfx.crackle();
    await anim(0.55, (k) => {
      dry.color.copy(from).lerp(to, k);
      dry.emissiveIntensity = 0.12 * (1 - k);
      s.position.copy(slot(cell)).add(new T.Vector3((Math.random() - 0.5) * 0.03 * k, (Math.random() - 0.5) * 0.03 * k, 0));
    });
    const pos = toWorld(cell);
    fx.flakes(pos, '#6b6475', 26, 0.09);
    fx.burst(pos, '#5c5566', 10, 1.4, 0.04);
    hit({ shake: 0.12 });
    removeShell(cell);
    dry.dispose();
  }

  async function drench(p: Player): Promise<void> {
    const color = PLAYER_COLORS[p];
    const origin = Math.floor(Math.random() * CELLS);
    clock.scale = 0.35;
    hit({ bloom: 1.4, flash: 0.22, shake: 0.6, aberr: 0.015 });
    sfx.win();
    fx.ring(toWorld(CENTER), color, 4.2, 0.8);
    void caption('WIN!', '#ff3d8b', toWorld(CENTER).addScaledVector(towardCamera(toWorld(CENTER)), 3), 3.4);
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < CELLS; i++) {
      if (i === CENTER) continue;
      const d = slot(i).distanceTo(slot(origin));
      jobs.push(
        wait(d * 0.09).then(async () => {
          if (shells[i]) removeShell(i);
          owners[i] = p;
          order.push(i);
          const sh = makeShell(p, i * 3 + 1);
          sh.position.copy(slot(i));
          cube.add(sh);
          shells[i] = sh;
          const w = toWorld(i);
          fx.burst(w, color, 10, 3, 0.06);
          if (i % 3 === 0) fx.splat(w.clone().addScaledVector(towardCamera(w), 0.5), color, 1.8, 0.6);
          await anim(0.4, (k) => sh.scale.setScalar(0.3 + 0.7 * ease.outElastic(k)));
        }),
      );
    }
    await Promise.all(jobs);
    clock.scale = 1;
    await wait(1.1);
    await clearAll();
  }

  async function clearAll(): Promise<void> {
    const cells = owners.flatMap((o, i) => (o !== null ? [i] : []));
    await Promise.all(
      cells.map((i, n) =>
        anim(0.25, (k) => shells[i]?.scale.setScalar(1 - ease.inCubic(k)), n * 0.012).then(() => {
          fx.burst(toWorld(i), PLAYER_COLORS[owners[i] ?? 0], 4, 1.5, 0.04);
          removeShell(i);
        }),
      ),
    );
  }

  // Actions run one after another.
  let queue: Promise<void> = Promise.resolve();
  const empties = () => Array.from({ length: CELLS }, (_, i) => i).filter((i) => i !== CENTER && owners[i] === null);
  const pickOf = <X,>(xs: X[]): X => xs[Math.floor(Math.random() * xs.length)];
  const take = (): Player => {
    const p = nextPlayer;
    nextPlayer = p === 0 ? 1 : 0;
    return p;
  };
  const actions: Record<string, () => Promise<void>> = {
    splat: async () => {
      const e = empties();
      if (e.length) await paint(pickOf(e), take());
    },
    twist: () => twist(pickOf([...TWISTS])),
    line: async () => {
      const p = take();
      const ok = LINES.filter((l) => !l.includes(CENTER) && l.every((i) => owners[i] !== (p === 0 ? 1 : 0)));
      const line = pickOf(ok.length ? ok : LINES.filter((l) => !l.includes(CENTER)));
      for (const i of line) {
        if (owners[i] !== null && owners[i] !== p) removeShell(i);
        if (owners[i] === null) {
          void paint(i, p);
          await wait(0.16);
        }
      }
      await wait(0.6);
      await lineBurst(line, p);
    },
    fade: async () => {
      if (order.length) await fade(order[0]);
    },
    win: () => drench(take()),
    reset: () => clearAll(),
  };
  const act = (name: string) => (queue = queue.then(() => actions[name]?.()).catch((e) => console.error(e)));

  // Input: drag spins the cube; a tap paints the cell under it.
  let yaw = 0.78;
  let pitch = 0.5;
  let vyaw = 0;
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;
  let lastInput = -10;
  const ray = new T.Raycaster();
  const onDown = (e: PointerEvent) => {
    sfx.unlock();
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    stage.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    yaw += dx * 0.009;
    vyaw = dx * 0.009 * 60;
    pitch = Math.max(-1.1, Math.min(1.1, pitch + dy * 0.007));
    lastInput = now;
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (moved > 8) return;
    vyaw = 0;
    const rect = stage.getBoundingClientRect();
    ray.setFromCamera(new T.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hitObj = ray.intersectObjects(casings.filter(Boolean), false)[0];
    if (hitObj) {
      const cell = hitObj.object.userData.cell as number;
      if (owners[cell] === null) queue = queue.then(() => paint(cell, take()));
    }
  };
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', () => (dragging = false));
  const onClick = (e: Event) => {
    const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
    if (!btn) return;
    sfx.unlock();
    void act(btn.dataset.act!);
  };
  root.addEventListener('click', onClick);

  // Frame loop.
  let now = 0;
  let last = 0;
  let frames = 0;
  let fpsT = 0;
  let slowFor = 0;
  const fpsEl = root.querySelector('.fps') as HTMLElement;
  let shakeOff: [number, number, number] = [0, 0, 0];
  const size = new T.Vector2();

  function update(real: number): void {
    const dt = clock.advance(real);
    tweens.update(dt);
    fx.update(dt);
    if (!dragging) {
      vyaw *= Math.exp(-3 * real);
      yaw += vyaw * real;
      // Idle: drift back towards a corner view and sway gently around it.
      if (now - lastInput > 2.5) {
        const home = Math.round((yaw - 0.785) / (Math.PI / 2)) * (Math.PI / 2) + 0.785 + Math.sin(now * 0.35) * 0.32;
        yaw += (home - yaw) * Math.min(1, real * 0.8);
        pitch += (0.5 - pitch) * Math.min(1, real * 0.8);
      }
    }
    cube.rotation.set(pitch, yaw, 0, 'XYZ');
    const s = 1 + Math.sin(now * 3) * 0.06;
    core.scale.setScalar(s);
    core.rotation.y += real * 0.8;
    core.rotation.x += real * 0.5;
    M.core.emissiveIntensity = 2.2 + Math.sin(now * 3) * 0.5;
    coreLight.intensity = 6 + Math.sin(now * 3) * 1.5;
    const decay = Math.exp(-5 * real);
    pulse.bloom *= decay;
    pulse.aberr *= decay;
    pulse.flash *= Math.exp(-9 * real);
    shakeOff = shake.update(real);
  }

  function render(): void {
    view.resize();
    const aspect = view.w / view.h;
    const v = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(v / 2) * aspect);
    const dist = 2.65 / Math.sin(Math.min(v, hfov) / 2);
    camera.position.set(shakeOff[0], 0.9 + shakeOff[1], dist);
    camera.lookAt(0, 0.1, 0);
    camera.rotateZ(shakeOff[2]);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const wallW = Math.max(12, 2 * Math.tan(hfov / 2) * (dist + 5) * 1.15);
    wall.scale.x = wallW / 12;
    wallTex.repeat.x = wallW / 12;
    wallTex.offset.x = -(wallW / 12 - 1) / 2;
    r.getDrawingBufferSize(size);
    post.setSize(size.x, size.y);
    post.strength = 0.75 + pulse.bloom;
    post.aberration = pulse.aberr;
    post.flash = pulse.flash;
    post.render(world, camera, now);
  }

  const loop = manual
    ? null
    : new RenderLoop(stage, (t) => {
        const real = Math.min(0.05, Math.max(0, t - last));
        last = t;
        now = t;
        update(real);
        render();
        frames++;
        fpsT += real;
        if (fpsT >= 0.5) {
          const fps = frames / fpsT;
          fpsEl.textContent = String(Math.round(fps));
          // Slow phone: trade resolution and particles for frame rate.
          slowFor = fps < 40 ? slowFor + fpsT : 0;
          if (slowFor > 2 && pixelRatio > 1) {
            pixelRatio = Math.max(1, pixelRatio - 0.25);
            r.setPixelRatio(pixelRatio);
            fx.budget = pixelRatio <= 1.25 ? 0.6 : 0.8;
            slowFor = 0;
          }
          frames = 0;
          fpsT = 0;
        }
      });

  window.__look = {
    ready: true,
    act: (name) => act(name),
    advance: (sec, draw = true) => {
      const steps = Math.max(1, Math.round(sec / (1 / 60)));
      for (let i = 0; i < steps; i++) {
        now += sec / steps;
        update(sec / steps);
      }
      if (draw) render();
    },
  };
  if (manual) render();

  return () => {
    loop?.stop();
    root.removeEventListener('click', onClick);
    tweens.clear();
    fx.clear();
    post.dispose();
    disposeAll(world);
    r.dispose();
    r.domElement.remove();
    delete window.__look;
  };
}
