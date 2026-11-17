import test from 'node:test';
import assert from 'node:assert/strict';
import { carryTime } from '../src/ui/clock-carry.js';

const H = 3600, base = 1_800_000_000 - (1_800_000_000 % H);
const times = (start, n) => Float64Array.from({ length: n }, (_, i) => start + i * H);
test('mesmo instante em série que começa 2 h depois', () => assert.equal(carryTime({ t: 10.5, times: times(base, 168) }, times(base + 2 * H, 168), { tNow: 0, tMax: 72 }), 8.5));
test('instante antes do início da série nova: vai para tNow', () => assert.equal(carryTime({ t: 1, times: times(base, 168) }, times(base + 5 * H, 168), { tNow: 0.25, tMax: 72 }), 0.25));
test('instante depois do fim da faixa: vai para tMax', () => assert.equal(carryTime({ t: 150, times: times(base, 168) }, times(base, 168), { tNow: 0, tMax: 72 }), 72));
test('nunca devolve NaN', () => assert.ok(Number.isFinite(carryTime({ t: NaN, times: times(base, 168) }, times(base, 168), { tNow: 3, tMax: 72 }))));
