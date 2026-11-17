import test from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, MAX_POINTS, pickStep } from '../src/geo/steps.js';

test('lista de passos e teto', () => { assert.deepEqual(STEPS, [0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.75, 1, 1.25, 1.5]); assert.equal(MAX_POINTS, 550); });
test('pickStep: o menor passo da lista que cabe no teto', () => {
  const n = (s) => Math.round(2000 * (0.25 / s) ** 2);              // contagem injetada: 2000 a 0,25
  const r = pickStep(n);
  assert.ok(r.nP <= 550); assert.equal(r.nP, n(r.step));
  const i = STEPS.indexOf(r.step); assert.ok(i > 0 && n(STEPS[i - 1]) > 550, 'o passo anterior passaria do teto');
});
test('pickStep: quem já cabe a 0,25 fica a 0,25; o Brasil começa em 1', () => {
  assert.equal(pickStep(() => 546).step, 0.25);
  assert.equal(pickStep((s) => (s < 1.25 ? 900 : 500), 1).step, 1.25);
});
test('pickStep: nada cabe -> erro', () => { assert.throws(() => pickStep(() => 9999)); });
