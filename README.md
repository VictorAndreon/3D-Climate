# RS Tempo 3D

Maquete 3D do Rio Grande do Sul que mostra a previsão do tempo do Open-Meteo como nuvens, chuva e raios
estilizados, com linha do tempo. Projeto lúdico, de uso pessoal. Não é ferramenta meteorológica.

O design está em [`DESIGN.md`](DESIGN.md) e o plano de implementação em
[`docs/superpowers/plans/2026-11-13-rs-tempo-3d.md`](docs/superpowers/plans/2026-11-13-rs-tempo-3d.md).

## Como rodar

Não tem build. Qualquer servidor estático na raiz serve:

```bash
npm run serve
```

Depois abra `http://localhost:8080/`. Só caminhos relativos, então funciona igual no GitHub Pages.

| URL | O que faz |
|---|---|
| `/` | previsão real (Open-Meteo), com cache de 1 h no navegador |
| `/?demo=1` | campo sintético determinístico, sem rede |
| `/?fixture=1` | carrega `assets/fixture.json` pelo mesmo parsing da API |
| `/?debug=1` | painel (fps, tempo de quadro, puffs, gotas, draw calls, qualidade) e pontos da grade coloridos pelo dado bruto: cinza = seco, azul = chuva, amarelo = trovoada |

Teclado: espaço = play/pause, ← → = ±1 h, Home = agora, Esc = fecha o município.

Clique (ou toque) num município: ele sobe do mapa com contorno dourado e abre um painel com área, código IBGE, o tempo no instante da linha do tempo e um meteograma da faixa visível (nuvem pendurada no topo, chuva caindo dela, trovoada em amarelo). Clicar no meteograma move a linha do tempo. Clique fora do estado ou Esc fecha.

As nuvens baixas e médias são cachos 3D (maquete), com torre e bigorna onde há trovoada; os cirros são sprites translúcidos. `?nuvens=sprite` volta ao visual antigo, todo em sprite.

Dá pra descer a câmera até quase rente ao chão e chegar bem perto: de lado se vê nuvem em cima, chuva no meio e solo embaixo; perto da câmera a nuvem vira neblina, então dá pra atravessá-la.

Parâmetros só para os roteiros de verificação: `t=<horas após agora>`, `cam=top|se|sw|ne|nw`, `dist=`, `look=lon,lat`.

## Testes e portões

```bash
npm test
```

```bash
node tools/gate-rain.cjs
```

```bash
node tools/gate-ui.cjs
```

```bash
node tools/gate-final.cjs
```

- `npm test`: 163 testes dos módulos puros (`node --test`), incluindo a propriedade A1 com 20.000 amostras.
- `gate-rain`: visto de cima, em 5 horários, a base e o topo de todo traço de chuva desenhado ficam em célula cujo dado bruto é molhado.
- `gate-ui`: play, scrub, velocidade, teclado, tooltip, selo, celular.
- `gate-final`: caminho ao vivo + cache com a API interceptada (11 requisições na primeira carga, zero na segunda, primeiro quadro, fallbacks, nenhum host externo além da API).

Os roteiros usam o Chromium/Playwright já instalados no ambiente e rodam sem rede.

## Regenerar os dados

```bash
npm install
```

```bash
npm run vendor
```

```bash
npm run geo
```

```bash
npm run fixture
```

`vendor` copia o Three.js do `node_modules` para `vendor/three/`. `geo` baixa a malha municipal e gera
`assets/rs.json` e `assets/municipios.json`. `fixture` grava uma resposta real da API em `assets/fixture.json` (ou a sintética, se a API falhar).

## O que só você confirma no seu navegador

Nada disto foi provado daqui, e os números de fps em Chromium headless **não** foram usados como prova de desempenho.

1. **Resposta real do Open-Meteo dentro do navegador.** Daqui a API foi testada só via `curl`, com 1 e 2 pontos
   (as respostas estão em `test/data/`). `forecast_hours=168` devolveu 168 valores começando na hora corrente.
   A carga completa (11 lotes de até 50 pontos, a partir do browser, com CORS) nunca rodou contra a API de verdade.
   Abra `/` e confira se o selo mostra `dados de HH:MM · Open-Meteo`. Se aparecer `DEMO — dados sintéticos`, a busca falhou.
2. **fps no notebook com GPU integrada.** Abra `/?debug=1`, dê play e gire a câmera. A qualidade adaptativa desce de
   nível sozinha se o quadro passar de 20 ms; o painel mostra o nível.
3. **Consumo de cota.** Uma carga pede 546 pontos em 11 requisições. Os limites que o design cita (600/min, 5 mil/h,
   10 mil/dia) vieram de memória e não foram conferidos. Ao gravar a fixture, a API respondeu uma vez
   `Daily API request limit exceeded` para este container (IP de saída compartilhado) e aceitou a carga inteira
   uma hora depois; não dá para saber daqui quanta folga o seu IP terá.
4. **Aparência no dia a dia.** A verificação visual foi feita com o campo sintético e com uma única gravação real
   (`/?fixture=1`). Frente fria real vira um cobertor sobre o estado, como o design avisa.

## Decisões

Desvios e escolhas feitas onde o design deixava margem.

**Ambiente (medido em 13/11/2026)**
- Three.js fixado em 0.187.0 (última no npm), vendorizado: `three.module.js`, `three.core.js` e `OrbitControls.js`.
- A malha tem 496 municípios (o design dizia 497) e a grade tem 546 pontos: 401 dentro do estado + borda de 1 célula (o design esperava 300–400).
- `assets/rs.json` com simplificação de 40% no mapshaper: 229 KB.
- `assets/fixture.json` é uma **resposta real** do Open-Meteo gravada em 13/11/2026 às 12:00 (546 pontos × 168 h, 2,9 MB; tem chuva nas 168 h e trovoada em 118). A primeira tentativa de gravar falhou com `Daily API request limit exceeded`; a segunda, uma hora depois, passou.
- A API devolve a coordenada ajustada à grade do modelo; os locais são mapeados para os pontos **pela ordem do pedido**.
- Erro da API (HTTP 400/429 ou `{"error":true}`), lote incompleto e série torta contam como falha de rede.

