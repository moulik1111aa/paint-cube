// The 3D game board: the street-art scene (graffiti wall, ground, lights, painterly
// post) with the cube in front, playing the rules engine's events as animations.
// It never decides anything: the game controller hands it events and it animates them.
// Taps on cells are reported back through `onTap`.

import { makeRenderer, RenderLoop, softEnv, disposeAll, type Three } from './three.ts';
import { makeMaterials, roundedBox, crackTexture, glowTexture, PLAYER_COLORS, CORE_COLOR, type Materials } from './look.ts';
import { wallTexture, groundTexture, graffitiCaption, wallTagTexture } from './street.ts';
import { Fx, Tweens, Clock, Shake, ease } from './fx3d.ts';
import type { Sfx } from '../audio/sfx.ts';
import { haptics } from '../platform/haptics.ts';
import { CELLS, CENTER, coord, type Cell, type Line, type Player } from '../core/geometry.ts';
import { permutation, sameTwist, type Twist, type Axis, type Slice } from '../core/twist.ts';
import type { GameEvent } from '../core/events.ts';
import type { AbilityId, Decor } from '../core/agents.ts';
import type { Mode } from '../core/match.ts';

const SPACING = 1.0;
const CELL = 0.8;

export interface Board {
  /** Called with a cell index when the player taps a cell. */
  onTap: ((cell: number) => void) | null;
  /** Swipe on the cube picked a twist: return false (and explain) to refuse it. */
  onTwistIntent: ((t: Twist) => boolean) | null;
  /** The swiped layer is held at a quarter turn, waiting for confirm or cancel. */
  onTwistReady: ((t: Twist) => void) | null;
  /** Whether swipes on the cube twist layers (rotating mode, player's turn). */
  twistEnabled: boolean;
  /** Animate a held preview back to where it was. */
  cancelTwist(): Promise<void>;
  /** Start a twist preview from a swipe (tests): cell, then a swipe in screen pixels. */
  swipe(cell: number, dx: number, dy: number): Twist | null;
  setMode(mode: Mode): void;
  /** Show these cells immediately, without animation (`cracking`: marks that fade next). */
  sync(cells: readonly Cell[], cracking?: readonly number[]): void;
  /** Animate the engine's events in order; resolves when the board is calm. */
  play(events: readonly GameEvent[]): Promise<void>;
  /** A small "no" shake for a refused tap. */
  refuse(cell: number): void;
  /** Idle presentation (slow sway) when no one is playing. */
  attract: boolean;
  /** The cell to mark while a finger is over `cell` (the landing cell in Cascade), or null. */
  aimAt: ((cell: number) => number | null) | null;
  /** Show the aim marker as if a finger were on `cell` (tests), or hide it. */
  aim(cell: number | null): void;
  /** Whose turn it is: the Core pulses in their colour and the aim marker uses it. */
  setTurn(p: Player | null): void;
  /** Player names, for the big wall tag when a match is won. */
  names: [string, string];
  /** Agents mode: wet drips, chrome, cracks, tape, traps, seals and wet-floor lines. */
  decorate(d: Decor | null): void;
  /** Agents mode: pulse these cells as targets (null clears). */
  highlight(cells: readonly number[] | null, color?: string): void;
  /** Agents mode: a caption for an ability (its display name). */
  abilityName: ((id: AbilityId) => string) | null;
  /** Manual clock (tests): advance game time and optionally draw. */
  advance(sec: number, draw?: boolean): void;
  /** Rendering diagnostics: resolution multiplier, frame rate, quality step (0 = best). */
  stats(): { ratio: number; fps: number; level: number; levels: number };
  dispose(): void;
}

