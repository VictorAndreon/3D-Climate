# RS Tempo 3D — design v2

Projeto lúdico, uso pessoal, construído 100% por IA. Este documento é a fonte de verdade: todas as decisões abaixo estão **fechadas**. Quem constrói não pergunta, não espera aprovação e não reabre decisão; onde o texto deixa margem, escolhe, segue e anota em uma linha no README (seção "Decisões").

## 1. Intenção

Visualizador web 3D do Rio Grande do Sul para ver a previsão do tempo de um jeito divertido. Nuvens, chuva e raios são estilizados, mas ancorados nos dados reais de previsão, ponto a ponto. Referência visual: mapa de telejornal em maquete 3D. Referência de interação: terreno 3D com linha do tempo (protótipo de incêndio do Dilum Sanjaya, que existe só em vídeo).

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos**
- Linha do tempo que começa na hora atual e avança pela previsão, com scrub e play.
- Fidelidade espacial "próxima o suficiente": céu limpo onde o dado diz limpo, chuva só onde o dado diz chuva.
- Bonito e fluido em notebook com GPU integrada.

**Não-objetivos**
- Precisão de radar ou satélite. Não é ferramenta meteorológica.
- Outros estados, uso comercial, relevo real, MapLibre (fase 2, fora deste documento).

**Anti-objetivos (falha mesmo funcionando)**
- A1. Chuva desenhada sobre célula cuja previsão daquela hora é seca.
- A2. Nuvens sem relação com o dado, ou grade quadriculada visível nas nuvens.
- A3. Cena travando, ou mais de ~3 s até o primeiro quadro útil com cache.

**Expectativa calibrada (não é bug):** em dia de frente fria o dado é um cobertor sobre o estado todo e a cena mostra isso. Modelo global a ~25 km não gera pancada isolada, então a chuva parece mais lisa que a real.

## 3. Ambiente de construção (verificado em 13/11/2026)

Testado a partir do container de nuvem onde a IA trabalha:

| Host | Resultado | Consequência |
|---|---|---|
| `api.open-meteo.com` | conexão cortada pelo proxy da sessão | a IA não testa a API ao vivo; desenvolve contra fixture |
| `servicodados.ibge.gov.br` | conexão cortada pelo proxy da sessão | não usar; não é bloqueio do IBGE |
| `cdn.jsdelivr.net` | recusado (403 do proxy) | Three.js vai **vendorizado**, sem CDN |
| `raw.githubusercontent.com` | OK | fonte da malha municipal |
| registro npm | permitido por padrão | de onde sai o Three.js e o mapshaper |

Se o construtor estiver em outro ambiente com acesso à API, grava uma resposta real como fixture e usa nos testes. Se não, segue com a sintética. Em nenhum caso para pra pedir acesso.

## 4. Stack e entrega

- HTML + ES modules, **sem build**. Servir com qualquer servidor estático; pronto para GitHub Pages (só caminhos relativos).
- Three.js em versão exata fixada (0.170.0 ou mais nova), copiado do pacote npm para `vendor/three/` e resolvido por import map local. Nenhuma dependência de rede em tempo de execução além da API do tempo.
- Testes dos módulos puros com `node --test`, sem dependências.
- Verificação visual com Playwright (Chromium já instalado), sempre em modo demo ou fixture.
- Pasta: `/home/user/rs-tempo-3d`. Repositório git local com commits por etapa.

```
index.html
vendor/three/            Three.js fixado
assets/rs.json           malha simplificada + centroides
assets/fixture.json      resposta no formato da API (sintética ou gravada)
src/data/                grade, fetch, cache, WeatherField (não conhece o renderizador)
src/geo/projection.js    lon/lat <-> cena (único ponto a trocar na fase 2)
src/render/              mapa, nuvens, chuva, raios, luz
src/ui/                  linha do tempo, tooltip, legenda, debug
tools/build-geo.mjs      baixa e simplifica a malha (roda uma vez, saída commitada)
test/                    testes dos módulos puros
```

## 5. Dados

