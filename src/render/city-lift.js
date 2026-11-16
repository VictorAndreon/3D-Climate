// Município selecionado: uma peça extrudada só dele que sobe do mapa, com contorno claro no topo.
import * as THREE from 'three';
import { toScene } from '../geo/projection.js';
import { inRing } from '../data/city.js';

const LIFT = 0.7;                 // 7 km na escala da cena; as nuvens baixas ficam em ~4
const BASE = 1;                   // espessura do mapa (map.js): a peça nasce de dentro dele
const RISE_S = 0.45, FALL_S = 0.3;
export const PICK_COLOR = 0xf3d27a;

const ring = (flat) => { const pts = []; for (let i = 0; i < flat.length; i += 2) { const s = toScene(flat[i], flat[i + 1]); pts.push(new THREE.Vector2(s.x, -s.z)); } return pts; };
const easeOutBack = (k) => 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2;

/** Ponto mais alto do terreno dentro do município (vértices do contorno + grade 12×12 no interior). */
function highestGround(polys, groundLL) {
  let top = 0;
  for (const [outer] of polys) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < outer.length; i += 2) {
      top = Math.max(top, groundLL(outer[i], outer[i + 1]));
      x0 = Math.min(x0, outer[i]); x1 = Math.max(x1, outer[i]); y0 = Math.min(y0, outer[i + 1]); y1 = Math.max(y1, outer[i + 1]);
    }
    for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) {
      const lon = x0 + ((a + 0.5) / 12) * (x1 - x0), lat = y0 + ((b + 0.5) / 12) * (y1 - y0);
      if (inRing(outer, lon, lat)) top = Math.max(top, groundLL(lon, lat));
    }
  }
  return top;
}

/** groundLL(lon, lat): altura do terreno em unidades de cena (relevo); sem ela o mapa é plano. */
export function createCityLift({ reducedMotion = false, groundLL = null } = {}) {
  const group = new THREE.Group();
  group.name = 'city-lift';
  group.visible = false;
  const top = new THREE.MeshStandardMaterial({ color: 0xa9c47f, roughness: 0.85, metalness: 0, emissive: PICK_COLOR, emissiveIntensity: 0.12 });
  // lateral sem luz (contorno em zigue-zague, iluminado, vira listras) e puxada à frente: em município de
  // divisa ela cai exatamente sobre a parede do estado
  const side = new THREE.MeshBasicMaterial({ color: 0xb8964c, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const edge = new THREE.LineBasicMaterial({ color: PICK_COLOR, transparent: true, opacity: 0.95 });
  // cópia fraca sem teste de profundidade: o contorno continua visível com nuvem por cima
  const ghost = new THREE.LineBasicMaterial({ color: PICK_COLOR, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false });
  let mesh = null, outline = null, halo = null, k = 0, dir = 0;

  function dispose() {
    for (const o of [mesh, outline]) if (o) { group.remove(o); o.geometry.dispose(); }
    if (halo) group.remove(halo);
    mesh = outline = halo = null;
  }

  function select(polys) {
    dispose();
    const shapes = polys.map(([outer, ...holes]) => {
      const s = new THREE.Shape(ring(outer));
      for (const h of holes) s.holes.push(new THREE.Path(ring(h)));
      return s;
    });
    // com relevo a peça vira uma mesa acima do ponto mais alto do município (spike: o topo não acompanha o terreno)
    const g = groundLL ? highestGround(polys, groundLL) : 0;
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: BASE + g + LIFT, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -BASE, 0);                    // topo em y = g + LIFT
    mesh = new THREE.Mesh(geo, [top, side]);
    mesh.name = 'city';
    const pos = [];
    for (const [outer] of polys) for (let i = 0; i < outer.length; i += 2) {
      const j = (i + 2) % outer.length, a = toScene(outer[i], outer[i + 1]), b = toScene(outer[j], outer[j + 1]);
      pos.push(a.x, g + LIFT + 0.015, a.z, b.x, g + LIFT + 0.015, b.z);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    outline = new THREE.LineSegments(lg, edge);
    halo = new THREE.LineSegments(lg, ghost);
    halo.renderOrder = 10;
    group.add(mesh, outline, halo);
    group.visible = true;
    k = reducedMotion ? 1 : 0; dir = 1;
    place();
  }

  function clear() { if (mesh) dir = -1; if (reducedMotion) { k = 0; place(); } }

  function place() {
    const lift = dir > 0 ? easeOutBack(k) : k * k;
    group.position.y = -LIFT + LIFT * lift;        // começa nivelada com o mapa (topo em y = 0)
    if (dir < 0 && k <= 0) { dispose(); group.visible = false; dir = 0; }
  }

  function frame(dt) {
    if (!dir) return;
    k = Math.min(1, Math.max(0, k + dir * dt / (dir > 0 ? RISE_S : FALL_S)));
    place();
    if (dir > 0 && k >= 1) dir = 0;
  }

  return { group, select, clear, frame, get mesh() { return mesh; } };
}
