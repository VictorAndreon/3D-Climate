// Navegação entre regiões. Nesta fase entrar num estado ou voltar ao Brasil é recarregar a página com outra ?uf=.
// regionSearch é puro (testável); createRegionNav mostra o controle "← Brasil" só dentro de um estado.

/** Query (sem "?") com `uf` e `mun` trocados e o resto preservado. Sem uf = Brasil (tira os dois). */
export function regionSearch(search, { uf = null, mun = null } = {}) {
  const p = new URLSearchParams(search);
  p.delete('uf'); p.delete('mun');
  if (uf) p.set('uf', uf);
  if (uf && mun) p.set('mun', mun);
  return p.toString();
}

/** Vai para a região (recarrega). Sem uf, volta ao Brasil. */
export function goToRegion(target, loc = location) {
  const q = regionSearch(loc.search, target);
  loc.assign(loc.pathname + (q ? `?${q}` : '') + loc.hash);
}

export function createRegionNav(el, { region, onBack = () => goToRegion({}) }) {
  el.hidden = region.kind !== 'uf';
  document.body.classList.toggle('in-uf', !el.hidden);       // no celular a busca cede espaço ao botão
  el.addEventListener('click', () => onBack());
  return { el };
}
