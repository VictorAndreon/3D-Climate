// Posições fixas com jitter (malha hexagonal perturbada, tipo blue-noise) para puffs e colunas de chuva.
// Saída: Float32Array com 5 valores por slot: x, z, size01, seed01, u (limiar em [0; 0,9]).
// A ordem é embaralhada: qualquer prefixo é uma subamostra uniforme (usado pela qualidade adaptativa).
import { mulberry32 } from '../util/rng.js';

const JITTER = 0.4;

function generate(minX, maxX, minZ, maxZ, spacing, seed, accept) {
  const rnd = mulberry32(seed);
  const rowH = spacing * Math.sqrt(3) / 2;
  const out = [];
  let row = 0;
  for (let z = minZ; z <= maxZ; z += rowH, row++) {
    for (let x = minX + (row % 2 ? spacing / 2 : 0); x <= maxX; x += spacing) {
      const ang = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * JITTER * spacing;
      const size = rnd(), sd = rnd(), u = rnd() * 0.9;
      const px = x + Math.cos(ang) * rad, pz = z + Math.sin(ang) * rad;
      if (accept(px, pz)) out.push([px, pz, size, sd, u]);
    }
  }
  for (let i = out.length - 1; i > 0; i--) {            // Fisher–Yates determinístico
    const j = Math.floor(rnd() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

export function makeSlots({ minX, maxX, minZ, maxZ, count, seed, accept = () => true }) {
  const area = (maxX - minX) * (maxZ - minZ);
  let spacing = Math.sqrt(area / count / (Math.sqrt(3) / 2));
  let slots = generate(minX, maxX, minZ, maxZ, spacing, seed, accept);
  for (let pass = 0; pass < 3 && slots.length > 0 && Math.abs(slots.length - count) > count * 0.04; pass++) {
    spacing *= Math.sqrt(slots.length / count);          // corrige pela fração aceita
    slots = generate(minX, maxX, minZ, maxZ, spacing, seed, accept);
  }
  const arr = new Float32Array(slots.length * 5);
  slots.forEach((s, i) => arr.set(s, i * 5));
  return arr;
}
