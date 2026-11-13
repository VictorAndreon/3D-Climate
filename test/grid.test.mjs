import test from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.mjs';
import { makeGrid } from '../src/data/grid.js';

// grade de brinquedo 3x3 sem o canto (2,2)
const g = makeGrid({ lon0: -54, lat0: -31, step: 0.25, nx: 3, ny: 3, cells: [0, 1, 2, 3, 4, 5, 6, 7] });
test('nP e coordenadas', () => { assert.equal(g.nP, 8); near(g.lons[4], -53.75); near(g.lats[4], -30.75); });
test('nearest no nó exato e no meio da célula', () => { assert.equal(g.nearest(-53.75, -30.75), 4); assert.equal(g.nearest(-53.74, -30.9), 1); });
test('nearest em célula ausente cai no vizinho presente', () => assert([5, 7].includes(g.nearest(-53.5, -30.5))));
test('nearest fora da malha não devolve -1', () => assert(g.nearest(-70, 10) >= 0));
test('distCells', () => { near(g.distCells(-53.75, -30.75), 0); assert(g.distCells(-70, 10) > 1); });
test('index mapeia célula da malha para p ou -1', () => { assert.equal(g.index[4], 4); assert.equal(g.index[8], -1); });
