// PROTÓTIPO (?nuvens=volume): todas as camadas de nuvem como volume de verdade (raymarching).
// - O WeatherField é "assado" numa textura 2D pequena (cobertura baixa, média, escurecimento, torre) a ~10 Hz.
// - Um ruído 3D dá a forma; a cobertura do dado é o limiar: mais cobertura = mais nuvem. Nada abaixo de 15%.
// - O volume é marchado em resolução reduzida num alvo próprio e colado por cima da cena.
// Mesmas regras de dado das outras nuvens: mínimo de 60% na baixa onde chove, cinza onde chove, chumbo e torre onde troveja.
import * as THREE from 'three';
import { toLonLat } from '../geo/projection.js';
import { clamp } from '../util/rng.js';
import { makeCloudNoise, makeNoiseChannel, interleave } from './cloud-noise.js';

const MAX_FLASH = 8, FIELD_N = 64;
const MIN_COVER = 15, RAIN_MIN_LOW = 60;
const Y0 = 3.9, Y1 = 13.2;                       // fatia vertical onde pode haver nuvem
const ANVIL_Y0 = 11.0, ANVIL_Y1 = 12.9;          // bigorna do cumulonimbus
const CIRRUS_Y0 = 9.7, CIRRUS_Y1 = 10.6;         // cirros
const VMAX = 0.09, PERIOD = 40;                  // vento: velocidade máxima na cena (unidades/s) e ciclo do arrasto (s)
const ALPHA = 0.1;                               // peso do quadro novo no acúmulo temporal

