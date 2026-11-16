// Libera geometrias, materiais e texturas de um objeto e dos filhos (troca de mapa ou de nuvens no lugar).
function disposeMaterial(m) {
  for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
  for (const u of Object.values(m.uniforms ?? {})) if (u.value?.isTexture) u.value.dispose();
  m.dispose();
}
export function disposeObject(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material ?? [])) disposeMaterial(m);
  });
}
