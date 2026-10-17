// Local API key vault. Keys live in this browser's localStorage under the
// env-style names from .env.example and are only attached to requests for the
// provider they belong to. They are never written into the long string.
import { PROVIDERS } from '../router.js';

const VAULT_KEY = 'foundry.vault.v1';

export const KEY_NAMES = PROVIDERS.filter((p) => p.keyEnv).map((p) => p.keyEnv);

function readStorage() {
  try {
    return JSON.parse(localStorage.getItem(VAULT_KEY) || '{}');
  } catch {
    return {};
  }
}

export function loadVault() {
  const raw = readStorage();
  return { keys: raw.keys || {}, overrides: raw.overrides || {} };
}

export function saveVault(vault) {
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify({ keys: vault.keys, overrides: vault.overrides }));
    return true;
  } catch {
    return false;
  }
}

/** Dev-only defaults from .env.local (VITE_*), overridden by anything in the vault. */
export function effectiveKeys(vault) {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  const out = {};
  for (const name of KEY_NAMES) {
    const v = vault.keys[name] || env[`VITE_${name}`];
    if (v) out[name] = v.trim();
  }
  return out;
}

export function effectiveOverrides(vault) {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  const o = { ...vault.overrides };
  for (const [id, name] of [['ollama', 'VITE_OLLAMA_BASE_URL'], ['runner', 'VITE_RUNNER_BASE_URL']]) {
    if (!o[id]?.baseUrl && env[name]) o[id] = { ...o[id], baseUrl: env[name] };
  }
  return o;
}

export function toEnv(vault) {
  return KEY_NAMES.map((n) => `VITE_${n}=${vault.keys[n] || ''}`).join('\n') + '\n';
}

export function fromEnv(text) {
  const keys = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:VITE_)?([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?/.exec(line);
    if (m && KEY_NAMES.includes(m[1]) && m[2].trim()) keys[m[1]] = m[2].trim();
  }
  return keys;
}

export const maskKey = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');
