import * as THREE from 'three';
import { createScene } from './render/scene.js';
import { loadRelief } from './data/relief.js';
import { startCloudNoise } from './render/clouds-volume.js';
import { createStage } from './render/stage.js';
import { syntheticSeries } from './data/synthetic.js';
import { createDebugMenu } from './ui/debug-menu.js';
import { parseConfig, DEFAULT_REGION } from './ui/config.js';
import { createQuality, LEVELS } from './render/quality.js';
import { loadWeather, shouldReload } from './data/source.js';
import { fetchForecast } from './data/fetch.js';
import { loadCache, saveCache } from './data/cache.js';
import { normalizeResponse, buildSeries } from './data/normalize.js';
import { loadIndex, loadRegion } from './data/region.js';
import { createNavigator } from './app/navigator.js';

const params = new URLSearchParams(location.search);
let noiseP = null;                                        // o ruído 3D do volume é gerado num worker, uma vez só
const loadNoise = () => (noiseP ??= startCloudNoise());
const QUALITY_LEVEL = { alto: 0, medio: 1, baixo: 2 };

function fatal(msg) {
  document.getElementById('scene').hidden = true;
  for (const id of ['timeline', 'legend', 'tooltip', 'loading']) document.getElementById(id).hidden = true;
  const el = document.getElementById('fatal'); el.textContent = msg; el.hidden = false;
}
const NO_WEBGL = 'Seu navegador não conseguiu iniciar o WebGL. Recarregue a página.';

async function boot() {
  const index = await loadIndex();
  const ufs = index.filter((r) => r.kind === 'uf').map((r) => r.id);
  const cfg = parseConfig(location.search, { ufs: [...ufs, DEFAULT_REGION], defaultUf: DEFAULT_REGION });   // estado inicial do menu de debug: nuvens, relevo, grade, qualidade, dados, uf, mun
  if (cfg.nuvens === 'volume') loadNoise();                 // já vai gerando enquanto o resto carrega
  const region = await loadRegion(index.find((r) => r.id === cfg.uf));
  if (!region.hasRelief) cfg.relevo = false;                // relevo só no RS: pedido na URL é ignorado, sem aviso
  const canvas = document.getElementById('scene');
  let view;
  try { view = createView(canvas, region); } catch { fatal(NO_WEBGL); return; }
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); view.stop(); fatal(NO_WEBGL); });
  await run(cfg, region, view, index);
}

function createView(canvas, { proj, bounds }) {
  const look = params.get('look')?.split(',').map(Number);
  return createScene(canvas, { bounds, cam: params.get('cam') ?? 'se', dist: Number(params.get('dist') ?? 0), polar: Number(params.get('polar') ?? 0), look: look ? proj.toScene(look[0], look[1]) : null });
}

