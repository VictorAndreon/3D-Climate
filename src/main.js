import * as THREE from 'three';
import { createScene } from './render/scene.js';
import { createMap } from './render/map.js';
import { createReliefMap } from './render/relief-map.js';
import { loadRelief } from './data/relief.js';
import { createClouds } from './render/clouds.js';
import { createSolidClouds } from './render/clouds-solid.js';
import { createVolumeClouds } from './render/clouds-volume.js';
import { createRain, MAX_PER_COLUMN } from './render/rain.js';
import { createLightning } from './render/lightning.js';
import { skyState, applySky, localHour } from './render/light.js';
import { makeSlots } from './render/slots.js';
import { makeGrid } from './data/grid.js';
import { createWeatherField } from './data/weather-field.js';
import { syntheticSeries } from './data/synthetic.js';
import { createDebug, createGridDots } from './ui/debug.js';
import { createQuality, LEVELS } from './render/quality.js';
import { createClock } from './ui/clock.js';
import { createTimeline } from './ui/timeline.js';
import { createTooltip } from './ui/tooltip.js';
import { createLegend } from './ui/legend.js';
import { createCityLift } from './render/city-lift.js';
import { createCityPanel } from './ui/city-panel.js';
import { createCitySelect } from './ui/city-select.js';
import { loadWeather, shouldReload } from './data/source.js';
import { fetchForecast } from './data/fetch.js';
import { loadCache, saveCache } from './data/cache.js';
import { normalizeResponse, buildSeries } from './data/normalize.js';
import { toScene, toLonLat, CELL_X, CELL_Z } from './geo/projection.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
// tetos do nível alto: 6.000 puffs; 1.350 colunas x 10 traços + 1.350 respingos = 14.850 instâncias de chuva
const SLOT_COUNTS = { clouds: [2600, 2000, 1400], solid: [1150, 800], rain: 1350 };
const NUVENS = params.get('nuvens');
const SOLID = NUVENS !== 'sprite';                      // padrão: nuvens sólidas 3D; ?nuvens=sprite volta ao antigo
const VOLUME = NUVENS === 'volume';                     // protótipo: nuvens volumétricas (raymarching)
const RELEVO = params.get('relevo') === '1';            // spike: mapa com relevo; &exagero=N muda o exagero vertical (padrão 12)

function sceneBounds(grid) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let p = 0; p < grid.nP; p++) {
    const s = toScene(grid.lons[p], grid.lats[p]);
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
  }
  return { minX: minX - CELL_X, maxX: maxX + CELL_X, minZ: minZ - CELL_Z, maxZ: maxZ + CELL_Z };
}

/** Junta nuvens sólidas (baixa, média) e sprites (alta) numa interface só. */
function combineClouds(solid, high) {
  const both = [solid, high];
  solid.setCirrus?.(high.mesh);
  return {
    objects: [solid.shadow, solid.mesh, high.shadow, high.mesh],
    update: (f, t, now) => both.forEach((c) => c.update(f, t, now)),
    frame: (now, cam) => both.forEach((c) => c.frame(now, cam)),
    setFlashes: (l) => both.forEach((c) => c.setFlashes(l)),
    setSky: (s) => both.forEach((c) => c.setSky(s)),
    setQuality: (q) => both.forEach((c) => c.setQuality(q)),
    visibleCount: () => solid.visibleCount() + high.visibleCount(),
  };
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
  const canvas = document.getElementById('scene');
  let view;
  try { view = createView(canvas); } catch { fatal(NO_WEBGL); return; }
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); view.stop(); fatal(NO_WEBGL); });
  await run(geo, grid, view);
}

function createView(canvas) {
  const look = params.get('look')?.split(',').map(Number);
  return createScene(canvas, { cam: params.get('cam') ?? 'se', dist: Number(params.get('dist') ?? 0), polar: Number(params.get('polar') ?? 0), look: look ? toScene(look[0], look[1]) : null });
}

