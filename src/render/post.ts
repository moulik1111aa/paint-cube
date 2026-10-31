// Post-processing for the street-art look. The scene renders into an HDR target; a
// normals + depth pass of the solid objects (layer 0) gives the ink outlines; a
// Kuwahara filter turns the image into flat brushy patches of paint; a mip-chain bloom
// picks out what is brighter than white; and the final pass mixes it all with ACES
// tone mapping, halftone dots in the shadows, paper grain, vignette and two impact
// controls (chromatic aberration and a warm flash). Hand-written on three.js core, so
// no add-on modules are needed. Effects (layer 1) are never outlined.

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

// Kuwahara: of the four quadrants around a pixel, keep the mean of the calmest one.
// Edges stay sharp while flat areas break into brushy patches.
const KUWAHARA = `
uniform sampler2D tex; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec3 m0 = vec3(0.0); vec3 m1 = vec3(0.0); vec3 m2 = vec3(0.0); vec3 m3 = vec3(0.0);
  vec3 s0 = vec3(0.0); vec3 s1 = vec3(0.0); vec3 s2 = vec3(0.0); vec3 s3 = vec3(0.0);
  for (int j = 0; j <= 3; j++) {
    for (int i = 0; i <= 3; i++) {
      vec3 c;
      c = texture2D(tex, vUv + vec2(float(-i), float(-j)) * texel).rgb; m0 += c; s0 += c * c;
      c = texture2D(tex, vUv + vec2(float(i), float(-j)) * texel).rgb; m1 += c; s1 += c * c;
      c = texture2D(tex, vUv + vec2(float(-i), float(j)) * texel).rgb; m2 += c; s2 += c * c;
      c = texture2D(tex, vUv + vec2(float(i), float(j)) * texel).rgb; m3 += c; s3 += c * c;
    }
  }
  float n = 16.0;
  m0 /= n; m1 /= n; m2 /= n; m3 /= n;
  float v0 = dot(abs(s0 / n - m0 * m0), vec3(1.0));
  float v1 = dot(abs(s1 / n - m1 * m1), vec3(1.0));
  float v2 = dot(abs(s2 / n - m2 * m2), vec3(1.0));
  float v3 = dot(abs(s3 / n - m3 * m3), vec3(1.0));
  vec3 best = m0; float bv = v0;
  if (v1 < bv) { best = m1; bv = v1; }
  if (v2 < bv) { best = m2; bv = v2; }
  if (v3 < bv) { best = m3; }
  gl_FragColor = vec4(best, 1.0);
}`;

