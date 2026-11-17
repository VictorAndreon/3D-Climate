# Brasil com mergulho por estado — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abrir no Brasil inteiro com tempo em 3D mais geral e, ao escolher um estado, mergulhar numa
maquete dele tão nítida quanto o RS é hoje, sem recarregar a página.

**Architecture:** Tudo que hoje é global do RS (projeção, câmera, fuso, arquivos) passa a vir de uma
"região" (`BR` ou uma UF). A projeção vira um objeto por região, passado explicitamente. O palco do menu de
debug passa a ser dono de uma região inteira e sabe trocá-la; a interface ligada ao dado (linha do tempo,
tooltip, painel, seleção, busca) é recriada a cada troca, com os ouvintes presos a um `AbortSignal`.
Entrega em três fases, cada uma funcionando sozinha: (1) qualquer estado por `?uf=`, (2) visão Brasil com
troca por recarga, (3) troca no lugar com mergulho.

**Tech Stack:** Módulos ES sem build, three.js 0.187 vendorizado, `node --test`, Playwright/Chromium já
instalados, mapshaper (só nas ferramentas de geração).

**Spec:** `docs/superpowers/specs/2026-11-17-brasil-por-estado-design.md`

## Global Constraints

- Sem build e sem dependência nova de execução. Só caminhos relativos.
- O RS não muda: grade e `gridVersion` `g1:-58:-34.25:36x31:546`, projeção centrada em (-53,2; -30,4) a 10
  km por unidade, fixture e cache continuam válidos, mesmo visual e desempenho.
- Projeção nunca é estado global mutável: é objeto criado por região e passado a quem usa.
- Grade de 0,25° nos estados, 1° no Brasil. Cache de 1 h por região; só a região na tela recarrega.
- Arquivo de contorno de cada estado ≤ 350 KB.
- Relevo só no RS; fora dele o controle do menu de debug fica desabilitado. `fixture=1` só vale com `uf=RS`.
- Ilhas oceânicas fora (Trindade e Martin Vaz, São Pedro e São Paulo); Fernando de Noronha entra no dado
  de PE mas não no enquadramento.
- Fuso: `America/Rio_Branco` (AC), `America/Manaus` (AM), `America/Boa_Vista` (RR), `America/Porto_Velho`
  (RO), `America/Cuiaba` (MT), `America/Campo_Grande` (MS); os demais e o Brasil, `America/Sao_Paulo`.
- Parâmetros do menu de debug valem nas duas visões e são preservados nas trocas.
- Selos de origem do dado (ao vivo, cache, desatualizado, demo) continuam valendo, por região.
- Em rajada vale o último pedido; o que sai da cena é liberado; a memória de GPU volta ao que era.
- Textos em português; comentários e commits no estilo do repositório.
- Roteiros Playwright são lentos neste ambiente e a captura de tela pode estourar tempo: rodar um por vez,
  fechar cada página ao terminar de usá-la, e não depender de `page.screenshot` para verificar.

## Review Focus

1. `uf` fora do esperado (`uf=sp`, `uf=XX`, `uf=`): minúscula é aceita; desconhecido abre no Brasil, sem
   erro. → Task 3, passo 1.
2. Clicar num estado e, antes de carregar, em outro: entra só no último, sem objeto órfão. → Task 6.
3. Falha de rede ao entrar num estado sem cache: continua no Brasil com aviso; abrindo direto em `?uf=SP`
   com falha, dado sintético com selo de aviso. → Task 6 e Task 3.
4. O instante da linha do tempo não existe no dado novo (cache de outra hora, faixa de 7 dias): vai para o
   mais próximo, sem `NaN` e sem sair da faixa. → Task 5, passo 1.
5. Municípios homônimos em estados diferentes na busca nacional: cada um aparece com a UF e leva ao
   estado certo. → Task 4, passo 1.

---

## Fase 1 — qualquer estado por `?uf=`

### Task 1: Projeção como objeto

**Files:**
- Modify: `src/geo/projection.js`
- Modify: os 12 módulos que importam a projeção: `src/data/analytic.js`, `src/render/{map,relief-map,clouds,clouds-solid,clouds-volume,rain,lightning,city-lift,stage}.js`, `src/ui/{tooltip,city-select,debug}.js`, `src/main.js`
- Test: `test/projection.test.mjs`, `test/rain-geom.test.mjs` (adaptar ao novo formato)

