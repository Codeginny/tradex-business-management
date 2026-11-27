// Finanzas personales: gastos fijos (vencimientos y "pagado"), gastos del día, préstamos e ingresos.
// Todo vive en la colección "personal"; cada documento tiene un kind: fixed | expense | loan | income.
import { db } from "../db.js";
import { icon, esc, money, today, monthKey, MONTHS, fmtDate, diffDays, parseISO, orderPaid, orderTotal, orderCost, itemsText } from "../utils.js";
import { $, $$, modal, toast, confirmBox, readForm, options } from "../ui.js";

const COL = "personal";
const TABS = [["fijos", "📌 Gastos fijos"], ["dia", "🧾 Gastos del día"], ["prestamos", "🤝 Préstamos"], ["ingresos", "💵 Ingresos"], ["resumen", "📊 Resumen"]];
export const FIXED_CATS = ["Vivienda", "Servicios", "Impuestos", "Salud", "Deporte", "Suscripciones", "Educación", "Otros"];
// Categorías de los gastos comunes: se pueden agregar, renombrar y borrar (documento "pf-cats").
// Cada una tiene un color fijo (slot 0-7 de la paleta) que la sigue en el gráfico de torta; sin slot va en gris.
const DEFAULT_CATS = [
  ["Comida", "🍔", 0], ["Supermercado", "🛒", 1], ["Salidas", "🍻", 2], ["Ropa", "👗", 3], ["Regalos", "🎁", 4],
  ["Salud", "💊", 5], ["Transporte", "🚗", 6], ["Telekino", "🎰", 7], ["Casa", "🏠", null], ["Ocio", "🎮", null], ["Belleza", "💅", null], ["Otros", "📦", null],
].map(([name, emoji, slot]) => ({ name, emoji, slot }));
export const catList = () => db.get(COL, "pf-cats")?.list || DEFAULT_CATS;
const catNames = () => catList().map((c) => c.name);
const catOf = (name) => catList().find((c) => c.name === name);
const catLabel = (name) => `${catOf(name)?.emoji || "📦"} ${name || "Otros"}`;
const catColor = (name) => { const c = catOf(name); return c && c.slot != null && c.slot !== "" ? `var(--cat-${c.slot})` : "var(--cat-gray)"; };
const INCOME_SRC = ["Sueldo", "Trabajo extra", "Otro"]; // lo de Tradex entra solo desde los pedidos
// Palabras que eligen la categoría sola cuando escribís la descripción
const AUTO_CAT = [
  [/super|chino|almac|verdu|carni|mercado/i, "Supermercado"],
  [/telekino|quini|loto|lotería|loteria|raspadita/i, "Telekino"],
  [/lomit|pizza|empanad|merienda|desay|cafe|café|almuerz|cena|delivery|helad|comida|hambur|sanguch|medialuna|facturas/i, "Comida"],
  [/ropa|zapat|zapatill|remera|pantal|campera|vestido/i, "Ropa"],
  [/regalo|cumple/i, "Regalos"],
  [/salida|bar|boliche|cine|teatro|recital/i, "Salidas"],
  [/netflix|spotify|juego|libro/i, "Ocio"],
  [/farmac|remedio|medic|obra social|turno|dentist/i, "Salud"],
  [/nafta|uber|cabify|taxi|colectivo|sube|remis/i, "Transporte"],
];
const autoCat = (text) => { const c = AUTO_CAT.find(([re]) => re.test(text))?.[1] || ""; return catOf(c) ? c : ""; };
// Los préstamos no son gastos: van en su pestaña
const isLoanText = (text) => /pr[eé]stamo/i.test(text || "");
function sendToLoans(d) {
  toast("🤝 Los préstamos van aparte", "No lo anoté como gasto. Cargalo en Préstamos.", { ms: 9000, action: { label: "Anotar préstamo", run: () => loanModal(null, { amount: d.amount, date: d.date || today() }) } });
}

let tab = "fijos";
let month = monthKey(today());

