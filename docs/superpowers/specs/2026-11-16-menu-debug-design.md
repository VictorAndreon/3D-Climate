# Menu de debug — design

Data: 2026-11-16. Tamanho: mudança pequena. Primeiro de dois projetos; o segundo (Brasil grosso + estado
fino) terá design próprio.

## Intenção

Hoje as opções de visual e de dado (`debug`, `nuvens`, `relevo`, `exagero`, `demo`, `fixture`) só mudam
editando a URL e recarregando. Queremos um menu na tela para ajustar essas opções e ver o efeito na hora,
sem perder a câmera nem o horário da linha do tempo. Serve para comparar visuais e vai servir para calibrar
a visão do Brasil no projeto seguinte.

## O que o menu tem

```
⚙ Debug                         [×]
─────────────────────────────────
60 fps · 16,7 ms · qualidade alto
draw calls 14 · puffs 1.820 · gotas 640

Nuvens     (•) sólidas ( ) volume ( ) sprite
Relevo     [x]    exagero  ──●────  12×
Grade      [ ] pontos do dado bruto
Qualidade  (•) auto ( ) alto ( ) médio ( ) baixo
Dados      (•) ao vivo ( ) demo ( ) fixture
─────────────────────────────────
[copiar link com esta configuração]
```

| Controle | Parâmetro de URL | Troca |
|---|---|---|
| Nuvens | `nuvens=sprite\|volume` (ausente = sólidas) | no lugar |
| Relevo | `relevo=1` | no lugar |
| Exagero | `exagero=N` (padrão 12; só ativo com relevo ligado) | no lugar |
| Grade | `grade=1` (novo) | no lugar |
| Qualidade | `qualidade=alto\|medio\|baixo` (novo; ausente = auto) | no lugar |
| Dados | `demo=1` / `fixture=1` (ausente = ao vivo) | recarrega a página |

As estatísticas (fps, tempo de quadro, draw calls, puffs/gotas, qualidade) ficam no topo do menu, no lugar
do painel de texto atual.

## Comportamento

- Um botão ⚙ discreto fica sempre visível num canto e abre/fecha o menu. `?debug=1` abre a página com o
  menu já aberto.
- A URL é o estado inicial: abrir com `?nuvens=volume&relevo=1` monta exatamente isso e o menu reflete.
- Cada ajuste atualiza a URL sem recarregar (`history.replaceState`), então o link da barra de endereço e o
  do botão "copiar link" reproduzem o que está na tela. Parâmetros que o menu não conhece (`cam`, `dist`,
  `look`, `polar`, `t`) são preservados como estão.
- Troca no lugar mantém câmera, horário, play/pause e o município selecionado.
- Trocar "Dados" recarrega a página com a URL nova. Câmera e horário se perdem nesse caso; é aceito.
- `?debug=1` continua expondo `window.__rs` e ligando os pontos da grade, como hoje, para os roteiros.

## Objetivos, não-objetivos, anti-objetivos

- Objetivo: todo parâmetro de visual ajustável na tela, com efeito imediato.
- Não-objetivo: controles de câmera e horário no menu (`cam`, `dist`, `look`, `polar`, `t` seguem só na URL,
  para os roteiros). Não-objetivo: sliders para as constantes internas dos shaders de nuvem.
- Não-objetivo: trocar a fonte de dados sem recarregar. Isso entra no projeto do Brasil, que precisa disso
  de qualquer forma para carregar um estado ao clicar.
- Anti-objetivo: quebrar os roteiros (`gate-rain`, `gate-ui`, `gate-final`, `shots`) ou os 163 testes. As
  URLs que eles usam precisam produzir o mesmo resultado de hoje.
- Anti-objetivo: o menu atrapalhar quem não quer debug. Fechado, é só o botão ⚙.

## Restrições

- Sem build e sem dependência nova: módulos ES, HTML e CSS na mão, como o resto do projeto.
- Funciona no celular (o menu não pode cobrir a linha do tempo nem o painel do município).
- Lógica de estado (URL ↔ configuração) em módulo puro, com testes em `node --test`.

## Abordagens consideradas

1. **Recarregar a página a cada ajuste.** Quase nenhum código, mas a tela pisca, o ruído do volume é
   refeito, câmera e horário se perdem. Arrastar o exagero fica inviável. Descartada.
2. **Trocar tudo no lugar, inclusive os dados.** Mais fluida, mas linha do tempo, painel e cache assumem um
   dado só por sessão; mexer nisso é risco alto para um controle pouco usado. Adiada para o projeto do Brasil.
3. **Misto (escolhida pelo Victor).** Nuvens, relevo, exagero, grade e qualidade trocam no lugar; só "Dados"
   recarrega.

## Como (decisões do Claude, não do Victor)

- Um módulo puro de configuração: lê os parâmetros da URL para um objeto, e escreve o objeto de volta numa
  query string preservando o que não conhece e omitindo valores padrão.
- `main.js` passa a ter funções de montar/desmontar para nuvens e para o mapa. Quem depende do mapa
  (levantamento do município, tooltip, clique) deve ler o mapa atual por referência indireta, não capturar
  o objeto criado no boot.
- Desmontar libera geometrias, materiais, texturas e alvos de render do que sai (hoje nuvens e mapas não
  têm `dispose`; precisa ser criado).
- O ruído 3D do volume e o arquivo de relevo são carregados na primeira vez que são pedidos e guardados;
  alternar de volta não refaz. Enquanto carregam, o controle mostra estado de espera e o visual anterior
  continua na tela.
- Se o relevo falhar ao carregar, o controle volta para desligado com aviso no menu (hoje só vai um
  `console.warn`).
- O exagero reconstrói o relevo ao soltar o controle, ou com atraso curto enquanto arrasta, o que ficar
  fluido na prática.
- Qualidade travada ignora o ajuste automático; em "auto" ele volta a mandar.

## Deixado para quem implementar

Posição exata e estilo do botão e do menu, faixa e passo do slider de exagero, texto dos avisos, e como
dividir `main.js` para as trocas no lugar.
