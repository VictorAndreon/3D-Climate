# Brasil inteiro com mergulho por estado — design

Data: 2026-11-17. Tamanho: projeto. Segundo de dois; o primeiro (menu de debug) está na `main`.

## Intenção

Hoje o site mostra só o Rio Grande do Sul. O Victor quer acompanhar o Brasil inteiro, por ser bonito de
olhar, sem perder o que faz o projeto diferente dos outros sites de clima: a nitidez regional em 3D.

As duas coisas brigam: com o país inteiro na tela, uma nuvem na resolução de hoje vira um pixel, e buscar
o país nessa resolução estoura a cota grátis da API. A saída combinada: **o Brasil aparece com dado e
nuvens mais gerais; ao escolher um estado, ele vira uma maquete sozinha, nítida como o RS é hoje.**

Este é o caminho "A" (estado isolado). O caminho "B" (estado nítido com o resto do Brasil em volta) fica
para depois, e este projeto não pode fechar a porta para ele.

## Como funciona para quem usa

```
Abre no Brasil                          Clicou em SP
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ 🔍 estado ou município   ⚙  │        │ ← Brasil   🔍 município   ⚙ │
│                              │        │                              │
│      Brasil inteiro,         │  ──▶   │     só SP, peça solta,       │
│   divisas dos estados,       │ mergulho│  municípios, nuvens finas,   │
│   nuvens e chuva grandes     │        │  painel ao clicar (como hoje)│
│                              │        │                              │
│ ▶ ── linha do tempo ───────  │        │ ▶ ── mesma hora de antes ──  │
└──────────────────────────────┘        └──────────────────────────────┘
```

### Visão Brasil

- É a visão de abertura quando a URL não diz outra coisa.
- Uma peça só com o contorno do país e as divisas dos estados. Sem municípios.
- Nuvens, chuva e raios como hoje, alimentados por uma grade de 1° (887 pontos medidos).
- Passar o mouse mostra o nome do estado e o tempo naquele ponto (o mesmo tooltip de hoje, com o nome do
  estado no lugar do município). Clicar ou tocar num estado entra nele.
- A busca acha estados e municípios do país inteiro. Escolher um estado entra nele; escolher um município
  entra no estado dele e já o seleciona (peça levantada, painel aberto, câmera nele).

### Visão de estado

- Igual ao RS de hoje, para qualquer um dos 27: peça do estado solta, divisas municipais, tooltip, clique
  no município, painel com meteograma, busca por município (só do estado).
- Grade de 0,25°, como hoje.
- Um controle "← Brasil" volta para a visão do país. O botão Voltar do navegador faz o mesmo. Esc continua
  só fechando o município selecionado; não sai do estado.

### Troca entre as duas

- Sem recarregar a página. A câmera mergulha em direção ao estado clicado, a cena troca e a câmera chega
  na vista padrão do estado. Com `prefers-reduced-motion`, a troca é um corte.
- O instante da linha do tempo se mantém (mesma data e hora absolutas), assim como play/pause e a
  velocidade. Se o instante não existir no dado novo, vai para o mais próximo que existir.
- O dado fino do estado só é buscado ao entrar nele. Enquanto busca, o Brasil continua na tela, com
  indicação de carregamento no estado escolhido.
- Se a busca falhar e não houver cache daquele estado, a troca não acontece: continua no Brasil, com um
  aviso. (Abrindo direto em `?uf=SP` não há para onde voltar; vale a regra de hoje: dado sintético com o
  selo de aviso.)
- Um clique em outro estado enquanto o primeiro carrega troca o destino; vale o último.

### URL

- `?uf=SP` abre direto no estado. Sem `uf`, abre no Brasil. Valor desconhecido: abre no Brasil.
- Entrar e sair de um estado atualiza a URL e cria uma entrada no histórico do navegador.
- Os parâmetros do menu de debug (`nuvens`, `grade`, `qualidade`, `demo`, `debug`) valem nas duas visões e
  são preservados nas trocas.

## Objetivos, não-objetivos, anti-objetivos

**Objetivos**
- Abrir no Brasil e ver o tempo do país em 3D.
- Entrar em qualquer estado e ter a mesma experiência que o RS tem hoje.
- Trocar de visão com continuidade (câmera, hora).
- Estrutura que aceite o caminho B depois sem reescrita.

**Não-objetivos**
- Caminho B (estado em contexto, dois níveis de dado na tela).
- Relevo fora do RS. Decisão do Victor: fica para um passo seguinte. Nos outros estados e no Brasil o
  controle de relevo do menu de debug aparece desabilitado.
