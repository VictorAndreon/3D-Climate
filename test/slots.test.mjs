import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSlots } from '../src/render/slots.js';

const args = { minX: -40, maxX: 40, minZ: -40, maxZ: 40, count: 2000, seed: 1, accept: () => true };
const s = makeSlots(args);
const n = s.length / 5;
const spacing = Math.sqrt((80 * 80) / n / (Math.sqrt(3) / 2));

test('5 valores por slot e quantidade dentro de ±10% do pedido', () => { assert.equal(s.length % 5, 0); assert(Math.abs(n - 2000) < 200, `n=${n}`); });
test('determinístico por semente', () => assert.deepEqual(makeSlots({ ...args }), s));
test('semente diferente muda o resultado', () => assert.notDeepEqual(makeSlots({ ...args, seed: 2 }), s));
test('u em [0; 0,9], size01 e seed01 em [0; 1)', () => {
  for (let i = 0; i < s.length; i += 5) { assert(s[i + 4] >= 0 && s[i + 4] <= 0.9); assert(s[i + 2] >= 0 && s[i + 2] < 1); assert(s[i + 3] >= 0 && s[i + 3] < 1); }
});
test('accept filtra e a contagem pedida vale para a área aceita', () => {
  const h = makeSlots({ ...args, accept: (x) => x < 0 });
  for (let i = 0; i < h.length; i += 5) assert(h[i] < 0);
  assert(Math.abs(h.length / 5 - 2000) < 200, `n=${h.length / 5}`);
});
test('sem pares colados (vizinho mais próximo > 0,15 do espaçamento)', () => {
  let min = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = Math.hypot(s[i * 5] - s[j * 5], s[i * 5 + 1] - s[j * 5 + 1]);
    if (d < min) min = d;
  }
  assert(min > 0.15 * spacing, `min=${min} spacing=${spacing}`);
});
test('sem grade: x mod espaçamento espalhado como uniforme', () => {
  let m = 0, v = 0;
  const r = []; for (let i = 0; i < n; i++) r.push(((s[i * 5] % spacing) + spacing) % spacing);
  for (const x of r) m += x; m /= n;
  for (const x of r) v += (x - m) ** 2;
  assert(Math.sqrt(v / n) > 0.2 * spacing);
});
test('ordem embaralhada: a primeira metade cobre a área toda', () => {
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < n / 2; i++) { minX = Math.min(minX, s[i * 5]); maxX = Math.max(maxX, s[i * 5]); }
  assert(minX < -35 && maxX > 35);
});
