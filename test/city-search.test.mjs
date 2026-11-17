import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { searchCities, fold } from '../src/ui/city-search.js';

const NAMES = ['Alegrete', 'Porto Alegre', 'Porto Xavier', 'São José do Norte', 'São Borja', 'Santo Ângelo', 'Nova Santa Rita', 'Canoas'];
const names = (q, n) => searchCities(NAMES, q, n).map((r) => r.name);

test('consulta vazia ou sem resultado devolve lista vazia', () => {
  assert.deepEqual(names(''), []); assert.deepEqual(names('   '), []); assert.deepEqual(names('xyz'), []);
});
test('ignora acento e maiúsculas', () => {
  assert.deepEqual(names('sao jose'), ['São José do Norte']);
  assert.deepEqual(names('ÂNGELO'), ['Santo Ângelo']);
  assert.equal(fold('São José'), 'sao jose');
});
test('ordem: começo do nome, depois começo de palavra, depois meio; alfabética no empate', () => {
  assert.deepEqual(names('alegre'), ['Alegrete', 'Porto Alegre']);
  assert.deepEqual(names('porto'), ['Porto Alegre', 'Porto Xavier']);
  assert.deepEqual(names('sa'), ['Santo Ângelo', 'São Borja', 'São José do Norte', 'Nova Santa Rita']);
  assert.deepEqual(names('ano'), ['Canoas']);
});
test('respeita o limite e devolve a posição do trecho casado', () => {
  assert.equal(names('a', 3).length, 3);
  assert.deepEqual(searchCities(NAMES, 'alegre'), [{ name: 'Alegrete', at: 0 }, { name: 'Porto Alegre', at: 6 }]);
});
test('todo município do mapa é achado pelo próprio nome', () => {
  const all = JSON.parse(fs.readFileSync(new URL('../assets/regions/RS.json', import.meta.url))).municipios.map(([n]) => n);
  for (const n of all) assert(searchCities(all, n, 50).some((r) => r.name === n), n);
});
