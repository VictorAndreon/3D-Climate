// Qualidade adaptativa (pura). Desce um nível se a média de 2 s seguidos passa de 20 ms;
// sobe um nível só depois de 10 s seguidos abaixo de 12 ms. O gargalo esperado é overdraw:
// os níveis menores usam menos puffs, maiores, e pixel ratio menor.
export const LEVELS = [
  { name: 'alto', slots: 1, puff: 1, pixelRatio: 1.5, shadows: true },
  { name: 'médio', slots: 0.65, puff: 1.25, pixelRatio: 1.25, shadows: true },
  { name: 'baixo', slots: 0.4, puff: 1.6, pixelRatio: 1.0, shadows: false },
];
const WINDOW = 2000, DOWN_MS = 20, UP_MS = 12, UP_HOLD = 10000, IGNORE_MS = 250, GAP_MS = 500;

export function createQuality({ level = 0 } = {}) {
  let samples = [], sum = 0, since = null, goodSince = null, last = null;
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
      const avg = sum / (samples.length / 2);
      if (avg < UP_MS) { if (goodSince == null) goodSince = nowMs; } else goodSince = null;
      if (avg > DOWN_MS && nowMs - since >= WINDOW && level < LEVELS.length - 1) { level++; reset(); return level; }
      if (goodSince != null && nowMs - goodSince >= UP_HOLD && level > 0) { level--; reset(); return level; }
      return null;
    },
  };
  return api;
}
