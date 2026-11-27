// Capturas anotadas para el caso de estudio de Tradex.
// - anotadas: recorte con zoom de una zona, con etiquetas numeradas en violeta a la derecha;
// - planas: la pantalla tal cual, con marco, para las portadas;
// - código: tarjetas oscuras con fragmentos de la app.
// Uso, con la app corriendo (npm start): BASE_URL=http://localhost:5190 node anotar.mjs [carpeta-salida] [nombre]
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5190';
const OUT = process.argv[2] ?? '.';
const SOLO = process.argv[3];
mkdirSync(OUT, { recursive: true });

const ESCRITORIO = { width: 1180, height: 900 };
const CELULAR = { width: 390, height: 844 };
const MEDIO = { width: 820, height: 900 };

const pasos = (...fs) => async (page) => { for (const f of fs) { await f(page); await page.waitForTimeout(300); } };
const tocar = (texto, n = 0) => (page) => page.getByRole('button', { name: texto }).nth(n).click();
const escribir = (sel, texto) => async (page) => { await page.fill(sel, texto); await page.press(sel, 'Enter'); await page.waitForTimeout(900); };
const dex = (frase) => pasos((page) => page.click('#fab'), escribir('#as-text', frase));
const cotizar = pasos(
  (page) => page.fill('#view input >> nth=0', 'vaso'), (page) => page.waitForTimeout(500),
  (page) => page.keyboard.press('ArrowDown'), (page) => page.keyboard.press('Enter'),
  (page) => page.fill('#view input >> nth=1', '30'), (page) => page.keyboard.press('Tab'),
);

