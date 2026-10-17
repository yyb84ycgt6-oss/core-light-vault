// Biometric gate on top of WebAuthn platform authenticators (Face ID / Touch ID).
// With the PRF extension (iOS 18+ passkeys, Chrome 116+) the authenticator
// returns a 32-byte secret that becomes B in K = PBKDF2(W||C||B): the gate is
// then cryptographic. Without PRF it is a user-verification gate only, and the
// UI says so.
import { bytesToB64, b64ToBytes } from '../longString.js';

const CRED_KEY = 'foundry.biometric.v1';
const PRF_SALT = new TextEncoder().encode('foundry-router/eYe/twin-key/v1');

export async function biometricAvailable() {
  try {
    return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

export function enrolledCredential() {
  try {
    return JSON.parse(localStorage.getItem(CRED_KEY) || 'null');
  } catch {
    return null;
  }
}

export async function enrollBiometric() {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Foundry Router' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'sovereign', displayName: 'Foundry sovereign key' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60_000,
      extensions: { prf: {} },
    },
  });
  const prf = !!cred.getClientExtensionResults?.().prf?.enabled;
  const record = { credentialId: bytesToB64(new Uint8Array(cred.rawId)), prf, createdAt: Date.now() };
  localStorage.setItem(CRED_KEY, JSON.stringify(record));
  return record;
}

/** Ask for Face ID / Touch ID. Returns { ok, secret } (secret only with PRF). */
export async function biometricGate(desc = enrolledCredential()) {
  if (!desc?.credentialId) return { ok: false, reason: 'no enrolled credential' };
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: b64ToBytes(desc.credentialId) }],
        userVerification: 'required',
        timeout: 60_000,
        extensions: { prf: { eval: { first: PRF_SALT } } },
      },
    });
    const flags = new Uint8Array(assertion.response.authenticatorData)[32];
    const userVerified = (flags & 0x04) !== 0;
    const first = assertion.getClientExtensionResults?.().prf?.results?.first;
    return { ok: userVerified, secret: first ? new Uint8Array(first) : null };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

/** Run the gate now and package what createLongStringProduction needs. */
export async function biometricForSeal() {
  const desc = enrolledCredential();
  if (!desc) return null;
  const res = await biometricGate(desc);
  if (!res.ok) throw new Error('Biometric gate refused');
  return { credentialId: desc.credentialId, secret: res.secret };
}
