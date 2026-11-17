// Configuração do menu de debug <-> query string. Módulo puro.
// A URL é o estado inicial; o menu reescreve a URL a cada ajuste, preservando o que não conhece (cam, t, look…).
export const DEFAULTS = { debug: false, nuvens: 'solidas', relevo: false, exagero: 12, grade: false, qualidade: 'auto', dados: 'live', uf: 'RS', mun: null };
export const EXAGERO = { min: 1, max: 40, step: 1 };
const NUVENS = ['solidas', 'volume', 'sprite'], QUALIDADE = ['auto', 'alto', 'medio', 'baixo'];
const KNOWN = ['debug', 'nuvens', 'relevo', 'exagero', 'grade', 'qualidade', 'demo', 'fixture', 'uf', 'mun'];

/**
 * ufs: siglas aceitas em ?uf= (vazio = nenhuma, cai no padrão); defaultUf: região de quando a URL não diz.
 * mun: código IBGE do município a abrir selecionado (só texto; quem usa decide se existe).
 */
export function parseConfig(search, { ufs = [], defaultUf = DEFAULTS.uf } = {}) {
  const p = new URLSearchParams(search);
  const asked = (p.get('uf') ?? '').toUpperCase();
  const uf = ufs.includes(asked) ? asked : defaultUf;
  const debug = p.get('debug') === '1';
  const ex = Number(p.get('exagero'));
  return {
    debug,
    nuvens: NUVENS.includes(p.get('nuvens')) ? p.get('nuvens') : DEFAULTS.nuvens,
    relevo: p.get('relevo') === '1',
    exagero: ex ? Math.min(Math.max(ex, EXAGERO.min), EXAGERO.max) : DEFAULTS.exagero,   // 0 e NaN: padrão
    grade: p.has('grade') ? p.get('grade') === '1' : debug,                              // debug=1 liga a grade
    qualidade: QUALIDADE.includes(p.get('qualidade')) ? p.get('qualidade') : DEFAULTS.qualidade,
    dados: p.get('demo') === '1' ? 'demo' : p.get('fixture') === '1' && uf === 'RS' ? 'fixture' : 'live',   // a fixture é gravada só do RS
    uf,
    mun: p.get('mun') || null,
  };
}

/** Query (sem "?") com os parâmetros desconhecidos preservados e os do menu regravados, omitindo os padrões. `mun` nunca é gravado. */
export function writeConfig(search, cfg, { defaultUf = DEFAULTS.uf } = {}) {
  const p = new URLSearchParams(search);
  for (const k of KNOWN) p.delete(k);
  if (cfg.debug) p.set('debug', '1');
  if (cfg.nuvens !== DEFAULTS.nuvens) p.set('nuvens', cfg.nuvens);
  if (cfg.relevo) { p.set('relevo', '1'); if (cfg.exagero !== DEFAULTS.exagero) p.set('exagero', String(cfg.exagero)); }
  if (cfg.grade !== cfg.debug) p.set('grade', cfg.grade ? '1' : '0');
  if (cfg.qualidade !== DEFAULTS.qualidade) p.set('qualidade', cfg.qualidade);
  if (cfg.uf && cfg.uf !== defaultUf) p.set('uf', cfg.uf);
  if (cfg.dados !== 'live') p.set(cfg.dados, '1');
  return p.toString();
}
