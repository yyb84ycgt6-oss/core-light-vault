import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../AppContext.js';
import { fsBackend, fsList, fsRead, fsWrite, fsMkdir, fsDelete, fsRename, cleanName, detectDotSaved } from '../../toolbox/fileSystem.js';
import { fmtBytes } from '../../toolbox/yAxisLab.js';

export default function FilesTool() {
  const { live, setLive, notify } = useApp();
  const [backend, setBackend] = useState('');
  const [folder, setFolder] = useState('');
  const [entries, setEntries] = useState([]);
  const [editing, setEditing] = useState(null); // index into live.files

  const refresh = useCallback(async () => {
    try {
      setEntries(await fsList(folder));
    } catch (err) {
      notify(err.message);
    }
  }, [folder, notify]);

  useEffect(() => {
    fsBackend().then(setBackend);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const crumbs = folder ? folder.split('/') : [];
  const doc = editing !== null ? live.files[editing] : null;

  const safe = async (fn) => {
    try {
      await fn();
    } catch (err) {
      notify(err.message);
    }
  };

  async function openFile(name) {
    const content = await fsRead(folder, name);
    const idx = live.files.findIndex((f) => f.folder === folder && f.name === name);
    const next = { name, folder, content, dotSaved: true };
    const files = idx >= 0 ? live.files.map((f, i) => (i === idx ? next : f)) : [...live.files, next];
    setLive((s) => ({ ...s, files }));
    setEditing(idx >= 0 ? idx : files.length - 1);
  }

  async function saveDoc(i) {
    const f = live.files[i];
    if (f.folder) await fsMkdir(f.folder);
    await fsWrite(f.folder, f.name, f.content);
    setLive((s) => ({ ...s, files: s.files.map((x, j) => (j === i ? { ...x, dotSaved: true } : x)) }));
    await refresh();
  }

  return (
    <div>
      <div className="faint">
        Backend: <b>{backend === 'opfs' ? 'OPFS (origin private file system)' : backend === 'idb' ? 'IndexedDB fallback' : '…'}</b> · ● = unsaved (dotSaved false)
      </div>

      {doc ? (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="row">
            <b className="grow mono">
              {doc.dotSaved ? '' : '● '}/{doc.folder ? `${doc.folder}/` : ''}
              {doc.name}
            </b>
            <button className="btn sm" onClick={() => setEditing(null)}>
              Close
            </button>
          </div>
          <textarea
            className="field code"
            rows={12}
            style={{ marginTop: 8 }}
            value={doc.content}
            onChange={(e) => {
              const content = e.target.value;
              setLive((s) => ({ ...s, files: s.files.map((x, j) => (j === editing ? { ...x, content, dotSaved: false } : x)) }));
            }}
            aria-label={`Editing ${doc.name}`}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={() => safe(() => saveDoc(editing))} disabled={doc.dotSaved}>
              Save
            </button>
            <button
              className="btn"
              onClick={() =>
                safe(async () => {
                  const clean = await detectDotSaved(doc);
                  setLive((s) => ({ ...s, files: s.files.map((x, j) => (j === editing ? { ...x, dotSaved: clean } : x)) }));
                  notify(clean ? 'Matches disk.' : 'Differs from disk.');
                })
              }
            >
              Check vs disk
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={() => setFolder('')} disabled={!folder}>
              /
            </button>
            {crumbs.map((c, i) => (
              <button key={i} className="btn sm" onClick={() => setFolder(crumbs.slice(0, i + 1).join('/'))}>
                {c}
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn sm"
              onClick={() =>
                safe(async () => {
                  const name = prompt('New folder name');
                  if (!name) return;
                  await fsMkdir(folder ? `${folder}/${cleanName(name)}` : cleanName(name));
                  await refresh();
                })
              }
            >
              + Folder
            </button>
            <button
              className="btn sm"
              onClick={() =>
                safe(async () => {
                  const name = prompt('New file name', 'notes.md');
                  if (!name) return;
                  if (folder) await fsMkdir(folder);
                  await fsWrite(folder, cleanName(name), '');
                  await refresh();
                  await openFile(cleanName(name));
                })
              }
            >
              + File
            </button>
          </div>
          <div className="list" style={{ marginTop: 10 }}>
            {entries.length === 0 && <div className="empty">Empty folder.</div>}
            {entries.map((e) => (
              <div key={e.path} className="item row">
                <button className="btn sm ghost grow" style={{ justifyContent: 'flex-start' }} onClick={() => safe(() => (e.kind === 'directory' ? setFolder(e.path) : openFile(e.name)))}>
                  {e.kind === 'directory' ? '📁' : '📄'} {e.name}
                </button>
                {e.kind === 'file' && <span className="faint">{fmtBytes(e.size)}</span>}
                {e.kind === 'file' && (
                  <button
                    className="btn sm"
                    onClick={() =>
                      safe(async () => {
                        const to = prompt('Rename to', e.name);
                        if (!to || to === e.name) return;
                        await fsRename(folder, e.name, to);
                        setLive((s) => ({ ...s, files: s.files.map((f) => (f.folder === folder && f.name === e.name ? { ...f, name: cleanName(to) } : f)) }));
                        await refresh();
                      })
                    }
                  >
                    Rename
                  </button>
                )}
                <button
                  className="btn sm danger"
                  onClick={() =>
                    safe(async () => {
                      if (!confirm(`Delete ${e.path}${e.kind === 'directory' ? ' and everything in it' : ''}?`)) return;
                      await fsDelete(folder, e.name, { directory: e.kind === 'directory' });
                      await refresh();
                    })
                  }
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
          <h2>Working set (goes into pods + long string)</h2>
          <div className="list">
            {live.files.length === 0 && <div className="faint">Open a file to add it.</div>}
            {live.files.map((f, i) => (
              <div key={`${f.folder}/${f.name}`} className="item row">
                <span className="grow mono">
                  {f.dotSaved ? '' : '● '}/{f.folder ? `${f.folder}/` : ''}
                  {f.name}
                </span>
                <button className="btn sm" onClick={() => setEditing(i)}>
                  Edit
                </button>
                {!f.dotSaved && (
                  <button className="btn sm" onClick={() => safe(() => saveDoc(i))}>
                    Save
                  </button>
                )}
                <button className="btn sm ghost" onClick={() => setLive((s) => ({ ...s, files: s.files.filter((_, j) => j !== i) }))} aria-label={`Close ${f.name}`}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
