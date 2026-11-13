import test from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.mjs';
import { toScene, toLonLat, CELL_X, CELL_Z } from '../src/geo/projection.js';

test('centro vai para a origem', () => { const p = toScene(-53.2, -30.4); near(p.x, 0); near(p.z, 0); });
test('norte é -z, leste é +x', () => { assert(toScene(-53.2, -29.4).z < 0); assert(toScene(-52.2, -30.4).x > 0); });
test('1 grau de latitude = 11,132 unidades', () => near(toScene(-53.2, -29.4).z, -11.132, 1e-3));
test('ida e volta', () => { const s = toScene(-51.23, -29.87); const q = toLonLat(s.x, s.z); near(q.lon, -51.23, 1e-9); near(q.lat, -29.87, 1e-9); });
test('estado tem ~75 unidades de largura', () => { const w = toScene(-49.69, -30.4).x - toScene(-57.64, -30.4).x; assert(w > 72 && w < 80); });
test('tamanho de célula de 0,25°', () => { near(CELL_Z, 2.783, 1e-3); assert(CELL_X > 2.3 && CELL_X < 2.5); });
