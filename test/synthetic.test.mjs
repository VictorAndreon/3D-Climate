import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { near } from './helpers.mjs';
import { makeGrid } from '../src/data/grid.js';
import { analyticField } from '../src/data/analytic.js';
import { syntheticSeries, seriesToApiJson } from '../src/data/synthetic.js';

const grid = makeGrid(JSON.parse(readFileSync('assets/rs.json', 'utf8')).grid);
const START = 1794578400, s = syntheticSeries(grid, START), a = analyticField({ startUnix: START });

test('times de hora em hora a partir de startUnix, 168 h', () => { assert.equal(s.nT, 168); assert.equal(s.nP, grid.nP); assert.equal(s.times[0], START); assert.equal(s.times[167], START + 167 * 3600); });
test('precip[h] é a taxa analítica no meio do intervalo (h-1, h]', () => {
  for (const p of [0, 100, 300, 545]) for (const h of [1, 7, 30]) near(s.precip[p * 168 + h], a.rain(grid.lons[p], grid.lats[p], h - 0.5), 1e-4);
});
test('código 95 exatamente onde o analítico tem trovoada', () => {
  let n = 0;
  for (let p = 0; p < grid.nP; p++) for (let h = 1; h < 72; h++) {
    const st = a.storm(grid.lons[p], grid.lats[p], h - 0.5);
    assert.equal(s.code[p * 168 + h] === 95, st); if (st) { n++; assert(s.precip[p * 168 + h] >= 0.1); }
  }
  assert(n > 0);
});
test('vento: direção "de onde vem" coerente com u, v', () => {
  const o = a.sample(grid.lons[50], grid.lats[50], 3), sp = s.windSpeed[50 * 168 + 3], d = (s.windDir[50 * 168 + 3] * Math.PI) / 180;
  near(-sp * Math.sin(d), o.u, 1e-2); near(-sp * Math.cos(d), o.v, 1e-2);
});
test('seriesToApiJson: um objeto por ponto, no formato da API', () => {
  const j = seriesToApiJson(grid, s);
  assert.equal(j.length, grid.nP);
  assert.deepEqual(Object.keys(j[0].hourly), ['time', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'precipitation', 'weather_code', 'wind_speed_10m', 'wind_direction_10m']);
  assert.equal(j[0].hourly.time.length, 168); assert.equal(j[0].hourly.time[0], START);
  near(j[7].latitude, grid.lats[7], 1e-6); near(j[7].longitude, grid.lons[7], 1e-6);
});
import { buildSeries } from '../src/data/normalize.js';
test('ida e volta: buildSeries(seriesToApiJson(s)) reproduz s', () => {
  const b = buildSeries(grid, JSON.parse(JSON.stringify(seriesToApiJson(grid, s))));
  assert.deepEqual(b.low, s.low); assert.deepEqual(b.mid, s.mid); assert.deepEqual(b.high, s.high); assert.deepEqual(b.code, s.code); assert.deepEqual(b.times, s.times);
  for (let i = 0; i < s.precip.length; i += 17) near(b.precip[i], s.precip[i], 0.0501);
});
