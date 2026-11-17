import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { STEPS } from '../src/geo/steps.js';
const read = (f) => JSON.parse(readFileSync(`assets/regions/${f}`, 'utf8'));
const index = read('index.json').regions, by = new Map(index.map((r) => [r.id, r]));

test('índice: Brasil + 27 UFs', () => { assert.equal(index.length, 28); assert.equal(index[0].id, 'BR'); assert.equal(by.get('DF').name, 'Distrito Federal'); });
test('RS idêntico ao de hoje', () => {
  const rs = read('RS.json');
  assert.equal(rs.gridVersion, 'g1:-58:-34.25:36x31:546'); assert.equal(rs.grid.cells.length, 546); assert.equal(rs.municipios.length, 496);
  assert.deepEqual(by.get('RS').proj, { lon0: -53.2, lat0: -30.4, kmPerUnit: 10 });
});
test('teto de 550 pontos por região; quem já cabia a 0,25° não muda', () => {
  for (const r of index) assert.ok(r.nP <= 550, `${r.id} ${r.nP}`);
  for (const [id, n] of [['RS', 546], ['SP', 469], ['DF', 28]]) { assert.equal(by.get(id).nP, n, id); assert.equal(by.get(id).step, 0.25, id); assert.doesNotMatch(by.get(id).gridVersion, /:s/, id); }
  for (const id of ['AM', 'PA', 'MT', 'MG', 'BA', 'MS', 'GO']) assert.ok(by.get(id).step > 0.25, id);
  assert.ok(by.get('BR').step > 1, 'BR'); assert.match(by.get('BR').gridVersion, new RegExp(`:s${by.get('BR').step}$`));
});
test('passo de cada região é um da lista e gridVersion o carrega quando não é 0,25', () => {
  for (const r of index) { assert.ok(STEPS.includes(r.step), r.id); assert.equal(/:s[\d.]+$/.test(r.gridVersion), r.step !== 0.25, r.id); }
});
test('cada estado: arquivo ≤ 350 KB, nP e gridVersion batem com o índice', () => {
  for (const r of index) {
    const g = read(`${r.id}.json`);
    assert.ok(statSync(`assets/regions/${r.id}.json`).size <= 350 * 1024, r.id);
    assert.equal(g.grid.cells.length, r.nP, r.id); assert.equal(g.gridVersion, r.gridVersion, r.id); assert.equal(g.grid.step, r.step, r.id);
  }
});
test('municípios: 5.564 no total, todos na busca, cada UF com o seu arquivo', () => {
  const busca = read('busca.json').items; assert.equal(busca.length, 5564);
  let n = 0; for (const r of index) if (r.kind === 'uf') { const m = read(`${r.id}-mun.json`); assert.equal(m.items.length, read(`${r.id}.json`).municipios.length, r.id); n += m.items.length; }
  assert.equal(n, 5564);
});
test('fusos', () => {
  for (const [id, tz] of [['AC', 'America/Rio_Branco'], ['AM', 'America/Manaus'], ['RR', 'America/Boa_Vista'], ['RO', 'America/Porto_Velho'], ['MT', 'America/Cuiaba'], ['MS', 'America/Campo_Grande'], ['SP', 'America/Sao_Paulo'], ['BR', 'America/Sao_Paulo']]) assert.equal(by.get(id).tz, tz, id);
});
test('enquadramento ignora ilhas distantes', () => {
  const pe = by.get('PE').bbox; assert.ok(pe[2] < -34, `PE vai até ${pe[2]}`);          // sem Noronha (-32,4)
  const es = by.get('ES').bbox; assert.ok(es[2] < -39, `ES vai até ${es[2]}`);          // sem Trindade (-29,3)
  const br = read('BR-ufs.json').items; assert.equal(br.length, 27); assert.equal(br.find((u) => u[0] === 'SP')[1], 'São Paulo');
});
