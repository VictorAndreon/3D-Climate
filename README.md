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

Teclado: espaço = play/pause, ← → = ±1 h, Home = agora.

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

- `npm test`: 150 testes dos módulos puros (`node --test`), incluindo a propriedade A1 com 20.000 amostras.
- `gate-rain`: visto de cima, em 5 horários, todo traço de chuva desenhado cai em célula cujo dado bruto é molhado.
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
`assets/rs.json`. `fixture` grava uma resposta real da API em `assets/fixture.json` (ou a sintética, se a API falhar).

## O que só você confirma no seu navegador

Nada disto foi provado daqui, e os números de fps em Chromium headless **não** foram usados como prova de desempenho.

1. **Resposta real do Open-Meteo dentro do navegador.** Daqui a API foi testada só via `curl`, com 1 e 2 pontos
   (as respostas estão em `test/data/`). `forecast_hours=168` devolveu 168 valores começando na hora corrente.
   A carga completa (11 lotes de até 50 pontos, a partir do browser, com CORS) nunca rodou contra a API de verdade.
   Abra `/` e confira se o selo mostra `dados de HH:MM · Open-Meteo`. Se aparecer `DEMO — dados sintéticos`, a busca falhou.
2. **fps no notebook com GPU integrada.** Abra `/?debug=1`, dê play e gire a câmera. A qualidade adaptativa desce de
   nível sozinha se o quadro passar de 20 ms; o painel mostra o nível.
3. **Consumo de cota.** Uma carga pede 546 pontos em 11 requisições. Os limites que o design cita (600/min, 5 mil/h,
   10 mil/dia) vieram de memória e não foram conferidos. Ao gravar a fixture, a API respondeu
   `Daily API request limit exceeded` para este container, cujo IP de saída é compartilhado; não dá para saber
   daqui se o seu IP terá folga.
4. **Aparência com dado real.** Toda a verificação visual foi feita com o campo sintético (faixa de chuva + núcleo
   de trovoada). Frente fria real vira um cobertor sobre o estado, como o design avisa.

## Decisões

Desvios e escolhas feitas onde o design deixava margem.

**Ambiente (medido em 13/11/2026)**
- Three.js fixado em 0.187.0 (última no npm), vendorizado: `three.module.js`, `three.core.js` e `OrbitControls.js`.
- A malha tem 496 municípios (o design dizia 497) e a grade tem 546 pontos: 401 dentro do estado + borda de 1 célula (o design esperava 300–400).
- `assets/rs.json` com simplificação de 40% no mapshaper: 229 KB.
- `assets/fixture.json` é **sintética** (2,9 MB): a API recusou por cota diária na hora de gravar. `npm run fixture` regrava a real.
- A API devolve a coordenada ajustada à grade do modelo; os locais são mapeados para os pontos **pela ordem do pedido**.
- Erro da API (HTTP 400/429 ou `{"error":true}`), lote incompleto e série torta contam como falha de rede.

**Dados**
- Hora ativa de chuva e trovoada: `h = ceil(t)`; `precipitation[h]` vale para o intervalo `(h-1, h]`, em degrau.
- Entre duas horas molhadas a intensidade faz crossfade nos 10 primeiros minutos; some nos 10 últimos se a hora seguinte é seca.
- Vento interpolado em componentes u/v, nunca em ângulo.
- Canto ausente na bilinear: pesos renormalizados; nenhum canto: nó mais próximo.
- Cache de outra grade ou cuja série já terminou é descartado antes do teste de validade de 1 h.
- No modo fixture o "agora" da cena é o início da gravação, e o selo diz `FIXTURE — gravado em DD/MM HH:MM`.
- Ao voltar para a aba com dado ao vivo de mais de 1 h, a página recarrega.

**Render**
- Um único desenho instanciado (`InstancedBufferGeometry` + shader próprio) para as três camadas de nuvem, ordenado de trás para frente; reordena quando a câmera gira mais de 5° ou anda mais de 2 unidades.
- Presença do puff: `smoothstep(u, u + 0,1, c')`, com a faixa **acima** do limiar (centrada nele, apareceria puff abaixo de 15% de cobertura).
- Puffs ~25% maiores que o plano e sombra das nuvens sobre o mapa (um draw call a mais, desligada no nível baixo).
- A1 é checado por **traço**, não só por coluna: cada traço só é desenhado se `rain() > 0` na posição dele.
- 1.350 colunas de chuva com até 10 traços + 1 respingo no chão por coluna ativa = 14.850 instâncias (teto de 15.000). O respingo é o que deixa a chuva visível de cima.
- Raios: agenda por nó de grade com trovoada, 3–9 s de tempo real, só anda com o play. Como a página abre pausada, raio só aparece depois do play.
- Luz: sol por senoide da hora local (UTC-3 fixo); de noite a "lua" espelha o sol para a cena não ficar chapada.
- Qualidade: alto / médio (65% dos slots, puff 1,25×, pixel ratio 1,25) / baixo (40%, 1,6×, 1,0, sem sombra).
- Draw calls medidos: 7 (8 com os pontos de debug), teto de 12.

**Interface**
- Abre pausado em "agora", com voo de câmera de 1,8 s (qualquer interação cancela).
- Rótulo da linha do tempo em passos de 10 minutos. Play no fim da faixa recomeça de "agora".
- Zoom-out máximo de 135 unidades (o plano dizia 110, mas o estado não cabia visto de cima).
- Tooltip faz raycast na peça do estado, não no plano: fora do RS ele some, mesmo havendo dado na borda da grade.
- No celular a legenda vira uma fileira de ícones acima do rodapé.
