# Menu de debug — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um menu na tela que ajusta nuvens, relevo, exagero, grade, qualidade e fonte de dados, com efeito
imediato e a URL sempre refletindo o que está na tela.

**Architecture:** Um módulo puro (`config.js`) traduz URL ↔ configuração. Um "palco" (`stage.js`) passa a
ser dono do mapa e das nuvens e sabe trocá-los no lugar, liberando o que sai. O menu (`debug-menu.js`) só
lê a configuração, chama o palco e reescreve a URL. `main.js` deixa de capturar mapa e nuvens no boot e
passa a ler os atuais pelo palco.

**Tech Stack:** Módulos ES sem build, three.js 0.187 vendorizado, `node --test`, Playwright/Chromium já
instalados (roteiros em `tools/*.cjs`).

**Spec:** `docs/superpowers/specs/2026-11-16-menu-debug-design.md`

## Global Constraints

- Sem build e sem dependência nova. HTML, CSS e módulos ES na mão.
- Lógica de estado URL ↔ configuração em módulo puro, testada com `node --test`.
- As URLs usadas por `tools/gate-rain.cjs`, `gate-ui.cjs`, `gate-final.cjs` e `shots.cjs` produzem o mesmo
  resultado de hoje. Esses arquivos não são editados; se um deles falhar, o defeito está no código novo.
- `?debug=1` continua expondo `window.__rs` com todas as chaves de hoje e ligando os pontos da grade.
- Parâmetros `cam`, `dist`, `look`, `polar`, `t` ficam só na URL e são preservados quando o menu a reescreve.
- Troca no lugar mantém câmera, horário, play/pause e município selecionado. Só "Dados" recarrega a página.
- Fechado, o menu é só o botão ⚙. Aberto, não cobre `#timeline`, `#search` nem `#city`, em 1280×800 e em
  390×844.
- Textos da interface em português; comentários e mensagens de commit no estilo do repositório.
- Fora de escopo: sliders de constantes de shader, controles de câmera/horário, trocar dados sem recarregar.

## Review Focus

1. Trocas em rajada com carga pendente (ligar volume e logo trocar para sprite; arrastar o exagero): vale a
   última escolha, sem objeto órfão na cena. → Task 3, passo 1.
2. URL com valor inválido (`nuvens=xyz`, `exagero=abc`, `exagero=-5`, `qualidade=ultra`, `demo=1&fixture=1`):
   cai no padrão sem erro. → Task 1, passo 1.
3. Relevo falha ao carregar: o mapa plano continua, o controle volta para desligado e o menu mostra aviso.
   → Task 4, passo 1.
4. Ligar/desligar relevo com município selecionado: continua selecionado e a peça fica na altura do terreno
   novo. → Task 3, passo 1.
5. Vazamento depois de muitas trocas: `renderer.info.memory` volta ao valor inicial após ida e volta.
   → Task 3, passo 1.

---

### Task 1: Configuração URL ↔ objeto

**Files:**
- Create: `src/ui/config.js`
- Test: `test/config.test.mjs`

**Interfaces:**
- Produces:
  - `DEFAULTS = { debug: false, nuvens: 'solidas', relevo: false, exagero: 12, grade: false, qualidade: 'auto', dados: 'live' }`
  - `EXAGERO = { min: 1, max: 40, step: 1 }`
  - `parseConfig(search: string) → Config` (mesmo formato de `DEFAULTS`)
  - `writeConfig(search: string, cfg: Config) → string` (query sem `?`; vazia se nada a escrever)
  - Valores: `nuvens` ∈ `solidas|volume|sprite`; `qualidade` ∈ `auto|alto|medio|baixo`; `dados` ∈ `live|demo|fixture`.

