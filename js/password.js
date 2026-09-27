// Parola de căutare: o cerem când pornim ceva care consumă credite SerpApi
// (căutare rapidă, „Preț la companie”). Parola nu pleacă de pe telefon: se trimite doar o semnătură.

import { icon } from './icons.js';

export const PASSWORD_KEY = 'zboruri.search_password';

function dialog() {
  let dlg = document.getElementById('password-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.id = 'password-dialog';
    document.body.append(dlg);
  }
  return dlg;
}

/**
 * Cere parola (sau o folosește pe cea memorată până la închiderea aplicației).
 * opts: {action: textul butonului, note: un rând în plus, ex. costul}. Întoarce parola sau null.
 */
export function askPassword({ action = 'Search', note = '' } = {}) {
  let remembered = '';
  try { remembered = sessionStorage.getItem(PASSWORD_KEY) || ''; } catch { /* indisponibil */ }
  if (remembered) return Promise.resolve(remembered);
  const dlg = dialog();
  dlg.innerHTML = `
    <form method="dialog" id="pw-form">
      <h2>${icon('key', 18, 'inline')} Search password</h2>
      ${note ? `<p><b>${note}</b></p>` : ''}
      <p>Your password never leaves the phone: only a signature is sent, verified by GitHub with the <code>SEARCH_PASSWORD</code> secret.</p>
      <input type="password" id="pw-input" autocomplete="current-password" placeholder="Password" required>
      <label class="small" style="display:flex;gap:8px;align-items:center;margin-top:10px">
        <input type="checkbox" id="pw-remember"> Remember until I close the app</label>
      <div class="btn-row">
        <button type="button" class="btn" id="pw-cancel">Cancel</button>
        <button type="submit" class="btn primary">${action}</button>
      </div>
    </form>`;
  return new Promise((resolve) => {
    dlg.querySelector('#pw-cancel').onclick = () => { dlg.close(); resolve(null); };
    dlg.querySelector('#pw-form').onsubmit = (e) => {
      e.preventDefault();
      const pw = dlg.querySelector('#pw-input').value;
      if (!pw) return;
      if (dlg.querySelector('#pw-remember').checked) {
        try { sessionStorage.setItem(PASSWORD_KEY, pw); } catch { /* indisponibil */ }
      }
      dlg.close();
      resolve(pw);
    };
    dlg.showModal();
    setTimeout(() => dlg.querySelector('#pw-input').focus(), 50);
  });
}
