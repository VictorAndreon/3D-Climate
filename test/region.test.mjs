import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadIndex, loadRegion } from '../src/data/region.js';
import { framing } from '../src/render/scene.js';

// lê do disco no lugar do fetch do navegador
const fetchImpl = async (url) => ({ ok: true, json: async () => JSON.parse(readFileSync(url, 'utf8')) });
const load = async (id) => loadRegion((await loadIndex(fetchImpl)).find((r) => r.id === id), fetchImpl);

test('loadIndex: Brasil + 27 UFs', async () => { const i = await loadIndex(fetchImpl); assert.equal(i.length, 28); assert.equal(i[0].id, 'BR'); });
test('RS: projeção, grade, relevo e municípios', async () => {
  const r = await load('RS');
  assert.equal(r.proj.kmPerUnit, 10); assert.equal(r.grid.nP, 546); assert.equal(r.hasRelief, true); assert.equal(r.hasCities, true);
  assert.equal(r.tz, 'America/Sao_Paulo'); assert.equal(r.gridVersion, 'g1:-58:-34.25:36x31:546');
  assert.equal(r.munUrl, './assets/regions/RS-mun.json'); assert.ok(r.geo.outline.length > 0);
});
test('BR: grade de 1°, sem municípios nem relevo', async () => {
  const r = await load('BR');
  assert.equal(r.grid.step, 1); assert.equal(r.hasCities, false); assert.equal(r.hasRelief, false); assert.equal(r.munUrl, null);
});
test('AM: bounds do estado cabe em ~80 unidades', async () => {
  const { bounds: b } = await load('AM');
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  assert.ok(w > 60 && w < 80, `largura ${w}`);
  assert.ok(d > 40 && d < 80, `profundidade ${d}`);            // AM é mais largo que fundo: 60..80 só vale para o lado maior
  assert.ok(Math.abs(b.minX + b.maxX) < 1, 'a projeção está centrada no estado');
});
test('só o RS tem relevo', async () => { assert.equal((await load('SP')).hasRelief, false); assert.equal((await load('SP')).hasCities, true); });

test('câmera do RS reproduz os números de hoje (±1 unidade)', async () => {
  const f = framing((await load('RS')).bounds);
  const close = (a, b) => assert.ok(Math.abs(a - b) <= 1, `${a} !~ ${b}`);
  close(f.target.x, -4.5); close(f.target.z, 6);
  close(f.pan.minX, -43); close(f.pan.maxX, 34); close(f.pan.minZ, -37); close(f.pan.maxZ, 38);
  close(f.dist, 100); close(f.distTop, 132); close(f.maxDistance, 135); close(f.distFly, 150);
});
test('câmera de um estado pequeno encolhe com ele e a de um grande se mantém', async () => {
  const df = framing((await load('DF')).bounds), sp = framing((await load('SP')).bounds);
  assert.ok(df.dist < 60, `DF ${df.dist}`);
  assert.ok(sp.dist > 90 && sp.dist < 110, `SP ${sp.dist}`);
  assert.ok(df.pan.minX < df.target.x && df.target.x < df.pan.maxX);
});
