// Nuvens: um único desenho instanciado de billboards para as três camadas, ordenado de trás para frente.
// Visibilidade por limiar: cada slot tem um limiar u; o puff aparece quando a cobertura remapeada passa de u.
import * as THREE from 'three';
import { toLonLat, CELL_X, CELL_Z } from '../geo/projection.js';
import { clamp, smoothstep, mulberry32 } from '../util/rng.js';

export const LAYERS = [
  { key: 'low', y: 4, yJit: 0.55, wMin: 2.8, wMax: 4.3, flat: 0.8, alpha: 0.92, darken: 1 },
  { key: 'mid', y: 7, yJit: 0.4, wMin: 3.2, wMax: 4.8, flat: 0.55, alpha: 0.7, darken: 0.65 },
  { key: 'high', y: 10, yJit: 0.3, wMin: 4.5, wMax: 7.5, flat: 0.3, alpha: 0.35, darken: 0 },
];
const MAX_FLASH = 8;
const ORBIT_AMP = 0.35 * (CELL_X + CELL_Z) / 2;   // 0,35 célula
const MIN_COVER = 15, RAIN_MIN_LOW = 60, FADE = 0.1;

/** Atlas 2x2 de puffs: aglomerado de bolhas suaves. R = relevo (claro/escuro), A = máscara. */
function makeAtlas() {
  const T = 128, cv = document.createElement('canvas');
  cv.width = cv.height = T * 2;
  const g = cv.getContext('2d');
  const rnd = mulberry32(99);
  for (let tile = 0; tile < 4; tile++) {
    const ox = (tile % 2) * T, oy = Math.floor(tile / 2) * T;
    g.save(); g.beginPath(); g.rect(ox, oy, T, T); g.clip();
    const blobs = [{ x: 0.5, y: 0.5, r: 0.3 }];
    for (let i = 0; i < 8; i++) {
      const a = rnd() * Math.PI * 2, d = 0.08 + rnd() * 0.16, r = 0.15 + rnd() * 0.1;
      blobs.push({ x: 0.5 + Math.cos(a) * d, y: 0.5 + Math.sin(a) * d * 0.85, r });
    }
    blobs.sort((p, q) => p.y - q.y);              // de cima para baixo: os de baixo cobrem os de cima
    for (const b of blobs) {
      const cx = ox + b.x * T, cy = oy + b.y * T, r = b.r * T;
      const gr = g.createRadialGradient(cx - r * 0.15, cy - r * 0.3, r * 0.05, cx, cy, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)');
      gr.addColorStop(0.35, 'rgba(235,235,235,0.75)');
      gr.addColorStop(0.7, 'rgba(190,190,190,0.3)');
      gr.addColorStop(1, 'rgba(150,150,150,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

const VERT = /* glsl */`
attribute vec3 aPos;      // centro do slot
attribute vec4 aShape;    // largura, achatamento, semente, alfa máximo
attribute vec4 aState;    // presença, escurecimento, -, -
attribute vec4 aWind;     // amplitude x, amplitude z, fase em uT0, velocidade angular
uniform float uTime, uT0, uTopness, uPuff;
uniform vec4 uFlash[${MAX_FLASH}];   // x, z, raio, intensidade
varying vec2 vUv; varying vec2 vTile; varying float vAlpha; varying float vDark; varying float vFlash; varying float vY;
void main() {
  float ph = aWind.z + aWind.w * (uTime - uT0);
  vec2 amp = aWind.xy, perp = vec2(-amp.y, amp.x) * 0.3;
  vec3 c = aPos;
  c.xz += amp * cos(ph) + perp * sin(ph);
  c.y += sin(uTime * 0.3 + aShape.z * 40.0) * 0.07;
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  float grow = 0.55 + 0.45 * aState.x;
  float hf = mix(aShape.y, 1.0, uTopness);
  mv.xy += position.xy * vec2(aShape.x, aShape.x * hf) * grow * uPuff;
  gl_Position = projectionMatrix * mv;
  float variant = floor(aShape.z * 4.0);
  vTile = vec2(mod(variant, 2.0), floor(variant / 2.0)) * 0.5;
  vUv = uv; if (fract(aShape.z * 7.0) > 0.5) vUv.x = 1.0 - vUv.x;
  vAlpha = aShape.w * aState.x;
  vDark = aState.y;
  vY = uv.y;
  float f = 0.0;
  for (int i = 0; i < ${MAX_FLASH}; i++) {
    vec4 fl = uFlash[i];
    f += fl.w * (1.0 - smoothstep(fl.z * 0.3, fl.z, distance(c.xz, fl.xy)));
  }
  vFlash = f;
}`;
const FRAG = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uLit, uShade, uDarkLit, uDarkShade, uFlashColor;
uniform float uTopness;
varying vec2 vUv; varying vec2 vTile; varying float vAlpha; varying float vDark; varying float vFlash; varying float vY;
void main() {
  vec4 tex = texture2D(uMap, vTile + clamp(vUv, 0.004, 0.996) * 0.5);
  float a = tex.a * vAlpha;
  if (a < 0.004) discard;
  float light = clamp(0.55 + (tex.r - 0.82) * 2.2 + (vY - 0.5) * 1.2 * (1.0 - uTopness * 0.85), 0.0, 1.0);
  vec3 col = mix(mix(uShade, uLit, light), mix(uDarkShade, uDarkLit, light), vDark);
  col += uFlashColor * min(vFlash, 1.5);
  gl_FragColor = vec4(min(col, vec3(1.0)) * a, a);   // alpha pré-multiplicado
}`;

// Sombra das nuvens no mapa: mesma geometria instanciada, achatada no chão e deslocada pela direção do sol.
const SHADOW_VERT = /* glsl */`
attribute vec3 aPos; attribute vec4 aShape; attribute vec4 aState; attribute vec4 aWind;
uniform float uTime, uT0, uPuff, uStrength; uniform vec3 uSunDir;
varying vec2 vUv; varying float vAlpha;
void main() {
  float ph = aWind.z + aWind.w * (uTime - uT0);
  vec2 amp = aWind.xy, perp = vec2(-amp.y, amp.x) * 0.3;
  vec2 c = aPos.xz + amp * cos(ph) + perp * sin(ph) - uSunDir.xz / max(uSunDir.y, 0.35) * aPos.y * 0.6;
  float size = aShape.x * (0.55 + 0.45 * aState.x) * uPuff * 1.15;
  vUv = uv;
  vAlpha = aShape.w > 0.5 ? aState.x * aShape.w * uStrength * (1.0 + aState.y) : 0.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(c.x + position.x * size, 0.04, c.y + position.y * size, 1.0);
}`;
const SHADOW_FRAG = /* glsl */`
varying vec2 vUv; varying float vAlpha;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = vAlpha * (1.0 - smoothstep(0.15, 1.0, r));
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.01, 0.04, a);
}`;

export function createClouds({ slotsByLayer, quality = { slots: 1, puff: 1 } }) {
  const N = slotsByLayer.reduce((s, a) => s + a.length / 5, 0);
  // estático por slot
  const sx = new Float32Array(N), sy = new Float32Array(N), sz = new Float32Array(N);
  const sw = new Float32Array(N), sflat = new Float32Array(N), sseed = new Float32Array(N), salpha = new Float32Array(N);
  const su = new Float32Array(N), slon = new Float32Array(N), slat = new Float32Array(N);
  const slayer = new Uint8Array(N), srank = new Float32Array(N);
  // dinâmico por slot
  const presence = new Float32Array(N), dark = new Float32Array(N);
  const ampX = new Float32Array(N), ampZ = new Float32Array(N), phase = new Float32Array(N), omega = new Float32Array(N);
  let n = 0;
  slotsByLayer.forEach((arr, li) => {
    const L = LAYERS[li], cnt = arr.length / 5;
    for (let i = 0; i < cnt; i++, n++) {
      const x = arr[i * 5], z = arr[i * 5 + 1], size = arr[i * 5 + 2], seed = arr[i * 5 + 3];
      sx[n] = x; sz[n] = z; sy[n] = L.y + (seed * 2 - 1) * L.yJit;
      sw[n] = L.wMin + (L.wMax - L.wMin) * size; sflat[n] = L.flat; sseed[n] = seed; salpha[n] = L.alpha;
      su[n] = arr[i * 5 + 4]; slayer[n] = li; srank[n] = i / cnt;
      const ll = toLonLat(x, z); slon[n] = ll.lon; slat[n] = ll.lat;
      phase[n] = seed * Math.PI * 2;
    }
  });

  const geom = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geom.setIndex(quad.index);
  geom.setAttribute('position', quad.getAttribute('position'));
  geom.setAttribute('uv', quad.getAttribute('uv'));
  const mk = (size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(N * size), size); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const aPos = mk(3), aShape = mk(4), aState = mk(4), aWind = mk(4);
  geom.setAttribute('aPos', aPos); geom.setAttribute('aShape', aShape); geom.setAttribute('aState', aState); geom.setAttribute('aWind', aWind);
  geom.instanceCount = 0;

  const flashes = []; for (let i = 0; i < MAX_FLASH; i++) flashes.push(new THREE.Vector4(0, 0, 1, 0));
  const uniforms = {
    uMap: { value: makeAtlas() }, uTime: { value: 0 }, uT0: { value: 0 }, uTopness: { value: 0 }, uPuff: { value: quality.puff },
    uFlash: { value: flashes },
    uLit: { value: new THREE.Vector3(1, 1, 1) }, uShade: { value: new THREE.Vector3(0.62, 0.69, 0.82) },
    uDarkLit: { value: new THREE.Vector3(0.36, 0.38, 0.43) }, uDarkShade: { value: new THREE.Vector3(0.17, 0.19, 0.23) },
    uFlashColor: { value: new THREE.Vector3(0.9, 0.93, 1.0) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, premultipliedAlpha: true, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geom, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.name = 'clouds';

  const shadowUniforms = { uTime: uniforms.uTime, uT0: uniforms.uT0, uPuff: uniforms.uPuff, uStrength: { value: 0.16 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) } };
  const shadow = new THREE.Mesh(geom, new THREE.ShaderMaterial({
    uniforms: shadowUniforms, vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }));
  shadow.frustumCulled = false; shadow.renderOrder = 2; shadow.name = 'cloud-shadows';

  const order = new Uint32Array(N); for (let i = 0; i < N; i++) order[i] = i;
  const depth = new Float32Array(N);
  let visible = 0, lastUpdate = 0, slotFrac = quality.slots;
  const smp = {};

  /** Reavalia presença, escurecimento e vento de cada slot (chamar a ~10 Hz). */
  function update(field, t, realSeconds) {
    const dt = lastUpdate ? Math.min(realSeconds - lastUpdate, 0.5) : 0;
    lastUpdate = realSeconds;
    for (let i = 0; i < N; i++) {
      if (srank[i] >= slotFrac) { presence[i] = 0; continue; }
      const li = slayer[i];
      field.sample(slon[i], slat[i], t, smp);
      // deriva: órbita elíptica alongada na direção do vento (mesma conta do vertex shader)
      const sp = smp.speed, k = sp > 0.01 ? (ORBIT_AMP * Math.min(1, sp / 30)) / sp : 0;
      ampX[i] = smp.u * k; ampZ[i] = -smp.v * k;
      phase[i] += omega[i] * dt;
      omega[i] = 0.06 + 0.5 * Math.min(1, sp / 40);
      let c = li === 0 ? smp.low : li === 1 ? smp.mid : smp.high;
      let r = 0;
      if (li < 2) {
        const cs = Math.cos(phase[i]), sn = Math.sin(phase[i]);
        const dx = ampX[i] * cs - ampZ[i] * 0.3 * sn, dz = ampZ[i] * cs + ampX[i] * 0.3 * sn;
        // escurecimento avaliado onde o puff está: nuvem escura nunca vai parar sobre célula seca
        r = field.rain(slon[i] + (dx / CELL_X) * 0.25, slat[i] - (dz / CELL_Z) * 0.25, t);
        if (li === 0 && r > 0 && c < RAIN_MIN_LOW) c = RAIN_MIN_LOW;       // não chove de céu limpo
      }
      const cc = clamp((c - MIN_COVER) / (100 - MIN_COVER), 0, 1);
      presence[i] = smoothstep(su[i], su[i] + FADE, cc);
      dark[i] = clamp(r / 10, 0, 1) * LAYERS[li].darken;
    }
    write();
  }

  function write() {
    const P = aPos.array, S = aShape.array, St = aState.array, W = aWind.array;
    let k = 0;
    for (let j = 0; j < N; j++) {
      const i = order[j];
      if (presence[i] <= 0.004) continue;
      P[k * 3] = sx[i]; P[k * 3 + 1] = sy[i]; P[k * 3 + 2] = sz[i];
      S[k * 4] = sw[i]; S[k * 4 + 1] = sflat[i]; S[k * 4 + 2] = sseed[i]; S[k * 4 + 3] = salpha[i];
      St[k * 4] = presence[i]; St[k * 4 + 1] = dark[i];
      W[k * 4] = ampX[i]; W[k * 4 + 1] = ampZ[i]; W[k * 4 + 2] = phase[i]; W[k * 4 + 3] = omega[i];
      k++;
    }
    visible = k;
    geom.instanceCount = k;
    for (const a of [aPos, aShape, aState, aWind]) { a.clearUpdateRanges?.(); a.addUpdateRange?.(0, k * a.itemSize); a.needsUpdate = true; }
    uniforms.uT0.value = lastUpdate;
  }

  /** Reordena de trás para frente pela profundidade na câmera. */
  function sort(camera) {
    const e = camera.matrixWorldInverse.elements;
    for (let i = 0; i < N; i++) depth[i] = e[2] * sx[i] + e[6] * sy[i] + e[10] * sz[i] + e[14];
    order.sort((a, b) => depth[a] - depth[b]);
    write();
  }

  const lastPos = new THREE.Vector3(1e9, 0, 0), lastDir = new THREE.Vector3(), dir = new THREE.Vector3();
  const COS5 = Math.cos((5 * Math.PI) / 180);
  /** Por quadro: só uniformes; reordena se a câmera girou > 5° ou andou > 2 unidades. */
  function frame(realSeconds, camera) {
    uniforms.uTime.value = realSeconds;
    camera.getWorldDirection(dir);
    uniforms.uTopness.value = Math.abs(dir.y);
    if (dir.dot(lastDir) < COS5 || camera.position.distanceToSquared(lastPos) > 4) {
      lastDir.copy(dir); lastPos.copy(camera.position);
      camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      sort(camera);
    }
  }

  return {
    mesh, shadow, count: N, update, sort, frame,
    visibleCount: () => visible,
    setFlashes(list) { for (let i = 0; i < MAX_FLASH; i++) { const f = list[i]; if (f) flashes[i].set(f.x, f.z, f.radius, f.intensity); else flashes[i].w = 0; } },
    setSky(sky) {
      uniforms.uLit.value.fromArray(sky.cloudLit); uniforms.uShade.value.fromArray(sky.cloudShade);
      shadowUniforms.uSunDir.value.fromArray(sky.sunDir); shadowUniforms.uStrength.value = 0.17 - 0.07 * sky.night;
      uniforms.uDarkLit.value.fromArray(sky.cloudLit).multiplyScalar(0.38); uniforms.uDarkShade.value.fromArray(sky.cloudShade).multiplyScalar(0.26);
    },
    setQuality(q) { slotFrac = q.slots; uniforms.uPuff.value = q.puff; shadow.visible = q.shadows !== false; },
  };
}
