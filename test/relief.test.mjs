import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseRelief } from '../src/data/relief.js';

const buf = gunzipSync(readFileSync('assets/relief.bin.gz'));
const r = parseRelief(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
// altitudes de referência com folga larga: a grade tem ~1,5 km e é média de área
const near = (name, lon, lat, lo, hi) => test(`${name}: entre ${lo} e ${hi} m`, () => {
  const m = r.metersAt(lon, lat);
  assert.ok(m >= lo && m <= hi, `${name} = ${m.toFixed(0)} m`);
});
near('Porto Alegre (centro)', -51.23, -30.03, 0, 80);
near('Caxias do Sul', -51.18, -29.17, 550, 950);
near('São José dos Ausentes', -50.07, -28.75, 1000, 1400);
near('Santa Maria', -53.81, -29.69, 60, 250);
near('Lagoa dos Patos (água vira 0)', -51.2, -31.0, 0, 5);
test('cabeçalho e cobertura do estado', () => {
  assert.equal(r.w, 512);
  assert.ok(r.lon0 < -57.6 && r.lon1 > -49.7 && r.latS < -33.7 && r.latN > -27.1);
  assert.ok(r.max > 1300 && r.max < 2000);
});
