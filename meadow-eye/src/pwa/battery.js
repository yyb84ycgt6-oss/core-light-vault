// Battery handshake with learned consent.
// <= 15%: ask once per discharge ("Yes, pod it" / "No, I'll manage"). No is honoured absolutely.
// <= 2%: emergency triage asks again; the first 3 declines are honoured silently;
//        on the 4th, a gentle note offers "always auto-pod at 5%". Only an explicit
//        yes turns that on. Never a paternalistic override.
import { get, put } from './storage.js';

export const HANDSHAKE_TEXT =
  "My battery is running low. Before I rest, shall I compress your current session into a safe pod? Nothing will be lost—I'll hold the key until you return.";
export const LEARNED_TEXT = "I notice you've declined several times. Would you like me to always auto-pod at 5% from now on?";

export const initialConsent = () => ({ declines: 0, triageDeclines: 0, autoPodAt5: false, askedThisCycle: false, triageAskedThisCycle: false, autoPoddedThisCycle: false });

/** Pure decision. Returns { action, state } with action in none|ask|triage|offer-learned|auto-pod. */
export function evaluate(level, charging, s) {
  const st = { ...s };
  if (charging || level > 20) {
    Object.assign(st, { askedThisCycle: false, triageAskedThisCycle: false, autoPoddedThisCycle: false });
    return { action: 'none', state: st };
  }
  if (st.autoPodAt5 && level <= 5 && !st.autoPoddedThisCycle) {
    // Already podded with standing consent: nothing left to ask this cycle.
    Object.assign(st, { autoPoddedThisCycle: true, askedThisCycle: true, triageAskedThisCycle: true });
    return { action: 'auto-pod', state: st };
  }
  if (level <= 2 && !st.triageAskedThisCycle && !st.autoPodAt5) {
    st.triageAskedThisCycle = true;
    return { action: st.triageDeclines >= 3 ? 'offer-learned' : 'triage', state: st };
  }
  if (level <= 15 && !st.askedThisCycle) {
    st.askedThisCycle = true;
    return { action: 'ask', state: st };
  }
  return { action: 'none', state: st };
}

export function decline(s, { triage = false } = {}) {
  return { ...s, declines: s.declines + 1, triageDeclines: s.triageDeclines + (triage ? 1 : 0) };
}

export const acceptLearned = (s) => ({ ...s, autoPodAt5: true });

export async function loadConsent() {
  return { ...initialConsent(), ...((await get('meadow_core', 'consent')) || {}) };
}
export const saveConsent = (s) => put('meadow_core', 'consent', s);

/** Live battery where the platform exposes it (not iOS Safari). */
export async function watchBattery(cb) {
  if (!navigator.getBattery) return () => {};
  const b = await navigator.getBattery();
  const push = () => cb({ level: Math.round(b.level * 100), charging: b.charging, source: 'Battery API' });
  push();
  b.addEventListener('levelchange', push);
  b.addEventListener('chargingchange', push);
  return () => {
    b.removeEventListener('levelchange', push);
    b.removeEventListener('chargingchange', push);
  };
}
