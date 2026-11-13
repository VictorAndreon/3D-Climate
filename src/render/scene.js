// Renderer, câmera orbital, laço de render.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const TARGET = new THREE.Vector3(-4.5, 0, 6);                // centro do estado na cena
const BOUNDS = { minX: -43, maxX: 34, minZ: -37, maxZ: 38 };
const DEG = Math.PI / 180;
const DIST = 100;
// azimute medido a partir do sul (+z), girando para leste (+x)
export const VIEWS = {
  se: { az: 28 * DEG, polar: 52 * DEG, dist: DIST },
  sw: { az: -28 * DEG, polar: 52 * DEG, dist: DIST },
  ne: { az: 152 * DEG, polar: 52 * DEG, dist: DIST },
  nw: { az: -152 * DEG, polar: 52 * DEG, dist: DIST },
  top: { az: 0, polar: 0.0001, dist: 132 },
};

export function viewPosition({ az, polar, dist }, target = TARGET) {
  return new THREE.Vector3(
    target.x + dist * Math.sin(polar) * Math.sin(az),
    target.y + dist * Math.cos(polar),
    target.z + dist * Math.sin(polar) * Math.cos(az),
  );
}

export function createScene(canvas, { cam = 'se', dist = 0, look = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x070b12, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 1, 600);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 18;
  controls.maxDistance = 135;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.8;

  function setView(name) {
    const v = VIEWS[name] ?? VIEWS.se;
    // inclinação entre ~15° e ~80° acima do horizonte; `top` (só roteiros) desliga o limite
    controls.minPolarAngle = name === 'top' ? 0 : 10 * DEG;
    controls.maxPolarAngle = 75 * DEG;
    const target = look ? new THREE.Vector3(look.x, 0, look.z) : TARGET;      // dist/look: só para os roteiros
    controls.target.copy(target);
    camera.position.copy(viewPosition(dist ? { ...v, dist } : v, target));
    camera.lookAt(target);
    controls.update();
  }
  setView(cam);
  controls.addEventListener('change', () => {       // alvo preso ao retângulo do estado
    const t = controls.target;
    t.x = Math.min(BOUNDS.maxX, Math.max(BOUNDS.minX, t.x));
    t.z = Math.min(BOUNDS.maxZ, Math.max(BOUNDS.minZ, t.z));
    t.y = 0;
  });

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // em tela estreita (celular em pé) abre o campo de visão para o estado caber
    camera.fov = camera.aspect < 1 ? Math.min(75, 36 / Math.max(0.45, camera.aspect) * 0.9) : 36;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const frameFns = [];
  let raf = 0, last = 0, calls = 0, running = false;
  function loop(ms) {
    raf = requestAnimationFrame(loop);
    const now = ms / 1000;
    const dt = last ? Math.min(now - last, 1) : 0;
    last = now;
    controls.update();
    for (const fn of frameFns) fn(now, dt);
    renderer.render(scene, camera);
    calls = renderer.info.render.calls;
  }
  function start() { if (!running) { running = true; last = 0; raf = requestAnimationFrame(loop); } }
  function stop() { running = false; cancelAnimationFrame(raf); }
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));   // aba oculta: laço para

  // ponteiro -> ponto sobre um objeto da cena (usado pelo tooltip com a peça do estado)
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(object, clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(object, false)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }

  return {
    scene, camera, controls, renderer, setView, start, stop, pick,
    onFrame: (fn) => frameFns.push(fn),
    setPixelRatio: (r) => { pixelRatio = r; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, r)); resize(); },
    drawCalls: () => calls,
  };
}
