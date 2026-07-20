function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, a0, a1) {
  const end = Math.max(a1, a0 + 0.5);
  const s = polar(cx, cy, r, a0);
  const e = polar(cx, cy, r, end);
  const large = end - a0 > 180 ? 1 : 0;
  return ['M', s.x, s.y, 'A', r, r, 0, large, 1, e.x, e.y].join(' ');
}

// value/good/warn w procentach (0-100). Rysuje półkole ze wskaźnikiem celu.
export function renderGauge(el, { value, good, warn }) {
  const w = el.clientWidth || 118;
  const r = w / 2 - 9;
  const cx = w / 2;
  const cy = w / 2 - 2;
  const pct = Math.max(0, Math.min(100, value));
  const color = value >= good ? 'var(--good)' : value >= warn ? 'var(--warning)' : 'var(--critical)';
  const valueAngle = 180 + (180 * pct) / 100;
  const targetAngle = 180 + (180 * good) / 100;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${cy + 14}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(cy + 14));

  const track = document.createElementNS(svg.namespaceURI, 'path');
  track.setAttribute('d', arcPath(cx, cy, r, 180, 360));
  track.setAttribute('stroke', 'var(--track)');
  track.setAttribute('stroke-width', '9');
  track.setAttribute('stroke-linecap', 'round');
  track.setAttribute('fill', 'none');

  const val = document.createElementNS(svg.namespaceURI, 'path');
  val.setAttribute('d', arcPath(cx, cy, r, 180, valueAngle));
  val.setAttribute('stroke', color);
  val.setAttribute('stroke-width', '9');
  val.setAttribute('stroke-linecap', 'round');
  val.setAttribute('fill', 'none');

  svg.appendChild(track);
  svg.appendChild(val);

  if (good < 100) {
    const tp = polar(cx, cy, r, targetAngle);
    const tp2 = polar(cx, cy, r + 6, targetAngle);
    const tick = document.createElementNS(svg.namespaceURI, 'line');
    tick.setAttribute('x1', tp.x);
    tick.setAttribute('y1', tp.y);
    tick.setAttribute('x2', tp2.x);
    tick.setAttribute('y2', tp2.y);
    tick.setAttribute('stroke', 'var(--text-muted)');
    tick.setAttribute('stroke-width', '2');
    svg.appendChild(tick);
  }

  el.innerHTML = '';
  el.appendChild(svg);
}
