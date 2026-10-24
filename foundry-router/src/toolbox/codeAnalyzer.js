// Code Analyzer + AST mapper. Parses JavaScript with acorn (a real ECMAScript
// parser) and walks the tree: eval/new Function, innerHTML-family sinks,
// hard-coded secrets, console.log leftovers, awaits / JSON.parse outside
// try/catch, Math.random used for tokens. If parsing fails (TS/JSX/other
// languages) it falls back to line-based patterns and says so.
import { parse } from 'acorn';

export const RULES = {
  eval: { severity: 'critical', penalty: 25, label: 'eval / new Function / string timer (code injection)' },
  innerHTML: { severity: 'high', penalty: 15, label: 'innerHTML / outerHTML / document.write (XSS sink)' },
  secret: { severity: 'critical', penalty: 25, label: 'Hard-coded password / API key' },
  randomToken: { severity: 'high', penalty: 15, label: 'Math.random() for tokens/ids (use crypto.getRandomValues)' },
  unguardedAwait: { severity: 'medium', penalty: 6, label: 'await without try/catch' },
  unguardedParse: { severity: 'medium', penalty: 6, label: 'JSON.parse without try/catch' },
  consoleLog: { severity: 'low', penalty: 2, label: 'console.log left in code' },
};

const SECRET_NAME = /(pass(word)?|pwd|secret|api[_-]?key|token|auth|private[_-]?key)/i;
const SECRET_VALUE = /^(sk-[A-Za-z0-9-_]{16,}|gsk_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z-_]{20,}|xai-[A-Za-z0-9]{16,}|hf_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})$/;
const TOKEN_NAME = /(token|secret|nonce|salt|key|id|session|password|otp|uuid)/i;

function walk(node, visit, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, ancestors);
  ancestors.push(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, visit, ancestors));
    else if (v && typeof v.type === 'string') walk(v, visit, ancestors);
  }
  ancestors.pop();
}

const isFn = (n) => /Function/.test(n.type);
const insideTry = (ancestors) => {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (isFn(a)) return false;
    if (a.type === 'TryStatement') return true;
  }
  return false;
};
const memberName = (n) =>
  n?.type === 'MemberExpression' ? `${memberName(n.object)}.${n.computed ? '[]' : n.property.name}` : n?.type === 'Identifier' ? n.name : n?.type === 'ThisExpression' ? 'this' : '?';

function nearestBindingName(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === 'VariableDeclarator' && a.id.type === 'Identifier') return a.id.name;
    if (a.type === 'AssignmentExpression') return memberName(a.left);
    if (a.type === 'Property' && !a.computed) return a.key.name || a.key.value;
    if (a.type === 'ReturnStatement' || isFn(a)) {
      const fn = ancestors.slice(0, i + 1).reverse().find(isFn);
      return fn?.id?.name || '';
    }
  }
  return '';
}

function astFindings(ast) {
  const findings = [];
  const add = (rule, node, detail) => findings.push({ rule, ...RULES[rule], line: node.loc.start.line, detail });
  walk(ast, (node, anc) => {
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = memberName(node.callee);
      if (callee === 'eval' || callee === 'window.eval' || (node.type === 'NewExpression' && callee === 'Function')) add('eval', node, callee);
      if ((callee === 'setTimeout' || callee === 'setInterval') && node.arguments[0]?.type === 'Literal' && typeof node.arguments[0].value === 'string')
        add('eval', node, `${callee}("string")`);
      if (/^document\.(write|writeln)$/.test(callee) || /\.insertAdjacentHTML$/.test(callee)) add('innerHTML', node, callee);
      if (/^console\.(log|debug)$/.test(callee)) add('consoleLog', node, callee);
      if (callee === 'JSON.parse' && !insideTry(anc)) add('unguardedParse', node, 'JSON.parse');
      if (callee === 'Math.random') {
        const name = nearestBindingName(anc);
        if (TOKEN_NAME.test(name)) add('randomToken', node, `${name} = Math.random()`);
      }
    }
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && !node.left.computed) {
      const prop = node.left.property.name;
      if (prop === 'innerHTML' || prop === 'outerHTML') add('innerHTML', node, `${memberName(node.left)} =`);
    }
    if (node.type === 'AwaitExpression' && !insideTry(anc)) add('unguardedAwait', node, 'await');
    const check = (nameNode, valueNode) => {
      const name = nameNode?.name || nameNode?.value;
      if (valueNode?.type !== 'Literal' || typeof valueNode.value !== 'string' || !valueNode.value) return;
      if (SECRET_VALUE.test(valueNode.value) || (typeof name === 'string' && SECRET_NAME.test(name) && valueNode.value.length >= 4))
        add('secret', valueNode, `${name || 'literal'} = "${valueNode.value.slice(0, 3)}…"`);
    };
    if (node.type === 'VariableDeclarator') check(node.id, node.init);
    if (node.type === 'Property') check(node.key, node.value);
    if (node.type === 'AssignmentExpression') check(node.left.property || node.left, node.right);
  });
  return findings;
}

