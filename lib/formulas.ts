// Mathematical formulas written as text: "E = mc²", "$a^2 + b^2 = c^2$",
// "x = (-b ± √(b² − 4ac)) / 2a   (1)". Recognized so that the automatic
// formatting sets them apart, and read aloud in words.

export const FORMULA_FONT = '"Cambria Math", "STIX Two Math", "Latin Modern Math", "Times New Roman", serif';
const LATEX = /\\(?:frac|dfrac|sqrt|sum|prod|int|oint|lim|infty|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|omega|phi|cdot|times|leq?|geq?|neq|approx|pm|partial|nabla|vec|hat|bar|log|ln|sin|cos|tan|left|right|mathrm|mathbf|text)\b/;
const DELIMITED = /^(?:\$\$[\s\S]+\$\$|\$[^$]+\$|\\\[[\s\S]+\\\]|\\\([\s\S]+\\\))\s*(?:\(\s*[\d.]+[a-z]?\s*\))?$/u;
const RELATION = /[=≠≤≥≈≡∝<>→⇒⇔↔∈∉⊂⊆∀∃]|:=/u;
const SYMBOL = /[∑∏∫∮√∞±∓×÷·∂∆∇πθλμσωαβγδε²³⁴ⁿ₀₁₂₃₄₅₆₇₈₉^_]/u;
const NUMBER = /\(\s*\d+(?:[.,]\d+)*[a-z]?\s*\)\s*$/u;

// A line made (almost) only of mathematics: few real words, a relation or math symbols.
export function isFormulaText(raw: string): boolean {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 220) return false;
  if (DELIMITED.test(text)) return true;
  const body = text.replace(NUMBER, '').trim();
  if (!body || !(RELATION.test(body) || SYMBOL.test(body)) || !/[\p{L}\p{N}]/u.test(body)) return false;
  if (/[.!?…]\s*$/.test(body.replace(/\.\.\.$/, '')) && !/\d\.$/.test(body)) return false;
  const words = body.match(/\p{L}{4,}/gu) || [], known = words.filter(w => !/^(?:sin|cos|tan|cot|log|exp|lim|max|min|sinh|cosh|tanh|arcsin|arccos|arctan|frac|sqrt|cdot|times|alpha|beta|gamma|delta|theta|lambda|sigma|omega|infty)$/i.test(w));
  if (LATEX.test(body)) return known.length <= 3;
  const letters = known.join('').length, solid = body.replace(/\s/g, '').length;
  return known.length <= 3 && letters / solid < 0.35 && /[\p{L}\p{N}]\s*(?:[=≠≤≥≈≡∝<>→⇒⇔]|:=)\s*[-−+(√\p{L}\p{N}]|[∑∏∫√∂∇]/u.test(body);
}

