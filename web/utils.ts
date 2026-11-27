// Utilidades compartidas: formato, fechas, feriados, urgencia, íconos y reglas de negocio.
import { settings } from "./db.js";

// ---------- formato ----------
const ars = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
export const money = (n) => ars.format(Math.round(Number(n) || 0));
export const num = (v) => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[^\d,.-]/g, "");
  // "65.000" -> 65000 ; "1.234,50" -> 1234.5
  if (/,\d{1,2}$/.test(s)) return Number(s.replace(/\./g, "").replace(",", ".")) || 0;
  return Number(s.replace(/[.,]/g, "")) || 0;
};
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- fechas (todas como "YYYY-MM-DD" en hora local) ----------
export const iso = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
export const parseISO = (s) => { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const today = () => iso(new Date());
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
export const diffDays = (a, b) => Math.round((+parseISO(a) - +parseISO(b)) / 86400000);
export const DOW = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
// DNI o CUIL/CUIT: con 11 números lleva guiones (27-41808224-6); si no, queda como se escribió
// CUIT/CUIL = 11 números; los que tienen CUIT van con factura
export const isCuit = (v) => String(v || "").replace(/\D/g, "").length === 11;
// guiones mientras se escribe: 27-41808224-6 (si son 8 números o menos, queda como DNI)
export const typingDni = (v) => { const d = String(v || "").replace(/\D/g, "").slice(0, 11); return d.length <= 8 ? d : `${d.slice(0, 2)}-${d.slice(2, 10)}${d.length > 10 ? `-${d.slice(10)}` : ""}`; };
export const fmtDni = (v) => { const d = String(v || "").replace(/\D/g, ""); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : String(v || "").trim(); };
// "Miércoles 18 de nov." para saber qué día cae
export const dayLabel = (dt) => { const d = parseISO(dt), w = DOW[d.getDay()]; return `${w[0].toUpperCase()}${w.slice(1)} ${d.getDate()} de ${MONTHS[d.getMonth()].slice(0, 3)}.`; };
export const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const fmtDate = (s, opts: Rec = {}) => {
  if (!s) return "—";
  const d = parseISO(s);
  const base = `${d.getDate()}/${d.getMonth() + 1}`;
  return opts.long ? `${DOW[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}` : opts.year ? `${base}/${d.getFullYear()}` : `${DOW[d.getDay()].slice(0, 3)} ${base}`;
};
export const startOfWeek = (s) => { const d = parseISO(s); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return iso(d); };
export const monthKey = (s) => s ? s.slice(0, 7) : "";
export const relDay = (s) => {
  const n = diffDays(s, today());
  if (n === 0) return "hoy";
  if (n === 1) return "mañana";
  if (n === -1) return "ayer";
  return n > 0 ? `en ${n} días` : `hace ${-n} días`;
};

// ---------- feriados de Argentina ----------
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
// Feriados trasladables: martes/miércoles -> lunes anterior; jueves/viernes -> lunes siguiente.
function movable(y, m, d) {
  const x = new Date(y, m - 1, d), w = x.getDay();
  if (w === 2) x.setDate(d - 1); else if (w === 3) x.setDate(d - 2);
  else if (w === 4) x.setDate(d + 4); else if (w === 5) x.setDate(d + 3);
  return iso(x);
}
// Puentes turísticos (los fija el Gobierno cada año; se pueden agregar más en Ajustes)
const BRIDGES = { 2026: ["2026-03-23", "2026-07-10", "2026-12-07"] };

const holidayCache: Rec = {};
export function holidaysOf(y) {
  if (holidayCache[y]) return holidayCache[y];
  const e = easter(y);
  const off = (n) => { const x = new Date(e); x.setDate(x.getDate() + n); return iso(x); };
  const list = [
    [`${y}-01-01`, "Año Nuevo"],
    [off(-48), "Carnaval"], [off(-47), "Carnaval"],
    [`${y}-03-24`, "Día de la Memoria"],
    [off(-3), "Jueves Santo (no laborable)"], [off(-2), "Viernes Santo"],
    [`${y}-04-02`, "Malvinas"],
    [`${y}-05-01`, "Día del Trabajador"],
    [`${y}-05-25`, "Revolución de Mayo"],
    [movable(y, 6, 17), "Paso a la Inmortalidad de Güemes"],
    [`${y}-06-20`, "Día de la Bandera"],
    [`${y}-07-09`, "Día de la Independencia"],
    [movable(y, 8, 17), "Paso a la Inmortalidad de San Martín"],
    [movable(y, 10, 12), "Diversidad Cultural"],
    [movable(y, 11, 20), "Soberanía Nacional"],
    [`${y}-12-08`, "Inmaculada Concepción"],
    [`${y}-12-25`, "Navidad"],
    ...(BRIDGES[y] || []).map((d) => [d, "Puente turístico"]),
  ];
  return (holidayCache[y] = list.map(([date, name]) => ({ date, name })));
}
export function holidayMap(year) {
  const map = new Map();
  for (const y of [year - 1, year, year + 1]) holidaysOf(y).forEach((h) => map.set(h.date, h.name));
  (settings().extraHolidays || []).forEach((h) => h.date && map.set(h.date, h.name || "Feriado"));
  return map;
}
export const isHoliday = (s) => holidayMap(parseISO(s).getFullYear()).get(s);
const isOff = (s, map) => { const w = parseISO(s).getDay(); return w === 0 || w === 6 || map.has(s); };
// Fines de semana largos (3 o más días seguidos sin correo/proveedores)
export function longWeekends(fromISO, days = 120) {
  const map = holidayMap(parseISO(fromISO).getFullYear());
  const out = [];
  let run = [];
  for (let i = -3; i <= days; i++) {
    const s = addDays(fromISO, i);
    if (isOff(s, map)) run.push(s);
    else { if (run.length >= 3 && run.some((d) => map.has(d))) out.push({ from: run[0], to: run.at(-1), days: run.length, names: [...new Set(run.filter((d) => map.has(d)).map((d) => map.get(d)))] }); run = []; }
  }
  return out.filter((w) => w.to >= fromISO);
}

// ---------- pedidos ----------
export const STATUSES = [
  { key: "pedir", label: "🛒 Pedir" },
  { key: "esperando", label: "📥 Recibir" },
  { key: "entregar", label: "🚚 Entregar" },
  { key: "entregado", label: "✅ Entregado" },
];
// estados viejos (Señado, Saldado, Diseñar, Pagar) cuentan como "Pedir"
export const LEGACY_STATUS = ["senado", "pagado", "disenar", "pagar"];
export const statusOf = (k) => STATUSES.find((s) => s.key === k) || STATUSES[0];
export const statusKey = (k) => (STATUSES.some((s) => s.key === k) ? k : "pedir");
// Cada estado tiene su fondo y una letra que contrasta
// solo Pedir (rojo) y Recibir (morado) tienen fondo; Entregar y Entregado van sin color
const ST_BG = { pedir: "background-color:#f97316;color:#fff;border-color:#f97316", esperando: "background-color:#5f6470;color:#fff;border-color:#5f6470" };
export const statusStyle = (k) => ST_BG[statusKey(k)] || "background-color:transparent;color:inherit";
export const statusPill = (k, label?) => `<span class="st-pill" style="${statusStyle(k)}">${esc(label || statusOf(k).label)}</span>`;
export const BEFORE_SUPPLIER = ["senado", "pagado", "disenar", "pagar", "pedir"];
export const CHANNELS = ["Instagram", "WhatsApp", "Recomendación", "Facebook", "Local", "Otro"];
export const SHIPPING = ["Correo", "Retiro en local", "Moto/Uber"];
export const COURIERS = ["Andreani", "Flecha Bus Cargas", "Via Cargo", "Correo Argentino", "Otro"];
export const CATEGORIES = ["Tazas", "Vasos", "Botellas", "Velas", "Skincare"];

export const orderTotal = (o) => Number(o.total) || (o.items || []).reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);
export const orderPaid = (o) => o.paidFull ? orderTotal(o) : Math.min(orderTotal(o), Number(o.deposit) || 0);
export const orderBalance = (o) => Math.max(0, orderTotal(o) - orderPaid(o));
// Costo total del pedido: productos + packaging (bolsita, lapicera, tarjetita…) + extras del proveedor + envío al cliente.
// El envío que se le cobra al cliente está dentro del total, así que se compensa y no cuenta como ganancia.
export const orderCost = (o) => (o.items || []).reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.unitCost) || 0), 0)
  + (Number(o.extraCost) || 0) + (Number(o.packaging?.total) || 0) + (Number(o.clientShipping) || 0);
