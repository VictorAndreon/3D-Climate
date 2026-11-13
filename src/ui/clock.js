// Relógio da linha do tempo (puro). t em horas desde o primeiro timestamp; 1× = 1 h de previsão a cada 3 s.
const SPEEDS = [0.5, 1, 4];
export const HOURS_PER_SEC = 1 / 3;   // 1 h/s (o plano original) ficava rápido demais para acompanhar as nuvens
const MAX_DT = 0.1;       // aba voltando depois de horas não faz a linha do tempo pular

export function createClock({ tNow, tEnd72, tEndAll }) {
  let t = tNow, playing = false, speed = 1, range = '72h';
  const listeners = [];
  const tMax = () => (range === '72h' ? tEnd72 : tEndAll);
  const emit = () => { for (const fn of listeners) fn(api); };
  const set = (v) => { if (!Number.isFinite(v)) return; t = Math.min(Math.max(v, tNow), tMax()); emit(); };
  const api = {
    get t() { return t; }, get playing() { return playing; }, get speed() { return speed; }, get range() { return range; },
    get tMin() { return tNow; }, get tMax() { return tMax(); }, get tNow() { return tNow; },
    tick(dt) {
      if (!playing || !(dt > 0)) return;
      t += Math.min(dt, MAX_DT) * speed * HOURS_PER_SEC;
      if (t >= tMax()) { t = tMax(); playing = false; }
      emit();
    },
    seek: set,
    step(hours) { set(hours > 0 ? Math.floor(t + 1e-9) + 1 : Math.ceil(t - 1e-9) - 1); },
    home() { set(tNow); },
    play() { if (t >= tMax()) t = tNow; playing = true; emit(); },
    pause() { playing = false; emit(); },
    toggle() { if (playing) api.pause(); else api.play(); },
    setSpeed(s) { if (SPEEDS.includes(s)) { speed = s; emit(); } },
    setRange(r) { if (r !== '72h' && r !== '7d') return; range = r; if (t > tMax()) t = tMax(); emit(); },
    onChange(fn) { listeners.push(fn); },
  };
  return api;
}
