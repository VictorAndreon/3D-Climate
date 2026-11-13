// Raios: só em células com storm() verdadeiro. Agenda por nó de grade, em tempo real, pausada com o play.
// Efeito: clarão em dois pulsos nos puffs da célula + traço em zigue-zague da nuvem ao chão. Sem luz dinâmica.
import * as THREE from 'three';
import { toScene, CELL_X, CELL_Z } from '../geo/projection.js';
import { mulberry32 } from '../util/rng.js';

const MAX_BOLTS = 8, SEGS = 12, TOP = 4.2;
const RADIUS = 1.5 * (CELL_X + CELL_Z) / 2;
const DURATION = 0.19;
/** Duplo pulso: 60 ms aceso, 40 ms apagado, 50 ms aceso, cauda curta. */
export function flashIntensity(age) {
  if (age < 0 || age >= DURATION) return 0;
  if (age < 0.06) return 1;
  if (age < 0.10) return 0.12;
  if (age < 0.15) return 0.8;
  return 0.8 * (1 - (age - 0.15) / (DURATION - 0.15));
}

export function createLightning({ grid }) {
  const rnd = mulberry32(2024);
  const nodeX = new Float32Array(grid.nP), nodeZ = new Float32Array(grid.nP);
  for (let p = 0; p < grid.nP; p++) { const s = toScene(grid.lons[p], grid.lats[p]); nodeX[p] = s.x; nodeZ[p] = s.z; }
  const next = new Float64Array(grid.nP).fill(-1);      // -1 = sem trovoada
  let clock = 0;
  const bolts = [];                                      // { x, z, age, slot }
  const freeSlots = Array.from({ length: MAX_BOLTS }, (_, i) => i);

  const positions = new Float32Array(MAX_BOLTS * SEGS * 2 * 3);
  const geom = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3); posAttr.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', posAttr);
  const material = new THREE.LineBasicMaterial({ color: 0xf4f8ff, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const object3d = new THREE.LineSegments(geom, material);
  object3d.frustumCulled = false; object3d.renderOrder = 8; object3d.name = 'lightning';

  function writeBolt(slot, x, z) {
    let px = x + (rnd() - 0.5) * 1.2, pz = z + (rnd() - 0.5) * 1.2, py = TOP;
    const o = slot * SEGS * 6;
    for (let s = 0; s < SEGS; s++) {
      const ny = TOP * (1 - (s + 1) / SEGS);
      const nx = px + (rnd() - 0.5) * 0.9, nz = pz + (rnd() - 0.5) * 0.9;
      positions.set([px, py, pz, nx, ny, nz], o + s * 6);
      px = nx; pz = nz; py = ny;
    }
  }
  function clearBolt(slot) { positions.fill(0, slot * SEGS * 6, (slot + 1) * SEGS * 6); }

  /** A ~10 Hz: atualiza quais nós têm trovoada na hora ativa. */
  function update(field, t) {
    for (let p = 0; p < grid.nP; p++) {
      if (field.storm(grid.lons[p], grid.lats[p], t)) { if (next[p] < 0) next[p] = clock + rnd() * 6; }   // entra dessincronizado
      else next[p] = -1;
    }
  }
  const flashes = [];
  /** Por quadro. Devolve até 8 clarões { x, z, radius, intensity } para as nuvens. */
  function frame(realSeconds, dt, playing) {
    if (playing) {
      clock += dt;
      for (let p = 0; p < grid.nP; p++) {
        if (next[p] >= 0 && next[p] <= clock) {
          next[p] = clock + 3 + rnd() * 6;                 // intervalo de 3–9 s de tempo real
          if (freeSlots.length) { const slot = freeSlots.pop(); bolts.push({ x: nodeX[p], z: nodeZ[p], age: 0, slot }); writeBolt(slot, nodeX[p], nodeZ[p]); }
        }
      }
    }
    flashes.length = 0;
    let peak = 0;
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      const k = flashIntensity(b.age);
      b.age += dt;
      if (b.age >= DURATION) { clearBolt(b.slot); freeSlots.push(b.slot); bolts.splice(i, 1); continue; }
      flashes.push({ x: b.x, z: b.z, radius: RADIUS, intensity: k });
      peak = Math.max(peak, k);
    }
    material.opacity = peak;
    object3d.visible = bolts.length > 0;
    posAttr.needsUpdate = true;
    return flashes;
  }
  return { object3d, update, frame, stormCount: () => { let n = 0; for (let p = 0; p < grid.nP; p++) if (next[p] >= 0) n++; return n; } };
}