### 5.1 Geometria
- Fonte: `https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-43-mun.json` (1,8 MB, 497 municípios, acesso confirmado).
- `tools/build-geo.mjs` simplifica com mapshaper (via npx) até `assets/rs.json` ≤ 350 KB, gera o contorno do estado por dissolve e calcula o centroide de cada município (nome, lon, lat).
- O arquivo fica commitado. Nada de geometria é buscado em tempo de execução.

### 5.2 Grade
- Pontos a cada 0,25° em lon e lat, alinhados a múltiplos de 0,25. Entram os pontos dentro do contorno do RS mais uma borda de 1 célula. Esperado: 300–400 pontos.
- A grade é calculada no build-geo e salva em `assets/rs.json`, junto de um `gridVersion`.

### 5.3 Previsão
- Open-Meteo `/v1/forecast`, sem chave.
- Parâmetros: `hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation,weather_code,wind_speed_10m,wind_direction_10m`, `forecast_hours=168`, `timeformat=unixtime`, `timezone=America/Sao_Paulo`.
- Sempre busca 168 h. A interface mostra 72 h por padrão e tem um botão para 7 dias; isso não gera nova requisição.
- Lotes de 50 pontos por requisição, no máximo 4 em paralelo. Resposta de 1 ponto vem como objeto e de vários como array: normalizar. Valores `null` viram 0.
- **A confirmar no primeiro uso real** (o construtor não consegue testar): `forecast_hours` começando na hora corrente. Defesa obrigatória no código: localizar o índice de "agora" pelo timestamp, nunca assumir que é o índice 0.
- Cota (da documentação, de memória): cada ponto conta como uma chamada; limites de 600/min, 5 mil/h e 10 mil/dia. Uma carga custa ~350.

### 5.4 Cache e falhas
- IndexedDB, um registro por `gridVersion`, com os valores em `Uint8Array`/`Float32Array` (cobertura 0–100 em 1 byte) e o horário da busca. **Não usar localStorage** (o volume estoura a cota de ~5 MB).
- Validade de 1 h. Dentro da validade, não há requisição.
- Falha de rede com cache vencido: usa o cache e mostra aviso "dados de HH:MM (desatualizados)".
- Falha de rede sem cache: entra em modo demo com aviso visível "DEMO — dados sintéticos". Nunca apresentar dado sintético como real.

### 5.5 Modos por URL
- `?demo=1`: campo sintético determinístico (ruído com buracos de céu limpo, uma faixa de chuva atravessando o estado, um núcleo de trovoada).
- `?fixture=1`: carrega `assets/fixture.json` pelo mesmo caminho de parsing da API.
- `?debug=1`: painel com fps, tempo de quadro, contagem de puffs e gotas, draw calls, nível de qualidade; e pontos da grade no chão coloridos pelo dado **bruto** (cinza = seco, azul = chuva, amarelo = trovoada).

## 6. WeatherField (módulo puro)

Entrada: grade + séries horárias. Tempo `t` em horas fracionárias desde o primeiro timestamp.

- `sample(lon, lat, t)` devolve `{low, mid, high, wind}`: interpolação **bilinear no espaço e linear no tempo**. É o que elimina a grade visível (A2). Pontos fora da grade usam o vizinho mais próximo.
- `rain(lon, lat, t)` devolve mm/h com regra própria, que é o que garante A1:
  - O valor de `precipitation` no índice `h` é o acumulado do intervalo `(h-1, h]`. Para `t` nesse intervalo, a taxa da célula é `P[h]`, em degrau, sem interpolar com a hora vizinha.
  - Uma célula é "molhada" em `t` se `P[h] ≥ 0,1`. O ponto consultado pertence à célula do nó de grade mais próximo. **Se essa célula é seca, o retorno é 0**, sem exceção.
  - Dentro de célula molhada, a intensidade pode ser suavizada bilinearmente com as vizinhas, e ganha um fade de 10 min de tempo simulado nas viradas de hora (só de intensidade, nunca ligando chuva em célula seca).
- `storm(lon, lat, t)` é verdadeiro se a célula do ponto tem `weather_code` entre 95 e 99 na hora ativa. Na prática só o 95 aparece fora da Europa.
- `cellInfo(lon, lat, t)` devolve os valores brutos da célula para o tooltip.

