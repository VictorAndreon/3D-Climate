// Series: séries horárias por ponto de grade, em typed arrays. Índice [p * nT + h].
export function createSeries(nP, nT, startUnix = 0) {
  const times = new Float64Array(nT);
  for (let h = 0; h < nT; h++) times[h] = startUnix + h * 3600;
  const n = nP * nT;
  return {
    nP, nT, times,
    low: new Uint8Array(n), mid: new Uint8Array(n), high: new Uint8Array(n), code: new Uint8Array(n),   // cobertura 0–100; weather_code
    precip: new Float32Array(n), windSpeed: new Float32Array(n), windDir: new Float32Array(n),          // mm, km/h, graus (de onde vem)
  };
}
export const SERIES_FIELDS = ['low', 'mid', 'high', 'code', 'precip', 'windSpeed', 'windDir'];