export function createBoard(T: Three, host: HTMLElement, sfx: Sfx, manual = false): Board {
  const view = makeRenderer(T, host);
  const r = view.r;
  // One pass straight to the screen at the phone's full resolution, with the canvas's
  // own anti-aliasing. (A stack of full-screen filters used to run every frame; phones
  // couldn't keep up, so the governor lowered the resolution and the cube went blurry.)
  r.toneMapping = T.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  r.shadowMap.enabled = true;
  r.shadowMap.type = T.PCFSoftShadowMap;
  const dpr = devicePixelRatio || 1;
  const maxRatio = Math.min(3, dpr);
  /** Never trade the resolution below this: sharpness comes first. */
  const minRatio = Math.min(dpr, 2);
  let pixelRatio = maxRatio;
  r.setPixelRatio(pixelRatio);
  const aniso = Math.min(8, r.capabilities.getMaxAnisotropy?.() ?? 1);
  // Vignette and impact flash as cheap overlays above the canvas.
  const vig = document.createElement('div');
  vig.className = 'vig';
  const flashEl = document.createElement('div');
  flashEl.className = 'flash';
  r.domElement.after(vig, flashEl);
  const clock = new Clock();
  const tweens = new Tweens();
  const shake = new Shake();

  const world = new T.Scene();
  world.background = new T.Color('#0b0816');
  const env = softEnv(T, r, '#9a8cff', '#0a0912');
  const M: Materials = makeMaterials(T, env);
  // Sharper textures on faces seen at an angle.
  for (const m of Object.values(M).flat() as any[]) for (const k of ['map', 'bumpMap', 'roughnessMap']) if (m?.[k]) m[k].anisotropy = aniso;
  const camera = new T.PerspectiveCamera(38, 1, 0.5, 80);
  // Layers: 0 the cube (inked, kept sharp), 1 effects, 2 glass slots, 3 the wall and
  // ground (painted with the oil filter, no ink).
  camera.layers.enable(1);
  camera.layers.enable(2);
  camera.layers.enable(3);

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

  const wallTex = wallTexture(T);
  wallTex.anisotropy = aniso;
  const groundTex = groundTexture(T);
  groundTex.anisotropy = aniso;
  const wall = new T.Mesh(new T.PlaneGeometry(12, 18), new T.MeshStandardMaterial({ map: wallTex, roughness: 0.95 }));
  wall.position.set(0, 3, -5);
  wall.receiveShadow = true;
  wall.layers.set(3);
  world.add(wall);
  const ground = new T.Mesh(new T.PlaneGeometry(40, 30), new T.MeshStandardMaterial({ map: groundTex, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -2.6, 10);
  ground.receiveShadow = true;
  ground.layers.set(3);
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
  const towardCamera = (pos: any) => camera.position.clone().sub(pos).normalize();

  // Casings: solid concrete blocks (rotating) or faint glass slots (stacking).
  const casingGeo = roundedBox(T, CELL, 0.14, 4);
  const glass = new T.MeshStandardMaterial({ color: '#cfc8ff', transparent: true, opacity: 0.13, roughness: 0.2, depthWrite: false });
  const casings: any[] = [];
  const noRay = () => {};
  for (let i = 0; i < CELLS; i++) {
    const m = new T.Mesh(casingGeo, M.casing);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.copy(slot(i));
    m.userData.cell = i;
    // Ink outline: a slightly bigger back-facing shell, drawn crisp by the rasterizer.
    const hull = new T.Mesh(casingGeo, M.ink);
    hull.scale.setScalar(1.075);
    hull.raycast = noRay;
    hull.userData.hull = true;
    m.add(hull);
    cube.add(m);
    casings.push(m);
  }
  const core = new T.Mesh(new T.IcosahedronGeometry(0.27, 1), M.core);
  core.castShadow = true;
  cube.add(core);
  const coreInk = new T.Mesh(core.geometry, M.ink);
  coreInk.scale.setScalar(1.12);
  coreInk.raycast = noRay;
  core.add(coreInk);
  // The Core's glow (it used to come from a full-screen bloom filter).
  const glowMat = new T.SpriteMaterial({ map: glowTexture(T), color: CORE_COLOR, transparent: true, opacity: 0.85, depthWrite: false, blending: T.AdditiveBlending });
  const coreGlow = new T.Sprite(glowMat);
  coreGlow.scale.setScalar(1.25);
  coreGlow.layers.set(1);
  core.add(coreGlow);
  const coreLight = new T.PointLight(CORE_COLOR, 7, 3.2, 1.6);
  cube.add(coreLight);

  const shellGeo = roundedBox(T, 0.86, 0.22, 5);
  const dripGeo = new T.SphereGeometry(1, 14, 10);
  const dripRod = new T.CylinderGeometry(1, 1, 1, 8, 1);
  dripRod.translate(0, -0.5, 0);
  const coreTarget = new T.Color(CORE_COLOR);
  const coreGold = new T.Color(CORE_COLOR);
  const crackMat = new T.MeshBasicMaterial({ map: crackTexture(T), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  let shells: (any | null)[] = Array(CELLS).fill(null);
  let owners: (Player | null)[] = Array(CELLS).fill(null);
  let mode: Mode = 'rotating';

  function makeShell(p: Player, seed: number): any {
    const g = new T.Group();
    // Everything visible sits in `inner`, so the idle wobble never fights the outer
    // group's position/scale animations.
    const inner = new T.Group();
    g.add(inner);
    g.userData.inner = inner;
    g.userData.phase = seed * 0.37;
    const body = new T.Mesh(shellGeo, M.paint[p]);
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData.body = true;
    const hull = new T.Mesh(shellGeo, M.ink);
    hull.scale.setScalar(1.1);
    hull.raycast = noRay;
    inner.add(hull, body);
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
      const drip = new T.Mesh(dripGeo, M.drip[p]);
      drip.position.copy(pos);
      drip.scale.setScalar(rad);
      const dh = new T.Mesh(dripGeo, M.ink);
      dh.position.copy(pos);
      dh.scale.setScalar(rad * 1.3);
      inner.add(dh, drip);
    }
    g.userData.player = p;
    return g;
  }

  /** The paint body meshes of a shell (for flashes and drying). */
  function bodiesOf(s: any): any[] {
    return ((s?.userData.inner ?? s)?.children ?? []).filter((m: any) => m.userData.body);
  }

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
      const len = 0.3 + Math.random() * 0.35;
      const w = 0.035 + Math.random() * 0.025;
      const g = new T.Group();
      g.position.copy(face.clone().multiplyScalar(0.44).addScaledVector(across, (Math.random() - 0.5) * 0.5).addScaledVector(run, -0.05));
      g.quaternion.setFromUnitVectors(new T.Vector3(0, -1, 0), run);
      const rod = new T.Mesh(dripRod, M.drip[p]);
      const tip = new T.Mesh(dripGeo, M.drip[p]);
      rod.scale.set(w, 0.001, w);
      tip.scale.setScalar(w * 1.5);
      g.add(rod, tip);
      (shell.userData.inner ?? shell).add(g);
      void anim(1.3 + Math.random() * 0.6, (t) => {
        const l = len * ease.outCubic(t);
        rod.scale.y = Math.max(0.001, l);
        tip.position.y = -l;
      });
    }
  }

  const captionTex = new Map<string, any>();
  async function caption(text: string, fill: string, at: any, size: number): Promise<void> {
    const key = text + fill;
    if (!captionTex.has(key)) captionTex.set(key, graffitiCaption(T, text, fill));
    const s = new T.Sprite(new T.SpriteMaterial({ map: captionTex.get(key), transparent: true, depthTest: false, depthWrite: false }));
    s.layers.set(1);
    s.renderOrder = 20;
    s.position.copy(at);
    world.add(s);
    await anim(0.22, (k) => {
      const g = size * ease.outBack(k);
      s.scale.set(g * 2, g, 1);
      s.material.rotation = (1 - k) * 0.5;
    });
    await anim(0.55, (k) => (s.material.rotation = Math.sin(k * 9) * 0.03));
    await anim(0.25, (k) => {
      s.material.opacity = 1 - k;
      s.scale.set(size * 2 * (1 + k * 0.15), size * (1 + k * 0.15), 1);
    });
    world.remove(s);
    s.material.dispose();
  }

  const pulse = { bloom: 0, aberr: 0, flash: 0, punch: 0 };

  // Aim marker: a glowing halo in the mover's colour around the cell under the finger,
  // plus a ghost of the paint in Cascade (where the drop will land).
  let turnP: Player | null = null;
  const haloMat = new T.MeshBasicMaterial({ color: '#ffffff', side: T.BackSide, transparent: true, opacity: 0.95, depthWrite: false });
  const aimHalo = new T.Mesh(casingGeo, haloMat);
  aimHalo.scale.setScalar(1.2);
  aimHalo.layers.set(1);
  aimHalo.visible = false;
  cube.add(aimHalo);
  const ghostMat = new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.42, depthWrite: false });
  const aimGhost = new T.Mesh(shellGeo, ghostMat);
  aimGhost.layers.set(1);
  aimGhost.visible = false;
  cube.add(aimGhost);
  let aimCell = -1;
  function showAim(cell: number | null): void {
    const at = cell === null || turnP === null || !board.aimAt ? null : board.aimAt(cell);
    if (at === null || at < 0) {
      aimHalo.visible = aimGhost.visible = false;
      aimCell = -1;
      return;
    }
    const color = new T.Color(PLAYER_COLORS[turnP!]);
    haloMat.color.copy(color).multiplyScalar(1.8);
    ghostMat.color.copy(color);
    aimHalo.position.copy(slot(at));
    aimHalo.visible = true;
    aimGhost.position.copy(slot(at));
    aimGhost.visible = mode === 'cascade';
    aimCell = at;
  }

  // Twist streak: a ring of comet-tail paint around the turning layer, in the mover's colour.
  const streakTex = (() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 8;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.85, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 8);
    const t = new T.CanvasTexture(c);
    t.wrapS = T.RepeatWrapping;
    return t;
  })();
  const streakGeo = new T.TorusGeometry(1.62, 0.05, 6, 96);
  function streak(ctx: TwistCtx, p: Player | null | undefined): any {
    if (p === null || p === undefined) return null;
    const map = streakTex.clone();
    map.needsUpdate = true;
    map.repeat.x = 4 * ctx.sign;
    const mat = new T.MeshBasicMaterial({ map, color: new T.Color(PLAYER_COLORS[p]).multiplyScalar(2.2), transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending });
    const ring = new T.Mesh(streakGeo, mat);
    ring.layers.set(1);
    ring.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), ctx.axisVec);
    ring.userData.base = ring.quaternion.clone();
    ring.position.copy(ctx.axisVec).multiplyScalar((ctx.t.slice - 1) * SPACING);
    ctx.pivot.add(ring);
    return ring;
  }
  function dropStreak(ring: any): void {
    if (!ring) return;
    void anim(0.35, (k) => (ring.material.opacity = 0.9 * (1 - k))).then(() => {
      ring.parent?.remove(ring);
      ring.material.map.dispose();
      ring.material.dispose();
    });
  }

  /** A short wall tag (the match winner's name) sprayed on the wall; cleared by sync(). */
  let tag: any = null;
  function clearTag(): void {
    if (!tag) return;
    world.remove(tag);
    tag.material.map.dispose();
    tag.material.dispose();
    tag = null;
  }
  async function wallTag(text: string, color: string): Promise<void> {
    clearTag();
    const mat = new T.MeshBasicMaterial({ map: wallTagTexture(T, text, color), transparent: true, opacity: 0, depthWrite: false });
    tag = new T.Mesh(new T.PlaneGeometry(8, 4), mat);
    tag.position.set(0, 4.2, -4.95);
    tag.layers.set(3);
    world.add(tag);
    const t = tag;
    sfx.whoosh();
    for (let k = 0; k < 6; k++) fx.mist(new T.Vector3(-3 + k * 1.2, 4.2 + (Math.random() - 0.5), -4.6), color, 30, 2.5);
    await anim(0.45, (k) => {
      t.material.opacity = Math.min(1, k * 1.6);
      t.scale.set(0.6 + 0.4 * ease.outBack(k), 0.6 + 0.4 * ease.outBack(k), 1);
    });
  }
  // Respect the phone's reduced-motion setting: much less shake, no colour split or flash.
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hit = (s: { freeze?: number; shake?: number; bloom?: number; aberr?: number; flash?: number }) => {
    clock.freeze = Math.max(clock.freeze, s.freeze ?? 0);
    shake.add((s.shake ?? 0) * (calm ? 0.25 : 1));
    pulse.bloom = Math.max(pulse.bloom, s.bloom ?? 0);
    if (calm) return;
    pulse.aberr = Math.max(pulse.aberr, s.aberr ?? 0);
    pulse.flash = Math.max(pulse.flash, s.flash ?? 0);
  };
  const anim = (dur: number, step: (k: number) => void, delay = 0) => new Promise<void>((res) => tweens.add(dur, step, res, delay));
  const wait = (sec: number) => new Promise<void>((res) => tweens.wait(sec, res));

  function placeShell(cell: number, p: Player, popIn: boolean): any {
    const shell = makeShell(p, cell * 31 + Math.floor(Math.random() * 1000));
    shell.position.copy(slot(cell));
    cube.add(shell);
    shells[cell] = shell;
    owners[cell] = p;
    if (popIn) {
      shell.scale.setScalar(0.2);
      addDrips(shell, cell, p);
      void anim(0.5, (k) => shell.scale.setScalar(0.2 + 0.8 * ease.outElastic(k)));
    }
    return shell;
  }

  function removeShell(cell: number): void {
    const s = shells[cell];
    if (s) cube.remove(s);
    shells[cell] = null;
    owners[cell] = null;
  }

  function impact(cell: number, p: Player): void {
    const color = PLAYER_COLORS[p];
    const target = toWorld(cell);
    const n = towardCamera(target);
    hit({ freeze: 0.06, shake: 0.32, bloom: 0.9, aberr: 0.006 });
    sfx.splat(0.9 + Math.random() * 0.2);
    haptics.tap();
    fx.burst(target.clone().addScaledVector(n, 0.4), color, 18, 4.0, 0.06, n, 0.95);
    fx.mist(target.clone().addScaledVector(n, 0.45), color, 60, 5.5, n);
    fx.splat(target.clone().addScaledVector(n, 0.5), color, 1.7, 0.5);
    fx.ring(target.clone().addScaledVector(n, 0.45), color, 1.9, 0.32);
  }

  /** A paintball thrown from the player's side of the screen onto the cell. */
  async function throwPaint(cell: number, p: Player): Promise<void> {
    const target = toWorld(cell);
    const start = camera.position.clone().add(new T.Vector3(p === 0 ? -1.4 : 1.4, -1.8, -1.2));
    const mid = start.clone().lerp(target, 0.5).add(new T.Vector3(0, 1.3, 0));
    await flyBall(p, (k) => {
      const a = start.clone().lerp(mid, k);
      return a.lerp(mid.clone().lerp(target, k), k);
    }, 0.26);
    impact(cell, p);
    placeShell(cell, p, true);
    await wait(0.35);
  }

  /** A paintball dropped down a column onto its landing cell. */
  async function dropPaint(cell: number, p: Player): Promise<void> {
    cube.updateMatrixWorld();
    const top = cube.localToWorld(slot(cell).setY(2.6));
    const target = toWorld(cell);
    await flyBall(p, (k) => top.clone().lerp(target, ease.inCubic(k)), 0.3);
    impact(cell, p);
    placeShell(cell, p, true);
    await wait(0.3);
  }

  async function flyBall(p: Player, path: (k: number) => any, dur: number): Promise<void> {
    const color = PLAYER_COLORS[p];
    const orb = new T.Group();
    const ballInk = new T.Mesh(dripGeo, M.ink);
    ballInk.scale.setScalar(1.18);
    orb.add(ballInk, new T.Mesh(dripGeo, M.drip[p]));
    orb.scale.setScalar(0.14);
    world.add(orb);
    const prev = path(0);
    await anim(dur, (k) => {
      const pos = path(k);
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

  /** Lines flash white along a glowing beam, then burst into paint. */
  async function burstLines(lines: readonly Line[], players: readonly Player[], wave: number, shatter: boolean): Promise<void> {
    const beams: any[] = [];
    const flashMat = new T.MeshBasicMaterial({ color: new T.Color('#ffffff').multiplyScalar(2.6) });
    const cells = [...new Set(lines.flat())];
    lines.forEach((line, k) => {
      const a = slot(line[0]);
      const c = slot(line[2]);
      const beam = new T.Mesh(
        new T.CylinderGeometry(0.09, 0.09, a.distanceTo(c) + 0.5, 12, 1, true),
        new T.MeshBasicMaterial({ color: new T.Color(PLAYER_COLORS[players[k]]).multiplyScalar(3), transparent: true, opacity: 0.9, depthTest: false, blending: T.AdditiveBlending }),
      );
      beam.renderOrder = 10;
      beam.layers.set(1);
      beam.position.copy(a).lerp(c, 0.5);
      beam.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), c.clone().sub(a).normalize());
      beam.scale.set(0.01, 1, 0.01);
      cube.add(beam);
      beams.push(beam);
    });
    const bodies = cells.flatMap((i) => bodiesOf(shells[i]));
    const saved = bodies.map((m: any) => m.material);
    sfx.whoosh();
    await anim(0.2, (k) => {
      beams.forEach((b) => b.scale.set(0.2 + k * 1.2, 1, 0.2 + k * 1.2));
      cells.forEach((i) => shells[i]?.scale.setScalar(1 + 0.2 * ease.outCubic(k)));
      if (k > 0.4) bodies.forEach((m: any) => (m.material = flashMat));
    });
    // A combo: several lines at once, or a later cascade wave.
    const combo = Math.max(wave, lines.length);
    const big = 1 + 0.35 * (combo - 1);
    hit({ freeze: 0.09, shake: 0.6 + 0.15 * combo, bloom: 1.4 + 0.3 * combo, aberr: 0.014 + 0.006 * combo, flash: 0.16 });
    if (combo > 1) pulse.punch = Math.max(pulse.punch, 0.05 + 0.025 * Math.min(4, combo));
    sfx.burst(wave);
    haptics.burst(wave);
    bodies.forEach((m: any, k: number) => (m.material = saved[k]));
    if (shatter) {
      for (const i of cells) {
        const pos = toWorld(i);
        const color = PLAYER_COLORS[owners[i] ?? players[0]];
        fx.burst(pos, color, 40 * big, 6.5 * Math.sqrt(big), 0.08);
        fx.mist(pos, color, 90 * big, 8);
        fx.splat(pos.clone().addScaledVector(towardCamera(pos), 0.6), color, 2.6 * big, 0.7);
        fx.ring(pos, color, 2.4 * big, 0.45);
        removeShell(i);
      }
    } else cells.forEach((i) => shells[i]?.scale.setScalar(1));
    const mid = toWorld(lines[0][1]);
    const word = combo >= 4 ? `MEGA x${combo}` : combo === 3 ? 'TRIPLE!' : combo === 2 ? 'DOUBLE!' : 'LINE!';
    void caption(word, PLAYER_COLORS[players[0]], mid.clone().addScaledVector(towardCamera(mid), 2.2), combo > 1 ? 2.5 + 0.2 * Math.min(3, combo - 1) : 2.7);
    await anim(0.25, (k) => beams.forEach((b) => b.scale.set(1.4 * (1 - k), 1, 1.4 * (1 - k))));
    for (const b of beams) {
      cube.remove(b);
      b.geometry.dispose();
      b.material.dispose();
    }
    flashMat.dispose();
  }

  const AXES = [new T.Vector3(1, 0, 0), new T.Vector3(0, 0, 1), new T.Vector3(0, 1, 0)];
  interface TwistCtx {
    t: Twist;
    perm: readonly number[];
    axisVec: any;
    sign: number;
    moving: number[];
    pivot: any;
    objs: any[];
    /** 0..1 of a quarter turn. */
    f: number;
  }
  let preview: TwistCtx | null = null;

  /** The board's turn direction (about the three.js axis) that carries cells where the rules say. */
  function twistSign(t: Twist): number {
    const perm = permutation(t);
    const moving = Array.from({ length: CELLS }, (_, i) => i).filter((i) => coord(i)[t.axis] === t.slice && i !== CENTER);
    const probe = moving.find((i) => perm[i] !== i)!;
    return slot(probe).applyAxisAngle(AXES[t.axis], Math.PI / 2).distanceTo(slot(perm[probe])) < 0.01 ? 1 : -1;
  }

  function beginTwist(t: Twist): TwistCtx {
    const moving = Array.from({ length: CELLS }, (_, i) => i).filter((i) => coord(i)[t.axis] === t.slice && i !== CENTER);
    const pivot = new T.Group();
    cube.add(pivot);
    const objs = moving.flatMap((i) => [casings[i], shells[i]].filter(Boolean));
    objs.forEach((o) => pivot.attach(o));
    return { t, perm: permutation(t), axisVec: AXES[t.axis], sign: twistSign(t), moving, pivot, objs, f: 0 };
  }

  function turnTo(ctx: TwistCtx, f: number): void {
    ctx.f = f;
    ctx.pivot.quaternion.setFromAxisAngle(ctx.axisVec, ctx.sign * (Math.PI / 2) * f);
  }

  /** Put the layer back without turning it (a cancelled preview). */
  function abandonTwist(ctx: TwistCtx): void {
    ctx.objs.forEach((o) => cube.attach(o));
    cube.remove(ctx.pivot);
    for (const i of ctx.moving) {
      casings[i].position.copy(slot(i));
      casings[i].quaternion.identity();
      if (shells[i]) shells[i].position.copy(slot(i));
    }
  }

  async function twist(t: Twist, p?: Player): Promise<void> {
    let ctx: TwistCtx;
    let ring: any = null;
    if (preview && sameTwist(preview.t, t)) {
      ctx = preview;
      preview = null;
      const from = ctx.f;
      ring = streak(ctx, p);
      await anim(0.12, (k) => {
        turnTo(ctx, from + (1 - from) * k);
        if (ring) ring.material.opacity = 0.9 * k;
      });
    } else {
      if (preview) abandonTwist(preview);
      preview = null;
      ctx = beginTwist(t);
      ring = streak(ctx, p);
      sfx.whoosh();
      await anim(0.46, (k) => {
        turnTo(ctx, ease.outBack(k));
        if (ring) {
          ring.material.opacity = 0.9 * Math.min(1, k * 4);
          // Lag behind the layer at half speed: the paint smears along the turn.
          ring.quaternion.copy(ring.userData.base).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), -ctx.sign * (Math.PI / 4) * ease.outBack(k)));
        }
        if (k < 0.85)
          for (const i of ctx.moving) {
            const s = shells[i];
            if (s) fx.mist(s.getWorldPosition(new T.Vector3()), PLAYER_COLORS[owners[i]!], 2, 0.7);
          }
      });
    }
    const { perm, moving, objs, pivot } = ctx;
    if (ring) {
      cube.attach(ring);
      dropStreak(ring);
    }
    objs.forEach((o) => cube.attach(o));
    cube.remove(pivot);
    haptics.turn();
    for (const i of moving) {
      casings[i].position.copy(slot(i));
      casings[i].quaternion.identity();
    }
    const nShells = shells.slice();
    const nOwners = owners.slice();
    for (const i of moving) {
      nShells[i] = null;
      nOwners[i] = null;
    }
    for (const i of moving) {
      nShells[perm[i]] = shells[i];
      nOwners[perm[i]] = owners[i];
      if (shells[i]) shells[i].position.copy(slot(perm[i]));
    }
    shells = nShells;
    owners = nOwners;
    hit({ shake: 0.18 });
  }

  /** The oldest mark starts to dry out: duller paint and a nervous wobble. */
  function crack(cell: number): void {
    const s = shells[cell];
    const p = owners[cell];
    if (!s || p === null || s.userData.cracking) return;
    s.userData.cracking = true;
    const overlay = new T.Mesh(shellGeo, crackMat);
    overlay.scale.setScalar(1.012);
    overlay.renderOrder = 2;
    (s.userData.inner ?? s).add(overlay);
    void anim(0.3, (k) => (overlay.scale.setScalar(0.9 + 0.112 * ease.outBack(k))));
    const dry = M.paint[p].clone();
    dry.color.set('#9d97a6');
    bodiesOf(s).forEach((m: any) => (m.material = dry));
    s.userData.dry = dry;
  }

  async function fade(cell: number): Promise<void> {
    const s = shells[cell];
    const p = owners[cell];
    if (!s || p === null) return;
    const dry = s.userData.dry ?? M.paint[p].clone();
    bodiesOf(s).forEach((m: any) => (m.material = dry));
    const from = dry.color.clone();
    const to = new T.Color('#4a4452');
    sfx.crackle();
    await anim(0.4, (k) => {
      dry.color.copy(from).lerp(to, k);
      dry.emissiveIntensity = 0.04 * (1 - k);
      s.position.copy(slot(cell)).add(new T.Vector3((Math.random() - 0.5) * 0.03 * k, (Math.random() - 0.5) * 0.03 * k, 0));
    });
    const pos = toWorld(cell);
    fx.flakes(pos, '#6b6475', 26, 0.09);
    fx.burst(pos, '#5c5566', 10, 1.4, 0.04);
    hit({ shake: 0.12 });
    removeShell(cell);
    dry.dispose();
  }

  async function fall(moves: { from: number; to: number; player: Player }[]): Promise<void> {
    const moved = moves.map((m) => ({ ...m, s: shells[m.from] }));
    for (const m of moved) {
      shells[m.from] = null;
      owners[m.from] = null;
    }
    for (const m of moved) {
      shells[m.to] = m.s;
      owners[m.to] = m.player;
    }
    await anim(0.32, (k) => {
      for (const m of moved) m.s?.position.copy(slot(m.from).lerp(slot(m.to), ease.inCubic(k)));
    });
    hit({ shake: 0.15 });
    sfx.splat(0.7);
    await anim(0.18, (k) => {
      for (const m of moved) m.s?.scale.set(1 + 0.12 * Math.sin(k * Math.PI), 1 - 0.12 * Math.sin(k * Math.PI), 1 + 0.12 * Math.sin(k * Math.PI));
    });
  }

  async function drench(p: Player | null): Promise<void> {
    if (p === null) {
      void caption('DRAW', '#d9d4e4', toWorld(CENTER).addScaledVector(towardCamera(toWorld(CENTER)), 3), 2.2);
      await wait(0.6);
      await clearAll();
      return;
    }
    const color = PLAYER_COLORS[p];
    const origin = Math.floor(Math.random() * CELLS);
    clock.scale = 0.35;
    hit({ bloom: 1.4, flash: 0.22, shake: 0.6, aberr: 0.015 });
    sfx.win();
    haptics.win();
    fx.ring(toWorld(CENTER), color, 4.2, 0.8);
    void caption('WIN!', color, toWorld(CENTER).addScaledVector(towardCamera(toWorld(CENTER)), 3), 2.2);
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < CELLS; i++) {
      if (i === CENTER && mode === 'rotating') continue;
      const d = slot(i).distanceTo(slot(origin));
      jobs.push(
        wait(d * 0.09).then(async () => {
          if (shells[i]) removeShell(i);
          const sh = placeShell(i, p, false);
          const w = toWorld(i);
          fx.burst(w, color, 10, 3, 0.06);
          if (i % 3 === 0) fx.splat(w.clone().addScaledVector(towardCamera(w), 0.5), color, 1.8, 0.6);
          await anim(0.4, (k) => sh.scale.setScalar(0.3 + 0.7 * ease.outElastic(k)));
        }),
      );
    }
    await Promise.all(jobs);
    clock.scale = 1;
    await wait(0.9);
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

  async function play(events: readonly GameEvent[]): Promise<void> {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.type) {
        case 'faded':
          await fade(e.cell);
          break;
        case 'placed':
          if (e.column !== undefined) await dropPaint(e.cell, e.player);
          else await throwPaint(e.cell, e.player);
          break;
        case 'cracking':
          crack(e.cell);
          break;
        case 'twisted':
          await twist(e.twist, e.player);
          break;
        case 'lineCompleted': {
          const lines: Line[] = [];
          const players: Player[] = [];
          let j = i;
          for (; j < events.length; j++) {
            const x = events[j];
            if (x.type !== 'lineCompleted' || x.wave !== e.wave) break;
            lines.push(x.cells);
            players.push(x.player);
          }
          i = j - 1;
          await burstLines(lines, players, e.wave, true);
          break;
        }
        case 'shattered':
          e.cells.forEach((c) => shells[c] && removeShell(c));
          break;
        case 'fell':
          await fall(e.moves);
          break;
        case 'roundOver':
          if (e.winner !== null && e.line && mode === 'rotating') await burstLines([e.line], [e.winner], 1, false);
          await drench(e.winner);
          break;
        case 'matchWon':
          await celebrate(e.winner);
          break;
        case 'ability':
          await abilityFx(e.player, e.id, e.cells);
          break;
        case 'wiped':
          await wipe(e.cell, e.player);
          break;
        case 'moved':
          await slide(e.moves, !!e.flip);
          break;
        case 'converted':
          convert(e.cell, e.to);
          break;
        case 'dried':
          for (const c of e.cells) if (shells[c]) fx.mist(toWorld(c), '#ffffff', 10, 1.2);
          break;
        case 'rewound':
          await rewindFx(e.cells);
          break;
        case 'passed':
          void caption('PASS', '#d9d4e4', toWorld(CENTER).addScaledVector(towardCamera(toWorld(CENTER)), 2.6), 1.6);
          await wait(0.5);
          break;
        case 'fizzled':
          void caption('FIZZ', '#d9d4e4', toWorld(CENTER).addScaledVector(towardCamera(toWorld(CENTER)), 2.6), 1.5);
          await wait(0.3);
          break;
        default:
          break;
      }
    }
  }


  // ---- Agents mode: decorations, targets and power effects ----
  const decorMats = {
    tape: new T.MeshBasicMaterial({ map: tapeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    trap: [0, 1].map((p) => new T.MeshBasicMaterial({ map: trapTexture(PLAYER_COLORS[p]), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 })),
    seal: new T.MeshStandardMaterial({ color: '#bff3ff', transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.2, envMap: env, envMapIntensity: 1.6, depthWrite: false }),
    chrome: [0, 1].map((p) => new T.MeshStandardMaterial({ color: new T.Color(PLAYER_COLORS[p]).lerp(new T.Color('#ffffff'), 0.45), metalness: 1, roughness: 0.12, envMap: env, envMapIntensity: 2.2 })),
    floor: new T.MeshBasicMaterial({ color: new T.Color('#f5e663').multiplyScalar(1.6), transparent: true, opacity: 0.55, depthWrite: false, blending: T.AdditiveBlending }),
  };
  function tapeTexture(): any {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const strip = (rot: number) => {
      g.save();
      g.translate(128, 128);
      g.rotate(rot);
      g.fillStyle = '#f5e663';
      g.fillRect(-150, -26, 300, 52);
      g.fillStyle = '#0d0a14';
      for (let x = -150; x < 150; x += 34) {
        g.beginPath();
        g.moveTo(x, -26);
        g.lineTo(x + 17, -26);
        g.lineTo(x + 3, 26);
        g.lineTo(x - 14, 26);
        g.fill();
      }
      g.restore();
    };
    strip(Math.PI / 4);
    strip(-Math.PI / 4);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }
  function trapTexture(color: string): any {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.lineCap = 'round';
    for (const [w, col] of [[30, '#0d0a14'], [16, color]] as const) {
      g.strokeStyle = col;
      g.lineWidth = w;
      g.beginPath();
      g.arc(128, 128, 78, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(128, 128, 34, 0, Math.PI * 2);
      g.stroke();
      for (const a of [0, 1, 2, 3]) {
        const an = (a * Math.PI) / 2;
        g.beginPath();
        g.moveTo(128 + Math.cos(an) * 92, 128 + Math.sin(an) * 92);
        g.lineTo(128 + Math.cos(an) * 116, 128 + Math.sin(an) * 116);
        g.stroke();
      }
    }
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  /** Decoration meshes by key ("tape:5"), so a redecorate only touches what changed. */
  const decor = new Map<string, any>();
  let lastDecor: Decor | null = null;
  function setDecor(key: string, want: boolean, make: () => any, parent: any): void {
    const have = decor.get(key);
    if (have && (!want || have.parent !== parent)) {
      have.parent?.remove(have);
      decor.delete(key);
    }
    if (want && !decor.get(key)) {
      const m = make();
      parent.add(m);
      decor.set(key, m);
    }
  }
  function wetDrips(p: Player): any {
    const g = new T.Group();
    for (let k = 0; k < 3; k++) {
      const d = new T.Group();
      const rod = new T.Mesh(dripRod, M.drip[p]);
      d.add(rod);
      d.position.set((k - 1) * 0.22, -0.43, 0.44);
      d.userData.phase = k * 1.7;
      d.userData.rod = rod;
      g.add(d);
    }
    g.userData.wet = true;
    return g;
  }
  function decorate(d: Decor | null): void {
    lastDecor = d;
    const has = (arr: readonly number[] | undefined, c: number) => !!arr && arr.includes(c);
    for (let c = 0; c < CELLS; c++) {
      const s = shells[c];
      const inner = s?.userData.inner;
      // Chrome: the paint body goes mirror-bright.
      if (s) {
        const want = has(d?.chrome, c);
        if (want !== !!s.userData.chrome) {
          s.userData.chrome = want;
          bodiesOf(s).forEach((m: any) => (m.material = want ? decorMats.chrome[owners[c]!] : M.paint[owners[c]!]));
        }
        // Cracks follow the rules' "next to fade".
        if (has(d?.cracking, c)) crack(c);
        else if (s.userData.cracking && d) uncrack(c);
      }
      setDecor(`wet:${c}`, !!inner && has(d?.wet, c), () => wetDrips(owners[c]!), inner);
      setDecor(`seal:${c}`, !!inner && has(d?.seal, c), () => {
        const m = new T.Mesh(shellGeo, decorMats.seal);
        m.scale.setScalar(1.16);
        return m;
      }, inner);
      setDecor(`tape:${c}`, has(d?.tape, c), () => {
        const m = new T.Mesh(casingGeo, decorMats.tape);
        m.scale.setScalar(1.03);
        m.layers.set(1);
        return m;
      }, casings[c]);
      const trap = d?.trap.find((t) => t.cell === c);
      setDecor(`trap:${c}`, !!trap, () => {
        const m = new T.Mesh(casingGeo, decorMats.trap[trap!.by]);
        m.scale.setScalar(1.035);
        m.layers.set(1);
        return m;
      }, casings[c]);
    }
    // Wet-floor lines: a caution-yellow beam along the line.
    const lines = new Set((d?.floor ?? []).map((f) => f.line.join('-')));
    for (const key of [...decor.keys()].filter((k) => k.startsWith('floor:'))) if (!lines.has(key.slice(6))) setDecor(key, false, () => null, cube);
    for (const f of d?.floor ?? []) {
      setDecor(`floor:${f.line.join('-')}`, true, () => {
        const a = slot(f.line[0]);
        const b = slot(f.line[2]);
        const m = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, a.distanceTo(b) + 0.9, 10, 1, true), decorMats.floor);
        m.position.copy(a).lerp(b, 0.5);
        m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        m.layers.set(1);
        return m;
      }, cube);
    }
  }
  function uncrack(c: number): void {
    const s = shells[c];
    const p = owners[c];
    if (!s || p === null) return;
    s.userData.cracking = false;
    bodiesOf(s).forEach((m: any) => (m.material = s.userData.chrome ? decorMats.chrome[p] : M.paint[p]));
    const inner = s.userData.inner ?? s;
    for (const ch of [...inner.children]) if (ch.material === crackMat) inner.remove(ch);
  }
  function animateDecor(): void {
    for (const [k, m] of decor) {
      if (k.startsWith('wet:')) {
        for (const d of m.children) {
          const t = (now * 0.8 + d.userData.phase) % 1.6;
          const len = Math.min(1, t / 1.1) * 0.32;
          d.userData.rod.scale.set(0.03, Math.max(0.001, len), 0.03);
          d.visible = t < 1.4;
        }
      } else if (k.startsWith('floor:')) m.material.opacity = 0.4 + 0.2 * Math.sin(now * 5);
    }
    for (const t of targets) {
      t.material.opacity = 0.65 + 0.35 * Math.sin(now * 8);
      t.scale.setScalar(0.9 + 0.08 * Math.sin(now * 8));
    }
  }

  // Targets: pulsing rings on the cells a power can pick.
  const targets: any[] = [];
  const targetTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.lineWidth = 16;
    g.strokeStyle = '#0d0a14';
    g.beginPath();
    g.arc(64, 64, 44, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 9;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.beginPath();
    g.arc(64, 64, 38, 0, Math.PI * 2);
    g.fill();
    return new T.CanvasTexture(c);
  })();
  function highlight(cells: readonly number[] | null, color = '#ffffff'): void {
    for (const t of targets) t.parent?.remove(t);
    targets.length = 0;
    for (const c of cells ?? []) {
      // A glowing ring drawn over everything, so targets inside the cube show too.
      const m = new T.Sprite(new T.SpriteMaterial({ map: targetTex, color: new T.Color(color).multiplyScalar(1.6), transparent: true, depthTest: false, depthWrite: false }));
      m.scale.setScalar(0.95);
      m.renderOrder = 30;
      m.layers.set(1);
      m.position.copy(slot(c));
      cube.add(m);
      targets.push(m);
    }
  }

  /** The ability's moment: a graffiti caption, a burst, a sound; ultimates hit harder. */
  async function abilityFx(p: Player, id: AbilityId, cells: readonly number[]): Promise<void> {
    const color = PLAYER_COLORS[p];
    const isUltimate = id === 'chrome' || id === 'lockdown' || id === 'flip' || id === 'rewind';
    const at = cells.length ? toWorld(cells[0]) : toWorld(CENTER);
    const label = (board.abilityName?.(id) ?? id).toUpperCase();
    sfx.power(id);
    haptics.tap();
    if (isUltimate) {
      clock.scale = 0.4;
      hit({ shake: 0.5, bloom: 1.6, flash: 0.25, aberr: 0.018 });
      fx.ring(toWorld(CENTER), color, 5, 0.7);
      for (let i = 0; i < 6; i++) fx.splat(toWorld(Math.floor(Math.random() * CELLS)).addScaledVector(towardCamera(toWorld(CENTER)), 1), color, 1.6, 0.7);
      void caption(label, color, toWorld(CENTER).addScaledVector(towardCamera(toWorld(CENTER)), 3), label.length > 7 ? 1.6 : 2.1);
      await wait(0.35);
      clock.scale = 1;
      await wait(0.25);
      return;
    }
    hit({ shake: 0.2, bloom: 0.7, aberr: 0.006 });
    fx.ring(at, color, 2.2, 0.4);
    fx.mist(at.clone().addScaledVector(towardCamera(at), 0.5), color, 40, 3);
    const mid = toWorld(CENTER);
    void caption(label, color, mid.lerp(at, 0.4).addScaledVector(towardCamera(at), 2.4), label.length > 7 ? 1.25 : 1.6);
    await wait(0.4);
  }

  async function wipe(cell: number, p: Player): Promise<void> {
    const s = shells[cell];
    if (!s) return;
    const pos = toWorld(cell);
    sfx.whoosh();
    fx.mist(pos.clone().addScaledVector(towardCamera(pos), 0.4), '#e9e4f2', 90, 4);
    await anim(0.3, (k) => s.scale.setScalar(1 - 0.9 * ease.inCubic(k)));
    fx.burst(pos, PLAYER_COLORS[p], 16, 3, 0.05);
    hit({ shake: 0.15 });
    removeShell(cell);
  }

  async function slide(moves: { from: number; to: number; player: Player }[], flip: boolean): Promise<void> {
    if (flip) {
      // The whole cube somersaults, then the paint lands where the rules put it.
      sfx.whoosh();
      await anim(0.6, (k) => (spinX = Math.PI * 2 * ease.inOutCubic(k)));
      spinX = 0;
      const moved = moves.map((m) => ({ ...m, s: shells[m.from] }));
      for (const m of moved) {
        shells[m.from] = null;
        owners[m.from] = null;
      }
      for (const m of moved) {
        shells[m.to] = m.s;
        owners[m.to] = m.player;
        m.s?.position.copy(slot(m.to));
      }
      hit({ shake: 0.5, bloom: 0.8 });
      return;
    }
    const moved = moves.map((m) => ({ ...m, s: shells[m.from] }));
    for (const m of moved) {
      shells[m.from] = null;
      owners[m.from] = null;
    }
    for (const m of moved) {
      shells[m.to] = m.s;
      owners[m.to] = m.player;
    }
    sfx.whoosh();
    await anim(0.35, (k) => {
      for (const m of moved) {
        const a = slot(m.from);
        const b = slot(m.to);
        m.s?.position.copy(a.lerp(b, ease.inOutCubic(k))).add(new T.Vector3(0, Math.sin(k * Math.PI) * 0.35, 0));
      }
    });
    for (const m of moved) {
      const w = toWorld(m.to);
      fx.mist(w, PLAYER_COLORS[m.player], 16, 1.5);
    }
    hit({ shake: 0.14 });
  }

  function convert(cell: number, to: Player): void {
    if (shells[cell]) removeShell(cell);
    placeShell(cell, to, true);
    const pos = toWorld(cell);
    fx.burst(pos, PLAYER_COLORS[to], 30, 4, 0.06);
    fx.ring(pos, PLAYER_COLORS[to], 2.4, 0.45);
    void caption('GOTCHA', PLAYER_COLORS[to], pos.clone().addScaledVector(towardCamera(pos), 2), 1.6);
    hit({ shake: 0.3, bloom: 0.8 });
  }

  async function rewindFx(cells: readonly Cell[]): Promise<void> {
    sfx.whoosh();
    hit({ aberr: 0.03, flash: 0.15 });
    const y0 = yaw;
    await anim(0.5, (k) => (yaw = y0 - Math.PI * 2 * ease.inOutCubic(k)));
    yaw = y0;
    for (let i = 0; i < CELLS; i++) {
      if (owners[i] === cells[i]) continue;
      if (shells[i]) removeShell(i);
      if (cells[i] !== null) placeShell(i, cells[i]!, true);
    }
    hit({ shake: 0.3 });
  }

  function sync(cells: readonly Cell[], cracking: readonly number[] = []): void {
    clearTag();
    showAim(null);
    for (let i = 0; i < CELLS; i++) {
      if (shells[i]) removeShell(i);
      const p = cells[i];
      if (p !== null) placeShell(i, p, false);
    }
    cracking.forEach((c) => crack(c));
    if (lastDecor) decorate(lastDecor);
  }

  /** Match won: a beat of slow motion, confetti from both sides, and the winner's tag on the wall. */
  async function celebrate(p: Player): Promise<void> {
    const color = PLAYER_COLORS[p];
    const colors = [color, color, '#f5e663', '#ffffff', color];
    const n = calm ? 40 : 90;
    clock.scale = 0.3;
    hit({ bloom: 1.2, flash: 0.18, shake: 0.3 });
    const base = camera.position.clone();
    const right = new T.Vector3(1, 0, 0);
    for (const side of [-1, 1]) {
      const from = base.clone().addScaledVector(right, side * 2.8).add(new T.Vector3(0, -2.6, -3.2));
      fx.confetti(from, new T.Vector3(-side * 0.35, 1, -0.45).normalize(), colors, n, 8);
    }
    fx.confetti(new T.Vector3(0, 4.5, 0), new T.Vector3(0, 0.2, 0.3).normalize(), colors, n / 2, 3);
    void wallTag(board.names[p].toUpperCase(), color);
    sfx.win();
    haptics.win();
    await wait(0.5 * 0.3);
    clock.scale = 1;
    await wait(1.1);
  }

  function setMode(m: Mode): void {
    mode = m;
    const stacking = m === 'cascade';
    for (let i = 0; i < CELLS; i++) {
      const c = casings[i];
      c.material = stacking ? glass : M.casing;
      c.castShadow = !stacking;
      // Glass slots get no ink outline, so only the paint is inked.
      for (const h of c.children) if (h.userData.hull) h.visible = !stacking;
      c.visible = !(i === CENTER && !stacking);
    }
    core.visible = !stacking;
    coreLight.visible = !stacking;
    if (stacking) pitch = 0.42;
  }

  // Input: drag spins (yaw only in stacking, so "down" stays down); a tap picks a cell.
  let spinX = 0;
  let yaw = 0.78;
  let pitch = 0.5;
  let vyaw = 0;
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;
  let lastInput = -10;
  let now = 0;
  const ray = new T.Raycaster();
  ray.layers.enableAll();
  /** The cell (and the hit point in cube space) under a screen point, if any. */
  function pick(clientX: number, clientY: number): { cell: number; local: any } | null {
    const rect = host.getBoundingClientRect();
    ray.setFromCamera(new T.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
    const targets = [...casings.filter((c) => c.visible), ...shells.filter(Boolean)];
    const hitObj = ray.intersectObjects(targets, true)[0];
    if (!hitObj) return null;
    let o = hitObj.object;
    while (o && o.userData.cell === undefined && !shells.includes(o)) o = o.parent;
    const cell = o?.userData.cell ?? shells.indexOf(o);
    if (cell < 0) return null;
    cube.updateMatrixWorld();
    return { cell, local: cube.worldToLocal(hitObj.point.clone()) };
  }

  /** Screen-space direction (pixels) of moving from a cell along a cube-space axis. */
  function screenDir(cell: number, axis: any): [number, number] {
    cube.updateMatrixWorld();
    const a = cube.localToWorld(slot(cell)).project(camera);
    const b = cube.localToWorld(slot(cell).addScaledVector(axis, 0.5)).project(camera);
    const rect = host.getBoundingClientRect();
    return [((b.x - a.x) * rect.width) / 2, (-(b.y - a.y) * rect.height) / 2];
  }

  /**
   * Work out the twist a swipe means: the face touched, the face axis the swipe runs
   * along, and so the layer that turns and which way. Returns the rules' Twist plus how
   * many pixels of swipe make a quarter turn along the swipe's screen direction.
   */
  function twistFromSwipe(cell: number, local: any, dx: number, dy: number): { t: Twist; dir: [number, number] } | null {
    const rel = local.clone().sub(slot(cell));
    const ax = [Math.abs(rel.x), Math.abs(rel.y), Math.abs(rel.z)];
    const ni = ax.indexOf(Math.max(...ax));
    const normal = new T.Vector3().setComponent(ni, Math.sign(rel.getComponent(ni)) || 1);
    let best: { along: any; s: number; dot: number; dir: [number, number] } | null = null;
    for (let i = 0; i < 3; i++) {
      if (i === ni) continue;
      const along = new T.Vector3().setComponent(i, 1);
      const [sx, sy] = screenDir(cell, along);
      const len = Math.hypot(sx, sy) || 1;
      const dot = (sx * dx + sy * dy) / len;
      if (!best || Math.abs(dot) > Math.abs(best.dot)) best = { along, s: Math.sign(dot) || 1, dot, dir: [sx / len, sy / len] };
    }
    if (!best) return null;
    // Positive rotation about (normal x along) moves the touched face along +along.
    const rot = new T.Vector3().crossVectors(normal, best.along);
    let sigma = best.s;
    const ri = [Math.abs(rot.x), Math.abs(rot.y), Math.abs(rot.z)].indexOf(1);
    if (rot.getComponent(ri) < 0) sigma = -sigma;
    const axis = ([0, 2, 1] as const)[ri] as Axis; // three x -> rules x, three y -> rules z (height), three z -> rules y
    const slice = coord(cell)[axis] as Slice;
    let t: Twist = { axis, slice, dir: 1 };
    if (twistSign(t) !== sigma) t = { axis, slice, dir: -1 };
    return { t, dir: [best.dir[0] * best.s, best.dir[1] * best.s] };
  }

  let grab: { cell: number; local: any; x0: number; y0: number; twist: { t: Twist; dir: [number, number] } | null; ctx: TwistCtx | null } | null = null;
  const QUARTER_PX = 150;

  const onDown = (e: PointerEvent) => {
    sfx.unlock();
    showAim(pick(e.clientX, e.clientY)?.cell ?? null);
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    host.setPointerCapture?.(e.pointerId);
    grab = null;
    if (board.twistEnabled && !preview) {
      const p = pick(e.clientX, e.clientY);
      if (p) grab = { ...p, x0: e.clientX, y0: e.clientY, twist: null, ctx: null };
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) {
      // A mouse hovering aims too.
      if (e.pointerType === 'mouse') {
        const c = pick(e.clientX, e.clientY)?.cell ?? null;
        if ((c === null ? -1 : board.aimAt?.(c) ?? -1) !== aimCell) showAim(c);
      }
      return;
    }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 8 && aimCell >= 0) showAim(null);
    lastInput = now;
    if (grab) {
      const tx = e.clientX - grab.x0;
      const ty = e.clientY - grab.y0;
      if (!grab.twist && Math.hypot(tx, ty) > 14) {
        const tw = twistFromSwipe(grab.cell, grab.local, tx, ty);
        if (tw && board.onTwistIntent?.(tw.t) !== false) {
          grab.twist = tw;
          grab.ctx = beginTwist(tw.t);
          sfx.whoosh();
        } else {
          grab = null;
          return;
        }
      }
      if (grab?.ctx && grab.twist) {
        const along = tx * grab.twist.dir[0] + ty * grab.twist.dir[1];
        turnTo(grab.ctx, Math.max(0, Math.min(1, along / QUARTER_PX)));
      }
      return;
    }
    yaw += dx * 0.009;
    vyaw = dx * 0.009 * 60;
    if (mode === 'rotating') pitch = Math.max(-1.1, Math.min(1.1, pitch + dy * 0.007));
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (e.pointerType !== 'mouse') showAim(null);
    if (grab?.ctx) {
      const ctx = grab.ctx;
      grab = null;
      if (ctx.f > 0.28) {
        preview = ctx;
        const from = ctx.f;
        void anim(0.15, (k) => turnTo(ctx, from + (1 - from) * ease.outCubic(k)));
        board.onTwistReady?.(ctx.t);
      } else {
        const from = ctx.f;
        void anim(0.15, (k) => turnTo(ctx, from * (1 - k))).then(() => abandonTwist(ctx));
      }
      return;
    }
    grab = null;
    if (moved > 8) return;
    vyaw = 0;
    lastInput = now;
    const p = pick(e.clientX, e.clientY);
    if (p && !preview) board.onTap?.(p.cell);
  };
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  const onCancel = () => {
    dragging = false;
    showAim(null);
  };
  host.addEventListener('pointercancel', onCancel);

  let shakeOff: [number, number, number] = [0, 0, 0];
  function update(real: number): void {
    const dt = clock.advance(real);
    tweens.update(dt);
    fx.update(dt);
    if (!dragging) {
      vyaw *= Math.exp(-3 * real);
      yaw += vyaw * real;
      if (board.attract || now - lastInput > 6) {
        const home = Math.round((yaw - 0.785) / (Math.PI / 2)) * (Math.PI / 2) + 0.785 + Math.sin(now * 0.35) * 0.32;
        yaw += (home - yaw) * Math.min(1, real * 0.8);
        if (mode === 'rotating') pitch += (0.5 - pitch) * Math.min(1, real * 0.8);
      }
    }
    cube.rotation.set(pitch + spinX, yaw, 0, 'XYZ');
    // The Core breathes in the colour of whoever is to move.
    const beat = turnP === null ? Math.sin(now * 3) : Math.pow(Math.max(0, Math.sin(now * 4.2)), 3) * 2 - 0.6;
    core.scale.setScalar(1 + beat * 0.06);
    core.rotation.y += real * 0.8;
    core.rotation.x += real * 0.5;
    coreTarget.set(turnP === null ? CORE_COLOR : PLAYER_COLORS[turnP]);
    if (turnP !== null) coreTarget.lerp(coreGold, 0.25);
    const kc = Math.min(1, real * 6);
    M.core.emissive.lerp(coreTarget, kc);
    M.core.color.lerp(coreTarget, kc);
    coreLight.color.lerp(coreTarget, kc);
    glowMat.color.lerp(coreTarget, kc);
    M.core.emissiveIntensity = 2.2 + beat * 0.5;
    coreLight.intensity = 6 + beat * 1.5;
    for (let i = 0; i < CELLS; i++) {
      const s = shells[i];
      if (!s) continue;
      // Idle wobble (the paint is still a little wet); a mark about to fade shivers.
      const inner = s.userData.inner;
      if (!inner) continue;
      inner.rotation.y = s.userData.cracking ? Math.sin(now * 40) * 0.02 : 0;
      if (!calm) {
        const ph = s.userData.phase;
        inner.rotation.x = Math.sin(now * 1.7 + ph) * 0.04;
        inner.rotation.z = Math.sin(now * 1.3 + ph * 1.9) * 0.04;
        inner.position.y = Math.sin(now * 2.1 + ph * 0.7) * 0.012;
      }
    }
    if (aimHalo.visible) haloMat.opacity = 0.7 + 0.25 * Math.sin(now * 9);
    if (decor.size || targets.length) animateDecor();
    pulse.punch *= Math.exp(-4 * real);
    pulse.bloom *= Math.exp(-5 * real);
    pulse.aberr *= Math.exp(-5 * real);
    pulse.flash *= Math.exp(-9 * real);
    shakeOff = shake.update(real);
  }

  function render(): void {
    view.resize();
    const aspect = view.w / view.h;
    const v = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(v / 2) * aspect);
    const dist = (2.4 / Math.sin(Math.min(v, hfov) / 2)) * (1 - (calm ? 0 : pulse.punch));
    camera.position.set(shakeOff[0], 0.9 + shakeOff[1], dist);
    camera.lookAt(0, 0.1, 0);
    camera.rotateZ(shakeOff[2]);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const wallW = Math.max(12, 2 * Math.tan(hfov / 2) * (dist + 5) * 1.15);
    wall.scale.x = wallW / 12;
    wallTex.repeat.x = wallW / 12;
    wallTex.offset.x = -(wallW / 12 - 1) / 2;
    glowMat.opacity = Math.min(1, 0.7 + pulse.bloom * 0.6);
    const f = Math.min(1, pulse.flash * 1.4);
    if (f > 0.01 || flashEl.style.opacity !== '0') flashEl.style.opacity = f > 0.01 ? f.toFixed(3) : '0';
    r.setRenderTarget(null);
    r.render(world, camera);
  }

  let last = 0;
  let frames = 0;
  let fpsT = 0;
  let slowFor = 0;
  let fastFor = 0;
  let warmup = 3;
  /**
   * Quality steps, best first; the governor moves along this list. Effects go first
   * (soft shadows, particles, shadows), and the resolution only after them, never below
   * `minRatio` (2x on most phones): a sharp cube matters more than extras.
   */
  const shadowSoft = (soft: boolean, size: number) => {
    const t = soft ? T.PCFSoftShadowMap : T.PCFShadowMap;
    if (r.shadowMap.type !== t || lamp.shadow.mapSize.x !== size) {
      r.shadowMap.type = t;
      lamp.shadow.mapSize.set(size, size);
      lamp.shadow.map?.dispose();
      lamp.shadow.map = null;
      world.traverse((o: any) => o.material && (o.material.needsUpdate = true));
    }
  };
  const quality = (pr: number, soft: boolean, shadowSize: number, budget: number, shadows = true) => () => {
    if (pixelRatio !== pr) {
      pixelRatio = pr;
      r.setPixelRatio(pr);
    }
    shadowSoft(soft, shadowSize);
    r.shadowMap.enabled = shadows;
    fx.budget = budget;
  };
  const steps: (() => void)[] = [
    quality(maxRatio, true, 1024, 1),
    quality(maxRatio, false, 1024, 1),
    quality(maxRatio, false, 512, 0.6),
  ];
  for (let pr = maxRatio - 0.25; pr > minRatio + 0.001; pr -= 0.25) steps.push(quality(pr, false, 512, 0.6));
  steps.push(quality(minRatio, false, 512, 0.5));
  steps.push(quality(minRatio, false, 512, 0.4, false));
  let level = 0;
  const stats = { fps: 0 };
  /** The best step we may climb back to: a level that was too slow twice is off limits. */
  let ceiling = 0;
  const fails = steps.map(() => 0);
  const loop = manual
    ? null
    : new RenderLoop(host, (t) => {
        const real = Math.min(0.05, Math.max(0, t - last));
        last = t;
        now = t;
        update(real);
        render();
        // Shader compiles and the first frames are slow everywhere: don't judge them.
        if (warmup > 0) {
          warmup -= real;
          frames = 0;
          fpsT = 0;
          return;
        }
        frames++;
        fpsT += real;
        if (fpsT >= 0.5) {
          const fps = frames / fpsT;
          // Slow phone: trade extras, then a little resolution, for frame rate. A steady
          // fast phone climbs back up, but not to a level that was too slow twice.
          stats.fps = Math.round(fps);
          slowFor = fps < 40 ? slowFor + fpsT : 0;
          fastFor = fps > 55 ? fastFor + fpsT : 0;
          if (slowFor > 2 && level < steps.length - 1) {
            if (++fails[level] >= 2) ceiling = Math.max(ceiling, level + 1);
            level++;
            steps[level]();
            slowFor = 0;
            fastFor = 0;
          } else if (fastFor > 5 && level > ceiling) {
            level--;
            steps[level]();
            fastFor = 0;
          }
          frames = 0;
          fpsT = 0;
        }
      });
  // After a hidden/asleep stretch the first frames are slow again.
  const onVisible = () => {
    if (document.visibilityState === 'visible') warmup = 1.5;
  };
  document.addEventListener('visibilitychange', onVisible);

  const board: Board = {
    stats: () => ({ ratio: pixelRatio, fps: stats.fps, level, levels: steps.length }),
    onTap: null,
    onTwistIntent: null,
    onTwistReady: null,
    twistEnabled: false,
    async cancelTwist() {
      const ctx = preview;
      if (!ctx) return;
      preview = null;
      const from = ctx.f;
      await anim(0.2, (k) => turnTo(ctx, from * (1 - ease.outCubic(k))));
      abandonTwist(ctx);
    },
    swipe(cell, dx, dy) {
      const tw = twistFromSwipe(cell, slot(cell).multiplyScalar(1.5), dx, dy);
      if (!tw || board.onTwistIntent?.(tw.t) === false) return null;
      const ctx = beginTwist(tw.t);
      turnTo(ctx, 1);
      preview = ctx;
      board.onTwistReady?.(tw.t);
      return tw.t;
    },
    attract: false,
    aimAt: null,
    aim: (c) => showAim(c),
    decorate,
    highlight,
    abilityName: null,
    names: ['P1', 'P2'],
    setTurn(p) {
      turnP = p;
      if (p === null) showAim(null);
    },
    setMode,
    sync,
    play,
    refuse(cell) {
      hit({ shake: 0.12 });
      haptics.refuse();
      const s = shells[cell] ?? casings[cell];
      const base = s.position.clone();
      void anim(0.25, (k) => s.position.copy(base).add(new T.Vector3(Math.sin(k * 30) * 0.05 * (1 - k), 0, 0)));
    },
    advance(sec, draw = true) {
      const steps = Math.max(1, Math.round(sec / (1 / 60)));
      for (let i = 0; i < steps; i++) {
        now += sec / steps;
        update(sec / steps);
      }
      if (draw) render();
    },
    dispose() {
      loop?.stop();
      document.removeEventListener('visibilitychange', onVisible);
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onCancel);
      tweens.clear();
      fx.clear();
      glowMat.map.dispose();
      glowMat.dispose();
      vig.remove();
      flashEl.remove();
      disposeAll(world);
      r.dispose();
      r.domElement.remove();
    },
  };
  if (manual) render();
  return board;
}