// ---------- datos ----------
const sum = (list, fn = (x) => x) => list.reduce((a, x) => a + (Number(fn(x)) || 0), 0);
export const personalOf = (kind) => db.all(COL).filter((d) => d.kind === kind);
// Un gasto puede no tener día (te acordás del mes pero no de la fecha): entonces guarda sólo el mes
const expMonth = (e) => (e.date ? monthKey(e.date) : e.month || "");
export const addMonth = (mk, n) => { const [y, m] = mk.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const mLabel = (mk) => { const [y, m] = mk.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
const mShort = (mk) => MONTHS[Number(mk.slice(5, 7)) - 1].slice(0, 3);
const daysIn = (mk) => { const [y, m] = mk.split("-").map(Number); return new Date(y, m, 0).getDate(); };

// Un gasto fijo cuenta en los meses entre "since" y "until" (si no los tiene, en todos)
export const fixedActive = (f, mk) => (!f.since || f.since <= mk) && (!f.until || mk <= f.until);
export const fixedDue = (f, mk) => (f.day ? `${mk}-${String(Math.min(Number(f.day), daysIn(mk))).padStart(2, "0")}` : null);
export const fixedPaid = (f, mk) => !!f.paid?.[mk];
const fixedAmount = (f, mk) => Number(f.paid?.[mk]?.amount ?? f.amount) || 0;
const fixedOf = (mk) => personalOf("fixed").filter((f) => fixedActive(f, mk)).sort((a, b) => (Number(a.day) || 99) - (Number(b.day) || 99));

// Naranja X y Mercado Pago: cuotas con vencimiento que hay que pagar sí o sí. Familia y conocidos: flexible.
export const LENDERS = {
  naranjax: { name: "Naranja X", logo: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#ff5f00"/><path d="M10 10l12 12M22 10 10 22" stroke="#fff" stroke-width="4.2" stroke-linecap="round"/></svg>' },
  mercadopago: { name: "Mercado Pago", logo: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#00b1ea"/><ellipse cx="16" cy="16" rx="11.5" ry="8" fill="#fff"/><path d="M8.5 17.5l3.2-2.6 2.6 1.8 2.8-2.4 2.6 1.8 3.8-2.8" fill="none" stroke="#0a2b6b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
};
export const loanStrict = (l) => !!LENDERS[l.lender];
const loanName = (l) => LENDERS[l.lender]?.name || l.name || "Sin nombre";
const lenderBadge = (l) => (LENDERS[l.lender] ? `<span class="pf-logo" title="${LENDERS[l.lender].name}">${LENDERS[l.lender].logo}</span>` : `<span class="pf-logo pf-family">${esc((l.name || "?").trim().charAt(0).toUpperCase() || "?")}</span>`);
// Con cuotas, lo que se devuelve es cuotas × valor de la cuota (incluye intereses)
const loanTotal = (l) => (loanStrict(l) && l.cuotas && l.cuota ? Number(l.cuotas) * Number(l.cuota) : Number(l.amount) || 0);
export const loanReturned = (l) => sum(l.payments || [], (p) => p.amount);
export const loanLeft = (l) => Math.max(0, loanTotal(l) - loanReturned(l));
export const loanOpen = (l) => !l.returned && loanLeft(l) > 0;
// Cuotas mes a mes desde la primera; la próxima es la primera que no está pagada
const cuotaMonths = (l) => { const first = l.firstDue ? monthKey(l.firstDue) : addMonth(monthKey(l.date || today()), 1); return Array.from({ length: Number(l.cuotas) || 120 }, (_, i) => addMonth(first, i)); };
const cuotaDate = (l, mk) => `${mk}-${String(Math.min(Number(l.day) || Number((l.firstDue || l.date || "").slice(8)) || 10, daysIn(mk))).padStart(2, "0")}`;
function nextCuota(l) {
  if (!loanStrict(l) || !loanOpen(l)) return null;
  const months = cuotaMonths(l), i = months.findIndex((mk) => !(l.payments || []).some((p) => p.month === mk));
  return i < 0 ? null : { mk: months[i], date: cuotaDate(l, months[i]), n: i + 1 };
}

// Cobros de los pedidos de Tradex: lo anotado en la caja diaria y, en pedidos de antes de la caja,
// lo cobrado (seña o pago total) el día que se cargó el pedido.
// Lo que cuenta como ingreso es la GANANCIA: cada cobro aporta su parte proporcional de (total − costo).
// Así, cuando el pedido está cobrado entero, sumó exactamente su ganancia.
export function orderIncomes() {
  const out = [];
  for (const o of db.all("orders")) {
    if (o.gift) continue;
    const total = orderTotal(o), cost = orderCost(o);
    const margin = total ? Math.max(0, total - cost) / total : 0;
    const logged = o.payments || [];
    const rest = orderPaid(o) - sum(logged, (p) => p.amount);
    const base = { o, name: o.client?.name || "Cliente", noCost: !cost };
    const add = (x) => out.push({ ...base, ...x, amount: Math.round(x.gross * margin) });
    if (rest > 0 && o.createdAt) add({ date: o.createdAt.slice(0, 10), gross: rest, label: o.paidFull && !logged.length ? "Pago total" : "Seña", method: logged.length ? "" : o.payMethod || "" });
    for (const p of logged) add({ date: p.date, gross: Number(p.amount) || 0, label: "Cobro", method: p.method || "" });
  }
  return out;
}

function monthTotals(mk) {
  const fixed = fixedOf(mk);
  const vars = personalOf("expense").filter((e) => expMonth(e) === mk);
  const incomeOther = sum(personalOf("income").filter((i) => monthKey(i.date) === mk), (i) => i.amount);
  const incomeOrders = sum(orderIncomes().filter((i) => monthKey(i.date) === mk), (i) => i.amount);
  const income = incomeOther + incomeOrders;
  const fixedTotal = sum(fixed, (f) => fixedAmount(f, mk));
  const varTotal = sum(vars, (e) => e.amount);
  return { fixed, vars, income, incomeOther, incomeOrders, fixedTotal, fixedPaidTotal: sum(fixed.filter((f) => fixedPaid(f, mk)), (f) => fixedAmount(f, mk)), varTotal, out: fixedTotal + varTotal };
}

// Estado de un vencimiento: pagado, vencido, vence hoy / en N días, o tranquilo
function dueState(f, mk) {
  if (fixedPaid(f, mk)) return { cls: "ok", text: `✔ Pagado ${fmtDate(f.paid[mk].at)}` };
  const due = fixedDue(f, mk);
  if (!due) return { cls: "u-gray", text: "Sin día fijo" };
  const n = diffDays(due, today());
  if (n < 0) return { cls: "u-red", text: `Vencido hace ${-n} día${n === -1 ? "" : "s"}` };
  if (n === 0) return { cls: "u-red", text: "Vence HOY" };
  if (n <= (Number(f.notice) || 3)) return { cls: "warn", text: `Vence en ${n} día${n === 1 ? "" : "s"}` };
  return { cls: "u-gray", text: "Pendiente" };
}

// ---------- avisos y calendario (los usa alerts.js) ----------
export function personalAlerts() {
  const t = today(), mk = monthKey(t), out = [];
  for (const f of fixedOf(mk)) {
    const due = fixedDue(f, mk);
    if (!due || fixedPaid(f, mk)) continue;
    const n = diffDays(due, t);
    if (n > (Number(f.notice) || 3)) continue;
    const usd = f.usd ? " (se paga en USD)" : "";
    out.push(n < 0
      ? { id: `pfl-${f.id}-${mk}`, urgent: true, icon: "🔴", title: `Gasto fijo vencido: ${f.name}`, body: `Vencía el ${fmtDate(due)} · ${money(f.amount)}${usd}. Marcalo como pagado en Finanzas personales.` }
      : { id: `pf-${f.id}-${mk}`, urgent: n === 0, icon: "📌", title: `${n === 0 ? "Vence HOY" : `Vence en ${n} día${n === 1 ? "" : "s"}`}: ${f.name}`, body: `${money(f.amount)}${usd} · día ${f.day}` });
  }
  for (const l of personalOf("loan").filter(loanOpen)) {
    const next = nextCuota(l);
    if (next) {
      const n = diffDays(next.date, t);
      if (n <= (Number(l.notice) || 5)) out.push({ id: `pc-${l.id}-${next.mk}${n < 0 ? "-late" : ""}`, urgent: true, icon: l.lender === "naranjax" ? "🟠" : "🔵", title: `${n < 0 ? "Cuota ATRASADA" : n === 0 ? "Cuota vence HOY" : `Cuota vence en ${n} día${n === 1 ? "" : "s"}`}: ${loanName(l)}`, body: `Cuota ${next.n}${l.cuotas ? ` de ${l.cuotas}` : ""} · ${money(l.cuota)} · ${fmtDate(next.date)}. Es obligatoria.` });
      continue;
    }
    if (loanStrict(l)) continue;
    if (l.returnBy) {
      const n = diffDays(l.returnBy, t);
      if (n <= (Number(l.notice) || 3)) out.push({ id: `pl-${l.id}-${l.returnBy}`, urgent: n <= 0, icon: "🤝", title: `${n < 0 ? "Ya pasó la fecha para devolverle" : n === 0 ? "Hoy tenés que devolverle" : `En ${n} día${n === 1 ? "" : "s"} le devolvés`} a ${l.name}`, body: `Te queda devolver ${money(loanLeft(l))}${l.reason ? ` · era para ${l.reason}` : ""}` });
    } else if (l.date && diffDays(t, l.date) >= 30) {
      out.push({ id: `pl0-${l.id}-${mk}`, icon: "🤝", title: `Préstamo de ${l.name} sin devolver`, body: `Hace ${diffDays(t, l.date)} días te prestó ${money(l.amount)}. Poné una fecha para devolverlo y te aviso.` });
    }
  }
  return out;
}

export function personalEvents(from, to) {
  const ev = [];
  for (let mk = monthKey(from); mk <= monthKey(to); mk = addMonth(mk, 1)) {
    for (const f of fixedOf(mk)) {
      const d = fixedDue(f, mk);
      if (d && d >= from && d <= to) ev.push({ date: d, type: "personal", text: `📌 ${f.name} ${money(f.amount)}${f.usd ? " USD" : ""}`, done: fixedPaid(f, mk) });
    }
  }
  for (const l of personalOf("loan")) {
    if (loanStrict(l)) {
      for (const mk of cuotaMonths(l)) {
        const d = cuotaDate(l, mk);
        if (d >= from && d <= to) ev.push({ date: d, type: "personal", text: `${l.lender === "naranjax" ? "🟠" : "🔵"} Cuota ${loanName(l)} ${money(l.cuota)}`, done: (l.payments || []).some((p) => p.month === mk) });
      }
    } else if (l.returnBy && l.returnBy >= from && l.returnBy <= to) ev.push({ date: l.returnBy, type: "personal", text: `🤝 Devolver a ${loanName(l)}`, done: !loanOpen(l) });
  }
  return ev;
}

// ---------- vista ----------
export function render(el, params) {
  if (params.tab) tab = params.tab;
  el.innerHTML = `<div class="stack">
    <div class="row pf-head">
      <div class="tabs" style="max-width:100%">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="pf-month"><button class="btn ghost icon sm" data-m="-1" aria-label="Mes anterior">${icon("chevL")}</button><b>${mLabel(month)}</b><button class="btn ghost icon sm" data-m="1" aria-label="Mes siguiente">${icon("chevR")}</button>
        ${month !== monthKey(today()) ? `<button class="btn sm soft" data-m="0">Hoy</button>` : ""}</div>
    </div>
    <div id="pf"></div></div>`;
  const again = () => render(el, {});
  $$("[data-tab]", el).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, "", "#/personal"); again(); }));
  $$("[data-m]", el).forEach((b) => (b.onclick = () => { month = b.dataset.m === "0" ? monthKey(today()) : addMonth(month, Number(b.dataset.m)); again(); }));
  ({ resumen, fijos, dia, prestamos, ingresos })[tab]($("#pf", el), again);
  return {
    title: "Finanzas personales",
    sub: "Tu plata, separada de la del negocio",
    actions: `<button class="btn primary" id="pf-quick">${icon("plus")} Anotar gasto</button>`,
    bind: (a) => ($("#pf-quick", a).onclick = () => expenseModal()),
  };
}

// ---------- resumen ----------
function resumen(el, again) {
  const m = monthTotals(month), prev = monthTotals(addMonth(month, -1));
  const varDelta = prev.varTotal ? Math.round(((m.varTotal - prev.varTotal) / prev.varTotal) * 100) : null;
  const outDelta = prev.out ? Math.round(((m.out - prev.out) / prev.out) * 100) : null;
  const deltaTxt = (d) => (d == null ? "" : `<span style="color:${d > 0 ? "var(--u-red)" : "var(--ok)"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}%</span> vs ${mShort(addMonth(month, -1))}`);
  const pendingFixed = m.fixed.filter((f) => !fixedPaid(f, month));
  const loans = personalOf("loan").filter(loanOpen);

  // últimos 6 meses: ingresos contra egresos (fijos + variables)
  const hist = Array.from({ length: 6 }, (_, i) => addMonth(month, i - 5)).map((k) => ({ k, ...monthTotals(k) }));


  el.innerHTML = `<div class="stack">
    <div class="grid g4">
      <div class="card stat"><span class="label">💵 Ingresos</span><span class="value" style="color:var(--ok)">${money(m.income)}</span><span class="hint">💜 ganancia de Tradex</span></div>
      <div class="card stat"><span class="label">📌 Gastos fijos</span><span class="value">${money(m.fixedTotal)}</span><span class="hint">pagaste ${money(m.fixedPaidTotal)} · faltan ${pendingFixed.length}</span></div>
      <div class="card stat"><span class="label">🧾 Gastos del día</span><span class="value">${money(m.varTotal)}</span><span class="hint">${m.vars.length} gastos ${deltaTxt(varDelta)}</span></div>
      <div class="card stat"><span class="label">${m.income ? "⚖️ Te queda" : "💸 Total gastado"}</span><span class="value" style="color:${m.income && m.income - m.out < 0 ? "var(--u-red)" : "inherit"}">${money(m.income ? m.income - m.out : m.out)}</span><span class="hint">${m.income ? `gastaste ${money(m.out)}` : ""} ${deltaTxt(outDelta)}</span></div>
    </div>

    <div class="card"><h3>📈 Ingresos y egresos por mes</h3>${lineChart(hist)}</div>
    ${compareCard(m, prev)}

    <div class="grid g2" style="align-items:start">
      <div class="card"><h3>🍕 Gastos comunes por categoría</h3>${donut(m.vars)}
      </div>
    </div>

    <div class="grid g2" style="align-items:start">
      <div class="card"><h3>📅 Lo que falta pagar en ${MONTHS[Number(month.slice(5, 7)) - 1]}</h3>
        ${pendingFixed.length ? `<div class="stack">${pendingFixed.map((f) => fixedRow(f)).join("")}</div>` : `<p class="muted">¡Todos los fijos del mes están pagos! 🎉</p>`}
      </div>
      <div class="card"><h3>🤝 Préstamos por devolver</h3>
        ${loans.length ? `<div class="stack">${loans.map((l) => `<div class="pf-line"><div class="pf-who">${lenderBadge(l)}<div><b>${esc(loanName(l))}</b><div class="small muted">${nextCuota(l) ? `próxima cuota ${fmtDate(nextCuota(l).date)}` : l.returnBy ? `devolver antes del ${fmtDate(l.returnBy)}` : `desde el ${fmtDate(l.date)}`}</div></div></div><b>${money(loanLeft(l))}</b></div>`).join("")}
          <div class="pf-line"><span class="muted">Total que debés</span><b style="color:var(--u-red)">${money(sum(loans, loanLeft))}</b></div></div>` : `<p class="muted">No debés nada a nadie 🙌</p>`}
      </div>
    </div>
  </div>`;
  bindFixed(el, again);
  bindChart(el, hist);
  bindDonut(el);
}

