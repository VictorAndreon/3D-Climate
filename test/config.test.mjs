import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, parseConfig, writeConfig } from '../src/ui/config.js';

test('URL vazia dá os padrões', () => assert.deepEqual(parseConfig(''), DEFAULTS));
test('lê cada parâmetro', () => assert.deepEqual(
  parseConfig('?debug=1&nuvens=volume&relevo=1&exagero=20&grade=0&qualidade=medio&fixture=1'),
  { debug: true, nuvens: 'volume', relevo: true, exagero: 20, grade: false, qualidade: 'medio', dados: 'fixture' }));
test('debug=1 liga a grade quando grade não vem na URL', () => assert.equal(parseConfig('?debug=1').grade, true));
test('grade=1 sem debug liga só a grade', () => { const c = parseConfig('?grade=1'); assert.equal(c.grade, true); assert.equal(c.debug, false); });
test('demo ganha de fixture, como hoje', () => assert.equal(parseConfig('?demo=1&fixture=1').dados, 'demo'));
test('valores inválidos caem no padrão', () => {
  const c = parseConfig('?nuvens=xyz&exagero=abc&qualidade=ultra&relevo=sim');
  assert.equal(c.nuvens, 'solidas'); assert.equal(c.exagero, 12); assert.equal(c.qualidade, 'auto'); assert.equal(c.relevo, false);
});
test('exagero é limitado a 1..40', () => {
  assert.equal(parseConfig('?exagero=-5').exagero, 1); assert.equal(parseConfig('?exagero=999').exagero, 40);
  assert.equal(parseConfig('?exagero=0').exagero, 12);               // 0 sempre foi "usa o padrão"
});
test('escreve só o que difere do padrão', () => {
  assert.equal(writeConfig('', DEFAULTS), '');
  assert.equal(writeConfig('', { ...DEFAULTS, nuvens: 'sprite', relevo: true, exagero: 20 }), 'nuvens=sprite&relevo=1&exagero=20');
});
test('exagero só vai para a URL com relevo ligado', () => assert.equal(writeConfig('', { ...DEFAULTS, exagero: 20 }), ''));
test('preserva parâmetros que não conhece', () => assert.equal(
  writeConfig('?cam=top&t=5&nuvens=volume&look=-51,-30', { ...DEFAULTS, qualidade: 'baixo' }), 'cam=top&t=5&look=-51%2C-30&qualidade=baixo'));
test('com debug=1, grade desligada vira grade=0', () => assert.equal(writeConfig('', { ...DEFAULTS, debug: true, grade: false }), 'debug=1&grade=0'));
test('dados troca demo/fixture sem deixar os dois', () => {
  assert.equal(writeConfig('?demo=1', { ...DEFAULTS, dados: 'fixture' }), 'fixture=1');
  assert.equal(writeConfig('?fixture=1', DEFAULTS), '');
});
test('ida e volta é estável', () => {
  for (const q of ['debug=1', 'nuvens=volume&relevo=1&exagero=7', 'grade=1&qualidade=alto&demo=1', 'debug=1&grade=0']) {
    assert.deepEqual(parseConfig(writeConfig('', parseConfig(q))), parseConfig(q));
  }
});