const LINE_RULES = [
  ['eval', /\beval\s*\(|new\s+Function\s*\(/],
  ['innerHTML', /\.(inner|outer)HTML\s*=|document\.write/],
  ['secret', /(password|passwd|api[_-]?key|secret|token)\s*[:=]\s*['"][^'"]{4,}['"]/i],
  ['randomToken', /(token|secret|id|key|session)\w*\s*[:=].*Math\.random/i],
  ['consoleLog', /console\.log\s*\(/],
];

function lineFindings(code) {
  const out = [];
  code.split('\n').forEach((line, i) => {
    for (const [rule, re] of LINE_RULES) if (re.test(line)) out.push({ rule, ...RULES[rule], line: i + 1, detail: line.trim().slice(0, 80) });
  });
  return out;
}

/** AST map: imports, functions, classes, top-level bindings (the {AI} reconstruction viz). */
function outline(ast) {
  const items = [];
  for (const node of ast.body) {
    const decl = node.type.startsWith('Export') && node.declaration ? node.declaration : node;
    if (decl.type === 'ImportDeclaration') items.push({ kind: 'import', name: decl.source.value, line: decl.loc.start.line });
    else if (decl.type === 'FunctionDeclaration')
      items.push({ kind: decl.async ? 'async fn' : 'fn', name: decl.id?.name || 'default', params: decl.params.length, line: decl.loc.start.line });
    else if (decl.type === 'ClassDeclaration')
      items.push({ kind: 'class', name: decl.id?.name || 'default', methods: decl.body.body.filter((m) => m.type === 'MethodDefinition').map((m) => m.key.name || '#'), line: decl.loc.start.line });
    else if (decl.type === 'VariableDeclaration')
      for (const d of decl.declarations) {
        const fn = d.init && /Function/.test(d.init.type);
        items.push({ kind: fn ? (d.init.async ? 'async fn' : 'fn') : decl.kind, name: d.id.name || '{…}', line: d.loc.start.line });
      }
  }
  return items;
}

export function analyzeCode(code) {
  const src = String(code || '');
  let ast = null;
  let parseError = null;
  for (const sourceType of ['module', 'script']) {
    try {
      ast = parse(src, { ecmaVersion: 'latest', sourceType, locations: true, allowHashBang: true, allowAwaitOutsideFunction: true });
      break;
    } catch (err) {
      parseError = err.message;
    }
  }
  const findings = ast ? astFindings(ast) : lineFindings(src);
  let score = 100;
  const seen = new Map();
  for (const f of findings) {
    // Diminishing penalty for repeats of the same rule.
    const n = (seen.get(f.rule) || 0) + 1;
    seen.set(f.rule, n);
    score -= f.penalty / n;
  }
  score = Math.max(0, Math.round(score));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'F';
  return {
    mode: ast ? 'ast' : 'pattern',
    parseError: ast ? null : parseError,
    score,
    grade,
    findings: findings.sort((a, b) => a.line - b.line),
    outline: ast ? outline(ast) : [],
    lines: src.split('\n').length,
  };
}

// Deliberately vulnerable sample *text* for the analyzer to grade. It is only
// parsed by acorn and displayed in a <textarea>; it is never executed.
export const CODE_SAMPLE = `import { api } from './client.js';
const API_KEY = "gsk_live_1234567890abcdefXYZ";

export async function login(user) {
  const token = Math.random().toString(36).slice(2);
  const res = await fetch('/login', { method: 'POST', body: JSON.stringify(user) });
  const data = JSON.parse(await res.text());
  document.getElementById('out').innerHTML = data.message;
  console.log('logged in', token);
  return eval(data.next);
}
`;
