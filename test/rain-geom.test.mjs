import test from 'node:test';
import assert from 'node:assert/strict';
import { rainTilt, RAIN_TOP } from '../src/render/rain.js';
import { makeProjection, RS_PROJECTION } from '../src/geo/projection.js';

const cell = makeProjection(RS_PROJECTION).cell(0.25);

test('Final#5: inclinação limitada a 1/4 de célula no topo do traço, com vento forte', () => {
  for (const [u, v] of [[30, 0], [50, 0], [0, -80], [60, 60], [-120, 10]]) {
    const { tx, tz } = rainTilt(u, v, cell);
    assert(Math.hypot(tx, tz) * RAIN_TOP <= 0.25 * Math.min(cell.x, cell.z) + 1e-9, `u=${u} v=${v}`);
  }
});
test('Final#5: vento fraco ainda inclina na direção do vento', () => {
  const { tx, tz } = rainTilt(10, 0, cell); assert(tx > 0); assert.equal(tz + 0, 0);
  const n = rainTilt(0, 10, cell); assert(n.tz < 0);              // vento para o norte inclina para -z
});
