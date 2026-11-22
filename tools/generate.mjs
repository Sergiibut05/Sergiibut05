// Generates every SVG used in the profile README (../assets).
//
//   cd tools && npm install && npm run build
//
// All text is converted to vector paths (Space Grotesk + JetBrains Mono), so the
// artwork looks identical on every OS and inside GitHub's image proxy, where
// web fonts and scripts are not allowed. Animations use SMIL and CSS only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import * as simpleIcons from 'simple-icons';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../assets');
fs.mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ */
/* Design tokens                                                       */
/* ------------------------------------------------------------------ */

const THEMES = {
  dark: {
    name: 'dark',
    bg: '#0B0C10',
    surface: '#13151B',
    border: '#262A35',
    soft: '#1D2029',
    text: '#EDEBE6',
    muted: '#9097A4',
    faint: '#4D5464',
    accent: '#FF6B3D',
    onAccent: '#170B06',
  },
  light: {
    name: 'light',
    bg: '#FAF9F6',
    surface: '#FFFFFF',
    border: '#E2DFD8',
    soft: '#ECE9E3',
    text: '#15171C',
    muted: '#5D6470',
    faint: '#A9ADB6',
    accent: '#E5532A',
    onAccent: '#170B06',
  },
};

// Mid-tone accent that reads on both GitHub themes (single-file assets).
const ACCENT_NEUTRAL = '#F25A2E';

/* ------------------------------------------------------------------ */
/* Fonts → paths                                                       */
/* ------------------------------------------------------------------ */

