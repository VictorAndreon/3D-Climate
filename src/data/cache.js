// Cache em IndexedDB: um registro por gridVersion, valores em typed arrays. Nunca rejeita:
// qualquer erro (aba privada, cota, esquema antigo) vira null / no-op.
import { SERIES_FIELDS } from './series.js';

const DB = 'rs-tempo-3d', STORE = 'forecast', SCHEMA = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB bloqueado'));
  });
}
const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export async function loadCache(gridVersion) {
  try {
    const db = await open();
    const rec = await done(db.transaction(STORE, 'readonly').objectStore(STORE).get(gridVersion));
    db.close();
    if (!rec || rec.schema !== SCHEMA || rec.gridVersion !== gridVersion) return null;
    const { nP, nT, times } = rec, n = nP * nT;
    if (!(times instanceof Float64Array) || times.length !== nT) return null;
    const series = { nP, nT, times };
    for (const k of SERIES_FIELDS) { if (!rec[k] || rec[k].length !== n) return null; series[k] = rec[k]; }
    return { series, fetchedAt: rec.fetchedAt };
  } catch { return null; }
}

export async function saveCache(gridVersion, series, fetchedAt) {
  try {
    const db = await open();
    const rec = { schema: SCHEMA, gridVersion, fetchedAt, nP: series.nP, nT: series.nT, times: series.times };
    for (const k of SERIES_FIELDS) rec[k] = series[k];
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec, gridVersion);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
    db.close();
  } catch { /* sem cache */ }
}
