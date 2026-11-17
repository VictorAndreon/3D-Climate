import test from 'node:test';
import assert from 'node:assert/strict';
import { waitText, createWaitNotice } from '../src/ui/wait.js';

test('texto da espera conta para baixo, arredondando para cima, sem passar de zero', () => {
  assert.equal(waitText(10000, 0), 'aguardando a API (limite por minuto)… 10 s');
  assert.equal(waitText(10000, 8500), 'aguardando a API (limite por minuto)… 2 s');
  assert.equal(waitText(10000, 20000), 'aguardando a API (limite por minuto)… 0 s');
});
test('createWaitNotice: mostra, atualiza a cada tique, restaura o texto original ao terminar', () => {
  const el = { textContent: 'carregando previsão…', hidden: false }; let t = 0, tick;
  const set = (f) => { tick = f; return 1; };
  const notice = createWaitNotice(el, { now: () => t, setTimer: set, clearTimer: () => { tick = null; } });
  notice({ until: 5000 });
  assert.match(el.textContent, /… 5 s$/);
  t = 2000; tick(); assert.match(el.textContent, /… 3 s$/);
  notice(null); assert.equal(el.textContent, 'carregando previsão…'); assert.equal(tick, null);
});
test('createWaitNotice com hide: aparece só durante a espera', () => {
  const el = { textContent: '', hidden: true }, body = { dataset: {} };
  const notice = createWaitNotice(el, { hide: true, flag: body, setTimer: () => 1, clearTimer: () => {} });
  notice({ until: 1000 }); assert.equal(el.hidden, false); assert.equal(body.dataset.waiting, '1');
  notice(null); assert.equal(el.hidden, true); assert.equal('waiting' in body.dataset, false);
});