// Lo que se vendió sin contar el envío
export const orderSale = (o) => (o.saleTotal != null && o.saleTotal !== "" ? Number(o.saleTotal) : orderTotal(o) - (o.shippingFree ? 0 : Number(o.clientShipping) || 0));
// Un producto del pedido en texto: "x20 Vasos de Alumino". Si el nombre ya empieza con la cantidad
// ("15 velas con rosa" y pidió 15) no se repite el número.
const nameHasQty = (i) => new RegExp(`^${Number(i.qty) || 0}\\b`).test(String(i.product || "").trim());
export const itemText = (i) => (nameHasQty(i) ? i.product : `x${i.qty} ${i.product}`);
export const itemsText = (o, sep = ", ") => (o.items || []).map(itemText).join(sep);
// Lista de productos (uno por renglón, con la cantidad entre paréntesis) para las tablas
export const itemsList = (o) => (o.items?.length
  ? `<ul class="items-list">${o.items.map((i) => `<li><span>${esc(i.product)} <span class="iq-n">(${esc(String(i.qty ?? ""))})</span></span></li>`).join("")}</ul>`
  : "—");
export const orderQty = (o) => (o.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0);
// Fecha "para cuándo" es el pedido: el evento, o si no hay, la entrega.
export const targetDate = (o) => o.eventDate || o.deadline;

