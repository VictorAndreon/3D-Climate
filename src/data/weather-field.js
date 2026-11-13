// WeatherField: módulo puro. Entrada: grade + séries horárias. t = horas fracionárias desde times[0].
//   sample(): bilinear no espaço, linear no tempo (é o que elimina a grade visível).
//   rain():   regra própria que garante A1 — célula seca na hora ativa devolve 0, sem exceção.
import { clamp, smoothstep } from '../util/rng.js';

export const WET_MM = 0.1;          // célula "molhada" se P[h] ≥ 0,1 mm
const FADE = 1 / 6;                 // 10 min de tempo simulado

export function createWeatherField(grid, series) {
  const { nT, times, low, mid, high, code, precip, windSpeed, windDir } = series;
  const { lon0, lat0, step, nx, ny, index } = grid;
  const n = series.nP * nT;
  const U = new Float32Array(n), V = new Float32Array(n);       // para onde sopra: u leste, v norte
  for (let i = 0; i < n; i++) {
    const d = (windDir[i] * Math.PI) / 180;
    U[i] = -windSpeed[i] * Math.sin(d); V[i] = -windSpeed[i] * Math.cos(d);
  }

  // cantos da célula da malha que contém (lon, lat): índices em cp[], pesos em cw[] (renormalizados)
  const cp = new Int32Array(4), cw = new Float64Array(4);
  function corners(lon, lat) {
    const gx = (lon - lon0) / step, gy = (lat - lat0) / step;
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    let k = 0, sum = 0;
    for (let c = 0; c < 4; c++) {
      const ii = i + (c & 1), jj = j + (c >> 1);
      if (ii < 0 || ii >= nx || jj < 0 || jj >= ny) continue;
      const p = index[jj * nx + ii];
      if (p < 0) continue;
      const w = ((c & 1) ? fx : 1 - fx) * ((c >> 1) ? fy : 1 - fy);
      cp[k] = p; cw[k] = w; sum += w; k++;
    }
    if (k === 0 || sum <= 1e-9) { cp[0] = grid.nearest(lon, lat); cw[0] = 1; return 1; }   // fora da grade: vizinho mais próximo
    for (let c = 0; c < k; c++) cw[c] /= sum;
    return k;
  }

  /** Hora ativa de chuva/trovoada: o intervalo (h-1, h] que contém t. */
  const activeHour = (t) => clamp(Math.ceil(t), 0, nT - 1);
  const wet = (p, h) => h >= 0 && h < nT && precip[p * nT + h] >= WET_MM;
  // intensidade efetiva da célula em (h, f): degrau por hora, com fade de 10 min nas viradas
  function eff(p, h, f) {
    if (!wet(p, h)) return 0;
    const cur = precip[p * nT + h];
    const from = wet(p, h - 1) ? precip[p * nT + h - 1] : 0;
    let v = from + (cur - from) * smoothstep(0, FADE, f);
    if (h < nT - 1 && !wet(p, h + 1)) v *= 1 - smoothstep(1 - FADE, 1, f);
    return v;
  }

  function sample(lon, lat, t, out = {}) {
    const tt = clamp(t, 0, nT - 1), h0 = Math.floor(tt), h1 = Math.min(h0 + 1, nT - 1), ft = tt - h0;
    const k = corners(lon, lat);
    let l = 0, m = 0, hi = 0, u = 0, v = 0;
    for (let c = 0; c < k; c++) {
      const a = cp[c] * nT + h0, b = cp[c] * nT + h1, w = cw[c], w0 = w * (1 - ft), w1 = w * ft;
      l += low[a] * w0 + low[b] * w1; m += mid[a] * w0 + mid[b] * w1; hi += high[a] * w0 + high[b] * w1;
      u += U[a] * w0 + U[b] * w1; v += V[a] * w0 + V[b] * w1;
    }
    out.low = l; out.mid = m; out.high = hi; out.u = u; out.v = v; out.speed = Math.hypot(u, v);
    return out;
  }

  function rain(lon, lat, t) {
    const h = activeHour(t);
    const owner = grid.nearest(lon, lat);
    if (!wet(owner, h)) return 0;                                 // A1: célula dona seca => 0
    const f = t <= 0 || t >= nT - 1 ? 1 : t - (h - 1);
    const k = corners(lon, lat);
    let r = 0;
    for (let c = 0; c < k; c++) r += cw[c] * eff(cp[c], h, f);
    return r;
  }

  function storm(lon, lat, t) {
    const c = code[grid.nearest(lon, lat) * nT + activeHour(t)];
    return c >= 95 && c <= 99;
  }

  function cellInfo(lon, lat, t) {
    if (grid.distCells(lon, lat) > 1) return null;
    const p = grid.nearest(lon, lat), h = activeHour(t), hr = Math.round(clamp(t, 0, nT - 1));
    return {
      p, lon: grid.lons[p], lat: grid.lats[p], h,
      low: low[p * nT + hr], mid: mid[p * nT + hr], high: high[p * nT + hr],
      precip: precip[p * nT + h], code: code[p * nT + h],
      windSpeed: windSpeed[p * nT + hr], windDir: windDir[p * nT + hr],
    };
  }

  function anyRainByHour() {
    const out = new Uint8Array(nT);
    for (let p = 0; p < series.nP; p++) for (let h = 0; h < nT; h++) if (precip[p * nT + h] >= WET_MM) out[h] = 1;
    return out;
  }

  return { nT, times, sample, rain, storm, cellInfo, activeHour, anyRainByHour };
}
