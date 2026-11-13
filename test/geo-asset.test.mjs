import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { near } from './helpers.mjs';

const geo = JSON.parse(readFileSync('assets/rs.json', 'utf8'));
test('tamanho ≤ 350 KB', () => assert(statSync('assets/rs.json').size <= 350 * 1024));
test('grade 0,25° alinhada', () => { assert.equal(geo.grid.step, 0.25); assert(Number.isInteger(geo.grid.lon0 / 0.25)); assert(Number.isInteger(geo.grid.lat0 / 0.25)); });
test('546 pontos (±10% se a fonte mudar)', () => assert(geo.grid.cells.length >= 490 && geo.grid.cells.length <= 600));
test('gridVersion carrega nP', () => assert(geo.gridVersion.endsWith(':' + geo.grid.cells.length)));
test('496 municípios com centroide dentro do bbox do RS', () => {
  assert.equal(geo.municipios.length, 496);
  for (const [n, lon, lat] of geo.municipios) assert(n && lon > -57.7 && lon < -49.6 && lat > -33.8 && lat < -27.0, n);
});
test('Porto Alegre perto de (-51,2; -30,1)', () => { const m = geo.municipios.find((m) => m[0] === 'Porto Alegre'); near(m[1], -51.2, 0.15); near(m[2], -30.1, 0.15); });
test('contorno tem um anel principal com mais de 200 vértices', () => assert(Math.max(...geo.outline.map((p) => p[0].length / 2)) > 200));
test('bordas são polilinhas com pelo menos 2 vértices', () => { assert(geo.borders.length > 100); for (const b of geo.borders) assert(b.length >= 4 && b.length % 2 === 0); });
