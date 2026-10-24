// Code Visualizer (eYe Visualizer): parse with acorn, find the AST path under
// the cursor, route to the matching view (loop / call / function / class /
// expression), and fold every top-level region that is not on the path, so
// only what matters right now stays open.
import { parse } from 'acorn';

function walk(node, visit, parents = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parents);
  const next = [...parents, node];
  for (const k of Object.keys(node)) {
    if (k === 'start' || k === 'end' || k === 'loc') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit, next));
    else if (v && typeof v.type === 'string') walk(v, visit, next);
  }
}

const label = (n) =>
  n.id?.name || n.key?.name || (n.callee && (n.callee.name || n.callee.property?.name)) || n.declarations?.[0]?.id?.name || n.name || '';

export function viewFor(node) {
  if (!node) return 'overview';
  if (/(For|While|DoWhile)/.test(node.type)) return 'iteration';
  if (/Call|New/.test(node.type)) return 'call-chain';
  if (/Function/.test(node.type)) return 'function';
  if (/Class/.test(node.type)) return 'class';
  if (/If|Conditional|Switch/.test(node.type)) return 'branch';
  return 'expression';
}

/** @returns {{ok:boolean, path:{type,name,line}[], view:string, folded:string, error?:string}} */
export function visualize(code, cursor = 0) {
  let ast;
  try {
    ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  } catch (e) {
    return { ok: false, path: [], view: 'overview', folded: code, error: e.message };
  }
  let deepest = null;
  let chain = [];
  walk(ast, (n, parents) => {
    if (n.start <= cursor && cursor <= n.end && n.type !== 'Program') {
      deepest = n;
      chain = [...parents.filter((p) => p.type !== 'Program'), n];
    }
  });
  const path = chain.map((n) => ({ type: n.type, name: label(n), line: n.loc.start.line }));
  // Fold top-level statements that do not contain the cursor.
  const lines = code.split('\n');
  const keep = new Set();
  const folds = [];
  for (const stmt of ast.body) {
    const on = stmt.start <= cursor && cursor <= stmt.end;
    const { start, end } = stmt.loc;
    if (on || end.line - start.line < 2) for (let l = start.line; l <= end.line; l++) keep.add(l);
    else folds.push({ from: start.line, to: end.line, name: label(stmt.declaration || stmt) || stmt.type });
  }
  const out = [];
  for (let l = 1; l <= lines.length; l++) {
    const f = folds.find((x) => x.from === l);
    if (f) {
      out.push(`${lines[l - 1].replace(/\{\s*$/, '').trimEnd()} { ⋯ folded ${f.to - f.from + 1} lines }`);
      l = f.to;
    } else if (keep.has(l) || !lines[l - 1].trim()) out.push(lines[l - 1]);
  }
  // Route on the nearest meaningful ancestor: a cursor on `log` in `log(x)` means the call.
  const focus = [...chain].reverse().find((n) => viewFor(n) !== 'expression') || deepest;
  return { ok: true, path, view: viewFor(focus), focusLine: focus?.loc.start.line ?? null, folded: out.join('\n'), folds: folds.length };
}
