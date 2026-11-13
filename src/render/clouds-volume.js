// PROTÓTIPO (?nuvens=volume): nuvens baixas e médias como volume de verdade (raymarching).
// - O WeatherField é "assado" numa textura 2D pequena (cobertura baixa, média, escurecimento, torre) a ~10 Hz.
// - Um ruído 3D dá a forma; a cobertura do dado é o limiar: mais cobertura = mais nuvem. Nada abaixo de 15%.
// - O volume é marchado em resolução reduzida num alvo próprio e colado por cima da cena.
// Mesmas regras de dado das outras nuvens: mínimo de 60% na baixa onde chove, cinza onde chove, chumbo e torre onde troveja.
import * as THREE from 'three';
import { toLonLat } from '../geo/projection.js';
import { clamp } from '../util/rng.js';
import { makeCloudNoise } from './cloud-noise.js';

const MAX_FLASH = 8, FIELD_N = 64;
const MIN_COVER = 15, RAIN_MIN_LOW = 60;
const Y0 = 3.9, Y1 = 14.5;                       // fatia vertical onde pode haver nuvem

// Densidade: compartilhada entre o volume e a sombra no mapa.
const DENSITY = /* glsl */`
precision highp sampler3D;
uniform sampler3D uNoise;
uniform sampler2D uField;
uniform vec4 uB;          // minX, minZ, 1/largura, 1/profundidade
uniform float uTime;
vec4 fieldAt(vec2 xz) { return textureLod(uField, (xz - uB.xy) * uB.zw, 0.0); }   // r baixa, g média, b escuro, a torre
float erode(float b, vec3 q, float lod) {
  float e = textureLod(uNoise, q, lod).g * 0.55 * (1.0 - 0.5 * b);
  return clamp((b - e) / (1.0 - e), 0.0, 1.0);
}
// hn = altura normalizada dentro da nuvem (0 base, 1 topo), para a luz ambiente
float cloudDensity(vec3 p, vec4 f, bool fine, float lod, out float hn) {
  hn = 0.5;
  float d = 0.0;
  vec3 drift = vec3(uTime * 0.05, 0.0, uTime * 0.02);
  vec2 v = textureLod(uNoise, vec3(p.xz / 61.0, 0.31), 0.0).rg;      // variação regional: cada nuvem com sua base e sua altura
  if (f.r > 0.004) {                                                  // camada baixa: cúmulos
    float base = 4.0 + 0.9 * v.y * (1.0 - smoothstep(0.0, 0.4, f.b)); // onde chove a base desce até o topo da chuva
    float H = (1.3 + 3.4 * f.r) * (0.4 + 1.2 * v.x) + 1.3 * f.b + 6.5 * f.a;
    float h = (p.y - base) / H;
    if (h > 0.0 && h < 1.0) {
      // bolhas grandes + torres menores por cima (o que dá o topo desigual)
      float s = 0.5 + 1.3 * (mix(textureLod(uNoise, (p + drift) / 26.0, 0.0).r, textureLod(uNoise, (p + drift * 1.3 + 5.1) / 10.0, 0.0).r, 0.35) - 0.5);
      // o limiar sobe com a altura: a nuvem afina para cima e cada bolha chega a uma altura diferente
      float need = 1.0 - min(1.0, 1.12 * pow(f.r, 0.75));
      need += (1.0 - need) * pow(h, 1.4) * (1.0 - 0.45 * f.a) + 0.3 * (1.0 - smoothstep(0.0, 0.1, h));
      float b = clamp((s - need) / 0.13, 0.0, 1.0);
      if (b > 0.0) { if (fine) b = erode(b, (p + drift * 1.6) / 5.5, lod); d += b; hn = h; }
    }
  }
  if (f.g > 0.004) {                                                  // camada média: altocúmulos, finos e miúdos
    float base = 7.7 + 0.9 * v.x;
    float H = (0.5 + 0.9 * f.g) * (0.6 + 0.8 * v.y);
    float h = (p.y - base) / H;
    if (h > 0.0 && h < 1.0) {
      float s = textureLod(uNoise, (p * vec3(1.0, 2.0, 1.0) + drift.zyx * 1.5 + 11.3) / 15.0, 0.0).r;
      float need = 1.0 - 0.85 * f.g;
      need += (1.0 - need) * pow(abs(h - 0.3) / 0.7, 1.5);
      float b = clamp((s - need) / 0.25, 0.0, 1.0);
      if (b > 0.0) { if (fine) b = erode(b, (p + drift.zyx * 2.0) / 4.0, lod); if (b * 0.6 > d) hn = h; d += b * 0.6; }
    }
  }
  return d;
}`;