// Densidade: compartilhada entre o volume e a sombra no mapa.
const DENSITY = /* glsl */`
precision highp sampler3D;
uniform sampler3D uNoise;
uniform sampler2D uField, uField2;
uniform vec4 uB;          // minX, minZ, 1/largura, 1/profundidade
uniform float uPhase;     // 0..1, ciclo do vento local
uniform vec2 uDrift;      // deslocamento acumulado pelo vento médio
vec4 fieldAt(vec2 xz) { return textureLod(uField, (xz - uB.xy) * uB.zw, 0.0); }      // r baixa, g média, b bigorna, a torre
vec4 field2At(vec2 xz) {                                                              // vento x, vento z (cena/s), escuro, alta
  vec4 g = textureLod(uField2, (xz - uB.xy) * uB.zw, 0.0);
  return vec4((g.xy * 2.0 - 1.0) * ${VMAX}, g.zw);
}
vec2 regionAt(vec2 xz) { return textureLod(uNoise, vec3(xz / 61.0, 0.31), 0.0).rg; }  // cada nuvem com sua base e sua altura
// borda desfiada em duas escalas. O mip sobe com a distância: de longe o fiapo fino some em vez de virar pontilhado
float erode(float b, vec3 q, float lod) {
  float e = 0.62 * textureLod(uNoise, q, lod).g + 0.38 * textureLod(uNoise, q * 2.7 + 0.37, lod + 1.4).g;
  e *= 0.55 * (1.0 - 0.5 * b);
  return clamp((b - e) / (1.0 - e), 0.0, 1.0);
}
// f, g, v = campo, vento+escuro+alta e variação regional no ponto.
// hn = altura normalizada dentro da nuvem (luz ambiente); thin = quanto da densidade é cirro (não escurece com a chuva)
float cloudDensity(vec3 p, vec4 f, vec4 g, vec2 v, bool fine, float lod, out float hn, out float thin) {
  hn = 0.5; thin = 0.0;
  float d = 0.0;
  vec3 D = vec3(uDrift.x, 0.0, uDrift.y);
  if (f.r > 0.004) {                                                  // camada baixa: cúmulos
    float base = 4.0 + 0.9 * v.y * (1.0 - smoothstep(0.0, 0.4, g.z)); // onde chove a base desce até o topo da chuva
    float H = mix((1.3 + 3.4 * f.r) * (0.4 + 1.2 * v.x) + 1.3 * g.z, 8.2, f.a);   // torre: sempre até a bigorna
    float h = (p.y - base) / H;
    if (h > 0.0 && h < 1.0) {
      // vento local: a forma grande é arrastada pelo vento DAQUELE ponto, em dois ciclos defasados que se revezam
      // (assim o arrasto nunca acumula e a nuvem não estica sem fim)
      vec3 W = vec3(g.x, 0.0, g.y) * ${PERIOD.toFixed(1)};
      float wa = 1.0 - abs(2.0 * uPhase - 1.0);
      float big = mix(textureLod(uNoise, (p - W * (fract(uPhase + 0.5) - 0.5)) / 26.0, 0.0).r, textureLod(uNoise, (p - W * (uPhase - 0.5)) / 26.0, 0.0).r, wa);
      // bolhas grandes + torres menores por cima (o que dá o topo desigual)
      float s = 0.5 + 1.3 * (mix(big, textureLod(uNoise, (p - D + 5.1) / 10.0, 0.0).r, 0.35) - 0.5);
      // o limiar sobe com a altura: a nuvem afina para cima e cada bolha chega a uma altura diferente;
      // e fecha em 1 na base, para a base não ser um plano cortado a régua
      float need = 1.0 - min(1.0, 1.12 * pow(f.r, 0.75));
      need += (1.0 - need) * max(pow(h, 1.4) * (1.0 - 0.45 * f.a), 1.0 - smoothstep(0.0, 0.14, h));
      float b = clamp((s - need) / 0.13, 0.0, 1.0);
      if (b > 0.0) { if (fine) b = erode(b, (p - D * 1.6) / 8.0, lod); d += b; hn = h; }
    }
  }
  if (f.g > 0.004) {                                                  // camada média: altocúmulos, finos e miúdos
    float base = 7.7 + 0.9 * v.x;
    float H = (0.5 + 0.9 * f.g) * (0.6 + 0.8 * v.y);
    float h = (p.y - base) / H;
    if (h > 0.0 && h < 1.0) {
      float s = textureLod(uNoise, (p * vec3(1.0, 2.0, 1.0) - D * 1.5 + 11.3) / 15.0, 0.0).r;
      float need = 1.0 - 0.85 * f.g;
      need += (1.0 - need) * pow(abs(h - 0.4) / 0.6, 1.6);
      float b = clamp((s - need) / 0.25, 0.0, 1.0);
      if (b > 0.0) { if (fine) b = erode(b, (p - D * 2.0) / 6.0, lod); if (b * 0.6 > d) hn = h; d += b * 0.6; }
    }
  }
  if (f.b > 0.02) {                                                   // bigorna: lençol largo e achatado no topo da torre
    float h = (p.y - ${ANVIL_Y0.toFixed(1)}) / ${(ANVIL_Y1 - ANVIL_Y0).toFixed(1)};
    if (h > 0.0 && h < 1.0) {
      float s = textureLod(uNoise, (p * vec3(1.0, 2.5, 1.0) - D * 0.5 + 31.7) / 22.0, 0.0).r;
      float need = 1.0 - min(1.0, 1.3 * f.b);
      need += (1.0 - need) * pow(abs(h - 0.45) / 0.55, 2.0);
      float b = clamp((s - need) / 0.3, 0.0, 1.0);
      if (b > 0.0) { if (fine) b = erode(b, (p - D * 0.8) / 9.0, lod); if (b * 0.8 > d) hn = 0.85; d += b * 0.8; }
    }
  }
  if (g.w > 0.004) {                                                  // camada alta: cirros, véu fino e esticado
    float h = (p.y - ${CIRRUS_Y0.toFixed(1)}) / ${(CIRRUS_Y1 - CIRRUS_Y0).toFixed(1)};
    if (h > 0.0 && h < 1.0) {
      vec3 q = p - D * 2.2;
      float s = textureLod(uNoise, vec3(q.x * 0.45 + q.z * 0.25, q.y * 3.0, q.z - q.x * 0.3) / 24.0 + 0.61, 0.0).r;
      float need = 1.0 - 0.9 * g.w;
      need += (1.0 - need) * pow(abs(2.0 * h - 1.0), 2.0);
      float b = clamp((s - need) / 0.4, 0.0, 1.0);
      if (b > 0.0) {
        // fiapos: ruído bem esticado numa direção
        if (fine) b *= 0.35 + 0.65 * textureLod(uNoise, vec3(q.x * 0.12 + q.z * 0.07, q.y, q.z - q.x * 0.5) / 5.0, lod + 0.5).g;
        b *= 0.16;
        thin = b / (d + b + 1e-4); if (d < 0.02) hn = 1.0;
        d += b;
      }
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
uniform float uSub;       // subfase do passo deste quadro
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
  // início do raio deslocado em 9 fases num padrão 3x3, mais 4 subfases que se revezam a cada quadro:
  // a média 3x3 no espaço e o acúmulo no tempo somam 36 fases e apagam o degrau do passo
  ivec2 bp = ivec2(gl_FragCoord.xy) % 3;
  const int ORDER[9] = int[9](0, 5, 7, 3, 8, 1, 6, 2, 4);
  float jit = (float(ORDER[bp.x + bp.y * 3]) + uSub) / 9.0;
  float t = t0 * (1.0 + k * jit);
  float T = 1.0; vec3 col = vec3(0.0);
  float mu = dot(rd, uSunDir);
  float fwd = 0.35 * pow(max(mu, 0.0), 6.0) + 0.12 * (0.5 + 0.5 * mu);      // contra o sol a borda acende
  for (int i = 0; i < 96; i++) {
    if (i >= uSteps || T < 0.02) break;
    float dt = t * k, ts = t;
    t += dt;
    vec3 pm = ro + rd * (ts + 0.5 * dt);
    vec4 f = fieldAt(pm.xz);
    vec4 g = field2At(pm.xz);
    if (max(max(f.r, f.g), max(f.b, g.w)) < 0.004) continue;      // céu limpo: passo largo e barato
    vec2 v = regionAt(pm.xz);
    // onde há nuvem o passo largo é dividido em até 4: sem isso a nuvem fica opaca num passo só
    // e a superfície aparece em degraus (as faixas em vista rasante)
    int nsub = int(clamp(ceil(dt / 0.3), 1.0, 4.0));
    float sdt = dt / float(nsub);
    float lod = clamp(log2(ts * uPix / 0.125) + 1.5, 0.0, 5.0);
    for (int j = 0; j < 4; j++) {
      if (j >= nsub || T < 0.02) break;
      vec3 p = ro + rd * (ts + (float(j) + 0.5) * sdt);
      float hn, thin, th1;
      float d = cloudDensity(p, f, g, v, true, lod, hn, thin);
      if (d <= 0.003) continue;
      // sombra própria: duas amostras na direção do sol
      float h1, h2;
      float d1 = cloudDensity(p + uSunDir * 0.5, f, g, v, false, 0.0, h1, th1), d2 = cloudDensity(p + uSunDir * 1.5, f, g, v, false, 0.0, h2, th1);
      float sun = exp(-(0.3 * d + 1.3 * d1 + 2.2 * d2));
      float amb = mix(0.42, 1.0, hn);
      float dk = g.z * (1.0 - thin);
      vec3 lit = uLit * mix(1.0, 0.36, dk), shade = uShade * mix(1.0, 0.3, dk);
      vec3 S = mix(shade * amb, lit, sun * (0.82 + fwd)) + lit * fwd * sun * 0.6;
      float fl = 0.0;
      for (int q = 0; q < ${MAX_FLASH}; q++) { vec4 fq = uFlash[q]; fl += fq.w * (1.0 - smoothstep(fq.z * 0.3, fq.z, distance(p.xz, fq.xy))); }
      S += uFlashColor * min(fl, 1.5);
      float a = 1.0 - exp(-d * 5.0 * sdt);
      col += T * a * S; T *= 1.0 - a;
    }
  }
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0 - T);     // cor já multiplicada pela cobertura
}`;

