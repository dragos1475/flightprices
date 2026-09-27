// Grafic simplu (SVG) cu evoluția prețului minim în timp, câte o linie pe combinație.
// Culorile vin din CSS (--s1 ... --s8), în ordine fixă: aceeași combinație are mereu aceeași culoare.

import { h, money, shortDate, dayDate } from './util.js';

export const SERIES_COLORS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];
const NS = 'http://www.w3.org/2000/svg';

function niceStep(range, ticks) {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

/**
 * Desenează graficul în `container`.
 * series: [{label, color: '--s1', points: [{date: 'AAAA-LL-ZZ', price: 123}]}]
 */
export function renderChart(container, { series, threshold, currency }) {
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  if (!dates.length) {
    container.innerHTML = '<p class="muted small">Încă nu există istoric. Graficul apare după primele rulări.</p>';
    return;
  }

  // Legenda (mereu prezentă pentru ≥ 2 linii; identitatea nu depinde doar de culoare)
  const legend = series.length > 1 || threshold
    ? `<ul class="legend">${series.map((s) => `<li><i style="background:var(${s.color})"></i>${h(s.label)}</li>`).join('')}
       ${threshold ? '<li><i style="background:none;border-top:2px dashed var(--text-2);height:0"></i>Prag</li>' : ''}</ul>`
    : '';
  container.innerHTML = `${legend}<div class="chart"><div class="tooltip" hidden></div></div>`;
  const wrap = container.querySelector('.chart');
  const tip = wrap.querySelector('.tooltip');

  const draw = () => {
    wrap.querySelector('svg')?.remove();
    const W = Math.max(280, wrap.clientWidth || 320);
    const H = Math.round(Math.min(260, Math.max(180, W * 0.5)));
    const m = { top: 12, right: 12, bottom: 26, left: 44 };
    const iw = W - m.left - m.right;
    const ih = H - m.top - m.bottom;

    const prices = series.flatMap((s) => s.points.map((p) => p.price));
    if (threshold) prices.push(threshold);
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    if (lo === hi) { lo -= 10; hi += 10; }
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;

    const x = (d) => m.left + (dates.length === 1 ? iw / 2 : (dates.indexOf(d) / (dates.length - 1)) * iw);
    const y = (v) => m.top + ih - ((v - lo) / (hi - lo)) * ih;

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Evoluția prețului minim, ${dates.length} zile`);

    let html = '<g class="axis">';
    for (let v = lo; v <= hi + 1e-9; v += step) {
      html += `<line class="gridline" x1="${m.left}" x2="${W - m.right}" y1="${y(v)}" y2="${y(v)}"/>`;
      html += `<text x="${m.left - 6}" y="${y(v) + 4}" text-anchor="end">${money(v)}</text>`;
    }
    // etichete pe axa X: maxim ~6, ca să nu se suprapună
    const every = Math.max(1, Math.ceil(dates.length / Math.max(2, Math.floor(iw / 70))));
    const last = dates.length - 1;
    dates.forEach((d, i) => {
      // ultima dată apare mereu; o ascundem pe cea de dinainte dacă ar fi prea aproape
      if ((i % every === 0 && last - i >= every) || i === last) {
        html += `<text x="${x(d)}" y="${H - 8}" text-anchor="middle">${shortDate(d)}</text>`;
      }
    });
    html += '</g>';

    if (threshold) {
      html += `<line class="threshold" x1="${m.left}" x2="${W - m.right}" y1="${y(threshold)}" y2="${y(threshold)}"/>`;
    }

    for (const s of series) {
      const pts = s.points.filter((p) => dates.includes(p.date));
      if (!pts.length) continue;
      if (pts.length > 1) {
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.price).toFixed(1)}`).join('');
        html += `<path class="series" d="${d}" style="stroke:var(${s.color})"/>`;
      }
      const end = pts[pts.length - 1];
      html += `<circle class="dot" r="4" cx="${x(end.date)}" cy="${y(end.price)}" style="fill:var(${s.color})"/>`;
    }
    if (threshold) {
      html += `<text class="threshold-label" x="${m.left + 4}" y="${y(threshold) - 5}">prag ${money(threshold)}</text>`;
    }
    html += `<line class="crosshair" y1="${m.top}" y2="${m.top + ih}" x1="0" x2="0" visibility="hidden"/>`;
    html += `<g class="hover-dots"></g>`;
    html += `<rect x="${m.left}" y="0" width="${iw}" height="${H}" fill="transparent" class="hit"/>`;
    svg.innerHTML = html;
    wrap.prepend(svg);

    // Interacțiune: cursor / atingere -> linie verticală + valorile din acea zi
    const cross = svg.querySelector('.crosshair');
    const hoverDots = svg.querySelector('.hover-dots');
    const hit = svg.querySelector('.hit');
    const show = (evt) => {
      const rect = svg.getBoundingClientRect();
      const px = ((evt.clientX - rect.left) / rect.width) * W;
      let best = dates[0];
      for (const d of dates) if (Math.abs(x(d) - px) < Math.abs(x(best) - px)) best = d;
      const cx = x(best);
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.setAttribute('visibility', 'visible');
      const rows = series
        .map((s) => ({ s, p: s.points.find((p) => p.date === best) }))
        .filter((r) => r.p)
        .sort((a, b) => a.p.price - b.p.price);
      hoverDots.innerHTML = rows.map((r) =>
        `<circle class="dot" r="5" cx="${cx}" cy="${y(r.p.price)}" style="fill:var(${r.s.color})"/>`).join('');
      tip.innerHTML = `<b>${dayDate(best)}</b>` + rows.map((r) =>
        `<div class="row"><span><i style="background:var(${r.s.color})"></i> ${h(r.s.label)}</span><b class="num">${money(r.p.price, currency)}</b></div>`).join('');
      tip.hidden = false;
      const left = (cx / W) * rect.width;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(0, left + 12 + tw > rect.width ? left - tw - 12 : left + 12), rect.width - tw)}px`;
      tip.style.top = '8px';
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      hoverDots.innerHTML = '';
      tip.hidden = true;
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);
  };

  draw();
  // Redesenăm la schimbarea lățimii (rotirea telefonului)
  let lastW = wrap.clientWidth;
  const ro = new ResizeObserver(() => {
    if (Math.abs(wrap.clientWidth - lastW) > 4) {
      lastW = wrap.clientWidth;
      draw();
    }
  });
  ro.observe(wrap);
}
