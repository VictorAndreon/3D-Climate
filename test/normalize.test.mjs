import test from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.mjs';
import { makeGrid } from '../src/data/grid.js';
import { normalizeResponse, buildSeries, findNowIndex, HOURLY } from '../src/data/normalize.js';

const g2 = makeGrid({ lon0: -54, lat0: -31, step: 0.25, nx: 2, ny: 1, cells: [0, 1] });
const loc = (over = {}, time = [100, 3700]) => ({
  latitude: -29.982, longitude: -50.979,
  hourly: { time, ...Object.fromEntries(HOURLY.map((k) => [k, time.map(() => 1)])), ...over },
});
const times = (start, n) => Float64Array.from({ length: n }, (_, i) => start + i * 3600);

test('objeto único vira array', () => assert.equal(normalizeResponse({ hourly: {} }).length, 1));
test('array passa direto', () => assert.equal(normalizeResponse([{}, {}]).length, 2));
test('error:true lança com reason', () => assert.throws(() => normalizeResponse({ error: true, reason: 'x inválido' }), /x inválido/));
test('resposta que não é objeto nem array lança', () => { assert.throws(() => normalizeResponse(null)); assert.throws(() => normalizeResponse('oops')); });
test('null vira 0', () => {
  const s = buildSeries(g2, [loc({ precipitation: [null, 1.2], cloud_cover_low: [null, 40] }), loc()]);
  assert.equal(s.precip[0], 0); near(s.precip[1], 1.2, 1e-6); assert.equal(s.low[0], 0); assert.equal(s.low[1], 40);
});
test('mapeia pela ordem, ignorando latitude/longitude devolvidas', () => {
  const s = buildSeries(g2, [loc({ cloud_cover_mid: [11, 12] }), loc({ cloud_cover_mid: [21, 22] })]);
  assert.deepEqual([...s.mid], [11, 12, 21, 22]); assert.equal(s.nP, 2); assert.equal(s.nT, 2); assert.deepEqual([...s.times], [100, 3700]);
});
test('todos os campos vão para o lugar certo', () => {
  const s = buildSeries(g2, [loc({ cloud_cover_high: [7, 8], weather_code: [95, 3], wind_speed_10m: [12.5, 3], wind_direction_10m: [270, 90] }), loc()]);
  assert.deepEqual([s.high[0], s.code[0], s.windSpeed[0], s.windDir[0]], [7, 95, 12.5, 270]);
});
test('cobertura fora de faixa é limitada a 0–100', () => { const s = buildSeries(g2, [loc({ cloud_cover_low: [140, -3] }), loc()]); assert.deepEqual([s.low[0], s.low[1]], [100, 0]); });
test('lança com número errado de locais', () => assert.throws(() => buildSeries(g2, [loc()]), /locais/));
test('lança com série de tamanho diferente de time', () => assert.throws(() => buildSeries(g2, [loc({ precipitation: [1] }), loc()]), /precipitation/));
test('lança com série ausente', () => { const l = loc(); delete l.hourly.weather_code; assert.throws(() => buildSeries(g2, [l, loc()]), /weather_code/); });
test('lança com time divergente entre locais', () => assert.throws(() => buildSeries(g2, [loc(), loc({}, [100, 9999])]), /time/));
test('lança com time vazio', () => assert.throws(() => buildSeries(g2, [loc({}, []), loc({}, [])])));
test('findNowIndex: série começando na hora corrente', () => assert.equal(findNowIndex(times(1794578400, 168), 1794580860), 0));
test('findNowIndex: série começando à meia-noite local (03:00Z)', () => assert.equal(findNowIndex(times(1794538800, 168), 1794580860), 11));
test('findNowIndex: antes do início → 0; depois do fim → nT-1', () => { assert.equal(findNowIndex(times(1000000, 10), 5), 0); assert.equal(findNowIndex(times(1000000, 10), 9e9), 9); });