- [ ] **Step 1: Escrever os testes que falham**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/config.test.mjs`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `src/ui/config.js`**

Use `URLSearchParams`. `writeConfig` parte dos parâmetros existentes, apaga os que o menu conhece (`debug`,
`nuvens`, `relevo`, `exagero`, `grade`, `qualidade`, `demo`, `fixture`) e os regrava nessa ordem, omitindo
os que valem o padrão. O padrão de `grade` é o valor de `debug`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: todos passam (163 de antes + os novos).

- [ ] **Step 5: Commit**

```bash
git add src/ui/config.js test/config.test.mjs
git commit -m "feat(debug): configuração URL <-> objeto"
```

---

### Task 2: Qualidade travada

**Files:**
- Modify: `src/render/quality.js` (`createQuality`)
- Test: `test/quality.test.mjs` (acrescentar ao fim; `run` já existe no arquivo)

**Interfaces:**
- Produces: `quality.lock(level: 0|1|2|null) → void` e `quality.locked: boolean`. Travado: `quality.level`
  devolve o nível travado e `push()` sempre devolve `null`. `lock(null)` destrava, zera a janela de medição
  e continua do nível em que estava.

- [ ] **Step 1: Escrever os testes que falham**

```js
test('travada: quadros lentos não mudam o nível', () => {
  const q = createQuality({}); q.lock(0);
  assert.equal(run(q, 40, 5), null); assert.equal(q.level, 0); assert.equal(q.locked, true);
});
test('travar muda o nível na hora', () => { const q = createQuality({}); q.lock(2); assert.equal(q.level, 2); });
test('destravar volta ao automático a partir do nível travado, com a janela zerada', () => {
  const q = createQuality({}); q.lock(1); run(q, 40, 5);
  q.lock(null); assert.equal(q.locked, false); assert.equal(q.level, 1);
  assert.equal(run(q, 40, 1.5, 5000), null);                 // os 5 s ruins de antes não contam
  assert.equal(run(q, 40, 0.7, 6500), 2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/quality.test.mjs`
Expected: FAIL com `q.lock is not a function`.

- [ ] **Step 3: Implementar `lock` e `locked` em `createQuality`**

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: todos passam.

- [ ] **Step 5: Commit**

```bash
git add src/render/quality.js test/quality.test.mjs
git commit -m "feat(debug): qualidade pode ser travada num nível"
```

---

### Task 3: Palco — trocar nuvens, relevo e grade no lugar

**Files:**
- Create: `src/render/stage.js`
- Create: `tools/gate-debug.cjs`
- Modify: `src/render/clouds.js`, `src/render/clouds-solid.js`, `src/render/clouds-volume.js`,
  `src/render/map.js`, `src/render/relief-map.js` (cada um ganha `dispose()`)
- Modify: `src/main.js` (usa o palco e `parseConfig`; some a leitura direta de `nuvens`, `relevo`, `exagero`, `debug`)
- Modify: `src/render/city-lift.js` só se necessário para recalcular a altura da peça levantada

**Interfaces:**
- Consumes: `parseConfig` (Task 1), `quality.lock` (Task 2).
- Produces, em `src/render/stage.js`:
  ```
  createStage({ view, geo, grid, makeCloudSlots, loadRelief, loadNoise, onSwap }) → {
    map,                // getter: Group atual (userData { land, borders, ground, inside?, heightAt?, heightLL? })
    clouds,             // getter: objeto de nuvens atual (update, frame, setFlashes, setSky, setQuality, visibleCount, info?)
    dots,               // getter: objeto de createGridDots ou null
    state,              // getter: { nuvens, relevo, exagero, grade }
    setClouds(kind: 'solidas'|'volume'|'sprite') → Promise<void>,
    setRelief(on: boolean, exagero?: number) → Promise<void>,   // rejeita se o relevo não carregar
    setDots(on: boolean) → void,
    idle() → Promise<void>,                                       // resolve quando não há troca pendente
  }
  ```
  - `makeCloudSlots(kind)` é a montagem de slots que hoje está em `main.js` (linhas 142–151).
  - `loadRelief()` e `loadNoise()` devolvem promessas; o palco chama cada uma no máximo uma vez e guarda o
    resultado (uma falha não é guardada: a próxima tentativa busca de novo).
  - `onSwap()` é chamado depois de cada troca concluída; `main.js` usa para reaplicar céu, qualidade e
    `refresh` no mesmo quadro.
  - Os objetos de nuvem e os dois mapas ganham `dispose()`: libera geometrias, materiais, texturas e alvos
    de render próprios. Mapas: `map.userData.dispose`.
- Produces, em `window.__rs` (só com `?debug=1`): `stage` e `memory()` → `{ geometries, textures }` de
  `renderer.info.memory`. As chaves existentes continuam.

**Comportamento que os passos não deixam óbvio:**
- Enquanto a troca carrega (ruído do volume, arquivo do relevo), o visual anterior continua na cena. A
  troca na cena é síncrona: remove o antigo, `dispose()`, adiciona o novo, `onSwap()`.
- Chamadas em rajada: vale a última. Uma carga que termina depois de ter sido superada é descartada (e o
  que ela chegou a criar é liberado). `state` só muda quando a troca acontece.
- `setRelief(true, n)` com relevo já ligado e outro exagero reconstrói o relevo.
- Quem dependia do mapa do boot passa a ler `stage.map` a cada uso: `pickLand`, `inside`, `applySky`
  (`ground`), e a altura do terreno do `createCityLift` (`groundLL: (lon, lat) => stage.map.userData.heightLL?.(lon, lat) ?? 0`).
- Depois de trocar o mapa com um município selecionado, a peça levantada é refeita na altura nova, sem
  fechar o painel.
- Estado inicial: `main.js` monta o palco com `parseConfig(location.search)`. Se o relevo inicial falhar,
  segue plano com `console.warn`, como hoje.
- `SLOT_COUNTS` e a escolha `combineClouds` continuam iguais; só mudam de lugar.

- [ ] **Step 1: Escrever o roteiro que falha, `tools/gate-debug.cjs`**

No estilo de `tools/gate-ui.cjs` (mesmo `check`, sai com código 1 se houver falha, imprime erros de console).
Abre `demo=1&debug=1&t=30` e verifica:

```js
const st = () => page.evaluate(() => ({ ...__rs.stage.state, mem: __rs.memory(), info: __rs.stats().cloudInfo, t: __rs.clock.t }));
const cam = () => page.evaluate(() => __rs.view.camera.position.toArray());   // expor `view` em __rs

const a = await st();
check('abre com sólidas, sem relevo, grade ligada', a.nuvens === 'solidas' && !a.relevo && a.grade);

await page.evaluate(() => __rs.stage.setClouds('volume'));
let s = await st();
check('volume entra no lugar', s.nuvens === 'volume' && /^volume /.test(s.info));
check('horário não muda na troca', s.t === a.t);

await page.evaluate(() => __rs.stage.setClouds('sprite'));
check('sprite entra no lugar', (await st()).nuvens === 'sprite');

// Review Focus 1: rajada, sem esperar a primeira
await page.evaluate(async () => { __rs.stage.setClouds('volume'); __rs.stage.setClouds('solidas'); await __rs.stage.idle(); });
check('rajada: vale a última', (await st()).nuvens === 'solidas');

const c0 = await cam();
await page.evaluate(() => __rs.stage.setRelief(true, 12));
s = await st();
check('relevo liga', s.relevo && s.exagero === 12);
const h12 = await page.evaluate(() => __rs.stage.map.userData.heightAt(0, 0));
await page.evaluate(() => __rs.stage.setRelief(true, 24));
const h24 = await page.evaluate(() => __rs.stage.map.userData.heightAt(0, 0));
check('exagero 24 dobra a altura', Math.abs(h24 - 2 * h12) < 1e-6 && h12 > 0, `${h12} -> ${h24}`);
check('câmera não muda na troca', JSON.stringify(await cam()) === JSON.stringify(c0));

// Review Focus 4: município selecionado sobrevive à troca de mapa
await page.evaluate(() => __rs.citySelect.selectByName('Porto Alegre'));
await page.evaluate(() => __rs.stage.setRelief(false));
check('município continua selecionado ao desligar o relevo',
  await page.evaluate(() => !document.getElementById('city').hidden && /Porto Alegre/.test(document.getElementById('city').textContent)));
await page.keyboard.press('Escape');

await page.evaluate(() => __rs.stage.setDots(false));
check('grade desliga', await page.evaluate(() => !__rs.stage.state.grade && !__rs.view.scene.getObjectByName('grid-dots')));
await page.evaluate(() => __rs.stage.setDots(true));

// Review Focus 5: ida e volta não vaza
await page.evaluate(async () => { for (let i = 0; i < 3; i++) { await __rs.stage.setClouds('volume'); await __rs.stage.setRelief(true, 12); await __rs.stage.setClouds('sprite'); await __rs.stage.setRelief(false); await __rs.stage.setClouds('solidas'); } });
await page.waitForTimeout(300);
const b = await st();
check('memória volta ao inicial', b.mem.geometries === a.mem.geometries && b.mem.textures === a.mem.textures, JSON.stringify([a.mem, b.mem]));
check('sem erro de console', errors.length === 0, errors.join(' | '));
```

Segundo trecho do roteiro, estado inicial pela URL: abre `demo=1&debug=1&nuvens=volume&relevo=1&exagero=20`
e verifica `state` igual a `{ nuvens: 'volume', relevo: true, exagero: 20, grade: true }`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tools/gate-debug.cjs`
Expected: FALHA (`__rs.stage` indefinido).

- [ ] **Step 3: Acrescentar `dispose()` aos três módulos de nuvem e aos dois mapas**

Cada um libera só o que ele mesmo criou. No volume, inclui os alvos de render, as texturas de campo e a
textura 3D de ruído (os dados do ruído ficam guardados no palco, a textura é refeita).

- [ ] **Step 4: Implementar `src/render/stage.js` e ligar em `src/main.js`**

`main.js` passa a: `const cfg = parseConfig(location.search)`; cria o palco; lê `stage.map` / `stage.clouds`
/ `stage.dots` dentro de `refresh`, do laço de quadro, de `pickLand` e de `applyQuality`; aplica
`cfg.qualidade` com `quality.lock`; usa `cfg.dados` no lugar da leitura de `demo`/`fixture`; expõe `stage`,
`view` e `memory` em `window.__rs`. `window.__rs` continua condicionado a `cfg.debug`.

- [ ] **Step 5: Rodar e ver passar**

Run: `node tools/gate-debug.cjs`
Expected: todas as linhas `ok`, código de saída 0.

- [ ] **Step 6: Rodar tudo que já existia**

Run: `npm test && node tools/gate-rain.cjs && node tools/gate-ui.cjs && node tools/gate-final.cjs`
Expected: tudo passa, sem editar os roteiros antigos.

- [ ] **Step 7: Commit**

```bash
git add src/render tools/gate-debug.cjs src/main.js
git commit -m "feat(debug): palco troca nuvens, relevo e grade no lugar"
```

---

### Task 4: O menu

**Files:**
- Create: `src/ui/debug-menu.js`
- Modify: `src/ui/debug.js` (sai `createDebug`; `createGridDots` fica)
- Modify: `index.html` (botão ⚙; `#debug` vira o contêiner do menu)
- Modify: `src/ui/style.css` (estilo do botão e do menu; remover as regras antigas de `#debug`, linhas 7 e 59)
- Modify: `src/main.js` (cria o menu sempre; o painel de texto antigo some)
- Modify: `tools/gate-debug.cjs` (trecho de interface)
- Modify: `README.md` (seção "Como rodar": menu, `grade=`, `qualidade=`, `node tools/gate-debug.cjs`)

**Interfaces:**
- Consumes: `parseConfig`, `writeConfig`, `EXAGERO` (Task 1); `quality.lock` (Task 2); `stage` (Task 3).
- Produces: `createDebugMenu(el, { button, config, stage, quality, applyQuality, stats, reload }) → { tick(dt) }`.
  `reload(url)` é `location.assign` em produção; existe para o roteiro não depender de navegação real.
- DOM fixo (o roteiro depende disso):
  - `#debug-toggle`: botão ⚙, sempre visível, `aria-expanded`, `aria-controls="debug"`.
  - `#debug`: contêiner; `hidden` quando fechado. Dentro: `.dbg-stats`, `.dbg-msg` (aviso, vazio sem aviso),
    `input[name=nuvens]` (radio: `solidas|volume|sprite`), `input[name=relevo]` (checkbox),
    `input[name=exagero]` (range, `EXAGERO.min..max`, passo `step`; `disabled` sem relevo) com o valor ao
    lado como `12×`, `input[name=grade]` (checkbox), `input[name=qualidade]` (radio: `auto|alto|medio|baixo`),
    `input[name=dados]` (radio: `live|demo|fixture`), `#debug-copy`, `.dbg-close`.
- Rótulos visíveis, na ordem: `Nuvens` (sólidas, volume, sprite), `Relevo` + `exagero`, `Grade` (pontos do
  dado bruto), `Qualidade` (auto, alto, médio, baixo), `Dados` (ao vivo, demo, fixture),
  `copiar link com esta configuração`.

**Comportamento:**
- Abre aberto com `debug=1`; senão fechado. Abrir/fechar não mexe na URL.
- `.dbg-stats` mostra, a cada 0,25 s, o mesmo conteúdo do painel antigo:
  `60 fps · 16,7 ms` / `puffs N · gotas N` (ou `cloudInfo`) / `draw calls N · qualidade <nome>`.
- Cada ajuste: chama o palco (ou `quality.lock` + `applyQuality`), e ao concluir grava
  `history.replaceState(null, '', '?' + writeConfig(location.search, cfg))` (sem `?` se vazio).
- Durante uma troca pendente o controle acionado fica com `aria-busy="true"`; os outros seguem usáveis.
- Exagero: atualiza o número ao arrastar; reconstrói o relevo no máximo a cada 150 ms durante o arrasto e
  uma vez ao soltar.
- Relevo que falha: checkbox volta para desmarcado, `.dbg-msg` mostra `Relevo indisponível.`, URL não muda.
- `Dados`: chama `reload` com a URL nova. Nada mais.
- `#debug-copy`: `navigator.clipboard.writeText(location.href)`; sucesso mostra `Link copiado.` em
  `.dbg-msg` por 2 s; falha mostra o próprio link em `.dbg-msg` para copiar à mão.
- Esc com o foco dentro do menu fecha o menu (e não o município). Controles alcançáveis por teclado.
- Posição e visual: livres, seguindo `var(--panel)`, `var(--line)` e o resto de `style.css`, respeitando as
  restrições de sobreposição das Global Constraints. Com o menu aberto por `debug=1`, os cliques e toques
  que `gate-ui.cjs` faz no canvas não podem cair em cima do menu.

- [ ] **Step 1: Acrescentar o trecho de interface que falha em `tools/gate-debug.cjs`**

```js
const { page: m } = await open(browser, srv.url, 'demo=1&cam=top&t=5');
check('fechado por padrão, só o botão', await m.evaluate(() => document.getElementById('debug').hidden && !!document.getElementById('debug-toggle').offsetParent));
check('sem debug=1 não expõe __rs', await m.evaluate(() => typeof window.__rs === 'undefined'));
await m.click('#debug-toggle');
check('abre no clique', await m.evaluate(() => !document.getElementById('debug').hidden));
check('estatísticas aparecem', /fps/.test(await m.textContent('.dbg-stats')));

await m.check('input[name=nuvens][value=sprite]');
await m.waitForFunction(() => location.search.includes('nuvens=sprite'));
check('URL preserva cam e t', await m.evaluate(() => location.search === '?cam=top&t=5&nuvens=sprite'), await m.evaluate(() => location.search));

check('exagero desabilitado sem relevo', await m.isDisabled('input[name=exagero]'));
await m.check('input[name=relevo]');
await m.waitForFunction(() => location.search.includes('relevo=1'));
await m.fill('input[name=exagero]', '20');
await m.waitForFunction(() => location.search.includes('exagero=20'));
check('rótulo do exagero', /20×/.test(await m.textContent('#debug')));

await m.check('input[name=qualidade][value=baixo]');
await m.waitForFunction(() => location.search.includes('qualidade=baixo'));
check('estatística mostra qualidade travada', /qualidade baixo/.test(await m.textContent('.dbg-stats')));

await m.check('input[name=grade]');
await m.waitForFunction(() => location.search.includes('grade=1'));

// recarregar com a URL atual reproduz o menu
await m.reload(); await m.waitForFunction(() => document.documentElement.dataset.ready === '1');
await m.click('#debug-toggle');
check('recarregado: menu reflete a URL', await m.evaluate(() => {
  const v = (n) => document.querySelector(`input[name=${n}]:checked`)?.value;
  return v('nuvens') === 'sprite' && v('qualidade') === 'baixo' && document.querySelector('input[name=relevo]').checked
    && document.querySelector('input[name=exagero]').value === '20' && document.querySelector('input[name=grade]').checked;
}));

// Dados recarrega com a URL nova
await m.check('input[name=dados][value=fixture]');
await m.waitForURL(/fixture=1/); await m.waitForFunction(() => document.documentElement.dataset.ready === '1');
check('Dados troca a fonte recarregando', await m.evaluate(() => !location.search.includes('demo=1')));

// Review Focus 3: relevo indisponível
const { page: f } = await open(browser, srv.url, 'demo=1');
await f.route('**/relief.bin.gz', (r) => r.abort());
await f.click('#debug-toggle'); await f.check('input[name=relevo]').catch(() => {});
await f.waitForFunction(() => document.querySelector('.dbg-msg').textContent.includes('Relevo indisponível'));
check('relevo falho: desmarcado, URL intacta', await f.evaluate(() => !document.querySelector('input[name=relevo]').checked && !location.search.includes('relevo')));

// sobreposição, desktop e celular
for (const [w, h] of [[1280, 800], [390, 844]]) {
  const { page: p } = await open(browser, srv.url, 'demo=1&debug=1', { width: w, height: h });
  const hit = await p.evaluate(() => {
    const r = (id) => { const e = document.getElementById(id); return e && !e.hidden ? e.getBoundingClientRect() : null; };
    const d = r('debug'), over = (b) => b && !(d.right <= b.left || d.left >= b.right || d.bottom <= b.top || d.top >= b.bottom);
    return ['timeline', 'search'].filter((id) => over(r(id)));
  });
  check(`menu não cobre nada em ${w}×${h}`, hit.length === 0, hit.join(','));
}
```

Acrescentar também: abrir um município (`__rs.citySelect.selectByName('Porto Alegre')`) com o menu aberto e
conferir que `#debug` e `#city` não se sobrepõem, nas duas larguras.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tools/gate-debug.cjs`
Expected: o trecho da Task 3 passa; o novo falha em `#debug-toggle` inexistente.

- [ ] **Step 3: Implementar o menu (`debug-menu.js`, `index.html`, `style.css`) e ligar em `main.js`**

- [ ] **Step 4: Rodar e ver passar**

Run: `node tools/gate-debug.cjs`
Expected: todas as linhas `ok`, código de saída 0.

- [ ] **Step 5: Rodar tudo**

Run: `npm test && node tools/gate-rain.cjs && node tools/gate-ui.cjs && node tools/gate-final.cjs`
Expected: tudo passa, sem editar os roteiros antigos.

- [ ] **Step 6: Olhar o resultado**

Tirar capturas em 1280×800 e 390×844 (escala 2) com o menu aberto em `demo=1&debug=1&t=30`, uma com
`nuvens=volume&relevo=1`, e salvar em `review-shots/menu-debug/`. Conferir a olho: legível, alinhado com o
resto da interface, nada cortado.

- [ ] **Step 7: Atualizar o `README.md` e commit**

```bash
git add src index.html tools/gate-debug.cjs README.md review-shots/menu-debug
git commit -m "feat(debug): menu de debug com ajuste ao vivo e URL sincronizada"
```
