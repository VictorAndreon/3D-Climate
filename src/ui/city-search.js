// Busca de município por nome: campo de texto com lista de sugestões (combobox).
// Escolher um nome faz o mesmo que clicar nele no mapa. A parte de casar nomes é pura (searchCities).

/** Minúsculas e sem acento, para "sao jose" achar "São José". */
export const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Nomes que casam com a consulta, melhores primeiro: começa pelo texto, depois começo de palavra, depois em qualquer lugar.
 * Devolve [{ name, at }] (at = posição do trecho casado no nome), no máximo `limit`.
 */
export function searchCities(names, query, limit = 8) {
  const q = fold(query.trim());
  if (!q) return [];
  const out = [];
  for (const name of names) {
    const f = fold(name), at = f.indexOf(q);
    if (at < 0) continue;
    const word = at === 0 ? 0 : f.indexOf(' ' + q) >= 0 ? 1 : 2;
    out.push({ name, at: word === 1 ? f.indexOf(' ' + q) + 1 : at, rank: word });
  }
  out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'pt-BR'));
  return out.slice(0, limit).map(({ name, at }) => ({ name, at }));
}

export function createCitySearch(el, { names, onPick }) {
  el.innerHTML = `
    <input type="search" class="cs-input" placeholder="Buscar município…" autocomplete="off" autocapitalize="off" spellcheck="false"
      role="combobox" aria-label="Buscar município" aria-autocomplete="list" aria-expanded="false" aria-controls="cs-list">
    <ul class="cs-list" id="cs-list" role="listbox" aria-label="Municípios" hidden></ul>`;
  const input = el.querySelector('.cs-input'), list = el.querySelector('.cs-list');
  let results = [], active = -1;

  function render() {
    list.replaceChildren(...results.map((r, i) => {
      const li = document.createElement('li'), n = fold(input.value.trim()).length;
      li.id = `cs-opt-${i}`; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === active));
      // nomes em português: tirar o acento não muda o comprimento, então a posição vale no nome original
      li.append(r.name.slice(0, r.at), Object.assign(document.createElement('b'), { textContent: r.name.slice(r.at, r.at + n) }), r.name.slice(r.at + n));
      return li;
    }));
    const open = results.length > 0;
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (active >= 0) input.setAttribute('aria-activedescendant', `cs-opt-${active}`); else input.removeAttribute('aria-activedescendant');
  }
  function close() { results = []; active = -1; render(); }
  function pick(name) {
    input.value = name; close(); input.blur();              // tira o foco: WASD e espaço voltam para o mapa
    onPick(name);
  }

  input.addEventListener('input', () => { results = searchCities(names, input.value); active = results.length ? 0 : -1; render(); });
  input.addEventListener('focus', () => { input.select(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
      render(); list.children[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (active >= 0) { e.preventDefault(); pick(results[active].name); }
    } else if (e.key === 'Escape') {
      // primeiro Esc fecha a lista; o município aberto só fecha no seguinte
      if (results.length) { e.stopPropagation(); close(); } else input.blur();
    }
  });
  // pointerdown (e não click): escolhe antes de o campo perder o foco e a lista fechar
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li');
    if (li) { e.preventDefault(); pick(results[[...list.children].indexOf(li)].name); }
  });
  input.addEventListener('blur', () => close());
  // "/" leva o foco para a busca
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault(); input.focus();
  });
  el.hidden = false;

  return { setValue(name) { input.value = name; close(); } };
}