**Interfaces:**
- Produces, em `src/geo/projection.js`:
  - `makeProjection({ lon0, lat0, kmPerUnit }) → { lon0, lat0, kmPerUnit, toScene(lon, lat) → {x, z}, toLonLat(x, z) → {lon, lat}, cell(stepDeg) → {x, z} }`
  - `RS_PROJECTION = { lon0: -53.2, lat0: -30.4, kmPerUnit: 10 }`
  - `fitProjection({ minLon, maxLon, minLat, maxLat }, targetUnits = 77) → { lon0, lat0, kmPerUnit }`:
    centro do retângulo; `kmPerUnit = max(6, maiorLadoKm / targetUnits)` arredondado a 1 casa.
  - As exportações soltas de hoje (`toScene`, `toLonLat`, `CELL_X`, `CELL_Z`, `LON0`, `LAT0`, `KM_PER_UNIT`)
    deixam de existir.
- Cada criador de render/UI que usava a projeção passa a receber `proj` nas opções (ex.:
  `createMap(geo, { proj })`, `createRain({ slots, proj, step })`, `createLightning({ grid, proj })`,
  `createTooltip(el, { …, proj })`). Onde hoje há `0.25` fixo junto de `CELL_X`/`CELL_Z`, passa a valer
  `grid.step` e `proj.cell(grid.step)`.

- [ ] **Step 1: Escrever os testes que falham** (acrescentar em `test/projection.test.mjs`; adaptar os existentes para `makeProjection(RS_PROJECTION)`)

```js
test('RS: mesma conta de hoje', () => {
  const p = makeProjection(RS_PROJECTION), s = p.toScene(-51.2, -30.0);
  assert.ok(Math.abs(s.x - 2 * Math.cos((-30.4 * Math.PI) / 180) * 11.132) < 1e-9);
  assert.ok(Math.abs(s.z - -0.4 * 11.132) < 1e-9);
  assert.ok(Math.abs(p.cell(0.25).z - 0.25 * 11.132) < 1e-12);
});
test('ida e volta em qualquer região', () => {
  const p = makeProjection({ lon0: -60, lat0: -4, kmPerUnit: 25 }), ll = p.toLonLat(...Object.values(p.toScene(-63.1, -2.7)));
  assert.ok(Math.abs(ll.lon - -63.1) < 1e-9 && Math.abs(ll.lat - -2.7) < 1e-9);
});
test('escala: 25 km por unidade encolhe 2,5× em relação a 10', () => {
  const a = makeProjection({ lon0: 0, lat0: 0, kmPerUnit: 10 }).toScene(1, 1), b = makeProjection({ lon0: 0, lat0: 0, kmPerUnit: 25 }).toScene(1, 1);
  assert.ok(Math.abs(a.x / b.x - 2.5) < 1e-9 && Math.abs(a.z / b.z - 2.5) < 1e-9);
});
test('fitProjection: Brasil cabe em ~77 unidades', () => {
  const f = fitProjection({ minLon: -74, maxLon: -32.4, minLat: -33.8, maxLat: 5.3 });
  assert.ok(Math.abs(f.lon0 - -53.2) < 1e-9 && Math.abs(f.lat0 - -14.25) < 1e-9);
  assert.ok(f.kmPerUnit > 55 && f.kmPerUnit < 62);
});
test('fitProjection: estado pequeno não passa de 6 km por unidade para baixo', () => {
  assert.equal(fitProjection({ minLon: -48.3, maxLon: -47.3, minLat: -16.1, maxLat: -15.5 }).kmPerUnit, 6);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/projection.test.mjs` → FAIL (`makeProjection` não existe).
- [ ] **Step 3: Implementar `makeProjection`, `fitProjection`, `RS_PROJECTION`** e passar `proj` por todos os módulos. `main.js` cria `makeProjection(RS_PROJECTION)` uma vez e distribui.
- [ ] **Step 4: Rodar e ver passar** — `npm test` → tudo verde.
- [ ] **Step 5: Conferir que o RS não mudou** — `node tools/gate-debug.cjs` e `node tools/gate-ui.cjs` → exit 0.
- [ ] **Step 6: Commit** — `refactor: projeção vira objeto por região`

---

### Task 2: Malhas e grades de todas as regiões

**Files:**
- Modify: `tools/build-geo.mjs` (gera todas as regiões)
- Create: `assets/regions/index.json`, `assets/regions/<UF>.json` e `assets/regions/<UF>-mun.json` (27 de cada), `assets/regions/BR.json`, `assets/regions/BR-ufs.json`, `assets/regions/busca.json`
- Delete: `assets/rs.json`, `assets/municipios.json` (viram `assets/regions/RS.json` e `RS-mun.json`)
- Modify: quem referencia os caminhos antigos: `src/main.js`, `src/ui/city-select.js`, `tools/{build-relief,record-fixture,gate-final,gate-debug}.cjs|mjs`, e os testes `test/{synthetic,geo-asset,city-search,city,fetch,nearest-city,fixture-asset}.test.mjs`
- Test: `test/regions-asset.test.mjs`