**Testes obrigatórios** (`node --test`):
- Propriedade A1: em campo aleatório, para milhares de pontos e tempos, `rain() > 0` implica célula bruta com `P[h] ≥ 0,1`.
- Bilinear reproduz o valor exato nos nós e é contínua entre células.
- Índice de "agora" achado por timestamp com séries que começam à meia-noite e na hora corrente.
- Normalização de resposta (objeto único, array, `null`).

## 7. Como o dado vira cena

### 7.1 Projeção e escala
- Equirretangular local centrada em (-30,4; -53,2), com longitude corrigida por `cos(lat0)`. 1 unidade de cena = 10 km (o estado fica com ~75 unidades de largura).
- Alturas exageradas de propósito: nuvens baixas em ~4, médias em ~7, altas em ~10 unidades.

### 7.2 Mapa base
- Estado extrudado como uma peça só (espessura ~1 unidade), com bisel leve. Bordas municipais como **uma única** geometria de linhas sobre o topo, discretas. Não extrudar município por município.
- Plano de fundo escuro com leve gradiente; sem tiles, sem relevo.

### 7.3 Nuvens
- **Slots fixos:** na carga, gerar posições com jitter (amostragem tipo blue-noise) sobre o estado mais a borda, para cada uma das três camadas. Cada slot tem posição, tamanho, semente e um limiar `u` aleatório em [0, 1].
- **Visibilidade por limiar:** a cada atualização, `c = sample(pos, t)` da camada, remapeado de [15 %, 100 %] para [0, 1]. O puff aparece quando `c > u`, com escala e opacidade subindo suavemente numa faixa de 0,1 em torno do limiar. Resultado: densidade proporcional à cobertura, nada abaixo de 15 %, sem estalo de aparecer/sumir e sem grade.
- **Render:** um `InstancedMesh` de billboards com textura radial suave e sombreamento falso (topo claro, base escura). Alpha pré-multiplicado, `depthWrite` desligado, instâncias **ordenadas de trás para frente** e reordenadas só quando a câmera gira mais que ~5° ou anda mais que ~2 unidades.
- Camadas com caráter: baixa = puffs gordos e opacos; média = mais achatados; alta = finos, esticados e bem translúcidos.
- **Escurecimento:** cor do puff vai de branco a cinza-chumbo conforme `rain()` **na posição atual do puff**. Como é avaliado onde o puff está, nuvem escura nunca é arrastada para cima de célula seca.
- **Chuva sem céu limpo:** onde `rain() > 0`, a cobertura visual da camada baixa é no mínimo 60 %, para não chover do nada.
- **Vento:** cada puff orbita/deriva em laço em torno do slot, na direção do vento local, com amplitude máxima de 0,35 célula e velocidade proporcional ao vento. Só efeito visual, sem advecção.
- Atualização dos atributos por instância a ~10 Hz, não a cada quadro; a animação fina roda no vertex shader.

### 7.4 Chuva
- Slots fixos de colunas de chuva, com jitter, cobrindo o estado. Coluna ativa só se `rain(pos, t) > 0` (herda a garantia A1). A coluna não se desloca com o vento; só os traços se inclinam.
- Traços curtos instanciados, com a queda em laço calculada no vertex shader (posição = função do tempo e da semente; zero custo de CPU por gota).
- Três faixas visuais: fraca (0,1–2,5 mm/h), moderada (2,5–10), forte (> 10), variando quantidade de traços por coluna, comprimento e opacidade.

### 7.5 Raios
- Só em células com `storm()` verdadeiro. Intervalo aleatório por célula (3–9 s de tempo real, independente da velocidade da linha do tempo, e pausado junto com o play).
- Efeito: clarão rápido nos puffs da célula (duplo pulso de ~150 ms) mais um traço em zigue-zague da nuvem ao chão. Sem luz dinâmica real.

### 7.6 Luz e hora do dia
- A iluminação acompanha a hora da linha do tempo: dia claro, amanhecer e entardecer quentes, noite azul-escura com nuvens ainda legíveis. Posição do sol por fórmula simples de hora local; não precisa ser astronomicamente correta.

