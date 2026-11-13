import test from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.mjs';
import { makeGrid } from '../src/data/grid.js';
import { createSeries } from '../src/data/series.js';
import { createWeatherField } from '../src/data/weather-field.js';
import { mulberry32 } from '../src/util/rng.js';

const NT = 24;
const full = (nx, ny) => Array.from({ length: nx * ny }, (_, i) => i);
const grid = makeGrid({ lon0: -54, lat0: -31, step: 0.25, nx: 8, ny: 8, cells: full(8, 8) });
/** Série com precip dada por fn(p, h); o resto zerado, salvo o que o teste preencher. */
function seriesWith(g, fn = () => 0) {
  const s = createSeries(g.nP, NT, 1794578400);
  for (let p = 0; p < g.nP; p++) for (let h = 0; h < NT; h++) s.precip[p * NT + h] = fn(p, h);
  return s;
}
function randomSeries(seed) {
  const r = mulberry32(seed), s = createSeries(grid.nP, NT, 1794578400);
  for (let i = 0; i < grid.nP * NT; i++) {
    s.precip[i] = r() < 0.5 ? 0 : 0.05 + r() * 20;
    s.low[i] = Math.floor(r() * 101); s.mid[i] = Math.floor(r() * 101); s.high[i] = Math.floor(r() * 101);
    s.windSpeed[i] = r() * 40; s.windDir[i] = r() * 360;
  }
  return s;
}
const rndSeries = randomSeries(42), f = createWeatherField(grid, rndSeries);
const C = [-53.4, -30.4];   // ponto no interior da grade

