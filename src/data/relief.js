// Altitude do RS (assets/relief.bin.gz, gerado por tools/build-relief.mjs). Módulo puro.

/** buf: ArrayBuffer já descomprimido. */
export function parseRelief(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'RSR1') throw new Error(`relevo: formato desconhecido (${magic})`);
  const w = dv.getUint32(4, true), h = dv.getUint32(8, true);
  const lon0 = dv.getFloat32(12, true), latN = dv.getFloat32(16, true), lon1 = dv.getFloat32(20, true), latS = dv.getFloat32(24, true);
  const data = new Uint16Array(buf.slice(32, 32 + w * h * 2));
  let max = 0;
  for (const v of data) if (v > max) max = v;

  /** Metros em (lon, lat), bilinear; fora da grade usa a borda. */
  function metersAt(lon, lat) {
    const gx = Math.min(Math.max(((lon - lon0) / (lon1 - lon0)) * w - 0.5, 0), w - 1);
    const gy = Math.min(Math.max(((latN - lat) / (latN - latS)) * h - 0.5, 0), h - 1);
    const i = Math.min(Math.floor(gx), w - 2), j = Math.min(Math.floor(gy), h - 2), fx = gx - i, fy = gy - j;
    const a = data[j * w + i], b = data[j * w + i + 1], c = data[(j + 1) * w + i], d = data[(j + 1) * w + i + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  return { w, h, lon0, latN, lon1, latS, max, metersAt };
}

/** Busca e descomprime. Se o servidor já mandou descomprimido (Content-Encoding), usa direto. */
export async function loadRelief(url, fetchImpl = fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`relevo: HTTP ${res.status}`);
  let buf = await res.arrayBuffer();
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] === 0x1f && b[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return parseRelief(buf);
}