const COMPOSITE = `
uniform sampler2D scene; uniform sampler2D paint; uniform sampler2D normals; uniform sampler2D depth;
uniform sampler2D b0; uniform sampler2D b1; uniform sampler2D b2; uniform sampler2D b3;
uniform float strength; uniform float aberration; uniform float flash; uniform float exposure;
uniform float vignette; uniform float time; uniform vec2 res; uniform float painterly;
uniform float ink; uniform float halftone; uniform float near; uniform float far;
varying vec2 vUv;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float viewZ(vec2 uv){
  float z = texture2D(depth, uv).x * 2.0 - 1.0;
  return (2.0 * near * far) / (far + near - z * (far - near));
}
void main(){
  vec2 d = vUv - 0.5;
  vec3 col;
  if (aberration > 0.0001) {
    col.r = mix(texture2D(scene, vUv + d * aberration).r, texture2D(paint, vUv + d * aberration).r, painterly);
    col.g = mix(texture2D(scene, vUv).g, texture2D(paint, vUv).g, painterly);
    col.b = mix(texture2D(scene, vUv - d * aberration).b, texture2D(paint, vUv - d * aberration).b, painterly);
  } else col = mix(texture2D(scene, vUv).rgb, texture2D(paint, vUv).rgb, painterly);

  vec3 bloom = texture2D(b0, vUv).rgb * 0.6 + texture2D(b1, vUv).rgb * 0.8 + texture2D(b2, vUv).rgb * 1.0 + texture2D(b3, vUv).rgb * 1.2;
  col = (col + bloom * strength) * exposure;
  col = aces(col);

  // Ink: edges where normals or depth jump, wobbled like a hand-drawn line.
  if (ink > 0.0) {
    vec2 px = 1.7 / res;
    vec2 wob = (vec2(noise(vUv * 90.0), noise(vUv * 90.0 + 17.0)) - 0.5) * px * 1.6;
    vec2 uv = vUv + wob;
    vec3 n0 = texture2D(normals, uv).rgb;
    float z0 = viewZ(uv);
    float nd = 0.0; float dd = 0.0;
    vec2 o0 = vec2(px.x, 0.0); vec2 o1 = vec2(0.0, px.y);
    nd += length(texture2D(normals, uv + o0).rgb - n0); dd += abs(viewZ(uv + o0) - z0);
    nd += length(texture2D(normals, uv - o0).rgb - n0); dd += abs(viewZ(uv - o0) - z0);
    nd += length(texture2D(normals, uv + o1).rgb - n0); dd += abs(viewZ(uv + o1) - z0);
    nd += length(texture2D(normals, uv - o1).rgb - n0); dd += abs(viewZ(uv - o1) - z0);
    float e = clamp(smoothstep(0.5, 0.9, nd) + smoothstep(0.04, 0.09, dd / z0), 0.0, 1.0);
    e *= 0.75 + 0.25 * noise(vUv * 25.0 + 3.0);
    col = mix(col, vec3(0.04, 0.03, 0.07), e * ink);
  }

  // Halftone dots in the shadows.
  float L = dot(col, vec3(0.299, 0.587, 0.114));
  if (halftone > 0.0) {
    vec2 p = vUv * res / 7.0;
    p = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p;
    float dist = length(fract(p) - 0.5);
    float rad = sqrt(clamp(1.0 - L * 2.2, 0.0, 1.0)) * 0.48;
    float dotMask = 1.0 - smoothstep(rad - 0.06, rad, dist);
    col *= 1.0 - dotMask * smoothstep(0.42, 0.1, L) * 0.45 * halftone;
  }

  col += flash * vec3(1.0, 0.9, 0.75) * smoothstep(0.75, 0.0, length(d));
  col *= mix(1.0, smoothstep(0.95, 0.25, length(d * vec2(res.x / res.y, 1.0))), vignette);
  // Paper: low-frequency fibers plus fine grain.
  col *= 0.94 + 0.06 * noise(vUv * res / 3.0);
  col += (hash(vUv * res + time) - 0.5) * 0.02;
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}`;

export class Post {
  strength = 0.55;
  aberration = 0;
  flash = 0;
  exposure = 1.0;
  vignette = 0.6;
  /** 0 = plain render, 1 = full oil-paint filter. */
  painterly = 0.85;
  ink = 1;
  halftone = 1;
  private readonly r: any;
  private readonly sceneRT: any;
  private readonly normalRT: any;
  private readonly paintRT: any;
  private readonly levels: { a: any; b: any }[];
  private readonly quad: any;
  private readonly qScene: any;
  private readonly qCam: any;
  private readonly bright: any;
  private readonly blur: any;
  private readonly kuwa: any;
  private readonly composite: any;
  private readonly normalMat: any;
  private w = 1;
  private h = 1;

