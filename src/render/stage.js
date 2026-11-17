// Palco: dono do mapa, das nuvens, da chuva, dos raios e dos pontos da grade da região na tela. Troca cada um no lugar
// (menu de debug) ou a região inteira (setRegion), liberando o que sai, sem mexer em câmera, relógio ou seleção.
// Em rajada, vale o último pedido.
import { createMap } from './map.js';
import { createReliefMap } from './relief-map.js';
import { createClouds } from './clouds.js';
import { createSolidClouds } from './clouds-solid.js';
import { createVolumeClouds } from './clouds-volume.js';
import { createRain } from './rain.js';
import { createLightning } from './lightning.js';
import { makeSlots } from './slots.js';
import { createGridDots } from '../ui/debug.js';

// tetos do nível alto: 6.000 puffs em sprite; 1.950 cachos sólidos + 1.400 cirros no padrão
const SLOT_COUNTS = { clouds: [2600, 2000, 1400], solid: [1150, 800] };
const SLOT_RAIN = 1350;       // 1.350 colunas x 10 traços + 1.350 respingos = 14.850 instâncias de chuva

/** Retângulo da grade na cena, com uma célula de folga: de onde saem as posições de nuvem e chuva. */
export function sceneBounds(grid, proj) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let p = 0; p < grid.nP; p++) {
    const s = proj.toScene(grid.lons[p], grid.lats[p]);
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
  }
  const cell = proj.cell(grid.step);
  return { minX: minX - cell.x, maxX: maxX + cell.x, minZ: minZ - cell.z, maxZ: maxZ + cell.z };
}
/** Posições só onde há dado: dentro da célula de algum nó da grade. */
function slotMaker({ grid, proj }, bounds) {
  const accept = (x, z) => { const ll = proj.toLonLat(x, z); return grid.distCells(ll.lon, ll.lat) <= 0.72; };
  return (count, seed) => makeSlots({ ...bounds, count, seed, accept });
}

/** Junta nuvens sólidas (baixa, média) e sprites (alta) numa interface só. */
function combineClouds(solid, high) {
  const both = [solid, high];
  return {
    objects: [solid.shadow, solid.mesh, high.shadow, high.mesh],
    update: (f, t, now) => both.forEach((c) => c.update(f, t, now)),
    frame: (now, cam) => both.forEach((c) => c.frame(now, cam)),
    setFlashes: (l) => both.forEach((c) => c.setFlashes(l)),
    setSky: (s) => both.forEach((c) => c.setSky(s)),
    setQuality: (q) => both.forEach((c) => c.setQuality(q)),
    visibleCount: () => solid.visibleCount() + high.visibleCount(),
    dispose: () => both.forEach((c) => c.dispose()),
  };
}

/**
 * region: { geo, grid, proj, hasRelief } (veja loadRegion); sem relevo, setRelief(true) rejeita e o mapa fica plano.
 * loadRelief() e loadNoise() devolvem promessas; cada uma é chamada até dar certo uma vez e o resultado fica guardado.
 * onSwap(what) roda depois de cada troca ('map' | 'clouds' | 'dots' | 'region'), para quem está de fora reaplicar céu,
 * qualidade e dado no mesmo quadro. Chuva e raios nascem com o palco e trocam junto com a região (stage.rain, stage.lightning).
 */
