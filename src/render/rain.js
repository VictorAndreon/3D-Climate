// Chuva: colunas fixas (slots com jitter). Coluna ativa só se rain(pos, t) > 0, e cada traço só é
// desenhado se rain() > 0 na posição do próprio traço (garantia A1 no nível do traço).
// A queda é em laço no vertex shader; a CPU só reescreve os buffers a ~10 Hz.
import * as THREE from 'three';
import { toLonLat, CELL_X, CELL_Z } from '../geo/projection.js';

export const MAX_PER_COLUMN = 10;
const TOP = 4.0;                 // altura da base das nuvens baixas
const SPREAD = 0.85;             // raio dos traços em torno da coluna
// faixas: [limite inferior mm/h, traços por coluna, comprimento, opacidade]
const BANDS = [[10, 10, 1.2, 0.9], [2.5, 6, 0.8, 0.7], [0.1, 3, 0.5, 0.5]];
export function rainBand(mm) { for (const b of BANDS) if (mm >= b[0]) return b; return mm > 0 ? BANDS[2] : null; }

const VERT = /* glsl */`
attribute vec4 aBase;    // x, z, tipo (0 traço, 1 respingo), semente
attribute vec4 aParam;   // comprimento/raio, opacidade, tiltX, tiltZ
uniform float uTime;
varying float vAlpha; varying vec2 vUv; varying float vKind; varying float vPhase;
void main() {
  vKind = aBase.z; vUv = uv;
  float seed = aBase.w;
  if (aBase.z > 0.5) {                               // respingo no chão
    vPhase = fract(uTime * (0.7 + seed * 0.5) + seed * 9.0);
    vec3 p = vec3(aBase.x + position.x * aParam.x * 2.0, 0.035, aBase.y + position.y * aParam.x * 2.0);
    vAlpha = aParam.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    return;
  }
  float speed = 1.5 + seed * 0.9;                    // voltas por segundo
  float f = fract(uTime * speed + seed * 17.0);      // 0 no topo, 1 no chão
  float y = ${TOP.toFixed(1)} * (1.0 - f);
  vec3 dir = normalize(vec3(aParam.z, -1.0, aParam.w));
  vec3 c = vec3(aBase.x - aParam.z * y, y, aBase.y - aParam.w * y);    // cai inclinado e pousa na base
  vec3 toCam = normalize(cameraPosition - c);
  vec3 side = cross(dir, toCam);
  float sl = length(side);
  side = sl > 0.001 ? side / sl : vec3(1.0, 0.0, 0.0);
  vec3 p = c - dir * (position.y + 0.5) * aParam.x + side * position.x * 0.07;
  vAlpha = aParam.y * smoothstep(0.0, 0.12, f) * (1.0 - smoothstep(0.9, 1.0, f));
  vPhase = 0.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const FRAG = /* glsl */`