const TRI_VERT = /* glsl */`
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const MARCH_FRAG = /* glsl */`
precision highp float;
${DENSITY}
uniform mat4 uProjInv, uCamWorld;
uniform vec3 uCam, uSunDir, uLit, uShade, uFlashColor;
uniform vec4 uFlash[${MAX_FLASH}];
uniform vec4 uBox;        // minX, minZ, maxX, maxZ
uniform float uPix;       // tamanho angular de um pixel do alvo
uniform int uSteps;
varying vec2 vNdc;
void main() {
  vec4 v4 = uProjInv * vec4(vNdc, 1.0, 1.0);
  vec3 rd = normalize(mat3(uCamWorld) * (v4.xyz / v4.w));
  vec3 ro = uCam;
  // trecho do raio dentro da caixa das nuvens
  vec3 lo = vec3(uBox.x, ${Y0.toFixed(1)}, uBox.y), hi = vec3(uBox.z, ${Y1.toFixed(1)}, uBox.w);
  vec3 inv = 1.0 / (abs(rd) + 1e-5) * sign(rd + 1e-9);
  vec3 ta = (lo - ro) * inv, tb = (hi - ro) * inv;
  vec3 tmn = min(ta, tb), tmx = max(ta, tb);
  float t0 = max(max(tmn.x, tmn.y), max(tmn.z, 0.3)), t1 = min(min(tmx.x, tmx.y), tmx.z);
  if (t1 <= t0) { gl_FragColor = vec4(0.0); return; }
  // passo geométrico: fino perto da câmera, largo longe, sempre no máximo uSteps passos
  float k = pow(t1 / t0, 1.0 / float(uSteps)) - 1.0;
  // início do raio deslocado num padrão 4x4: a colagem tira a média dos 16 e o degrau do passo some
  const int BAYER[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  ivec2 bp = ivec2(gl_FragCoord.xy) & 3;
  float jit = (float(BAYER[bp.x + bp.y * 4]) + 0.5) / 16.0;
  float t = t0 * (1.0 + k * jit);
  float T = 1.0; vec3 col = vec3(0.0);
  float mu = dot(rd, uSunDir);
  float fwd = 0.35 * pow(max(mu, 0.0), 6.0) + 0.12 * (0.5 + 0.5 * mu);      // contra o sol a borda acende
  for (int i = 0; i < 96; i++) {
    if (i >= uSteps || T < 0.02) break;
    float dt = t * k;
    vec3 p = ro + rd * (t + 0.5 * dt);
    t += dt;
    vec4 f = fieldAt(p.xz);
    if (max(f.r, f.g) < 0.004) continue;
    float hn;
    float d = cloudDensity(p, f, true, clamp(log2(t * uPix / 0.086), 0.0, 4.0), hn);
    if (d <= 0.003) continue;
    // sombra própria: duas amostras na direção do sol
    float h1, h2;
    float d1 = cloudDensity(p + uSunDir * 0.5, f, false, 0.0, h1), d2 = cloudDensity(p + uSunDir * 1.5, f, false, 0.0, h2);
    float sun = exp(-(0.3 * d + 1.3 * d1 + 2.2 * d2));
    float amb = mix(0.42, 1.0, hn);
    float dk = f.b;
    vec3 lit = uLit * mix(1.0, 0.36, dk), shade = uShade * mix(1.0, 0.3, dk);
    vec3 S = mix(shade * amb, lit, sun * (0.82 + fwd)) + lit * fwd * sun * 0.6;
    float fl = 0.0;
    for (int j = 0; j < ${MAX_FLASH}; j++) { vec4 q = uFlash[j]; fl += q.w * (1.0 - smoothstep(q.z * 0.3, q.z, distance(p.xz, q.xy))); }
    S += uFlashColor * min(fl, 1.5);
    float a = 1.0 - exp(-d * 5.0 * dt);
    col += T * a * S; T *= 1.0 - a;
  }
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0 - T);     // cor já multiplicada pela cobertura
}`;

// cola o alvo na tela com média de 4x4 pixels do alvo: anula exatamente o padrão 4x4 do passo deslocado
const BLIT_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTex; uniform vec2 uTexel;
varying vec2 vNdc;
void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  vec4 c = vec4(0.0);
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) c += texture2D(uTex, uv + uTexel * (vec2(float(i), float(j)) - 1.5));
  gl_FragColor = c / 16.0;
}`;

