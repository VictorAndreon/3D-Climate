// Luz por hora do dia. skyState é puro; applySky leva o resultado para a cena.
import { smoothstep } from '../util/rng.js';

const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const C = {
  sun: { day: [1, 0.97, 0.9], warm: [1, 0.6, 0.32], night: [0.36, 0.46, 0.76] },
  ambient: { day: [0.62, 0.68, 0.78], warm: [0.66, 0.56, 0.58], night: [0.24, 0.3, 0.48] },
  bgTop: { day: [0.1, 0.17, 0.29], warm: [0.26, 0.16, 0.2], night: [0.03, 0.05, 0.11] },
  bgBottom: { day: [0.04, 0.07, 0.12], warm: [0.07, 0.05, 0.08], night: [0.01, 0.015, 0.04] },
  cloudLit: { day: [1, 1, 1], warm: [1, 0.8, 0.62], night: [0.5, 0.57, 0.74] },
  cloudShade: { day: [0.62, 0.69, 0.82], warm: [0.5, 0.42, 0.55], night: [0.2, 0.25, 0.4] },
};

/** Hora local do RS (UTC-3 fixo) a partir de unix em segundos. */
export const localHour = (unix) => (((unix / 3600 - 3) % 24) + 24) % 24;

export function skyState(hour) {
  const a = (Math.PI * (hour - 6)) / 12;
  const e = Math.sin(a);                                   // "elevação": 1 ao meio-dia, -1 à meia-noite
  const day = smoothstep(-0.15, 0.3, e);
  const night = 1 - smoothstep(-0.3, 0.05, e);
  const warm = Math.exp(-((e / 0.28) ** 2)) * 0.85;        // pico no amanhecer e no entardecer
  const out = { night };
  for (const k of Object.keys(C)) out[k] = mix3(mix3(C[k].night, C[k].day, day), C[k].warm, warm);
  const d = [Math.cos(a) * 0.9, Math.max(Math.abs(e), 0.25), 0.35];   // de noite, a "lua" espelha o sol
  const len = Math.hypot(...d);
  out.sunDir = [d[0] / len, d[1] / len, d[2] / len];
  return out;
}

/** Aplica o estado do céu nas luzes do mapa, no fundo, nas nuvens e na chuva. */
export function applySky(sky, { renderer, lights, ground, clouds, rain }) {
  lights.sun.color.setRGB(sky.sun[0], sky.sun[1], sky.sun[2], 'srgb');
  lights.sun.intensity = 2.2 - 1.2 * sky.night;
  lights.sun.position.set(sky.sunDir[0] * 80, sky.sunDir[1] * 80, sky.sunDir[2] * 80);
  lights.hemi.color.setRGB(sky.ambient[0], sky.ambient[1], sky.ambient[2], 'srgb');
  lights.hemi.groundColor.setRGB(sky.ambient[0] * 0.35, sky.ambient[1] * 0.35, sky.ambient[2] * 0.4, 'srgb');
  lights.hemi.intensity = 2.4;
  renderer.setClearColor(lights.tmp.setRGB(sky.bgBottom[0], sky.bgBottom[1], sky.bgBottom[2], 'srgb'), 1);
  ground.material.uniforms.uInner.value.fromArray(sky.bgTop);
  ground.material.uniforms.uOuter.value.fromArray(sky.bgBottom);
  clouds?.setSky(sky);
  rain?.setSky(sky);
}