async function run(cfg, region, view, index) {
  let nav = null, lastNow = 0, applyQuality = () => {};
  const stage = createStage({
    view, region, loadNoise, loadRelief: () => loadRelief('./assets/relief.bin.gz'),
    // troca no lugar (menu de debug): o que entrou recebe céu, qualidade e dado antes do próximo quadro.
    // A troca de região é refeita pelo navegador junto com a sessão nova (campo novo), não aqui.
    onSwap: (what) => {
      if (!nav?.current) return;                             // ainda montando: a primeira sessão aplica céu e qualidade
      if (what === 'clouds') applyQuality(quality.level);
      if (what === 'map') nav?.current?.citySelect?.relift();
      if (what === 'clouds' || what === 'map') nav?.current?.refresh(lastNow);
    },
  });
  await stage.setRelief(cfg.relevo, cfg.exagero).catch((e) => console.warn('relevo indisponível, seguindo com o mapa plano', e));
  const lights = { hemi: new THREE.HemisphereLight(), sun: new THREE.DirectionalLight(), tmp: new THREE.Color() };
  view.scene.add(lights.hemi, lights.sun);

  // dado da região: a mesma regra de sempre (ao vivo, cache, demo), com a grade e a versão dela; a fixture só existe do RS
  const loadData = (r, signal) => loadWeather({
    signal, mode: cfg.dados === 'fixture' && r.id !== 'RS' ? 'live' : cfg.dados, grid: r.grid, gridVersion: r.gridVersion, nowUnix: Math.floor(Date.now() / 1000),
    deps: {
      fetchForecast, loadCache, saveCache, syntheticSeries: (g, start) => syntheticSeries(g, start, r.proj),
      loadFixture: async () => buildSeries(r.grid, normalizeResponse(await (await fetch('./assets/fixture.json')).json())),
    },
  });
  const data = await loadData(region);
  // no celular o painel do município fica logo acima do rodapé, que muda de altura ao empilhar
  new ResizeObserver(([e]) => document.documentElement.style.setProperty('--tl-h', `${Math.ceil(e.borderBoxSize?.[0]?.blockSize ?? e.target.offsetHeight)}px`)).observe(document.getElementById('timeline'));

  await stage.setClouds(cfg.nuvens);

  // qualidade adaptativa: desce com quadro lento, sobe só depois de 10 s folgados
  const quality = createQuality({});
  if (cfg.qualidade !== 'auto') quality.lock(QUALITY_LEVEL[cfg.qualidade]);
  applyQuality = (level) => { const q = LEVELS[level]; stage.clouds.setQuality(q); stage.rain.setQuality(q); view.setPixelRatio(q.pixelRatio); };
  applyQuality(quality.level);

  const perf = { fps: 60, frameMs: 16.7 };
  const stats = () => ({ fps: perf.fps, frameMs: perf.frameMs, puffs: stage.clouds.visibleCount(), cloudInfo: stage.clouds.info?.() ?? null, drops: stage.rain.dropCount(), drawCalls: view.drawCalls(), quality: LEVELS[quality.level].name });
  const menu = createDebugMenu(document.getElementById('debug'), { button: document.getElementById('debug-toggle'), config: cfg, stage, quality, applyQuality, stats });
  stage.setDots(cfg.grade);

  nav = createNavigator({
    view, stage, index, cfg, loadData, sessionDeps: { lights },
    onSession: (s) => { menu.setRegion(s.region.id); applyQuality(quality.level); s.refresh(lastNow); },
  });
  await nav.start(region, data);
  const t = nav.current.tNow;
  if (params.has('t')) { const off = Number(params.get('t')); const clock = nav.current.clock; if (off > 72) clock.setRange('7d'); clock.seek(t + off); }   // só roteiros: abre pausado nesse instante

  let acc = 1, first = true;
  view.onFrame((now, dt) => {
    lastNow = now;
    const s = nav.current;
    if (dt > 0) {
      perf.frameMs += (dt * 1000 - perf.frameMs) * 0.1; perf.fps = 1000 / perf.frameMs;
      const lvl = quality.push(dt * 1000, now * 1000);
      if (lvl != null) { applyQuality(lvl); acc = 1; }
    }
    s.frame(dt);
    acc += dt;
    if (acc >= 0.1) { acc = 0; s.refresh(now); }
    stage.clouds.setFlashes(stage.lightning.frame(now, dt, s.clock.playing));
    stage.clouds.frame(now, view.camera);
    stage.rain.frame(now);
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
  // sempre reflete a sessão atual: os roteiros leem daqui depois de cada troca
  if (cfg.debug) window.__rs = {
    get region() { return nav.current.region; }, get field() { return nav.current.field; }, get grid() { return nav.current.region.grid; },
    get clock() { return nav.current.clock; }, get citySelect() { return nav.current.citySelect; }, get status() { return nav.current.status; }, get tNow() { return nav.current.tNow; },
    stage, view, nav, memory: () => ({ geometries: view.renderer.info.memory.geometries, textures: view.renderer.info.memory.textures }), stats,
    rainColumns: () => stage.rain.activeColumns(), rainStrokes: () => stage.rain.activeStrokes(nav.current.field, nav.current.clock.t), stormCount: () => stage.lightning.stormCount(), boltVisible: () => stage.lightning.object3d.visible,
    loadRegion: (id) => loadRegion(index.find((r) => r.id === id)),
  };
  // aba voltou e o dado ao vivo passou de 1 h: recarrega (o cache decide se busca de novo);
  // e também a cada 5 min com a aba visível (mapa aberto num segundo monitor não fica com dado velho e selo de atual)
  const maybeReload = () => { const s = nav.current; if (!document.hidden && shouldReload(s.status, Date.now() / 1000, s.loadedAt)) location.reload(); };
  document.addEventListener('visibilitychange', maybeReload);
  setInterval(maybeReload, 5 * 60 * 1000);
  view.start();
}
boot().catch((e) => { console.error(e); fatal('Não foi possível carregar o mapa. Recarregue a página.'); });