// ---------- torta (dona) de gastos comunes por categoría ----------
function donut(vars) {
  if (!vars.length) return `<p class="muted">Todavía no anotaste gastos comunes en ${mLabel(month)}.</p>`;
  const by = {};
  for (const e of vars) {
    const c = catOf(e.category);
    const key = c && c.slot != null && c.slot !== "" ? c.name : "Otras"; // las grises se juntan
    by[key] = (by[key] || 0) + (Number(e.amount) || 0);
  }
  const slices = Object.entries(by).sort((a, b) => (a[0] === "Otras") - (b[0] === "Otras") || b[1] - a[1]);
  const total = sum(slices, (x) => x[1]);
  const R = 80, r = 50, C = 100;
  let ang = -Math.PI / 2;
  const pt = (a, rad) => `${(C + rad * Math.cos(a)).toFixed(2)},${(C + rad * Math.sin(a)).toFixed(2)}`;
  const paths = slices.map(([name, v], i) => {
    const a0 = ang, a1 = ang + (v / total) * Math.PI * 2;
    ang = a1;
    const color = name === "Otras" ? "var(--cat-gray)" : catColor(name);
    if (slices.length === 1) return `<g class="pf-slice" data-i="${i}"><circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${color}" stroke-width="${R - r}"/></g>`;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    return `<path class="pf-slice" data-i="${i}" fill="${color}" d="M${pt(a0, R)} A${R},${R} 0 ${big} 1 ${pt(a1, R)} L${pt(a1, r)} A${r},${r} 0 ${big} 0 ${pt(a0, r)} Z"/>`;
  }).join("");
  const label = (name) => (name === "Otras" ? "📦 Otras" : catLabel(name));
  return `<div class="pf-donut" data-total="${money(total)}">
    <div class="pf-donut-svg"><svg viewBox="0 0 200 200" role="img" aria-label="Gastos comunes de ${mLabel(month)} por categoría">${paths}</svg>
      <div class="pf-donut-c"><b>${money(total)}</b><small>total del mes</small></div></div>
    <div class="pf-donut-leg">${slices.map(([name, v], i) => `<div class="pf-leg-row" data-i="${i}" data-name="${esc(label(name))}" data-v="${money(v)}"><i style="background:${name === "Otras" ? "var(--cat-gray)" : catColor(name)}"></i><span>${esc(label(name))}</span><b>${Math.round((v / total) * 100)}%</b><span class="muted">${money(v)}</span></div>`).join("")}</div>
  </div>`;
}
function bindDonut(el) {
  const box = $(".pf-donut", el);
  if (!box) return;
  const center = $(".pf-donut-c", box), rows = $$(".pf-leg-row", box), slices = $$(".pf-slice", box);
  const show = (i) => {
    box.classList.toggle("hovering", i != null);
    slices.forEach((s) => s.classList.toggle("on", s.dataset.i === String(i)));
    rows.forEach((r) => r.classList.toggle("on", r.dataset.i === String(i)));
    const r = rows.find((x) => x.dataset.i === String(i));
    center.innerHTML = r ? `<b>${r.dataset.v}</b><small>${esc(r.dataset.name)}</small>` : `<b>${box.dataset.total}</b><small>total del mes</small>`;
  };
  [...slices, ...rows].forEach((x) => { x.onmouseenter = x.onclick = () => show(x.dataset.i); });
  box.onmouseleave = () => show(null);
}

