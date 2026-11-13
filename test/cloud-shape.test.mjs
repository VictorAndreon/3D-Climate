import test from 'node:test';
import assert from 'node:assert/strict';
import { solidPuffShape, towerLevels, SOLID_LAYERS } from '../src/render/cloud-shape.js';

const base = { layer: 0, cover01: 0.6, presence: 1, rain: 0, storm: false, size01: 0.5 };
test('sem presença, raio 0 (nada desenhado)', () => assert.equal(solidPuffShape({ ...base, presence: 0 }).radius, 0));
test('raio cresce com a presença, sem estalo', () => {
  const a = solidPuffShape({ ...base, presence: 0.2 }).radius, b = solidPuffShape({ ...base, presence: 0.6 }).radius, c = solidPuffShape(base).radius;
  assert(a > 0 && a < b && b < c);
});
test('altura cresce com a cobertura', () => assert(solidPuffShape({ ...base, cover01: 1 }).height > solidPuffShape({ ...base, cover01: 0.2 }).height));
test('chuva faz a nuvem baixa crescer e escurecer', () => {
  const dry = solidPuffShape(base), wet = solidPuffShape({ ...base, rain: 8 });
  assert(wet.height > dry.height); assert.equal(dry.dark, 0); assert(wet.dark > 0.7 && wet.dark <= 1);
});
const top = (lv) => Math.max(...lv.map((l) => l.y + l.height));
test('trovoada vira torre (cumulonimbus) empilhada só na camada baixa', () => {
  const tower = towerLevels(solidPuffShape({ ...base, rain: 8, storm: true })), plain = towerLevels(solidPuffShape({ ...base, rain: 8 }));
  assert.equal(plain.length, 1); assert.equal(tower.length, 3);
  assert(top(tower) >= 2.2 * top(plain), `${top(tower)} vs ${top(plain)}`);
  for (const l of tower) assert(l.height / l.radius <= 1.2, 'nenhum nível esticado como ovo');
  for (let i = 1; i < tower.length; i++) assert(tower[i].radius < tower[i - 1].radius && tower[i].y > tower[i - 1].y);
  assert.equal(towerLevels(solidPuffShape({ ...base, layer: 1, storm: true })).length, 1);
});
test('camada média é achatada e escurece menos', () => {
  const lo = solidPuffShape(base), mid = solidPuffShape({ ...base, layer: 1 });
  assert(mid.height / mid.radius < lo.height / lo.radius);
  assert(solidPuffShape({ ...base, layer: 1, rain: 10 }).dark < solidPuffShape({ ...base, rain: 10 }).dark);
});
test('valores finitos nas bordas', () => {
  for (const layer of [0, 1]) for (const p of [0, 1]) for (const r of [0, 50]) {
    const s = solidPuffShape({ layer, cover01: p, presence: p, rain: r, storm: true, size01: p });
    for (const k of ['radius', 'height', 'dark']) assert(Number.isFinite(s[k]) && s[k] >= 0, `${k}`);
  }
});
test('duas camadas sólidas: baixa a 4, média a 7', () => assert.deepEqual(SOLID_LAYERS.map((l) => l.y), [4, 7]));
