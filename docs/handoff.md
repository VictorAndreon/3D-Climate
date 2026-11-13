# Prompt para continuar em outra sessão

Cole o bloco abaixo numa sessão nova, apontando para a mesma pasta `/home/user/rs-tempo-3d` (ou para um clone dela).

```
Projeto: /home/user/rs-tempo-3d (RS Tempo 3D). Leia nesta ordem:
1. DESIGN.md — a spec, é a autoridade.
2. docs/superpowers/plans/2026-11-13-rs-tempo-3d.md — o plano (9 tasks).
3. .superpowers/sdd/2026-11-13-rs-tempo-3d/progress.md — o ledger. Se essa pasta sumiu
   (é git-ignored), o histórico está em `git log` e as decisões na seção "Decisões" do README.md.

Estado: as 9 tasks do plano estão completas e commitadas em main. 151 testes verdes (`npm test`);
os portões tools/gate-rain.cjs, tools/gate-ui.cjs e tools/gate-final.cjs passaram. assets/fixture.json
é uma resposta REAL do Open-Meteo gravada em 13/11/2026 12:00.

Falta só o passo final da skill superpowers:executing-plans:
- Revisão do branch inteiro (base 8f0dc1f até HEAD) por um revisor de contexto limpo, usando
  superpowers:requesting-code-review. Ignorar vendor/, assets/*.json, test/data/, package-lock.json.
  Checar os 5 itens da seção "Review Focus" do plano e as linhas "Ruling:" do ledger.
- Triagem: Crítico/Importante entram numa única passada de correção, cada uma com teste que falha
  antes e passa depois, mais `npm test` verde no final. Menor vai para o ledger como
  "Final: minor (deferred)".
- Rodar de novo os três portões depois das correções (cada um leva 1–2 min; rode em background).
- Commit com mensagem em português. Não publicar, não dar push, não abrir PR.
- No final, me entregue: lista "Rulings que tomei" (todas as linhas Ruling: do ledger, com o custo
  se estiver errada), "Minors adiados" e o que só eu consigo verificar no meu navegador (README,
  seção "O que só você confirma").

Regras do design: não perguntar, não esperar; onde houver margem, escolher e anotar em uma linha
no README. Nada de bibliotecas em runtime além do Three.js. Nunca apresentar dado sintético como real.
```
