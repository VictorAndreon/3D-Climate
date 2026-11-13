// Mapa base: estado extrudado como uma peça só, bordas municipais como uma única geometria de linhas, chão.
import * as THREE from 'three';
import { toScene } from '../geo/projection.js';

const THICK = 1, BEVEL = 0.08;

function ringToPoints(flat) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) {
    const s = toScene(flat[i], flat[i + 1]);
    pts.push(new THREE.Vector2(s.x, -s.z));        // forma em XY com norte para cima; rotateX leva y -> -z
  }
  return pts;
}

export function createMap(geo) {
  const group = new THREE.Group();

  const shapes = geo.outline.map(([outer, ...holes]) => {
    const shape = new THREE.Shape(ringToPoints(outer));
    for (const h of holes) shape.holes.push(new THREE.Path(ringToPoints(h)));
    return shape;
  });
  const body = new THREE.ExtrudeGeometry(shapes, {
    depth: THICK - 2 * BEVEL, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelOffset: -BEVEL, bevelSegments: 2, curveSegments: 1,
  });
  body.rotateX(-Math.PI / 2);
  body.computeBoundingBox();
  body.translate(0, -body.boundingBox.max.y, 0);   // topo em y = 0
  const land = new THREE.Mesh(body, [
    new THREE.MeshStandardMaterial({ color: 0x7fa56b, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x3f5a45, roughness: 0.9, metalness: 0 }),
  ]);
  land.name = 'land';
  group.add(land);

  // bordas municipais: uma única LineSegments
  const pos = [];
  for (const line of geo.borders) {
    for (let i = 0; i + 3 < line.length; i += 2) {
      const a = toScene(line[i], line[i + 1]), b = toScene(line[i + 2], line[i + 3]);
      pos.push(a.x, 0.02, a.z, b.x, 0.02, b.z);
    }
  }
  for (const [outer] of geo.outline) {              // contorno do estado na mesma geometria
    for (let i = 0; i < outer.length; i += 2) {
      const j = (i + 2) % outer.length;
      const a = toScene(outer[i], outer[i + 1]), b = toScene(outer[j], outer[j + 1]);
      pos.push(a.x, 0.02, a.z, b.x, 0.02, b.z);
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const borders = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
  borders.name = 'borders';
  group.add(borders);

  const ground = createGround();
  group.add(ground);

  group.userData = { land, borders, ground };
  return group;
}

/** Chão: disco com gradiente radial que morre na cor de fundo, logo abaixo da peça do estado. */
export function createGround() {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(260, 48).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: { uInner: { value: new THREE.Vector3(0.13, 0.22, 0.36) }, uOuter: { value: new THREE.Vector3(0.04, 0.07, 0.12) } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uInner; uniform vec3 uOuter; varying vec2 vP; void main(){ float k = smoothstep(25.0, 120.0, length(vP)); gl_FragColor = vec4(mix(uInner, uOuter, k), 1.0); }',
    }),
  );
  ground.position.y = -THICK - 0.05;
  ground.name = 'ground';
  return ground;
}