// ---------- comparación de gastos: este mes contra el anterior ----------
function compareCard(m, prev) {
  const pk = addMonth(month, -1);
  const cur = mShort(month), old = mShort(pk);
  const byCat = (t) => t.vars.reduce((a, e) => ((a[e.category || "Otros"] = (a[e.category || "Otros"] || 0) + (Number(e.amount) || 0)), a), {});
  const a = byCat(m), b = byCat(prev);
  const rows = [
    { name: "📌 Gastos fijos", now: m.fixedTotal, before: prev.fixedTotal, fixed: true },
    ...[...new Set([...Object.keys(a), ...Object.keys(b)])].map((c) => ({ name: c, now: a[c] || 0, before: b[c] || 0 })),
  ].sort((x, y) => (y.fixed - x.fixed) || (y.now - x.now) || (y.before - x.before));
  const diffCell = (r) => {
    const d = r.now - r.before;
    if (!d) return `<span class="muted">igual</span>`;
    const pct = r.before ? ` (${d > 0 ? "+" : ""}${Math.round((d / r.before) * 100)}%)` : "";
    return `<b style="color:${d > 0 ? "var(--u-red)" : "var(--ok)"}">${d > 0 ? "▲ +" : "▼ −"}${money(Math.abs(d))}</b><span class="small muted">${pct}</span>`;
  };
  const varRows = rows.filter((r) => !r.fixed);
  const up = [...varRows].sort((x, y) => (y.now - y.before) - (x.now - x.before))[0];
  const down = [...varRows].sort((x, y) => (x.now - x.before) - (y.now - y.before))[0];
  const tips = [];
  const dOut = m.out - prev.out;
  tips.push(dOut > 0 ? `En ${MONTHS[Number(month.slice(5, 7)) - 1]} gastaste <b>${money(dOut)} más</b> que en ${MONTHS[Number(pk.slice(5, 7)) - 1]}.` : dOut < 0 ? `En ${MONTHS[Number(month.slice(5, 7)) - 1]} gastaste <b>${money(-dOut)} menos</b> que en ${MONTHS[Number(pk.slice(5, 7)) - 1]} 🎉` : "Gastaste lo mismo que el mes anterior.");
  if (up && up.now - up.before > 0) tips.push(`Donde más subió: <b>${esc(up.name)}</b> (+${money(up.now - up.before)}).`);
  if (down && down.now - down.before < 0) tips.push(`Donde más ahorraste: <b>${esc(down.name)}</b> (−${money(down.before - down.now)}).`);
  if (month === monthKey(today())) tips.push(`<span class="muted">${MONTHS[Number(month.slice(5, 7)) - 1][0].toUpperCase() + MONTHS[Number(month.slice(5, 7)) - 1].slice(1)} todavía no terminó: van ${Number(today().slice(8))} de ${daysIn(month)} días.</span>`);
  // lo más caro de cada mes (gastos del día; los fijos se ven arriba)
  const topOf = (t) => [...t.vars].sort((x, y) => (Number(y.amount) || 0) - (Number(x.amount) || 0)).slice(0, 3);
  const topList = (mk, t) => {
    const list = topOf(t);
    return `<div><div class="small muted" style="text-transform:capitalize;font-weight:700;margin-bottom:6px">${mLabel(mk)}</div>${list.length ? list.map((e, i) => `<div class="pf-top ${i ? "" : "first"}"><span class="pf-rank">${i + 1}</span><div class="pf-info"><b>${esc(e.note || e.category)}</b><div class="small muted">${esc(e.category || "")} · ${e.date ? fmtDate(e.date) : "sin fecha"}</div></div><b>${money(e.amount)}</b></div>`).join("") : `<p class="muted small">Sin gastos anotados.</p>`}</div>`;
  };
  return `<div class="card stack"><h3 style="margin:0">🔍 Tus gastos: ${mLabel(month)} contra ${mLabel(pk)}</h3>
    <div class="pf-tips">${tips.map((t) => `<p>${t}</p>`).join("")}</div>
    <div class="grid g2" style="align-items:start">
      <div class="table-wrap"><table><thead><tr><th>En qué</th><th class="right" style="text-transform:capitalize">${old}</th><th class="right" style="text-transform:capitalize">${cur}</th><th class="right">Diferencia</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="right muted">${money(r.before)}</td><td class="right"><b>${money(r.now)}</b></td><td class="right nowrap">${diffCell(r)}</td></tr>`).join("")}
        <tr class="pf-total"><td><b>Total gastado</b></td><td class="right"><b>${money(prev.out)}</b></td><td class="right"><b>${money(m.out)}</b></td><td class="right nowrap">${diffCell({ now: m.out, before: prev.out })}</td></tr>
      </tbody></table></div>
      <div class="stack"><div style="font-weight:700">💸 Lo más caro que gastaste <span class="small muted" style="font-weight:500">· gastos del día, sin los fijos</span></div><div class="grid g2">${topList(month, m)}${topList(pk, prev)}</div></div>
    </div></div>`;
}

// ---------- gráfico de líneas: ingresos (verde, continua) y egresos (rojo, punteada) ----------
const W = 680, H = 250, PL = 64, PR = 88, PT = 14, PB = 30;
const shortMoney = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1).replace(".", ",").replace(",0", "")} M` : v >= 1000 ? `$${Math.round(v / 1000)} mil` : `$${Math.round(v)}`);
function niceMax(v) {
  if (v <= 0) return 100000;
  const step = 10 ** Math.floor(Math.log10(v)), f = v / step;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * step;
}
function lineChart(hist) {
  const max = niceMax(Math.max(...hist.map((h) => Math.max(h.income, h.out))));
  const x = (i) => PL + (i * (W - PL - PR)) / (hist.length - 1);
  const y = (v) => PT + (1 - v / max) * (H - PT - PB);
  const path = (key) => hist.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(h[key]).toFixed(1)}`).join("");
  const last = hist.length - 1;
  // etiquetas al final de cada línea, separadas si quedan encimadas
  let yi = y(hist[last].income), yo = y(hist[last].out);
  if (Math.abs(yi - yo) < 16) { const mid = (yi + yo) / 2, up = yi <= yo; yi = mid + (up ? -8 : 8); yo = mid + (up ? 8 : -8); }
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${PL}" x2="${W - PR}" y1="${y(max * f)}" y2="${y(max * f)}" class="pf-grid${f ? "" : " base"}"/><text x="${PL - 8}" y="${y(max * f) + 4}" class="pf-ax" text-anchor="end">${shortMoney(max * f)}</text>`).join("");
  return `<div class="pf-legend" style="margin:0 0 6px"><span><i class="pf-sw inc"></i>Ingresos</span><span><i class="pf-sw out"></i>Egresos (fijos + del día)</span></div>
  <div class="pf-chart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos y egresos de los últimos ${hist.length} meses">
      ${grid}
      ${hist.map((h, i) => `<text x="${x(i)}" y="${H - 8}" class="pf-ax ${h.k === month ? "on" : ""}" text-anchor="middle">${mShort(h.k)}</text>`).join("")}
      <line class="pf-cross" y1="${PT}" y2="${H - PB}" x1="0" x2="0" style="display:none"/>
      <path d="${path("out")}" class="pf-line out"/>
      <path d="${path("income")}" class="pf-line inc"/>
      ${hist.map((h, i) => `<rect x="${x(i) - 4}" y="${y(h.out) - 4}" width="8" height="8" rx="1.5" class="pf-dot out"/><circle cx="${x(i)}" cy="${y(h.income)}" r="4" class="pf-dot inc"/>`).join("")}
      <text x="${x(last) + 10}" y="${yi + 4}" class="pf-end">Ingresos</text>
      <text x="${x(last) + 10}" y="${yo + 4}" class="pf-end">Egresos</text>
      ${hist.map((h, i) => `<rect class="pf-hit" data-i="${i}" x="${x(i) - (W - PL - PR) / (hist.length - 1) / 2}" y="0" width="${(W - PL - PR) / (hist.length - 1)}" height="${H}"/>`).join("")}
    </svg>
    <div class="pf-tip" hidden></div>
  </div>
  <details class="small" style="margin-top:8px"><summary class="muted" style="cursor:pointer">Ver como tabla</summary>
    <div class="table-wrap"><table><thead><tr><th>Mes</th><th class="right">Ingresos</th><th class="right">Fijos</th><th class="right">Del día</th><th class="right">Balance</th></tr></thead><tbody>
    ${hist.map((h) => `<tr><td style="text-transform:capitalize">${mLabel(h.k)}</td><td class="right">${money(h.income)}</td><td class="right">${money(h.fixedTotal)}</td><td class="right">${money(h.varTotal)}</td><td class="right"><b>${money(h.income - h.out)}</b></td></tr>`).join("")}
    </tbody></table></div></details>`;
}
function bindChart(el, hist) {
  const box = $(".pf-chart", el);
  if (!box) return;
  const svg = $("svg", box), tip = $(".pf-tip", box), cross = $(".pf-cross", svg);
  const x = (i) => PL + (i * (W - PL - PR)) / (hist.length - 1);
  $$(".pf-hit", svg).forEach((r) => {
    r.onmouseenter = r.onclick = () => {
      const i = Number(r.dataset.i), h = hist[i];
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.style.display = "";
      tip.innerHTML = `<b style="text-transform:capitalize">${mLabel(h.k)}</b>
        <div><i class="pf-sw inc"></i>Ingresos <b>${money(h.income)}</b></div>
        <div class="muted" style="padding-left:22px">💜 Tradex ${money(h.incomeOrders)}${h.incomeOther ? ` · otros ${money(h.incomeOther)}` : ""}</div>
        <div><i class="pf-sw out"></i>Egresos <b>${money(h.out)}</b></div>
        <div class="muted" style="padding-left:22px">fijos ${money(h.fixedTotal)} · del día ${money(h.varTotal)}</div>
        <div style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px">Balance <b style="color:${h.income - h.out < 0 ? "var(--u-red)" : "var(--ok)"}">${money(h.income - h.out)}</b></div>`;
      tip.hidden = false;
      const left = (x(i) / W) * box.clientWidth;
      tip.style.left = `${Math.min(Math.max(left, tip.offsetWidth / 2 + 4), box.clientWidth - tip.offsetWidth / 2 - 4)}px`;
    };
  });
  svg.onmouseleave = () => { tip.hidden = true; cross.style.display = "none"; };
}

// ---------- gastos fijos ----------
function fixedRow(f, mk = month) {
  const st = dueState(f, mk), paid = fixedPaid(f, mk);
  return `<div class="pf-fixed ${paid ? "paid" : ""}">
    <div class="pf-day"><b>${f.day || "–"}</b><small>${f.day ? "día" : "sin día"}</small></div>
    <div class="pf-info"><b>${esc(f.name)}</b> ${f.usd ? `<span class="chip pf-usd" title="Se paga en dólares">💵 USD${f.usdAmount ? ` ${esc(f.usdAmount)}` : ""}</span>` : ""}
      <div class="small muted">${esc(f.category || "")}${f.note ? ` · ${esc(f.note)}` : ""}</div></div>
    <div class="pf-amt"><b>${money(fixedAmount(f, mk))}</b><span class="chip ${st.cls}">${st.text}</span></div>
    <div class="pf-acts">
      <button class="btn sm ${paid ? "ghost" : "primary"}" data-pay="${f.id}">${paid ? "Deshacer" : `${icon("check")} Pagado`}</button>
      <button class="btn ghost icon sm" data-edit-fixed="${f.id}" title="Editar">${icon("edit")}</button>
    </div></div>`;
}

function bindFixed(el, again) {
  $$("[data-pay]", el).forEach((b) => (b.onclick = async () => {
    const f = db.get(COL, b.dataset.pay);
    const paid = { ...(f.paid || {}) };
    if (paid[month]) delete paid[month];
    else paid[month] = { at: month === monthKey(today()) ? today() : fixedDue(f, month) || `${month}-01`, amount: Number(f.amount) || 0 };
    await db.put(COL, { ...f, paid });
    if (paid[month]) toast(`✔ ${f.name} pagado`, `${money(paid[month].amount)} · ${mLabel(month)}`);
    again();
  }));
  $$("[data-edit-fixed]", el).forEach((b) => (b.onclick = () => fixedModal(db.get(COL, b.dataset.editFixed))));
}

