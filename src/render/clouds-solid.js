// Nuvens sólidas de maquete: blobs 3D instanciados (esfera deformada), opacos, base achatada,
// iluminados pela direção do sol da linha do tempo. Opacos = sem ordenação e sem overdraw de transparência.
// Mesma regra de dado das nuvens em sprite: limiar u por slot, nada abaixo de 15% de cobertura,
// cobertura mínima de 60% na camada baixa onde chove, escurecimento por rain() onde o puff está.
import * as THREE from 'three';
import { toLonLat, CELL_X, CELL_Z } from '../geo/projection.js';
import { clamp, smoothstep, mulberry32 } from '../util/rng.js';
import { SOLID_LAYERS, solidPuffShape, towerLevels } from './cloud-shape.js';

const MAX_FLASH = 8;
const ORBIT_AMP = 0.35 * (CELL_X + CELL_Z) / 2;
const MIN_COVER = 15, RAIN_MIN_LOW = 60, FADE = 0.1;

/** O icosaedro do Three.js vem sem índice (um vértice por face): junta os vértices iguais. */
function indexed(g) {
  const src = g.getAttribute('position'), map = new Map(), pos = [], idx = [];
  for (let i = 0; i < src.count; i++) {
    const key = `${src.getX(i).toFixed(4)},${src.getY(i).toFixed(4)},${src.getZ(i).toFixed(4)}`;
    let j = map.get(key);
    if (j === undefined) { j = pos.length / 3; map.set(key, j); pos.push(src.getX(i), src.getY(i), src.getZ(i)); }
    idx.push(j);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}

/** Cacho de bolhas (couve-flor): base larga, bolhas menores em cima. Unidade: ~1 de raio, ~1,1 de altura. */
const BUBBLES = [
  [0, 0.12, 0, 0.6], [0.56, 0, 0.12, 0.44], [-0.52, 0.02, -0.14, 0.47], [0.08, 0.04, 0.56, 0.42], [-0.12, 0, -0.56, 0.4],
  [0.16, 0.58, 0.06, 0.42], [-0.22, 0.48, -0.12, 0.36], [0.3, 0.32, -0.36, 0.34],
];
function cumulusGeometry() {
  const unit = indexed(new THREE.IcosahedronGeometry(1, 2)), up = unit.getAttribute('position'), ui = unit.index.array;
  const pos = [], nor = [], idx = [];
  for (const [cx, cy, cz, r] of BUBBLES) {
    const off = pos.length / 3;
    for (let i = 0; i < up.count; i++) {
      const x = up.getX(i), y = up.getY(i), z = up.getZ(i);
      pos.push(cx + x * r, cy + y * r, cz + z * r);
      nor.push(x, y, z);                                     // esfera: normal = direção do centro
    }
    for (let i = 0; i < ui.length; i++) idx.push(off + ui[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

const VERT = /* glsl */`
attribute vec3 aPos;    // centro do slot (y = base da nuvem)
attribute vec4 aShape;  // raio, altura, semente, -
attribute vec4 aState;  // -, escurecimento, -, -
attribute vec4 aWind;   // amplitude x, amplitude z, fase em uT0, velocidade angular
uniform float uTime, uT0, uPuff;
uniform vec4 uFlash[${MAX_FLASH}];
varying vec3 vN; varying vec3 vW; varying float vDark; varying float vFlash; varying float vBottom; varying float vAO;
void main() {
  float ph = aWind.z + aWind.w * (uTime - uT0);
  vec2 amp = aWind.xy, perp = vec2(-amp.y, amp.x) * 0.3;
  vec3 c = aPos;
  c.xz += amp * cos(ph) + perp * sin(ph);
  float a = aShape.z * 6.2831853;
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec3 s = vec3(aShape.x, aShape.y, aShape.x) * uPuff;
  vec3 p = position; p.xz = R * p.xz;
  vec3 n = normal;   n.xz = R * n.xz;
  vAO = clamp(0.45 + 0.6 * position.y, 0.0, 1.0);            // dobras de baixo do cacho mais escuras
  vec3 w = c + p * s + vec3(0.0, s.y * 0.3, 0.0);    // o cacho fica quase todo acima da base…
  vBottom = 0.0;
  if (w.y < c.y) { w.y = c.y; vBottom = 1.0; }          // …e o que sobra embaixo vira base chata
  vN = normalize(n / max(s, vec3(1e-3)));
  vW = w;
  vDark = aState.y;
  float f = 0.0;
  for (int i = 0; i < ${MAX_FLASH}; i++) {
    vec4 fl = uFlash[i];
    f += fl.w * (1.0 - smoothstep(fl.z * 0.3, fl.z, distance(c.xz, fl.xy)));
  }
  vFlash = f;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const FRAG = /* glsl */`
uniform vec3 uSunDir, uLit, uShade, uDarkLit, uDarkShade, uFlashColor;
varying vec3 vN; varying vec3 vW; varying float vDark; varying float vFlash; varying float vBottom; varying float vAO;
void main() {
  vec3 n = normalize(vN);
  n = normalize(mix(n, vec3(0.0, -1.0, 0.0), vBottom));
  float wrap = clamp((dot(n, uSunDir) + 0.3) / 1.3, 0.0, 1.0);   // luz "envolvente": nuvem não tem lado preto
  float sky = 0.5 + 0.5 * n.y;
  float light = clamp(wrap * 0.8 + sky * 0.25 - 0.1, 0.0, 1.0);
  light = light * light * (3.0 - 2.0 * light);
  light *= mix(0.55, 1.0, vAO);
  vec3 lit = mix(uLit, uDarkLit, vDark), shade = mix(uShade, uDarkShade, vDark);
  vec3 col = mix(shade, lit, light);
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col += rim * 0.16 * lit * (1.0 - vBottom);                       // borda clara, cara de algodão
  float back = max(dot(-V, uSunDir), 0.0);                          // contra o sol: borda acesa (silver lining)
  float edge = pow(1.0 - max(dot(n, V), 0.0), 1.6);
  col += uLit * edge * back * back * 0.75 * (1.0 - vBottom) * (1.0 - 0.6 * vDark);
  col += uFlashColor * min(vFlash, 1.5);
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}`;
// sombra no mapa: disco suave sob cada puff, deslocado pela direção do sol
const SHADOW_VERT = /* glsl */`
attribute vec3 aPos; attribute vec4 aShape; attribute vec4 aState; attribute vec4 aWind;
uniform float uTime, uT0, uPuff, uStrength; uniform vec3 uSunDir;
varying vec2 vUv; varying float vAlpha;
void main() {
  float ph = aWind.z + aWind.w * (uTime - uT0);
  vec2 amp = aWind.xy, perp = vec2(-amp.y, amp.x) * 0.3;
  float h = aPos.y + aShape.y * uPuff;
  vec2 c = aPos.xz + amp * cos(ph) + perp * sin(ph) - uSunDir.xz / max(uSunDir.y, 0.35) * h * 0.6;
  float size = aShape.x * uPuff * 2.4;
  vUv = uv;
  vAlpha = uStrength * (1.0 + aState.y) * min(1.0, aShape.y / max(aShape.x, 1e-3) + 0.3);
  gl_Position = projectionMatrix * viewMatrix * vec4(c.x + position.x * size, 0.04, c.y + position.y * size, 1.0);
}`;
const SHADOW_FRAG = /* glsl */`
varying vec2 vUv; varying float vAlpha;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = vAlpha * (1.0 - smoothstep(0.2, 1.0, r));
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.01, 0.04, a);
}`;

export function createSolidClouds({ slotsByLayer, quality = { slots: 1, puff: 1 } }) {
  const N = slotsByLayer.reduce((s, a) => s + a.length / 5, 0);
  const sx = new Float32Array(N), sy = new Float32Array(N), sz = new Float32Array(N), ssize = new Float32Array(N), sseed = new Float32Array(N);
  const su = new Float32Array(N), slon = new Float32Array(N), slat = new Float32Array(N), slayer = new Uint8Array(N), srank = new Float32Array(N);
  const phase = new Float32Array(N), omega = new Float32Array(N);
  let n = 0;
  slotsByLayer.forEach((arr, li) => {
    const L = SOLID_LAYERS[li], cnt = arr.length / 5;
    for (let i = 0; i < cnt; i++, n++) {
      sx[n] = arr[i * 5]; sz[n] = arr[i * 5 + 1]; ssize[n] = arr[i * 5 + 2]; sseed[n] = arr[i * 5 + 3]; su[n] = arr[i * 5 + 4];
      sy[n] = L.y + (sseed[n] * 2 - 1) * L.yJit; slayer[n] = li; srank[n] = i / cnt;
      const ll = toLonLat(sx[n], sz[n]); slon[n] = ll.lon; slat[n] = ll.lat;
      phase[n] = sseed[n] * Math.PI * 2;
    }
  });

  const CAP = N * 2;                                             // espaço para os níveis extras das torres
  const mk = (size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(CAP * size), size); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const aPos = mk(3), aShape = mk(4), aState = mk(4), aWind = mk(4);
  const sphere = cumulusGeometry(), geom = new THREE.InstancedBufferGeometry();
  geom.setIndex(sphere.index);
  geom.setAttribute('position', sphere.getAttribute('position'));
  geom.setAttribute('normal', sphere.getAttribute('normal'));
  const quad = new THREE.PlaneGeometry(1, 1), sgeom = new THREE.InstancedBufferGeometry();
  sgeom.setIndex(quad.index);
  sgeom.setAttribute('position', quad.getAttribute('position'));
  sgeom.setAttribute('uv', quad.getAttribute('uv'));
  for (const g of [geom, sgeom]) { g.setAttribute('aPos', aPos); g.setAttribute('aShape', aShape); g.setAttribute('aState', aState); g.setAttribute('aWind', aWind); g.instanceCount = 0; }

  const flashes = []; for (let i = 0; i < MAX_FLASH; i++) flashes.push(new THREE.Vector4(0, 0, 1, 0));
  const uniforms = {
    uTime: { value: 0 }, uT0: { value: 0 }, uPuff: { value: quality.puff }, uFlash: { value: flashes },
    uSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.3).normalize() },
    uLit: { value: new THREE.Vector3(1, 1, 1) }, uShade: { value: new THREE.Vector3(0.62, 0.69, 0.82) },
    uDarkLit: { value: new THREE.Vector3(0.38, 0.4, 0.45) }, uDarkShade: { value: new THREE.Vector3(0.16, 0.18, 0.22) },
    uFlashColor: { value: new THREE.Vector3(0.9, 0.93, 1.0) },
  };
  const mesh = new THREE.Mesh(geom, new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, toneMapped: false }));
  mesh.frustumCulled = false; mesh.name = 'clouds-solid';
  const shadowUniforms = { uTime: uniforms.uTime, uT0: uniforms.uT0, uPuff: uniforms.uPuff, uSunDir: uniforms.uSunDir, uStrength: { value: 0.14 } };
  const shadow = new THREE.Mesh(sgeom, new THREE.ShaderMaterial({
    uniforms: shadowUniforms, vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }));
  shadow.frustumCulled = false; shadow.renderOrder = 2; shadow.name = 'cloud-shadows';

  let visible = 0, lastUpdate = 0, slotFrac = quality.slots;
  const smp = {};
  function update(field, t, realSeconds) {
    const dt = lastUpdate ? Math.min(realSeconds - lastUpdate, 0.5) : 0;
    lastUpdate = realSeconds;
    const P = aPos.array, S = aShape.array, St = aState.array, W = aWind.array;
    let k = 0;
    for (let i = 0; i < N; i++) {
      if (srank[i] >= slotFrac) continue;
      const li = slayer[i];
      field.sample(slon[i], slat[i], t, smp);
      const sp = smp.speed, kk = sp > 0.01 ? (ORBIT_AMP * Math.min(1, sp / 30)) / sp : 0;
      const ax = smp.u * kk, az = -smp.v * kk;
      phase[i] += omega[i] * dt;
      omega[i] = 0.06 + 0.5 * Math.min(1, sp / 40);
      const cs = Math.cos(phase[i]), sn = Math.sin(phase[i]);
      const dx = ax * cs - az * 0.3 * sn, dz = az * cs + ax * 0.3 * sn;
      // chuva e trovoada avaliadas onde o puff está: nuvem escura nunca vai parar sobre célula seca
      const plon = slon[i] + (dx / CELL_X) * 0.25, plat = slat[i] - (dz / CELL_Z) * 0.25;
      const r = field.rain(plon, plat, t);
      let c = li === 0 ? smp.low : smp.mid;
      if (li === 0 && r > 0 && c < RAIN_MIN_LOW) c = RAIN_MIN_LOW;
      const cc = clamp((c - MIN_COVER) / (100 - MIN_COVER), 0, 1);
      const presence = smoothstep(su[i], su[i] + FADE, cc);
      if (presence <= 0.004) continue;
      const shape = solidPuffShape({ layer: li, cover01: cc, presence, rain: r, storm: li === 0 && field.storm(plon, plat, t), size01: ssize[i] });
      for (const lv of towerLevels(shape)) {
        if (k >= CAP) break;
        P[k * 3] = sx[i]; P[k * 3 + 1] = sy[i] + lv.y; P[k * 3 + 2] = sz[i];
        S[k * 4] = lv.radius; S[k * 4 + 1] = lv.height; S[k * 4 + 2] = (sseed[i] + lv.y * 0.37) % 1;
        St[k * 4] = presence; St[k * 4 + 1] = shape.dark;
        W[k * 4] = ax; W[k * 4 + 1] = az; W[k * 4 + 2] = phase[i]; W[k * 4 + 3] = omega[i];
        k++;
      }
    }
    visible = k;
    geom.instanceCount = k; sgeom.instanceCount = k;
    for (const a of [aPos, aShape, aState, aWind]) { a.clearUpdateRanges?.(); a.addUpdateRange?.(0, k * a.itemSize); a.needsUpdate = true; }
    uniforms.uT0.value = lastUpdate;
  }

  return {
    mesh, shadow, count: N, update,
    sort() {},                                                 // opacas: a ordem não importa
    frame(realSeconds) { uniforms.uTime.value = realSeconds; },
    visibleCount: () => visible,
    setFlashes(list) { for (let i = 0; i < MAX_FLASH; i++) { const f = list[i]; if (f) flashes[i].set(f.x, f.z, f.radius, f.intensity); else flashes[i].w = 0; } },
    setSky(sky) {
      uniforms.uSunDir.value.fromArray(sky.sunDir);
      uniforms.uLit.value.fromArray(sky.cloudLit); uniforms.uShade.value.fromArray(sky.cloudShade);
      uniforms.uDarkLit.value.fromArray(sky.cloudLit).multiplyScalar(0.38); uniforms.uDarkShade.value.fromArray(sky.cloudShade).multiplyScalar(0.26);
      shadowUniforms.uStrength.value = 0.15 - 0.06 * sky.night;
    },
    setQuality(q) { slotFrac = q.slots; uniforms.uPuff.value = 1 + (q.puff - 1) * 0.6; shadow.visible = q.shadows !== false; },
  };
}
