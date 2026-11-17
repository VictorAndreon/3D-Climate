// Renderer, câmera orbital, laço de render.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEG = Math.PI / 180;
// azimute medido a partir do sul (+z), girando para leste (+x); a distância vem do enquadramento da região
export const VIEWS = {
  se: { az: 28 * DEG, polar: 52 * DEG, dist: 1 },
  sw: { az: -28 * DEG, polar: 52 * DEG, dist: 1 },
  ne: { az: 152 * DEG, polar: 52 * DEG, dist: 1 },
  nw: { az: -152 * DEG, polar: 52 * DEG, dist: 1 },
  top: { az: 0, polar: 0.0001, dist: 1.32 },
};

/**
 * Enquadramento da câmera a partir do retângulo da região na cena (bounds = bbox projetado + 1 célula).
 * Regra, calibrada para reproduzir o RS de antes (bounds 81,2 x 79,8; alvo (-4,5; 6); passeio -43..34 x -37..38; vista a 100):
 *  - alvo: centro do retângulo, empurrado 7% da profundidade para o sul, para o estado não ficar alto demais na tela;
 *  - passeio: o retângulo recuado 3% do lado maior (tira a folga de uma célula);
 *  - distâncias: proporcionais ao lado maior (100 unidades quando ele mede 81,2, o tamanho do RS).
 */
const REF_SPAN = 81.2;
export function framing({ minX, maxX, minZ, maxZ }) {
  const w = maxX - minX, d = maxZ - minZ, span = Math.max(w, d), k = span / REF_SPAN, inset = 0.03 * span;
  return {
    target: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 + 0.07 * d },
    pan: { minX: minX + inset, maxX: maxX - inset, minZ: minZ + inset, maxZ: maxZ - inset },
    dist: 100 * k, distTop: 132 * k, maxDistance: 135 * k, distFly: 150 * k, distFlyMax: 200 * k, focusDist: 45 * k,
  };
}

export function viewPosition({ az, polar, dist }, target) {
  return new THREE.Vector3(
    target.x + dist * Math.sin(polar) * Math.sin(az),
    target.y + dist * Math.cos(polar),
    target.z + dist * Math.sin(polar) * Math.cos(az),
  );
}