**Interfaces:**
- Produces (formatos em disco):
  - `index.json`: `{ regions: [{ id, name, kind: 'pais'|'uf', ibge, tz, bbox: [minLon, minLat, maxLon, maxLat], proj: { lon0, lat0, kmPerUnit }, step, nP, gridVersion }] }`. `BR` primeiro, depois as UFs por nome. `proj` do RS é `RS_PROJECTION`; das outras, `fitProjection(bbox)`. O `bbox` de PE ignora Fernando de Noronha e os de todas ignoram as ilhas oceânicas (anéis a mais de 150 km do anel principal ficam fora do `bbox`, não do dado; Trindade, Martin Vaz e São Pedro e São Paulo ficam fora de tudo).
  - `<UF>.json`: formato atual de `rs.json` (`{ gridVersion, outline, borders, municipios, grid }`).
  - `<UF>-mun.json`: formato atual de `municipios.json` (`{ gridVersion, items: [[ibge, nome, km2, polys]] }`).
  - `BR.json`: mesmo formato de `<UF>.json`; `outline` = contorno do país, `borders` = divisas estaduais, `municipios` = `[[nomeDoEstado, lon, lat]]` (centro de cada UF), `grid` com `step: 1`.
  - `BR-ufs.json`: formato de `<UF>-mun.json` com um item por estado: `[sigla, nome, km2, polys]`.
  - `busca.json`: `{ items: [[nome, uf, lon, lat, ibge]] }`, 5.564 municípios, por nome.
  - `gridVersion`: `g1:<lon0>:<lat0>:<nx>x<ny>:<n>` quando `step` é 0,25 (igual a hoje); com outro passo, o mesmo texto seguido de `:s<step>`.
- Fonte: `https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-<ibge>-mun.json`, um por UF (códigos 11–17, 21–29, 31–33, 35, 41–43, 50–53). Baixar cada um para um diretório temporário vazio, como a ferramenta já faz.

- [ ] **Step 1: Escrever o teste que falha, `test/regions-asset.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
const read = (f) => JSON.parse(readFileSync(`assets/regions/${f}`, 'utf8'));
const index = read('index.json').regions, by = new Map(index.map((r) => [r.id, r]));

test('índice: Brasil + 27 UFs', () => { assert.equal(index.length, 28); assert.equal(index[0].id, 'BR'); assert.equal(by.get('DF').name, 'Distrito Federal'); });
test('RS idêntico ao de hoje', () => {
  const rs = read('RS.json');
  assert.equal(rs.gridVersion, 'g1:-58:-34.25:36x31:546'); assert.equal(rs.grid.cells.length, 546); assert.equal(rs.municipios.length, 496);
  assert.deepEqual(by.get('RS').proj, { lon0: -53.2, lat0: -30.4, kmPerUnit: 10 });
});
test('pontos medidos no design', () => {
  // 887 foi medido com as ilhas oceânicas; sem elas o Brasil perde no máximo os poucos nós em volta delas
  assert.ok(by.get('BR').nP <= 887 && by.get('BR').nP >= 860, `BR ${by.get('BR').nP}`);
  for (const [id, n] of [['AM', 2296], ['PA', 1854], ['MT', 1400], ['MG', 991], ['BA', 936], ['SP', 469], ['DF', 28]]) assert.equal(by.get(id).nP, n, id);
  assert.equal(by.get('BR').step, 1); assert.match(by.get('BR').gridVersion, /:s1$/);
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
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/regions-asset.test.mjs` → FAIL (arquivos não existem).
- [ ] **Step 3: Generalizar `tools/build-geo.mjs`** para percorrer as 27 UFs e montar o Brasil (dissolver cada UF com o mapshaper para os polígonos estaduais e o contorno do país). O caminho de código do RS não muda, para o arquivo sair igual.
- [ ] **Step 4: Gerar** — `npm run geo` → imprime uma linha por região; sem erro.
- [ ] **Step 5: Mover as referências** de `assets/rs.json` e `assets/municipios.json` para `assets/regions/RS.json` e `RS-mun.json`, e apagar os dois arquivos antigos.
- [ ] **Step 6: Rodar e ver passar** — `npm test` → tudo verde, incluindo `fixture-asset` e `geo-asset` (provam que o RS não mudou).
- [ ] **Step 7: Commit** — `feat(geo): malhas e grades de todas as UFs e do Brasil`