async function run(geo, grid, view) {
  let map;
  if (RELEVO) {
    try { map = createReliefMap(geo, await loadRelief('./assets/relief.bin.gz'), { exag: Number(params.get('exagero')) || 12 }); }
    catch (e) { console.warn('relevo indisponível, seguindo com o mapa plano', e); }
  }
  map ??= createMap(geo);
  view.scene.add(map);
  const lights = { hemi: new THREE.HemisphereLight(), sun: new THREE.DirectionalLight(), tmp: new THREE.Color() };
  view.scene.add(lights.hemi, lights.sun);

  const mode = params.get('demo') === '1' ? 'demo' : params.get('fixture') === '1' ? 'fixture' : 'live';
  const data = await loadWeather({
    mode, grid, gridVersion: geo.gridVersion, nowUnix: Math.floor(Date.now() / 1000),
    deps: {
      fetchForecast, loadCache, saveCache, syntheticSeries,
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
  const lift = createCityLift({ reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, groundLL: map.userData.heightLL });
  view.scene.add(lift.group);
  const { inside } = map.userData;                         // relevo: a malha cobre o retângulo, a máscara diz o que é estado
  const pickLand = (x, y) => {
    const hit = view.pick(lift.mesh ? [lift.mesh, map.userData.land] : map.userData.land, x, y);
    return hit && (!inside || inside(hit.x, hit.z)) ? hit : null;
  };
  // no toque quem abre é o painel do município (tem tudo que o tooltip mostraria)
  const tooltip = createTooltip(document.getElementById('tooltip'), {
    canvas: view.renderer.domElement, pick: pickLand, field, clock, municipios: geo.municipios, tapToShow: false,
  });
  let citySelect = null;
  const panel = createCityPanel(document.getElementById('city'), { clock, field, onClose: () => citySelect.close() });
  citySelect = createCitySelect({
    canvas: view.renderer.domElement, pick: pickLand, lift, panel, municipios: geo.municipios,
    onSelect: (m) => { document.body.classList.toggle('city-open', !!m); if (m) tooltip.hide(); },
  });

  // slots só onde há dado: dentro da célula de algum nó da grade
  const bounds = sceneBounds(grid);
  const accept = (x, z) => { const ll = toLonLat(x, z); return grid.distCells(ll.lon, ll.lat) <= 0.72; };
  const slotsFor = (counts) => counts.map((count, i) => makeSlots({ ...bounds, count, seed: 101 + i, accept }));
  const lowMid = VOLUME ? createVolumeClouds({ renderer: view.renderer, grid, bounds }) : SOLID ? createSolidClouds({ slotsByLayer: slotsFor(SLOT_COUNTS.solid) }) : null;
  const clouds = lowMid ? combineClouds(
    lowMid,
    // cirros continuam finos e translúcidos (sprite), só na camada alta
    createClouds({ slotsByLayer: [new Float32Array(0), new Float32Array(0), makeSlots({ ...bounds, count: SLOT_COUNTS.clouds[2], seed: 103, accept })] }),
  ) : createClouds({ slotsByLayer: slotsFor(SLOT_COUNTS.clouds) });
  const rain = createRain({ slots: makeSlots({ ...bounds, count: SLOT_COUNTS.rain, seed: 201, accept }) });
  const lightning = createLightning({ grid });
  view.scene.add(...clouds.objects ?? [clouds.shadow, clouds.mesh], rain.mesh, lightning.object3d);

  // qualidade adaptativa: desce com quadro lento, sobe só depois de 10 s folgados
  const quality = createQuality({});
  function applyQuality(level) { const q = LEVELS[level]; clouds.setQuality(q); rain.setQuality(q); view.setPixelRatio(q.pixelRatio); }
  applyQuality(quality.level);

  const perf = { fps: 60, frameMs: 16.7 };
  const stats = () => ({ fps: perf.fps, frameMs: perf.frameMs, puffs: clouds.visibleCount(), drops: rain.dropCount(), drawCalls: view.drawCalls(), quality: LEVELS[quality.level].name });
  const debug = DEBUG ? createDebug(document.getElementById('debug'), { stats }) : null;
  const dots = DEBUG ? createGridDots(grid) : null;
  if (dots) view.scene.add(dots.points);

  function refresh(now) {
    const sky = skyState(localHour(field.times[0] + clock.t * 3600));
    applySky(sky, { renderer: view.renderer, lights, ground: map.userData.ground, clouds, rain });
    clouds.update(field, clock.t, now);
    rain.update(field, clock.t);
    lightning.update(field, clock.t);
    dots?.update(field, clock.t);
  }

  let acc = 1, first = true;
  view.onFrame((now, dt) => {
    if (dt > 0) {
      perf.frameMs += (dt * 1000 - perf.frameMs) * 0.1; perf.fps = 1000 / perf.frameMs;
      const lvl = quality.push(dt * 1000, now * 1000);
      if (lvl != null) { applyQuality(lvl); acc = 1; }
    }
    clock.tick(dt);
    acc += dt;
    if (acc >= 0.1) { acc = 0; refresh(now); }
    clouds.setFlashes(lightning.frame(now, dt, clock.playing));
    lift.frame(dt);
    clouds.frame(now, view.camera);
    rain.frame(now);
    debug?.tick(dt);
    if (first) {                                             // primeiro quadro útil: mapa + nuvens já desenhados
      first = false;
      performance.mark('first-frame');
      const ms = performance.now();
      if (window.__rs) window.__rs.firstFrameMs = ms;
      document.getElementById('loading').hidden = true;
      requestAnimationFrame(() => { document.documentElement.dataset.ready = '1'; });
    }
  });
  if (DEBUG) window.__rs = { citySelect, field, grid, stats, clock, status: data.status, tNow, rainColumns: () => rain.activeColumns(), rainStrokes: () => rain.activeStrokes(field, clock.t), stormCount: () => lightning.stormCount(), boltVisible: () => lightning.object3d.visible };
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
