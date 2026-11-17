import test from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.mjs';
import { makeProjection, fitProjection, RS_PROJECTION } from '../src/geo/projection.js';

const rs = makeProjection(RS_PROJECTION);
const { toScene, toLonLat } = rs;
const CELL_X = rs.cell(0.25).x, CELL_Z = rs.cell(0.25).z;

test('centro vai para a origem', () => { const p = toScene(-53.2, -30.4); near(p.x, 0); near(p.z, 0); });
test('norte é -z, leste é +x', () => { assert(toScene(-53.2, -29.4).z < 0); assert(toScene(-52.2, -30.4).x > 0); });
test('1 grau de latitude = 11,132 unidades', () => near(toScene(-53.2, -29.4).z, -11.132, 1e-3));
test('ida e volta', () => { const s = toScene(-51.23, -29.87); const q = toLonLat(s.x, s.z); near(q.lon, -51.23, 1e-9); near(q.lat, -29.87, 1e-9); });
test('estado tem ~75 unidades de largura', () => { const w = toScene(-49.69, -30.4).x - toScene(-57.64, -30.4).x; assert(w > 72 && w < 80); });
test('tamanho de célula de 0,25°', () => { near(CELL_Z, 2.783, 1e-3); assert(CELL_X > 2.3 && CELL_X < 2.5); });

test('RS: mesma conta de hoje', () => {
  const p = makeProjection(RS_PROJECTION), s = p.toScene(-51.2, -30.0);
  assert.ok(Math.abs(s.x - 2 * Math.cos((-30.4 * Math.PI) / 180) * 11.132) < 1e-9);
  assert.ok(Math.abs(s.z - -0.4 * 11.132) < 1e-9);
  assert.ok(Math.abs(p.cell(0.25).z - 0.25 * 11.132) < 1e-12);
});
test('ida e volta em qualquer região', () => {
  const p = makeProjection({ lon0: -60, lat0: -4, kmPerUnit: 25 }), ll = p.toLonLat(...Object.values(p.toScene(-63.1, -2.7)));
  assert.ok(Math.abs(ll.lon - -63.1) < 1e-9 && Math.abs(ll.lat - -2.7) < 1e-9);
});
test('escala: 25 km por unidade encolhe 2,5× em relação a 10', () => {
  const a = makeProjection({ lon0: 0, lat0: 0, kmPerUnit: 10 }).toScene(1, 1), b = makeProjection({ lon0: 0, lat0: 0, kmPerUnit: 25 }).toScene(1, 1);
  assert.ok(Math.abs(a.x / b.x - 2.5) < 1e-9 && Math.abs(a.z / b.z - 2.5) < 1e-9);
});
test('fitProjection: Brasil cabe em ~77 unidades', () => {
  const f = fitProjection({ minLon: -74, maxLon: -32.4, minLat: -33.8, maxLat: 5.3 });
  assert.ok(Math.abs(f.lon0 - -53.2) < 1e-9 && Math.abs(f.lat0 - -14.25) < 1e-9);
  assert.ok(f.kmPerUnit > 55 && f.kmPerUnit < 62);
});
test('fitProjection: estado pequeno não passa de 3 km por unidade para baixo', () => {
  assert.equal(fitProjection({ minLon: -48.3, maxLon: -47.3, minLat: -16.1, maxLat: -15.5 }).kmPerUnit, 3);
});
