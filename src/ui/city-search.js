// Busca de estado ou município por nome: campo de texto com lista de sugestões (combobox).
// Escolher um item faz o mesmo que clicar nele no mapa (ou navega para o estado). A parte de casar nomes é pura (searchPlaces).

/** Minúsculas e sem acento, para "sao jose" achar "São José". */
export const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const collator = new Intl.Collator('pt-BR');

/**
 * Lugares que casam com a consulta, melhores primeiro: estados antes de municípios; depois começa pelo texto,
 * começo de palavra, qualquer lugar; alfabética (rótulo, depois UF) no empate.
 * items: [{ label, sub, kind: 'uf'|'mun', uf, ibge?, key }] com key = fold(label). Devolve cópias com `at` (posição do trecho casado), no máximo `limit`.
 */
export function searchPlaces(items, query, limit = 8) {
  const q = fold(query.trim());
  if (!q) return [];
  const out = [];
  for (const item of items) {
    const at = item.key.indexOf(q);
    if (at < 0) continue;
    const word = at === 0 ? 0 : item.key.indexOf(' ' + q) >= 0 ? 1 : 2;
    out.push({ ...item, at: word === 1 ? item.key.indexOf(' ' + q) + 1 : at, rank: word });
  }
  const kind = (i) => (i.kind === 'uf' ? 0 : 1);
  out.sort((a, b) => kind(a) - kind(b) || a.rank - b.rank || collator.compare(a.label, b.label) || collator.compare(a.sub ?? '', b.sub ?? ''));
  return out.slice(0, limit).map(({ rank, ...item }) => item);
}

/** items: veja searchPlaces; onPick(item); onFirstFocus: chamado no primeiro foco (busca nacional baixa a lista aí); se devolver promessa que rejeita, o foco seguinte chama de novo.
 *  signal: ao abortar, os ouvintes (inclusive o "/" na janela) saem; o conteúdo de `el` fica para quem recria. */
export function createCitySearch(el, { items, onPick, placeholder = 'Buscar município…', onFirstFocus = null, signal }) {
  el.innerHTML = `
    <input type="search" class="cs-input" autocomplete="off" autocapitalize="off" spellcheck="false"
      role="combobox" aria-label="Buscar" aria-autocomplete="list" aria-expanded="false" aria-controls="cs-list">
    <ul class="cs-list" id="cs-list" role="listbox" aria-label="Resultados" hidden></ul>`;
  const input = el.querySelector('.cs-input'), list = el.querySelector('.cs-list');
  input.placeholder = placeholder;
  let results = [], active = -1;

  function render() {
    list.replaceChildren(...results.map((r, i) => {
      const li = document.createElement('li'), n = fold(input.value.trim()).length;
      li.id = `cs-opt-${i}`; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === active));
      // nomes em português: tirar o acento não muda o comprimento, então a posição vale no nome original
      li.append(r.label.slice(0, r.at), Object.assign(document.createElement('b'), { textContent: r.label.slice(r.at, r.at + n) }), r.label.slice(r.at + n));
      if (r.sub) li.append(Object.assign(document.createElement('small'), { className: 'cs-sub', textContent: r.sub }));
      return li;
    }));
    const open = results.length > 0;
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (active >= 0) input.setAttribute('aria-activedescendant', `cs-opt-${active}`); else input.removeAttribute('aria-activedescendant');
  }
  function close() { results = []; active = -1; render(); }
  function pick(item) {
    input.value = item.label; close(); input.blur();         // tira o foco: WASD e espaço voltam para o mapa
    onPick(item);
  }
  function search() { results = searchPlaces(items, input.value); active = results.length ? 0 : -1; render(); }

  input.addEventListener('input', search, { signal });
  let focused = false;
  // onFirstFocus pode devolver uma promessa; se ela rejeitar (download falhou), o próximo foco tenta de novo
  input.addEventListener('focus', () => { input.select(); if (!focused) { focused = true; Promise.resolve(onFirstFocus?.()).catch(() => { focused = false; }); } }, { signal });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
      render(); list.children[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (active >= 0) { e.preventDefault(); pick(results[active]); }
    } else if (e.key === 'Escape') {
      // primeiro Esc fecha a lista; o município aberto só fecha no seguinte
      if (results.length) { e.stopPropagation(); close(); } else input.blur();
    }
  }, { signal });
  // pointerdown (e não click): escolhe antes de o campo perder o foco e a lista fechar
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li');
    if (li) { e.preventDefault(); pick(results[[...list.children].indexOf(li)]); }
  }, { signal });
  input.addEventListener('blur', () => close(), { signal });
  // "/" leva o foco para a busca
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault(); input.focus();
  }, { signal });
  el.hidden = false;

  return {
    setValue(name) { input.value = name; close(); },
    /** Troca a lista (chegou a busca nacional); se já há texto digitado, refaz as sugestões. */
    setItems(next) { items = next; if (document.activeElement === input && input.value.trim()) search(); },
  };
}