- Resto do mundo.
- Modo fixture fora do RS (é dado gravado para teste; `fixture=1` só vale com `uf=RS`).
- Ilhas oceânicas: Trindade e Martin Vaz, São Pedro e São Paulo ficam fora. Fernando de Noronha entra no
  dado de PE mas não no enquadramento da câmera.

**Anti-objetivos** (falha mesmo se funcionar)
- O RS ficar pior do que é hoje, em visual ou em desempenho.
- Estourar a cota da API em uso normal (abrir, passear por alguns estados).
- Dado sintético ou velho apresentado como atual. Os selos de hoje continuam valendo, por região.
- O Brasil ficar feio: nuvens grandes e estilizadas são o esperado, borrão ou pontilhado não.

## Restrições

- Sem build e sem dependência nova de execução, como hoje. Só caminhos relativos (GitHub Pages).
- API: Open-Meteo grátis. O limite de memória do autor é 10 mil chamadas por dia, cada ponto contando como
  uma; **não foi possível confirmar na documentação** (site bloqueado no ambiente de desenvolvimento). O
  desenho assume esse limite e mantém folga.
- Custos medidos (grade com a mesma regra do RS: nós dentro do território mais os 8 vizinhos):

  | Região | Pontos | Municípios |
  |---|---|---|
  | Brasil a 1° | 887 | — |
  | Amazonas | 2.296 | 62 |
  | Pará | 1.854 | 143 |
  | Mato Grosso | 1.400 | 141 |
  | Minas Gerais | 991 | 853 |
  | Bahia | 936 | 417 |
  | RS (hoje) | 546 | 496 |
  | São Paulo | 469 | 645 |
  | Distrito Federal | 28 | 1 |

  Dezoito dos 27 estados pesam o mesmo que o RS ou menos. Total de municípios: 5.564.
- Cache de 1 h por região, como hoje. Só a região na tela é recarregada quando o dado vence.
- A grade e o `gridVersion` do RS não mudam: a fixture gravada e o cache de quem já usa continuam válidos.
- Fontes de malha: as mesmas do RS hoje (`tbrugz/geodata-br`), acessíveis no ambiente.
- Malhas geradas ficam no repositório, uma por região, baixadas conforme o uso. Ordem de grandeza: 16 MB
  no total. Nenhuma região pode pesar mais que o RS pesa hoje por arquivo de forma desproporcional: o
  limite de 350 KB do arquivo de contorno vale para cada estado.
- Testes dos módulos puros com `node --test`; roteiros Playwright para o resto.

## Abordagens consideradas

1. **Recarregar a página por região.** `?uf=SP` monta a cena do zero. Barato, mas sem mergulho, com a tela
   piscando a cada troca, e o caminho B exigiria refazer. Descartada.
2. **Trocar a região no lugar (escolhida).** Brasil e cada estado são "regiões" com projeção, grade e dado
   próprios; a cena desmonta uma e monta a outra com a câmera voando entre elas. Estende o palco feito para
   o menu de debug. Custa ensinar linha do tempo, busca, painel e tooltip a serem trocados.
3. **Mundo único com camadas.** Brasil sempre carregado, estado por cima. É o próprio caminho B. Adiada.

A escolha da abordagem foi delegada ao Claude; o Victor escolheu o caminho A "pensando no B".

## Decisões do Victor

- Brasil geral + estado nítido, estado isolado (A) agora, B depois.
- Menu de debug antes (feito).
- Relevo dos outros estados fica para depois.
- Aceitou as propostas da seção "Como funciona" (abertura no Brasil, `?uf=`, busca nacional, hora mantida,
  carga sob demanda, fuso por estado, ilhas, fixture só no RS, peso no repositório).

## Como (decisões do Claude)

### Região

Uma região é um conjunto fechado: identificador (`BR` ou a sigla da UF), nome, malha, grade, projeção,
fuso e, depois de carregada, o dado. Tudo que hoje é global do RS passa a vir da região:

- **Projeção.** Deixa de ser constante de módulo (`LON0`, `LAT0`, 10 km por unidade) e vira um objeto
  criado por região, passado explicitamente a quem precisa. Hoje 13 módulos importam a projeção global.
  Não pode ser um "atual" global mutável: o caminho B precisa de duas projeções vivas ao mesmo tempo.