const GREEK: Record<string, string> = { α: 'alfa', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', θ: 'theta', λ: 'lambda', μ: 'mi', π: 'pi greco', σ: 'sigma', ω: 'omega', φ: 'fi', ρ: 'ro', τ: 'tau', Δ: 'delta', Σ: 'sigma', Ω: 'omega', Φ: 'fi' };
type Replacement = [RegExp, string | ((match: string) => string)];
const SAFE: Replacement[] = [
  [/²/g, ' al quadrato '], [/³/g, ' al cubo '], [/⁴/g, ' alla quarta '], [/ⁿ/g, ' alla n '],
  [/√\s*\(/g, ' radice quadrata di ( '], [/√/g, ' radice quadrata di '], [/∛/g, ' radice cubica di '],
  [/≠/g, ' diverso da '], [/≤/g, ' minore o uguale a '], [/≥/g, ' maggiore o uguale a '], [/≈/g, ' circa uguale a '], [/≡/g, ' equivalente a '], [/∝/g, ' proporzionale a '],
  [/±/g, ' più o meno '], [/∓/g, ' meno o più '], [/×/g, ' per '], [/÷/g, ' diviso '], [/∞/g, ' infinito '],
  [/∑/g, ' sommatoria di '], [/∏/g, ' produttoria di '], [/∫/g, ' integrale di '], [/∂/g, ' derivata parziale di '], [/∇/g, ' nabla '],
  [/⇒/g, ' implica '], [/⇔/g, ' se e solo se '], [/→/g, ' tende a '], [/∈/g, ' appartiene a '], [/∉/g, ' non appartiene a '], [/∀/g, ' per ogni '], [/∃/g, ' esiste '],
  [/[₀-₉]/g, c => ' con indice ' + (c.charCodeAt(0) - 0x2080) + ' '],
  [/[αβγδεθλμπσωφρτΔΣΩΦ]/g, c => ' ' + GREEK[c] + ' '],
];
const replaceAll = (t: string, [re, word]: Replacement) => typeof word === 'string' ? t.replace(re, word) : t.replace(re, word);
const COMMANDS: Record<string, string> = { cdot: ' per ', times: ' per ', div: ' diviso ', pm: ' più o meno ', leq: ' minore o uguale a ', le: ' minore o uguale a ', geq: ' maggiore o uguale a ', ge: ' maggiore o uguale a ', neq: ' diverso da ', approx: ' circa uguale a ', infty: ' infinito ', sum: ' sommatoria di ', prod: ' produttoria di ', int: ' integrale di ', lim: ' limite ', to: ' tende a ', partial: ' derivata parziale di ', sin: ' seno di ', cos: ' coseno di ', tan: ' tangente di ', log: ' logaritmo di ', ln: ' logaritmo naturale di ', alpha: ' alfa ', beta: ' beta ', gamma: ' gamma ', delta: ' delta ', epsilon: ' epsilon ', theta: ' theta ', lambda: ' lambda ', mu: ' mi ', pi: ' pi greco ', sigma: ' sigma ', omega: ' omega ', phi: ' fi ', rho: ' ro ', tau: ' tau ', Delta: ' delta ', Sigma: ' sigma ', Omega: ' omega ' };
const POWERS: Record<string, string> = { '2': 'al quadrato', '3': 'al cubo', '4': 'alla quarta', n: 'alla n', '-1': 'alla meno uno' };
const FUNCTIONS = /^(?:sin|cos|tan|log|ln|exp|lim|max|min)$/;

// Full reading of a formula: operators, powers, fractions, LaTeX commands.
export function speakFormula(raw: string): string {
  let t = raw.trim().replace(/^\$\$?|\$\$?$/g, '').replace(/^\\\[|\\\]$|^\\\(|\\\)$/g, '');
  t = t.replace(NUMBER, m => ' (formula ' + m.replace(/[()\s]/g, '') + ')');
  for (let i = 0; i < 4; i++) {
    t = t.replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, ' $1 fratto $2 ')
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, ' radice $1-esima di $2 ').replace(/\\sqrt\s*\{([^{}]*)\}/g, ' radice quadrata di $1 ')
      .replace(/\^\s*\{([^{}]*)\}/g, (_m, e: string) => ' ' + (POWERS[e.trim()] || 'elevato alla ' + e) + ' ')
      .replace(/_\s*\{([^{}]*)\}/g, ' con indice $1 ');
  }
  t = t.replace(/\\(?:left|right|mathrm|mathbf|text|displaystyle|,|;|!|quad)/g, ' ').replace(/\\([A-Za-z]+)/g, (_m, c: string) => COMMANDS[c] ?? ' ' + c + ' ');
  t = t.replace(/\^\s*(-?\w)/g, (_m, e: string) => ' ' + (POWERS[e] || 'elevato alla ' + e) + ' ').replace(/_\s*(\w)/g, ' con indice $1 ');
  for (const rule of SAFE) t = replaceAll(t, rule);
  t = t.replace(/:=/g, ' è definito come ').replace(/\s*=\s*/g, ' uguale a ').replace(/\s*<\s*/g, ' minore di ').replace(/\s*>\s*/g, ' maggiore di ')
    .replace(/(\S)\s*\/\s*(\S)/g, '$1 fratto $2').replace(/\s*[·*]\s*/g, ' per ').replace(/\s*\+\s*/g, ' più ').replace(/(^|[\s(])[-−]\s*/g, '$1 meno ').replace(/(\S)\s*[-−]\s*(\S)/g, '$1 meno $2')
    .replace(/[{}]/g, ' ').replace(/\(/g, ' aperta parentesi ').replace(/\)/g, ' chiusa parentesi ');
  // Products of single-letter variables are spelled ("mc" → "m c"), function names kept.
  t = t.replace(/(\d)([a-z])/g, '$1 $2').replace(/(?<!\p{L})[a-z]{2,3}(?!\p{L})/gu, w => FUNCTIONS.test(w) || /^(?:di|da|a|al|alla|per|più|con|meno)$/.test(w) ? w : w.split('').join(' '));
  return t.replace(/aperta parentesi\s+(formula [^\s]+)\s+chiusa parentesi/g, ', $1').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
}

// Prose with formulas inside: delimited math and standalone formulas are read
// in full; elsewhere only unambiguous symbols are spoken.
export function speakableText(text: string): string {
  if (isFormulaText(text)) return speakFormula(text);
  let t = text.replace(/\$\$([^$]+)\$\$|\$([^$]+)\$|\\\(([\s\S]+?)\\\)/g, (_m, a, b, c) => ' ' + speakFormula(a || b || c) + ' ');
  // An equation inside a sentence: "dove F = m · a e ..." (operands short, around "=").
  t = t.replace(/(?<![\p{L}\p{N}])((?:[\p{L}\p{N}²³()√.,]{1,8}\s*[-−+·×*/^]\s*)*[\p{L}\p{N}²³()√]{1,8}\s*[=≠≤≥≈]\s*[-−]?[\p{L}\p{N}²³()√.,]{1,10}(?:\s*[-−+·×*/^]\s*[\p{L}\p{N}²³()√.,]{1,10})*)(?![\p{L}\p{N}])/gu, m => speakFormula(m));
  for (const rule of SAFE) t = replaceAll(t, rule);
  t = t.replace(/(\S)\s+=\s+(\S)/g, '$1 uguale a $2');
  return t.replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
}
