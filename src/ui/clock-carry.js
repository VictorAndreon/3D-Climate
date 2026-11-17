// Leva o instante da linha do tempo de uma série para outra (troca de região): o mesmo instante absoluto,
// que em outra série cai noutra hora fracionária. Puro; as séries são horárias a partir de times[0].

/**
 * from = { t, times }: hora fracionária na série atual e os timestamps (s) dela. nextTimes: timestamps da série nova.
 * Devolve a hora fracionária em nextTimes do mesmo instante, limitada a [tNow, tMax]; t inválido vai para tNow.
 */
export function carryTime({ t, times }, nextTimes, { tNow, tMax }) {
  const unix = times[0] + t * 3600;
  const next = (unix - nextTimes[0]) / 3600;
  if (!Number.isFinite(next)) return tNow;
  return Math.min(Math.max(next, tNow), tMax);
}