### 7.7 Orçamento de desempenho
- Tetos no nível alto: 6.000 puffs visíveis, 15.000 traços de chuva, 12 draw calls, pixel ratio limitado a 1,5.
- **Qualidade adaptativa:** três níveis (alto, médio, baixo). Se o tempo médio de quadro passar de 20 ms por 2 s, desce um nível (menos slots, pixel ratio menor, puffs maiores para compensar). Sobe de volta só após 10 s abaixo de 12 ms. O gargalo esperado é overdraw, não contagem de instâncias: preferir menos puffs maiores a muitos pequenos.
- Com a aba oculta, o laço de render para.

## 8. Interface

- **Câmera:** orbital com amortecimento. Limites: alvo preso ao retângulo do estado, zoom entre "estado inteiro" e "uma região", inclinação entre ~15° e ~80°. Abertura com um voo curto até a vista padrão (3/4, olhando do sudeste).
- **Linha do tempo** (rodapé): trilho com marcas de dia, marcador "agora" fixo, scrub por arrasto, play/pause, velocidades 0,5×/1×/4× (1× = 1 h de previsão por segundo), rótulo "sex 14/11, 15:00". Faixa fina sobre o trilho indicando as horas com chuva em algum ponto do estado. Botão 72 h / 7 dias. Teclado: espaço = play/pause, setas = ±1 h, Home = agora.
- **Tooltip:** raycast no plano do mapa → lon/lat → célula. Mostra município de centroide mais próximo, nuvem por camada (%), mm/h, vento, condição em texto. Hover no desktop, toque no celular.
- **Legenda** discreta (nuvem, chuva fraca/moderada/forte, trovoada) e selo "dados de HH:MM · Open-Meteo" (ou o aviso de demo/desatualizado).
- Textos em português. Horários sempre em `America/Sao_Paulo` via `Intl`, a partir dos timestamps unix.
- Funciona em tela de celular (layout do rodapé empilha), sem ser a prioridade.

## 9. Ordem de construção e portões

Cada etapa termina com commit. O portão é verificado pela própria IA; passou, segue.

1. **Esqueleto e geometria.** Estrutura de pastas, Three.js vendorizado, `build-geo`, mapa extrudado com câmera.
   Portão: screenshot mostra o RS reconhecível com bordas municipais; `assets/rs.json` ≤ 350 KB.
2. **Spike de render com campo sintético.** Nuvens, chuva, raios e luz, tudo em `?demo=1`. É a etapa que decide o projeto; gastar o tempo aqui.
   Portão: screenshots de 4 ângulos e 3 horários sem grade visível nem artefato de ordenação; tetos da seção 7.7 respeitados no painel de debug.
3. **WeatherField e testes.** Módulo puro mais a suíte da seção 6. O render passa a consumir só essa interface.
   Portão: testes verdes, incluindo a propriedade A1.
4. **Dados reais.** Fetch em lotes, normalização, IndexedDB, fallbacks, modos `fixture` e `demo`.
   Portão: com `?fixture=1&debug=1`, screenshot de cima em 5 horários: toda coluna de chuva cai sobre ponto de grade azul ou amarelo, nenhuma sobre cinza.
5. **Interface.** Linha do tempo, tooltip, legenda, teclado, avisos.
   Portão: roteiro Playwright que dá play, faz scrub, troca velocidade, abre tooltip, sem erro no console.
6. **Acabamento.** Qualidade adaptativa, voo de abertura, responsivo, README (como rodar, decisões tomadas, o que ficou sem verificação).
   Portão: carga com cache até o primeiro quadro útil em menos de 3 s; nenhuma requisição externa além da API do tempo.

## 10. Regras para quem constrói

- Não perguntar e não esperar. Bloqueio de rede já tem saída definida (seções 3 e 5.4).
- Não fingir verificação: fps medido em Chromium headless não vale como prova de desempenho real, e a API ao vivo não foi testada daqui. O README lista exatamente o que só o usuário consegue confirmar no navegador dele: (a) resposta real do Open-Meteo e `forecast_hours`, (b) fps no notebook, (c) consumo de cota.
- Não publicar nada (GitHub, Pages, Artifact) sem pedido explícito. Entrega é a pasta local funcionando.
- Sem bibliotecas além do Three.js em tempo de execução.
- Estética é livre dentro do que está fixado aqui: paleta, formato exato dos puffs e animações finas ficam a critério de quem constrói, e a régua é "parece uma maquete de telejornal caprichada".
