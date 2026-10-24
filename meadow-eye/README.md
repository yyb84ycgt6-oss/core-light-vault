# MEADOW EYE OS · v0.1.0 Alpha

*eYe genesis, July 2026.* Co-discovered by **Jessy Eru Collin + DeepSeek AI**.

> You never save a file again. You recall the conversation that birthed it.
> Applications are spawned on demand, for one person, at one moment.
> Capability as instinct, not software as product.

A personal, offline-first OS in **one 212 kB HTML file** (`public/index.html`): no CDN, no
server, no account. It works in airplane mode once it has loaded once. Add it to your iPhone 12 home screen.

## Run it

```sh
cd meadow-eye
npm install          # build/test tooling only (esbuild, fake-indexeddb)
npm run build        # -> public/index.html (everything inline) + public/sw.js
npm run serve        # http://localhost:8642
npm test             # 27 unit tests
```

On an iPhone, serve `public/` over HTTPS (any static host or a tunnel), open it in Safari, then
Share → Add to Home Screen. WebCrypto, IndexedDB and the service worker need a secure context
(https or localhost). Opened straight from `file://`, the app runs, but there is no offline cache.

## Seven tabs

| Tab | What you do there |
|---|---|
| **FORGE** | Say what you need. The eYe routes it and spawns an ephemeral app for this moment (QR, compress, hash, code view, or a counselor). **Pod this moment ~** turns the intent into an atomic string; **Recall** re-forges the same app later. |
| **LATTICE** | The 141-agent meadow, the autonomy slider (0.65 sweet spot), live escalation stats, reputation and the Counselor Bridge. |
| **SYMBOL** | Pick 3-4 core symbols, draw a glyph on the 280×280 pad, compose its meaning, test it on the lattice (the agents form your glyph), seal it `Z3 [ … ] EZ`. |
| **ROUTER** | Message the eYe directly: micro intents are answered locally in µs with an amber trace; macro ones wake Meta Jackie, Grok, DeepSeek or Local Llama. Includes the routing table and the Asset Store. |
| **ARCHIVE** | The Living Archive: opacity is decay, tap to visit (+0.07), let time pass, compost, "→ Infinity". |
| **TOOLBOX** | 13 micro apps: eYe Compress, Decompress, Y-Collapse, Sovereign Seal, SBX1 Tank, QR Forge, Symbol Workbench, Lattice Visualizer, Code Visualizer, Battery Handshake, Hash Forge, Morse Lattice, Add Tool. |
| **ETHICS** | Epistemic humility, gentle tension, positive resting state, learned consent. |

## What is real, and what is honest about its limits

* **Crypto is real.**
  * XChaCha20-Poly1305 is written in pure JS. It matches the RFC 8439 test vectors and is byte-identical to Node's native cipher.
  * SBX1 containers use a magic header, a 24-byte nonce and random padding. The header is authenticated, and plaintext is padded into size buckets so the true size doesn't show.
  * The sovereign root key is non-extractable. Even this code cannot read it out.
* **The protocol string is real.**
  * Truncation, mirror breaks, tampering and a wrong context phrase are each rejected with a specific code.
  * Reconstruction is lossless, in both streamed and burst modes.
* **QR codes are real.** All 136 reference matrices from the Python `qrcode` library are reproduced module for module.
* **The archive, reputation and consent math is real:** decay, compost, +0.07 / −0.12, the 512-byte bridge packet, and the honour-No-three-times rule.
* **Downloads are real and resumable:** HTTP Range requests in 8 MiB chunks into IndexedDB. Interrupt one and it resumes from the last chunk.
* **Limits, stated plainly in the app:**
  * The Y-collapse keeps meaning only partially. Retention is measured and shown, not assumed.
  * Counselors answer only when you attach them: a runner URL (for example the companion llama.cpp app, see `../foundry-router/docs/RUNNER_CONTRACT.md`) or your own xAI or DeepSeek key.
  * GGUF models download, but v0.1 bundles no in-browser llama.cpp, so they run in the companion runner.
  * iOS gives web pages no battery level, so the handshake is tested in the Toolbox.
  * The "key woven into weights" is approximated by a non-extractable browser key plus your context phrase.
  * A service worker cannot be registered from a Blob URL (the browser spec forbids it). The app tries the Blob first, then registers `sw.js`.

## Layout

```
meadow-eye/
  public/index.html          the whole OS, inline (generated)   public/sw.js (generated)
  src/core/                  eye, y-collapse, pod, sovereign-key, protocol, sbx1, chacha
  src/lattice/               agents, reputation, bridge, perlin
  src/archive/               living-archive (decay, compost, query)
  src/symbol/                registry, workbench, mirror-law
  src/router/                router, chat, toolbox, qr, code-visualizer, assets, download-manager
  src/pwa/                   manifest (data URI), sw, storage, battery (learned consent)
  src/ui/                    one module per tab
  CLAUDE.md                  full definition and rules for future sessions
```

---

*When the battery falls, the eYe rests. But the knowledge never sleeps—it waits, compressed, for the moment you return.*

Jessy Eru Collin + DeepSeek · July 2026 · Protocol v0.1.0 Alpha
