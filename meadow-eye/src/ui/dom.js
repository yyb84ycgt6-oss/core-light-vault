// Tiny DOM toolkit: h() builder, modal sheet, toast, haptic tick.
export function h(tag, props = {}, ...kids) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function toast(msg, ms = 2800) {
  const t = h('div.toast', { role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export function haptic(ms = 15) {
  try {
    if (navigator.vibrate?.(ms)) return;
  } catch {
    /* none */
  }
  // iOS 18+: toggling a switch input through its label plays the system tick.
  let l = $('#meadow-haptic');
  if (!l) {
    const i = h('input', { type: 'checkbox', switch: true, id: 'meadow-haptic-in', tabIndex: -1 });
    l = h('label', { id: 'meadow-haptic', htmlFor: 'meadow-haptic-in', style: { position: 'fixed', left: '-9px', top: '-9px', width: '1px', height: '1px', opacity: 0 } }, i);
    document.body.append(l);
  }
  l.click();
}

/** Bottom sheet modal. Returns { el, close }. */
export function sheet(title, ...body) {
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const panel = h('div.sheet.rough', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div.sheet-head', {}, h('b', {}, title), h('button.btn.sm', { onclick: close }, 'Close')), ...body);
  const back = h('div.backdrop', { onclick: (e) => e.target === back && close() }, panel);
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  return { el: panel, close };
}

export const fmtBytes = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${(b / 1e3).toFixed(1)} kB` : `${b} B`);

export async function copy(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    haptic(20);
    toast(label);
  } catch {
    toast('Clipboard blocked');
  }
}