---

### Task 3: Região carregável e `?uf=`

**Files:**
- Create: `src/data/region.js`, `tools/gate-regiao.cjs`
- Modify: `src/ui/config.js` (parâmetros `uf` e `mun`), `src/render/scene.js` (câmera pela região), `src/render/light.js` e `src/ui/format.js` (fuso), `src/ui/{timeline,city-panel,tooltip}.js` (formatadores com fuso), `src/render/stage.js` e `src/ui/debug-menu.js` (relevo indisponível), `src/main.js`
- Test: `test/config.test.mjs`, `test/region.test.mjs`, `test/format.test.mjs`

**Interfaces:**
- Consumes: `makeProjection` (Task 1); `index.json` e arquivos por região (Task 2).
- Produces:
  - `config.js`: `parseConfig` devolve também `uf` (sigla em maiúscula se estiver em `ufs`, senão o padrão) e `mun` (código IBGE em texto, ou `null`). Assinatura: `parseConfig(search, { ufs = [], defaultUf = 'RS' } = {})`. `writeConfig` grava `uf` quando difere de `defaultUf` e nunca grava `mun`. `dados: 'fixture'` só é aceito com `uf === 'RS'`; fora disso vira `'live'`.
  - `region.js`: `loadIndex(fetchImpl?) → Promise<RegionInfo[]>`; `loadRegion(info, fetchImpl?) → Promise<Region>` com `Region = { id, name, kind, tz, geo, grid, gridVersion, proj, bounds: {minX, maxX, minZ, maxZ}, hasCities, hasRelief, munUrl }`. `bounds` é o `bbox` do índice projetado, mais uma célula de folga. `hasRelief` só no RS; `hasCities` só em UF.
  - `scene.js`: `createScene(canvas, opts)` ganha `view.setRegion(bounds)`, que recalcula alvo, limites de passeio e distância das vistas a partir de `bounds` (RS: os mesmos números de hoje, com tolerância de 1 unidade). `TARGET`, `BOUNDS` e `DIST` fixos somem.
  - `format.js`: `makeFormat(tz) → { fmtLabel, fmtHM, fmtDay, fmtDate, localHourOf }`; as funções soltas de data somem. `light.js`: `localHour` sai; quem precisa usa `localHourOf` do formato da região.
  - `stage.state.relevoDisponivel: boolean`; o menu desabilita `input[name=relevo]` quando falso.
- Nesta fase o padrão continua sendo o RS (`defaultUf: 'RS'`), então nenhuma URL antiga muda de comportamento.

- [ ] **Step 1: Escrever os testes que falham**

Em `test/config.test.mjs`:

```js
const UFS = ['RS', 'SP', 'AM'];
test('uf: aceita minúscula, desconhecido cai no padrão', () => {
  assert.equal(parseConfig('?uf=sp', { ufs: UFS }).uf, 'SP');
  assert.equal(parseConfig('?uf=XX', { ufs: UFS }).uf, 'RS');
  assert.equal(parseConfig('?uf=', { ufs: UFS }).uf, 'RS');
  assert.equal(parseConfig('', { ufs: UFS, defaultUf: 'BR' }).uf, 'BR');
});
test('uf vai para a URL só quando difere do padrão; mun nunca vai', () => {
  const c = { ...parseConfig('?uf=SP&mun=3550308', { ufs: UFS }) };
  assert.equal(c.mun, '3550308');
  assert.equal(writeConfig('?uf=SP&mun=3550308', c), 'uf=SP');
  assert.equal(writeConfig('?uf=RS', parseConfig('?uf=RS', { ufs: UFS })), '');
});
test('fixture só vale no RS', () => {
  assert.equal(parseConfig('?fixture=1&uf=SP', { ufs: UFS }).dados, 'live');
  assert.equal(parseConfig('?fixture=1', { ufs: UFS }).dados, 'fixture');
});
```

Em `test/format.test.mjs` (adaptar os existentes para `makeFormat('America/Sao_Paulo')`):

```js
test('fuso por região: Manaus está 1 h atrás de São Paulo, Rio Branco 2 h', () => {
  const unix = Date.UTC(2026, 10, 17, 15, 0) / 1000;
  assert.equal(makeFormat('America/Sao_Paulo').fmtHM(unix), '12:00');
  assert.equal(makeFormat('America/Manaus').fmtHM(unix), '11:00');
  assert.equal(makeFormat('America/Rio_Branco').fmtHM(unix), '10:00');
  assert.equal(makeFormat('America/Manaus').localHourOf(unix), 11);
});
```

