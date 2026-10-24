import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../AppContext.js';
import { readLog, verifyLog, clearLog, exportLog } from '../../toolbox/transparencyLog.js';

const ICON = { attempt: '→', done: '✓', failover: '✗', skip: '↷', retry: '↻', heal: '✚', error: '!', seal: '🫙', release: '⇪', restore: '∞', save: '∞', wake: '👁' };

export default function LogTool() {
  const { notify } = useApp();
  const [rows, setRows] = useState([]);
  const [verdict, setVerdict] = useState(null);
  const refresh = useCallback(async () => setRows(await readLog(300)), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div>
      <div className="faint">Every routing decision, seal, release and restore, chained with SHA-256 (each entry hashes the previous one), so edits are detectable.</div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm" onClick={refresh}>
          Refresh
        </button>
        <button className="btn sm" onClick={async () => setVerdict(await verifyLog())}>
          Verify chain
        </button>
        <button
          className="btn sm"
          onClick={async () => {
            const json = await exportLog();
            try {
              await navigator.clipboard.writeText(json);
              notify('Log JSON copied.');
            } catch {
              notify('Clipboard blocked.');
            }
          }}
        >
          Export
        </button>
        <button
          className="btn sm danger"
          onClick={async () => {
            if (!confirm('Clear the transparency log?')) return;
            await clearLog();
            setVerdict(null);
            refresh();
          }}
        >
          Clear
        </button>
      </div>
      {verdict && (
        <div className={`banner ${verdict.ok ? 'info' : 'sovereign'}`} style={{ marginTop: 8 }}>
          {verdict.ok ? `Chain intact: ${verdict.entries} entries.` : `Chain broken at entry #${verdict.brokenAt}.`}
        </div>
      )}
      <div className="list" style={{ marginTop: 10 }}>
        {rows.length === 0 && <div className="empty">No entries yet. Send a chat or seal a pod.</div>}
        {rows.map((r) => (
          <div key={r.seq} className="item small">
            <div className="row">
              <span>{ICON[r.type] || '·'}</span>
              <b>{r.type}</b>
              <span className="grow">{[r.provider, r.model].filter(Boolean).join(' · ')}</span>
              <span className="faint">{new Date(r.ts).toLocaleTimeString()}</span>
            </div>
            {r.detail && <div className="faint mono">{String(r.detail).slice(0, 200)}</div>}
            <div className="faint mono">#{r.seq} {r.hash.slice(0, 16)}…</div>
          </div>
        ))}
      </div>
    </div>
  );
}