function fijos(el, again) {
  const m = monthTotals(month);
  const paidPct = m.fixedTotal ? Math.round((m.fixedPaidTotal / m.fixedTotal) * 100) : 0;
  // calendario del mes con los vencimientos
  const [y, mo] = month.split("-").map(Number);
  const lead = (new Date(y, mo - 1, 1).getDay() + 6) % 7;
  const byDay = {};
  for (const f of m.fixed) { const d = fixedDue(f, month); if (d) (byDay[Number(d.slice(8))] ||= []).push(f); }
  const t = today();
  el.innerHTML = `<div class="stack">${mustPayBanner()}
    <div class="grid g3">
      <div class="card stat"><span class="label">Total fijos del mes</span><span class="value">${money(m.fixedTotal)}</span><span class="hint">${m.fixed.length} gastos</span></div>
      <div class="card stat"><span class="label">Ya pagaste</span><span class="value" style="color:var(--ok)">${money(m.fixedPaidTotal)}</span><span class="pf-track"><i style="width:${paidPct}%"></i></span></div>
      <div class="card stat"><span class="label">Te falta pagar</span><span class="value" style="color:var(--u-red)">${money(m.fixedTotal - m.fixedPaidTotal)}</span><span class="hint">${m.fixed.filter((f) => !fixedPaid(f, month)).length} pendientes</span></div>
    </div>
    <div class="grid pf-fix-grid" style="align-items:start">
      <div class="card stack">
        <div class="row" style="justify-content:space-between"><h3 style="margin:0">📌 Vencimientos de ${mLabel(month)}</h3><button class="btn soft sm" id="pf-new-fixed">${icon("plus")} Gasto fijo</button></div>
        ${m.fixed.length ? m.fixed.map((f) => fixedRow(f)).join("") : `<div class="empty"><div class="big">📌</div><p>Cargá tus gastos fijos (alquiler, luz, gimnasio…) y te aviso antes de que venzan.</p></div>`}
      </div>
      <div class="card"><h3>🗓️ Calendario</h3>
        <div class="pf-cal">${["L", "M", "M", "J", "V", "S", "D"].map((d) => `<span class="h">${d}</span>`).join("")}
          ${"<span></span>".repeat(lead)}
          ${Array.from({ length: daysIn(month) }, (_, i) => {
            const d = i + 1, list = byDay[d] || [], iso = `${month}-${String(d).padStart(2, "0")}`;
            const cls = list.length ? (list.every((f) => fixedPaid(f, month)) ? "paid" : iso < t ? "late" : "due") : "";
            return `<span class="d ${cls} ${iso === t ? "today" : ""}" title="${esc(list.map((f) => `${f.name} ${money(f.amount)}`).join(" · "))}">${d}${list.length ? `<i>${list.length > 1 ? list.length : ""}</i>` : ""}</span>`;
          }).join("")}
        </div>
        <div class="pf-legend"><span><i class="due"></i>Por pagar</span><span><i class="paidc"></i>Pagado</span><span><i class="late"></i>Vencido</span></div>
      </div>
    </div>
  </div>`;
  $("#pf-new-fixed", el).onclick = () => fixedModal();
  bindFixed(el, again);
  bindLoans(el, again);
}

function fixedModal(f = null) {
  const x = f || { day: "", category: "Servicios", notice: 3, since: monthKey(today()) };
  modal({
    title: f ? `Editar: ${esc(f.name)}` : "Nuevo gasto fijo",
    body: `<div class="grid g2">
      <label class="field">¿Qué es?<input name="name" value="${esc(x.name || "")}" placeholder="Ej: Alquiler" required></label>
      <label class="field">Monto por mes (en pesos)<input name="amount" data-money="1" value="${esc(x.amount ?? "")}" placeholder="0"></label>
      <label class="field">Día del mes que vence<input type="number" name="day" min="1" max="31" value="${esc(x.day ?? "")}" placeholder="Ej: 10"></label>
      <label class="field">Categoría<input name="category" list="pf-fcats" value="${esc(x.category || "")}"><datalist id="pf-fcats">${FIXED_CATS.map((c) => `<option value="${c}">`).join("")}</datalist></label>
      <label class="field">Avisarme días antes<input type="number" name="notice" min="0" max="15" value="${esc(x.notice ?? 3)}"></label>
      <label class="field">Cuenta desde el mes<input type="month" name="since" value="${esc(x.since || "")}"></label>
    </div>
    <label class="check" style="margin-top:12px"><input type="checkbox" name="usd" ${x.usd ? "checked" : ""}> 💵 Se paga en dólares (USD)</label>
    <label class="field" style="margin-top:8px">Monto en USD (opcional)<input name="usdAmount" value="${esc(x.usdAmount || "")}" placeholder="Ej: 20"></label>
    <label class="field" style="margin-top:8px">Nota<input name="note" value="${esc(x.note || "")}" placeholder="Ej: débito automático, se paga con tarjeta…"></label>`,
    foot: `${f ? `<button class="btn ghost" id="pf-del" style="margin-right:auto;color:var(--u-red)">${icon("trash")} Dar de baja</button>` : ""}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pf-save">Guardar</button>`,
    onMount: (el, api) => {
      $("#pf-save", el).onclick = async () => {
        const d = readForm($(".modal-body", el));
        if (!d.name) return toast("Falta el nombre del gasto", "", { urgent: true });
        await db.put(COL, { ...x, ...d, kind: "fixed", day: d.day === "" ? "" : Math.min(31, Math.max(1, d.day)) });
        api.close();
        toast(f ? "Gasto fijo actualizado" : "Gasto fijo agregado", d.name);
      };
      if (f) $("#pf-del", el).onclick = async () => {
        if (!(await confirmBox(`Deja de contar desde ${mLabel(month)}. Lo que ya pagaste en meses anteriores queda en el historial.`, "Sí, dar de baja", { title: `¿Dar de baja ${esc(f.name)}?` }))) return;
        const until = addMonth(month, -1);
        if (f.since && until < f.since) await db.remove(COL, f.id);
        else await db.put(COL, { ...f, until });
        api.close();
      };
    },
  });
}

// ---------- gastos del día ----------
function quickForm(kind) {
  const isInc = kind === "income";
  const cats = isInc ? INCOME_SRC : catNames();
  return `<form class="card pf-quick" id="pf-qf" autocomplete="off">
    <div class="pf-qgrid">
      <label class="field">Monto<input name="amount" data-money="1" placeholder="0" required></label>
      <label class="field">${isInc ? "¿De dónde?" : "¿En qué?"}<input name="note" placeholder="${isInc ? "Ej: ganancia de Tradex" : "Ej: super, lomitos, remera…"}"></label>
      <label class="field">Fecha<input type="date" name="date" value="${monthKey(today()) === month ? today() : `${month}-01`}"></label>
      <button class="btn primary" type="submit">${icon("plus")} ${isInc ? "Agregar ingreso" : "Anotar"}</button>
    </div>
    <div class="chips-filter pf-cats">${cats.map((c) => `<button type="button" data-cat="${esc(c)}">${esc(isInc ? c : catLabel(c))}</button>`).join("")}
      ${isInc ? "" : `<button type="button" id="pf-cats-edit" class="pf-cat-edit" title="Agregar, renombrar o borrar categorías">${icon("edit")} Categorías</button>`}</div>
    <input type="hidden" name="category">
  </form>`;
}

function bindQuick(el, kind, again) {
  const form = $("#pf-qf", el);
  const catIn = $('input[name="category"]', form);
  let manual = false;
  const pick = (c) => { catIn.value = c; $$("[data-cat]", form).forEach((b) => b.classList.toggle("on", b.dataset.cat === c)); };
  $$("[data-cat]", form).forEach((b) => (b.onclick = () => { manual = true; pick(catIn.value === b.dataset.cat ? "" : b.dataset.cat); }));
  $("#pf-cats-edit", form)?.addEventListener("click", () => catsModal(again));
  if (kind === "expense") $('input[name="note"]', form).addEventListener("input", (e) => { if (!manual) pick(autoCat(e.target.value)); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = readForm(form);
    if (!d.amount) return toast("Poné el monto", "", { urgent: true });
    if (kind === "expense" && isLoanText(d.note)) return sendToLoans(d);
    await db.put(COL, { kind, amount: d.amount, note: d.note, date: d.date || today(), category: d.category || (kind === "expense" ? autoCat(d.note) || "Otros" : "Otro") });
    toast(kind === "expense" ? "Gasto anotado" : "Ingreso anotado", `${money(d.amount)}${d.note ? ` · ${d.note}` : ""}`);
    again();
    setTimeout(() => $('#pf-qf input[name="amount"]')?.focus(), 80);
  };
  setTimeout(() => $('input[name="amount"]', form)?.focus(), 60);
}

function movesList(list, kind, mk = month) {
  if (!list.length) return `<div class="empty"><div class="big">${kind === "expense" ? "🧾" : "💵"}</div><p>Nada anotado en ${mLabel(mk)}.</p></div>`;
  const byDate = {};
  for (const x of [...list].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""))) (byDate[x.date || ""] ||= []).push(x);
  return Object.entries(byDate).map(([d, xs]) => `<div class="pf-daygroup"><div class="pf-dayhead"><span>${d ? fmtDate(d, { long: true }) : "Sin fecha"}</span><span>${money(sum(xs, (x) => x.amount))}</span></div>
    ${xs.map((x) => `<div class="pf-line"><div><b>${esc(x.note || x.category)}</b> <span class="chip pf-catchip" style="--c:${catColor(x.category)}">${esc(x.kind === "income" ? x.category || "" : catLabel(x.category))}</span></div>
      <div class="row" style="gap:4px"><b>${money(x.amount)}</b><button class="btn ghost icon sm" data-edit-move="${x.id}" title="Editar">${icon("edit")}</button></div></div>`).join("")}</div>`).join("");
}

