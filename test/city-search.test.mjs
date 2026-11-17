import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { searchPlaces, fold } from '../src/ui/city-search.js';

const mun = (label, sub = '') => ({ label, sub, kind: 'mun', uf: sub, key: fold(label) });
const NAMES = ['Alegrete', 'Porto Alegre', 'Porto Xavier', 'São José do Norte', 'São Borja', 'Santo Ângelo', 'Nova Santa Rita', 'Canoas'];
const NAME_ITEMS = NAMES.map((n) => mun(n));
const names = (q, n) => searchPlaces(NAME_ITEMS, q, n).map((r) => r.label);

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
  assert.deepEqual(searchPlaces(NAME_ITEMS, 'alegre').map((r) => [r.label, r.at]), [['Alegrete', 0], ['Porto Alegre', 6]]);
});
test('todo município do mapa é achado pelo próprio nome', () => {
  const all = JSON.parse(fs.readFileSync(new URL('../assets/regions/RS.json', import.meta.url))).municipios.map(([n]) => mun(n));
  for (const it of all) assert(searchPlaces(all, it.label, 50).some((r) => r.label === it.label), it.label);
});

const items = [
  { label: 'São Paulo', sub: 'estado', kind: 'uf', uf: 'SP', key: 'sao paulo' },
  { label: 'São Paulo', sub: 'SP', kind: 'mun', uf: 'SP', ibge: '3550308', key: 'sao paulo' },
  { label: 'São Domingos', sub: 'GO', kind: 'mun', uf: 'GO', ibge: '5219803', key: 'sao domingos' },
  { label: 'São Domingos', sub: 'SC', kind: 'mun', uf: 'SC', ibge: '4216107', key: 'sao domingos' },
];
test('estado vem antes do município de mesmo nome', () => assert.deepEqual(searchPlaces(items, 'sao paulo').map((i) => i.kind), ['uf', 'mun']));
test('homônimos aparecem todos, cada um com a sua UF', () => assert.deepEqual(searchPlaces(items, 'são dom').map((i) => i.sub), ['GO', 'SC']));
test('ignora acento e maiúscula', () => assert.equal(searchPlaces(items, 'SAO DOMINGOS').length, 2));
test('estado vem antes de município mesmo quando o casamento do estado é pior', () => {
  const mixed = [mun('Sulina', 'PR'), { label: 'Rio Grande do Sul', sub: 'estado', kind: 'uf', uf: 'RS', key: 'rio grande do sul' }];
  assert.deepEqual(searchPlaces(mixed, 'sul').map((i) => i.kind), ['uf', 'mun']);
});
