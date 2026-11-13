import * as THREE from 'three';
import { createScene } from './render/scene.js';
import { createMap } from './render/map.js';
import { createClouds } from './render/clouds.js';
import { createRain, MAX_PER_COLUMN } from './render/rain.js';
import { createLightning } from './render/lightning.js';
import { skyState, applySky, localHour } from './render/light.js';
import { makeSlots } from './render/slots.js';
import { makeGrid } from './data/grid.js';
import { createWeatherField } from './data/weather-field.js';
import { syntheticSeries } from './data/synthetic.js';
import { createDebug } from './ui/debug.js';
import { toScene, toLonLat, CELL_X, CELL_Z } from './geo/projection.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
// tetos do nível alto: 6.000 puffs; 1.350 colunas x 10 traços + 1.350 respingos = 14.850 instâncias de chuva
const SLOT_COUNTS = { clouds: [2600, 2000, 1400], rain: 1350 };

function sceneBounds(grid) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let p = 0; p < grid.nP; p++) {
    const s = toScene(grid.lons[p], grid.lats[p]);
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
  }
  return { minX: minX - CELL_X, maxX: maxX + CELL_X, minZ: minZ - CELL_Z, maxZ: maxZ + CELL_Z };
}

async function boot() {
  const geo = await (await fetch('./assets/rs.json')).json();
  const grid = makeGrid(geo.grid);
  const look = params.get('look')?.split(',').map(Number);
  const view = createScene(document.getElementById('scene'), {
    cam: params.get('cam') ?? 'se', dist: Number(params.get('dist') ?? 0), look: look ? toScene(look[0], look[1]) : null,
  });
  const map = createMap(geo);
  view.scene.add(map);
  const lights = { hemi: new THREE.HemisphereLight(), sun: new THREE.DirectionalLight(), tmp: new THREE.Color() };
  view.scene.add(lights.hemi, lights.sun);

  const field = createWeatherField(grid, syntheticSeries(grid, Math.floor(Date.now() / 3600000) * 3600));
  const state = { t: Number(params.get('t') ?? 0), playing: true };

  // slots só onde há dado: dentro da célula de algum nó da grade
  const bounds = sceneBounds(grid);
  const accept = (x, z) => { const ll = toLonLat(x, z); return grid.distCells(ll.lon, ll.lat) <= 0.72; };
  const clouds = createClouds({ slotsByLayer: SLOT_COUNTS.clouds.map((count, i) => makeSlots({ ...bounds, count, seed: 101 + i, accept })) });
  const rain = createRain({ slots: makeSlots({ ...bounds, count: SLOT_COUNTS.rain, seed: 201, accept }) });
  const lightning = createLightning({ grid });
  view.scene.add(clouds.shadow, rain.mesh, lightning.object3d, clouds.mesh);

  const perf = { fps: 60, frameMs: 16.7 };
  const stats = () => ({ fps: perf.fps, frameMs: perf.frameMs, puffs: clouds.visibleCount(), drops: rain.dropCount(), drawCalls: view.drawCalls(), quality: 'alto' });
  const debug = DEBUG ? createDebug(document.getElementById('debug'), { stats }) : null;

  function refresh(now) {
    const sky = skyState(localHour(field.times[0] + state.t * 3600));
    applySky(sky, { renderer: view.renderer, lights, ground: map.userData.ground, clouds, rain });
    clouds.update(field, state.t, now);
    rain.update(field, state.t);
    lightning.update(field, state.t);
  }

  let acc = 1, first = true;
  view.onFrame((now, dt) => {
    if (dt > 0) { perf.frameMs += (dt * 1000 - perf.frameMs) * 0.1; perf.fps = 1000 / perf.frameMs; }
    acc += dt;
    if (acc >= 0.1) { acc = 0; refresh(now); }
    clouds.setFlashes(lightning.frame(now, dt, state.playing));
    clouds.frame(now, view.camera);
    rain.frame(now);
    debug?.tick(dt);
    if (first) { first = false; requestAnimationFrame(() => { document.documentElement.dataset.ready = '1'; }); }
  });
  if (DEBUG) window.__rs = { field, grid, stats, state, rainColumns: () => rain.activeColumns(), rainStrokes: () => rain.activeStrokes(field, state.t), stormCount: () => lightning.stormCount(), boltVisible: () => lightning.object3d.visible };
  view.start();
}
boot();