- **Escala.** Cada região é projetada centrada nela mesma e com os quilômetros por unidade escolhidos
  para caber num tamanho de cena parecido com o do RS hoje. O RS continua em 10 km por unidade, exatamente
  como está. O Brasil fica perto de 60 km por unidade; o Amazonas, perto de 25. Consequência aceita: em
  regiões maiores as nuvens ficam proporcionalmente maiores. Alturas de nuvem, chuva e câmera não mudam.
  O ponto certo de cada região grande é calibrado olhando, com o menu de debug.
- **Câmera.** Alvo, limites de passeio e vistas padrão hoje são números do RS em `scene.js`; passam a ser
  derivados dos limites da região.
- **Fuso.** A luz do dia e os horários exibidos usam o fuso oficial da região: UTC-3 na maioria; UTC-4 em
  AM, MT, MS, RO, RR; UTC-5 no AC. Fernando de Noronha segue o fuso de PE. No Brasil, horário de Brasília.
- **Dado.** Carga, cache e selo por região, com a lógica de hoje (`source.js`), sem mudança de regra. A
  recarga automática de dado vencido pode continuar sendo um recarregamento da página, já que a URL passa
  a dizer em que região se está.

### Arquivos gerados

- Um índice leve das regiões (sigla, nome, centro, limites, fuso, número de pontos), carregado na abertura.
- Um arquivo do Brasil: contorno do país, divisas estaduais, polígono de cada estado para o clique, grade
  de 1°.
- Por estado: um arquivo de contorno e grade no formato de hoje, e um de polígonos municipais no formato
  de hoje, este baixado só quando precisa.
- Um índice de busca nacional (nome do município, UF, centro), baixado na primeira vez que a busca do
  Brasil é usada.
- `tools/build-geo.mjs` gera tudo de uma vez. O arquivo do RS gerado tem de sair com a mesma grade de hoje.

### Troca no lugar

- O palco do menu de debug vira dono de uma região inteira: mapa, nuvens, chuva, raios, pontos da grade.
- Linha do tempo, tooltip, painel, seleção e busca hoje são criados uma vez e registram ouvintes de evento
  que nunca são removidos (35 registros, nenhuma remoção). Cada um ganha um jeito de ser desligado ou de
  trocar de dado, sem deixar ouvinte nem objeto para trás.
- O relógio passa a guardar o instante absoluto, para sobreviver à troca de dado.
- Vale a mesma disciplina do menu de debug: em rajada vale o último pedido; o que sai é liberado; a
  memória de GPU volta ao que era depois de ir e voltar.

### Estados grandes

AM, PA e MT têm de 3 a 4 vezes os pontos do RS. Com a escala ajustada a cena não cresce, então a contagem
de nuvens e gotas não precisa crescer na mesma proporção. O que cresce é o custo de preparar o dado por
quadro e o número de requisições (46 lotes no Amazonas contra 11 no RS). Critério: entrar no Amazonas e
passear por ele não pode ser visivelmente mais lento que o RS na mesma máquina.

### Roteiros de verificação

- Os roteiros de hoje (`gate-rain`, `gate-ui`, `gate-final`, `gate-debug`, `shots`) assumem o RS na
  abertura. Passam a abrir com `uf=RS`; fora isso, as verificações ficam iguais e têm de continuar
  passando. Diferente do projeto anterior, aqui editar a URL desses roteiros é esperado.
- Um roteiro novo cobre: abertura no Brasil, entrar e sair de estado, hora mantida, busca nacional,
  falha de carga, rajada de cliques, memória, `?uf=`, Voltar do navegador.

## Deixado para quem implementar

- Como dividir o trabalho em etapas entregáveis. Sugestão: primeiro "qualquer estado por `?uf=`" (região
  e projeção parametrizadas, sem troca no lugar), depois a visão Brasil, depois a troca com mergulho.
- Valores exatos de escala por região, contagens de nuvens e gotas, e o desenho do mergulho de câmera.
- Aparência do controle "← Brasil", da indicação de carregamento do estado e do aviso de falha.
- Como a busca diferencia estado de município na lista, e municípios homônimos em estados diferentes.
- Nível de simplificação das malhas por estado dentro do limite de tamanho.
- Formato exato do índice de regiões e do índice de busca.

## Riscos conhecidos

- **Limite da API não confirmado.** Se cada ponto não contar como uma chamada, há mais folga; se o limite
  for menor, o Amazonas e o Pará são os primeiros a sofrer.
- **Visual do Brasil a 1°.** Pode pedir um passo intermediário (0,75° são 1.503 pontos) ou ajuste de
  tamanho de nuvem. Só dá para saber olhando.
- **Lentidão do ambiente de desenvolvimento.** O renderizador por software deixa os roteiros lentos e as
  capturas de tela instáveis (visto no projeto anterior).
