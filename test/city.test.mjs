import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMunicipioIndex, rainOutlook, totalCover } from '../src/data/city.js';

const mun = JSON.parse(readFileSync('assets/municipios.json', 'utf8'));
const geo = JSON.parse(readFileSync('assets/rs.json', 'utf8'));
const idx = createMunicipioIndex(mun.items);

test('municipios.json casa com rs.json: mesmos nomes, mesma ordem, mesma grade', () => {
  assert.equal(mun.gridVersion, geo.gridVersion);
  assert.deepEqual(mun.items.map((i) => i[1]), geo.municipios.map((m) => m[0]));
});
test('ponto dentro do município', () => {
  assert.equal(idx.find(-51.2, -30.05)?.name, 'Porto Alegre');
  assert.equal(idx.find(-53.8, -29.7)?.name, 'Santa Maria');
});
test('fora do estado não acha município', () => assert.equal(idx.find(-49, -31), null));
test('quase todo centroide cai no próprio município (simplificação pode deslocar poucos)', () => {
  const hits = geo.municipios.filter(([name, lon, lat]) => idx.find(lon, lat)?.name === name).length;
  assert.ok(hits / geo.municipios.length > 0.97, `${hits}/${geo.municipios.length}`);
});
test('área aproximada perto da oficial do IBGE', () => {
  assert.ok(Math.abs(idx.byName('Porto Alegre').area - 495) < 15);
  assert.ok(Math.abs(idx.byName('Alegrete').area - 7804) < 150);
});
test('totalCover: camadas independentes', () => {
  assert.equal(totalCover(0, 0, 0), 0);
  assert.equal(totalCover(100, 0, 0), 100);
  assert.ok(Math.abs(totalCover(50, 50, 0) - 75) < 1e-9);
});

const pt = (precip, code = precip.map(() => 0)) => ({ precip: Float32Array.from(precip), code: Uint8Array.from(code) });
test('rainOutlook: seco agora, próxima chuva começa no início do intervalo molhado', () => {
  // precip[3] cobre (2, 3]: a chuva começa em t = 2
  const o = rainOutlook(pt([0, 0, 0, 1.5, 2, 0, 0]), 0, 6);
  assert.equal(o.rainingNow, false); assert.equal(o.change, 2);
  assert.equal(o.wetHours, 2); assert.ok(Math.abs(o.totalMm - 3.5) < 1e-6); assert.equal(o.peakHour, 4);
});
test('rainOutlook: chovendo agora, para quando vem a primeira hora seca; conta trovoada', () => {
  const o = rainOutlook(pt([0, 3, 3, 0.05, 0], [0, 95, 63, 0, 0]), 0.5, 4);
  assert.equal(o.rainingNow, true); assert.equal(o.change, 2);
  assert.equal(o.stormHours, 1); assert.equal(o.wetHours, 2);
});
test('rainOutlook: hora cheia não conta o intervalo que já passou', () => {
  assert.equal(rainOutlook(pt([0, 5, 0, 0]), 1, 3).wetHours, 0);
});
