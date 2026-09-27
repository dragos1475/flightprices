// Comutatorul EUR/RON din cardul principal și nota despre curs.

import { cachedRate, displayCurrency, refreshRate, setDisplayCurrency } from './currency.js';
import { haptic } from './motion.js';
import { longDate, toast } from './util.js';

/** Butoanele EUR | RON. native = moneda alertei; shown = moneda afișată acum. */
export function currencyToggle(native, shown) {
  return `<div class="seg cur-toggle" role="group" aria-label="Display currency">
    ${['EUR', 'RON'].map((c) => `<button type="button" data-cur-show="${c}" data-native="${native}" aria-pressed="${shown === c}">${c}</button>`).join('')}
  </div>`;
}

/** Nota „convertit la cursul BCE…”, doar când prețurile sunt convertite. */
export function convertedNote(disp) {
  if (!disp.converted || !disp.rate) return '';
  const r = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4 }).format(disp.rate.rate);
  return `<div class="converted-note">≈ converted at the ECB rate of ${longDate(disp.rate.date)}: 1 EUR = ${r} RON</div>`;
}

/** La apăsare: salvăm preferința și redesenăm ecranul curent. */
export function bindCurrencyToggle(root) {
  root.querySelectorAll('[data-cur-show]').forEach((b) => b.addEventListener('click', async () => {
    const want = b.dataset.curShow;
    const next = want === b.dataset.native ? '' : want;
    if (next === displayCurrency()) return;
    haptic();
    if (next && !cachedRate()) {
      b.disabled = true;
      const rate = await refreshRate();
      b.disabled = false;
      if (!rate) {
        toast('Could not get the EUR/RON rate. Try again when you are online.');
        return;
      }
    }
    setDisplayCurrency(next);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }));
}
