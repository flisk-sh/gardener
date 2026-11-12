// The drawing. Pure code: a tower JSON goes in, an SVG string comes out. Same repo, same wobble (seeded).
const W = 1500;
const H = 1920;
const INK = '#222';
const FONT = 'Chalkboard SE, Marker Felt, Comic Sans MS, sans-serif';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function seedOf(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Break a label into lines of at most `max` characters, on spaces.
export function wrap(text, max) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > max) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

// Shrink a font until the text fits the width; cut it with an ellipsis as a last resort.
export function fit(text, size, maxWidth) {
  let s = size;
  let t = String(text);
  while (t.length * s * 0.58 > maxWidth && s > size * 0.6) s -= 1;
  const room = Math.floor(maxWidth / (s * 0.58));
  if (t.length > room) t = `${t.slice(0, Math.max(1, room - 1))}…`;
  return { text: t, size: s };
}

export function renderTower(tower, { seed = tower.title || 'tower' } = {}) {
  const R = rng(seedOf(String(seed)));
  const out = [];
  const add = (s) => out.push(s);
  const jit = (v, a = 2.2) => v + (R() * 2 - 1) * a;

  const poly = (pts, fill = '#fff', sw = 2.6, a = 2) => add(`<polygon points="${pts.map(([x, y]) => `${jit(x, a).toFixed(1)},${jit(y, a).toFixed(1)}`).join(' ')}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`);
  const box = (x, y, w, h, fill = '#fff', sw = 2.6, a = 2, rot = 0) => {
    if (rot) add(`<g transform="rotate(${rot} ${x + w / 2} ${y + h / 2})">`);
    poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], fill, sw, a);
    if (rot) add('</g>');
  };
  const text = (x, y, s, size = 24, { anchor = 'middle', rot = 0, fill = INK, weight = 'normal', maxWidth = 0 } = {}) => {
    if (s == null || String(s).trim() === '') return;
    const lines = Array.isArray(s) ? s : String(s).split('\n');
    const lh = size * 1.18;
    const tr = rot ? ` transform="rotate(${rot} ${x} ${y})"` : '';
    add(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" text-anchor="${anchor}" fill="${fill}" font-weight="${weight}"${tr}>`);
    lines.forEach((ln, i) => {
      const f = maxWidth ? fit(ln, size, maxWidth) : { text: ln, size };
      add(`<tspan x="${x}" dy="${i === 0 ? 0 : lh}"${f.size !== size ? ` font-size="${f.size}"` : ''}>${esc(f.text)}</tspan>`);
    });
    add('</text>');
  };
  const curve = (p0, c, p1, sw = 2.4) => {
    add(`<path d="M${p0[0]},${p0[1]} Q${c[0]},${c[1]} ${p1[0]},${p1[1]}" fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round"/>`);
    const ang = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
    for (const d of [2.55, -2.55]) add(`<line x1="${p1[0]}" y1="${p1[1]}" x2="${(p1[0] + 16 * Math.cos(ang + d)).toFixed(1)}" y2="${(p1[1] + 16 * Math.sin(ang + d)).toFixed(1)}" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round"/>`);
  };
  const cluster = (x0, x1, ytop, ybot, taper = 0, tall = true) => {
    let y = ybot;
    const total = ybot - ytop;
    while (y > ytop + 6) {
      const t = (ybot - y) / total;
      const cx0 = x0 + ((x1 - x0) * taper * t) / 2;
      const cx1 = x1 - ((x1 - x0) * taper * t) / 2;
      const h = 10 + R() * 16;
      let x = cx0 + R() * 8;
      while (x < cx1 - 8) {
        const w = Math.min(9 + R() * 25, cx1 - x);
        const hh = h * (0.7 + R() * 0.6);
        const fill = ['#fff', '#fff', '#f0f0f0', '#e4e4e4'][Math.floor(R() * 4)];
        poly([[x, y - hh], [x + w, y - hh], [x + w, y], [x, y]], fill, 1.7, 1);
        if (R() < 0.12 && tall) {
          const th = 30 + R() * 40;
          poly([[x + w * 0.3, y - hh - th], [x + w * 0.7, y - hh - th], [x + w * 0.7, y - hh], [x + w * 0.3, y - hh]], '#fff', 1.6, 0.8);
        }
        x += w + R() * 6;
      }
      y -= h;
    }
  };
  const person = (x, y, s = 1, up = false) => {
    add(`<g stroke="${INK}" stroke-width="${2.2 * s}" fill="none" stroke-linecap="round"><circle cx="${x}" cy="${y}" r="${9 * s}" fill="#fff"/><line x1="${x}" y1="${y + 9 * s}" x2="${x}" y2="${y + 34 * s}"/>`);
    add(up ? `<line x1="${x}" y1="${y + 16 * s}" x2="${x - 14 * s}" y2="${y + 2 * s}"/><line x1="${x}" y1="${y + 16 * s}" x2="${x + 14 * s}" y2="${y + 2 * s}"/>` : `<line x1="${x}" y1="${y + 16 * s}" x2="${x - 13 * s}" y2="${y + 28 * s}"/><line x1="${x}" y1="${y + 16 * s}" x2="${x + 13 * s}" y2="${y + 28 * s}"/>`);
    add(`<line x1="${x}" y1="${y + 34 * s}" x2="${x - 11 * s}" y2="${y + 56 * s}"/><line x1="${x}" y1="${y + 34 * s}" x2="${x + 11 * s}" y2="${y + 56 * s}"/></g>`);
  };

  const t = tower;
  const lines = (s, n) => wrap(s || '', n);

  add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`Dependency tower of ${t.title || 'a repo'}`)}">`);
  add('<defs><style>.sway{transform-origin:610px 1900px;animation:sway 9s ease-in-out infinite alternate}@keyframes sway{0%{transform:rotate(-1.6deg)}45%{transform:rotate(.4deg)}100%{transform:rotate(1.6deg)}}@media (prefers-reduced-motion:reduce){.sway{animation:none}}</style><filter id="wob" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.2"/></filter></defs>');
  add(`<rect width="${W}" height="${H}" fill="#fff"/><g class="sway"><g filter="url(#wob)">`);

  // ---- foundations
  [330, 540, 770, 970].forEach((x, i) => {
    add(`<path d="M${x},1920 L${x + 8},1800 Q${x + 75},1780 ${x + 142},1800 L${x + 150},1920 Z" fill="#eee" stroke="${INK}" stroke-width="2.6"/>`);
    text(i === 3 ? 1005 : x + 75, 1870, t.foundation?.stones?.[i], 18, { maxWidth: 130 });
  });
  poly([[300, 1740], [1140, 1740], [1140, 1795], [300, 1795]]);
  text(660, 1776, t.foundation?.text, 22, { maxWidth: 700 });

  // ---- runtime planks
  box(470, 1706, 500, 28, '#fff', 2.4);
  text(720, 1727, t.runtime?.bar, 17, { maxWidth: 460 });
  box(500, 1664, 10, 42, '#fff', 2, 0.8);
  box(930, 1664, 10, 42, '#fff', 2, 0.8);
  box(440, 1640, 560, 24);
  if (t.runtime?.tool) {
    text(380, 1640, [t.runtime.tool, t.runtime.toolNote ? `(${t.runtime.toolNote})` : ''].filter(Boolean), 22, { anchor: 'end', maxWidth: 230 });
    curve([385, 1648], [410, 1662], [440, 1654]);
  }

  // ---- core
  box(560, 1590, 320, 48, '#e9e9e9', 2.6, 2);
  add(`<ellipse cx="640" cy="1585" rx="74" ry="16" fill="#fff" stroke="${INK}" stroke-width="2.4"/>`);
  text(720, 1620, t.core?.disc, 17, { maxWidth: 300 });
  box(540, 1500, 360, 84, '#fff', 2.8, 2.5);
  text(720, 1554, t.core?.title, 34, { maxWidth: 330 });
  text(720, 1576, t.core?.note, 13, { maxWidth: 330 });

  // ---- hosted service and badge
  add(`<path d="M250,1455 q-4,-22 22,-22 q8,-24 36,-14 q26,-14 44,8 q30,0 28,28 z" fill="#fff" stroke="${INK}" stroke-width="2.4"/>`);
  text(310, 1478, t.cloud?.word, 17, { maxWidth: 110 });
  if (t.cloud?.label) {
    text(245, 1385, lines(t.cloud.label, 20), 21, { anchor: 'end', maxWidth: 230 });
    curve([350, 1450], [430, 1505], [545, 1530]);
  }
  if (t.badge) {
    text(190, 1530, lines(t.badge, 14), 24, { maxWidth: 220 });
    curve([290, 1545], [430, 1620], [560, 1612]);
  }

  // ---- middle slab
  box(470, 1400, 460, 96, '#f4f4f4', 2.8, 2.5);
  text(700, 1450, t.middle?.title, 40, { maxWidth: 420 });
  text(700, 1480, t.middle?.note, 14, { maxWidth: 420 });

  // ---- crane and unpaid maintainers
  add(`<line x1="935" y1="1490" x2="1010" y2="1470" stroke="${INK}" stroke-width="3"/><line x1="935" y1="1462" x2="1010" y2="1448" stroke="${INK}" stroke-width="3"/><line x1="1010" y1="1470" x2="1080" y2="1470" stroke="${INK}" stroke-width="5"/><ellipse cx="1090" cy="1455" rx="10" ry="30" fill="#fff" stroke="${INK}" stroke-width="2.4"/>`);
  text(1180, 1445, lines(t.crane?.title, 8), 30, { maxWidth: 150 });
  text(1180, 1500, lines(t.crane?.note, 24), 15, { maxWidth: 200 });
  if (t.oss) {
    text(1130, 1612, lines(t.oss, 17), 22, { anchor: 'start', maxWidth: 300 });
    curve([1120, 1620], [1000, 1620], [902, 1570]);
    person(1050, 1580, 0.9, true);
    box(1018, 1545, 66, 22, '#f0f0f0', 2.2, 1);
    text(1051, 1562, String(t.core?.title || '').split(' ')[0], 11, { maxWidth: 60 });
  }

  // ---- lower towers
  box(420, 1250, 300, 150, '#f4f4f4', 2.8, 2.5);
  text(570, 1312, t.left?.title, 28, { maxWidth: 270 });
  text(570, 1342, t.left?.stat, 22, { maxWidth: 270 });
  text(570, 1368, t.left?.note, 12, { maxWidth: 270 });
  cluster(430, 700, 1050, 1250, 0.45);
  box(425, 1245, 285, 9, '#fff', 2, 0.6);
  box(330, 1124, 150, 22, '#fff', 2.2, 2, -18);
  box(740, 1280, 200, 120, '#f4f4f4', 2.8, 2.5);
  text(840, 1326, t.right?.title, 26, { maxWidth: 180 });
  text(840, 1352, t.right?.stat, 18, { maxWidth: 180 });
  text(840, 1376, t.right?.note, 15, { maxWidth: 180 });
  cluster(745, 935, 1060, 1280, 0.35);
  box(750, 1272, 180, 9, '#fff', 2, 0.6);
  add(`<line x1="700" y1="1420" x2="760" y2="1390" stroke="${INK}" stroke-width="2.2"/>`);
  if (t.red?.title) {
    text(1090, 1140, [t.red.title, t.red.note ? `(${t.red.note})` : ''].filter(Boolean), 24, { anchor: 'start', fill: '#c4161c', weight: 'bold', maxWidth: 330 });
    curve([1085, 1160], [1000, 1210], [905, 1180]);
  }

  // ---- upper stack
  box(520, 1010, 360, 24, '#fff', 2.4, 1.8);
  cluster(600, 800, 930, 1010, 0.2, false);
  box(675, 880, 50, 52, '#fff', 2.4, 1.5);
  if (t.neck?.title) {
    text(1010, 925, t.neck.title, 28, { anchor: 'start', maxWidth: 400 });
    text(1010, 952, t.neck.note ? `(${t.neck.note})` : '', 15, { anchor: 'start', maxWidth: 400 });
    curve([1005, 915], [900, 900], [730, 905]);
  }
  cluster(560, 840, 700, 880, 0.3);
  poly([[560, 800], [640, 780], [668, 840], [610, 878], [556, 850]], '#fff', 2.6);
  const pent = t.upper?.pentagon || [];
  text(612, 816, pent[0], 19, { maxWidth: 78 });
  text(612, 836, pent[1], 19, { maxWidth: 78 });
  text(610, 856, t.upper?.pentagonNote, 11, { maxWidth: 78 });
  cluster(590, 790, 500, 700, 0.4);
  poly([[640, 660], [760, 645], [730, 580]], '#fff', 2.6);
  text(708, 636, t.upper?.triangle, 14, { maxWidth: 70 });
  poly([[610, 590], [700, 540], [790, 585], [700, 600]], '#f4f4f4', 2.4);
  text(700, 580, t.upper?.plank, 12, { maxWidth: 160 });
  cluster(620, 780, 390, 540, 0.6);
  cluster(650, 750, 310, 400, 0.7);
  poly([[690, 308], [712, 308], [710, 290], [692, 290]], '#fff', 2.2, 1);
  add(`<line x1="704" y1="250" x2="704" y2="288" stroke="${INK}" stroke-width="2.4"/><circle cx="704" cy="246" r="5" fill="#fff" stroke="${INK}" stroke-width="1.8"/>`);
  text(620, 70, 'YOU ARE', 38);
  text(620, 112, 'HERE', 38);
  curve([660, 128], [700, 170], [702, 238]);

  // ---- zoom
  add(`<circle cx="1160" cy="190" r="118" fill="#fff" stroke="${INK}" stroke-width="2.8"/><line x1="712" y1="247" x2="1070" y2="100" stroke="${INK}" stroke-width="2.2"/><line x1="712" y1="257" x2="1090" y2="285" stroke="${INK}" stroke-width="2.2"/>`);
  box(1095, 240, 40, 22, '#e4e4e4', 2, 1);
  box(1130, 222, 34, 40, '#fff', 2, 1);
  box(1160, 245, 50, 17, '#f0f0f0', 2, 1);
  person(1150, 170, 0.75, true);
  if (t.zoom?.say) {
    add(`<ellipse cx="1220" cy="126" rx="52" ry="26" fill="#fff" stroke="${INK}" stroke-width="1.8"/>`);
    text(1220, 124, t.zoom.say, 14, { maxWidth: 90 });
    text(1220, 140, t.zoom.aside, 12, { maxWidth: 90 });
  }

  // ---- braces
  add(`<path d="M420,300 q-50,0 -52,40 l-4,230 q-2,40 -50,50 q48,10 50,50 l4,230 q2,40 52,40" fill="none" stroke="${INK}" stroke-width="3.4"/>`);
  text(215, 640, lines(t.braces?.left, 12), 36, { rot: -78, maxWidth: 420 });
  add(`<path d="M880,330 q50,0 55,40 l6,200 q4,30 46,38 q-42,8 -46,38 l-6,200 q-5,40 -55,40" fill="none" stroke="${INK}" stroke-width="3.4" transform="translate(30,0) scale(1,0.92)"/>`);
  text(1040, 440, lines(t.braces?.right, 22), 24, { anchor: 'start', maxWidth: 420 });

  // ---- insets
  const FRAMES = [{ x: 1060, y: 985, w: 220, h: 100 }, { x: 35, y: 1110, w: 270, h: 170 }, { x: 1100, y: 580, w: 190, h: 110 }, { x: 1090, y: 1230, w: 200, h: 150 }, { x: 40, y: 150, w: 230, h: 80 }, { x: 20, y: 1768, w: 290, h: 90 }];
  const drawKind = (kind, x, y, w, h) => {
    const s = Math.min(w / 200, h / 100);
    const cx = x + w / 2;
    const cy = y + h / 2;
    if (kind === 'tests') {
      for (let i = 0; i < 6; i++) box(cx - 60 * s + i * 3, y + h - 14 * s - i * 11 * s, 120 * s, 11 * s, i % 2 ? '#fff' : '#f0f0f0', 1.8, 0.8);
    } else if (kind === 'notes') {
      ['TODO', 'FIXME', 'HACK', 'TODO'].forEach((label, i) => {
        const nx = x + 14 * s + i * 46 * s;
        const ny = y + (h - 40 * s) / 2 + (i % 2) * 6 * s;
        box(nx, ny, 40 * s, 38 * s, '#ffe27a', 1.8, 1, (i % 2 ? 4 : -5));
        text(nx + 20 * s, ny + 24 * s, label, Math.max(8, 9 * s));
      });
    } else if (kind === 'nosign') {
      add(`<circle cx="${cx}" cy="${cy}" r="${30 * s}" fill="none" stroke="#c4161c" stroke-width="6"/><line x1="${cx - 21 * s}" y1="${cy - 21 * s}" x2="${cx + 21 * s}" y2="${cy + 21 * s}" stroke="#c4161c" stroke-width="6"/>`);
    } else if (kind === 'scroll') {
      add(`<path d="M${cx - 55 * s},${y + 14 * s} h${110 * s} v${h - 36 * s} q0,${12 * s} ${-12 * s},${12 * s} h${-86 * s} q${-12 * s},0 ${-12 * s},${-12 * s} z" fill="#fff" stroke="${INK}" stroke-width="2.4"/>`);
      for (let k = 0; k < 6; k++) add(`<line x1="${cx - 42 * s}" y1="${y + 30 * s + k * 10 * s}" x2="${cx + 42 * s - (k % 3) * 12 * s}" y2="${y + 30 * s + k * 10 * s}" stroke="${INK}" stroke-width="1.6"/>`);
    } else if (kind === 'ghost') {
      add(`<path d="M${cx - 34 * s},${y + h - 12 * s} v${-38 * s} q0,${-30 * s} ${34 * s},${-30 * s} q${34 * s},0 ${34 * s},${30 * s} v${38 * s} l${-11 * s},${-10 * s} l${-11 * s},${10 * s} l${-12 * s},${-10 * s} l${-12 * s},${10 * s} l${-11 * s},${-10 * s} z" fill="#fff" stroke="${INK}" stroke-width="2.4"/><circle cx="${cx - 12 * s}" cy="${cy - 6 * s}" r="${5 * s}" fill="#222"/><circle cx="${cx + 12 * s}" cy="${cy - 6 * s}" r="${5 * s}" fill="#222"/>`);
    } else if (kind === 'tiny') {
      box(cx - 35 * s, cy - 19 * s, 70 * s, 38 * s, '#fff', 2.2, 1);
      box(cx - 27 * s, cy - 11 * s, 54 * s, 6 * s, '#e4e4e4', 1.4, 0.5);
      box(cx - 27 * s, cy + 1 * s, 36 * s, 6 * s, '#e4e4e4', 1.4, 0.5);
    } else {
      // tape (and any other kind): a strip of duct tape
      box(x + 30 * s, cy - 20 * s, w - 60 * s, 40 * s, '#d9d9d9', 2.4, 1.5, -3);
      for (let k = 0; k < 8; k++) add(`<line x1="${x + 38 * s + k * 20 * s}" y1="${cy - 17 * s}" x2="${x + 50 * s + k * 20 * s}" y2="${cy + 17 * s}" stroke="${INK}" stroke-width="1.6"/>`);
    }
  };
  let frame = 0;
  let shark = null;
  for (const item of t.insets || []) {
    if (item.kind === 'rocket') {
      add('<g transform="translate(190,890) rotate(-28)">');
      poly([[-60, 0], [50, -22], [90, 0], [50, 22]], '#fff', 2.6, 1);
      poly([[-30, -4], [-52, -28], [-8, -12]], '#fff', 2.2, 1);
      poly([[-30, 4], [-52, 28], [-8, 12]], '#fff', 2.2, 1);
      add(`<circle cx="25" cy="0" r="9" fill="#fff" stroke="${INK}" stroke-width="2.2"/>`);
      [-12, -4, 6, 14].forEach((y, k) => add(`<line x1="${-70 - k * 14}" y1="${y}" x2="${-125 - k * 10}" y2="${y}" stroke="${INK}" stroke-width="2"/>`));
      add('<polygon points="-62,-6 -80,2 -66,4 -78,14 -56,6" fill="#f0b000" stroke="#222" stroke-width="1.5"/></g>');
      text(170, 1005, lines(item.caption, 24), 22, { maxWidth: 260 });
    } else if (item.kind === 'bird') {
      add(`<circle cx="1190" cy="785" r="42" fill="#c4161c" stroke="${INK}" stroke-width="2.6"/><circle cx="1176" cy="778" r="9" fill="#fff" stroke="${INK}" stroke-width="1.6"/><circle cx="1203" cy="778" r="9" fill="#fff" stroke="${INK}" stroke-width="1.6"/><circle cx="1178" cy="780" r="3" fill="#222"/><circle cx="1201" cy="780" r="3" fill="#222"/><line x1="1165" y1="762" x2="1190" y2="772" stroke="${INK}" stroke-width="3.2"/><line x1="1215" y1="762" x2="1192" y2="772" stroke="${INK}" stroke-width="3.2"/><polygon points="1184,792 1202,792 1193,806" fill="#f0b000" stroke="${INK}" stroke-width="1.6"/>`);
      [765, 780, 795].forEach((y) => add(`<line x1="1105" y1="${y}" x2="1135" y2="${y - 4}" stroke="${INK}" stroke-width="2"/>`));
      text(1320, 850, lines(item.caption, 16), 20, { maxWidth: 220 });
    } else if (item.kind === 'shark') {
      shark = item;
    } else if (frame < FRAMES.length) {
      const f = FRAMES[frame++];
      box(f.x, f.y, f.w, f.h, '#fff', 2.2, 1.4);
      drawKind(item.kind, f.x, f.y, f.w, f.h);
      const cap = f.y + f.h > 1350 && f.x > 1000 ? [item.caption] : lines(item.caption, Math.floor(f.w / 9.5));
      text(f.x + f.w / 2, f.y + f.h + 26, cap, 19, { maxWidth: f.w + 80 });
    }
  }
  add('</g></g>');
  text(1440, 36, t.title, 16, { anchor: 'end', fill: '#777', maxWidth: 300 });
  if (shark) {
    add(`<rect x="1040" y="1690" width="400" height="210" fill="#bfe3ec" stroke="${INK}" stroke-width="3"/><path d="M1040,1760 q40,-10 80,0 t80,0 t80,0 t80,0 t80,0" fill="none" stroke="#fff" stroke-width="3" opacity=".8"/><path d="M1110,1830 q80,-50 170,-20 q40,-30 70,-40 q-6,30 -20,40 q30,10 40,30 q-40,-6 -60,-4 q-70,40 -180,10 q-20,-10 -20,-16 z" fill="#8a99a4" stroke="${INK}" stroke-width="2.6"/><polygon points="1230,1815 1250,1775 1268,1812" fill="#8a99a4" stroke="${INK}" stroke-width="2.4"/><circle cx="1148" cy="1826" r="3.2" fill="#222"/>`);
    text(1240, 1722, lines(shark.caption, 30), 20, { fill: '#134', maxWidth: 380 });
  }
  add('</svg>');
  return out.join('\n');
}
