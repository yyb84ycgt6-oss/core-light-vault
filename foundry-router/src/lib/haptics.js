// Haptics: navigator.vibrate where it exists (Android/Chrome). iOS Safari has
// no Vibration API; on iOS 18+ toggling an <input type="checkbox" switch>
// through its <label> plays the system selection haptic, so we use that.

let iosLabel = null;

function iosTick() {
  if (typeof document === 'undefined') return false;
  if (!iosLabel) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.id = 'foundry-haptic-switch';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    iosLabel = document.createElement('label');
    iosLabel.htmlFor = input.id;
    iosLabel.setAttribute('aria-hidden', 'true');
    iosLabel.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;left:-9px;top:-9px';
    iosLabel.appendChild(input);
    document.body.appendChild(iosLabel);
  }
  iosLabel.click();
  return true;
}

/** Portal handshake pulse (~ in the long string): 20 ms by default. */
export function haptic(ms = 20) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      if (navigator.vibrate(ms)) return 'vibrate';
    } catch {
      /* fall through */
    }
  }
  return iosTick() ? 'ios-switch' : 'none';
}