function moveModal(x) {
  const cats = x.kind === "income" ? INCOME_SRC : catNames();
  modal({
    title: x.kind === "income" ? "Editar ingreso" : "Editar gasto",
    body: `<div class="grid g2">
      <label class="field">Monto<input name="amount" data-money="1" value="${esc(x.amount)}"></label>
      <label class="field">Fecha<input type="date" name="date" value="${esc(x.date)}"></label>
      <label class="field">Descripción<input name="note" value="${esc(x.note || "")}"></label>
      <label class="field">Categoría<select name="category">${options(cats.map((c) => [c, x.kind === "income" ? c : catLabel(c)]), x.category || "Otros", null)}</select></label>
    </div>`,
    foot: `<button class="btn ghost" id="pf-del" style="margin-right:auto;color:var(--u-red)">${icon("trash")} Borrar</button><button class="btn" data-close>Cancelar</button><button class="btn primary" id="pf-save">Guardar</button>`,
    onMount: (el, api) => {
      $("#pf-save", el).onclick = async () => {
        const d = readForm($(".modal-body", el));
        await db.put(COL, { ...x, ...d, month: d.date ? monthKey(d.date) : x.month || expMonth(x) });
        api.close();
      };
      $("#pf-del", el).onclick = async () => { if (await confirmBox(`${money(x.amount)} · ${esc(x.note || x.category)}`, "Sí, borrar", { title: "¿Borrar este movimiento?" })) { await db.remove(COL, x.id); api.close(); } };
    },
  });
}

// Anotar un gasto desde cualquier pestaña (botón de arriba) o en un mes puntual (un gasto que te olvidaste)
function expenseModal({ mk } = {}) {
  const past = mk && mk !== monthKey(today());
  const last = mk ? `${mk}-${String(daysIn(mk)).padStart(2, "0")}` : "";
  modal({
    title: mk ? `🧾 Agregar gasto de ${mLabel(mk)}` : "🧾 Anotar gasto",
    body: `${past ? `<p class="small muted" style="margin-top:0">Elegí el día en que lo gastaste.</p>` : ""}<div class="grid g2">
      <label class="field">Monto<input name="amount" data-money="1" placeholder="0"></label>
      <label class="field">Fecha<input type="date" name="date" value="${past ? last : today()}" ${mk ? `min="${mk}-01" max="${last}"` : ""}></label>
      <label class="field">¿En qué?<input name="note" placeholder="Ej: super, lomitos, remera…"></label>
      <label class="field">Categoría<select name="category">${options(catNames().map((c) => [c, catLabel(c)]), "", "Automática")}</select></label>
    </div>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pf-save">Anotar</button>`,
    onMount: (el, api) => {
      setTimeout(() => $('input[name="amount"]', el)?.focus(), 60);
      const save = async () => {
        const d = readForm($(".modal-body", el));
        if (!d.amount) return toast("Poné el monto", "", { urgent: true });
        if (isLoanText(d.note)) { api.close(); return sendToLoans(d); }
        await db.put(COL, { kind: "expense", amount: d.amount, note: d.note, date: d.date || today(), category: d.category || autoCat(d.note) || "Otros" });
        api.close();
        toast("Gasto anotado", `${money(d.amount)}${d.note ? ` · ${d.note}` : ""} · ${fmtDate(d.date || today())}`);
      };
      $("#pf-save", el).onclick = save;
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input")) { e.preventDefault(); save(); } });
    },
  });
}

// Gasto de un mes sin día: sólo monto y qué fue
function noDateModal(mk) {
  modal({
    title: `🧾 Gasto de ${mLabel(mk)}`,
    body: `<div class="grid g2">
      <label class="field">Monto<input name="amount" data-money="1" placeholder="0"></label>
      <label class="field">Producto / servicio<input name="note" placeholder="Ej: zapatillas, peluquería…"></label>
    </div>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pf-save">Agregar</button>`,
    onMount: (el, api) => {
      setTimeout(() => $('input[name="amount"]', el)?.focus(), 60);
      const save = async () => {
        const d = readForm($(".modal-body", el));
        if (!d.amount) return toast("Poné el monto", "", { urgent: true });
        if (isLoanText(d.note)) { api.close(); return sendToLoans({ ...d, date: `${mk}-01` }); }
        await db.put(COL, { kind: "expense", amount: d.amount, note: d.note, date: "", month: mk, category: autoCat(d.note) || "Otros" });
        api.close();
        toast(`Gasto agregado a ${mLabel(mk)}`, `${money(d.amount)}${d.note ? ` · ${d.note}` : ""}`);
      };
      $("#pf-save", el).onclick = save;
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input")) { e.preventDefault(); save(); } });
    },
  });
}

// Administrar categorías: emoji, nombre y color. Renombrar cambia los gastos ya cargados; borrar los pasa a "Otros".
function catsModal(again) {
  const list = catList().map((c, i) => ({ ...c, key: i }));
  const SWATCH = [0, 1, 2, 3, 4, 5, 6, 7, ""];
  const row = (c) => `<div class="pf-catrow" data-key="${c.key}">
      <input class="pf-emoji" value="${esc(c.emoji || "")}" maxlength="4" aria-label="Emoji">
      <input class="pf-cname" value="${esc(c.name)}" placeholder="Nombre" aria-label="Nombre">
      <div class="pf-swatches">${SWATCH.map((sl) => `<button type="button" class="pf-swatch ${String(c.slot ?? "") === String(sl) ? "on" : ""}" data-slot="${sl}" style="background:${sl === "" ? "var(--cat-gray)" : `var(--cat-${sl})`}" title="${sl === "" ? "Gris (sin color propio)" : "Color"}"></button>`).join("")}</div>
      ${c.name === "Otros" ? `<span style="width:32px"></span>` : `<button type="button" class="btn ghost icon sm pf-cdel" title="Borrar">${icon("trash")}</button>`}
    </div>`;
  modal({
    title: "🏷️ Categorías de gastos",
    wide: true,
    body: `<p class="small muted" style="margin-top:0">Cada color identifica a su categoría en el gráfico de torta. Hay 8 colores: las que quedan en gris se juntan en "Otras" en el gráfico.</p>
      <div class="stack" id="pf-catrows">${list.map(row).join("")}</div>
      <button type="button" class="btn soft sm" id="pf-cadd" style="margin-top:10px">${icon("plus")} Nueva categoría</button>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pf-save">Guardar</button>`,
    onMount: (el, api) => {
      const box = $("#pf-catrows", el);
      let next = list.length;
      box.addEventListener("click", (e) => {
        const sw = e.target.closest(".pf-swatch");
        if (sw) { $$(".pf-swatch", sw.parentElement).forEach((b) => b.classList.toggle("on", b === sw)); return; }
        if (e.target.closest(".pf-cdel")) e.target.closest(".pf-catrow").remove();
      });
      $("#pf-cadd", el).onclick = () => {
        const used = new Set($$(".pf-swatch.on", box).map((b) => b.dataset.slot));
        const free = [0, 1, 2, 3, 4, 5, 6, 7].find((sl) => !used.has(String(sl)));
        box.insertAdjacentHTML("beforeend", row({ key: `n${next++}`, name: "", emoji: "🏷️", slot: free ?? "" }));
        $$(".pf-cname", box).at(-1).focus();
      };
      $("#pf-save", el).onclick = async () => {
        const rows = $$(".pf-catrow", box).map((r) => {
          const slot = $(".pf-swatch.on", r)?.dataset.slot ?? "";
          return { key: r.dataset.key, name: $(".pf-cname", r).value.trim(), emoji: $(".pf-emoji", r).value.trim() || "🏷️", slot: slot === "" ? null : Number(slot) };
        }).filter((c) => c.name);
        const names = rows.map((c) => c.name.toLowerCase());
        if (new Set(names).size !== names.length) return toast("Hay dos categorías con el mismo nombre", "", { urgent: true });
        if (!rows.some((c) => c.name === "Otros")) rows.push({ key: "otros", name: "Otros", emoji: "📦", slot: null });
        // gastos ya cargados: renombrados siguen a su categoría; los de categorías borradas pasan a "Otros"
        const rename = new Map();
        for (const old of list) {
          const now = rows.find((c) => String(c.key) === String(old.key));
          if (!now || now.name !== old.name) rename.set(old.name, now ? now.name : "Otros");
        }
        for (const e of personalOf("expense")) if (rename.has(e.category)) await db.put(COL, { ...e, category: rename.get(e.category) });
        await db.put(COL, { id: "pf-cats", kind: "cats", list: rows.map(({ name, emoji, slot }) => ({ name, emoji, slot })) });
        api.close();
        toast("Categorías guardadas", rename.size ? `${rename.size} categoría(s) cambiaron: sus gastos se actualizaron` : "");
        again();
      };
    },
  });
}

// El mes elegido y el anterior, uno al lado del otro, para comparar
function dia(el, again) {
  const months = [month, addMonth(month, -1)];
  el.innerHTML = `<div class="stack">${quickForm("expense")}
    <div class="grid g2" style="align-items:start">${months.map((mk) => {
      const m = monthTotals(mk);
      return `<div class="stack"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Gastos de ${mLabel(mk)}</h3>
          <div class="row" style="gap:6px"><span class="chip accent">Total ${money(m.varTotal)}</span><button class="btn primary icon sm" data-add-in="${mk}" title="Agregar un gasto de ${mLabel(mk)} sin fecha" aria-label="Agregar gasto de ${mLabel(mk)}">${icon("plus")}</button></div></div>
        <div class="card">${movesList(m.vars, "expense", mk)}</div></div>`;
    }).join("")}</div></div>`;
  bindQuick(el, "expense", again);
  $$("[data-add-in]", el).forEach((b) => (b.onclick = () => noDateModal(b.dataset.addIn)));
  $$("[data-edit-move]", el).forEach((b) => (b.onclick = () => moveModal(db.get(COL, b.dataset.editMove))));
}

