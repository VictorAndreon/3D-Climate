// Qualidade adaptativa (pura). O tempo de quadro medido é o intervalo entre requestAnimationFrame,
// que nunca fica abaixo do período da tela (16,7 ms a 60 Hz; 33 ms com o navegador em economia de energia).
// Por isso os limiares do design (desce > 20 ms por 2 s; sobe < 12 ms por 10 s) são lidos em relação a esse período:
//   desce: média de 2 s acima de 20 ms (ou de 1,25 × período, se a tela está limitada a ≤ 35 Hz)
//   sobe:  média abaixo de max(12 ms, 1,1 × período) — "rodando na taxa da tela" — por 10 s seguidos
// O período é o menor intervalo visto na janela. Depois de descer de um nível, voltar a ele fica bloqueado
// por 60 s (120 s, 180 s… a cada nova queda dele), para não oscilar entre dois níveis.
export const LEVELS = [
  { name: 'alto', slots: 1, puff: 1, pixelRatio: 1.5, shadows: true },
  { name: 'médio', slots: 0.65, puff: 1.25, pixelRatio: 1.25, shadows: true },
  { name: 'baixo', slots: 0.4, puff: 1.6, pixelRatio: 1.0, shadows: false },
];
const WINDOW = 2000, DOWN_MS = 20, UP_MS = 12, UP_HOLD = 10000, IGNORE_MS = 250, GAP_MS = 500, BLOCK_MS = 60000, THROTTLED_MS = 28;

export function createQuality({ level = 0 } = {}) {
  let samples = [], sum = 0, since = null, goodSince = null, last = null;
  const strikes = LEVELS.map(() => 0), blockedUntil = LEVELS.map(() => -Infinity);
  const reset = () => { samples = []; sum = 0; since = null; goodSince = null; };
  const api = {
    get level() { return level; },
    /** Registra um quadro. Devolve o novo nível quando troca, senão null. */
    push(frameMs, nowMs) {
      if (last != null && nowMs - last > GAP_MS) reset();           // aba voltou: começa do zero
      last = nowMs;
      if (!(frameMs > 0) || frameMs > IGNORE_MS) return null;       // quadro isolado absurdo não conta
      if (since == null) since = nowMs;
      samples.push(nowMs, frameMs); sum += frameMs;
      while (samples.length && samples[0] < nowMs - WINDOW) { sum -= samples[1]; samples.splice(0, 2); }
      const n = samples.length / 2, avg = sum / n;
      let period = Infinity;
      for (let i = 1; i < samples.length; i += 2) if (samples[i] < period) period = samples[i];
      // a tolerância extra só vale com a tela de fato limitada (≥ 28 ms, ex.: 30 Hz em economia de energia)
      const down = period >= THROTTLED_MS ? Math.max(DOWN_MS, 1.25 * period) : DOWN_MS, up = Math.max(UP_MS, 1.1 * period);
      if (avg <= up) { if (goodSince == null) goodSince = nowMs; } else goodSince = null;
      if (avg > down && nowMs - since >= WINDOW && level < LEVELS.length - 1) {
        strikes[level]++;
        blockedUntil[level] = nowMs + BLOCK_MS * strikes[level];
        level++; reset(); return level;
      }
      if (goodSince != null && nowMs - goodSince >= UP_HOLD && level > 0 && nowMs >= blockedUntil[level - 1]) { level--; reset(); return level; }
      return null;
    },
  };
  return api;
}