Em `test/region.test.mjs`: `loadRegion` com `fetchImpl` lendo do disco devolve, para o RS, `proj.kmPerUnit === 10`, `grid.nP === 546`, `hasRelief === true`, `hasCities === true`; para `BR`, `grid.step === 1`, `hasCities === false`, `hasRelief === false`; para `AM`, `bounds` com largura e profundidade entre 60 e 80 unidades.

`tools/gate-regiao.cjs` (estilo de `gate-debug.cjs`; fecha cada página ao terminar):
- `demo=1&debug=1&uf=SP`: `__rs.grid.nP === 469`; `__rs.region.id === 'SP'`; a busca acha "Campinas" e escolher abre o painel com "Campinas"; `input[name=relevo]` está `disabled`; sem erro de console.
- `demo=1&debug=1&uf=AM&t=5` e `demo=1&debug=1&uf=RS&t=5`: o rótulo da linha do tempo (`.tl-label`) do AM marca 1 h a menos que o do RS.
- `demo=1&debug=1&uf=DF` e `uf=AM`: abrem, `__rs.stats().puffs > 0` em algum horário entre `t=0` e `t=48`, sem erro.
- `demo=1&debug=1&uf=xx`: abre no RS (`__rs.region.id === 'RS'`).
- `fixture=1&debug=1&uf=SP`: `__rs.status.kind !== 'fixture'`.
- `demo=1&debug=1&uf=SP&mun=3550308`: abre com o painel de "São Paulo" aberto.
- Com a API interceptada para falhar (`page.route('https://api.open-meteo.com/**', r => r.abort())`) e `debug=1&uf=SP`: `__rs.status.kind === 'demo-fallback'` e o selo tem a classe `warn`.

- [ ] **Step 2: Rodar e ver falhar** — `npm test` e `node tools/gate-regiao.cjs` → FAIL.
- [ ] **Step 3: Implementar** `config.js`, `region.js`, `makeFormat`, `view.setRegion`, e ligar em `main.js` (carrega o índice, resolve a região pela URL, monta tudo com ela; `__rs.region` exposto com `debug=1`).
- [ ] **Step 4: Rodar e ver passar** — `npm test`; `node tools/gate-regiao.cjs` → exit 0.
- [ ] **Step 5: Conferir o RS** — `node tools/gate-ui.cjs`, `node tools/gate-debug.cjs`, `node tools/gate-final.cjs` → exit 0. `gate-rain`: rodar; se falhar só por tempo de captura, rodar uma cópia sem `page.screenshot` e registrar.
- [ ] **Step 6: Olhar** — capturas (escala 1) de SP, AM, DF e BA em `demo=1&t=30`, salvas em `review-shots/regioes/`. Conferir a olho: estado enquadrado, nuvens proporcionais, nada cortado. Ajustar `fitProjection` (piso de 6 km e alvo de 77) se algum estado ficar ruim, e registrar o que mudou.
- [ ] **Step 7: Commit** — `feat: qualquer estado por ?uf=`

---

## Fase 2 — visão Brasil

### Task 4: Brasil como região de abertura

**Files:**
- Create: `src/ui/region-nav.js`, `tools/gate-brasil.cjs`
- Modify: `src/main.js`, `src/ui/city-search.js` (itens com rótulo secundário e tipo), `src/ui/tooltip.js` (nome do estado), `index.html` e `src/ui/style.css` (controle "← Brasil")
- Modify: `tools/{gate-rain,gate-ui,gate-final,gate-debug,gate-regiao,shots}.cjs` (acrescentar `uf=RS` às URLs que não têm `uf`)
- Test: `test/city-search.test.mjs`

**Interfaces:**
- Consumes: `Region` (Task 3), `BR.json`, `BR-ufs.json`, `busca.json` (Task 2), `createMunicipioIndex` (existente, serve para os estados).
- Produces:
  - O padrão passa a ser `defaultUf: 'BR'`.
  - `searchPlaces(items, query, limit = 8) → items` em `city-search.js`, onde `items = [{ label, sub, kind: 'uf'|'mun', uf, ibge?, key }]`; `key` é o texto normalizado (sem acento, minúsculo) usado na busca. Estados vêm antes de municípios quando ambos casam. `createCitySearch(el, { items, onPick, placeholder })` passa a receber `items` e chama `onPick(item)`; cada linha mostra `label` e, se houver, `sub` (a UF, ou "estado").
  - `region-nav.js`: `createRegionNav(el, { region, onBack })` mostra `← Brasil` só quando `region.kind === 'uf'`.
  - Nesta fase, entrar e sair de estado é navegação: `location.assign` para a URL com `uf=<sigla>` (e `mun=<ibge>` quando veio da busca) preservando os outros parâmetros; "← Brasil" tira `uf` e `mun`.