const SHADOW_VERT = /* glsl */`
varying vec2 vXZ;
void main() { vXZ = position.xz; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const SHADOW_FRAG = /* glsl */`
precision highp float;
${DENSITY}
uniform vec3 uSunDir; uniform float uStrength;
varying vec2 vXZ;
void main() {
  vec2 off = uSunDir.xz / max(uSunDir.y, 0.35) * 0.6;
  float hn, a = 0.0;
  vec2 q = vXZ + off * 5.0; vec4 f = fieldAt(q);
  a += cloudDensity(vec3(q.x, 4.9, q.y), f, false, 0.0, hn) * (1.0 + f.b);
  q = vXZ + off * 8.0; f = fieldAt(q);
  a += 0.6 * cloudDensity(vec3(q.x, 8.1, q.y), f, false, 0.0, hn);
  a = uStrength * min(a, 1.6);
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.01, 0.04, a);
}`;

const tri = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)); return g; };

export function createVolumeClouds({ renderer, grid, bounds }) {
  // ruído 3D
  const noise = makeCloudNoise(64);
  const noiseTex = new THREE.Data3DTexture(noise.data, noise.size, noise.size, noise.size);
  noiseTex.format = THREE.RGFormat; noiseTex.type = THREE.UnsignedByteType;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter; noiseTex.magFilter = THREE.LinearFilter; noiseTex.generateMipmaps = true;
  noiseTex.wrapS = noiseTex.wrapT = noiseTex.wrapR = THREE.RepeatWrapping; noiseTex.unpackAlignment = 1; noiseTex.needsUpdate = true;

  // campo do tempo assado em textura
  const { minX, maxX, minZ, maxZ } = bounds, N = FIELD_N;
  const fdata = new Uint8Array(N * N * 4), tower = new Float32Array(N * N), tmp = new Float32Array(N * N);
  const fieldTex = new THREE.DataTexture(fdata, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  fieldTex.minFilter = fieldTex.magFilter = THREE.LinearFilter; fieldTex.needsUpdate = true;
  const flon = new Float32Array(N * N), flat = new Float32Array(N * N), inside = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const ll = toLonLat(minX + ((i + 0.5) / N) * (maxX - minX), minZ + ((j + 0.5) / N) * (maxZ - minZ)), q = j * N + i;
    flon[q] = ll.lon; flat[q] = ll.lat; inside[q] = grid.distCells(ll.lon, ll.lat) <= 0.72 ? 1 : 0;   // só onde há dado
  }

  const flashes = []; for (let i = 0; i < MAX_FLASH; i++) flashes.push(new THREE.Vector4(0, 0, 1, 0));
  const shared = {
    uNoise: { value: noiseTex }, uField: { value: fieldTex }, uTime: { value: 0 },
    uB: { value: new THREE.Vector4(minX, minZ, 1 / (maxX - minX), 1 / (maxZ - minZ)) },
    uSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.3).normalize() },
  };
  const uniforms = {
    ...shared,
    uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() },
    uLit: { value: new THREE.Vector3(1, 1, 1) }, uShade: { value: new THREE.Vector3(0.62, 0.69, 0.82) },
    uFlashColor: { value: new THREE.Vector3(0.9, 0.93, 1.0) }, uFlash: { value: flashes },
    uBox: { value: new THREE.Vector4(minX, minZ, maxX, maxZ) }, uPix: { value: 0.002 }, uSteps: { value: 64 },
  };

  // passe do volume, em alvo de resolução reduzida
  const target = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const marchScene = new THREE.Scene(), marchCam = new THREE.Camera();
  const march = new THREE.Mesh(tri(), new THREE.ShaderMaterial({ uniforms, vertexShader: TRI_VERT, fragmentShader: MARCH_FRAG, depthTest: false, depthWrite: false, toneMapped: false }));
  march.frustumCulled = false; marchScene.add(march);

  // colagem na cena principal
  const blitUniforms = { uTex: { value: target.texture }, uTexel: { value: new THREE.Vector2() } };
  const mesh = new THREE.Mesh(tri(), new THREE.ShaderMaterial({
    uniforms: blitUniforms, vertexShader: TRI_VERT, fragmentShader: BLIT_FRAG, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  }));
  mesh.frustumCulled = false; mesh.renderOrder = 9; mesh.name = 'clouds-volume';

  // sombra no mapa
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute([minX, 0.04, minZ, maxX, 0.04, minZ, maxX, 0.04, maxZ, minX, 0.04, maxZ], 3));
  sg.setIndex([0, 2, 1, 0, 3, 2]);
  const shadowUniforms = { ...shared, uStrength: { value: 0.3 } };
  const shadow = new THREE.Mesh(sg, new THREE.ShaderMaterial({ uniforms: shadowUniforms, vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  shadow.frustumCulled = false; shadow.renderOrder = 2; shadow.name = 'cloud-shadows';

  let lastT = null, scale = 0.5, cirrus = null;
  const smp = {}, size = new THREE.Vector2();
  function update(field, t) {
    if (t === lastT) return;                                   // relógio parado: o campo não mudou
    lastT = t;
    for (let q = 0; q < N * N; q++) {
      let lowC = 0, midC = 0, dark = 0, tw = 0;
      if (inside[q]) {
        field.sample(flon[q], flat[q], t, smp);
        const r = field.rain(flon[q], flat[q], t), storm = field.storm(flon[q], flat[q], t);
        let c = smp.low;
        if (r > 0 && c < RAIN_MIN_LOW) c = RAIN_MIN_LOW;       // não chove de céu limpo
        lowC = clamp((c - MIN_COVER) / (100 - MIN_COVER), 0, 1);
        midC = clamp((smp.mid - MIN_COVER) / (100 - MIN_COVER), 0, 1);
        dark = storm ? 1 : r > 0 ? 0.45 + 0.55 * clamp(r / 8, 0, 1) : 0;   // escuro avaliado onde a nuvem está
        tw = storm ? 1 : 0;
      }
      fdata[q * 4] = lowC * 255; fdata[q * 4 + 1] = midC * 255; fdata[q * 4 + 2] = dark * 255; tower[q] = tw;
    }
    for (let pass = 0; pass < 2; pass++) {                     // torre com borda suave (senão vira um paredão quadrado)
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj;
          if (a >= 0 && a < N && b >= 0 && b < N) { s += tower[b * N + a]; n++; }
        }
        tmp[j * N + i] = s / n;
      }
      tower.set(tmp);
    }
    for (let q = 0; q < N * N; q++) fdata[q * 4 + 3] = tower[q] * 255;
    fieldTex.needsUpdate = true;
  }

  function frame(now, camera) {
    shared.uTime.value = now;
    renderer.getDrawingBufferSize(size);
    const w = Math.max(2, Math.round(size.x * scale)), h = Math.max(2, Math.round(size.y * scale));
    if (target.width !== w || target.height !== h) { target.setSize(w, h); blitUniforms.uTexel.value.set(1 / w, 1 / h); }
    camera.updateMatrixWorld();
    uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
    uniforms.uCamWorld.value.copy(camera.matrixWorld);
    uniforms.uCam.value.setFromMatrixPosition(camera.matrixWorld);
    uniforms.uPix.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / h;
    // ordem de desenho sem buffer de profundidade: a chuva vive abaixo da base e os cirros acima do topo,
    // então basta saber de que lado a câmera está
    const y = uniforms.uCam.value.y;
    if (y < 4) { mesh.renderOrder = 4; if (cirrus) cirrus.renderOrder = 3; }          // por baixo: cirros, volume, chuva
    else if (y < 10) { mesh.renderOrder = 11; if (cirrus) cirrus.renderOrder = 10; }  // no meio: chuva, cirros, volume
    else { mesh.renderOrder = 9; if (cirrus) cirrus.renderOrder = 10; }               // por cima: chuva, volume, cirros
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(marchScene, marchCam);
    renderer.setRenderTarget(prev);
  }

  return {
    mesh, shadow, update, frame,
    setCirrus(m) { cirrus = m; },
    visibleCount: () => 0,
    setFlashes(list) { for (let i = 0; i < MAX_FLASH; i++) { const f = list[i]; if (f) flashes[i].set(f.x, f.z, f.radius, f.intensity); else flashes[i].w = 0; } },
    setSky(sky) {
      shared.uSunDir.value.fromArray(sky.sunDir);
      uniforms.uLit.value.fromArray(sky.cloudLit); uniforms.uShade.value.fromArray(sky.cloudShade);
      shadowUniforms.uStrength.value = 0.3 - 0.12 * sky.night;
    },
    // alto: metade da resolução e 64 passos; baixo: um terço e 32 passos
    setQuality(q) { const k = clamp((q.slots - 0.4) / 0.6, 0, 1); scale = 0.33 + 0.17 * k; uniforms.uSteps.value = Math.round(32 + 32 * k); shadow.visible = q.shadows !== false; },
  };
}
