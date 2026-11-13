import test from 'node:test';
import assert from 'node:assert/strict';
import { rainTilt, RAIN_TOP } from '../src/render/rain.js';
import { CELL_X, CELL_Z } from '../src/geo/projection.js';

test('Final#5: inclinação limitada a 1/4 de célula no topo do traço, com vento forte', () => {
  for (const [u, v] of [[30, 0], [50, 0], [0, -80], [60, 60], [-120, 10]]) {
    const { tx, tz } = rainTilt(u, v);
    assert(Math.hypot(tx, tz) * RAIN_TOP <= 0.25 * Math.min(CELL_X, CELL_Z) + 1e-9, `u=${u} v=${v}`);
  }
});
test('Final#5: vento fraco ainda inclina na direção do vento', () => {
  const { tx, tz } = rainTilt(10, 0); assert(tx > 0); assert.equal(tz + 0, 0);
  const n = rainTilt(0, 10); assert(n.tz < 0);              // vento para o norte inclina para -z
});
