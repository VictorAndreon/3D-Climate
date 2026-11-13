import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticField } from '../src/data/analytic.js';
import { mulberry32 } from '../src/util/rng.js';

const START = 1794578400;
const f = analyticField({ startUnix: START });
const lattice = [];
for (let lon = -57.5; lon <= -49.75; lon += 0.25) for (let lat = -33.75; lat <= -27; lat += 0.25) lattice.push([lon, lat]);

test('times de hora em hora, 168 por padrão', () => { assert.equal(f.nT, 168); assert.equal(f.times[0], START); assert.equal(f.times[1] - f.times[0], 3600); });
test('determinístico', () => assert.deepEqual(f.sample(-53, -30, 5.3), analyticField({ startUnix: START }).sample(-53, -30, 5.3)));
test('tem céu limpo (≥ 20% da área) e tem chuva em toda hora de 0 a 72', () => {
  for (let t = 0; t <= 72; t++) {
    let clear = 0, wet = 0;
    for (const [lon, lat] of lattice) { const s = f.sample(lon, lat, t); if (s.low + s.mid + s.high === 0) clear++; if (f.rain(lon, lat, t) > 0) wet++; }
    assert(clear / lattice.length >= 0.2, `t=${t} limpo=${clear / lattice.length}`);
    assert(wet > 0, `t=${t} sem chuva`);
  }
});
test('há trovoada em alguma hora, sempre onde chove', () => {
  let storms = 0;
  for (let t = 0; t <= 72; t++) for (const [lon, lat] of lattice) if (f.storm(lon, lat, t)) { storms++; assert(f.rain(lon, lat, t) > 0); }
  assert(storms > 0);
});
test('onde chove, low ≥ 70 e a taxa é ≥ 0,15 mm/h', () => {
  for (let t = 0; t <= 72; t += 3) for (const [lon, lat] of lattice) { const r = f.rain(lon, lat, t); if (r > 0) { assert(r >= 0.15); assert(f.sample(lon, lat, t).low >= 70); } }
});
test('valores finitos e nas faixas', () => {
  const r = mulberry32(3);
  for (let k = 0; k < 2000; k++) {
    const lon = -58 + r() * 9, lat = -34 + r() * 7.5, t = r() * 167;
    const s = f.sample(lon, lat, t);
    for (const k2 of ['low', 'mid', 'high']) assert(s[k2] >= 0 && s[k2] <= 100);
    for (const k2 of ['u', 'v', 'speed']) assert(Number.isFinite(s[k2]));
    const rr = f.rain(lon, lat, t); assert(rr >= 0 && rr < 80 && Number.isFinite(rr));
  }
});
test('sample aceita objeto de saída', () => { const out = {}; assert.equal(f.sample(-53, -30, 1, out), out); assert('low' in out); });
