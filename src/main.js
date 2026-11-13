import * as THREE from 'three';
import { createScene } from './render/scene.js';
import { createMap } from './render/map.js';

const params = new URLSearchParams(location.search);

async function boot() {
  const geo = await (await fetch('./assets/rs.json')).json();
  const view = createScene(document.getElementById('scene'), { cam: params.get('cam') ?? 'se' });
  const map = createMap(geo);
  view.scene.add(map);
  view.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a3140, 1.1));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
  sun.position.set(30, 60, 20);
  view.scene.add(sun);
  let first = true;
  view.onFrame(() => { if (first) { first = false; requestAnimationFrame(() => { document.documentElement.dataset.ready = '1'; }); } });
  view.start();
}
boot();