/** bounds: retângulo da região na cena (veja framing); view.setRegion(bounds) troca de região sem recriar a cena. */
export function createScene(canvas, { cam = 'se', dist = 0, look = null, polar = 0, bounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 } } = {}) {
  let frame = framing(bounds), camName = cam;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x070b12, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 600);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3;                // dá pra descer até dentro das nuvens
  controls.zoomToCursor = true;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.8;

  function setView(name) {
    camName = name;
    const v = VIEWS[name] ?? VIEWS.se;
    controls.maxDistance = frame.maxDistance;
    // inclinação entre ~15° e ~80° acima do horizonte; `top` (só roteiros) desliga o limite
    controls.minPolarAngle = name === 'top' ? 0 : 10 * DEG;
    controls.maxPolarAngle = 88 * DEG;     // quase rente ao chão: nuvem em cima, chuva no meio, solo embaixo
    const target = look ? new THREE.Vector3(look.x, 0, look.z) : new THREE.Vector3(frame.target.x, 0, frame.target.z);      // dist/look: só para os roteiros
    controls.target.copy(target);
    camera.position.copy(viewPosition({ ...v, dist: dist || v.dist * frame.dist, ...(polar ? { polar: polar * DEG } : {}) }, target));
    camera.lookAt(target);
    controls.update();
  }
  setView(cam);
  const clampX = (x) => Math.min(frame.pan.maxX, Math.max(frame.pan.minX, x));
  const clampZ = (z) => Math.min(frame.pan.maxZ, Math.max(frame.pan.minZ, z));
  controls.addEventListener('change', () => {       // alvo preso ao retângulo do estado
    const t = controls.target;
    t.x = clampX(t.x); t.z = clampZ(t.z);
    t.y = 0;
  });
  /** Região nova: recalcula alvo, limites de passeio e distâncias e volta à vista atual dela. */
  function setRegion(b) { frame = framing(b); setView(camName); }

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

  // WASD (e Shift para correr): anda com câmera e alvo juntos, no plano do chão, relativo para onde se olha
  const keys = new Set();
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
  window.addEventListener('keydown', (e) => {
    if (!MOVE_KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    if (!keys.size) controls.dispatchEvent({ type: 'start' });          // cancela o voo de abertura
    keys.add(e.code);
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());                  // soltou a tecla fora da janela
  const fwd = new THREE.Vector3(), side = new THREE.Vector3(), move = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  let shift = false;
  window.addEventListener('keydown', (e) => { shift = e.shiftKey; });
  window.addEventListener('keyup', (e) => { shift = e.shiftKey; });
  function walk(dt) {
    if (!keys.size || !(dt > 0)) return;
    fwd.subVectors(controls.target, camera.position).setY(0);
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0);   // olhando reto para baixo
    fwd.normalize();
    side.crossVectors(fwd, UP);
    move.set(0, 0, 0);
    if (keys.has('KeyW')) move.add(fwd);
    if (keys.has('KeyS')) move.sub(fwd);
    if (keys.has('KeyD')) move.add(side);
    if (keys.has('KeyA')) move.sub(side);
    if (move.lengthSq() === 0) return;
    // velocidade proporcional à distância: perto anda devagar, de longe cruza o estado em ~2 s
    const speed = Math.max(4, camera.position.distanceTo(controls.target)) * (shift ? 1.6 : 0.6);
    move.normalize().multiplyScalar(speed * dt);
    const t = controls.target, x0 = t.x, z0 = t.z;
    t.x = clampX(t.x + move.x);
    t.z = clampZ(t.z + move.z);
    camera.position.x += t.x - x0; camera.position.z += t.z - z0;     // no limite do estado a câmera para junto
  }

  const frameFns = [];
  let raf = 0, last = 0, calls = 0, running = false;
  function loop(ms) {
    raf = requestAnimationFrame(loop);
    const now = ms / 1000;
    const dt = last ? Math.min(now - last, 1) : 0;
    last = now;
    walk(dt);
    controls.update();
    for (const fn of frameFns) fn(now, dt);
    renderer.render(scene, camera);
    calls = renderer.info.render.calls;
  }
  function start() { if (!running) { running = true; last = 0; raf = requestAnimationFrame(loop); } }
  function stop() { running = false; cancelAnimationFrame(raf); }
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));   // aba oculta: laço para

  // voo de abertura: de uma vista alta e afastada até a vista padrão; qualquer interação cancela
  function flyIn(name = 'se', seconds = 1.8) {
    const v = VIEWS[name] ?? VIEWS.se, to = { ...v, dist: v.dist * frame.dist }, from = { az: to.az - 0.5, polar: 14 * DEG, dist: frame.distFly };
    let t = 0, active = true;
    const cancel = () => { active = false; controls.removeEventListener('start', cancel); };
    controls.addEventListener('start', cancel);
    const pose = (k) => camera.position.copy(viewPosition({ az: from.az + (to.az - from.az) * k, polar: from.polar + (to.polar - from.polar) * k, dist: from.dist + (to.dist - from.dist) * k }, controls.target));
    const savedMax = controls.maxDistance;
    controls.maxDistance = frame.distFlyMax; pose(0); camera.lookAt(controls.target);
    frameFns.push((now, dt) => {
      if (!active) { controls.maxDistance = savedMax; return; }
      t = Math.min(1, t + dt / seconds);
      pose(1 - (1 - t) ** 3);                                  // ease-out
      if (t >= 1) cancel();
    });
  }

  // leva o alvo da câmera até (x, z) mantendo o ângulo; se estiver longe, aproxima até maxDist. Qualquer interação cancela
  function focusOn(x, z, { maxDist = frame.focusDist, seconds = 0.9 } = {}) {
    controls.dispatchEvent({ type: 'start' });                 // cancela voo de abertura ou foco anterior
    const from = controls.target.clone();
    const to = new THREE.Vector3(clampX(x), 0, clampZ(z));
    const off = camera.position.clone().sub(from), d0 = off.length(), d1 = Math.min(d0, maxDist);
    let t = 0;
    const step = (now, dt) => {
      t = seconds > 0 ? Math.min(1, t + dt / seconds) : 1;
      const k = 1 - (1 - t) ** 3;                              // ease-out
      controls.target.lerpVectors(from, to, k);
      camera.position.copy(controls.target).addScaledVector(off, (d0 + (d1 - d0) * k) / d0);
      if (t >= 1) cancel();
    };
    const cancel = () => { controls.removeEventListener('start', cancel); const i = frameFns.indexOf(step); if (i >= 0) frameFns.splice(i, 1); };
    controls.addEventListener('start', cancel);
    frameFns.push(step);
  }

  // mergulho: leva o alvo até (x, z) e a câmera até `dist` do alvo, mantendo o ângulo (ease-in-out). Resolve ao chegar ou
  // quando qualquer interação (ou outro voo) cancela; um prazo de garantia resolve também com a aba oculta (sem quadros)
  function flyTo({ x, z }, { dist, seconds = 1.2 } = {}) {
    controls.dispatchEvent({ type: 'start' });
    const from = controls.target.clone(), to = new THREE.Vector3(clampX(x), 0, clampZ(z));
    const off = camera.position.clone().sub(from), d0 = off.length(), d1 = Math.max(dist ?? d0, controls.minDistance);
    return new Promise((resolve) => {
      let t = 0, timer = 0;
      const step = (now, dt) => {
        t = seconds > 0 ? Math.min(1, t + dt / seconds) : 1;
        const k = t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
        controls.target.lerpVectors(from, to, k);
        camera.position.copy(controls.target).addScaledVector(off, (d0 + (d1 - d0) * k) / d0);
        if (t >= 1) cancel();
      };
      const cancel = () => {
        clearTimeout(timer);
        controls.removeEventListener('start', cancel);
        const i = frameFns.indexOf(step); if (i >= 0) frameFns.splice(i, 1);
        resolve();
      };
      controls.addEventListener('start', cancel);
      frameFns.push(step);
      timer = setTimeout(cancel, seconds * 2000 + 1000);
    });
  }

  // ponteiro -> ponto sobre um objeto (ou lista) da cena: peça do estado e município levantado
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(object, clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = (Array.isArray(object) ? raycaster.intersectObjects(object, false) : raycaster.intersectObject(object, false))[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }

  return {
    scene, camera, controls, renderer, setView, setRegion, start, stop, pick, flyIn, flyTo, focusOn,
    onFrame: (fn) => frameFns.push(fn),
    setPixelRatio: (r) => { pixelRatio = r; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, r)); resize(); },
    drawCalls: () => calls,
  };
}
