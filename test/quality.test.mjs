import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuality, LEVELS } from '../src/render/quality.js';

/** Empurra quadros de `ms` por `segundos`; devolve a última troca de nível (ou null). */
const run = (q, ms, segundos, t0 = 0) => { let r = null; for (let t = t0; t < t0 + segundos * 1000; t += ms) r = q.push(ms, t) ?? r; return r; };

test('três níveis: alto, médio, baixo, com pixel ratio 1,5 / 1,25 / 1,0', () => {
  assert.deepEqual(LEVELS.map((l) => l.name), ['alto', 'médio', 'baixo']); assert.deepEqual(LEVELS.map((l) => l.pixelRatio), [1.5, 1.25, 1.0]);
  assert(LEVELS[1].slots < 1 && LEVELS[2].slots < LEVELS[1].slots); assert(LEVELS[2].puff > LEVELS[1].puff && LEVELS[1].puff > 1);
});
test('25 ms por 2,1 s desce um nível', () => { const q = createQuality({}); assert.equal(run(q, 25, 2.1), 1); assert.equal(q.level, 1); });
test('25 ms por 1,5 s não desce', () => { const q = createQuality({}); assert.equal(run(q, 25, 1.5), null); assert.equal(q.level, 0); });
test('não passa do nível 2', () => { const q = createQuality({ level: 2 }); assert.equal(run(q, 40, 10), null); assert.equal(q.level, 2); });
test('10 ms por 10,1 s sobe um nível', () => { const q = createQuality({ level: 1 }); assert.equal(run(q, 10, 10.1), 0); });
test('10 ms por 8 s não sobe', () => { const q = createQuality({ level: 1 }); assert.equal(run(q, 10, 8), null); });
test('não sobe acima do nível 0', () => { const q = createQuality({}); assert.equal(run(q, 8, 30), null); });
test('entre 12 e 20 ms fica onde está', () => { const q = createQuality({ level: 1 }); assert.equal(run(q, 16, 30), null); });
test('quadro de 3000 ms isolado é ignorado', () => {
  const q = createQuality({}); run(q, 16, 3); assert.equal(q.push(3000, 6000), null); assert.equal(run(q, 16, 3, 6016), null); assert.equal(q.level, 0);
});
test('após descer, precisa de novos 2 s ruins para descer de novo', () => {
  const q = createQuality({}); assert.equal(run(q, 25, 2.1), 1);
  assert.equal(run(q, 25, 1.5, 2100), null); assert.equal(q.level, 1);
  assert.equal(run(q, 25, 0.7, 3600), 2);
});
test('um trecho ruim no meio zera a contagem para subir', () => {
  const q = createQuality({ level: 1 }); run(q, 10, 8); run(q, 16, 3, 8000);
  assert.equal(run(q, 10, 8, 11000), null); assert.equal(q.level, 1);
});
test('pausa longa (aba oculta) zera a janela', () => {
  const q = createQuality({}); run(q, 25, 1.5);
  assert.equal(run(q, 25, 1.5, 60000), null);              // 1,5 s + 1,5 s separados por 1 min não somam 2 s
});
