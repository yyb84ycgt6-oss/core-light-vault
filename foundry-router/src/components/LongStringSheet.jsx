import { useEffect, useState } from 'react';
import { useApp } from '../AppContext.js';
import { createLongStringProduction, restoreProduction, inspectLongString, passphraseBits, PBKDF2_ITERATIONS } from '../longString.js';
import { biometricAvailable, enrolledCredential, enrollBiometric, biometricForSeal, biometricGate } from '../lib/biometric.js';
import { appendLog } from '../toolbox/transparencyLog.js';
import { haptic } from '../lib/haptics.js';
import { fmtBytes } from '../toolbox/yAxisLab.js';

export default function LongStringSheet({ onClose }) {
  const { snapshot, routerSnapshot, eye, setLive, notify } = useApp();
  const [mode, setMode] = useState('device');
  const [pass, setPass] = useState('');
  const [useBio, setUseBio] = useState(false);
  const [bioOk, setBioOk] = useState(false);
  const [cred, setCred] = useState(enrolledCredential);
  const [lockDays, setLockDays] = useState(0);
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [paste, setPaste] = useState('');
  const [info, setInfo] = useState(null);
  const [restorePass, setRestorePass] = useState('');

  useEffect(() => {
    biometricAvailable().then(setBioOk);
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const bits = passphraseBits(pass);

  async function generate() {
    setErr('');
    setOut(null);
    if (!eye) return setErr('eYe weights still loading.');
    if (mode === 'passphrase' && bits < 50) return setErr('Use a longer passphrase (≥ 50 bits estimated). It is the only secret in portable mode.');
    setBusy('generate');
    try {
      const biometric = useBio && cred ? await biometricForSeal() : null;
      const res = await createLongStringProduction(snapshot(), {
        keyMode: mode,
        passphrase: pass,
        biometric,
        eye,
        router: routerSnapshot(),
        futureLock: lockDays ? Date.now() + lockDays * 86_400_000 : null,
      });
      setOut(res);
      appendLog({ type: 'save', detail: `long string ${res.report.bytes} chars, ${res.report.chunks} records, ${mode}` });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(out.longString);
      haptic(20); // the ~ portal handshake: active -> dormant
      notify('Long string copied. Paste it anywhere: the conversation is the save.');
    } catch {
      notify('Clipboard blocked: use Share or Download.');
    }
  }

  async function share() {
    const file = new File([out.longString], `foundry-${Date.now()}.longstring.txt`, { type: 'text/plain' });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Foundry long string' });
      else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
    } catch {
      /* user cancelled */
    }
  }

  function inspect(text) {
    setErr('');
    setInfo(null);
    if (!text.trim()) return;
    try {
      setInfo(inspectLongString(text));
    } catch (e) {
      setErr(e.message);
    }
  }

  async function restore() {
    setErr('');
    setBusy('restore');
    try {
      const { state, report } = await restoreProduction(paste, {
        getPassphrase: async () => restorePass,
        biometricGate: async (desc) => biometricGate(desc),
      });
      if (!confirm(`Restore ${state.chat.length} messages and ${state.files.length} files? This replaces the current session.`)) return;
      setLive(state);
      appendLog({ type: 'restore', detail: `${report.chunks} records streamed, peak ${report.peakWorkingBytes} B, ${report.ms.toFixed(0)} ms` });
      haptic(20);
      notify(`Restored atomically · ${report.chunks} × 16 KiB records · peak working set ${fmtBytes(report.peakWorkingBytes)}`);
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Long string">
        <div className="grab" />
        <div className="row">
          <b className="grow" style={{ fontSize: 17 }}>
            ∞ Long String
          </b>
          <button className="btn sm" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="faint mono" style={{ margin: '6px 0 10px' }}>
          _{'{Data}'}-{'{AI}'}-(eYe)-{'{qpdb}'}~{'{Encrypted_compressed}'}-{'{bdpq}'}-(eYe)-{'{AI}'}-{'{Data}'}_
        </div>

        <div className="seg" role="group" aria-label="Key mode">
          <button aria-pressed={mode === 'device'} onClick={() => setMode('device')}>
            Device key
          </button>
          <button aria-pressed={mode === 'passphrase'} onClick={() => setMode('passphrase')}>
            Passphrase (portable)
          </button>
        </div>
        <div className="faint" style={{ marginTop: 6 }}>
          {mode === 'device'
            ? 'Non-extractable AES-GCM-256 key held in this browser. Restores only here: a stolen string is noise.'
            : `K = PBKDF2-SHA256(W‖C‖B, ${PBKDF2_ITERATIONS.toLocaleString()} iterations). W = eYe weights, C = your passphrase, B = biometric PRF (optional). Security rests on C.`}
        </div>
        {mode === 'passphrase' && (
          <>
            <label className="lbl" htmlFor="ls-pass">Passphrase (C) · ~{bits} bits</label>
            <input id="ls-pass" className="field" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          {bioOk && !cred && (
            <button
              className="btn sm"
              onClick={async () => {
                try {
                  const c = await enrollBiometric();
                  setCred(c);
                  notify(c.prf ? 'Face ID / Touch ID enrolled with PRF: B is cryptographic.' : 'Enrolled. No PRF on this device: the gate is user-verification only.');
                } catch (e) {
                  notify(`Enroll failed: ${e.message}`);
                }
              }}
            >
              Enroll Face ID / Touch ID
            </button>
          )}
          {cred && (
            <label className="row small">
              <input type="checkbox" checked={useBio} onChange={(e) => setUseBio(e.target.checked)} style={{ width: 22, height: 22 }} />
              Biometric gate {cred.prf ? '(PRF → B)' : '(UV only)'}
            </label>
          )}
          {!bioOk && <span className="faint">No platform authenticator: biometric gate unavailable.</span>}
        </div>
        <label className="lbl" htmlFor="ls-lock">Future-lock: {lockDays ? `${lockDays} day(s)` : 'none'}</label>
        <input id="ls-lock" type="range" min="0" max="30" value={lockDays} onChange={(e) => setLockDays(+e.target.value)} />
        <button className="btn primary block" onClick={generate} disabled={!!busy}>
          {busy === 'generate' ? (mode === 'passphrase' ? 'Deriving key (2^20 rounds)…' : 'Sealing…') : 'Generate long string'}
        </button>

        {out && (
          <div className="card" style={{ marginTop: 10 }}>
            <div className="longstring">{out.longString}</div>
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>length</dt>
              <dd>{out.report.bytes.toLocaleString()} chars</dd>
              <dt>payload</dt>
              <dd>
                {fmtBytes(out.report.plainBytes)} → {fmtBytes(out.report.compressedBytes)} gzip ({out.report.ratio.toFixed(1)}:1) · {out.report.chunks} × 16 KiB records
              </dd>
              <dt>Y collapse</dt>
              <dd>
                {out.report.collapse.words} words → {fmtBytes(out.report.collapse.fingerprintBytes)} ({out.report.collapse.ratio.toFixed(0)}:1, retention {out.report.collapse.retention.toFixed(2)})
              </dd>
              <dt>key</dt>
              <dd>{out.report.keyMode}</dd>
            </dl>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn primary grow" onClick={copy}>
                Copy ~
              </button>
              <button className="btn" onClick={share}>
                Share / Save
              </button>
            </div>
          </div>
        )}

        <div className="sep" />
        <b>Restore</b>
        <div className="faint">All-or-nothing: bounds, mirror, twins and digests are checked, every record must authenticate, then the session is swapped in one step.</div>
        <textarea
          className="field code"
          rows={4}
          style={{ marginTop: 8 }}
          placeholder="Paste a long string _{…}_"
          value={paste}
          onChange={(e) => {
            setPaste(e.target.value);
            inspect(e.target.value);
          }}
          aria-label="Long string to restore"
        />
        {info && (
          <dl className="kv card" style={{ marginTop: 8 }}>
            <dt>created</dt>
            <dd>{new Date(info.createdAt).toLocaleString()}</dd>
            <dt>contains</dt>
            <dd>
              {info.public.counts.chat} messages · {info.public.counts.files} files · {info.records} records
            </dd>
            <dt>key</dt>
            <dd>
              {info.key.mode}
              {info.key.biometric ? ' + biometric' : ''}
            </dd>
            {info.futureLock && (
              <>
                <dt>locked until</dt>
                <dd>{new Date(info.futureLock).toLocaleString()}</dd>
              </>
            )}
            <dt>last route</dt>
            <dd>{info.router.lastBadge || '—'}</dd>
          </dl>
        )}
        {info?.key.mode === 'passphrase' && (
          <>
            <label className="lbl" htmlFor="rs-pass">Passphrase</label>
            <input id="rs-pass" className="field" type="password" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} />
          </>
        )}
        <button className="btn block" style={{ marginTop: 8 }} onClick={restore} disabled={!info || !!busy}>
          {busy === 'restore' ? 'Streaming 16 KiB records…' : 'Restore'}
        </button>
        {err && (
          <div className="err" style={{ marginTop: 8 }} role="alert">
            {err}
          </div>
        )}
      </div>
    </div>
  );
}