// Etiqueta de urgencia según la fecha de entrega
export function urgency(o) {
  const d = o.deadline || o.eventDate;
  if (!d || o.status === "entregado") return { cls: "u-gray", label: o.status === "entregado" ? "Entregado" : "Sin fecha" };
  const t = today();
  const w0 = startOfWeek(t);
  if (d < t) return { cls: "u-red", label: "Atrasado" };
  if (d < addDays(w0, 7)) return { cls: "u-red", label: "Esta semana" };
  if (d < addDays(w0, 14)) return { cls: "u-violet", label: "Semana que viene" };
  if (d < addDays(w0, 21)) return { cls: "u-blue", label: "En 2 semanas" };
  const n = parseISO(t); const next = new Date(n.getFullYear(), n.getMonth() + 1, 1);
  if (monthKey(d) <= monthKey(iso(next))) return { cls: "u-green", label: "Mes que viene" };
  return { cls: "u-gray", label: "Más adelante" };
}

// ---------- precios ----------
// costo (precio x cantidad) + envío + costos ocultos -> +60% de ganancia; si la ganancia supera $100.000 pasa a 50%.
export function priceFromCost(base) {
  const s = settings();
  let pct = s.markup;
  let profit = base * pct / 100;
  if (profit > s.markupThreshold) { pct = s.markupHigh; profit = base * pct / 100; }
  return { base, pct, profit, price: base + profit };
}
export function hiddenCostsPerUnit(keys?) {
  return settings().hidden.filter((h) => (keys ? keys.includes(h.key) : h.on)).reduce((a, h) => a + Number(h.cost || 0), 0);
}

