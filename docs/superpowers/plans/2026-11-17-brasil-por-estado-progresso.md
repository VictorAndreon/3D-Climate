# Brasil com mergulho por estado — progresso

As 6 tarefas estão concluídas. Falta a revisão final da branch inteira e a decisão de levar para a `main`.


Plano: `docs/superpowers/plans/2026-11-17-brasil-por-estado.md`.
Design: `docs/superpowers/specs/2026-11-17-brasil-por-estado-design.md`.
Branch: `claude/gifted-brahmagupta-1gfna8`. A `main` está em `889009d` (só o menu de debug).
Execução: um subagente Sonnet por tarefa, mais um revisor por tarefa. Pausado a pedido do Victor para
poupar tokens.

## Estado das tarefas

| # | Tarefa | Estado | Commit |
|---|---|---|---|
| 1 | Projeção como objeto | concluída, revisão limpa | `d5e59b0` |
| 2 | Malhas e grades de todas as regiões | concluída, revisão limpa | `2bb11c3` |
| 3 | Região carregável e `?uf=` | concluída, revisão limpa | `3fb9b7a` |
| 4 | Brasil como região de abertura | concluída, revisão limpa | `76eb8cc` |
| 5 | Peças que sabem ser desligadas | concluída, revisão limpa após 1 correção | `b91191b` |
| 6 | Entrar e sair de estado sem recarregar | concluída, revisão limpa após 1 correção | `74fe3e9` |

## Tarefa 3: onde parou

O implementador foi interrompido no passo 6 (olhar as capturas e calibrar o enquadramento). O que existe
está no commit `wip`:

- Código, testes unitários (238 de 238 passam) e `tools/gate-regiao.cjs`.
- Roteiros rodados **antes** da última mudança, todos com saída 0: `gate-regiao` (18 ok), `gate-ui` (22 ok),
  `gate-debug` (31 ok), `gate-final` (13 ok). `gate-rain` falhou só por tempo de `page.screenshot`; a cópia
  sem a captura passou.
- Capturas em `review-shots/regioes/` (AL, AM, BA, DF, SP), tiradas com o piso de escala em 6 km.

**Estado inconsistente a resolver primeiro:** o implementador baixou o piso de `fitProjection` de 6 para 3
km por unidade (em `src/geo/projection.js` e no teste) e estava regenerando as malhas com `npm run geo`
quando foi parado. A geração não terminou: `assets/regions/index.json` ainda tem as projeções calculadas
com o piso de 6. Não se sabe por que ele escolheu 3 (não chegou a escrever o relatório); provavelmente os
estados pequenos (DF, AL, SE) ficaram pequenos demais na tela.

Para retomar a tarefa 3:

1. Olhar `review-shots/regioes/DF.png` e `AL.png` e decidir o piso (6, 3 ou outro).
2. Deixar `src/geo/projection.js`, `test/projection.test.mjs` e as malhas coerentes: rodar `npm run geo`
   (cerca de 30 s) e `npm test`. O RS não pode mudar (`RS.json` idêntico).
3. Refazer as capturas dos estados pequenos e conferir.
4. Rodar de novo, um por vez: `gate-regiao`, `gate-ui`, `gate-debug`, `gate-final`.
5. Trocar o commit `wip` por um commit final (`feat: qualquer estado por ?uf=`) ou commitar por cima.
6. Passar pela revisão de tarefa (spec + qualidade) antes de seguir para a tarefa 4.

## Decisões tomadas durante a execução

- **Teste instável herdado:** em `tools/gate-debug.cjs`, "câmera não muda na troca" falha de vez em quando
  porque a página abre com voo de câmera. A tarefa 4, que edita esse roteiro, deve abrir essa página com
  `cam=se`.
- **Fernando de Noronha:** fica fora do contorno desenhado (regra existente descarta anéis com menos de 50
  km²), mas está na grade, na lista de municípios e na busca de PE.
- **Centro de UF em `BR.json`:** conferido pelo revisor, todos os 27 caem dentro do próprio estado.
- **Anel estranho no contorno do Brasil:** 5 vértices perto de (-52,7; -17,4), provavelmente ilha em
  reservatório. Conferir na tela na tarefa 4.
- **Tamanho das malhas:** 58 arquivos, 7,5 MB (a estimativa era 16 MB).

## Pendências menores anotadas pelas revisões (não corrigidas)

- `syntheticSeries(grid, start, proj, hours)` tem `proj` posicional, fácil de errar.
- O campo do modo demo é definido em km em torno do centro da projeção.
- O filtro de 50 km² em `tools/build-geo.mjs` usa o cosseno da latitude do RS para todos os estados.
- `isOceanic` corta por "centroide a leste de -30°"; funciona, mas o corte poderia ser mais justo.

## Notas do ambiente (para quem retomar)

- `npm install` antes de `npm test` (um teste importa o `three`).
- Roteiros Playwright levam de 2 a 6 minutos cada no renderizador por software. Rodar um por vez e fechar
  cada página antes de abrir a próxima.
- `page.screenshot` pode estourar 30 s em pontos aleatórios; `gate-rain` falha por isso mesmo com o código
  antigo. Verificar com uma cópia sem a linha da captura.
- Commits levam os trailers `Co-Authored-By` e `Claude-Session`.