const CAPTURAS = [
  // Portadas
  { nombre: '00-inicio', plana: true },
  { nombre: '00-pedidos', plana: true, ruta: '#/pedidos' },
  { nombre: '00-finanzas', plana: true, ruta: '#/finanzas', oscuro: true },
  { nombre: '00-celular', plana: true, viewport: CELULAR },

  // 1. Producto
  {
    nombre: 'p01-agenda', viewport: CELULAR,
    zona: [{ s: '.agenda-head' }], margen: 10,
    notas: [
      { s: '.ah-title', label: 'Al abrir, la agenda del día: no un menú' },
      { s: '.cash-box', label: 'Cuánto dinero entró hoy, sin abrir Finanzas' },
      { t: 'Nuevo pedido', n: 0, en: 'abajo', label: 'Cargar un pedido es la acción principal' },
      { s: '#q-voice', en: 'abajo', label: 'O dictárselo a Dex, con las manos ocupadas' },
    ],
  },
  {
    nombre: 'p02-finde', viewport: MEDIO,
    zona: [{ s: '.card:has(h3:text("Para entregar este finde"))' }], margen: 8, ancho: 600,
    notas: [
      { t: 'Para entregar este finde', label: 'Lo urgente primero: lo que se entrega este fin de semana' },
      { s: '.card:has(h3:text("Para entregar este finde")) .chip, .card:has(h3:text("Para entregar este finde")) span', n: 0, label: 'El día de entrega, en una etiqueta' },
      { s: '.card:has(h3:text("Para entregar este finde")) b', n: 0, label: 'Cliente y productos en una línea' },
    ],
  },
  {
    nombre: 'p03-asistente', accion: dex('Lucía me compró 40 tazas a 6500 para el sábado 20'),
    zona: [{ s: '.assistant' }], margen: 0,
    notas: [
      { s: '.msg.me', label: 'Una frase dicha como se habla' },
      { s: '#as-draft', label: 'La ficha del pedido se completa sola' },
      { s: '#as-sug', label: 'Lo que falta, lo pregunta con opciones' },
      { s: '#as-mic', label: 'Micrófono: sin tipear nada' },
    ],
  },

  // 2. Diseño
  {
    nombre: 'd01-menu', viewport: { width: 1180, height: 900 },
    zona: [{ s: '#sidebar' }], margen: 0, alto: 720,
    notas: [
      { t: 'Pedidos y clientes', label: 'Secciones agrupadas por tarea, no por pantalla' },
      { t: 'Proveedores e insumos', label: 'Cada grupo con su color de acento' },
      { t: 'Agenda y finanzas', label: 'Lo administrativo, al final' },
    ],
  },
  {
    nombre: 'd02-urgencia', ruta: '#/pedidos', viewport: MEDIO,
    zona: [{ s: '.legend' }, { s: '.otable tbody tr', n: 2 }], margen: 8, ancho: 560,
    notas: [
      { s: '.legend', label: 'Colores de urgencia con su leyenda a la vista' },
      { s: '.otable tbody tr', n: 0, label: 'El borde de la fila dice cuánto falta' },
      { s: '.otable tbody select', n: 0, label: 'La etapa se cambia desde la misma tabla' },
    ],
  },
  {
    nombre: 'd03-oscuro', ruta: '#/finanzas', oscuro: true, viewport: CELULAR,
    zona: [{ s: '#view .tabs' }, { s: '.grid.g4' }], margen: 8,
    notas: [
      { s: '#view .tabs', label: 'Modo oscuro para las cuentas de la noche' },
      { s: '.card.stat', n: 0, label: 'Los números grandes y en verde lo que entra' },
      { t: 'Ganancia neta', n: 0, label: 'La ganancia neta separada de las ventas' },
    ],
  },
  {
    nombre: 'd04-celular', viewport: CELULAR,
    zona: [{ s: '#fab' }, { s: '#bottom-nav' }], margen: 0,
    notas: [
      { s: '#fab', label: 'Dex flota sobre todas las pantallas' },
      { s: '#bottom-nav a', n: 0, en: 'abajo', label: 'En el celular, las secciones pasan a una barra inferior' },
      { s: '#bottom-nav a', n: -1, en: 'abajo', label: 'El resto, en «Más», sin perder ninguna' },
    ],
  },

  // 3. Programación
  {
    nombre: 'f01-cotizador', ruta: '#/cotizador', viewport: MEDIO, accion: cotizar,
    zona: [{ s: '.card:has(h3:text("Productos a cotizar"))' }, { s: '.card:has(h3:text("Packaging"))' }], margen: 8,
    notas: [
      { s: '#view input', n: 0, label: 'Busca el producto en el catálogo de proveedores' },
      { t: 'Packaging (uno por pedido)', label: 'Costos ocultos que se olvidaban: packaging y etiquetas' },
    ],
  },
  {
    nombre: 'f02-proveedores', ruta: '#/proveedores', viewport: CELULAR,
    zona: [{ s: 'article.card', n: 0 }], margen: 8,
    notas: [
      { s: 'article.card h3', n: 0, label: 'Ficha de proveedor con provincia y contacto' },
      { t: 'días de demora', n: 0, label: 'La demora alimenta los avisos de pedido' },
      { s: 'article.card .btn', n: 0, label: 'Catálogo y lista de precios importables' },
    ],
  },

  // 4. Datos
  {
    nombre: 'da01-flujo', ruta: '#/finanzas', viewport: CELULAR,
    zona: [{ s: '.grid.g4' }], margen: 8,
    notas: [
      { s: '.card.stat', n: 0, label: 'Señas cobradas: el dinero que ya entró' },
      { s: '.card.stat', n: 1, label: 'Saldos a cobrar de las entregas del mes' },
      { s: '.card.stat', n: 2, label: 'Lo que viene el mes próximo' },
      { s: '.card.stat', n: 3, label: 'Ganancia neta: ventas menos costos' },
    ],
  },
  {
    nombre: 'da02-rentabilidad', ruta: '#/finanzas', viewport: MEDIO, accion: tocar('Rentabilidad'),
    zona: [{ s: '.hero', n: 0 }, { s: '.card:has(h3:text("Ganancia por categoría"))' }], margen: 8, alto: 760,
    notas: [
      { s: '.hero', n: 0, label: 'La categoría que más ganancia deja' },
      { s: '.hero', n: 1, label: 'Y la de mejor margen: no siempre es la misma' },
      { s: '.hbar', n: 0, label: 'Ranking por ganancia, no por ventas' },
    ],
  },
  {
    nombre: 'da03-graficos', ruta: '#/finanzas', viewport: CELULAR, accion: tocar('Gráficos'),
    zona: [{ s: '.card:has(h3:text("Ventas por mes"))' }], margen: 8,
    notas: [
      { t: 'Ventas por mes (últimos 12)', label: 'Doce meses para ver la temporada' },
      { s: '.chip.accent', label: 'El pico se marca solo' },
    ],
  },
  {
    nombre: 'da04-canales', ruta: '#/finanzas', viewport: CELULAR, accion: tocar('Gráficos'),
    zona: [{ s: '.card:has(h3:text("canal"))' }, { s: '.card:has(h3:text("Pedidos por estado"))' }], margen: 8,
    notas: [
      { s: '.card:has(h3:text("canal")) .hbar', n: 0, label: 'Ventas por canal, con la cantidad de pedidos' },
      { s: '.card:has(h3:text("canal")) .hbar', n: -1, label: 'Dónde conviene poner el esfuerzo' },
      { t: 'Pedidos por estado', label: 'Y cuántos pedidos hay en cada etapa' },
    ],
  },
];