- Na visão Brasil: sem seleção de município nem painel; o tooltip usa o nome do estado sob o ponteiro; clique ou toque num estado navega para ele; a busca usa os 27 estados mais `busca.json` (baixado no primeiro foco do campo).

- [ ] **Step 1: Escrever os testes que falham**

Em `test/city-search.test.mjs`:

```js
const items = [
  { label: 'São Paulo', sub: 'estado', kind: 'uf', uf: 'SP', key: 'sao paulo' },
  { label: 'São Paulo', sub: 'SP', kind: 'mun', uf: 'SP', ibge: '3550308', key: 'sao paulo' },
  { label: 'São Domingos', sub: 'GO', kind: 'mun', uf: 'GO', ibge: '5219803', key: 'sao domingos' },
  { label: 'São Domingos', sub: 'SC', kind: 'mun', uf: 'SC', ibge: '4216107', key: 'sao domingos' },
];
test('estado vem antes do município de mesmo nome', () => assert.deepEqual(searchPlaces(items, 'sao paulo').map((i) => i.kind), ['uf', 'mun']));
test('homônimos aparecem todos, cada um com a sua UF', () => assert.deepEqual(searchPlaces(items, 'são dom').map((i) => i.sub), ['GO', 'SC']));
test('ignora acento e maiúscula', () => assert.equal(searchPlaces(items, 'SAO DOMINGOS').length, 2));
```

`tools/gate-brasil.cjs`:
- `demo=1&debug=1`: `__rs.region.id === 'BR'`, `__rs.grid.nP === 887`, `__rs.grid.step === 1`; `#region-back` oculto; `#city` oculto; sem erro de console; `__rs.stats().puffs > 0` em algum horário.
- Ponteiro sobre o centro da tela: o tooltip mostra o nome de um estado (um dos 27).
- Clique num ponto dentro de SP (projetar o centro de SP do índice para a tela com `__rs.view`): a página navega para uma URL com `uf=SP`, preservando `demo=1&debug=1`, e abre com `__rs.region.id === 'SP'`; `#region-back` visível.
- Clique em `#region-back`: volta para o Brasil (URL sem `uf`).
- Busca "campinas": a lista mostra "Campinas" com "SP"; escolher navega para `uf=SP&mun=3509502` e abre com o painel de Campinas.
- Busca "são domingos": a lista tem mais de uma linha com esse nome, com UFs diferentes; escolher a de SC abre `uf=SC`.
- Busca "bahia": a primeira linha é o estado; escolher abre `uf=BA`.
- 390×844: tudo acima vale por toque; `#region-back` não cobre `#search`, `#badge` nem `#debug-toggle`.

- [ ] **Step 2: Rodar e ver falhar** — `npm test`; `node tools/gate-brasil.cjs` → FAIL.
- [ ] **Step 3: Implementar** a busca por itens, o tooltip de estado, o clique em estado, `region-nav.js`, e trocar o padrão para `BR`.
- [ ] **Step 4: Atualizar os roteiros antigos** com `uf=RS`.
- [ ] **Step 5: Rodar e ver passar** — `npm test`; `gate-brasil`, `gate-regiao`, `gate-ui`, `gate-debug`, `gate-final` → exit 0 (um por vez). `gate-rain` como na Task 3.
- [ ] **Step 6: Olhar** — capturas do Brasil (escala 1) em `demo=1&t=30`, de cima e inclinado, desktop e celular, em `review-shots/brasil/`. Critério do design: nuvens grandes e estilizadas, não borrão nem pontilhado. Se ficar ralo, testar a grade de 0,75° (1.503 pontos) e registrar a escolha.
- [ ] **Step 7: Commit** — `feat: abre no Brasil; clicar num estado entra nele`

---

## Fase 3 — troca no lugar com mergulho

### Task 5: Peças que sabem ser desligadas

