// PROTÓTIPO (?nuvens=volume). Ruído 3D que se repete sem emenda, para o raymarching das nuvens.
// Saída: Uint8Array com 2 canais por voxel:
//   R = forma (bolhas grandes tipo couve-flor: Worley invertido + ruído de valor)
//   G = detalhe (Worley fino, usado para desfiar a borda)
// Os dois canais saem com histograma equalizado: a fração de voxels acima de um limiar L é 1 - L.
import { mulberry32 } from '../util/rng.js';

function addWorley(out, N, F, weight, rnd) {
  const pts = new Float32Array(F * F * F * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rnd();
  const k = F / N;
  let o = 0;
  for (let z = 0; z < N; z++) {
    const pz = (z + 0.5) * k, cz = Math.floor(pz);
    for (let y = 0; y < N; y++) {
      const py = (y + 0.5) * k, cy = Math.floor(py);
      for (let x = 0; x < N; x++, o++) {
        const px = (x + 0.5) * k, cx = Math.floor(px);
        let best = 9;
        for (let dz = -1; dz <= 1; dz++) {
          const gz = cz + dz, wz = (gz + F) % F;
          for (let dy = -1; dy <= 1; dy++) {
            const gy = cy + dy, wy = (gy + F) % F;
            for (let dx = -1; dx <= 1; dx++) {
              const gx = cx + dx, wx = (gx + F) % F, q = ((wz * F + wy) * F + wx) * 3;
              const ex = gx + pts[q] - px, ey = gy + pts[q + 1] - py, ez = gz + pts[q + 2] - pz;
              const d = ex * ex + ey * ey + ez * ez;
              if (d < best) best = d;
            }
          }
        }
        out[o] += weight * (1 - Math.min(Math.sqrt(best), 1));       // 1 no centro da bolha
      }
    }
  }
}

function addValue(out, N, F, weight, rnd) {
  const lat = new Float32Array(F * F * F);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const k = F / N, s = (t) => t * t * (3 - 2 * t);
  let o = 0;
  for (let z = 0; z < N; z++) {
    const pz = z * k, z0 = Math.floor(pz), fz = s(pz - z0), z1 = (z0 + 1) % F;
    for (let y = 0; y < N; y++) {
      const py = y * k, y0 = Math.floor(py), fy = s(py - y0), y1 = (y0 + 1) % F;
      for (let x = 0; x < N; x++, o++) {
        const px = x * k, x0 = Math.floor(px), fx = s(px - x0), x1 = (x0 + 1) % F;
        const at = (a, b, c) => lat[(c * F + b) * F + a];
        const a = at(x0, y0, z0) + (at(x1, y0, z0) - at(x0, y0, z0)) * fx, b = at(x0, y1, z0) + (at(x1, y1, z0) - at(x0, y1, z0)) * fx;
        const c = at(x0, y0, z1) + (at(x1, y0, z1) - at(x0, y0, z1)) * fx, d = at(x0, y1, z1) + (at(x1, y1, z1) - at(x0, y1, z1)) * fx;
        const ab = a + (b - a) * fy, cd = c + (d - c) * fy;
        out[o] += weight * (ab + (cd - ab) * fz);
      }
    }
  }
}

/** Equaliza: devolve em bytes o posto (percentil) de cada valor. */
function equalize(src, dst, offset, stride) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < src.length; i++) { if (src[i] < lo) lo = src[i]; if (src[i] > hi) hi = src[i]; }
  const BINS = 4096, hist = new Float64Array(BINS), k = (BINS - 1) / (hi - lo || 1);
  for (let i = 0; i < src.length; i++) hist[Math.floor((src[i] - lo) * k)]++;
  let acc = 0;
  for (let i = 0; i < BINS; i++) { acc += hist[i]; hist[i] = acc / src.length; }
  for (let i = 0; i < src.length; i++) dst[i * stride + offset] = Math.round(hist[Math.floor((src[i] - lo) * k)] * 255);
}

export function makeCloudNoise(N = 64, seed = 7) {
  const rnd = mulberry32(seed), n = N * N * N;
  const shape = new Float32Array(n), detail = new Float32Array(n);
  addWorley(shape, N, 3, 0.5, rnd); addWorley(shape, N, 6, 0.27, rnd); addWorley(shape, N, 12, 0.13, rnd);
  addValue(shape, N, 4, 0.22, rnd); addValue(shape, N, 8, 0.1, rnd);
  addWorley(detail, N, 5, 0.5, rnd); addWorley(detail, N, 10, 0.3, rnd); addWorley(detail, N, 20, 0.2, rnd);
  const data = new Uint8Array(n * 2);
  equalize(shape, data, 0, 2); equalize(detail, data, 1, 2);
  return { size: N, data };
}
