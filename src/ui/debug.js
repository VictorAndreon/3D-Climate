import * as THREE from 'three';
import { toScene } from '../geo/projection.js';
// Painel de debug (?debug=1): fps, tempo de quadro, puffs, gotas, draw calls, nível de qualidade.
export function createDebug(el, { stats }) {
  el.hidden = false;
  let acc = 0;
  return {
    el,
    tick(dt) {
      acc += dt;
      if (acc < 0.25) return;
      acc = 0;
      const s = stats();
      el.textContent = `${s.fps.toFixed(0)} fps · ${s.frameMs.toFixed(1)} ms\npuffs ${s.puffs} · gotas ${s.drops}\ndraw calls ${s.drawCalls} · qualidade ${s.quality}`;
    },
  };
}

// Pontos da grade no chão, coloridos pelo dado BRUTO: cinza = seco, azul = chuva, amarelo = trovoada.

const DRY = [0.47, 0.47, 0.47], WET = [0.23, 0.51, 0.96], STORM = [0.98, 0.8, 0.08];
export function createGridDots(grid) {
  const pos = new Float32Array(grid.nP * 3), col = new Float32Array(grid.nP * 3);
  for (let p = 0; p < grid.nP; p++) { const s = toScene(grid.lons[p], grid.lats[p]); pos.set([s.x, 0.06, s.z], p * 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const colAttr = new THREE.BufferAttribute(col, 3); g.setAttribute('color', colAttr);
  const points = new THREE.Points(g, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true, toneMapped: false }));
  points.frustumCulled = false; points.renderOrder = 20; points.name = 'grid-dots';
  return {
    points,
    update(field, t) {
      for (let p = 0; p < grid.nP; p++) {
        const c = field.cellInfo(grid.lons[p], grid.lats[p], t);
        col.set(c.code >= 95 && c.code <= 99 ? STORM : c.precip >= 0.1 ? WET : DRY, p * 3);
      }
      colAttr.needsUpdate = true;
    },
  };
}
