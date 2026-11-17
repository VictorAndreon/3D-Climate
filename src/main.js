import * as THREE from 'three';
import { createScene } from './render/scene.js';
import { loadRelief } from './data/relief.js';
import { startCloudNoise } from './render/clouds-volume.js';
import { createStage } from './render/stage.js';
import { createRain } from './render/rain.js';
import { createLightning } from './render/lightning.js';
import { skyState, applySky, localHour } from './render/light.js';
import { makeSlots } from './render/slots.js';
import { makeGrid } from './data/grid.js';
import { createWeatherField } from './data/weather-field.js';
import { syntheticSeries } from './data/synthetic.js';
import { createDebugMenu } from './ui/debug-menu.js';
import { parseConfig } from './ui/config.js';
import { createQuality, LEVELS } from './render/quality.js';
import { createClock } from './ui/clock.js';
import { createTimeline } from './ui/timeline.js';
import { createTooltip } from './ui/tooltip.js';
import { createLegend } from './ui/legend.js';
import { createCityLift } from './render/city-lift.js';
import { createCityPanel } from './ui/city-panel.js';
import { createCitySelect } from './ui/city-select.js';
import { createCitySearch } from './ui/city-search.js';
import { loadWeather, shouldReload } from './data/source.js';
import { fetchForecast } from './data/fetch.js';
import { loadCache, saveCache } from './data/cache.js';
import { normalizeResponse, buildSeries } from './data/normalize.js';
import { makeProjection, RS_PROJECTION } from './geo/projection.js';

const params = new URLSearchParams(location.search);
const cfg = parseConfig(location.search);                // estado inicial do menu de debug: nuvens, relevo, grade, qualidade, dados
const SLOT_RAIN = 1350;                                   // 1.350 colunas x 10 traços + 1.350 respingos = 14.850 instâncias de chuva
let noiseP = null;                                        // o ruído 3D do volume é gerado num worker, uma vez só
const loadNoise = () => (noiseP ??= startCloudNoise());
if (cfg.nuvens === 'volume') loadNoise();                 // já vai gerando enquanto o resto carrega
const QUALITY_LEVEL = { alto: 0, medio: 1, baixo: 2 };

function sceneBounds(grid, proj) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let p = 0; p < grid.nP; p++) {
    const s = proj.toScene(grid.lons[p], grid.lats[p]);
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
  }
  const cell = proj.cell(grid.step);
  return { minX: minX - cell.x, maxX: maxX + cell.x, minZ: minZ - cell.z, maxZ: maxZ + cell.z };
}

function fatal(msg) {
  document.getElementById('scene').hidden = true;
  for (const id of ['timeline', 'legend', 'tooltip', 'loading']) document.getElementById(id).hidden = true;
  const el = document.getElementById('fatal'); el.textContent = msg; el.hidden = false;
}
const NO_WEBGL = 'Seu navegador não conseguiu iniciar o WebGL. Recarregue a página.';

async function boot() {
  const geo = await (await fetch('./assets/rs.json')).json();
  const grid = makeGrid(geo.grid);
  const proj = makeProjection(RS_PROJECTION);
  const canvas = document.getElementById('scene');
  let view;
  try { view = createView(canvas, proj); } catch { fatal(NO_WEBGL); return; }
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); view.stop(); fatal(NO_WEBGL); });
  await run(geo, grid, view, proj);
}

function createView(canvas, proj) {
  const look = params.get('look')?.split(',').map(Number);
  return createScene(canvas, { cam: params.get('cam') ?? 'se', dist: Number(params.get('dist') ?? 0), polar: Number(params.get('polar') ?? 0), look: look ? proj.toScene(look[0], look[1]) : null });
}