uniform vec3 uColor;
varying float vAlpha; varying vec2 vUv; varying float vKind; varying float vPhase;
void main() {
  float a;
  if (vKind > 0.5) {
    float r = length(vUv - 0.5) * 2.0;
    float ring = 1.0 - smoothstep(0.0, 0.18, abs(r - vPhase * 0.9));
    a = vAlpha * ring * (1.0 - vPhase) * 0.9 + vAlpha * 0.16 * (1.0 - smoothstep(0.4, 1.0, r));
  } else {
    a = vAlpha * (1.0 - abs(vUv.x - 0.5) * 1.6) * smoothstep(0.0, 0.5, vUv.y);
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * a, a);
}`;

export function createRain({ slots, quality = { slots: 1 } }) {
  const nCol = slots.length / 5;
  const cx = new Float32Array(nCol), cz = new Float32Array(nCol), clon = new Float32Array(nCol), clat = new Float32Array(nCol), cseed = new Float32Array(nCol);
  const active = new Uint8Array(nCol);
  // posição fixa de cada traço (para checar rain() no próprio traço)
  const M = MAX_PER_COLUMN;
  const ox = new Float32Array(nCol * M), oz = new Float32Array(nCol * M), olon = new Float32Array(nCol * M), olat = new Float32Array(nCol * M);
  for (let i = 0; i < nCol; i++) {
    cx[i] = slots[i * 5]; cz[i] = slots[i * 5 + 1]; cseed[i] = slots[i * 5 + 3];
    const ll = toLonLat(cx[i], cz[i]); clon[i] = ll.lon; clat[i] = ll.lat;
    for (let j = 0; j < M; j++) {
      const ang = cseed[i] * 97 + j * 2.399963, rad = SPREAD * Math.sqrt((j + 0.5) / M);
      const x = cx[i] + Math.cos(ang) * rad, z = cz[i] + Math.sin(ang) * rad, l2 = toLonLat(x, z);
      ox[i * M + j] = x; oz[i * M + j] = z; olon[i * M + j] = l2.lon; olat[i * M + j] = l2.lat;
    }
  }
  const CAP = nCol * (M + 1);
  const geom = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geom.setIndex(quad.index);
  geom.setAttribute('position', quad.getAttribute('position'));
  geom.setAttribute('uv', quad.getAttribute('uv'));
  const aBase = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4); aBase.setUsage(THREE.DynamicDrawUsage);
  const aParam = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4); aParam.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('aBase', aBase); geom.setAttribute('aParam', aParam);
  geom.instanceCount = 0;
  const uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Vector3(0.78, 0.88, 1.0) } };
  const mesh = new THREE.Mesh(geom, new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, premultipliedAlpha: true, toneMapped: false,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;            // antes das nuvens: a chuva fica por baixo delas
  mesh.name = 'rain';

  let drops = 0, colFrac = quality.slots;
  const strokes = [];              // posições dos traços desenhados (só para o gancho de teste)
  const smp = {};
  function update(field, t, collect = false) {
    const B = aBase.array, P = aParam.array;
    let k = 0;
    if (collect) strokes.length = 0;
    const limit = Math.floor(nCol * colFrac);
    for (let i = 0; i < nCol; i++) {
      active[i] = 0;
      if (i >= limit) continue;
      const mm = field.rain(clon[i], clat[i], t);
      if (!(mm > 0)) continue;
      active[i] = 1;
      const band = rainBand(mm);
      field.sample(clon[i], clat[i], t, smp);
      const tx = smp.u * 0.012, tz = -smp.v * 0.012;                     // só os traços se inclinam
      B[k * 4] = cx[i]; B[k * 4 + 1] = cz[i]; B[k * 4 + 2] = 1; B[k * 4 + 3] = cseed[i];
      P[k * 4] = 0.35 + 0.3 * cseed[i]; P[k * 4 + 1] = band[3]; P[k * 4 + 2] = 0; P[k * 4 + 3] = 0;
      k++;
      for (let j = 0; j < band[1]; j++) {
        const s = i * M + j;
        if (!(field.rain(olon[s], olat[s], t) > 0)) continue;             // A1 por traço
        B[k * 4] = ox[s]; B[k * 4 + 1] = oz[s]; B[k * 4 + 2] = 0; B[k * 4 + 3] = (cseed[i] * 31 + j * 0.6180339) % 1;
        P[k * 4] = band[2]; P[k * 4 + 1] = band[3]; P[k * 4 + 2] = tx; P[k * 4 + 3] = tz;
        k++;
        if (collect) strokes.push({ lon: olon[s], lat: olat[s] });
      }
    }
    drops = k;
    geom.instanceCount = k;
    aBase.needsUpdate = true; aParam.needsUpdate = true;
  }
  return {
    mesh, update,
    frame(realSeconds) { uniforms.uTime.value = realSeconds; },
    setSky(sky) { const n = sky.night; uniforms.uColor.value.set(0.78 - 0.25 * n, 0.88 - 0.22 * n, 1.0 - 0.1 * n); },
    setQuality(q) { colFrac = q.slots; },
    activeColumns() { const out = []; for (let i = 0; i < nCol; i++) out.push({ lon: clon[i], lat: clat[i], active: !!active[i] }); return out; },
    /** Reavalia e devolve a posição de cada traço desenhado (gancho de teste). */
    activeStrokes(field, t) { update(field, t, true); return strokes.slice(); },
    dropCount: () => drops,
  };
}
