import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeGrid } from '../src/data/grid.js';
import { normalizeResponse, buildSeries, findNowIndex } from '../src/data/normalize.js';

const grid = makeGrid(JSON.parse(readFileSync('assets/rs.json', 'utf8')).grid);
test('assets/fixture.json passa pelo mesmo parsing da API', () => {
  const s = buildSeries(grid, normalizeResponse(JSON.parse(readFileSync('assets/fixture.json', 'utf8'))));
  assert.equal(s.nT, 168); assert.equal(s.nP, grid.nP); assert.equal(s.times[1] - s.times[0], 3600);
});
// respostas reais do Open-Meteo gravadas em 13/11/2026 14:41Z (2 pontos e 1 ponto)
test('resposta real de 2 pontos: array, 168 h, começa na hora corrente', () => {
  const g2 = makeGrid({ lon0: -51, lat0: -30, step: 0.25, nx: 2, ny: 1, cells: [0, 1] });
  const s = buildSeries(g2, normalizeResponse(JSON.parse(readFileSync('test/data/open-meteo-2pts.json', 'utf8'))));
  assert.equal(s.nT, 168); assert.equal(s.times[0], 1794578400); assert.equal(findNowIndex(s.times, 1794580860), 0);
  for (const v of s.low) assert(v >= 0 && v <= 100);
});
test('resposta real de 1 ponto: objeto único é normalizado', () => {
  const g1 = makeGrid({ lon0: -51, lat0: -30, step: 0.25, nx: 1, ny: 1, cells: [0] });
  const locs = normalizeResponse(JSON.parse(readFileSync('test/data/open-meteo-1pt.json', 'utf8')));
  assert.equal(locs.length, 1); assert.equal(buildSeries(g1, locs).nT, 168);
});