export function createStage({ view, region, loadRelief, loadNoise, onSwap = () => {} }) {
  let { geo, grid, proj, hasRelief } = region, bounds = sceneBounds(grid, proj), slots = slotMaker(region, bounds);
  const state = { nuvens: null, relevo: false, exagero: 12, grade: false, relevoDisponivel: hasRelief };      // relevo só onde há .bin (RS)
  let map = null, clouds = null, dots = null, rain = null, lightning = null;
  let regionReq = 0;
  const want = { nuvens: null, relevo: false, exagero: 12 };       // último pedido de nuvem e de relevo, anotado na chamada: setRegion constrói com ele
  let cloudReq = 0, mapReq = 0, reliefP = null, noiseP = null;
  const pending = new Set();
  const track = (p) => { pending.add(p); const done = () => pending.delete(p); p.then(done, done); return p; };
  const once = (get, load, set) => get() ?? set(load().catch((e) => { set(null); throw e; }));
  let slotCache = new Map();
  const slotsFor = (count, seed) => { const k = `${count}:${seed}`; if (!slotCache.has(k)) slotCache.set(k, slots(count, seed)); return slotCache.get(k); };

  function buildClouds(kind, noise) {
    if (kind === 'volume') return createVolumeClouds({ renderer: view.renderer, grid, bounds, proj, noise });
    if (kind === 'sprite') return createClouds({ slotsByLayer: SLOT_COUNTS.clouds.map((n, i) => slotsFor(n, 101 + i)), proj, step: grid.step });
    return combineClouds(
      createSolidClouds({ slotsByLayer: SLOT_COUNTS.solid.map((n, i) => slotsFor(n, 101 + i)), proj, step: grid.step }),
      // cirros continuam finos e translúcidos (sprite), só na camada alta
      createClouds({ slotsByLayer: [new Float32Array(0), new Float32Array(0), slotsFor(SLOT_COUNTS.clouds[2], 103)], proj, step: grid.step }),
    );
  }
  const objectsOf = (c) => c.objects ?? [c.shadow, c.mesh];

  async function setClouds(kind) {
    const req = ++cloudReq;                                    // pedido novo supera qualquer carga pendente
    want.nuvens = kind;
    if (clouds && kind === state.nuvens) return;
    const noise = kind === 'volume' ? await once(() => noiseP, loadNoise, (p) => (noiseP = p)) : null;
    if (req !== cloudReq) return;
    const next = buildClouds(kind, noise);
    if (clouds) { view.scene.remove(...objectsOf(clouds)); clouds.dispose(); }
    clouds = next; state.nuvens = kind;
    view.scene.add(...objectsOf(clouds));
    onSwap('clouds');
  }

  function swapMap(next) {
    if (map) { view.scene.remove(map); map.userData.dispose(); }
    map = next;
    view.scene.add(map);
    onSwap('map');
  }
  /** Rejeita se o relevo não carregar; nesse caso o mapa que estava continua (ou entra o plano, se não havia nenhum). */
  async function setRelief(on, exagero = state.exagero) {
    const req = ++mapReq;
    want.relevo = on; want.exagero = exagero;
    if (map && on === state.relevo && (!on || exagero === state.exagero)) { state.exagero = exagero; return; }
    if (on && !hasRelief) { want.relevo = state.relevo; if (!map) swapMap(createMap(geo, { proj })); throw new Error('relevo indisponível nesta região'); }
    if (!on) { state.relevo = false; state.exagero = exagero; swapMap(createMap(geo, { proj })); return; }
    let relief;
    try { relief = await once(() => reliefP, loadRelief, (p) => (reliefP = p)); }
    catch (e) { if (req === mapReq) want.relevo = state.relevo; if (!map && req === mapReq) swapMap(createMap(geo, { proj })); throw e; }
    if (req !== mapReq) return;
    if (!hasRelief) { want.relevo = state.relevo; throw new Error('relevo indisponível nesta região'); }       // a região trocou enquanto o relevo carregava
    state.relevo = true; state.exagero = exagero;
    swapMap(createReliefMap(geo, relief, { exag: exagero, proj }));
  }

  function dropDots() { view.scene.remove(dots.points); dots.points.geometry.dispose(); dots.points.material.dispose(); dots = null; }
  function setDots(on) {
    if (on === !!dots) return;
    if (dots) dropDots();
    else { dots = createGridDots(grid, proj); view.scene.add(dots.points); }
    state.grade = on;
    onSwap('dots');
  }

  function buildRain() { return createRain({ slots: slots(SLOT_RAIN, 201), proj, step: grid.step }); }
  function swapRain(nextRain, nextLightning) {
    if (rain) { view.scene.remove(rain.mesh, lightning.object3d); rain.dispose(); lightning.dispose(); }
    rain = nextRain; lightning = nextLightning;
    view.scene.add(rain.mesh, lightning.object3d);
  }

  /**
   * Troca a região inteira: mapa, nuvens, chuva, raios e pontos da grade, mantendo o tipo de nuvem, a grade ligada e o
   * exagero; o relevo é desligado onde a região não tem. Tudo que sai é liberado. Só espera o que é assíncrono (ruído do
   * volume, relevo) e depois troca de uma vez, no mesmo quadro. Em rajada, vale a última.
   */
  async function setRegion(next) {
    const req = ++regionReq;
    // espera o que o último pedido de nuvem e de relevo precisa; se chegar pedido novo no meio, confere de novo
    let kind, wantRelief, noise = null, relief = null;
    for (;;) {
      kind = want.nuvens; wantRelief = want.relevo && next.hasRelief;
      const [n, r] = await Promise.all([
        kind === 'volume' ? once(() => noiseP, loadNoise, (p) => (noiseP = p)) : null,
        wantRelief ? once(() => reliefP, loadRelief, (p) => (reliefP = p)).catch((e) => { console.warn('relevo indisponível, seguindo com o mapa plano', e); return null; }) : null,
      ]);
      if (req !== regionReq) return;
      if (kind === want.nuvens && wantRelief === (want.relevo && next.hasRelief)) { noise = n; relief = r; break; }
    }
    const prev = { geo, grid, proj, hasRelief, bounds, slots, slotCache };
    ({ geo, grid, proj, hasRelief } = next); bounds = sceneBounds(grid, proj); slots = slotMaker(next, bounds); slotCache = new Map();
    const built = [];
    try {
      const nextMap = relief ? createReliefMap(geo, relief, { exag: want.exagero, proj }) : createMap(geo, { proj });
      built.push(() => nextMap.userData.dispose());
      const nextClouds = kind ? buildClouds(kind, noise) : null;
      if (nextClouds) built.push(() => nextClouds.dispose());
      const nextRain = buildRain(), nextLightning = createLightning({ grid, proj });
      built.push(() => { nextRain.dispose(); nextLightning.dispose(); });
      const nextDots = dots ? createGridDots(grid, proj) : null;
      if (nextDots) built.push(() => { nextDots.points.geometry.dispose(); nextDots.points.material.dispose(); });
      // tudo construído: agora sai o antigo e entra o novo
      if (map) { view.scene.remove(map); map.userData.dispose(); }
      if (clouds) { view.scene.remove(...objectsOf(clouds)); clouds.dispose(); }
      if (dots) dropDots();
      map = nextMap; clouds = nextClouds; dots = nextDots;
      view.scene.add(map);
      if (clouds) view.scene.add(...objectsOf(clouds));
      if (dots) view.scene.add(dots.points);
      swapRain(nextRain, nextLightning);
    } catch (e) {                                               // falhou no meio: nada novo entrou na cena; volta a região de antes
      built.forEach((undo) => undo());
      ({ geo, grid, proj, hasRelief, bounds, slots, slotCache } = prev);
      throw e;
    }
    ++cloudReq; ++mapReq;                                        // cargas em voo eram da região de antes; os pedidos delas já estão em `want`
    state.nuvens = kind; state.relevo = !!relief; state.exagero = want.exagero; state.relevoDisponivel = hasRelief;
    if (hasRelief) want.relevo = state.relevo;                   // sem relevo na região nova o pedido fica anotado: ao voltar a uma região com relevo, ele volta
    onSwap('region');
  }

  swapRain(buildRain(), createLightning({ grid, proj }));       // chuva e raios existem desde o começo

  return {
    get map() { return map; },
    get clouds() { return clouds; },
    get dots() { return dots; },
    get rain() { return rain; },
    get lightning() { return lightning; },
    get state() { return { ...state, relevoPedido: want.relevo }; },
    setClouds: (kind) => track(setClouds(kind)),
    setRelief: (on, exagero) => track(setRelief(on, exagero)),
    setDots,
    setRegion: (next) => track(setRegion(next)),
    /** Resolve quando não há troca pendente. */
    async idle() { while (pending.size) await Promise.allSettled([...pending]); },
  };
}