function ingresos(el, again) {
  const cobros = orderIncomes().filter((i) => monthKey(i.date) === month).sort((a, b) => b.date.localeCompare(a.date));
  const tOrders = sum(cobros, (c) => c.amount), tGross = sum(cobros, (c) => c.gross);
  el.innerHTML = `<div class="stack">
    <div class="grid g2">
      <div class="card stat"><span class="label">💜 Ganancia de pedidos</span><span class="value">${money(tOrders)}</span><span class="hint">cobraste ${money(tGross)} − costos de proveedor ${money(tGross - tOrders)}</span></div>
      <div class="card stat"><span class="label">Te quedó neto en ${mLabel(month)}</span><span class="value" style="color:var(--ok)">${money(tOrders)}</span></div>
    </div>
    <div class="card"><h3>💜 Ganancia de pedidos de Tradex <span class="small muted" style="font-weight:500">· de cada seña o saldo, lo que te queda después de pagar al proveedor</span></h3>
      ${cobros.some((c) => c.noCost) ? `<p class="small" style="margin-top:0">⚠️ Hay pedidos sin costo cargado: ahí la ganancia figura igual a lo cobrado. Cargá el costo en el pedido para que sea real.</p>` : ""}
      ${cobros.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Pedido</th><th>Qué</th><th>Medio</th><th class="right">Cobrado</th><th class="right">Ganancia</th><th></th></tr></thead><tbody>
        ${cobros.map((c) => `<tr><td class="nowrap">${fmtDate(c.date)}</td><td><b>${esc(c.name)}</b></td><td class="small">${esc(itemsText(c.o)) || "—"}</td><td><span class="chip ${c.label === "Seña" ? "accent" : "ok"}">${c.label}</span></td><td class="small">${esc(c.method || "—")}</td><td class="right muted">${money(c.gross)}</td><td class="right"><b style="color:var(--ok)">${money(c.amount)}</b>${c.noCost ? ` <span title="Pedido sin costo cargado">⚠️</span>` : ""}</td><td><a class="btn ghost sm" href="#/pedidos?id=${c.o.id}">Ver</a></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">No hay cobros de pedidos en ${mLabel(month)}.</p>`}
    </div>
  </div>`;
}

// ---------- préstamos ----------
function loanEnd(l) {
  if (!l.monthly || !loanOpen(l)) return "";
  const months = Math.ceil(loanLeft(l) / Number(l.monthly));
  const d = parseISO(today());
  d.setMonth(d.getMonth() + months);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function dueChip(date, notice, strict) {
  if (!date) return `<span class="small muted">Sin fecha</span>`;
  const n = diffDays(date, today());
  const cls = n < 0 ? "u-red" : n <= notice ? (strict ? "u-red" : "warn") : "u-gray";
  return `<span class="chip ${cls}">${n < 0 ? `Atrasado (${fmtDate(date)})` : n === 0 ? "HOY" : `${fmtDate(date)} · en ${n} día${n === 1 ? "" : "s"}`}</span>`;
}

function loanRow(l) {
  const open = loanOpen(l), strict = loanStrict(l), total = loanTotal(l);
  const back = l.returned ? total : loanReturned(l);
  const pct = total ? Math.min(100, Math.round((back / total) * 100)) : 0;
  const next = nextCuota(l);
  const paidN = (l.payments || []).filter((p) => p.month).length;
  return `<tr class="pf-row-${l.lender || "family"} ${open ? "" : "done"}">
    <td><div class="pf-who">${lenderBadge(l)}<div><b>${esc(loanName(l))}</b><div>${strict ? `<span class="chip u-red">Obligatorio</span>` : `<span class="chip u-gray">Flexible</span>`}</div></div></div></td>
    <td class="small">${esc(l.reason || "—")}</td>
    <td class="small">${fmtDate(l.date)}</td>
    <td class="right"><b>${money(l.amount)}</b>${strict && l.cuotas && l.cuota ? `<div class="small muted">${l.cuotas} cuotas de ${money(l.cuota)}</div>` : ""}</td>
    <td><span class="pf-track"><i style="width:${pct}%"></i></span><div class="small muted">${strict && l.cuotas ? `${paidN} de ${l.cuotas} cuotas` : money(back)}</div></td>
    <td class="right">${open ? `<b style="color:var(--u-red)">${money(loanLeft(l))}</b>${!strict && l.monthly ? `<div class="small muted">termina ${loanEnd(l)}</div>` : ""}` : `<b style="color:var(--ok)">✔ ${l.returnedAt ? fmtDate(l.returnedAt) : "Devuelto"}</b>`}</td>
    <td>${open ? (strict ? dueChip(next?.date, Number(l.notice) || 5, true) : dueChip(l.returnBy, Number(l.notice) || 3, false)) : ""}</td>
    <td><div class="pf-acts">${open
      ? strict ? `<button class="btn primary sm" data-loan-cuota="${l.id}">${icon("check")} Pagué la cuota</button>`
               : `<button class="btn primary sm" data-loan-done="${l.id}">${icon("check")} Ya devolví</button><button class="btn soft sm" data-loan-part="${l.id}">Una parte</button>`
      : `<button class="btn ghost sm" data-loan-undo="${l.id}">Deshacer</button>`}
      <button class="btn ghost icon sm" data-loan-edit="${l.id}" title="Editar">${icon("edit")}</button></div></td>
  </tr>`;
}

// byPerson: junta los préstamos de la misma persona y, si son 2 o más, suma abajo cuánto le debés en total
function loanTable(list, { byPerson = false } = {}) {
  let body = list.map(loanRow).join("");
  if (byPerson) {
    const groups = new Map();
    for (const l of list) { const k = loanName(l).trim().toLowerCase(); (groups.get(k) || groups.set(k, []).get(k)).push(l); }
    body = [...groups.values()].map((g) => g.map(loanRow).join("") + (g.length > 1
      ? `<tr class="pf-subtotal"><td colspan="5">Total que le debés a <b>${esc(loanName(g[0]))}</b> <span class="small muted">· ${g.length} préstamos (pediste ${money(sum(g, (l) => l.amount))}${sum(g, loanReturned) ? `, ya devolviste ${money(sum(g, loanReturned))}` : ""})</span></td><td class="right"><b>${money(sum(g, loanLeft))}</b></td><td colspan="2"></td></tr>`
      : "")).join("");
  }
  return `<div class="card table-wrap pf-loans"><table class="pf-ltable">
    <thead><tr><th>Quién</th><th>Para qué</th><th>Fecha</th><th class="right">Pediste</th><th>Devolviste</th><th class="right">Falta</th><th>Próximo pago</th><th></th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

// Cartel que llama la atención: cuotas de Naranja X y Mercado Pago, que sí o sí hay que pagar
function mustPayBanner() {
  const items = personalOf("loan").filter((l) => loanStrict(l) && loanOpen(l)).map((l) => ({ l, next: nextCuota(l) })).filter((x) => x.next).sort((a, b) => a.next.date.localeCompare(b.next.date));
  if (!items.length) return "";
  const hot = items.some((x) => diffDays(x.next.date, today()) <= (Number(x.l.notice) || 5));
  return `<div class="pf-must ${hot ? "hot" : ""}">
    <div class="pf-must-title">⚠️ Pagos obligatorios <span>estos sí o sí</span></div>
    ${items.map(({ l, next }) => {
      const n = diffDays(next.date, today());
      return `<div class="pf-must-item pf-row-${l.lender}">${lenderBadge(l)}
        <div class="pf-info"><b>${esc(loanName(l))}</b> · cuota ${next.n}${l.cuotas ? `/${l.cuotas}` : ""}<div class="small">${n < 0 ? `<b style="color:var(--u-red)">ATRASADA desde el ${fmtDate(next.date)}</b>` : n === 0 ? "<b>Vence HOY</b>" : `Vence el ${fmtDate(next.date, { long: true })} · faltan ${n} día${n === 1 ? "" : "s"}`}</div></div>
        <b class="pf-must-amt">${money(l.cuota || l.amount)}</b>
        <button class="btn primary sm" data-loan-cuota="${l.id}">${icon("check")} Pagué</button></div>`;
    }).join("")}</div>`;
}

function bindLoans(el, again) {
  $$("[data-loan-edit]", el).forEach((b) => (b.onclick = () => loanModal(db.get(COL, b.dataset.loanEdit))));
  $$("[data-loan-cuota]", el).forEach((b) => (b.onclick = async () => {
    const l = db.get(COL, b.dataset.loanCuota);
    const next = nextCuota(l);
    if (!next) return;
    const payments = [...(l.payments || []), { month: next.mk, date: today(), amount: Number(l.cuota) || 0 }];
    const done = l.cuotas && payments.filter((p) => p.month).length >= Number(l.cuotas);
    await db.put(COL, { ...l, payments, ...(done ? { returned: true, returnedAt: today() } : {}) });
    toast(done ? `🙌 Terminaste de pagar ${loanName(l)}` : `✔ Cuota ${next.n} de ${loanName(l)} pagada`, money(l.cuota), { action: { label: "Deshacer", run: () => db.put(COL, { ...db.get(COL, l.id), payments: payments.slice(0, -1), returned: false, returnedAt: "" }) } });
    again();
  }));
  $$("[data-loan-done]", el).forEach((b) => (b.onclick = async () => {
    const l = db.get(COL, b.dataset.loanDone);
    if (!(await confirmBox(`Se marca como devuelto el total de ${money(l.amount)} a ${esc(loanName(l))}.`, "Sí, ya devolví", { title: "¿Ya le devolviste todo?" }))) return;
    const left = loanLeft(l);
    await db.put(COL, { ...l, returned: true, returnedAt: today(), payments: [...(l.payments || []), ...(left ? [{ date: today(), amount: left }] : [])] });
    toast(`🙌 Préstamo de ${loanName(l)} devuelto`, money(l.amount));
    again();
  }));
  $$("[data-loan-part]", el).forEach((b) => (b.onclick = () => {
    const l = db.get(COL, b.dataset.loanPart);
    modal({
      title: `Devolución a ${esc(loanName(l))}`,
      body: `<p class="small muted">Te falta devolver ${money(loanLeft(l))}.</p><div class="grid g2">
        <label class="field">¿Cuánto devolviste?<input name="amount" data-money="1" value="${esc(l.monthly || "")}"></label>
        <label class="field">Fecha<input type="date" name="date" value="${today()}"></label></div>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pf-save">Guardar</button>`,
      onMount: (m, api) => {
        $("#pf-save", m).onclick = async () => {
          const d = readForm($(".modal-body", m));
          if (!d.amount) return toast("Poné el monto", "", { urgent: true });
          const payments = [...(l.payments || []), { date: d.date || today(), amount: d.amount }];
          const done = sum(payments, (p) => p.amount) >= loanTotal(l);
          await db.put(COL, { ...l, payments, ...(done ? { returned: true, returnedAt: d.date || today() } : {}) });
          api.close();
          toast(done ? `🙌 Terminaste de devolverle a ${loanName(l)}` : "Devolución anotada", money(d.amount));
        };
      },
    });
  }));
  $$("[data-loan-undo]", el).forEach((b) => (b.onclick = async () => {
    const l = db.get(COL, b.dataset.loanUndo);
    await db.put(COL, { ...l, returned: false, returnedAt: "", payments: (l.payments || []).slice(0, -1) });
    again();
  }));
}

function prestamos(el, again) {
  const all = personalOf("loan");
  const byNext = (l) => (loanStrict(l) ? nextCuota(l)?.date : l.returnBy) || "9";
  const strict = all.filter((l) => loanOpen(l) && loanStrict(l)).sort((a, b) => byNext(a).localeCompare(byNext(b)));
  const family = all.filter((l) => loanOpen(l) && !loanStrict(l)).sort((a, b) => byNext(a).localeCompare(byNext(b)));
  const closed = all.filter((l) => !loanOpen(l)).sort((a, b) => (b.returnedAt || "").localeCompare(a.returnedAt || ""));
  el.innerHTML = `<div class="stack">
    ${mustPayBanner()}
    <div class="row" style="justify-content:space-between">
      <div class="row"><span class="chip u-red">Debés ${money(sum([...strict, ...family], loanLeft))}</span><span class="chip">Obligatorio ${money(sum(strict, loanLeft))}</span><span class="chip">Familia ${money(sum(family, loanLeft))}</span></div>
      <button class="btn primary" id="pf-new-loan">${icon("plus")} Anotar préstamo</button>
    </div>
    ${all.length ? `
      ${strict.length ? `<h3 class="pf-sec">🔒 Naranja X y Mercado Pago <span class="small muted">· hay que pagarlos sí o sí</span></h3>${loanTable(strict)}` : ""}
      ${family.length ? `<h3 class="pf-sec">👪 Familia y conocidos <span class="small muted">· flexibles</span></h3>${loanTable(family, { byPerson: true })}` : ""}
      ${closed.length ? `<h3 class="pf-sec">✔ Ya devueltos</h3>${loanTable(closed)}` : ""}`
    : `<div class="card empty"><div class="big">🤝</div><p>Anotá la plata que te prestan: a quién le pediste, cuánto, cuándo y para qué. Te aviso antes de la fecha para devolver.</p></div>`}
  </div>`;
  $("#pf-new-loan", el).onclick = () => loanModal();
  bindLoans(el, again);
}

function loanModal(l = null, preset = {}) {
  const x = l || { date: today(), lender: "", ...preset };
  modal({
    title: l ? "Editar préstamo" : "🤝 Anotar préstamo",
    body: `<p class="small muted" style="margin-top:0">¿Quién te prestó?</p>
    <div class="pf-lenders">
      ${Object.entries(LENDERS).map(([k, L]) => `<button type="button" class="pf-lender pf-row-${k}" data-lender="${k}">${lenderBadge({ lender: k })}<span><b>${L.name}</b><small>Obligatorio · en cuotas</small></span></button>`).join("")}
      <button type="button" class="pf-lender pf-row-family" data-lender=""><span class="pf-logo pf-family">👪</span><span><b>Familia / conocido</b><small>Flexible</small></span></button>
    </div>
    <input type="hidden" name="lender" value="${esc(x.lender || "")}">
    <div class="grid g2" style="margin-top:12px">
      <label class="field" data-only="family">Nombre<input name="name" value="${esc(loanStrict(x) ? "" : x.name || "")}" placeholder="Ej: Mamá"></label>
      <label class="field">¿Cuánto pediste?<input name="amount" data-money="1" value="${esc(x.amount ?? "")}" placeholder="0"></label>
      <label class="field">Fecha<input type="date" name="date" value="${esc(x.date || "")}"></label>
      <label class="field" data-only="family">Devolver antes del (para avisarte)<input type="date" name="returnBy" value="${esc(x.returnBy || "")}"></label>
      <label class="field" data-only="strict">Cantidad de cuotas<input type="number" name="cuotas" min="1" max="120" value="${esc(x.cuotas ?? "")}" placeholder="Ej: 12"></label>
      <label class="field" data-only="strict">Valor de cada cuota<input name="cuota" data-money="1" value="${esc(x.cuota ?? "")}" placeholder="0"></label>
      <label class="field" data-only="strict">Primera cuota vence el<input type="date" name="firstDue" value="${esc(x.firstDue || "")}"></label>
      <label class="field" data-only="family">Si lo devolvés en cuotas: ¿cuánto por mes? (opcional)<input name="monthly" data-money="1" value="${esc(x.monthly ?? "")}" placeholder="0"></label>
    </div>
    <label class="field" style="margin-top:12px">¿Para qué lo pediste?<textarea name="reason" rows="2" placeholder="Ej: pagar el alquiler de noviembre">${esc(x.reason || "")}</textarea></label>
    <label class="field" style="margin-top:12px">Avisarme días antes<input type="number" name="notice" min="0" max="30" value="${esc(x.notice ?? "")}" placeholder="5 para Naranja X y Mercado Pago, 3 para familia"></label>`,
    foot: `${l ? `<button class="btn ghost" id="pf-del" style="margin-right:auto;color:var(--u-red)">${icon("trash")} Borrar</button>` : ""}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pf-save">Guardar</button>`,
    onMount: (el, api) => {
      const lenderIn = $('input[name="lender"]', el);
      const pick = (k) => {
        lenderIn.value = k;
        $$("[data-lender]", el).forEach((b) => b.classList.toggle("on", b.dataset.lender === k));
        $$("[data-only]", el).forEach((f) => (f.style.display = (f.dataset.only === "strict") === !!LENDERS[k] ? "" : "none"));
      };
      $$("[data-lender]", el).forEach((b) => (b.onclick = () => pick(b.dataset.lender)));
      pick(x.lender || "");
      $("#pf-save", el).onclick = async () => {
        const d = readForm($(".modal-body", el));
        const L = LENDERS[d.lender];
        if (L) {
          if (!d.amount || !d.cuotas || !d.cuota) return toast("Completá cuánto pediste, cuántas cuotas y de cuánto", "", { urgent: true });
          d.name = L.name;
          d.returnBy = ""; d.monthly = "";
          d.firstDue ||= `${addMonth(monthKey(d.date || today()), 1)}-${(d.date || today()).slice(8)}`;
          d.day = Number(d.firstDue.slice(8));
        } else {
          if (!d.name || !d.amount) return toast("Completá el nombre y cuánto pediste", "", { urgent: true });
          d.cuotas = ""; d.cuota = ""; d.firstDue = "";
        }
        await db.put(COL, { ...x, ...d, kind: "loan", payments: x.payments || [] });
        api.close();
        toast(l ? "Préstamo actualizado" : "Préstamo anotado", `${d.name} · ${money(d.amount)}${L ? ` · te aviso antes de cada cuota` : d.returnBy ? ` · te aviso antes del ${fmtDate(d.returnBy)}` : ""}`);
      };
      if (l) $("#pf-del", el).onclick = async () => { if (await confirmBox(`${esc(loanName(l))} · ${money(l.amount)}`, "Sí, borrar", { title: "¿Borrar este préstamo?" })) { await db.remove(COL, l.id); api.close(); } };
    },
  });
}
