// Campo sintético determinístico (funções contínuas de lon, lat, t).
// Ruído com buracos de céu limpo, uma faixa de chuva que cruza o estado de oeste a leste a cada 36 h
// e um núcleo de trovoada dentro da faixa. Usado pelo modo demo e para gerar a fixture sintética.
import { toScene, KM_PER_UNIT } from '../geo/projection.js';
import { clamp, smoothstep } from '../util/rng.js';

function hash3(i, j, k, seed) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2147483647) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);
function noise3(x, y, z, seed) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = fade(x - i), fy = fade(y - j), fz = fade(z - k);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (di, dj, dk) => hash3(i + di, j + dj, k + dk, seed);
  return L(
    L(L(c(0, 0, 0), c(1, 0, 0), fx), L(c(0, 1, 0), c(1, 1, 0), fx), fy),
    L(L(c(0, 0, 1), c(1, 0, 1), fx), L(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}
const fbm = (x, y, z, seed) => (noise3(x, y, z, seed) * 2 + noise3(x * 2.1, y * 2.1, z * 1.7, seed + 11)) / 3;

const BAND_HALF = 60;      // km: faixa de chuva com ~120 km de largura
const CORE_R = 60;         // km: raio do núcleo de trovoada
const PERIOD = 36;         // h para cruzar o estado

export function analyticField({ startUnix, hours = 168, seed = 7 }) {
  const times = new Float64Array(hours);
  for (let i = 0; i < hours; i++) times[i] = startUnix + i * 3600;

  // geometria da faixa em t: distância assinada à linha da frente e ao núcleo
  function band(xk, yk, t) {
    const xc = -400 + ((((t + 6) % PERIOD) + PERIOD) % PERIOD) / PERIOD * 800;
    const d = xk - xc + 0.4 * yk;
    const y0 = 120 * Math.sin(t * 0.21);
    const core = Math.hypot(xk - (xc - 0.4 * y0), yk - y0);
    return { d, core };
  }
  function rate(xk, yk, t, b) {
    const k = Math.max(0, 1 - (b.d / BAND_HALF) ** 2);
    let r = 9 * k * (0.45 + 0.9 * noise3(xk / 50, yk / 50, t * 0.2, seed + 3));
    if (b.core < CORE_R) r += 18 * (1 - (b.core / CORE_R) ** 2);
    return r < 0.15 ? 0 : r;
  }
  const km = (lon, lat) => { const s = toScene(lon, lat); return [s.x * KM_PER_UNIT, -s.z * KM_PER_UNIT]; };

  function sample(lon, lat, t, out = {}) {
    const [xk, yk] = km(lon, lat);
    const b = band(xk, yk, t);
    const r = rate(xk, yk, t, b);
    const drift = t * 0.12;
    const m = smoothstep(0.5, 0.7, fbm(xk / 130 - drift, yk / 130, t * 0.04, seed));       // 0 = buraco de céu limpo
    let low = 100 * m * smoothstep(0.25, 0.6, fbm(xk / 70 - drift * 1.5, yk / 70, t * 0.07, seed + 21));
    let mid = 100 * m * smoothstep(0.35, 0.7, fbm(xk / 110 - drift, yk / 110, t * 0.05, seed + 42));
    let high = 100 * m * smoothstep(0.4, 0.75, fbm(xk / 180 - drift * 0.7, yk / 180, t * 0.03, seed + 63));
    const wide = smoothstep(0, 0.6, Math.max(0, 1 - (b.d / (BAND_HALF * 1.7)) ** 2));       // nebulosidade frontal
    low = Math.max(low, 80 * wide);
    mid = Math.max(mid, 65 * wide);
    high = Math.max(high, 45 * wide);
    if (r > 0) low = Math.max(low, 70 + 30 * Math.min(1, r / 8));
    const gust = 1 + 0.7 * wide;
    const u = (18 + 28 * (noise3(xk / 200, yk / 200, t * 0.05, seed + 84) - 0.5)) * gust;
    const v = (-6 + 24 * (noise3(xk / 200, yk / 200, t * 0.05, seed + 105) - 0.5)) * gust;
    out.low = clamp(low, 0, 100); out.mid = clamp(mid, 0, 100); out.high = clamp(high, 0, 100);
    out.u = u; out.v = v; out.speed = Math.hypot(u, v);
    return out;
  }
  function rain(lon, lat, t) { const [xk, yk] = km(lon, lat); return rate(xk, yk, t, band(xk, yk, t)); }
  function storm(lon, lat, t) { const [xk, yk] = km(lon, lat); const b = band(xk, yk, t); return b.core < CORE_R && rate(xk, yk, t, b) > 0; }

  return { nT: hours, times, sample, rain, storm, cellInfo: () => null };
}
