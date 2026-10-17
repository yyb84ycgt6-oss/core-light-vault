import { useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext.js';
import { CHIPS, PROVIDERS, selectRouter, routeChat, metaBridgeEngine, providerById, listModels } from '../router.js';
import { webllmEngine, activeModel } from '../lib/webllm.js';
import { loadVault, saveVault, effectiveKeys, effectiveOverrides, toEnv, fromEnv, maskKey } from '../lib/vault.js';
import { jackySystemPrompt, domainById } from '../toolbox/knowledgeMatrix.js';

const DEFAULT_SYSTEM = 'You are Jacky, the Foundry Router assistant. Be concise, warm and practical.';

function traceLine(trace) {
  const parts = [];
  for (const e of trace) {
    if (e.type === 'skip') parts.push(`${e.provider} skip (${e.reason})`);
    else if (e.type === 'failover') parts.push(`${e.provider} ✗ ${e.kind || ''}`.trim());
    else if (e.type === 'retry') parts.push(`${e.provider} ↻ ${e.delayMs}ms`);
    else if (e.type === 'heal') parts.push(`${e.provider} heal → ${e.to}`);
    else if (e.type === 'done') parts.push(`${e.provider} ✓`);
  }
  return parts.join(' → ');
}

export default function RouterTab() {
  const { live, setLive, system, gates, notify, routerInfo, setRouterInfo, logEvent } = useApp();
  const [vault, setVault] = useState(loadVault);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(null);
  const [envText, setEnvText] = useState('');
  const [models, setModels] = useState({});
  const abortRef = useRef(null);
  const endRef = useRef(null);
  const composerRef = useRef(null);

  const chip = CHIPS.find((c) => c.id === routerInfo.chipId) || CHIPS[1];
  const plan = selectRouter({ system, chip });
  const keys = effectiveKeys(vault);
  const lens = domainById(live.jacky.selectedDomain);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [live.chat.length, streaming?.text]);

  useEffect(() => {
    const focus = () => composerRef.current?.focus();
    window.addEventListener('foundry:focus-composer', focus);
    return () => window.removeEventListener('foundry:focus-composer', focus);
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    const userMsg = { role: 'user', content: text, providerBadge: '', ts: Date.now() };
    const history = [...live.chat, userMsg];
    setLive((s) => ({ ...s, chat: [...s.chat, userMsg] }));
    const messages = [
      { role: 'system', content: jackySystemPrompt(live.jacky.selectedDomain) || DEFAULT_SYSTEM },
      ...history.filter((m) => m.role !== 'system').slice(-20).map(({ role, content }) => ({ role, content })),
    ];
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const trace = [];
    let acc = '';
    let badge = '';
    setStreaming({ text: '', badge: '', trace: [], progress: '' });
    const finish = (content, providerBadge) => setLive((s) => ({ ...s, chat: [...s.chat, { role: 'assistant', content, providerBadge, ts: Date.now() }] }));
    try {
      for await (const d of routeChat({
        messages,
        plan,
        keys,
        overrides: effectiveOverrides(vault),
        signal: ctrl.signal,
        localEngines: { webllm: webllmEngine, meta: metaBridgeEngine },
        onEvent: (e) => {
          if (e.type !== 'progress') trace.push(e);
          logEvent(e);
          setStreaming((s) => s && { ...s, trace: [...trace], progress: e.type === 'progress' ? e.text : s.progress });
        },
      })) {
        acc += d.text;
        badge = d.badge;
        setStreaming((s) => s && { ...s, text: acc, badge });
      }
      const done = trace.findLast((e) => e.type === 'done');
      finish(acc, done?.badge || badge);
      setRouterInfo((r) => ({ ...r, lastBadge: done?.badge || badge }));
    } catch (err) {
      if (acc) finish(acc, `${badge} · ${err.name === 'AbortError' ? 'stopped' : 'interrupted'}`);
      if (err.name !== 'AbortError') {
        setLive((s) => ({ ...s, chat: [...s.chat, { role: 'system', content: err.message, providerBadge: 'router', ts: Date.now() }] }));
      }
    } finally {
      abortRef.current = null;
      setStreaming(null);
    }
  }

  function updateKey(name, value) {
    setVault((v) => ({ ...v, keys: { ...v.keys, [name]: value } }));
  }

  async function refreshModels() {
    const out = {};
    await Promise.all(
      PROVIDERS.filter((p) => !p.deprecated && (!p.keyEnv || keys[p.keyEnv])).map(async (p) => {
        try {
          const ids = await listModels(p, { apiKey: keys[p.keyEnv], baseUrl: effectiveOverrides(vault)[p.id]?.baseUrl });
          out[p.id] = { ok: true, ids };
        } catch (err) {
          out[p.id] = { ok: false, error: err.message };
        }
      }),
    );
    setModels(out);
  }

  const forced = plan.mode === 'sovereign-offline';
  return (
    <div className="page">
      <div className="provider-chips" role="group" aria-label="Provider">
        {CHIPS.map((c) => {
          const p = providerById(c.provider);
          const hasKey = !p?.keyEnv || keys[p.keyEnv];
          return (
            <button key={c.id} className="pchip" aria-pressed={c.id === chip.id} onClick={() => setRouterInfo((r) => ({ ...r, chipId: c.id }))}>
              <b>{c.label}</b>
              <span className="faint">{c.provider === 'webllm' ? activeModel() : c.model}{hasKey ? '' : ' · no key'}</span>
            </button>
          );
        })}
      </div>

      {forced && (
        <div className="banner sovereign">
          <b>eYe sovereign mode.</b> {plan.reason}: cloud is off and only the on-device WebLLM engine answers. Adjust in Toolbox → Battery Lab.
        </div>
      )}
      {!forced && chip.provider === 'meta' && (
        <div className="banner info">
          <b>Meta AI Direct.</b> Meta AI has no public chat API, so this chat can't stream it. Embedded in a host page, your prompt goes to the parent via <span className="mono">window.parent.postMessage</span> (addressed to the parent's own origin). Standalone, the prompt is copied and <a href="https://www.meta.ai/" target="_blank" rel="noreferrer">meta.ai</a> opens. For Meta's Llama models in this chat, use the Llama chips (served by Groq, Cerebras, OpenRouter) or WebLLM offline.
        </div>
      )}
      {lens && <div className="faint" style={{ marginBottom: 8 }}>Jacky lens: {lens.glyph} {lens.name} (set on the Prism Ring)</div>}

      <div className="chat" aria-live="polite">
        {live.chat.length === 0 && !streaming && (
          <div className="empty">
            Route: {plan.steps.slice(0, 4).map((s) => s.provider).join(' → ')}
            {plan.steps.length > 4 ? ' → …' : ''}
            <br />
            Add a key below, run Ollama, or tap the WebLLM chip for fully offline chat.
          </div>
        )}
        {live.chat.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content}
            {m.role === 'assistant' && m.providerBadge && (
              <div className="badge-line">
                <span>⟁ {m.providerBadge}</span>
              </div>
            )}
          </div>
        ))}
        {streaming && (
          <div className="msg assistant">
            {streaming.text || (
              <span className="dots" aria-label="waiting for tokens">
                <i />
                <i />
                <i />
              </span>
            )}
            <div className="badge-line">{streaming.badge && <span>⟁ {streaming.badge}</span>}</div>
            {streaming.progress && <div className="trace">{streaming.progress}</div>}
            {streaming.trace.length > 0 && <div className="trace">{traceLine(streaming.trace)}</div>}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <textarea
          ref={composerRef}
          className="field grow"
          placeholder={forced ? 'Offline · WebGPU…' : `Message · ${providerById(chip.provider)?.label || 'router'}…`}
          value={input}
          rows={1}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          aria-label="Message"
        />
        {streaming ? (
          <button className="btn" onClick={() => abortRef.current?.abort()} aria-label="Stop">
            ■
          </button>
        ) : (
          <button className="btn primary" onClick={send} disabled={!input.trim()} aria-label="Send">
            ↑
          </button>
        )}
      </div>

      {live.chat.length > 0 && !streaming && (
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
          <button className="btn sm ghost" onClick={() => setLive((s) => ({ ...s, chat: [] }))}>
            Clear chat
          </button>
        </div>
      )}

      <h2>Key vault</h2>
      <details className="vault card">
        <summary>
          🔑 {Object.keys(keys).length} of {PROVIDERS.filter((p) => p.keyEnv && !p.deprecated).length} providers keyed
        </summary>
        <p className="faint">
          Stored in this browser's localStorage only. Each key is sent only to its own provider and never goes into the long string. Free tiers: Groq, Cerebras, Gemini, OpenRouter (:free).
        </p>
        {PROVIDERS.filter((p) => p.keyEnv && !p.deprecated).map((p) => (
          <div key={p.id}>
            <label className="lbl" htmlFor={`k-${p.id}`}>
              {p.label} <span className="faint">· {p.free}</span>
            </label>
            <div className="row">
              <input
                id={`k-${p.id}`}
                className="field grow mono"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={vault.keys[p.keyEnv] ? maskKey(vault.keys[p.keyEnv]) : p.keyEnv}
                value={vault.keys[p.keyEnv] || ''}
                onChange={(e) => updateKey(p.keyEnv, e.target.value.trim())}
              />
              {p.keyUrl && (
                <a className="btn sm" href={p.keyUrl} target="_blank" rel="noreferrer">
                  get
                </a>
              )}
            </div>
            {models[p.id] && (
              <div className={models[p.id].ok ? 'faint' : 'err'}>
                {models[p.id].ok ? `${models[p.id].ids.length} live models · ${models[p.id].ids.slice(0, 4).join(', ')}` : models[p.id].error}
              </div>
            )}
          </div>
        ))}
        <label className="lbl" htmlFor="ollama-url">
          Ollama base URL <span className="faint">· localhost, ngrok or Cloudflare Tunnel (needs OLLAMA_ORIGINS)</span>
        </label>
        <input
          id="ollama-url"
          className="field mono"
          placeholder="http://localhost:11434/v1"
          value={vault.overrides.ollama?.baseUrl || ''}
          onChange={(e) => setVault((v) => ({ ...v, overrides: { ...v.overrides, ollama: { baseUrl: e.target.value.trim() } } }))}
        />
        {models.ollama && <div className={models.ollama.ok ? 'faint' : 'err'}>{models.ollama.ok ? `Ollama: ${models.ollama.ids.join(', ') || 'no models pulled'}` : models.ollama.error}</div>}
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn primary"
            onClick={() => {
              notify(saveVault(vault) ? 'Vault saved on this device.' : 'Could not write localStorage (private mode?).');
            }}
          >
            Save vault
          </button>
          <button className="btn" onClick={refreshModels}>
            Check models
          </button>
          <button
            className="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(toEnv(vault));
                notify('.env copied.');
              } catch {
                setEnvText(toEnv(vault));
              }
            }}
          >
            Export .env
          </button>
        </div>
        <label className="lbl" htmlFor="env-in">
          Import .env (paste)
        </label>
        <textarea id="env-in" className="field code" rows={3} value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder="VITE_GROQ_API_KEY=gsk_..." />
        <button
          className="btn sm"
          style={{ marginTop: 6 }}
          onClick={() => {
            const imported = fromEnv(envText);
            setVault((v) => ({ ...v, keys: { ...v.keys, ...imported } }));
            notify(`Imported ${Object.keys(imported).length} keys. Tap Save vault to keep them.`);
          }}
        >
          Import
        </button>
      </details>
    </div>
  );
}
