import { useEffect, useRef, useState } from 'react';
import { HANDSHAKE_TEXT } from '../eYe.js';

/** Conscious Handshake: quarter-screen soft glow, asks before the device rests. */
export default function Handshake({ onYes, onLater }) {
  const [busy, setBusy] = useState(false);
  const yesRef = useRef(null);
  useEffect(() => yesRef.current?.focus(), []);
  return (
    <div className="handshake" role="alertdialog" aria-live="polite" aria-label="eYe low battery handshake">
      <p>{HANDSHAKE_TEXT}</p>
      <div className="row">
        <button
          ref={yesRef}
          className="btn primary grow"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onYes();
            setBusy(false);
          }}
        >
          {busy ? 'Sealing…' : 'Yes, pod it'}
        </button>
        <button className="btn ghost" onClick={onLater} disabled={busy}>
          Not now
        </button>
      </div>
    </div>
  );
}
