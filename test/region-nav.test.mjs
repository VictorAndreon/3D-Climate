import test from 'node:test';
import assert from 'node:assert/strict';
import { regionSearch } from '../src/ui/region-nav.js';

test('entrar num estado grava uf (inclusive RS) e preserva o resto', () => {
  assert.equal(regionSearch('?demo=1&debug=1', { uf: 'SP' }), 'demo=1&debug=1&uf=SP');
  assert.equal(regionSearch('?demo=1&uf=SP&t=5', { uf: 'RS' }), 'demo=1&t=5&uf=RS');
});
test('município da busca vai em mun; trocar de estado não leva o mun antigo', () => {
  assert.equal(regionSearch('?uf=SP&mun=3550308', { uf: 'SC', mun: '4216107' }), 'uf=SC&mun=4216107');
  assert.equal(regionSearch('?uf=SP&mun=3550308', { uf: 'BA' }), 'uf=BA');
});
test('voltar ao Brasil tira uf e mun', () => {
  assert.equal(regionSearch('?demo=1&uf=SP&mun=3550308&debug=1', {}), 'demo=1&debug=1');
  assert.equal(regionSearch('', {}), '');
});
