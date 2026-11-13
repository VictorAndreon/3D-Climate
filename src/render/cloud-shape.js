// Formato das nuvens sólidas (puro): raio, altura e escurecimento de um puff a partir do dado.
// Baixa = cúmulos que crescem com a cobertura e a chuva, e viram torre onde há trovoada;
// média = altocúmulos achatados.
import { clamp } from '../util/rng.js';

export const SOLID_LAYERS = [
  { key: 'low', y: 4, yJit: 0.35, rMin: 1.4, rMax: 3.4, hf: 0.9, darken: 1, towers: true },
  { key: 'mid', y: 7, yJit: 0.3, rMin: 1.8, rMax: 3.6, hf: 0.38, darken: 0.6, towers: false },
];
const TOWER_R = 1.25, STACK = 3;      // cumulonimbus: 3 cachos empilhados, cada um menor

/** { layer, cover01, presence, rain (mm/h), storm, size01 } -> { radius, height, dark } (unidades de cena). */
export function solidPuffShape({ layer, cover01, presence, rain, storm, size01 }) {
  const L = SOLID_LAYERS[layer];
  const p = clamp(presence, 0, 1), c = clamp(cover01, 0, 1), wet = clamp(rain / 8, 0, 1);
  // cresce com a presença (sem estalo): de 35% a 100% do tamanho; presença 0 = nada
  const sz = clamp(size01, 0, 1) ** 1.8;                                  // muitos pequenos, poucos grandes
  let radius = p > 0 ? (L.rMin + (L.rMax - L.rMin) * sz) * (0.35 + 0.65 * p) : 0;
  let height = radius * L.hf * (0.75 + 0.55 * c) * (L.towers ? 1 + 0.6 * wet : 1);
  const stack = L.towers && storm ? STACK : 1;
  if (stack > 1) { radius *= TOWER_R; height = Math.min(height * TOWER_R, radius * 1.2); }
  // qualquer chuva já é cinza (legível de longe); escurece mais com a intensidade; trovoada = chumbo
  const wetDark = rain > 0 ? 0.45 + 0.55 * clamp(rain / 8, 0, 1) : 0;
  const dark = (L.towers && storm ? 1 : wetDark) * L.darken;
  return { radius, height, dark, stack };
}

/** Níveis de um puff: 1 cacho, ou a torre de cachos empilhados. y = deslocamento da base. */
export function towerLevels({ radius, height, stack = 1 }) {
  const out = [];
  let y = 0;
  for (let k = 0; k < stack; k++) {
    const r = radius * (1 - 0.2 * k), h = height * (1 - 0.2 * k);
    out.push({ y, radius: r, height: h });
    y += h * 0.95;
  }
  // cumulonimbus: bigorna larga e achatada no topo
  if (stack > 1) { const top = out[out.length - 1]; out.push({ y: top.y + top.height * 0.8, radius: radius * 1.6, height: radius * 1.6 * 0.32, anvil: true }); }
  return out;
}
