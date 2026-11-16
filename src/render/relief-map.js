// Spike (?relevo=1): mapa base com relevo. Malha em grade deslocada pela altitude, recortada no contorno
// do estado por uma máscara (alphaTest), paredes laterais que seguem a altitude da borda e bordas
// municipais coladas no terreno. Mesma interface de createMap: userData { land, borders, ground }.
import * as THREE from 'three';
import { toScene, toLonLat } from '../geo/projection.js';
import { createGround } from './map.js';

const BASE = 1;                     // fundo da peça em y = -1, como no mapa plano
const SEGMENT = 0.25;               // passo máximo (unidades de cena) ao colar linhas no terreno
const MASK_PX = 2048;
const STOPS = [[0, 0x7fa56b], [0.3, 0x93ab6c], [0.6, 0xb0a873], [1, 0xcbbf9d]];   // verde de várzea -> campo de altitude

function hypso(t, out) {
  t = Math.min(Math.max(t, 0), 1);
  let k = 1;
  while (k < STOPS.length - 1 && STOPS[k][0] < t) k++;
  const [t0, c0] = STOPS[k - 1], [t1, c1] = STOPS[k];
  return out.setHex(c0).lerp(new THREE.Color(c1), (t - t0) / (t1 - t0));
}

/** relief: parseRelief(); exag: exagero vertical (1 = real). */
export function createReliefMap(geo, relief, { exag = 12 } = {}) {
  const group = new THREE.Group();
  const k = exag / 10000;                                   // metros -> unidades (1 unidade = 10 km)
  const heightAt = (x, z) => { const ll = toLonLat(x, z); return relief.metersAt(ll.lon, ll.lat) * k; };
  const heightLL = (lon, lat) => relief.metersAt(lon, lat) * k;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const rings = geo.outline.map(([outer]) => {
    const pts = [];
    for (let i = 0; i < outer.length; i += 2) {
      const s = toScene(outer[i], outer[i + 1]); pts.push(s);
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
    }
    return pts;
  });
  minX -= 0.5; maxX += 0.5; minZ -= 0.5; maxZ += 0.5;
  const W = maxX - minX, D = maxZ - minZ;

  // máscara do estado: branco dentro, preto fora; norte no topo do canvas = v alto na textura
  const mw = MASK_PX, mh = Math.round(MASK_PX * D / W);
  const canvas = document.createElement('canvas'); canvas.width = mw; canvas.height = mh;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, mw, mh);
  ctx.fillStyle = '#fff'; ctx.beginPath();
  for (const pts of rings) pts.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](((p.x - minX) / W) * mw, ((p.z - minZ) / D) * mh));
  ctx.fill('evenodd');
  const maskPx = ctx.getImageData(0, 0, mw, mh).data;
  const inside = (x, z) => {
    const i = Math.floor(((x - minX) / W) * mw), j = Math.floor(((z - minZ) / D) * mh);
    return i >= 0 && j >= 0 && i < mw && j < mh && maskPx[(j * mw + i) * 4 + 1] > 127;
  };
  const mask = new THREE.CanvasTexture(canvas);
  mask.minFilter = THREE.LinearFilter; mask.generateMipmaps = false;

  // terreno: ~1 vértice a cada 0,25 unidade (2,5 km), um pouco acima da resolução do dado
  const segX = Math.round(W / 0.25), segZ = Math.round(D / 0.25);
  const terrainGeo = new THREE.PlaneGeometry(W, D, segX, segZ).rotateX(-Math.PI / 2);
  terrainGeo.translate(minX + W / 2, 0, minZ + D / 2);
  const pos = terrainGeo.attributes.position, colors = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = heightAt(pos.getX(i), pos.getZ(i));
    pos.setY(i, h);
    hypso(h / (1400 * k), c).toArray(colors, i * 3);
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  const land = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0, alphaMap: mask, alphaTest: 0.5,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  }));
  land.name = 'land';
  group.add(land);

  // paredes: do fundo até a altitude da borda. Vértices compartilhados ao longo do anel para a normal
  // sair suavizada (a divisa com SC segue o Rio Pelotas em zigue-zague e, facetada, vira listras)
  const wallPos = [], wallIdx = [];
  for (const pts of rings) {
    const first = wallPos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / SEGMENT));
      for (let s = 0; s < n; s++) {
        const x = a.x + (b.x - a.x) * (s / n), z = a.z + (b.z - a.z) * (s / n);
        wallPos.push(x, -BASE, z, x, heightAt(x, z), z);
      }
    }
    const count = (wallPos.length / 3 - first) / 2;
    for (let q = 0; q < count; q++) {
      const a = first + q * 2, b = first + ((q + 1) % count) * 2;
      wallIdx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  wallGeo.setIndex(wallIdx);
  wallGeo.computeVertexNormals();
  const walls = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({ color: 0x3f5a45, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
  walls.name = 'walls';
  group.add(walls);

  // bordas municipais e contorno coladas no terreno
  const lines = [];
  const drape = (ax, az, bx, bz) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / SEGMENT));
    let px = ax, pz = az, py = heightAt(ax, az);
    for (let s = 1; s <= n; s++) {
      const x = ax + (bx - ax) * (s / n), z = az + (bz - az) * (s / n), y = heightAt(x, z);
      lines.push(px, py + 0.04, pz, x, y + 0.04, z);
      px = x; pz = z; py = y;
    }
  };
  for (const line of geo.borders) for (let i = 0; i + 3 < line.length; i += 2) {
    const a = toScene(line[i], line[i + 1]), b = toScene(line[i + 2], line[i + 3]);
    drape(a.x, a.z, b.x, b.z);
  }
  for (const pts of rings) for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; drape(a.x, a.z, b.x, b.z); }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  const borders = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
  borders.name = 'borders';
  group.add(borders);

  const ground = createGround();
  group.add(ground);

  group.userData = { land, borders, ground, inside, heightAt, heightLL };
  return group;
}
