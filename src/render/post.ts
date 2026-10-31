// Post-processing: the scene renders into an HDR target (with MSAA), then a mip-chain
// bloom picks out only what is brighter than white (the Core, impact flashes, glowing
// paint), and a final pass adds the bloom, ACES tone mapping, vignette, a little film
// grain, and two impact controls: chromatic aberration and a white flash.
// Written by hand on three.js core, so no add-on modules are needed.

import type { Three } from './three.ts';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const BRIGHT = `
uniform sampler2D tex; uniform float threshold; uniform float knee; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tex, vUv).rgb;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, br - threshold) / max(br, 1e-4);
  gl_FragColor = vec4(c * w, 1.0);
}`;

const BLUR = `
uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tex, vUv).rgb * 0.2270270270;
  c += texture2D(tex, vUv + dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tex, vUv - dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tex, vUv + dir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tex, vUv - dir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSITE = `
uniform sampler2D scene; uniform sampler2D b0; uniform sampler2D b1; uniform sampler2D b2; uniform sampler2D b3;
uniform float strength; uniform float aberration; uniform float flash; uniform float exposure;
uniform float vignette; uniform float time; uniform vec2 res; varying vec2 vUv;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 d = vUv - 0.5;
  vec3 col;
  if (aberration > 0.0001) {
    col.r = texture2D(scene, vUv + d * aberration).r;
    col.g = texture2D(scene, vUv).g;
    col.b = texture2D(scene, vUv - d * aberration).b;
  } else col = texture2D(scene, vUv).rgb;
  vec3 bloom = texture2D(b0, vUv).rgb * 0.6 + texture2D(b1, vUv).rgb * 0.8 + texture2D(b2, vUv).rgb * 1.0 + texture2D(b3, vUv).rgb * 1.2;
  col = (col + bloom * strength) * exposure;
  col = aces(col);
  col += flash * vec3(1.0, 0.95, 0.88) * smoothstep(0.75, 0.0, length(d));
  col *= mix(1.0, smoothstep(0.95, 0.25, length(d * vec2(res.x / res.y, 1.0))), vignette);
  col += (hash(vUv * res + time) - 0.5) * 0.018;
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}`;

export class Post {
  /** Bloom strength; impacts push it up briefly. */
  strength = 0.9;
  aberration = 0;
  flash = 0;
  exposure = 1.0;
  vignette = 0.55;
  private readonly r: any;
  private readonly sceneRT: any;
  private readonly levels: { a: any; b: any }[];
  private readonly quad: any;
  private readonly qScene: any;
  private readonly qCam: any;
  private readonly bright: any;
  private readonly blur: any;
  private readonly composite: any;
  private w = 1;
  private h = 1;

  constructor(T: Three, renderer: any) {
    this.r = renderer;
    const opts = { type: T.HalfFloatType, depthBuffer: false };
    this.sceneRT = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: 4 });
    this.levels = [0, 1, 2, 3].map(() => ({ a: new T.WebGLRenderTarget(1, 1, opts), b: new T.WebGLRenderTarget(1, 1, opts) }));
    const mat = (frag: string, uniforms: Record<string, unknown>) =>
      new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.bright = mat(BRIGHT, { tex: { value: null }, threshold: { value: 1.25 }, knee: { value: 0.4 } });
    this.blur = mat(BLUR, { tex: { value: null }, dir: { value: new T.Vector2() } });
    this.composite = mat(COMPOSITE, {
      scene: { value: null }, b0: { value: null }, b1: { value: null }, b2: { value: null }, b3: { value: null },
      strength: { value: 1 }, aberration: { value: 0 }, flash: { value: 0 }, exposure: { value: 1 },
      vignette: { value: 0 }, time: { value: 0 }, res: { value: new T.Vector2(1, 1) },
    });
    this.quad = new T.Mesh(new T.PlaneGeometry(2, 2), this.bright);
    this.quad.frustumCulled = false;
    this.qScene = new T.Scene();
    this.qScene.add(this.quad);
    this.qCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.sceneRT.setSize(w, h);
    this.levels.forEach((l, i) => {
      const s = 2 ** (i + 1);
      l.a.setSize(Math.max(1, Math.round(w / s)), Math.max(1, Math.round(h / s)));
      l.b.setSize(Math.max(1, Math.round(w / s)), Math.max(1, Math.round(h / s)));
    });
  }

  private pass(material: any, target: any): void {
    this.quad.material = material;
    this.r.setRenderTarget(target);
    this.r.render(this.qScene, this.qCam);
  }

  render(scene: any, camera: any, time: number): void {
    const r = this.r;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    this.bright.uniforms.tex.value = this.sceneRT.texture;
    this.pass(this.bright, this.levels[0].a);
    let src = this.levels[0].a;
    this.levels.forEach((l, i) => {
      if (i > 0) {
        // Downsample the previous level into this one, then blur it.
        this.blur.uniforms.tex.value = src.texture;
        this.blur.uniforms.dir.value.set(0, 0);
        this.pass(this.blur, l.a);
      }
      const tw = 1 / l.a.width;
      const th = 1 / l.a.height;
      this.blur.uniforms.tex.value = l.a.texture;
      this.blur.uniforms.dir.value.set(tw, 0);
      this.pass(this.blur, l.b);
      this.blur.uniforms.tex.value = l.b.texture;
      this.blur.uniforms.dir.value.set(0, th);
      this.pass(this.blur, l.a);
      src = l.a;
    });

    const u = this.composite.uniforms;
    u.scene.value = this.sceneRT.texture;
    u.b0.value = this.levels[0].a.texture;
    u.b1.value = this.levels[1].a.texture;
    u.b2.value = this.levels[2].a.texture;
    u.b3.value = this.levels[3].a.texture;
    u.strength.value = this.strength;
    u.aberration.value = this.aberration;
    u.flash.value = this.flash;
    u.exposure.value = this.exposure;
    u.vignette.value = this.vignette;
    u.time.value = time % 100;
    u.res.value.set(this.w, this.h);
    this.pass(this.composite, null);
  }

  dispose(): void {
    this.sceneRT.dispose();
    for (const l of this.levels) {
      l.a.dispose();
      l.b.dispose();
    }
    this.bright.dispose();
    this.blur.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
  }
}
