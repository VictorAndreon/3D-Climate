// Baixa a altitude do RS (AWS Terrain Tiles, formato Terrarium), reduz para uma grade lon/lat
// e grava assets/relief.bin.gz. Roda uma vez; saída commitada. Spike do relevo (?relevo=1).
//
// Formato (antes do gzip): 'RSR1', uint32 w, uint32 h, float32 lon0, latN, lon1, latS, 4 bytes livres,
// depois w*h uint16 LE em metros (linhas de norte para sul, mar e lagoas zerados).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync, gzipSync } from 'node:zlib';

const OUT = 'assets/relief.bin.gz';
const Z = 8;
const W = 512;
const PAD = 0.1;
const TILE = (x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;

const geo = JSON.parse(readFileSync('assets/rs.json', 'utf8'));
let lon0 = Infinity, lon1 = -Infinity, latS = Infinity, latN = -Infinity;
for (const [outer] of geo.outline) for (let i = 0; i < outer.length; i += 2) {
  lon0 = Math.min(lon0, outer[i]); lon1 = Math.max(lon1, outer[i]);
  latS = Math.min(latS, outer[i + 1]); latN = Math.max(latN, outer[i + 1]);
}
lon0 -= PAD; lon1 += PAD; latS -= PAD; latN += PAD;
// mesma proporção da projeção da cena (longitude encolhida por cos(lat0))
const H = Math.round(W * (latN - latS) / ((lon1 - lon0) * Math.cos((-30.4 * Math.PI) / 180)));

// --- PNG mínimo: RGB 8 bits, sem entrelaçamento (é o que o Terrarium entrega) ---
function decodePng(buf) {
  let off = 8, w = 0, h = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) throw new Error('PNG fora do formato esperado (RGB 8 bits)');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), bpp = 3, stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0, b = y ? out[dst - stride + i] : 0, c = i >= bpp && y ? out[dst - stride + i - bpp] : 0;
      let v = raw[src + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + i] = v & 255;
    }
  }
  return { w, h, rgb: out };
}

// --- tiles (Web Mercator) ---
const n = 2 ** Z;
const tx = (lon) => ((lon + 180) / 360) * n;
const ty = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n; };
const x0 = Math.floor(tx(lon0)), x1 = Math.floor(tx(lon1)), y0 = Math.floor(ty(latN)), y1 = Math.floor(ty(latS));
const dir = mkdtempSync(join(tmpdir(), 'rs-relief-'));       // diretório vazio só para os tiles baixados
const tiles = new Map();
for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
  const file = join(dir, `${x}-${y}.png`);
  if (!existsSync(file)) execFileSync('curl', ['-sSfL', '--max-time', '60', '-o', file, TILE(x, y)]);
  tiles.set(`${x}/${y}`, decodePng(readFileSync(file)));
}
console.log(`${tiles.size} tiles z${Z} (${x0}..${x1} × ${y0}..${y1})`);

function metersAt(lon, lat) {
  const gx = tx(lon) * 256, gy = ty(lat) * 256;
  const t = tiles.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`);
  if (!t) return 0;
  const i = ((Math.floor(gy) % 256) * 256 + (Math.floor(gx) % 256)) * 3;
  return t.rgb[i] * 256 + t.rgb[i + 1] + t.rgb[i + 2] / 256 - 32768;
}

// média de 4×4 amostras por pixel de saída (cada um cobre ~3 pixels do tile)
const SUB = 4, data = new Uint16Array(W * H);
let max = 0;
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  let s = 0;
  for (let b = 0; b < SUB; b++) for (let a = 0; a < SUB; a++) {
    const lon = lon0 + ((i + (a + 0.5) / SUB) / W) * (lon1 - lon0);
    const lat = latN - ((j + (b + 0.5) / SUB) / H) * (latN - latS);
    s += Math.max(0, metersAt(lon, lat));                  // batimetria (mar, Lagoa dos Patos) vira nível do mar
  }
  const m = Math.round(s / (SUB * SUB));
  data[j * W + i] = m; max = Math.max(max, m);
}

const head = Buffer.alloc(32);
head.write('RSR1', 0, 'ascii'); head.writeUInt32LE(W, 4); head.writeUInt32LE(H, 8);
[lon0, latN, lon1, latS].forEach((v, k) => head.writeFloatLE(v, 12 + 4 * k));
writeFileSync(OUT, gzipSync(Buffer.concat([head, Buffer.from(data.buffer)]), { level: 9 }));
console.log(`${OUT}: ${statSync(OUT).size} bytes, ${W}×${H}, máx ${max} m`);