**Dados**
- Hora ativa de chuva e trovoada: `h = ceil(t)`; `precipitation[h]` vale para o intervalo `(h-1, h]`, em degrau.
- Entre duas horas molhadas a intensidade faz crossfade nos 10 primeiros minutos. Se a hora seguinte é seca, nos 10 últimos ela cai para 30%, nunca para zero: na hora cheia (onde as setas param) a célula molhada ainda chove.
- Vento interpolado em componentes u/v, nunca em ângulo.
- Canto ausente na bilinear: pesos renormalizados; nenhum canto: nó mais próximo.
- Cache de outra grade ou cuja série já terminou é descartado antes do teste de validade de 1 h.
- No modo fixture o "agora" da cena é o início da gravação, e o selo diz `FIXTURE — gravado em DD/MM HH:MM`.
- A busca desiste de um lote em 10 s e aborta os demais; o IndexedDB desiste em 1,5 s. Rede pendurada cai no cache vencido ou no demo, não em "carregando" eterno.
- Com dado ao vivo de mais de 1 h a página recarrega, ao voltar para a aba e também a cada 5 min com a aba visível. Com dado desatualizado, tenta de novo no máximo a cada 15 min.

**Render**
- Um único desenho instanciado (`InstancedBufferGeometry` + shader próprio) para as três camadas de nuvem, ordenado de trás para frente; reordena quando a câmera gira mais de 5° ou anda mais de 2 unidades.
- Presença do puff: `smoothstep(u, u + 0,1, c')`, com a faixa **acima** do limiar (centrada nele, apareceria puff abaixo de 15% de cobertura).
- Puffs ~25% maiores que o plano e sombra das nuvens sobre o mapa (um draw call a mais, desligada no nível baixo).
- A1 é checado por **traço**, não só por coluna: cada traço só é desenhado se `rain() > 0` na base e no topo dele. A inclinação pelo vento é limitada a 1/4 de célula.
- 1.350 colunas de chuva com até 10 traços + 1 respingo no chão por coluna ativa = 14.850 instâncias (teto de 15.000). O respingo é o que deixa a chuva visível de cima.
- Raios: agenda por nó de grade com trovoada, 3–9 s de tempo real, só anda com o play. Como a página abre pausada, raio só aparece depois do play.
- Luz: sol por senoide da hora local (UTC-3 fixo); de noite a "lua" espelha o sol para a cena não ficar chapada.
- Qualidade: alto / médio (65% dos slots, puff 1,25×, pixel ratio 1,25) / baixo (40%, 1,6×, 1,0, sem sombra).
- Os limiares de qualidade do design (20 ms / 12 ms) são lidos em relação à taxa da tela: a 60 Hz o intervalo entre quadros nunca fica abaixo de 16,7 ms, então "sobe" quer dizer 10 s rodando na taxa da tela. Com o navegador limitado a 30 Hz, só desce se perder quadros. Depois de cair de um nível, voltar a ele fica bloqueado por 60 s (mais a cada nova queda), para não oscilar.
- Draw calls medidos: 7 (8 com os pontos de debug), teto de 12.

**Interface**
- Abre pausado em "agora", com voo de câmera de 1,8 s (qualquer interação cancela).
- A faixa de chuva sobre o trilho tem opacidade proporcional à fração da grade molhada (com dado real, quase toda hora tem chuva em algum ponto e a faixa ficaria inteira azul).
- **Mudança pedida por você no §8:** 1× = 1 h de previsão a cada 3 s (o design dizia 1 h/s); 0,5× e 4× mantêm a proporção (6 s e 0,75 s por hora). Ajuste em `HOURS_PER_SEC` no `clock.js`.
- Rótulo da linha do tempo em passos de 10 minutos. Play no fim da faixa recomeça de "agora".
- Zoom-out máximo de 135 unidades (o plano dizia 110, mas o estado não cabia visto de cima).
- **Mudança pedida por você no §8:** a câmera desce até 2° do horizonte (o design dizia ~15°) e chega a 3 unidades (30 km) do alvo, com zoom em direção ao cursor. Assim dá pra ver as camadas de lado e entrar embaixo das nuvens.
- Nuvens sólidas: chuva sempre cinza (a partir de 45% de escurecimento, mais escura com a intensidade), trovoada em chumbo com o topo da bigorna claro; borda das bolhas e nuvem a menos de ~12–55 km da câmera se desfazem por alpha to coverage (MSAA), sem sair do passe opaco.
- Tooltip faz raycast na peça do estado, não no plano: fora do RS ele some, mesmo havendo dado na borda da grade.
- No celular a legenda vira uma fileira de ícones acima do rodapé.
- Município selecionado: polígonos por município em `assets/municipios.json` (373 KB, mesma simplificação das bordas), fora do `rs.json` para não pesar no primeiro quadro; é baixado com o navegador ocioso ou no primeiro clique. Área calculada da malha original (aprox., ±1% do IBGE).
- O painel mostra a previsão do nó da grade mais próximo do centroide; município grande (Alegrete) cobre várias células e o tooltip em outra ponta pode discordar.
- No toque o painel do município substitui o tooltip (tem os mesmos dados); no desktop o hover continua abrindo o tooltip. O contorno dourado tem uma cópia sem teste de profundidade para aparecer através das nuvens.
