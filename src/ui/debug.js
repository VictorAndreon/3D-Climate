// Painel de debug (?debug=1): fps, tempo de quadro, puffs, gotas, draw calls, nível de qualidade.
export function createDebug(el, { stats }) {
  el.hidden = false;
  let acc = 0;
  return {
    el,
    tick(dt) {
      acc += dt;
      if (acc < 0.25) return;
      acc = 0;
      const s = stats();
      el.textContent = `${s.fps.toFixed(0)} fps · ${s.frameMs.toFixed(1)} ms\npuffs ${s.puffs} · gotas ${s.drops}\ndraw calls ${s.drawCalls} · qualidade ${s.quality}`;
    },
  };
}
