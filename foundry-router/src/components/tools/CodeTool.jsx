import { useState } from 'react';
import { analyzeCode, CODE_SAMPLE } from '../../toolbox/codeAnalyzer.js';

const GRADE_COLOR = { A: 'var(--ok)', B: 'var(--ok)', C: 'var(--warn)', D: 'var(--orange)', F: 'var(--bad)' };

export default function CodeTool() {
  const [code, setCode] = useState('');
  const [res, setRes] = useState(null);
  return (
    <div>
      <textarea className="field code" rows={10} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste JavaScript…" spellCheck={false} aria-label="Code to analyze" />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={() => setRes(analyzeCode(code))} disabled={!code.trim()}>
          Analyze
        </button>
        <button
          className="btn"
          onClick={() => {
            setCode(CODE_SAMPLE);
            setRes(analyzeCode(CODE_SAMPLE));
          }}
        >
          Sample
        </button>
      </div>
      {res && (
        <>
          <div className="card row" style={{ marginTop: 12 }}>
            <div className="grade" style={{ color: GRADE_COLOR[res.grade], borderColor: GRADE_COLOR[res.grade] }}>
              {res.grade}
            </div>
            <div className="grow">
              <b>{res.score}/100</b> · {res.findings.length} finding(s) · {res.lines} lines
              <div className="faint">{res.mode === 'ast' ? 'Parsed with acorn (ECMAScript AST)' : `Pattern mode: ${res.parseError}`}</div>
            </div>
          </div>
          <h2>Findings</h2>
          <div className="list">
            {res.findings.map((f, i) => (
              <div key={i} className={`item finding ${f.severity}`}>
                <div className="row">
                  <b className="grow">{f.label}</b>
                  <span className="faint">L{f.line}</span>
                </div>
                <div className="faint mono">{f.detail}</div>
              </div>
            ))}
            {!res.findings.length && <div className="faint">Clean.</div>}
          </div>
          {res.outline.length > 0 && (
            <>
              <h2>AST map</h2>
              <div className="card mono">
                {res.outline.map((o, i) => (
                  <div key={i}>
                    <span className="faint">L{o.line} </span>
                    <span style={{ color: 'var(--accent-2)' }}>{o.kind}</span> {o.name}
                    {o.params !== undefined ? `(${o.params})` : ''}
                    {o.methods ? ` { ${o.methods.join(', ')} }` : ''}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