// ---------- cuotas (Naranja X) ----------
// Lo que te descuentan = comisión × (1 + IVA) + financiación de las cuotas (+ IIBB si te retienen).
// mode "net": "quiero que me queden $X" -> cuánto cobrarle al cliente.  mode "gross": "cobro $X" -> cuánto me queda.
export function cuotasOptions(amount, { medio = 0, mode = "net" }: Rec = {}) {
  const s = settings();
  const m = s.payMedia[medio] || s.payMedia[0];
  const iva = 1 + Number(s.iva) / 100;
  const iibb = Number(s.iibb) || 0;
  const rows = [
    { key: "cuenta", label: "Dinero en cuenta", n: 1, comm: m.cuenta, fin: 0 },
    { key: "debito", label: "Débito", n: 1, comm: m.debito, fin: 0 },
    ...s.financing.map((f) => ({ key: `c${f.n}`, label: f.label, n: f.n, comm: m.credito, fin: Number(f.rate) || 0, planZ: !f.n })),
  ];
  return rows.map((r) => {
    const cost = r.comm * iva + r.fin * (s.ivaOnFinancing ? iva : 1) + iibb;
    const k = 1 - cost / 100;
    const price = mode === "net" ? amount / k : amount;
    const net = mode === "net" ? amount : amount * k;
    // detalle en pesos de lo que te descuentan
    const commAmt = price * r.comm / 100;
    const parts = {
      comision: commAmt,
      iva: commAmt * (iva - 1) + (s.ivaOnFinancing ? price * r.fin / 100 * (iva - 1) : 0),
      financiacion: price * r.fin / 100,
      iibb: price * iibb / 100,
    };
    return { ...r, medio: m.name, cost, price, net, fees: price - net, parts, cuota: r.n ? price / r.n : null };
  });
}
export function cuotasMessage(amount, opts: Rec = {}) {
  const rows = cuotasOptions(amount, opts).filter((r) => r.key !== "debito");
  const lines = rows.map((r) => r.key === "cuenta" ? `• Transferencia / dinero en cuenta: ${money(r.price)}`
    : r.planZ ? `• Plan Z: ${money(r.price)}` : r.n === 1 ? `• Tarjeta de crédito en 1 pago: ${money(r.price)}`
    : `• ${r.n} cuotas de ${money(r.cuota)} (total ${money(r.price)})`);
  return `Estas son las opciones de pago 💳\n${lines.join("\n")}`;
}

// ---------- WhatsApp ----------
export function waLink(phone, text) {
  let p = String(phone || "").replace(/\D/g, "");
  if (p.startsWith("54")) p = p.slice(2);
  if (p.startsWith("9")) p = p.slice(1);
  if (p.startsWith("0")) p = p.slice(1);
  p = p.replace(/^(\d{2,4})15(\d{6,8})$/, "$1$2");
  return `https://wa.me/549${p}?text=${encodeURIComponent(text)}`;
}
export function fillTemplate(tpl, o) {
  const s = settings();
  return tpl
    .replaceAll("{nombre}", (o.client?.name || "").split(" ")[0])
    .replaceAll("{total}", money(orderTotal(o)))
    .replaceAll("{sena}", money(o.deposit))
    .replaceAll("{saldo}", money(orderBalance(o)))
    .replaceAll("{evento}", o.eventDate ? fmtDate(o.eventDate, { long: true }) : "tu evento")
    .replaceAll("{entrega}", o.deadline ? fmtDate(o.deadline, { long: true }) : "")
    .replaceAll("{producto}", (o.items || []).map((i) => `${i.qty} ${i.product}`).join(", "))
    .replaceAll("{retiro}", s.pickupInfo || "el local");
}

// ---------- imágenes ----------
export function resizeImage(file, max = 480) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = img.width * k; c.height = img.height * k;
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = r.result as string;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
export function download(name, content, type = "text/plain") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- íconos (trazos estilo lucide) ----------
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  bag: '<path d="M6 7h12l1 13H5zM9 7a3 3 0 0 1 6 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5 5 0 0 1 3.5 6"/>',
  factory: '<path d="M3 21V10l6 4V10l6 4V5h6v16zM7 17h2M12 17h2M17 17h2"/>',
  box: '<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 14H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1A2 2 0 1 1 7 4.4l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>',
  wa: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1c-1-.5-1.5-1-2-2l1-1-1-2z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>',
  kanban: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>',
  alert: '<path d="M12 3 2 20h20zM12 10v4M12 17v.5"/>',
  truck: '<path d="M2 6h12v10H2zM14 10h4l3 3v3h-7M6 19a2 2 0 1 0 0-.1M17 19a2 2 0 1 0 0-.1"/>',
  star: '<path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.3L12 17.5 6.5 20.4l1-6.3L3 9.7l6.2-.9z"/>',
  img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  piggy: '<path d="M4 11.5a7 6 0 0 1 11-4.8h4l-.8 3 2.3 1.6v3.2h-2.2a7 6 0 0 1-2.8 2.7V20h-3v-1.6a8.5 8.5 0 0 1-2.5 0V20H7v-2.4a6 6 0 0 1-3-6.1z"/><path d="M15.5 11h.01M9 7.5h4"/>',
  wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4v4M16 13h2"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
  chevL: '<path d="m15 6-6 6 6 6"/>',
  chevR: '<path d="m9 6 6 6-6 6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
};
export const icon = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;
