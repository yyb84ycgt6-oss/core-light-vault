// Mirror Law: every symbol has a mirror that undoes it; symbol + mirror = 0.
// mirror(s) = the sequence read backwards with each glyph reflected
// (q<->p, d<->b, [<->], {<->}, (<->), /<->\, <<->>). It is an involution, so
// mirror(mirror(s)) = s. Self-mirroring symbols (}0{, -_0_-, •8•) are
// equilibria. reduce() cancels any token followed by its mirror, so a
// sequence followed by its mirror always returns to 0: no garbage collection.

const PAIRS = { q: 'p', p: 'q', d: 'b', b: 'd', '[': ']', ']': '[', '{': '}', '}': '{', '(': ')', ')': '(', '/': '\\', '\\': '/', '<': '>', '>': '<' };

export const mirrorGlyph = (c) => PAIRS[c] ?? c;
export const mirror = (s) => Array.from(s).reverse().map(mirrorGlyph).join('');
export const isEquilibrium = (s) => mirror(s) === s;

/** Mirror of a whole token sequence: reversed order, each token mirrored. */
export const mirrorSeq = (tokens) => tokens.slice().reverse().map(mirror);

/** Cancel adjacent token/mirror pairs (stack reduction). [] means 0. */
export function reduce(tokens) {
  const stack = [];
  for (const t of tokens) {
    if (stack.length && stack[stack.length - 1] === mirror(t)) stack.pop();
    else stack.push(t);
  }
  return stack;
}

export const ZERO = '0';
export const show = (tokens) => (tokens.length ? tokens.join(' ') : ZERO);