**Files:**
- Create: `src/ui/clock-carry.js`
- Modify: `src/ui/{timeline,tooltip,city-panel,city-select,city-search,region-nav}.js` (opção `signal`), `src/render/{rain,lightning}.js` (`dispose()`), `src/render/stage.js` (`setRegion`), `src/ui/clock.js`
- Test: `test/clock-carry.test.mjs`, `test/clock.test.mjs`

**Interfaces:**
- Produces:
  - Cada criador de UI listado aceita `signal: AbortSignal` nas opções e registra todos os ouvintes com `{ signal }` (inclusive os de `window`). Ao abortar, não sobra ouvinte; o conteúdo do elemento é limpo por quem recria.
  - `createRain(...).dispose()`, `createLightning(...).dispose()`.
  - `stage.setRegion(region) → Promise<void>`: troca mapa, nuvens, chuva, raios e pontos da grade pela região nova, mantendo `nuvens`, `grade` e a qualidade; `relevo` é desligado se `!region.hasRelief`. Libera tudo que sai. `stage.rain` e `stage.lightning` passam a existir.
  - `clock-carry.js`: `carryTime({ t, times }, nextTimes, { tNow, tMax }) → number`: a hora fracionária em `nextTimes` que corresponde ao mesmo instante absoluto, limitada a `[tNow, tMax]`.
  - `createClock({ tNow, tEnd72, tEndAll, from })`: `from = { t, playing, speed, range }` opcional define o estado inicial (com `t` já limitado à faixa).

- [ ] **Step 1: Escrever os testes que falham**

```js
// test/clock-carry.test.mjs
const H = 3600, base = 1_800_000_000 - (1_800_000_000 % H);
const times = (start, n) => Float64Array.from({ length: n }, (_, i) => start + i * H);
test('mesmo instante em série que começa 2 h depois', () => assert.equal(carryTime({ t: 10.5, times: times(base, 168) }, times(base + 2 * H, 168), { tNow: 0, tMax: 72 }), 8.5));
test('instante antes do início da série nova: vai para tNow', () => assert.equal(carryTime({ t: 1, times: times(base, 168) }, times(base + 5 * H, 168), { tNow: 0.25, tMax: 72 }), 0.25));
test('instante depois do fim da faixa: vai para tMax', () => assert.equal(carryTime({ t: 150, times: times(base, 168) }, times(base, 168), { tNow: 0, tMax: 72 }), 72));
test('nunca devolve NaN', () => assert.ok(Number.isFinite(carryTime({ t: NaN, times: times(base, 168) }, times(base, 168), { tNow: 3, tMax: 72 }))));
```

Em `test/clock.test.mjs`: `createClock({ tNow: 2, tEnd72: 74, tEndAll: 167, from: { t: 30, playing: true, speed: 4, range: '72h' } })` abre com `t === 30`, `playing === true`, `speed === 4`; com `from.t = 500` abre em `tMax`.

- [ ] **Step 2: Rodar e ver falhar** — `npm test` → FAIL.
- [ ] **Step 3: Implementar** `carryTime`, `from` no relógio, `signal` nos criadores de UI, `dispose` em chuva e raios, e `stage.setRegion`.
- [ ] **Step 4: Rodar e ver passar** — `npm test`; `gate-debug`, `gate-ui` → exit 0.
- [ ] **Step 5: Commit** — `refactor: interface e palco aceitam troca de região`

---

### Task 6: Entrar e sair de estado sem recarregar

**Files:**
- Create: `src/app/session.js`, `src/app/navigator.js`
- Modify: `src/main.js` (vira: cria a cena uma vez, o navegador cuida do resto), `src/render/scene.js` (`flyTo`), `src/ui/style.css` e `index.html` (indicador de carregamento do estado e aviso)
- Modify: `tools/gate-brasil.cjs` (troca no lugar)

**Interfaces:**
- Consumes: tudo das Tasks 3–5.
- Produces:
  - `session.js`: `createSession({ view, stage, region, data, cfg, from }) → { region, field, clock, citySelect, dispose() }`: monta campo, relógio (com `from`), linha do tempo, selo, tooltip, painel, seleção, busca e navegação da região, todos presos a um `AbortController`; `dispose()` aborta e limpa.
  - `navigator.js`: `createNavigator({ view, stage, index, cfg, loadData }) → { current, go(id, { mun } = {}) → Promise<boolean>, back() }`.
    - `go` carrega região e dado (o Brasil continua na tela, com `document.body.dataset.loading = <sigla>`), e só então troca: `session.dispose()`, `stage.setRegion`, sessão nova com `carryTime`, câmera.
    - Pedido novo durante a carga supera o anterior; `go` superado resolve `false` e não toca na cena.
    - Vindo do Brasil, se o dado chegar como `demo-fallback` (falha sem cache), não troca: mostra o aviso `Não foi possível carregar <nome do estado>.` em `#region-msg` por 5 s e resolve `false`.
    - Sucesso: `history.pushState` com a URL nova (parâmetros do menu preservados; `mun` não vai). `popstate` chama `go` para a região da URL, sem criar entrada nova.
  - `view.flyTo({ x, z }, { dist, seconds }) → Promise<void>` em `scene.js`; qualquer interação cancela. Mergulho: ao entrar, a câmera voa até o centro do estado antes da troca e a cena nova abre com `flyIn`; com `prefers-reduced-motion`, corte seco.
  - `window.__rs` (com `debug=1`) passa a refletir a sessão atual a cada troca e ganha `nav`.