// Acúmulo no tempo: média 3x3 do quadro atual (anula o padrão do passo deslocado) misturada com o histórico.
// O histórico é buscado onde aquele ponto estava no quadro anterior e limitado à faixa de valores (média ± desvio) da vizinhança atual,
// então câmera em movimento ou nuvem mudando não deixam rastro.
const RESOLVE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uCur, uHist; uniform vec2 uTexel;
uniform mat4 uProjInv, uCamWorld, uPrevVP; uniform vec3 uCam; uniform float uAlpha;
varying vec2 vNdc;
void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  // média da vizinhança 3x3: anula exatamente o padrão 3x3 do passo deslocado
  vec4 box = vec4(0.0), sq = vec4(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec4 c = texture2D(uCur, uv + uTexel * vec2(float(i), float(j)));
    box += c; sq += c * c;
  }
  box /= 9.0;
  vec4 dev = 1.25 * sqrt(max(sq / 9.0 - box * box, 0.0)) + 0.004;    // faixa = média ± desvio da vizinhança (varia suave, não deixa blocos)
  // ponto de referência no meio da camada de nuvens, reprojetado na câmera do quadro anterior
  vec4 v4 = uProjInv * vec4(vNdc, 1.0, 1.0);
  vec3 rd = normalize(mat3(uCamWorld) * (v4.xyz / v4.w));
  float tc = (5.5 - uCam.y) / (abs(rd.y) < 1e-4 ? 1e-4 : rd.y);
  vec4 clip = uPrevVP * vec4(uCam + rd * (tc > 0.5 ? min(tc, 70.0) : 25.0), 1.0);
  vec2 huv = clip.xy / clip.w * 0.5 + 0.5;
  float a = uAlpha;
  if (clip.w <= 0.0 || huv.x < 0.0 || huv.y < 0.0 || huv.x > 1.0 || huv.y > 1.0) a = 1.0;
  gl_FragColor = mix(clamp(texture2D(uHist, huv), box - dev, box + dev), box, a);
}`;

const BLIT_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTex;
varying vec2 vNdc;
void main() { gl_FragColor = texture2D(uTex, vNdc * 0.5 + 0.5); }`;

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
  float hn, th, a = 0.0;
  vec2 q = vXZ + off * 5.0; vec4 f = fieldAt(q); vec4 g = field2At(q); vec2 v = regionAt(q);
  a += cloudDensity(vec3(q.x, 4.9, q.y), f, g, v, false, 0.0, hn, th) * (1.0 + g.z);
  q = vXZ + off * 8.0; f = fieldAt(q); g = field2At(q); v = regionAt(q);
  a += 0.6 * cloudDensity(vec3(q.x, 8.1, q.y), f, g, v, false, 0.0, hn, th);
  a = uStrength * min(a, 1.6);
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.01, 0.04, a);
}`;

/** Gera o ruído 3D em dois workers, um por canal (a carga não espera na thread principal); sem worker, gera aqui mesmo. */
export function startCloudNoise(size = 64, seed = 7) {
  const channel = (kind) => new Promise((resolve) => {
    try {
      const w = new Worker(new URL('./cloud-noise-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => { resolve(e.data); w.terminate(); };
      w.onerror = () => { w.terminate(); resolve(makeNoiseChannel(kind, size, seed)); };
      w.postMessage({ kind, size, seed });
    } catch { resolve(makeNoiseChannel(kind, size, seed)); }
  });
  return Promise.all([channel('shape'), channel('detail')]).then(([a, b]) => interleave(a, b, size));
}

const tri = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)); return g; };

export function createVolumeClouds({ renderer, grid, bounds, noise = makeCloudNoise(64) }) {
  // ruído 3D
  const noiseTex = new THREE.Data3DTexture(noise.data, noise.size, noise.size, noise.size);
  noiseTex.format = THREE.RGFormat; noiseTex.type = THREE.UnsignedByteType;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter; noiseTex.magFilter = THREE.LinearFilter; noiseTex.generateMipmaps = true;
  noiseTex.wrapS = noiseTex.wrapT = noiseTex.wrapR = THREE.RepeatWrapping; noiseTex.unpackAlignment = 1; noiseTex.needsUpdate = true;

  // campo do tempo assado em duas texturas: (baixa, média, bigorna, torre) e (vento x, vento z, escuro)
  const { minX, maxX, minZ, maxZ } = bounds, N = FIELD_N;
  const fdata = new Uint8Array(N * N * 4), gdata = new Uint8Array(N * N * 4), tower = new Float32Array(N * N), tmp = new Float32Array(N * N);
  const mkTex = (d) => { const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.UnsignedByteType); t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
  for (let q = 0; q < N * N; q++) { gdata[q * 4] = 128; gdata[q * 4 + 1] = 128; }
  const fieldTex = mkTex(fdata), field2Tex = mkTex(gdata);
  const flon = new Float32Array(N * N), flat = new Float32Array(N * N), inside = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const ll = toLonLat(minX + ((i + 0.5) / N) * (maxX - minX), minZ + ((j + 0.5) / N) * (maxZ - minZ)), q = j * N + i;
    flon[q] = ll.lon; flat[q] = ll.lat; inside[q] = grid.distCells(ll.lon, ll.lat) <= 0.72 ? 1 : 0;   // só onde há dado
  }
  function blur(passes) {
    for (let pass = 0; pass < passes; pass++) {
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
  }

  const flashes = []; for (let i = 0; i < MAX_FLASH; i++) flashes.push(new THREE.Vector4(0, 0, 1, 0));
  const shared = {
    uNoise: { value: noiseTex }, uField: { value: fieldTex }, uField2: { value: field2Tex },
    uPhase: { value: 0 }, uDrift: { value: new THREE.Vector2() },
    uB: { value: new THREE.Vector4(minX, minZ, 1 / (maxX - minX), 1 / (maxZ - minZ)) },
    uSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.3).normalize() },
  };
  const camUniforms = { uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() } };
  const uniforms = {
    ...shared, ...camUniforms,
    uLit: { value: new THREE.Vector3(1, 1, 1) }, uShade: { value: new THREE.Vector3(0.62, 0.69, 0.82) },
    uFlashColor: { value: new THREE.Vector3(0.9, 0.93, 1.0) }, uFlash: { value: flashes },
    uBox: { value: new THREE.Vector4(minX, minZ, maxX, maxZ) }, uPix: { value: 0.002 }, uSteps: { value: 64 }, uSub: { value: 0.5 },
  };

  // três alvos em resolução reduzida: o quadro marchado e dois de acúmulo que se revezam.
  // O acúmulo precisa de mais que 8 bits (senão a média trava a alguns níveis do valor certo e sobra um chuvisco parado).
  const float16 = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const mkTarget = (type) => new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type });
  const target = mkTarget(THREE.UnsignedByteType);
  const acc = [0, 1].map(() => mkTarget(float16 ? THREE.HalfFloatType : THREE.UnsignedByteType));
  const pass = (frag, u) => {
    const sc = new THREE.Scene(), m = new THREE.Mesh(tri(), new THREE.ShaderMaterial({ uniforms: u, vertexShader: TRI_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, toneMapped: false }));
    m.frustumCulled = false; sc.add(m); return sc;
  };
  const passCam = new THREE.Camera();
  const marchScene = pass(MARCH_FRAG, uniforms);
  const resolveUniforms = { ...camUniforms, uCur: { value: target.texture }, uHist: { value: acc[0].texture }, uTexel: { value: new THREE.Vector2() }, uPrevVP: { value: new THREE.Matrix4() }, uAlpha: { value: 1 } };
  const resolveScene = pass(RESOLVE_FRAG, resolveUniforms);

  // colagem na cena principal
  const blitUniforms = { uTex: { value: acc[0].texture } };
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

  let lastT = null, scale = 0.75, lastNow = 0, frameNo = 0, write = 0, fresh = true, meanX = 0, meanZ = 0;
  const smp = {}, size = new THREE.Vector2(), ref = new THREE.Vector3();
  function update(field, t) {
    if (t === lastT) return;                                   // relógio parado: o campo não mudou
    lastT = t;
    let sx = 0, sz = 0, n = 0;
    for (let q = 0; q < N * N; q++) {
      let lowC = 0, midC = 0, highC = 0, dark = 0, tw = 0, wx = 0, wz = 0;
      if (inside[q]) {
        field.sample(flon[q], flat[q], t, smp);
        const r = field.rain(flon[q], flat[q], t), storm = field.storm(flon[q], flat[q], t);
        let c = smp.low;
        if (r > 0 && c < RAIN_MIN_LOW) c = RAIN_MIN_LOW;       // não chove de céu limpo
        lowC = clamp((c - MIN_COVER) / (100 - MIN_COVER), 0, 1);
        midC = clamp((smp.mid - MIN_COVER) / (100 - MIN_COVER), 0, 1);
        highC = clamp((smp.high - MIN_COVER) / (100 - MIN_COVER), 0, 1);
        dark = storm ? 1 : r > 0 ? 0.45 + 0.55 * clamp(r / 8, 0, 1) : 0;   // escuro avaliado onde a nuvem está
        tw = storm ? 1 : 0;
        // vento do dado: para onde sopra (leste = +x, norte = -z), velocidade cheia a partir de 40 km/h
        if (smp.speed > 0.01) { const k = Math.min(1, smp.speed / 40) / smp.speed; wx = smp.u * k; wz = -smp.v * k; }
        sx += wx; sz += wz; n++;
      }
      fdata[q * 4] = lowC * 255; fdata[q * 4 + 1] = midC * 255; tower[q] = tw;
      gdata[q * 4] = 127.5 + 127.5 * wx; gdata[q * 4 + 1] = 127.5 + 127.5 * wz; gdata[q * 4 + 2] = dark * 255; gdata[q * 4 + 3] = highC * 255;
    }
    meanX = n ? (sx / n) * VMAX : 0; meanZ = n ? (sz / n) * VMAX : 0;
    blur(2);                                                   // torre com borda suave (senão vira um paredão quadrado)
    for (let q = 0; q < N * N; q++) fdata[q * 4 + 3] = tower[q] * 255;
    blur(4);                                                   // a bigorna transborda para além da célula de trovoada
    for (let q = 0; q < N * N; q++) fdata[q * 4 + 2] = Math.min(1, tower[q] * 1.8) * 255;
    fieldTex.needsUpdate = true; field2Tex.needsUpdate = true;
  }

  function frame(now, camera) {
    const dt = lastNow ? Math.min(now - lastNow, 0.1) : 0;
    lastNow = now;
    shared.uPhase.value = (shared.uPhase.value + dt / PERIOD) % 1;
    shared.uDrift.value.x += meanX * dt; shared.uDrift.value.y += meanZ * dt;
    renderer.getDrawingBufferSize(size);
    const w = Math.max(2, Math.round(size.x * scale)), h = Math.max(2, Math.round(size.y * scale));
    if (target.width !== w || target.height !== h) {
      target.setSize(w, h); acc[0].setSize(w, h); acc[1].setSize(w, h);
      resolveUniforms.uTexel.value.set(1 / w, 1 / h); fresh = true;
    }
    camera.updateMatrixWorld();
    camUniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
    camUniforms.uCamWorld.value.copy(camera.matrixWorld);
    camUniforms.uCam.value.setFromMatrixPosition(camera.matrixWorld);
    uniforms.uPix.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / h;
    frameNo = (frameNo + 1) % 4096;
    uniforms.uSub.value = [0, 0.5, 0.25, 0.75][frameNo & 3];
    // ordem de desenho sem buffer de profundidade: a chuva e os raios vivem abaixo da base das nuvens,
    // então basta saber se a câmera está abaixo dela (volume antes da chuva) ou acima (volume depois)
    mesh.renderOrder = camUniforms.uCam.value.y < 4 ? 4 : 9;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(marchScene, passCam);
    const read = write; write = 1 - write;
    resolveUniforms.uHist.value = acc[read].texture;
    // quanto a imagem andou desde o quadro anterior (em pixels do alvo, medido num ponto à frente da câmera):
    // parada, acumula bastante; girando rápido, confia no quadro atual
    ref.set(0, 0, -40).applyMatrix4(camera.matrixWorld);
    const cur = ref.clone().project(camera), old = ref.applyMatrix4(resolveUniforms.uPrevVP.value);
    const moved = Math.hypot((cur.x - old.x) * w, (cur.y - old.y) * h) / 2;
    const base = float16 ? ALPHA : 0.25;
    resolveUniforms.uAlpha.value = fresh ? 1 : clamp(base + (moved - 0.5) / 6, base, 1);   // sem histórico válido: só o quadro atual
    renderer.setRenderTarget(acc[write]);
    renderer.render(resolveScene, passCam);
    renderer.setRenderTarget(prev);
    blitUniforms.uTex.value = acc[write].texture;
    resolveUniforms.uPrevVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    fresh = false;
  }

  return {
    mesh, shadow, update, frame, objects: [shadow, mesh],
    visibleCount: () => 0,
    info: () => `volume ${target.width}×${target.height} · ${uniforms.uSteps.value} passos`,
    setFlashes(list) { for (let i = 0; i < MAX_FLASH; i++) { const f = list[i]; if (f) flashes[i].set(f.x, f.z, f.radius, f.intensity); else flashes[i].w = 0; } },
    setSky(sky) {
      shared.uSunDir.value.fromArray(sky.sunDir);
      uniforms.uLit.value.fromArray(sky.cloudLit); uniforms.uShade.value.fromArray(sky.cloudShade);
      shadowUniforms.uStrength.value = 0.3 - 0.12 * sky.night;
    },
    // alto: 75% da resolução e 64 passos; baixo: metade e 40 passos
    setQuality(q) { const k = clamp((q.slots - 0.4) / 0.6, 0, 1); scale = 0.5 + 0.25 * k; uniforms.uSteps.value = Math.round(40 + 24 * k); shadow.visible = q.shadows !== false; },
  };
}