test('A1: rain > 0 implica célula bruta molhada', () => {
  const r = mulberry32(7); let wet = 0;
  for (let k = 0; k < 20000; k++) {
    const lon = -54.2 + r() * 2.2, lat = -31.2 + r() * 2.2, t = r() * 23;
    if (f.rain(lon, lat, t) > 0) { wet++; const p = grid.nearest(lon, lat), h = Math.ceil(t); assert(rndSeries.precip[p * NT + h] >= 0.1, `k=${k}`); }
  }
  assert(wet > 2000, `só ${wet} amostras molhadas`);
});
test('A1 no limiar: P = 0,09 nunca chove; P = 0,1 chove no meio do intervalo', () => {
  const dry = createWeatherField(grid, seriesWith(grid, () => 0.09)), wet = createWeatherField(grid, seriesWith(grid, () => 0.1));
  for (let t = 0; t < 23; t += 0.37) assert.equal(dry.rain(C[0], C[1], t), 0);
  assert(wet.rain(C[0], C[1], 5.5) > 0);
});
test('célula molhada, meio do intervalo, vizinhas iguais: rain === P[h]', () => {
  const w = createWeatherField(grid, seriesWith(grid, (p, h) => (h === 6 ? 5 : 0)));
  near(w.rain(C[0], C[1], 5.5), 5, 1e-5);
});
test('degrau: P[h]=5, P[h+1]=0 → chove em h-0,5 e não em h+0,5', () => {
  const w = createWeatherField(grid, seriesWith(grid, (p, h) => (h === 6 ? 5 : 0)));
  assert(w.rain(C[0], C[1], 5.5) > 0); assert.equal(w.rain(C[0], C[1], 6.5), 0); assert.equal(w.rain(C[0], C[1], 4.9), 0);
});
test('fade só de intensidade: hora anterior seca → cresce nos primeiros 10 min', () => {
  const w = createWeatherField(grid, seriesWith(grid, (p, h) => (h === 6 ? 5 : 0)));
  const a = w.rain(C[0], C[1], 5.02), b = w.rain(C[0], C[1], 5.5);
  assert(a > 0 && a < b);
  assert(w.rain(C[0], C[1], 5.98) < b);                    // e some nos últimos 10 min se a próxima hora é seca
});
test('entre duas horas molhadas a intensidade faz crossfade, sem buraco', () => {
  const w = createWeatherField(grid, seriesWith(grid, (p, h) => (h === 6 ? 2 : h === 7 ? 8 : 0)));
  near(w.rain(C[0], C[1], 6.0), 2, 1e-5); near(w.rain(C[0], C[1], 6.5), 8, 1e-5);
  const m = w.rain(C[0], C[1], 6.05); assert(m > 2 && m < 8);
});
test('suavização só dentro de célula molhada: vizinha seca reduz a intensidade mas não vaza', () => {
  const w = createWeatherField(grid, seriesWith(grid, (p, h) => (p % 8 < 4 ? 6 : 0)));   // metade oeste molhada
  const edgeWet = w.rain(-53.25 + 0.1, -30.4, 5.5), inner = w.rain(-53.75, -30.5, 5.5);
  assert(edgeWet > 0 && edgeWet < inner);
  assert.equal(w.rain(-53.0 - 0.1, -30.4, 5.5), 0);       // dono é o nó seco (i=4)
});
test('bilinear reproduz o nó exato', () => {
  for (let p = 0; p < grid.nP; p += 3) for (let h = 0; h < NT; h += 5) {
    const s = f.sample(grid.lons[p], grid.lats[p], h);
    near(s.low, rndSeries.low[p * NT + h], 1e-3); near(s.high, rndSeries.high[p * NT + h], 1e-3);
  }
});
test('bilinear é contínua entre células', () => {
  for (const x of [-53.75, -53.5, -53.0]) {
    const a = f.sample(x - 1e-6, -30.33, 4.3), b = f.sample(x + 1e-6, -30.33, 4.3);
    for (const k of ['low', 'mid', 'high', 'u', 'v']) near(a[k], b[k], 1e-2);
  }
});
test('linear no tempo', () => {
  const p = 20, s = f.sample(grid.lons[p], grid.lats[p], 7.5);
  near(s.low, (rndSeries.low[p * NT + 7] + rndSeries.low[p * NT + 8]) / 2, 1e-3);
});
test('vento: 350° e 10° interpolam para ~norte, não sul', () => {
  const g2 = makeGrid({ lon0: -54, lat0: -31, step: 0.25, nx: 2, ny: 1, cells: [0, 1] }), s = createSeries(2, NT, 0);
  for (let h = 0; h < NT; h++) { s.windSpeed[h] = 10; s.windDir[h] = 350; s.windSpeed[NT + h] = 10; s.windDir[NT + h] = 10; }
  const o = createWeatherField(g2, s).sample(-53.875, -31, 3);
  near(o.u, 0, 1e-3); assert(o.v < -9, `v=${o.v}`); near(o.speed, Math.hypot(o.u, o.v), 1e-6);   // vento de norte sopra para o sul
});
test('storm só com código 95–99 na hora ativa', () => {
  const s = seriesWith(grid), p = grid.nearest(C[0], C[1]);
  [0, 61, 94, 95, 96, 99, 100].forEach((c, i) => { s.code[p * NT + i + 1] = c; });
  const w = createWeatherField(grid, s);
  assert.deepEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5].map((t) => w.storm(C[0], C[1], t)), [false, false, false, true, true, true, false]);
});
test('bordas do domínio: valores finitos, sem exceção', () => {
  for (const t of [0, NT - 1, -5, 999, 0.0001, NT - 1.0001]) for (const [lon, lat] of [C, [-74, -10], [-54, -31], [-52.25, -29.25]]) {
    const s = f.sample(lon, lat, t);
    for (const k of ['low', 'mid', 'high', 'u', 'v', 'speed']) assert(Number.isFinite(s[k]), `${k} t=${t}`);
    assert(Number.isFinite(f.rain(lon, lat, t))); assert.equal(typeof f.storm(lon, lat, t), 'boolean');
  }
  assert.equal(f.activeHour(0), 0); assert.equal(f.activeHour(-3), 0); assert.equal(f.activeHour(999), NT - 1); assert.equal(f.activeHour(4.2), 5);
});
test('canto ausente renormaliza os pesos', () => {
  const g3 = makeGrid({ lon0: -54, lat0: -31, step: 0.25, nx: 3, ny: 3, cells: [0, 1, 2, 3, 4, 5, 6, 7] }), s = createSeries(8, NT, 0);
  const vals = [10, 20, 30, 40, 50, 60, 70, 80];
  for (let p = 0; p < 8; p++) for (let h = 0; h < NT; h++) s.low[p * NT + h] = vals[p];
  const v = createWeatherField(g3, s).sample(-53.6, -30.6, 2).low;     // célula com cantos p=4,5,7 e (2,2) ausente
  assert(v >= 50 && v <= 80, `low=${v}`);
});
test('cellInfo devolve bruto do nó dono e null fora (> 1 célula)', () => {
  const p = grid.nearest(C[0], C[1]), info = f.cellInfo(C[0], C[1], 4.2);
  assert.equal(info.p, p); assert.equal(info.h, 5);
  near(info.precip, rndSeries.precip[p * NT + 5], 1e-6); assert.equal(info.low, rndSeries.low[p * NT + 4]);
  near(info.lon, grid.lons[p]); near(info.windSpeed, rndSeries.windSpeed[p * NT + 4], 1e-6);
  assert.equal(f.cellInfo(-60, -20, 4.2), null);
});
test('anyRainByHour marca as horas com alguma célula molhada', () => {
  const w = createWeatherField(grid, seriesWith(grid, (p, h) => (h === 6 && p === 3 ? 1 : h === 9 ? 0.05 : 0)));
  const a = w.anyRainByHour();
  assert.equal(a.length, NT); assert.equal(a[6], 1); assert.equal(a[9], 0); assert.equal(a[5], 0);
});
