// Grade regular de 0,25° mascarada (só os nós presentes em `cells`).
export function makeGrid({ lon0, lat0, step, nx, ny, cells }) {
  const nP = cells.length;
  const lons = new Float32Array(nP), lats = new Float32Array(nP);
  const index = new Int32Array(nx * ny).fill(-1);
  for (let p = 0; p < nP; p++) {
    const c = cells[p], i = c % nx, j = (c - i) / nx;
    lons[p] = lon0 + i * step;
    lats[p] = lat0 + j * step;
    index[c] = p;
  }
  function brute(lon, lat) {
    let best = 0, bd = Infinity;
    for (let p = 0; p < nP; p++) {
      const dx = lons[p] - lon, dy = lats[p] - lat, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  /** Nó mais próximo (dono da célula). Nunca devolve -1. */
  function nearest(lon, lat) {
    const i = Math.round((lon - lon0) / step), j = Math.round((lat - lat0) / step);
    if (i >= 0 && i < nx && j >= 0 && j < ny) {
      const p = index[j * nx + i];
      if (p >= 0) return p;
    }
    return brute(lon, lat);
  }
  /** Distância ao nó mais próximo, em células. */
  function distCells(lon, lat) {
    const p = nearest(lon, lat);
    return Math.hypot(lons[p] - lon, lats[p] - lat) / step;
  }
  return { lon0, lat0, step, nx, ny, nP, lons, lats, index, nearest, distCells };
}
