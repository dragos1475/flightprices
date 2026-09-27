// Harta traseului: un glob cu arcul real al zborului (cercul mare), distanța și durata.
// Bibliotecile (d3-geo, topojson) și conturul țărilor se încarcă de pe CDN doar când e nevoie.

import { reducedMotion } from './motion.js';
import { h } from './util.js';

let libs = null;
async function loadLibs() {
  if (!libs) {
    libs = Promise.all([
      import('https://cdn.jsdelivr.net/npm/d3-geo@3/+esm'),
      import('https://cdn.jsdelivr.net/npm/topojson-client@3/+esm'),
      fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then((r) => r.json()),
    ]).catch((e) => {
      libs = null;
      throw e;
    });
  }
  return libs;
}

/**
 * from/to: {lat, lon}; labels: {from: 'OTP', to: 'FCO'}.
 * Desenează globul în container. Întoarce false dacă nu s-a putut (ex. fără internet).
 */
export async function renderRouteMap(container, from, to, labels) {
  let d3;
  let topojson;
  let world;
  try {
    [d3, topojson, world] = await loadLibs();
  } catch {
    return false;
  }
  const land = topojson.feature(world, world.objects.countries);
  const W = Math.max(280, container.clientWidth || 320);
  const H = 210;
  const a = [from.lon, from.lat];
  const b = [to.lon, to.lat];
  const mid = d3.geoInterpolate(a, b)(0.5);

  // Hartă cu nordul în sus, centrată pe mijlocul traseului.
  // Zoom: cât de mult încât ambele capete să încapă în cadru (cu margini pentru etichete).
  const projection = d3.geoOrthographic().translate([W / 2, H / 2]).clipAngle(90).rotate([-mid[0], -mid[1], 0]).scale(1);
  const u1 = projection(a);
  const u2 = projection(b);
  const ex = Math.max(Math.abs(u1[0] - W / 2), Math.abs(u2[0] - W / 2), 1e-6);
  const ey = Math.max(Math.abs(u1[1] - H / 2), Math.abs(u2[1] - H / 2), 1e-6);
  const fit = Math.min((W / 2 - 44) / ex, (H / 2 - 30) / ey);
  projection.scale(Math.min(Math.max(fit, H / 2 - 8), W * 6));

  const path = d3.geoPath(projection);
  const route = { type: 'LineString', coordinates: [a, b] };
  const [x1, y1] = projection(a);
  const [x2, y2] = projection(b);
  const animate = !reducedMotion();

  container.innerHTML = `
    <svg class="route-map" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
      aria-label="Harta traseului ${h(labels.from)} – ${h(labels.to)}">
      <path class="map-sphere" d="${path({ type: 'Sphere' })}"/>
      <path class="map-grid" d="${path(d3.geoGraticule10())}"/>
      <path class="map-land" d="${path(land)}"/>
      <path class="map-route ${animate ? 'draw' : ''}" pathLength="1" d="${path(route)}"/>
      <circle class="map-dot" cx="${x1}" cy="${y1}" r="4.5"/>
      <circle class="map-dot end" cx="${x2}" cy="${y2}" r="4.5"/>
      <text class="map-label" x="${x1}" y="${y1 + 18}" text-anchor="middle">${h(labels.from)}</text>
      <text class="map-label" x="${x2}" y="${y2 + 18}" text-anchor="middle">${h(labels.to)}</text>
    </svg>`;
  return true;
}