  constructor(T: Three, renderer: any) {
    this.r = renderer;
    const opts = { type: T.HalfFloatType, depthBuffer: false };
    this.sceneRT = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: 4 });
    this.normalRT = new T.WebGLRenderTarget(1, 1, { depthTexture: new T.DepthTexture(1, 1) });
    this.paintRT = new T.WebGLRenderTarget(1, 1, opts);
    this.levels = [0, 1, 2, 3].map(() => ({ a: new T.WebGLRenderTarget(1, 1, opts), b: new T.WebGLRenderTarget(1, 1, opts) }));
    const mat = (frag: string, uniforms: Record<string, unknown>) =>
      new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.bright = mat(BRIGHT, { tex: { value: null }, threshold: { value: 1.3 }, knee: { value: 0.4 } });
    this.blur = mat(BLUR, { tex: { value: null }, dir: { value: new T.Vector2() } });
    this.kuwa = mat(KUWAHARA, { tex: { value: null }, texel: { value: new T.Vector2() } });
    this.composite = mat(COMPOSITE, {
      scene: { value: null }, paint: { value: null }, normals: { value: null }, depth: { value: null },
      b0: { value: null }, b1: { value: null }, b2: { value: null }, b3: { value: null },
      strength: { value: 1 }, aberration: { value: 0 }, flash: { value: 0 }, exposure: { value: 1 },
      vignette: { value: 0 }, time: { value: 0 }, res: { value: new T.Vector2(1, 1) }, painterly: { value: 1 },
      ink: { value: 1 }, halftone: { value: 1 }, near: { value: 0.1 }, far: { value: 100 },
    });
    this.normalMat = new T.MeshNormalMaterial();
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
    this.normalRT.setSize(Math.max(1, Math.round(w * 0.75)), Math.max(1, Math.round(h * 0.75)));
    this.paintRT.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
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

    // Normals + depth of the solid objects only (layer 0), for the ink lines.
    if (this.ink > 0) {
      const bg = scene.background;
      const mask = camera.layers.mask;
      scene.background = null;
      scene.overrideMaterial = this.normalMat;
      camera.layers.set(0);
      r.setRenderTarget(this.normalRT);
      r.setClearColor(0x8080ff, 1);
      r.clear();
      r.render(scene, camera);
      r.setClearColor(0x000000, 0);
      scene.overrideMaterial = null;
      scene.background = bg;
      camera.layers.mask = mask;
    }

    if (this.painterly > 0) {
      this.kuwa.uniforms.tex.value = this.sceneRT.texture;
      this.kuwa.uniforms.texel.value.set(1.6 / this.w, 1.6 / this.h);
      this.pass(this.kuwa, this.paintRT);
    }

    this.bright.uniforms.tex.value = this.sceneRT.texture;
    this.pass(this.bright, this.levels[0].a);
    let src = this.levels[0].a;
    this.levels.forEach((l, i) => {
      if (i > 0) {
        this.blur.uniforms.tex.value = src.texture;
        this.blur.uniforms.dir.value.set(0, 0);
        this.pass(this.blur, l.a);
      }
      this.blur.uniforms.tex.value = l.a.texture;
      this.blur.uniforms.dir.value.set(1 / l.a.width, 0);
      this.pass(this.blur, l.b);
      this.blur.uniforms.tex.value = l.b.texture;
      this.blur.uniforms.dir.value.set(0, 1 / l.a.height);
      this.pass(this.blur, l.a);
      src = l.a;
    });

    const u = this.composite.uniforms;
    u.scene.value = this.sceneRT.texture;
    u.paint.value = this.paintRT.texture;
    u.normals.value = this.normalRT.texture;
    u.depth.value = this.normalRT.depthTexture;
    u.b0.value = this.levels[0].a.texture;
    u.b1.value = this.levels[1].a.texture;
    u.b2.value = this.levels[2].a.texture;
    u.b3.value = this.levels[3].a.texture;
    u.strength.value = this.strength;
    u.aberration.value = this.aberration;
    u.flash.value = this.flash;
    u.exposure.value = this.exposure;
    u.vignette.value = this.vignette;
    u.painterly.value = this.painterly;
    u.ink.value = this.ink;
    u.halftone.value = this.halftone;
    u.near.value = camera.near;
    u.far.value = camera.far;
    u.time.value = time % 100;
    u.res.value.set(this.w, this.h);
    this.pass(this.composite, null);
  }

  dispose(): void {
    this.sceneRT.dispose();
    this.normalRT.dispose();
    this.paintRT.dispose();
    for (const l of this.levels) {
      l.a.dispose();
      l.b.dispose();
    }
    this.bright.dispose();
    this.blur.dispose();
    this.kuwa.dispose();
    this.composite.dispose();
    this.normalMat.dispose();
    this.quad.geometry.dispose();
  }
}
