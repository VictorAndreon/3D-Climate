// Passo da grade por região: a API grátis do Open-Meteo aceita 600 pontos por minuto; cada região fica em 550 no máximo.
export const STEPS = [0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.75, 1, 1.25, 1.5];
export const MAX_POINTS = 550;

/** Menor passo da lista (a partir de `from`) cuja grade tem no máximo MAX_POINTS pontos. `countAt(step)` conta os pontos. */
export function pickStep(countAt, from = STEPS[0]) {
  for (const step of STEPS) {
    if (step < from) continue;
    const nP = countAt(step);
    if (nP <= MAX_POINTS) return { step, nP };
  }
  throw new Error(`nenhum passo da lista dá ${MAX_POINTS} pontos ou menos`);
}
