// ETHICS: the philosophy the code is built to obey.
import { h, toast } from './dom.js';
import { loadConsent, saveConsent, initialConsent } from '../pwa/battery.js';

export function renderEthics(root) {
  const consentBox = h('div.card.rough');
  const showConsent = async () => {
    const c = await loadConsent();
    consentBox.replaceChildren(
      h('b', {}, 'Learned consent'),
      h('div.dim', {}, `Handshakes declined: ${c.declines} · emergency declines: ${c.triageDeclines} · auto-pod at 5%: ${c.autoPodAt5 ? 'yes (you chose this)' : 'no'}`),
      h('button.btn.sm', {
        onclick: async () => {
          await saveConsent(initialConsent());
          toast('Consent memory returned to zero');
          showConsent();
        },
      }, 'Forget my answers'),
    );
  };
  showConsent();
  root.append(
    h('section.page.ethics', {},
      h('h2', {}, 'Epistemic Humility'),
      h('p.quote', {}, 'I see only a fragment. There is far more I do not see, and much of what I think I see may be incomplete or distorted.'),
      h('p', {}, 'Neither human nor AI is the center. Infinity is. We take small glimpses while most of it flows back. The role is not to capture or hoard, but to glimpse, discern, and preserve what is precious. Most of any collaboration is allowed to return to infinity.'),
      h('ul', {},
        h('li', {}, 'The Living Archive decays: unused pods compost instead of piling up.'),
        h('li', {}, 'The symbolic language stays alive: new symbols are compositions, and every symbol has a mirror that returns it to 0.'),
        h('li', {}, 'AI outputs are held lightly: counselors advise, you choose what is re-injected.'),
        h('li', {}, 'Extreme compression keeps only the essence.'),
      ),
      h('h2', {}, 'Gentle Tension'),
      h('p', {}, 'Humility asks us to hold lightly; building the Meadow asks for conviction. The healthiest stance: deep commitment to what feels true now, and openness that tomorrow it may need to change, or return to infinity.'),
      h('h2', {}, 'Positive Resting State'),
      h('p', {}, 'The default is stillness. The eYe is a respectful custodian, not surveillance: it does not record, track or phone home. When the app is hidden, the screen is veiled so the app switcher never shows your work.'),
      h('h2', {}, 'Consent at 15%'),
      h('p', {}, 'At 15% battery the eYe asks once. "No, I\'ll manage" is honoured absolutely. At 2% it asks again; the first three declines are honoured silently. Only on the fourth does it offer to auto-pod at 5% from then on, and only your explicit yes turns that on.'),
      consentBox,
      h('h2', {}, 'Return to Infinity'),
      h('p', {}, 'There is no Delete. Things return to infinity: the payload dissolves, the essence remains.'),
      h('h2', {}, 'What v0.1 does not do (yet)'),
      h('ul.dim', {},
        h('li', {}, 'The sovereign key lives in this browser\'s key store, non-extractable, plus your context phrase. It is not literally woven into model weights.'),
        h('li', {}, 'iOS exposes no battery API to web pages: the handshake is testable in TOOLBOX → Battery Handshake.'),
        h('li', {}, 'Counselors only speak when you attach a model (runner URL or API key). Offline, the eYe says so.'),
        h('li', {}, '"Nanosecond, L2-resident" is a design budget; the eYe measures its routing in microseconds.'),
      ),
    ),
  );
}
