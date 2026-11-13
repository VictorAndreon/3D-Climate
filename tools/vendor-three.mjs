// Copia o Three.js fixado do node_modules para vendor/three (roda uma vez; saída commitada).
import { cpSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
const src = 'node_modules/three', dst = 'vendor/three';
rmSync(dst, { recursive: true, force: true });
mkdirSync(`${dst}/build`, { recursive: true });
mkdirSync(`${dst}/examples/jsm/controls`, { recursive: true });
for (const f of ['build/three.module.js', 'build/three.core.js', 'examples/jsm/controls/OrbitControls.js', 'LICENSE']) {
  if (existsSync(`${src}/${f}`)) cpSync(`${src}/${f}`, `${dst}/${f}`);
}
const v = JSON.parse(readFileSync(`${src}/package.json`, 'utf8')).version;
console.log(`three ${v} -> ${dst}`);