async function run(geo, grid, view, proj) {
  // slots só onde há dado: dentro da célula de algum nó da grade
  const bounds = sceneBounds(grid, proj);
  const accept = (x, z) => { const ll = proj.toLonLat(x, z); return grid.distCells(ll.lon, ll.lat) <= 0.72; };
  const slots = (count, seed) => makeSlots({ ...bounds, count, seed, accept });
  let onSwap = () => {};                                     // preenchido quando céu, relógio e seleção existirem
  const stage = createStage({
    view, geo, grid, bounds, proj, slots, loadNoise, loadRelief: () => loadRelief('./assets/relief.bin.gz'),
    onSwap: (what) => onSwap(what),
  });
  await stage.setRelief(cfg.relevo, cfg.exagero).catch((e) => console.warn('relevo indisponível, seguindo com o mapa plano', e));
  const lights = { hemi: new THREE.HemisphereLight(), sun: new THREE.DirectionalLight(), tmp: new THREE.Color() };
  view.scene.add(lights.hemi, lights.sun);

  const data = await loadWeather({
    mode: cfg.dados, grid, gridVersion: geo.gridVersion, nowUnix: Math.floor(Date.now() / 1000),
    deps: {
      fetchForecast, loadCache, saveCache, syntheticSeries: (g, start) => syntheticSeries(g, start, proj),
      loadFixture: async () => buildSeries(grid, normalizeResponse(await (await fetch('./assets/fixture.json')).json())),
    },
  });
  const field = createWeatherField(grid, data.series);
  // "agora" achado pelo timestamp, nunca assumido como índice 0
  const tNow = Math.min(Math.max((data.nowUnix - field.times[0]) / 3600, 0), field.nT - 1);
  const clock = createClock({ tNow, tEnd72: Math.min(tNow + 72, field.nT - 1), tEndAll: field.nT - 1 });
  if (params.has('t')) { const off = Number(params.get('t')); if (off > 72) clock.setRange('7d'); clock.seek(tNow + off); }   // só roteiros: abre pausado nesse instante
  createTimeline(document.getElementById('timeline'), { clock, times: field.times, rainByHour: field.rainShareByHour() });
  // no celular o painel do município fica logo acima do rodapé, que muda de altura ao empilhar
  new ResizeObserver(([e]) => document.documentElement.style.setProperty('--tl-h', `${Math.ceil(e.borderBoxSize?.[0]?.blockSize ?? e.target.offsetHeight)}px`)).observe(document.getElementById('timeline'));
  createLegend(document.getElementById('legend'), document.getElementById('badge'), data.status);
  const lift = createCityLift({ proj, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, groundLL: (lon, lat) => stage.map.userData.heightLL?.(lon, lat) ?? 0 });
  view.scene.add(lift.group);
  const pickLand = (x, y) => {
    const { land, inside } = stage.map.userData;             // relevo: a malha cobre o retângulo, a máscara diz o que é estado
    const hit = view.pick(lift.mesh ? [lift.mesh, land] : land, x, y);
    return hit && (!inside || inside(hit.x, hit.z)) ? hit : null;
  };
  // no toque quem abre é o painel do município (tem tudo que o tooltip mostraria)
  const tooltip = createTooltip(document.getElementById('tooltip'), {
    canvas: view.renderer.domElement, pick: pickLand, field, clock, municipios: geo.municipios, tapToShow: false, proj,
  });
  let citySelect = null;
  const panel = createCityPanel(document.getElementById('city'), { clock, field, onClose: () => citySelect.close() });
  citySelect = createCitySelect({
    canvas: view.renderer.domElement, pick: pickLand, lift, panel, municipios: geo.municipios, proj,
    onSelect: (m) => { document.body.classList.toggle('city-open', !!m); if (m) tooltip.hide(); search.setValue(m?.name ?? ''); },
  });
  // busca por nome: seleciona como um clique e leva a câmera até o município
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const search = createCitySearch(document.getElementById('search'), {
    names: geo.municipios.map(([name]) => name),
    onPick: async (name) => {
      const ll = await citySelect.selectByName(name).catch((err) => { console.warn('município indisponível', err); return null; });
      if (ll) { const s = proj.toScene(ll[0], ll[1]); view.focusOn(s.x, s.z, { seconds: reducedMotion ? 0 : 0.9 }); }
    },
  });

  await stage.setClouds(cfg.nuvens);
  const rain = createRain({ slots: slots(SLOT_RAIN, 201), proj, step: grid.step });
  const lightning = createLightning({ grid, proj });
  view.scene.add(rain.mesh, lightning.object3d);

  // qualidade adaptativa: desce com quadro lento, sobe só depois de 10 s folgados
  const quality = createQuality({});
  if (cfg.qualidade !== 'auto') quality.lock(QUALITY_LEVEL[cfg.qualidade]);
  function applyQuality(level) { const q = LEVELS[level]; stage.clouds.setQuality(q); rain.setQuality(q); view.setPixelRatio(q.pixelRatio); }
  applyQuality(quality.level);

  const perf = { fps: 60, frameMs: 16.7 };
  const stats = () => ({ fps: perf.fps, frameMs: perf.frameMs, puffs: stage.clouds.visibleCount(), cloudInfo: stage.clouds.info?.() ?? null, drops: rain.dropCount(), drawCalls: view.drawCalls(), quality: LEVELS[quality.level].name });
  const menu = createDebugMenu(document.getElementById('debug'), { button: document.getElementById('debug-toggle'), config: cfg, stage, quality, applyQuality, stats });
  stage.setDots(cfg.grade);

  function refresh(now) {
    const sky = skyState(localHour(field.times[0] + clock.t * 3600));
    applySky(sky, { renderer: view.renderer, lights, ground: stage.map.userData.ground, clouds: stage.clouds, rain });
    stage.clouds.update(field, clock.t, now);
    rain.update(field, clock.t);
    lightning.update(field, clock.t);
    stage.dots?.update(field, clock.t);
  }
  // troca no lugar (menu de debug): o que entrou recebe céu, qualidade e dado antes do próximo quadro
  let lastNow = 0;
  onSwap = (what) => {
    if (what === 'clouds') applyQuality(quality.level);
    if (what === 'map') citySelect.relift();
    refresh(lastNow);
  };

  let acc = 1, first = true;
  view.onFrame((now, dt) => {
    lastNow = now;
    if (dt > 0) {
      perf.frameMs += (dt * 1000 - perf.frameMs) * 0.1; perf.fps = 1000 / perf.frameMs;
      const lvl = quality.push(dt * 1000, now * 1000);
      if (lvl != null) { applyQuality(lvl); acc = 1; }
    }
    clock.tick(dt);
    acc += dt;
    if (acc >= 0.1) { acc = 0; refresh(now); }
    stage.clouds.setFlashes(lightning.frame(now, dt, clock.playing));
    lift.frame(dt);
    stage.clouds.frame(now, view.camera);
    rain.frame(now);
    menu.tick(dt);
    if (first) {                                             // primeiro quadro útil: mapa + nuvens já desenhados
      first = false;
      performance.mark('first-frame');
      const ms = performance.now();
      if (window.__rs) window.__rs.firstFrameMs = ms;
      document.getElementById('loading').hidden = true;
      requestAnimationFrame(() => { document.documentElement.dataset.ready = '1'; });
    }
  });
  if (cfg.debug) window.__rs = { stage, view, memory: () => ({ geometries: view.renderer.info.memory.geometries, textures: view.renderer.info.memory.textures }), citySelect, field, grid, stats, clock, status: data.status, tNow, rainColumns: () => rain.activeColumns(), rainStrokes: () => rain.activeStrokes(field, clock.t), stormCount: () => lightning.stormCount(), boltVisible: () => lightning.object3d.visible };
  // aba voltou e o dado ao vivo passou de 1 h: recarrega (o cache decide se busca de novo);
  // e também a cada 5 min com a aba visível (mapa aberto num segundo monitor não fica com dado velho e selo de atual)
  const loadedAt = Date.now() / 1000;
  const maybeReload = () => { if (!document.hidden && shouldReload(data.status, Date.now() / 1000, loadedAt)) location.reload(); };
  document.addEventListener('visibilitychange', maybeReload);
  setInterval(maybeReload, 5 * 60 * 1000);
  if (!params.has('cam')) view.flyIn('se');
  view.start();
}
boot().catch((e) => { console.error(e); fatal('Não foi possível carregar o mapa. Recarregue a página.'); });