function locator(page, nota) {
  const loc = nota.s ? page.locator(nota.s) : page.getByText(nota.t, { exact: Boolean(nota.exacto) });
  return nota.n === -1 ? loc.last() : loc.nth(nota.n ?? 0);
}

async function rect(page, nota) {
  const loc = locator(page, nota);
  const visible = await loc.isVisible().catch(() => false);
  if (!visible) return null;
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
}

const ANCHO_IMAGEN = 640;
const ANCHO_ETIQUETA = 360;
// Marco con la paleta del portfolio; etiquetas con el degradado violeta de Tradex y texto blanco.
const FONDO = 'linear-gradient(135deg,#F5F3FF,#E0F2FE)';
const SOMBRA = '0 20px 50px rgba(12,13,16,.22),0 0 0 1px rgba(139,61,255,.30)';
const ACENTO = '#8B3DFF';
const DEGRADADO = 'linear-gradient(135deg,#6C2BFF,#B44CFF)';
const TINTA = '#FFFFFF';

async function enMarco(browser, png, ancho, alto, notas, file) {
  const k = Math.min(1.6, ANCHO_IMAGEN / ancho);
  const pad = 40;
  const imgW = ancho * k;
  const imgH = alto * k;
  const lx = pad + imgW + 70;
  const W = Math.ceil(notas.length ? lx + ANCHO_ETIQUETA + pad : pad * 2 + imgW);
  const pts = notas.map((n) => {
    const bx = pad + Math.max(0, n.cx - 4) * k;
    const by = pad + Math.max(0, n.cy - 4) * k;
    const bw = (Math.min(ancho, n.cx + n.w + 4) - Math.max(0, n.cx - 4)) * k;
    const bh = (Math.min(alto, n.cy + n.h + 4) - Math.max(0, n.cy - 4)) * k;
    return { label: n.label, bx, by, bw, bh, tx: pad + imgW + 6, ty: by + bh / 2 };
  });
  pts.sort((a, b) => a.ty - b.ty).forEach((p, i) => (p.i = i + 1));
  console.log(pts.map((p) => `    ${p.i}. ${p.label}`).join('\n'));
  const page = await browser.newPage({ viewport: { width: W, height: 400 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><head><style>
    body{margin:0;width:${W}px;background:${FONDO};font-family:Inter,system-ui,sans-serif;position:relative}
    img{position:absolute;left:${pad}px;top:${pad}px;width:${imgW}px;border-radius:18px;box-shadow:${SOMBRA}}
    .tag{position:absolute;left:${lx}px;width:${ANCHO_ETIQUETA}px;box-sizing:border-box;display:flex;align-items:flex-start;gap:12px;padding:14px 18px;border-radius:20px;background:${DEGRADADO};color:${TINTA};font-weight:600;font-size:22px;line-height:1.3;box-shadow:0 8px 20px rgba(15,23,42,.18)}
    .n{flex:none;width:32px;height:32px;border-radius:50%;background:#fff;color:${ACENTO};display:grid;place-items:center;font-size:18px;font-weight:800}
    svg{position:absolute;left:0;top:0;overflow:visible}
  </style></head><body>
    <img src="data:image/png;base64,${png.toString('base64')}" />
    ${pts.map((p) => `<div class="tag"><span class="n">${p.i}</span><span>${p.label}</span></div>`).join('')}
    <svg id="flechas"></svg>
  </body></html>`);
  await page.evaluate(({ pts, pad, imgH, lx, color }) => {
    const tags = [...document.querySelectorAll('.tag')];
    const orden = pts.map((p, i) => ({ ...p, el: tags[i] })).sort((a, b) => a.ty - b.ty);
    let piso = pad;
    for (const p of orden) {
      const h = p.el.offsetHeight;
      p.top = Math.max(piso, p.ty - h / 2);
      p.el.style.top = `${p.top}px`;
      p.sy = p.top + Math.min(h / 2, 30);
      piso = p.top + h + 16;
    }
    const H = Math.ceil(Math.max(pad * 2 + imgH, piso + pad - 16));
    document.body.style.height = `${H}px`;
    const svg = document.getElementById('flechas');
    svg.setAttribute('width', document.body.offsetWidth);
    svg.setAttribute('height', H);
    svg.innerHTML = orden
      .map((p) => {
        const sx = lx - 4;
        const mx = (sx + p.tx) / 2;
        const caja = `<rect x="${p.bx}" y="${p.by}" width="${p.bw}" height="${p.bh}" rx="10" fill="none" stroke="${color}" stroke-width="4"/>`;
        return caja + `<path d="M${sx},${p.sy} C${mx},${p.sy} ${mx},${p.ty} ${p.tx},${p.ty}" stroke="${color}" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="${p.tx}" cy="${p.ty}" r="9" fill="${color}" stroke="#fff" stroke-width="3"/>`;
      })
      .join('');
  }, { pts, pad, imgH, lx, color: ACENTO });
  const H = await page.evaluate(() => document.body.offsetHeight);
  await page.setViewportSize({ width: W, height: H });
  await page.screenshot({ path: file });
  await page.close();
}

// Código como tarjeta oscura (grafito) con resaltado simple en violeta.
async function codigo(browser, archivo, desde, hasta, titulo, file) {
  const crudas = readFileSync(archivo, 'utf8').split('\n').slice(desde - 1, hasta);
  const sangria = Math.min(...crudas.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  const lineas = crudas.map((l) => l.slice(sangria));
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const resaltar = (l) => /^\s*\/\//.test(l) ? `<i class="c">${esc(l)}</i>` : esc(l)
    .replace(/("[^"]*"|'[^']*'|`[^`]*`)/g, '<i class="s">$1</i>')
    .replace(/\b(export|function|async|await|const|let|return|if|throw|new|import|from)\b/g, '<i class="k">$1</i>');
  const page = await browser.newPage({ viewport: { width: 1300, height: 400 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><head><style>
    body{margin:0;padding:40px;background:${FONDO};font-family:Inter,system-ui,sans-serif;display:inline-block}
    .card{background:#0C0D10;border-radius:18px;box-shadow:${SOMBRA};overflow:hidden;width:max-content;max-width:1150px}
    .bar{padding:12px 18px;color:#D9C2FF;font-size:15px;border-bottom:1px solid #22252C}
    pre{margin:0;padding:18px 22px;white-space:pre-wrap;color:#F2F3F5;font:15px/1.6 "JetBrains Mono",ui-monospace,monospace}
    .n{display:inline-block;width:2.6em;color:#6A6A76;user-select:none}
    i{font-style:normal}.k{color:#B44CFF}.s{color:#6EE7B7}.c{color:#9AA0AB}
  </style></head><body><div class="card"><div class="bar">${esc(titulo)}</div><pre>${lineas
    .map((l, i) => `<span class="n">${desde + i}</span>${resaltar(l)}`).join('\n')}</pre></div></body></html>`);
  const caja = await page.locator('body').boundingBox();
  await page.setViewportSize({ width: Math.ceil(caja.width), height: Math.ceil(caja.height) });
  await page.screenshot({ path: file });
  await page.close();
}

const browser = await chromium.launch();
for (const cap of CAPTURAS) {
  if (SOLO && cap.nombre !== SOLO) continue;
  const ctx = await browser.newContext({ viewport: cap.viewport ?? ESCRITORIO, deviceScaleFactor: 2, locale: 'es-AR' });
  await ctx.addInitScript(() => {
    // sin el panel de «Para hacer hoy» que se abre una vez por día, y en modo claro salvo que la captura pida otro
    const d = new Date();
    localStorage.setItem('v-bell-day', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    if (!localStorage.getItem('v-mode')) localStorage.setItem('v-mode', 'light');
  });
  await ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => document.head.insertAdjacentHTML('beforeend', '<style>.toasts{display:none!important}</style>')));
  if (cap.oscuro) await ctx.addInitScript(() => localStorage.setItem('v-mode', 'dark'));
  const page = await ctx.newPage();
  await page.goto(BASE + (cap.ruta ?? '/'), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  if (cap.accion) {
    await cap.accion(page);
    await page.waitForTimeout(800);
  }
  let clip = { x: 0, y: 0, width: page.viewportSize().width, height: Math.min(page.viewportSize().height, 900) };
  if (cap.zona) {
    const rs = [];
    for (const z of cap.zona) {
      const r = await rect(page, z);
      if (!r) throw new Error(`${cap.nombre}: no encontré la zona ${z.s ?? z.t}`);
      rs.push(r);
    }
    const m = cap.margen ?? 16;
    const x = Math.max(0, Math.min(...rs.map((r) => r.x)) - m);
    const y = Math.max(0, Math.min(...rs.map((r) => r.y)) - m);
    const x2 = Math.max(...rs.map((r) => r.x + r.w)) + m;
    const y2 = Math.max(...rs.map((r) => r.y + r.h)) + m;
    clip = { x, y, width: Math.min(cap.ancho ?? Infinity, x2 - x, page.viewportSize().width - x), height: Math.min(cap.alto ?? Infinity, y2 - y) };
  }
  clip = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.width), height: Math.round(clip.height) };
  const notas = [];
  for (const n of cap.notas ?? []) {
    const r = await rect(page, n);
    if (r) notas.push({ ...n, ...r, cx: r.x - clip.x, cy: r.y - clip.y });
    else console.warn('  sin elemento:', cap.nombre, n.label);
  }
  const png = await page.screenshot({ clip, fullPage: clip.y + clip.height > page.viewportSize().height });
  await enMarco(browser, png, clip.width, clip.height, notas, join(OUT, `${cap.nombre}.png`));
  console.log('ok', cap.nombre, `${notas.length}/${(cap.notas ?? []).length}`, `${clip.width}×${clip.height}`);
  await ctx.close();
}

// Tarjetas de código: [nombre, archivo, texto con el que empieza, cuántas líneas, título].
const raiz = new URL('../../', import.meta.url).pathname;
const CODIGO = [
  ['f04-avisos-codigo', 'web/alerts.ts', '// Fechas recordatorio', 13, 'web/alerts.ts · cuándo pedir al proveedor'],
  ['f05-precio-codigo', 'web/utils.ts', '// costo (precio x cantidad)', 8, 'web/utils.ts · precio sugerido con margen escalonado'],
  ['f06-sync-codigo', 'web/db.ts', 'async function applyRemote', 15, 'web/db.ts · sincronizar sin conexión: gana la edición más reciente'],
];
for (const [nombre, archivo, inicio, cuantas, titulo] of CODIGO) {
  if (SOLO && SOLO !== nombre) continue;
  const ruta = join(raiz, archivo);
  const desde = readFileSync(ruta, 'utf8').split('\n').findIndex((l) => l.startsWith(inicio)) + 1;
  await codigo(browser, ruta, desde, desde + cuantas - 1, titulo, join(OUT, `${nombre}.png`));
  console.log('ok', nombre);
}
await browser.close();