function loadFont(pkg, file) {
  const buf = fs.readFileSync(path.join(here, 'node_modules/@fontsource', pkg, 'files', file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const FONTS = {
  display: loadFont('space-grotesk', 'space-grotesk-latin-600-normal.woff'),
  ui: loadFont('space-grotesk', 'space-grotesk-latin-500-normal.woff'),
  body: loadFont('space-grotesk', 'space-grotesk-latin-400-normal.woff'),
  mono: loadFont('jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff'),
  monoMedium: loadFont('jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff'),
};

function measure(font, str, size, tracking = 0) {
  const glyphs = font.stringToGlyphs(str);
  const scale = size / font.unitsPerEm;
  const xs = [];
  let w = 0;
  glyphs.forEach((g, i) => {
    xs.push(w);
    w += g.advanceWidth * scale;
    if (i < glyphs.length - 1) w += font.getKerningValue(g, glyphs[i + 1]) * scale + tracking * size;
  });
  return { glyphs, xs, width: w };
}

// opentype.js' own serializer can glue numbers together ("4.70" for "4.7 0"),
// so path data is written by hand.
function pathData(p) {
  const n = (v) => String(Math.round(v * 10) / 10);
  return p.commands
    .map((c) => {
      if (c.type === 'M' || c.type === 'L') return `${c.type}${n(c.x)} ${n(c.y)}`;
      if (c.type === 'Q') return `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`;
      if (c.type === 'C') return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
      return 'Z';
    })
    .join('');
}

// Glyph outlines are defined once per document and placed with <use>,
// which keeps text-heavy cards small.
let glyphDefs = new Map();
let fontIds = new Map();

/** Text rendered as vector glyphs. Returns { svg, width }. */
function text(font, str, { x = 0, y = 0, size = 16, tracking = 0, anchor = 'start', fill = '#000', opacity, extra = '' } = {}) {
  const { glyphs, xs, width } = measure(font, str, size, tracking);
  const x0 = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  if (!fontIds.has(font)) fontIds.set(font, `f${fontIds.size}`);
  let uses = '';
  glyphs.forEach((g, i) => {
    const id = `${fontIds.get(font)}s${String(size).replace('.', '_')}g${g.index}`;
    if (!glyphDefs.has(id)) {
      glyphDefs.set(id, pathData(g.getPath(0, 0, size)));
    }
    if (glyphDefs.get(id)) uses += `<use href="#${id}" x="${r1(x0 + xs[i])}" y="${r1(y)}"/>`;
  });
  const op = opacity != null ? ` opacity="${opacity}"` : '';
  return { svg: `<g fill="${fill}"${op}${extra}>${uses}</g>`, width };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

const hexToRgb = (h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (a, b, t) => {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
};
const luminance = (h) => {
  const c = hexToRgb(h).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function svgDoc(w, h, body, { title, defs = '', style = '' } = {}) {
  defs += [...glyphDefs].filter(([, d]) => d).map(([id, d]) => `<path id="${id}" d="${d}"/>`).join('');
  glyphDefs = new Map();
  fontIds = new Map();
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" role="img"${title ? ` aria-label="${title}"` : ''}>`,
    title ? `<title>${title}</title>` : '',
    style ? `<style>${style}</style>` : '',
    defs ? `<defs>${defs}</defs>` : '',
    body,
    '</svg>',
  ].join('');
}

function write(name, content) {
  fs.writeFileSync(path.join(OUT, name), content + '\n');
  console.log(`${name.padEnd(24)} ${(Buffer.byteLength(content) / 1024).toFixed(1)} KB`);
}

/** Brand colour that keeps enough contrast against the given surface. */
function iconColor(hex, t) {
  const c = '#' + hex;
  const [r, g, b] = hexToRgb(c);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  if (chroma < 48) return t.text; // black / white / grey logos follow the text colour
  if (contrast(c, t.surface) >= 2.6) return c;
  const towards = t.name === 'dark' ? '#FFFFFF' : '#000000';
  for (let k = 0.1; k <= 0.9; k += 0.1) {
    const m = mix(c, towards, k);
    if (contrast(m, t.surface) >= 2.6) return m;
  }
  return t.text;
}

const icons = Object.fromEntries(
  Object.values(simpleIcons)
    .filter((i) => i && i.slug)
    .map((i) => [i.slug, i]),
);

/* ------------------------------------------------------------------ */
/* Icosahedron (the hero's protagonist)                                */
/* ------------------------------------------------------------------ */

const PHI = (1 + Math.sqrt(5)) / 2;
const norm = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const ICO_V = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
].map(norm);

const EDGE_LEN = Math.min(
  ...ICO_V.flatMap((a, i) => ICO_V.slice(i + 1).map((b) => Math.hypot(...sub(a, b)))),
);
const isEdge = (i, j) => Math.abs(Math.hypot(...sub(ICO_V[i], ICO_V[j])) - EDGE_LEN) < 1e-6;

const ICO_E = [];
const ICO_F = [];
for (let i = 0; i < 12; i++) {
  for (let j = i + 1; j < 12; j++) {
    if (!isEdge(i, j)) continue;
    ICO_E.push([i, j]);
    for (let k = j + 1; k < 12; k++) if (isEdge(i, k) && isEdge(j, k)) ICO_F.push([i, j, k]);
  }
}

function rotate(v, theta) {
  // spin around Y, tilt around X (with a gentle wobble), then lean around Z
  const tilt = 0.42 + 0.1 * Math.sin(theta);
  const lean = 0.2;
  let [x, y, z] = v;
  [x, z] = [x * Math.cos(theta) + z * Math.sin(theta), -x * Math.sin(theta) + z * Math.cos(theta)];
  [y, z] = [y * Math.cos(tilt) - z * Math.sin(tilt), y * Math.sin(tilt) + z * Math.cos(tilt)];
  [x, y] = [x * Math.cos(lean) - y * Math.sin(lean), x * Math.sin(lean) + y * Math.cos(lean)];
  return [x, y, z];
}

/** Precomputes every frame and returns animated SVG markup. */
function icosahedron(t, { cx, cy, scale, frames = 60, dur = 24 }) {
  const CAM = 4.2;
  const light = norm([-0.45, 0.75, 0.6]);
  const project = ([x, y, z]) => {
    const s = (scale * CAM) / (CAM - z);
    return [cx + x * s, cy - y * s];
  };

  const edgeD = ICO_E.map(() => []);
  const edgeO = ICO_E.map(() => []);
  const faceO = ICO_F.map(() => []);
  const faceD = ICO_F.map(() => []);
  const vert = ICO_V.map(() => ({ x: [], y: [], r: [], o: [] }));

  for (let f = 0; f <= frames; f++) {
    const theta = (2 * Math.PI * (f % frames)) / frames;
    const P = ICO_V.map((v) => rotate(v, theta));
    const S = P.map(project);

    ICO_E.forEach(([a, b], i) => {
      const depth = (P[a][2] + P[b][2]) / 2; // -1 back … 1 front
      const k = (depth + 1) / 2;
      edgeD[i].push(`M${r1(S[a][0])} ${r1(S[a][1])}L${r1(S[b][0])} ${r1(S[b][1])}`);
      edgeO[i].push(r2(0.14 + 0.8 * k ** 1.4));
    });

    ICO_F.forEach(([a, b, c], i) => {
      let n = norm(cross(sub(P[b], P[a]), sub(P[c], P[a])));
      const centroid = [0, 1, 2].map((ax) => (P[a][ax] + P[b][ax] + P[c][ax]) / 3);
      if (dot(n, centroid) < 0) n = n.map((x) => -x);
      const facing = dot(n, sub([0, 0, CAM], centroid)) > 0;
      const lambert = Math.max(0, dot(n, light));
      faceO[i].push(facing ? r2(0.05 + 0.34 * lambert ** 1.3) : 0);
      faceD[i].push(`M${r1(S[a][0])} ${r1(S[a][1])}L${r1(S[b][0])} ${r1(S[b][1])}L${r1(S[c][0])} ${r1(S[c][1])}Z`);
    });

    P.forEach((p, i) => {
      const k = (p[2] + 1) / 2;
      vert[i].x.push(r1(S[i][0]));
      vert[i].y.push(r1(S[i][1]));
      vert[i].r.push(r1(1.4 + 2.2 * k));
      vert[i].o.push(r2(0.25 + 0.75 * k));
    });
  }

  const anim = (attr, values) => `<animate attributeName="${attr}" dur="${dur}s" repeatCount="indefinite" values="${values.join(';')}"/>`;

  const faces = ICO_F.map(
    (_, i) => `<path d="${faceD[i][0]}" fill="${t.accent}" fill-opacity="${faceO[i][0]}">${anim('d', faceD[i])}${anim('fill-opacity', faceO[i])}</path>`,
  ).join('');
  const edges = ICO_E.map(
    (_, i) => `<path d="${edgeD[i][0]}" stroke-opacity="${edgeO[i][0]}">${anim('d', edgeD[i])}${anim('stroke-opacity', edgeO[i])}</path>`,
  ).join('');
  const dots = vert
    .map(
      (v) =>
        `<circle cx="${v.x[0]}" cy="${v.y[0]}" r="${v.r[0]}" fill-opacity="${v.o[0]}">${anim('cx', v.x)}${anim('cy', v.y)}${anim('r', v.r)}${anim('fill-opacity', v.o)}</circle>`,
    )
    .join('');

  return `<g>${faces}</g><g stroke="${t.text}" stroke-width="1.2" stroke-linecap="round">${edges}</g><g fill="${t.accent}">${dots}</g>`;
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function chip(t, x, y, label, { accent = false } = {}) {
  const size = 12;
  const h = 30;
  const padX = 14;
  const diamond = accent ? 15 : 0;
  const { width: tw } = measure(FONTS.mono, label, size);
  const w = padX * 2 + diamond + tw;
  const stroke = accent ? t.accent : t.border;
  const fill = accent ? (t.name === 'dark' ? '#2A140C' : '#FDEDE6') : t.surface;
  const color = accent ? t.accent : t.muted;
  let s = `<rect x="${x + 0.5}" y="${y + 0.5}" width="${r1(w - 1)}" height="${h - 1}" rx="${(h - 1) / 2}" fill="${fill}" stroke="${stroke}" stroke-opacity="${accent ? 0.55 : 1}"/>`;
  if (accent) {
    const dx = x + padX + 4;
    const dy = y + h / 2;
    s += `<path d="M${dx} ${dy - 4.5}L${dx + 4.5} ${dy}L${dx} ${dy + 4.5}L${dx - 4.5} ${dy}Z" fill="${t.accent}"/>`;
  }
  s += text(FONTS.mono, label, { x: x + padX + diamond, y: y + 19.4, size, fill: color }).svg;
  return { svg: s, width: w };
}

// 24×24 line icons, stroke-based
const LINE_ICONS = {
  ico: '<path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4Z"/><path d="M12 2.8 7.6 14.4h8.8Z M7.6 14.4 4 16.6 M16.4 14.4 20 16.6 M7.6 14.4 12 21.2 16.4 14.4 M12 2.8 4 7.4 7.6 14.4 M12 2.8 20 7.4 16.4 14.4"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7 M3 12.5h18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  arrow: '<path d="M7 17 17 7 M9 7h8v8"/>',
  shader: '<path d="M12 3.5 20.5 19h-17Z"/><circle cx="12" cy="13.5" r="2"/>',
  physics: '<circle cx="15" cy="12" r="5.5"/><path d="M2.5 9h5 M1.5 12h6 M2.5 15h5"/>',
};

function lineIcon(name, x, y, size, color, sw = 1.7) {
  const s = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${r2(s)})" stroke="${color}" stroke-width="${r2(sw / s)}" stroke-linecap="round" stroke-linejoin="round" fill="none">${LINE_ICONS[name]}</g>`;
}

function brandIcon(slug, x, y, size, color) {
  const s = size / 24;
  return `<path transform="translate(${r1(x)} ${r1(y)}) scale(${r2(s)})" d="${icons[slug].path}" fill="${color}"/>`;
}

/* ------------------------------------------------------------------ */
/* 1. Hero banner                                                      */
/* ------------------------------------------------------------------ */

function hero(t) {
  const W = 900;
  const H = 320;
  const cx = 706;
  const cy = 158;
  const vp = { x1: 528, y1: 26, x2: 874, y2: 294 }; // the "viewport" on the right

  const defs = [
    `<clipPath id="card"><rect width="${W}" height="${H}" rx="20"/></clipPath>`,
    `<radialGradient id="glow" cx="${cx}" cy="${cy}" r="190" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${t.accent}" stop-opacity="${t.name === 'dark' ? 0.24 : 0.16}"/><stop offset="1" stop-color="${t.accent}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="fade" cx="${cx}" cy="${cy}" r="230" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
    `<mask id="gridMask"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask>`,
    `<pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse" x="${cx % 18}" y="${cy % 18}"><circle cx="9" cy="9" r="0.9" fill="${t.faint}"/></pattern>`,
  ].join('');

  const style = `
    .blink{animation:blink 1.1s steps(1) infinite}
    @keyframes blink{50%{opacity:0}}
  `;

  let b = `<g clip-path="url(#card)">`;
  b += `<rect width="${W}" height="${H}" fill="${t.bg}"/>`;
  b += `<rect width="${W}" height="${H}" fill="url(#dots)" mask="url(#gridMask)"/>`;
  b += `<circle cx="${cx}" cy="${cy}" r="190" fill="url(#glow)"/>`;

  // orbit with a travelling satellite
  const orbit = `M${cx - 168} ${cy}a168 40 0 1 0 336 0a168 40 0 1 0 -336 0`;
  b += `<g transform="rotate(-12 ${cx} ${cy})">`;
  b += `<path d="${orbit}" stroke="${t.faint}" stroke-dasharray="1.5 6" stroke-linecap="round"/>`;
  b += `<circle r="3" fill="${t.accent}"><animateMotion dur="14s" repeatCount="indefinite" path="${orbit}"/></circle>`;
  b += `<circle r="9" fill="${t.accent}" fill-opacity=".18"><animateMotion dur="14s" repeatCount="indefinite" path="${orbit}"/></circle>`;
  b += `</g>`;

  b += icosahedron(t, { cx, cy, scale: 92 });

  // viewport crop marks + HUD
  const m = 12;
  const corner = (x, y, dx, dy) => `M${x} ${y + dy * m}V${y}H${x + dx * m}`;
  b += `<path d="${[
    corner(vp.x1, vp.y1, 1, 1),
    corner(vp.x2, vp.y1, -1, 1),
    corner(vp.x1, vp.y2, 1, -1),
    corner(vp.x2, vp.y2, -1, -1),
  ].join('')}" stroke="${t.faint}" stroke-width="1.2"/>`;
  b += text(FONTS.mono, 'new IcosahedronGeometry(1, 0)', { x: vp.x1 + 18, y: vp.y1 + 20, size: 10.5, fill: t.faint }).svg;
  b += text(FONTS.mono, 'WebGPURenderer', { x: vp.x1 + 18, y: vp.y2 - 13, size: 10.5, fill: t.faint }).svg;

  // stats.js-style fps meter
  const rnd = mulberry32(7);
  const bars = 9;
  const bx = vp.x2 - 18 - bars * 5;
  const by = vp.y2 - 12;
  for (let i = 0; i < bars; i++) {
    const vals = Array.from({ length: 6 }, () => r1(4 + rnd() * 9));
    vals.push(vals[0]);
    const ys = vals.map((v) => r1(by - v));
    b += `<rect x="${bx + i * 5}" y="${ys[0]}" width="3" height="${vals[0]}" rx="1" fill="${t.accent}" fill-opacity="${r2(0.35 + 0.65 * (i / bars))}"><animate attributeName="height" dur="${r1(2.2 + rnd() * 1.5)}s" repeatCount="indefinite" values="${vals.join(';')}"/><animate attributeName="y" dur="${r1(2.2 + rnd() * 1.5)}s" repeatCount="indefinite" values="${ys.join(';')}"/></rect>`;
  }
  b += text(FONTS.mono, '60 FPS', { x: bx - 10, y: vp.y2 - 13, size: 10.5, fill: t.faint, anchor: 'end' }).svg;

  // ---- left column: identity
  const X = 52;
  b += `<rect x="${X}" y="68" width="8" height="8" rx="1.5" fill="${t.accent}"/>`;
  b += text(FONTS.monoMedium, 'SOFTWARE DEVELOPER  ·  MÁLAGA, ES', { x: X + 20, y: 77, size: 12, tracking: 0.08, fill: t.muted }).svg;

  b += text(FONTS.display, 'Sergii Butrii', { x: X - 3, y: 150, size: 62, tracking: -0.025, fill: t.text }).svg;

  const tag1 = text(FONTS.body, 'Thoughtful interfaces.', { x: X, y: 190, size: 22, fill: t.text, opacity: 0.86 });
  b += tag1.svg;
  const tag2 = text(FONTS.body, 'Efficient systems.', { x: X, y: 218, size: 22, fill: t.muted });
  b += tag2.svg;
  b += `<rect class="blink" x="${r1(X + tag2.width + 6)}" y="201" width="2.5" height="21" fill="${t.accent}"/>`;


  let cxChip = X;
  for (const [label, opts] of [
    ['Awwwards Honorable Mention', { accent: true }],
    ['Three.js · WebGPU', {}],
    ['AI & Big Data', {}],
  ]) {
    const c = chip(t, cxChip, 248, label, opts);
    if (cxChip + c.width > vp.x1 - 16) break;
    b += c.svg;
    cxChip += c.width + 8;
  }

  b += `</g>`;
  b += `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="19.5" stroke="${t.border}"/>`;

  return svgDoc(W, H, b, {
    title: 'Sergii Butrii — Software Developer in Málaga, Spain',
    defs,
    style,
  });
}

/* ------------------------------------------------------------------ */
/* 2. Link buttons                                                     */
/* ------------------------------------------------------------------ */

function button(t, { label, icon, primary }) {
  const size = 15;
  const H = 44;
  const padX = 18;
  const iconSize = 17;
  const { width: tw } = measure(FONTS.ui, label, size);
  const W = Math.ceil(padX + iconSize + 10 + tw + 10 + 12 + padX);
  const fg = primary ? t.onAccent : t.text;
  const sub = primary ? t.onAccent : t.muted;
  let b = '';
  b += primary
    ? `<rect width="${W}" height="${H}" rx="12" fill="${t.accent}"/>`
    : `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="11.5" fill="${t.surface}" stroke="${t.border}"/>`;
  b += lineIcon(icon, padX, (H - iconSize) / 2, iconSize, sub, 1.6);
  b += text(FONTS.ui, label, { x: padX + iconSize + 10, y: H / 2 + 5.3, size, fill: fg }).svg;
  b += lineIcon('arrow', W - padX - 12, (H - 12) / 2, 12, sub, 1.6);
  return svgDoc(W, H, b, { title: label });
}

/* ------------------------------------------------------------------ */
/* 3. Stack card                                                       */
/* ------------------------------------------------------------------ */

const STACK = [
  ['3D & Graphics', [['threedotjs', 'Three.js'], ['webgpu', 'WebGPU'], ['webgl', 'WebGL'], ['shader', 'TSL · GLSL shaders'], ['physics', 'Rapier physics']]],
  ['Frontend', [['typescript', 'TypeScript'], ['javascript', 'JavaScript'], ['angular', 'Angular'], ['react', 'React'], ['nextdotjs', 'Next.js'], ['tailwindcss', 'Tailwind CSS'], ['html5', 'HTML'], ['css', 'CSS']]],
  ['Mobile', [['kotlin', 'Kotlin'], ['jetpackcompose', 'Jetpack Compose'], ['android', 'Android'], ['openjdk', 'Java'], ['ionic', 'Ionic']]],
  ['Data & AI', [['python', 'Python'], ['numpy', 'NumPy'], ['pandas', 'pandas'], ['jupyter', 'Jupyter'], ['apachespark', 'PySpark'], ['apachekafka', 'Apache Kafka'], ['streamlit', 'Streamlit'], ['n8n', 'n8n']]],
  ['Backend & DB', [['nodedotjs', 'Node.js'], ['fastapi', 'FastAPI'], ['postgresql', 'PostgreSQL'], ['mysql', 'MySQL'], ['firebase', 'Firebase'], ['docker', 'Docker']]],
  ['Workflow', [['git', 'Git'], ['github', 'GitHub'], ['vite', 'Vite'], ['vercel', 'Vercel']]],
];

function stack(t) {
  const W = 900;
  const padX = 32;
  const labelW = 160;
  const pillH = 34;
  const gap = 7;
  const rowGap = 8;
  const groupPad = 20;
  const fontSize = 13;
  const iconSize = 15;
  const x0 = padX + labelW;
  const xMax = W - padX;

  let y = 12;
  let body = '';

  STACK.forEach(([group, items], gi) => {
    y += groupPad;
    const top = y;
    let x = x0;
    let pills = '';
    for (const [slug, label] of items) {
      const tw = measure(FONTS.mono, label, fontSize).width;
      const w = Math.ceil(12 + iconSize + 9 + tw + 13);
      if (x + w > xMax) {
        x = x0;
        y += pillH + rowGap;
      }
      pills += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${pillH - 1}" rx="9" fill="${t.surface}" stroke="${t.soft}"/>`;
      const iy = y + (pillH - iconSize) / 2;
      if (LINE_ICONS[slug]) pills += lineIcon(slug, x + 12, iy, iconSize, t.accent, 1.7);
      else pills += brandIcon(slug, x + 12, iy, iconSize, iconColor(icons[slug].hex, t));
      pills += text(FONTS.mono, label, { x: x + 12 + iconSize + 9, y: y + pillH / 2 + 4.6, size: fontSize, fill: t.text }).svg;
      x += w + gap;
    }
    const num = String(gi + 1).padStart(2, '0');
    body += text(FONTS.monoMedium, num, { x: padX, y: top + pillH / 2 + 4.2, size: 11.5, fill: t.accent }).svg;
    body += text(FONTS.monoMedium, group.toUpperCase(), { x: padX + 30, y: top + pillH / 2 + 4.2, size: 11.5, tracking: 0.12, fill: t.muted }).svg;
    body += pills;
    y += pillH + groupPad;
    if (gi < STACK.length - 1) body += `<path d="M${padX} ${y}H${W - padX}" stroke="${t.soft}" stroke-dasharray="2 4"/>`;
  });
  y += 12;

  const H = Math.ceil(y);
  const b = `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="19.5" fill="${t.bg}" stroke="${t.border}"/>` + body;
  const all = STACK.flatMap(([, items]) => items.map(([, l]) => l)).join(', ');
  return svgDoc(W, H, b, { title: `Stack: ${all}` });
}

/* ------------------------------------------------------------------ */
/* 4. Focus icons (single file, theme-neutral)                         */
/* ------------------------------------------------------------------ */

function focusIcon(kind) {
  const S = 44;
  const c = ACCENT_NEUTRAL;
  const shapes = {
    '3d': `<path d="M22 5 37 13.5v17L22 39 7 30.5v-17Z M7 13.5 22 22l15-8.5 M22 22v17"/><path d="M22 5v17" stroke-dasharray="2 3" opacity=".5"/><circle cx="22" cy="22" r="2.2" fill="${c}" stroke="none"/>`,
    ui: `<rect x="4" y="8" width="25" height="21" rx="3"/><path d="M4 14h25"/><circle cx="8" cy="11" r=".6" fill="${c}"/><circle cx="11" cy="11" r=".6" fill="${c}"/><path d="M9 20h8 M9 24h12"/><rect x="30" y="16" width="11" height="21" rx="3"/><path d="M34 33h3"/>`,
    data: `<path d="M5 38h34"/><rect x="8" y="27" width="5" height="11" rx="1"/><rect x="17" y="21" width="5" height="17" rx="1"/><rect x="26" y="24" width="5" height="14" rx="1"/><path d="M8 15 18 9l9 5 10-8" /><circle cx="8" cy="15" r="2" fill="${c}" stroke="none"/><circle cx="18" cy="9" r="2" fill="${c}" stroke="none"/><circle cx="27" cy="14" r="2" fill="${c}" stroke="none"/><circle cx="37" cy="6" r="2" fill="${c}" stroke="none"/>`,
  };
  const b = `<g stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none">${shapes[kind]}</g>`;
  return svgDoc(S, S, b);
}

/* ------------------------------------------------------------------ */
/* 5. Footer: a field of particles riding a wave                       */
/* ------------------------------------------------------------------ */

function footer() {
  const W = 900;
  const H = 150;
  const cols = 48;
  const rows = 9;
  let style = '';
  let dots = '';
  for (let r = 0; r < rows; r++) {
    const z = r / (rows - 1); // 0 far → 1 near
    const amp = r1(3 + 11 * z);
    style += `.r${r}{animation:w${r} 4.8s ease-in-out infinite alternate}@keyframes w${r}{from{transform:translateY(-${amp}px)}to{transform:translateY(${amp}px)}}`;
    const y = 26 + 92 * z ** 1.25;
    const spacing = 11 + 10 * z;
    for (let c = 0; c < cols; c++) {
      const x = W / 2 + (c - (cols - 1) / 2) * spacing;
      if (x < 8 || x > W - 8) continue;
      const edge = 1 - Math.abs(c - (cols - 1) / 2) / ((cols - 1) / 2); // 1 centre → 0 sides
      const op = r2((0.12 + 0.78 * z) * (0.25 + 0.75 * edge ** 0.8));
      const delay = r2(-((c * 0.16 + r * 0.42) % 4.8));
      dots += `<circle class="r${r}" style="animation-delay:${delay}s" cx="${r1(x)}" cy="${r1(y)}" r="${r1(0.8 + 1.5 * z)}" fill-opacity="${op}"/>`;
    }
  }
  const b = `<g fill="${ACCENT_NEUTRAL}">${dots}</g>`;
  return svgDoc(W, H, b, { style });
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

for (const t of Object.values(THEMES)) {
  write(`hero-${t.name}.svg`, hero(t));
  write(`stack-${t.name}.svg`, stack(t));
  write(`btn-portfolio-${t.name}.svg`, button(t, { label: 'sergii-butrii.com', icon: 'ico', primary: true }));
  write(`btn-linkedin-${t.name}.svg`, button(t, { label: 'LinkedIn', icon: 'briefcase' }));
  write(`btn-email-${t.name}.svg`, button(t, { label: 'sergiibutrii5@gmail.com', icon: 'mail' }));
}
write('focus-3d.svg', focusIcon('3d'));
write('focus-ui.svg', focusIcon('ui'));
write('focus-data.svg', focusIcon('data'));
write('footer.svg', footer());
