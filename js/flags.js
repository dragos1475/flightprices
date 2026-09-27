// Steaguri și culori pentru țări (folosite la destinații și aeroporturi).

import { state } from './state.js';
import { fold } from './util.js';

// Numele țărilor din config/destinations.json -> cod ISO (2 litere)
const COUNTRY_ISO = {
  albania: 'AL', armenia: 'AM', austria: 'AT', azerbaidjan: 'AZ', belgia: 'BE', 'bosnia si hertegovina': 'BA',
  bulgaria: 'BG', cehia: 'CZ', cipru: 'CY', croatia: 'HR', danemarca: 'DK', elvetia: 'CH', estonia: 'EE',
  finlanda: 'FI', franta: 'FR', georgia: 'GE', germania: 'DE', grecia: 'GR', irlanda: 'IE', islanda: 'IS',
  italia: 'IT', kosovo: 'XK', letonia: 'LV', lituania: 'LT', luxemburg: 'LU', 'macedonia de nord': 'MK',
  malta: 'MT', 'republica moldova': 'MD', moldova: 'MD', muntenegru: 'ME', norvegia: 'NO', olanda: 'NL',
  polonia: 'PL', portugalia: 'PT', 'regatul unit': 'GB', romania: 'RO', serbia: 'RS', slovacia: 'SK',
  slovenia: 'SI', spania: 'ES', suedia: 'SE', ungaria: 'HU', turcia: 'TR', indonezia: 'ID', thailanda: 'TH',
  vietnam: 'VN', japonia: 'JP', maroc: 'MA', namibia: 'NA', tanzania: 'TZ', tunisia: 'TN',
  // numele în engleză (lista de destinații e acum în engleză)
  azerbaijan: 'AZ', belgium: 'BE', 'bosnia and herzegovina': 'BA', czechia: 'CZ', cyprus: 'CY', denmark: 'DK',
  switzerland: 'CH', finland: 'FI', france: 'FR', germany: 'DE', greece: 'GR', ireland: 'IE', iceland: 'IS',
  italy: 'IT', latvia: 'LV', lithuania: 'LT', luxembourg: 'LU', 'north macedonia': 'MK', montenegro: 'ME',
  norway: 'NO', netherlands: 'NL', poland: 'PL', portugal: 'PT', 'united kingdom': 'GB', slovakia: 'SK',
  spain: 'ES', sweden: 'SE', hungary: 'HU', turkey: 'TR', indonesia: 'ID', thailand: 'TH', japan: 'JP', morocco: 'MA',
};

/** Cod ISO -> emoji steag (🇷🇴). Gol dacă nu știm țara. */
export function flagEmoji(iso) {
  if (!iso || !/^[A-Z]{2}$/.test(iso)) return '';
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function countryIso(countryName) {
  return COUNTRY_ISO[fold(countryName || '').trim()] || '';
}

/** Țara unui aeroport (după cod IATA), din lista de destinații. */
export function airportIso(code) {
  const d = state.config?.destinations.find((x) => x.codes.length === 1 && x.codes[0] === code);
  return d ? countryIso(d.country) : '';
}

/** Țara unei destinații salvate într-o alertă ({id, name, codes}). */
export function destinationIso(dest) {
  if (!dest) return '';
  const d = state.config?.destinations.find((x) => x.id === dest.id);
  if (d) return countryIso(d.country);
  return airportIso(dest.codes?.[0]);
}

/** Steagul unei destinații / al unui aeroport (text gol dacă nu se știe). */
export const destFlag = (dest) => flagEmoji(destinationIso(dest));
export const airportFlag = (code) => flagEmoji(airportIso(code));
export const countryFlag = (name) => flagEmoji(countryIso(name));

/** O nuanță de culoare stabilă pentru o țară (folosită discret pe cardul principal). */
export function countryTint(iso) {
  if (!iso) return '';
  const hue = ([...iso].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 360 + 360) % 360;
  return `hsl(${hue} 75% 55%)`;
}
