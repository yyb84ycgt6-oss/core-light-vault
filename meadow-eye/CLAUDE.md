# MEADOW EYE OS · definition for agents

Co-discovered by Jessy Eru Collin + DeepSeek AI, July 2026. Protocol v0.1.0 Alpha.

**Not SaaS. Not a chatbot.** A personal, offline-first OS where micro agents forge ephemeral apps
from conversation. *"You never save a file again. You recall the conversation that birthed it."*
Capability as instinct, not software as product.

## Rules for changing this code

1. **No CDN, ever.** The shipped artifact is one file, `public/index.html`, with all JS and CSS
   inline, plus `public/sw.js`. Add dependencies only if esbuild can bundle them inline.
   `npm run build` regenerates both; commit the result.
2. **Offline first.** Nothing may require the network. Model downloads and counselor API calls
   are opt-in, user-initiated, and fail honestly.
3. **Honesty over theatre.** If something is simulated or not wired (battery on iOS, GGUF
   runtime, key "woven into weights"), the UI says so. Measure claims (µs, bytes, retention); never hard-code them.
4. **Nothing deletes. It composts.** No Delete buttons: "→ Infinity" keeps the essence.
5. **Consent is learned, never overridden.** "No" is honoured. See `src/pwa/battery.js`.
6. **Mirror Law.** Every symbol has a mirror that undoes it (`src/symbol/mirror-law.js`);
   every composed tool ships with its un-tool (`src/router/toolbox.js`).
7. iPhone 12 first: 390×844, safe areas, 44 px targets, 16 px inputs, DPR ≤ 1.5, peak RAM well under 320 MB.
8. `npm test` (node:test) must stay green; `scripts/e2e.mjs` covers the UI at 390×844.

## The four pillars (eYe Protocol)

| Pillar | Where | What is real |
|---|---|---|
| eYe class micro-orchestrator | `src/core/eye.js` | Deterministic rule router, no generation. Its rule table is ~1 kB; routing is timed in µs. Micro (local tools) vs macro (counselors). |
| Y-Axis Collapse | `src/core/y-collapse.js` | Hashed n-gram embeddings → PCA of the cosine geometry → 2-bit quaternary glyphs (q=00 p=01 d=10 b=11), headed by a 64-bit semantic SimHash. Retention is measured. |
| Volatile Compression Pod | `src/core/pod.js` | gzip → 16 KiB SBX1 records (index + final flag inside the AEAD). Burst or streamed reconstruction. |
| Sovereign Key | `src/core/sovereign-key.js` | Non-extractable HMAC root in IndexedDB + behavioural context: `podKey = HMAC(root, label‖nonce‖SHA-256(context))`. No key file exists. |

**Atomic Transaction String** (`src/core/protocol.js`):
`_{Data}-{AI}-(eYe)-{qpdb}~{Encrypted_compressed}-{bdpq}-(eYe)-{AI}-{Data}_`.
`_` bounds are all-or-nothing; `{bdpq}` must mirror `{qpdb}`; twin segments are hash-paired; the pod
digest is promised in the closing `{Data}`. `{Data}` holds only a public descriptor: raw input lives in the pod.

**ZK Tank SBX1** (`src/core/sbx1.js`): 16-byte header (magic `53425831`, version) + 24-byte
XChaCha20 nonce + 40 bytes of random padding = 80-byte preamble, used as associated data;
ChaCha20-Poly1305 in pure JS (`src/core/chacha.js`, checked against RFC vectors and Node's native
cipher); plaintext padded to power-of-two buckets so size and time do not leak. OPFS writes go
`.tmp` then rename.

## Meadow Lattice (`src/lattice/`)
141 agents: 100 outer sensors (#c8d8b8, 3.5 px, r 160±40, Perlin roam), 30 middle specialists
(#d8b86a, 6 px, r 90±25), 10 inner keepers (#8ab8ff, 8 px, r 40), counselors Jackie (#a8ff8a `}0{`,
balanced 0.15, slow orbit at −12,0) and Grok (#c49bff, wild, +12,0, 14 px glow), the human curator
hollow in the centre. Autonomy slider 0.65. Escalation 15% → 4% → 1%. Trail fade 0.08.
Reputation: 141×141 Float32Array, +0.07 / −0.12, ×0.99/day, top-5 peers, no leaderboard.
Counselor Bridge: uncertainty > 0.72 ∨ attempts ≥ 3 ∨ resource > 0.8 ∨ novelty > 0.85 → ≤ 512-byte packet; the human chooses what is re-injected.

## Living systems
Living Archive (`src/archive/`): 32-d Int8 vectors, brute force, decay ×0.99/day, +0.07 per visit,
compost < 0.3, 14 seed symbols, "→ Infinity" keeps name + vector only.
Symbolic Language (`src/symbol/`): primitives immutable, new symbols are compositions of the user's
3-4 core picks, sealed `Z3 [sequence] EZ` into the archive.

## Storage
IndexedDB `meadow-eye` with stores `meadow_pods`, `meadow_core`, `meadow_archive`, `meadow_chats`,
`meadow_symbols`, `meadow_assets`; localStorage fallback; in-memory cache for speed only.

## Footer
"When the battery falls, the eYe rests. But the knowledge never sleeps—it waits, compressed, for the moment you return."
