import * as THREE from 'three';
import { createScene } from './render/scene.js';
import { createMap } from './render/map.js';
import { createClouds } from './render/clouds.js';
import { makeSlots } from './render/slots.js';
import { makeGrid } from './data/grid.js';
import { analyticField } from './data/analytic.js';
import { toScene, toLonLat, CELL_X, CELL_Z } from './geo/projection.js';

const params = new URLSearchParams(location.search);
const SLOT_COUNTS = { clouds: [2600, 2000, 1400], rain: 1500 };

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
  const view = createScene(document.getElementById('scene'), { cam: params.get('cam') ?? 'se' });
  view.scene.add(createMap(geo));
  view.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a3140, 1.1));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
  sun.position.set(30, 60, 20);
  view.scene.add(sun);

  const field = analyticField({ startUnix: Math.floor(Date.now() / 3600000) * 3600 });
  const t = Number(params.get('t') ?? 0);

  // slots só onde há dado: dentro da célula de algum nó da grade
  const bounds = sceneBounds(grid);
  const accept = (x, z) => { const ll = toLonLat(x, z); return grid.distCells(ll.lon, ll.lat) <= 0.72; };
  const clouds = createClouds({
    slotsByLayer: SLOT_COUNTS.clouds.map((count, i) => makeSlots({ ...bounds, count, seed: 101 + i, accept })),
  });
  view.scene.add(clouds.mesh);

  let acc = 1, first = true;
  view.onFrame((now, dt) => {
    acc += dt;
    if (acc >= 0.1) { acc = 0; clouds.update(field, t, now); }
    clouds.frame(now, view.camera);
    if (first) { first = false; requestAnimationFrame(() => { document.documentElement.dataset.ready = '1'; }); }
  });
  view.start();
}
boot();