- [ ] **Step 1: Estender `tools/gate-brasil.cjs` com as verificações que falham**

Abrindo `demo=1&debug=1&t=20` (uma página só, sem recarga; marcar `window.__mesma = 1` no início e conferir no fim):
- `await __rs.nav.go('SP')` → `true`; `__rs.region.id === 'SP'`; `location.search` contém `uf=SP`, `demo=1`, `debug=1`; `window.__mesma === 1`.
- Hora mantida: o instante absoluto (`__rs.field.times[0] + __rs.clock.t * 3600`) antes e depois difere em menos de 1 s.
- Play mantido: tocar no Brasil, entrar em PR, `__rs.clock.playing === true` e a velocidade é a mesma.
- `history.back()` → volta para `BR` sem recarregar; `history.forward()` → `SP` de novo.
- Rajada: `__rs.nav.go('AM'); await __rs.nav.go('SC')` → termina em `SC`; `__rs.view.scene` tem exatamente um objeto chamado `land`.
- Menu de debug preservado: com `nuvens=sprite` escolhido no menu no Brasil, depois de entrar em SP o rádio marcado e `__rs.stage.state.nuvens` são `sprite`.
- Clique real: clicar no centro de MG na tela entra em MG; `#region-back` volta ao Brasil.
- Busca nacional: escolher "Campinas — SP" termina em SP com o painel de Campinas aberto, sem recarga.
- Ouvintes: depois de 3 idas e voltas BR↔SP, um `Escape` com município aberto fecha o painel uma vez só e a tecla espaço alterna play uma vez só (`__rs.clock.playing` muda exatamente uma vez).
- Memória: `__rs.memory()` depois de BR→SP→BR→SP→BR é igual ao de antes (esperar a peça do município e as animações terminarem).
- Falha: com `debug=1` (sem `demo`), API respondendo ao Brasil pela fixture do roteiro e abortando as requisições do estado: `await __rs.nav.go('SP')` → `false`; continua em `BR`; `#region-msg` contém "Não foi possível carregar São Paulo"; URL sem `uf`.
- `demo=1&debug=1&uf=SP` aberto direto: `#region-back` leva ao Brasil sem recarga.
- Movimento reduzido (`page.emulateMedia({ reducedMotion: 'reduce' })`): `go('RJ')` troca sem animação e termina com a câmera na vista padrão.

- [ ] **Step 2: Rodar e ver falhar** — `node tools/gate-brasil.cjs` → FAIL (`__rs.nav` indefinido).
- [ ] **Step 3: Implementar** `session.js`, `navigator.js`, `view.flyTo`, e reduzir `main.js` a: cena, luzes, qualidade, menu de debug, navegador, laço de quadro lendo a sessão atual.
- [ ] **Step 4: Rodar e ver passar** — `node tools/gate-brasil.cjs` → exit 0.
- [ ] **Step 5: Rodar tudo** — `npm test`; `gate-regiao`, `gate-ui`, `gate-debug`, `gate-final` → exit 0 (um por vez); `gate-rain` como na Task 3.
- [ ] **Step 6: Olhar e medir** — capturas do mergulho (antes, depois) em `review-shots/brasil/`. Medir `__rs.stats().frameMs` médio de 5 s em `uf=RS` e em `uf=AM` (mesmo modo, `demo=1&t=30`): o Amazonas não pode passar de 1,3× o RS; se passar, reduzir o custo por quadro do Amazonas antes de fechar.
- [ ] **Step 7: Atualizar o `README.md`** (título e descrição deixam de ser só RS; `uf=`, `mun=`, visão Brasil, roteiros novos, como regenerar as malhas) e **commit** — `feat: mergulho do Brasil para o estado sem recarregar`
