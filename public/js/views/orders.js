// Módulo 1 — Pedidos y clientes
import { db, settings } from "../db.js";
import {
  icon, esc, money, fmtDate, today, addDays, startOfWeek, monthKey, relDay, urgency, STATUSES, statusOf,
  CHANNELS, SHIPPING, COURIERS, CATEGORIES, orderTotal, orderBalance, orderPaid, orderQty, waLink, fillTemplate,
  hiddenCostsPerUnit, priceFromCost, num, MONTHS, fmtDni, isCuit, dayLabel, orderCost, orderSale, itemsList, itemsText, statusStyle, statusPill, statusKey, BEFORE_SUPPLIER,
} from "../utils.js";
import { $, $$, modal, toast, confirmBox, readForm, options, autocomplete } from "../ui.js";
import { clientSuggestions, productSuggestions } from "../suggest.js";
import { categoryOptions } from "../categories.js";
import { alternativesOf, landedUnit, productShipping, tiersOf, unitCostFor, saveProduct, openProductForm } from "./products.js";
import { comboLines, comboDiscount, openComboBuilder } from "./combos.js";
import { loyaltyOf, loyaltyText } from "../loyalty.js";
import { printReceipt } from "../receipt.js";
import { placeFields, bindPlaces, placeText, placeFromPhone } from "../places.js";
import { problemNote, solveProblem } from "../todos.js";
import { supplierReminders, expectedArrival, itemSupplierId, orderSupplierIds } from "../alerts.js";
import { ensureClient, snapshot, clientsWithStats } from "../clientdb.js";

const state = { filter: "3meses", cat: "", q: "", view: localStorage.getItem("v-orders-view") || "list", status: "" };

// El mes actual y los 2 siguientes (ej: "Nov · Dic · Ene")
const next3Months = () => { const d = new Date(); return [0, 1, 2].map((i) => { const x = new Date(d.getFullYear(), d.getMonth() + i, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`; }); };
const monthName = (mk) => { const [y, m] = mk.split("-").map(Number); return `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`; };
// Período: los 3 meses que vienen, todos, o un mes anterior ("prev:2026-10")
const isPeriod = (f) => f === "3meses" || f === "todos" || f === "historico" || /^prev:\d{4}-\d{2}$/.test(f);
const prevMonths = (all) => {
  const cur = next3Months()[0];
  return [...new Set(all.map((o) => monthKey(o.deadline || o.eventDate)).filter((mk) => mk && mk < cur))].sort().reverse();
};
// Categoría de cada renglón (la del pedido o, si no tiene, la del producto del catálogo)
const itemCat = (i) => i.category || (i.productId && db.get("products", i.productId)?.category) || "Sin categoría";

function matchesPeriod(o) {
  const mk = monthKey(o.deadline || o.eventDate || "");
  if (state.filter === "3meses") return next3Months().includes(mk);
  if (state.filter.startsWith("prev:")) return mk === state.filter.slice(5);
  return true; // "todos" e "historico"
}
function matches(o) {
  return matchesPeriod(o) && matchesSearch(o);
}
// búsqueda y estado (sin el filtro de fechas): también se usa para el cuadro de entregados
function matchesSearch(o) {
  if (state.status && statusKey(o.status) !== state.status) return false;
  if (state.cat && !(o.items || []).some((i) => itemCat(i) === state.cat)) return false;
  if (state.q) {
    const q = state.q.toLowerCase().replace(/^#/, "");
    const digits = q.replace(/\D/g, "");
    const hay = `${o.client?.name} ${o.client?.dni} ${(o.items || []).map((i) => i.product).join(" ")} ${o.number}`.toLowerCase();
    const phone = String(o.client?.phone || "").replace(/\D/g, "");
    if (!hay.includes(q) && !(digits.length >= 3 && phone.includes(digits))) return false;
  }
  return true;
}

export function sortOrders(list) {
  return list.sort((a, b) => (a.deadline || a.eventDate || "9999").localeCompare(b.deadline || b.eventDate || "9999"));
}

export function orderCard(o, { compact = false } = {}) {
  const u = urgency(o);
  const st = statusOf(o.status);
  const total = orderTotal(o);
  const pct = total ? Math.round((orderPaid(o) / total) * 100) : 0;
  return `
  <article class="order-card ${u.cls}" data-order="${o.id}" draggable="true">
    <div class="top">
      <div><div class="name">${esc(o.client?.name || "Sin nombre")}</div>
      <div class="small muted">${esc(itemsText(o, " · ") || "Sin productos")}</div></div>
      <span class="chip ${u.cls} dot">${u.label}</span>
    </div>
    <div class="meta">
      ${statusPill(o.status)}
      ${o.deadline ? `<span class="chip">📦 ${fmtDate(o.deadline)}</span>` : ""}
      ${o.eventDate ? `<span class="chip">🎉 ${fmtDate(o.eventDate)}</span>` : ""}
      ${!compact && o.courier ? `<span class="chip">🚚 ${esc(o.courier)}</span>` : ""}
    </div>
    ${o.gift ? `<div class="money"><span>🎁 <b>Regalo</b></span><span>Te cuesta <b>${money(orderCost(o))}</b></span></div>` : `<div class="money"><span>Total <b>${money(total)}</b></span><span>Seña <b>${money(o.paidFull ? total : o.deposit)}</b></span>
      <span style="color:${orderBalance(o) ? "var(--u-red)" : "var(--ok)"}">Saldo <b>${orderBalance(o) ? money(orderBalance(o)) : "✔ Saldado"}</b></span></div>
    <div class="pay-bar"><span style="width:${pct}%"></span></div>`}
  </article>`;
}

export function render(el, params) {
  if (params.nuevo !== undefined) { setTimeout(() => openOrderForm(), 0); history.replaceState(null, "", "#/pedidos"); }
  if (params.id) setTimeout(() => openOrderDetail(params.id), 0);
  if (params.f && isPeriod(params.f)) state.filter = params.f;
  const all = db.all("orders").filter((o) => !o.archived);
  const list = sortOrders(all.filter(matches));

  el.innerHTML = `
    <div class="stack">
      <div class="row">
        <div class="search grow" style="min-width:220px">${icon("search")}<input type="search" id="o-q" placeholder="Buscar por cliente, teléfono, DNI o producto…" value="${esc(state.q)}"></div>
        <select id="o-status" style="width:auto">${options(STATUSES.map((s) => [s.key, s.label]), state.status, "Todos los estados")}</select>
        <button class="btn" id="o-cols" title="Elegir columnas del cuadro">${icon("cog")}<span>Columnas</span></button>
        <div class="tabs"><button data-v="list" class="${state.view === "list" ? "on" : ""}">${icon("list", "")} Tabla</button><button data-v="kanban" class="${state.view === "kanban" ? "on" : ""}">Etapas</button></div>
      </div>
      <div class="chips-filter wrap">
        <button data-f="3meses" class="${state.filter === "3meses" ? "on" : ""}">${next3Months().map((mk) => monthName(mk).slice(0, 3)).join(" · ")}</button>
        <button data-f="todos" class="${state.filter === "todos" ? "on" : ""}">Todos</button>
        <button data-f="historico" class="${state.filter === "historico" ? "on" : ""}">📚 Histórico (entregados)</button>
        <select id="o-prev" class="chip-select ${state.filter.startsWith("prev:") ? "on" : ""}" ${prevMonths(all).length ? "" : 'disabled title="Todavía no hay pedidos de meses anteriores"'}>${options(prevMonths(all).map((mk) => [`prev:${mk}`, monthName(mk)]), state.filter.startsWith("prev:") ? state.filter : "", "Anteriores ▾")}</select>
      </div>
      ${catChips(all)}
      ${state.cat ? catSummary(list) : ""}
      <div class="legend muted">
        <span class="chip u-red dot">Urgente esta semana</span><span class="chip u-violet dot">Semana que viene</span>
        <span class="chip u-blue dot">En 2 semanas</span><span class="chip u-green dot">Mes que viene</span>
      </div>
      <div id="o-results">${state.view === "kanban" ? kanban(list) : listHTML(list, all)}</div>
    </div>`;

  const q = $("#o-q", el);
  autocomplete(q, (x) => [...clientSuggestions(x), ...productSuggestions(x).slice(0, 3)]);
  q.oninput = () => { state.q = q.value; $("#o-results", el).innerHTML = state.view === "kanban" ? kanban(sortOrders(all.filter(matches))) : listHTML(sortOrders(all.filter(matches)), all); bindCards(el); };
  $("#o-status", el).onchange = (e) => { state.status = e.target.value; render(el, {}); };
  $$("[data-f]", el).forEach((b) => (b.onclick = () => { state.filter = b.dataset.f; render(el, {}); }));
  $("#o-prev", el).onchange = (e) => { state.filter = e.target.value || "3meses"; render(el, {}); };
  $$("[data-cat]", el).forEach((b) => (b.onclick = () => { state.cat = state.cat === b.dataset.cat ? "" : b.dataset.cat; render(el, {}); }));
  $("#o-cols", el).onclick = () => openColumnsPanel(() => render(el, {}));
  $$("[data-v]", el).forEach((b) => (b.onclick = () => { state.view = b.dataset.v; localStorage.setItem("v-orders-view", state.view); render(el, {}); }));
  bindCards(el);

  return {
    title: "Pedidos",
    sub: `${all.filter((o) => o.status !== "entregado").length} activos · ${list.length} en la vista`,
    actions: `<button class="btn primary" id="new-order">${icon("plus")}<span class="desktop-only">Nuevo pedido</span></button>`,
    bind: (a) => ($("#new-order", a).onclick = () => openOrderForm()),
  };
}

// Categorías que aparecen en los pedidos del período (con cuántos pedidos las llevan)
function catChips(all) {
  const units = new Map(); // cuántos pedidos llevan cada categoría
  for (const o of all.filter((x) => matchesPeriod(x) && (state.filter.startsWith("prev:") || x.status !== "entregado"))) for (const c of new Set((o.items || []).map(itemCat))) units.set(c, (units.get(c) || 0) + 1);
  if (state.cat && !units.has(state.cat)) units.set(state.cat, 0);
  if (!units.size) return "";
  const cats = [...units].sort((a, b) => b[1] - a[1]);
  return `<div class="chips-filter wrap cat-chips"><span class="small muted">Por producto:</span>${cats.map(([c, n]) => `<button data-cat="${esc(c)}" class="${state.cat === c ? "on" : ""}">${esc(c)} <span class="chip-n">${n}</span></button>`).join("")}</div>`;
}

const nrm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const missingIn = (o, name) => { const t = nrm(o.problem?.text); return !!t && nrm(name).split(/\W+/).filter((w) => w.length > 3).every((w) => t.includes(w.slice(0, 5))); };
// Resumen para hacer el encargue: cuánto de esa categoría se pidió, por proveedor y producto
function catSummary(list) {
  const bySup = new Map();
  for (const o of list.filter((x) => state.filter.startsWith("prev:") || x.status !== "entregado")) {
    for (const i of o.items || []) {
      if (itemCat(i) !== state.cat) continue;
      const p = i.productId && db.get("products", i.productId);
      const sid = itemSupplierId(i, o);
      const sup = bySup.get(sid) || { s: db.get("suppliers", sid), items: new Map() };
      const name = p?.name || i.product || "Sin nombre";
      const it = sup.items.get(name) || { qty: 0, toBuy: 0, clients: [] };
      const q = Number(i.qty) || 0;
      it.qty += q;
      // también cuenta si el pedido ya está en camino pero anotaste que falta este producto ("Falta: Vasos de aluminio")
      if (BEFORE_SUPPLIER.includes(o.status) || missingIn(o, name)) it.toBuy += q;
      it.clients.push(`${o.client?.name || "Cliente"} (${q})`);
      sup.items.set(name, it);
      bySup.set(sid, sup);
    }
  }
  if (!bySup.size) return `<div class="card muted small">No hay pedidos por entregar de ${esc(state.cat)} en este período.</div>`;
  const totalQty = [...bySup.values()].reduce((a, x) => a + [...x.items.values()].reduce((b, y) => b + y.qty, 0), 0);
  const totalBuy = [...bySup.values()].reduce((a, x) => a + [...x.items.values()].reduce((b, y) => b + y.toBuy, 0), 0);
  return `<div class="card cat-summary">
    <div class="card-head"><h3>📦 ${esc(state.cat)}: ${totalQty} unidades ${state.filter.startsWith("prev:") ? "pedidas" : "por entregar"}</h3><span class="small muted">${totalBuy ? `<b style="color:var(--u-red)">${totalBuy} sin comprar todavía</b>` : "✔ Todo comprado"}</span></div>
    ${[...bySup.values()].map(({ s, items }) => {
      const buy = [...items].filter(([, it]) => it.toBuy);
      const msg = `Hola${s?.contact ? ` ${s.contact}` : ""}! Te quiero encargar:\n${buy.map(([n, it]) => `• ${it.toBuy} ${n}`).join("\n")}\n¿Me confirmás precio y para cuándo lo tendrías?`;
      return `<div class="cs-sup"><div class="row" style="justify-content:space-between"><b>${esc(s?.name || "Sin proveedor")}</b>
        ${buy.length && s?.phone ? `<a class="btn wa sm" target="_blank" rel="noopener" href="${waLink(s.phone, msg)}">${icon("wa")} Encargar lo que falta</a>` : ""}</div>
        <table class="cs-tbl"><thead><tr><th>Producto</th><th class="right">Total</th><th class="right">Sin comprar</th><th>Clientes</th></tr></thead>
        <tbody>${[...items].map(([n, it]) => `<tr><td>${esc(n)}</td><td class="right"><b>${it.qty}</b></td><td class="right">${it.toBuy ? `<b style="color:var(--u-red)">${it.toBuy}</b>` : "—"}</td><td class="small muted">${esc(it.clients.join(" · "))}</td></tr>`).join("")}</tbody></table></div>`;
    }).join("")}
  </div>`;
}

// Los entregados salen del cuadro del mes y pasan al Histórico, agrupados por el mes en que se entregaron
function listHTML(all_list, all) {
  if (state.filter !== "historico") return activeHTML(all_list.filter((o) => o.status !== "entregado"));
  const done = all.filter((o) => o.status === "entregado" && matchesSearch(o))
    .sort((a, b) => (b.deliveredAt || b.deadline || "").localeCompare(a.deliveredAt || a.deadline || ""));
  if (!done.length) return `<div class="empty card"><div class="big">📚</div><p>Todavía no hay pedidos entregados.</p></div>`;
  const months = [...new Set(done.map((o) => monthKey(o.deliveredAt || o.deadline || o.eventDate) || "sin"))];
  return months.map((mk) => {
    const rows = done.filter((o) => (monthKey(o.deliveredAt || o.deadline || o.eventDate) || "sin") === mk);
    return `<section class="month-block"><div class="month-head"><h3>✅ ${mk === "sin" ? "Sin fecha" : monthName(mk)}</h3>
      <span class="muted small">${rows.length} entregado${rows.length === 1 ? "" : "s"} · total ${money(rows.reduce((a, o) => a + orderTotal(o), 0))} · ${rows.filter((o) => !o.invoicedAt && isCuit(o.client?.dni)).length} sin facturar</span></div>
      ${tableHTML(rows)}</section>`;
  }).join("");
}
function activeHTML(list) {
  if (state.filter === "3meses" || state.filter.startsWith("prev:")) {
    // un cuadro por mes, según la fecha de entrega
    return (state.filter === "3meses" ? next3Months() : [state.filter.slice(5)]).map((mk) => {
      const rows = list.filter((o) => monthKey(o.deadline || o.eventDate) === mk);
      return `<section class="month-block"><div class="month-head"><h3>${monthName(mk)}</h3>
        <span class="muted small">${rows.length} por entregar · total ${money(rows.reduce((a, o) => a + orderTotal(o), 0))} · a cobrar ${money(rows.reduce((a, o) => a + orderBalance(o), 0))} · ganancia ${money(rows.filter((o) => orderCost(o)).reduce((a, o) => a + orderTotal(o) - orderCost(o), 0))}</span></div>
        ${rows.length ? tableHTML(rows) : `<div class="card muted small">No hay pedidos para entregar en ${monthName(mk).split(" ")[0].toLowerCase()}.</div>`}</section>`;
    }).join("");
  }
  if (!list.length) return `<div class="empty card"><div class="big">🛍️</div><p>No hay pedidos por entregar en esta vista.</p><p class="small">Creá uno con el botón “Nuevo pedido” o dictáselo a Dex.</p></div>`;
  return tableHTML(list);
}

// Resaltador (como marcador fosforescente): atrasado, vence hoy, vence mañana
const hlClass = (o) => { if (o.status === "entregado" || !o.deadline) return ""; const t = today(); return o.deadline < t ? "hl-late" : o.deadline === t ? "hl-today" : o.deadline === addDays(t, 1) ? "hl-tomorrow" : ""; };

// Columnas del cuadro: se pueden mostrar u ocultar desde "Columnas" (se recuerda en cada dispositivo)
const COLUMNS = [
  { key: "entrega", label: "Entrega", fixed: true, cell: (o, u) => `<td class="nowrap"><span class="udot ${u.cls}" title="${u.label}"></span>${o.deadline ? fmtDate(o.deadline) : "—"}</td>` },
  { key: "evento", label: "Evento", cell: (o) => `<td class="nowrap">${o.eventDate ? `🎉 ${fmtDate(o.eventDate)}` : "—"}</td>` },
  { key: "cliente", label: "Cliente", fixed: true, sticky: true, cell: (o) => `<td class="nowrap ccol"><b>${esc(o.client?.name || "Sin nombre")}</b>${o.client?.phone ? `<div class="small muted">${esc(o.client.phone)}</div>` : ""}</td>` },
  { key: "productos", label: "Productos", cell: (o) => `<td class="prod">${itemsList(o)}</td>` },
  { key: "cant", label: "Cant.", right: true, sum: orderQty, cell: (o) => `<td class="right">${orderQty(o)}</td>` },
  { key: "total", label: "Total", right: true, sum: orderTotal, money: true, cell: (o) => `<td class="right nowrap">${o.gift ? "🎁 Regalo" : money(orderTotal(o))}</td>` },
  { key: "sena", label: "Seña", right: true, money: true, sum: (o) => (o.paidFull ? orderTotal(o) : Number(o.deposit) || 0), cell: (o) => `<td class="right nowrap">${o.gift ? "—" : money(o.paidFull ? orderTotal(o) : o.deposit)}</td>` },
  { key: "saldo", label: "Saldo", right: true, money: true, sum: orderBalance, cell: (o) => { const b = orderBalance(o); return o.gift ? `<td class="right nowrap muted">—</td>` : `<td class="right nowrap" style="color:${b ? "var(--u-red)" : "var(--ok)"}"><b>${b ? money(b) : "Saldado"}</b></td>`; } },
  // Ganancia = total − costo (productos del proveedor + extras). Sin costo cargado no se calcula, para no mostrar 100% falso.
  { key: "ganancia", label: "Ganan.", title: "Ganancia", right: true, money: true, sum: (o) => (orderCost(o) ? orderTotal(o) - orderCost(o) : 0), cell: (o) => {
    const c = orderCost(o); if (!c) return `<td class="right nowrap muted small">—</td>`;
    const g = orderTotal(o) - c; return `<td class="right nowrap" style="color:${g >= 0 ? "var(--ok)" : "var(--u-red)"}"><b>${money(g)}</b></td>`; } },
  { key: "estado", label: "Estado", cell: (o) => `<td><select class="st-select" data-st-o="${o.id}" style="${statusStyle(o.status)}">${STATUSES.map((x) => `<option value="${x.key}" style="${statusStyle(x.key)}" ${x.key === statusKey(o.status) ? "selected" : ""}>${x.label}</option>`).join("")}</select></td>` },
  { key: "envio", label: "Envío", cell: (o) => `<td class="nowrap">${esc(short(o.shipping))}</td>` },
  { key: "transporte", label: "Transp.", title: "Transporte del proveedor", cell: (o) => `<td class="nowrap">${esc(short(o.courier))}</td>` },
  { key: "dni", label: "DNI / CUIL", hidden: true, cell: (o) => `<td class="nowrap">${esc(fmtDni(o.client?.dni) || "—")}</td>` },
  { key: "direccion", label: "Localidad", hidden: true, cell: (o) => `<td>${esc(placeText(o.client) || "—")}</td>` },
  { key: "notas", label: "Notas", hidden: true, cell: (o) => `<td class="prod small">${esc(o.notes || "—")}</td>` },
  // al final: N° de seguimiento con botón para copiarlo y pegarlo en la página del correo
  { key: "seguimiento", label: "Seguim.", title: "N° de seguimiento", cell: (o) => `<td class="nowrap">${o.tracking ? `<span class="track-cell"><code>${esc(o.tracking)}</code><button class="btn ghost icon sm" data-copy="${esc(o.tracking)}" title="Copiar el N° de seguimiento">${icon("copy")}</button></span>` : "—"}</td>` },
];
// textos cortos para que el cuadro entre en la pantalla
const SHORT_STATUS = { pedir: "Pedir", esperando: "Recibir", entregar: "Entregar" };
const SHORT = { "Retiro en local": "Retiro", "Moto/Uber": "Moto", "Flecha Bus Cargas": "Flecha", "Correo Argentino": "Correo Arg." };
const short = (v) => (v ? SHORT[v] || v : "—");
const visibleCols = () => {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("v-cols") || "null"); } catch {}
  // columnas nuevas de esta versión: se suman aunque ya hayas elegido columnas antes
  const v = localStorage.getItem("v-cols-v");
  if (saved && v !== "4") { saved.push(...(v === "2" || v === "3" ? [] : ["ganancia"]), ...(v === "3" ? [] : ["seguimiento"])); localStorage.setItem("v-cols", JSON.stringify(saved)); localStorage.setItem("v-cols-v", "4"); }
  return COLUMNS.filter((c) => c.fixed || (saved ? saved.includes(c.key) : !c.hidden));
};

function openColumnsPanel(onSave) {
  const on = new Set(visibleCols().map((c) => c.key));
  modal({
    title: "⚙️ Columnas del cuadro",
    body: `<p class="muted small" style="margin-top:0">Elegí qué columnas ver. Entrega y Cliente quedan siempre.</p>
      <div class="grid g2">${COLUMNS.map((c) => `<label class="check"><input type="checkbox" data-col-key="${c.key}" ${on.has(c.key) ? "checked" : ""} ${c.fixed ? "disabled" : ""}> ${c.title || c.label}</label>`).join("")}</div>`,
    foot: `<button class="btn" id="cols-reset">Restablecer</button><button class="btn primary" id="cols-ok">${icon("check")} Aplicar</button>`,
    onMount: (el, m) => {
      $("#cols-reset", el).onclick = () => { localStorage.removeItem("v-cols"); m.close(); onSave(); };
      $("#cols-ok", el).onclick = () => {
        localStorage.setItem("v-cols", JSON.stringify($$("[data-col-key]", el).filter((x) => x.checked).map((x) => x.dataset.colKey)));
        m.close(); onSave();
      };
    },
  });
}

// Cuadro tipo Excel: una fila por pedido
function tableHTML(list) {
  const cols = visibleCols();
  const firstSum = cols.findIndex((c) => c.sum);
  return `<div class="card table-wrap otable-wrap"><table class="otable">
    <thead><tr>${cols.map((c) => `<th class="${c.right ? "right" : ""} ${c.sticky ? "ccol" : ""}"${c.title ? ` title="${c.title}"` : ""}>${c.label}</th>`).join("")}</tr></thead>
    <tbody>${list.map((o) => { const u = urgency(o); return `<tr data-order="${o.id}" class="${u.cls} ${o.status === "entregado" ? "done" : ""} ${hlClass(o)}">${cols.map((c) => c.cell(o, u)).join("")}</tr>`; }).join("")}</tbody>
    <tfoot><tr>${cols.map((c, i) => {
      if (c.foot) return `<td class="right nowrap">${c.foot(list)}</td>`;
      if (c.sum) { const v = list.reduce((a, o) => a + c.sum(o), 0); return `<td class="right nowrap"><b>${c.money ? money(v) : v}</b></td>`; }
      return `<td>${i === 0 || (firstSum === -1 && i === 0) ? `<b>${list.length} pedidos</b>` : ""}</td>`;
    }).join("")}</tr></tfoot>
  </table></div>`;
}

function kanban(list) {
  return `<div class="kanban">${STATUSES.map((s) => {
    const items = list.filter((o) => statusKey(o.status) === s.key);
    return `<div class="kcol" data-col="${s.key}"><div class="kcol-head">${statusPill(s.key)}<span class="n">${items.length}</span></div>
      ${items.map((o) => orderCard(o, { compact: true })).join("")}</div>`;
  }).join("")}</div>`;
}

function bindCards(el) {
  $$("[data-order]", el).forEach((c) => {
    c.onclick = (e) => { if (!e.target.closest("select, a, button")) openOrderDetail(c.dataset.order); };
    c.ondragstart = (e) => e.dataTransfer.setData("text/plain", c.dataset.order);
  });
  // copiar el N° de seguimiento para pegarlo en la página del correo
  $$("[data-copy]", el).forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(b.dataset.copy); }
    catch { const t = document.createElement("textarea"); t.value = b.dataset.copy; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
    b.innerHTML = icon("check"); b.classList.add("copied");
    toast("📋 Seguimiento copiado", `${b.dataset.copy} · pegalo en la página del correo`);
    setTimeout(() => { b.innerHTML = icon("copy"); b.classList.remove("copied"); }, 1800);
  }));
  $$("[data-st-o]", el).forEach((sel) => (sel.onchange = async () => { const o = db.get("orders", sel.dataset.stO); if (o) await setStatus(o, sel.value); }));
  $$("[data-col]", el).forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add("drop"); };
    col.ondragleave = () => col.classList.remove("drop");
    col.ondrop = async (e) => {
      e.preventDefault(); col.classList.remove("drop");
      const o = db.get("orders", e.dataTransfer.getData("text/plain"));
      if (o) await setStatus(o, col.dataset.col);
    };
  });
}

// Entregado = ya te pagaron todo: queda 100% pago (el saldo se anota en la caja del día) y sale de lo que falta cobrar
export function markDelivered(o) {
  const prev = { ...o };
  o.status = "entregado";
  o.deliveredAt = today();
  if (!o.gift) {
    o.paidFull = true; logPayment(prev, o);
    // se anota cuánto se cobró al entregar, para poder deshacerlo
    o.deliveryPay = { amount: orderPaid(o) - orderPaid(prev), prevPaidFull: !!prev.paidFull };
  }
  return o;
}

// Deshacer la entrega: vuelve a "Para entregar" y se saca el saldo que se había anotado como cobrado al entregar
export function undoDelivered(o) {
  o.status = "entregar";
  o.deliveredAt = "";
  const dp = o.deliveryPay;
  if (dp) {
    o.paidFull = dp.prevPaidFull;
    const k = (o.payments || []).map((p) => p.amount).lastIndexOf(dp.amount);
    if (dp.amount > 0 && k >= 0) o.payments = o.payments.filter((_, i) => i !== k);
    delete o.deliveryPay;
  }
  return o;
}

export async function setStatus(o, status) {
  if (status === "entregado") markDelivered(o);
  o.status = status;
  if (status === "esperando" && !o.supplierOrderedAt) o.supplierOrderedAt = today();
  if (status === "pagado") { const prev = { ...o }; o.paidFull = true; logPayment(prev, o); }
  await db.put("orders", o);
  toast(`${o.client?.name}: ${statusOf(status).label}`);
}

// ---------------- detalle ----------------
export function openOrderDetail(id) {
  const o = db.get("orders", id);
  if (!o) return;
  const s = settings();
  const u = urgency(o);
  const idx = STATUSES.findIndex((x) => x.key === statusKey(o.status));
  const next = STATUSES[idx + 1];
  const arr = expectedArrival(o);
  const supNames = orderSupplierIds(o).map((id) => db.get("suppliers", id)?.name).filter(Boolean);
  const rem = supplierReminders(o);
  modal({
    title: `Pedido de ${esc(o.client?.name || "")}`,
    wide: true,
    body: `
      <div class="stack">
        <div class="row"><span class="chip ${u.cls} dot">${u.label}</span>${statusPill(o.status)}
</div>
        ${problemNote(o)}
        ${isCuit((o.clientId && db.get("clients", o.clientId)?.dni) || o.client?.dni) ? `<div class="row">${o.invoicedAt ? `<span class="chip">🧾 Facturado el ${fmtDate(o.invoicedAt)}</span><button class="btn sm ghost" id="d-uninvoice">Deshacer</button>` : `<button class="btn primary" id="d-invoice">🧾 Ya facturé</button><span class="small muted">Todavía no le facturaste</span>`}</div>` : ""}
        <div class="tabs" style="width:max-content;max-width:100%">${STATUSES.map((st) => `<button data-st="${st.key}" class="st-tab ${st.key === statusKey(o.status) ? "on" : ""}" style="${statusStyle(st.key)}">${st.label}</button>`).join("")}</div>
        <div class="grid g3">
          <div class="card"><h3>👤 Cliente</h3>
            <div><b>${esc(o.client?.name)}</b></div>
            <div class="small">📞 ${esc(o.client?.phone || "—")}</div>
            <div class="small">📍 ${esc(placeText(o.client) || "—")}</div>
            <div class="small">🪪 DNI / CUIL ${esc(fmtDni(o.client?.dni) || "—")}</div>
            ${o.clientId ? `<button class="btn sm soft" id="d-client" style="margin-top:8px">👤 Ver ficha del cliente</button>` : ""}</div>
          <div class="card"><h3>📅 Fechas</h3>
            <div class="small">🎉 Evento: <b>${o.eventDate ? fmtDate(o.eventDate, { long: true }) : "—"}</b></div>
            <div class="small">📦 Entrega: <b>${o.deadline ? `${fmtDate(o.deadline, { long: true })} (${relDay(o.deadline)})` : "—"}</b></div>
            ${rem.map((r) => `<div class="small">📝 Pedir al proveedor: <b>${fmtDate(r.date)}</b> <span class="muted">(${r.label})</span></div>`).join("")}
            ${arr ? `<div class="small">🚚 Llega proveedor: <b>${fmtDate(arr)}</b></div>` : ""}
            ${[["shipBy", "🏭 El proveedor lo envía el"], ["arriveBy", "📥 Me llegaría el"]].map(([k, label]) => { const v = o.items?.find((i) => i[k])?.[k] || "";
              return `<div class="small">${label}: ${v ? `<button type="button" class="recv-date" data-sup-edit="${k}" title="Tocá para cambiar la fecha">${dayLabel(v)}</button>` : `<input type="date" data-sup-date="${k}">`}</div>`; }).join("")}</div>
          <div class="card"><h3>🚚 Envío</h3>
            <div class="small">Al cliente: <b>${esc(o.shipping || "—")}</b></div>
            <div class="small">Paquete del proveedor por: <b>${esc(o.courier || "—")}</b></div>
            ${o.tracking ? `<div class="small">Seguimiento: <b>${esc(o.tracking)}</b></div>` : ""}
            ${supNames.length ? `<div class="small">Proveedor${supNames.length > 1 ? "es" : ""}: <b>${esc(supNames.join(", "))}</b></div>` : ""}</div>
        </div>
        <div class="card"><h3>🛍️ Productos</h3>
          <div class="table-wrap"><table><thead><tr><th>Producto</th><th class="right">Cant.</th><th class="right">Precio</th><th class="right">Subtotal</th></tr></thead>
          <tbody>${(o.items || []).map((i) => `<tr><td>${esc(i.product)} ${i.category ? `<span class="chip">${esc(i.category)}</span>` : ""}${i.combo ? ` <span class="chip accent">🎁 ${esc(o.combos?.find((c) => c.key === i.combo)?.name || "Combo")}</span>` : ""}</td><td class="right">${i.qty}</td><td class="right">${money(i.unitPrice)}</td><td class="right">${money(i.qty * i.unitPrice)}</td></tr>`).join("")}</tbody></table></div>
          ${o.gift ? `<div class="price-box" style="margin-top:12px">
            <div class="price-line total"><span>🎁 Regalo (${orderQty(o)} productos) · te cuesta</span><span>${money(orderCost(o))}</span></div>
            <div class="small muted">No se cobra. Este costo se resta de tu ganancia del mes.</div></div>` : `<div class="price-box" style="margin-top:12px">
            <div class="price-line"><span>Total (${orderQty(o)} productos)</span><b>${money(orderTotal(o))}</b></div>
            ${o.reward ? `<div class="price-line"><span>💖 Premio Tarjeta VIP</span><b>${esc(o.reward.label)}${o.reward.amount ? ` (−${money(o.reward.amount)})` : ""}</b></div>` : ""}
            ${o.clientShipping && !o.shippingFree ? `<div class="price-line"><span>Incluye envío</span><b>${money(o.clientShipping)}</b></div>` : ""}
            <div class="price-line"><span>Seña</span><b>${money(o.deposit)}</b></div>
            <div class="price-line total"><span>Saldo pendiente</span><span>${orderBalance(o) ? money(orderBalance(o)) : "✔ 100% pago"}</span></div>
          </div>`}
        </div>
        ${o.notes ? `<div class="card"><h3>📝 Notas</h3><p style="margin:0;white-space:pre-wrap">${esc(o.notes)}</p></div>` : ""}
        <div class="card"><h3>${icon("wa")} Mensajes rápidos por WhatsApp</h3>
          ${o.client?.phone ? `<div class="row">${s.waTemplates.map((t, i) => `<a class="btn wa sm" target="_blank" rel="noopener" href="${waLink(o.client.phone, fillTemplate(t.text, o))}">${esc(t.name)}</a>`).join("")}</div>` : `<p class="muted small">Agregá el teléfono del cliente para usar los mensajes prearmados.</p>`}
        </div>
      </div>`,
    foot: `
      <button class="btn danger" id="d-del">${icon("trash")} Borrar</button>
      <button class="btn" id="d-dup">${icon("copy")} Duplicar</button>
      <button class="btn" id="d-pdf">${icon("receipt")} Comprobante PDF</button>
      ${orderBalance(o) > 0 ? `<button class="btn soft" id="d-paid">${icon("check")} Marcar 100% pago</button>` : ""}
      <button class="btn" id="d-edit">${icon("edit")} Editar</button>
      ${next ? `<button class="btn primary" id="d-next">Pasar a “${next.label}”</button>` : ""}`,
    onMount: (el, api) => {
      $$("[data-st]", el).forEach((b) => (b.onclick = async () => { await setStatus(o, b.dataset.st); api.close(); openOrderDetail(o.id); }));
      $$("[data-solved]", el).forEach((b) => (b.onclick = async () => { await solveProblem(o.id); api.close(); openOrderDetail(o.id); }));
      $("#d-next", el) && ($("#d-next", el).onclick = async () => { await setStatus(o, next.key); api.close(); openOrderDetail(o.id); });
      $("#d-paid", el) && ($("#d-paid", el).onclick = async () => { const prev = { ...o }; o.paidFull = true; logPayment(prev, o); await db.put("orders", o); toast("💵 Pedido marcado como 100% pago"); api.close(); openOrderDetail(o.id); });
      $("#d-edit", el).onclick = () => { api.close(); openOrderForm(o); };
      const reopen = () => { api.close(); openOrderDetail(o.id); };
      $("#d-invoice", el) && ($("#d-invoice", el).onclick = async () => { await db.put("orders", { ...o, invoicedAt: today() }); toast("🧾 Pedido facturado"); reopen(); });
      $("#d-uninvoice", el) && ($("#d-uninvoice", el).onclick = async () => { await db.put("orders", { ...o, invoicedAt: "" }); reopen(); });
      // fechas del proveedor: se guardan en todos los productos del pedido
      $$("[data-sup-date]", el).forEach((inp) => (inp.onchange = async () => { if (!inp.value) return; await db.put("orders", { ...o, items: (o.items || []).map((i) => ({ ...i, [inp.dataset.supDate]: inp.value })) }); reopen(); }));
      $$("[data-sup-edit]", el).forEach((b) => (b.onclick = () => {
        b.outerHTML = `<input type="date" data-sup-date="${b.dataset.supEdit}" value="${o.items?.find((i) => i[b.dataset.supEdit])?.[b.dataset.supEdit] || ""}">`;
        $$("[data-sup-date]", el).forEach((inp) => (inp.onchange = async () => { if (!inp.value) return; await db.put("orders", { ...o, items: (o.items || []).map((i) => ({ ...i, [inp.dataset.supDate]: inp.value })) }); reopen(); }));
      }));
      $("#d-client", el) && ($("#d-client", el).onclick = async () => { api.close(); (await import("./clients.js")).openClientCard(o.clientId); });
      $("#d-pdf", el).onclick = () => printReceipt(o);
      $("#d-dup", el).onclick = () => { api.close(); duplicateOrder(o); };
      $("#d-del", el).onclick = async () => { if (await confirmBox(`¿Borrar el pedido de ${esc(o.client?.name)}?`, "Borrar")) { await db.remove("orders", o.id); api.close(); toast("Pedido borrado"); } };
    },
  });
}

export function duplicateOrder(o) {
  const copy = structuredClone(o);
  delete copy.id; delete copy.createdAt; delete copy.number;
  copy.client = { name: "", phone: "", address: "", province: "", city: "", dni: "" };
  delete copy.clientId;
  Object.assign(copy, { deposit: 0, paidFull: false, status: "senado", eventDate: "", deadline: "", supplierOrderedAt: "", deliveredAt: "", tracking: "" });
  openOrderForm(copy, { title: "Duplicar pedido (completá el nuevo cliente)" });
}

function nextNumber() {
  const max = db.all("orders").reduce((m, o) => Math.max(m, Number(o.number) || 0), 0);
  return String(max + 1).padStart(4, "0");
}

// ---------------- formulario ----------------
const s_names = (keys) => settings().hidden.filter((h) => keys.includes(h.key)).map((h) => h.name.toLowerCase()).join(", ");

// Ganancia bruta y neta, margen, a cuánto convenía venderlo y consejos para la próxima
function saleAnalysis({ its, sugTotal, total, usingSug, ships, other, payMethod, pack, ship, charged }) {
  const st = settings();
  const productCost = its.reduce((a, i) => a + i.qty * i.unitCost, 0);
  const hasCost = its.some((i) => i.unitCost);
  if (!hasCost) return `<div class="small muted">Cargá el costo c/u de los productos (arriba en este cuadro) para calcular tu ganancia.</div>`;
  const card = ["Tarjeta", "Naranja X"].includes(payMethod);
  const commission = card ? (total + charged) * (st.payMedia[0].credito * (1 + st.iva / 100) + (Number(st.iibb) || 0)) / 100 : 0;
  const gross = total - productCost;
  // neta: el envío que pagás se resta; si se lo cobraste al cliente, se compensa
  const shipCost = ships.reduce((a, x) => a + (x.free ? 0 : x.cost), 0);
  const extra = shipCost + other;
  const net = gross - pack.total - extra - ship + charged - commission;
  const margin = total ? Math.round((net / total) * 100) : 0;
  const verdict = net < 0 ? ["bad", "❌ Perdiste plata con esta venta"] : margin < 15 ? ["bad", "🟠 Muy poca ganancia"] : margin < 30 ? ["warn", "⚠️ Ganancia baja"] : ["ok", "✅ Venta rentable"];
  const qty = its.reduce((a, i) => a + i.qty, 0);
  // consejos
  const tips = [];
  if (sugTotal && total < sugTotal * 0.98) tips.push(`💡 La próxima cobralo al menos <b>${money(sugTotal)}</b>${qty ? ` (${money(sugTotal / qty)} c/u)` : ""}: así mantenés tu ${st.markup}% de ganancia. Esta vez quedaste ${money(sugTotal - total)} abajo.`);
  if (sugTotal && total >= sugTotal * 1.05) tips.push(`👏 ¡Muy bien! Vendiste ${Math.round((total / sugTotal - 1) * 100)}% arriba del precio sugerido.`);
  const warns = [];
  for (const i of its) {
    const p = i.productId && db.get("products", i.productId);
    if (!p) continue;
    const cheaper = alternativesOf(p).filter((a) => landedUnit(a) < landedUnit(p)).sort((a, b) => landedUnit(a) - landedUnit(b))[0];
    if (cheaper) tips.push(`🔁 ${esc(db.get("suppliers", cheaper.supplierId)?.name || "Otro proveedor")} tiene “${esc(cheaper.name)}” a ${money(landedUnit(cheaper))} c/u con envío (vs ${money(landedUnit(p))}): te ahorrarías unos ${money((landedUnit(p) - landedUnit(cheaper)) * i.qty)}.`);
    const packQ = p.priceMode === "pack" ? Number(p.packQty) || 0 : 0;
    if (packQ && i.qty < packQ) warns.push(`⚠️ “${esc(p.name)}” viene en pack de ${packQ} y en Cant. pusiste ${i.qty}. La cantidad son las unidades: si es un pack, poné ${packQ}.`);
    else if (p.minQty && i.qty < Number(p.minQty)) warns.push(`📦 “${esc(p.name)}” tiene mínimo de compra x${p.minQty} y pediste ${i.qty}: confirmá con el proveedor o ofrecé más cantidad.`);
  }
  if (ship && !charged) tips.push(`🚚 Regalaste el envío (${money(ship)}): la próxima podés sumarlo al precio o cobrarlo aparte.`);
  if (extra && qty && extra / qty > (productCost / qty) * 0.25) tips.push(`🚚 El envío y los extras suman ${money(extra / qty)} por unidad: si juntás este pedido con otros del mismo proveedor, pagás un solo envío.`);
  if (card && commission) tips.push(`💳 Cobrando con tarjeta se van ${money(commission)} en comisión + IVA: ofrecé un precio por transferencia.`);
  // Cuadro minimalista: Concepto | Monto
  const line = (concept, amount, cls = "") => `<tr class="${cls}"><td>${concept}</td><td class="right nowrap">${amount}</td></tr>`;
  const rows = [
    line(`Venta${usingSug ? " <span class='muted small'>(sugerido)</span>" : ""}`, money(total)),
    line("− Costo de productos", money(productCost)),
    line("= Ganancia bruta", money(gross), "sub"),
    line(`− Packaging <span class="muted small">(${pack.keys.length ? s_names(pack.keys) : "nada"})</span>`, money(pack.total)),
    ships.length ? line(`− Envío de proveedores <span class="muted small">(${ships.map((x) => `${esc(x.name)}${x.free ? " gratis" : ""}`).join(", ")})</span>`, money(shipCost)) : "",
    other ? line("− Otros extras (matriz…)", money(other)) : "",
    ship && !charged ? line("− Envío al cliente <span class='muted small'>(gratis)</span>", money(ship)) : "",
    commission ? line(`− Comisión de cobro + IVA${st.iibb ? " + IIBB" : ""}`, money(commission)) : "",
    line("= Ganancia neta", `${money(net)} (${margin}%)`, `net ${verdict[0]}`),
  ];
  return `${warns.map((w) => `<div class="pack-warn">${w}</div>`).join("")}<table class="mini-tbl"><thead><tr><th>Concepto</th><th class="right">Monto</th></tr></thead><tbody>${rows.join("")}</tbody></table>
    ${charged ? `<p class="small muted" style="margin:6px 0 0">🚚 El envío de ${money(charged)} se lo cobrás al cliente aparte (no suma ni resta ganancia).</p>` : ""}
    <p class="small" style="margin:8px 0 0">${verdict[1]}${sugTotal ? ` · 💚 Precio sugerido: <b style="color:var(--ok)">${money(sugTotal)}</b>${qty ? ` (${money(sugTotal / qty)} c/u)` : ""}` : ""}</p>
    ${tips.length ? `<details class="tips-mini"><summary>💡 Consejos para la próxima venta (${Math.min(tips.length, 5)})</summary>${tips.slice(0, 5).map((t) => `<div>${t}</div>`).join("")}</details>` : ""}`;
}

// "💲 $45.000 por 15 u. · $3.000 c/u": para qué cantidad vale el precio del proveedor
const priceInfo = (p) => !p?.price ? "" : `<span class="small muted">💲 ${p.priceMode === "pack" && p.packQty ? `${money(p.packPrice)} por ${p.packQty} u. · ${money(p.price)} c/u` : p.priceMode === "tiers" ? tiersOf(p).map((t) => `${money(t.price)} c/u desde ${t.min} u.`).join(" · ") : `${money(p.price)} c/u`}${p.minQty > 1 && p.priceMode !== "pack" ? ` · mínimo ${p.minQty} u.` : ""}${p.priceDate ? ` · precio del ${fmtDate(p.priceDate)}` : ""}</span>`;
let rowSeq = 0;
const comboChip = (name) => `<div class="small it-combo" style="grid-column:1/-1"><span class="chip accent">🎁 Combo ${esc(name || "")}</span></div>`;
function itemRow(i = {}) {
  return `<div class="grid item-row" data-key="r${++rowSeq}" style="grid-template-columns: 2fr 1fr 80px 36px; gap:4px 8px; align-items:end">
    <label class="field">Producto<input name="product" list="dl-products" value="${esc(i.product || "")}" placeholder="Ej: Taza personalizada"></label>
    <label class="field">Categoría<select name="category">${categoryOptions(i.category)}</select></label>
    <label class="field">Cant.<input name="qty" type="number" min="0" value="${i.qty ?? 1}"></label>
    <input type="hidden" name="productId" value="${esc(i.productId || "")}">
    <input type="hidden" name="unitCost" value="${i.unitCost ?? ""}">
    <input type="hidden" name="unitPrice" value="${i.unitPrice ?? ""}">
    <input type="hidden" name="combo" value="${esc(i.combo || "")}">
    <button class="btn ghost icon danger" data-rm title="Quitar">${icon("x")}</button>
    ${i.combo ? comboChip(i.comboName) : ""}
    <div class="it-quick" style="grid-column:1/-1"></div>
    <label class="it-sup">🏭 Proveedor<select name="itemSupplier">${options(db.all("suppliers").map((x) => [x.id, x.name]), i.supplierId, "Elegí el proveedor…")}</select></label>
  </div>`;
}

// Precio de venta sugerido de todo el pedido (no se edita): costo de productos + envío de cada proveedor
// + packaging (uno por pedido) + envío al cliente si lo regalás, y encima la ganancia (60% o 50%).
// El sugerido de cada renglón es su parte, según lo que cuesta cada producto.
function orderSuggestion(its, ships, pack, freeShip) {
  const goods = its.reduce((a, i) => a + i.qty * i.unitCost, 0);
  if (!goods) return null;
  const shipCost = ships.reduce((a, x) => a + (x.free ? 0 : x.cost), 0);
  const total = priceFromCost(goods + shipCost + pack.total + freeShip).price;
  const row = (i) => { const t = (total * i.qty * i.unitCost) / goods; return t ? { total: t, unit: i.qty ? t / i.qty : 0 } : null; };
  return { total, row };
}

export function openOrderForm(o = null, { title } = {}) {
  const isNew = !o?.id;
  o = o ? structuredClone(o) : { status: "senado", items: [{ qty: 1 }], client: {} };
  const clients = uniqueClients();
  const products = db.all("products");
  const suppliers = db.all("suppliers");
  const s = settings();
  modal({
    title: title || (isNew ? "Nuevo pedido" : `Editar pedido de ${esc(o.client?.name || "")}`),
    wide: true,
    body: `
    <form class="stack" id="of" autocomplete="off">
      <datalist id="dl-clients">${clients.map((c) => `<option value="${esc(c.name)}">${esc(c.phone || "")}</option>`).join("")}</datalist>
      <datalist id="dl-products">${products.map((p) => `<option value="${esc(p.name)}">${esc(db.get("suppliers", p.supplierId)?.name || "")} · ${money(p.price)}</option>`).join("")}</datalist>
      <fieldset><legend>👤 Ficha del cliente</legend>
        <div class="grid g4">
          <label class="field">Nombre *<input name="c_name" list="dl-clients" required value="${esc(o.client?.name || "")}"><input type="hidden" name="clientId" value="${esc(o.clientId || "")}"><span class="small" id="c-hint" style="font-weight:500"></span></label>
          <label class="field">Teléfono<input name="c_phone" type="tel" value="${esc(o.client?.phone || "")}" placeholder="383 4123456"></label>
          ${placeFields("c_", o.client)}
          <label class="field">DNI o CUIL<input name="c_dni" placeholder="Ej: 27-41808224-6" value="${esc(o.client?.dni || "")}"></label>
        </div>
        <div id="loyal-box"></div>
      </fieldset>
      <fieldset><legend>🛍️ Productos</legend>
        <div class="stack" id="items">${(o.items?.length ? o.items.map((i) => ({ ...i, supplierId: itemSupplierId(i, o), comboName: o.combos?.find((c) => c.key === i.combo)?.name })) : [{ qty: 1 }]).map(itemRow).join("")}</div>
        <div class="row" style="margin-top:10px"><button type="button" class="btn sm soft" id="add-item">${icon("plus")} Agregar producto</button>
        <button type="button" class="btn sm soft" id="add-combo">🎁 Armar combo</button>
        <span class="small muted">Si elegís un producto de tu catálogo se completan costo y precio sugerido (+${s.markup}%).</span></div>
      </fieldset>
      <div class="grid g2">
        <fieldset><legend>💵 Pagos</legend>
          <label class="gift-toggle"><input type="checkbox" name="gift" ${o.gift ? "checked" : ""}> 🎁 Es un regalo <span class="small muted">(no se cobra: lo que cuesta se resta de tu ganancia)</span></label>
          <div class="pay-fields">
          <div class="grid g2">
            <label class="field" title="A cuánto lo vendiste">Total de la venta<input name="total" type="number" min="0" value="${o.id ? orderSale(o) : o.total ?? ""}" placeholder="Si lo dejás vacío, uso el sugerido"></label>
            <label class="field">Seña<input name="deposit" type="number" min="0" value="${o.deposit ?? ""}"></label>
            <label class="field">Medio de pago<select name="payMethod">${options(["Transferencia", "Efectivo", "Mercado Pago", "Tarjeta", "Naranja X"], o.payMethod, "—")}</select></label>
          </div>
          <div class="row" style="margin-top:10px">
            <label class="check"><input type="checkbox" name="paidFull" ${o.paidFull ? "checked" : ""}> Está 100% pago</label>
          </div>
          </div>
          <div class="price-box" style="margin-top:10px" id="pay-sum"></div>
        </fieldset>
        <fieldset><legend>📅 Fechas y estado</legend>
          <div class="grid g2">
            <label class="field">Fecha del evento<input name="eventDate" type="date" value="${o.eventDate || ""}"></label>
            <label class="field">Fecha límite de entrega<input name="deadline" type="date" value="${o.deadline || ""}"></label>
            <label class="field">Estado<select name="status">${options(STATUSES.map((x) => [x.key, x.label]), statusKey(o.status), null)}</select></label>
          </div>
          <div class="small muted" id="fri-hint" style="margin-top:8px"></div>
        </fieldset>
      </div>
      <fieldset><legend>🚚 Envíos</legend>
        <div class="grid g4">
          <label class="field">Entrega al cliente<select name="shipping">${options(SHIPPING, o.shipping, "—")}</select></label>
          <label class="field">Paquete del proveedor viene por<select name="courier">${options(COURIERS, o.courier, "—")}</select></label>
          <label class="field">N° de seguimiento<input name="tracking" value="${esc(o.tracking || "")}"></label>
        </div>
      </fieldset>
      <label class="field">📝 Notas<textarea name="notes" placeholder='Ej: "quiere la caja en dorado, con cinta rosa y sin tapa"'>${esc(o.notes || "")}</textarea></label>
      <fieldset class="sale-box"><legend>💰 Resultado de la venta</legend>
        <div id="cost-table"></div>
        <div class="pack-box">
          <b>🎁 Packaging del pedido</b> <span class="small muted">(va uno por pedido)</span>
          <div class="row" style="margin-top:6px">${s.hidden.map((h) => `<label class="check"><input type="checkbox" data-pack="${h.key}" ${(o.packaging ? (o.packaging.keys || []).includes(h.key) : !o.id && h.on) ? "checked" : ""}> ${esc(h.name)} <span class="muted small">${money(h.cost)}</span></label>`).join("")}</div>
          <div class="small muted" id="pack-total" style="margin-top:4px"></div>
        </div>
        <div class="pack-box" style="margin-top:10px">
          <b>🚚 Envío de proveedores</b> <span class="small muted">(uno por proveedor; tildá “Gratis” si ese no te cobra el envío)</span>
          <div id="sup-ship" style="margin-top:6px"></div>
        </div>
        <div id="analysis" style="margin-top:12px"></div>
      </fieldset>
    </form>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="of-save">${icon("check")} Guardar pedido</button>`,
    onMount: (el, api) => {
      const form = $("#of", el);
      bindPlaces(form, "c_");
      const items = $("#items", el);
      const collectItems = () => $$(".item-row", items).map((r) => {
        const f = readForm(r);
        return { key: r.dataset.key, product: f.product, category: f.category, qty: Number(f.qty) || 0, unitPrice: Number(f.unitPrice) || 0, unitCost: Number(f.unitCost) || 0, productId: f.productId, supplierId: f.itemSupplier || "", ...(f.combo ? { combo: f.combo } : {}) };
      }).filter((i) => i.product);
      const rowOf = (key) => items.querySelector(`.item-row[data-key="${key}"]`);
      // packaging tildado × cantidad total de unidades
      const packaging = (its) => {
        const keys = $$("[data-pack]", el).filter((c) => c.checked).map((c) => c.dataset.pack);
        const perUnit = s.hidden.filter((h) => keys.includes(h.key)).reduce((a, h) => a + Number(h.cost || 0), 0);
        const qty = its.reduce((a, i) => a + i.qty, 0);
        return { keys, perUnit, qty, total: perUnit }; // uno por pedido
      };
      // Envío de cada proveedor del pedido (se cuenta una vez por proveedor). Lo que tocás queda guardado acá.
      const shipState = {};
      (o.supplierShip || []).forEach((x) => (shipState[x.supplierId] = { cost: x.cost, free: !!x.free }));
      const supShipDefault = (sid) => { const sc = db.get("suppliers", sid)?.shippingCost; return sc !== "" && sc != null && !isNaN(sc) ? Number(sc) : s.shipSmall; };
      const supplierShipping = (its) => {
        const g = new Map();
        for (const i of its) {
          const p = i.productId && db.get("products", i.productId);
          const sid = i.supplierId;
          if (!sid) continue;
          const def = p && p.supplierId === sid ? productShipping(p) : supShipDefault(sid);
          g.set(sid, Math.max(g.get(sid) ?? 0, def));
        }
        return [...g].map(([sid, def]) => {
          const st = (shipState[sid] ||= { cost: def, free: false });
          return { supplierId: sid, name: db.get("suppliers", sid)?.name || "Proveedor", cost: Number(st.cost) || 0, free: !!st.free };
        });
      };
      const drawShipBox = () => {
        const ships = supplierShipping(collectItems());
        $("#sup-ship", el).innerHTML = ships.length ? ships.map((x) => `<div class="row" style="align-items:flex-end;margin-top:4px">
            <label class="field" style="max-width:240px">${esc(x.name)}<input data-money="1" data-ship="${x.supplierId}" value="${x.cost || ""}" placeholder="0"></label>
            <label class="check" style="margin-bottom:10px"><input type="checkbox" data-ship-free="${x.supplierId}" ${x.free ? "checked" : ""}> Gratis</label></div>`).join("")
          : `<span class="small muted">Elegí productos del catálogo (o el proveedor principal) y acá aparece su envío.</span>`;
        $$("[data-ship]", el).forEach((inp) => inp.addEventListener("input", () => { shipState[inp.dataset.ship].cost = Number(inp.value) || 0; }));
        $$("[data-ship-free]", el).forEach((c) => c.addEventListener("input", () => { shipState[c.dataset.shipFree].free = c.checked; }));
      };
      // Cuadro de costos al final: costo c/u editable (viene del catálogo) y precio sugerido en verde
      const drawCostTable = () => {
        const its = collectItems();
        $("#cost-table", el).innerHTML = its.length ? `<div class="table-wrap"><table class="cost-tbl">
          <thead><tr><th>Producto</th><th class="right">Cant.</th><th class="right">Costo c/u</th><th class="right sug-cell">💚 Sugerido c/u</th><th class="right sug-cell">💚 Sugerido total</th></tr></thead>
          <tbody>${its.map((i) => `<tr>
            <td>${esc(i.product)}</td><td class="right">${i.qty}</td>
            <td class="right" style="width:150px"><input data-money="1" data-cost-key="${i.key}" value="${i.unitCost || ""}" placeholder="Costo"></td>
            <td class="right nowrap sug-cell" data-sug-unit="${i.key}">—</td>
            <td class="right nowrap sug-cell" data-sug-total="${i.key}">—</td></tr>`).join("")}</tbody></table></div>`
          : `<p class="small muted">Agregá productos arriba y acá te calculo la ganancia.</p>`;
        $$("[data-cost-key]", el).forEach((inp) => inp.addEventListener("input", () => {
          const r = rowOf(inp.dataset.costKey);
          if (r) $('[name="unitCost"]', r).value = inp.value;
        }));
        drawShipBox();
      };
      // Combos del pedido (por clave): su descuento se descuenta del sugerido y se reparte entre sus renglones
      const comboState = Object.fromEntries((o.combos || []).map((c) => [c.key, c]));
      const comboDiscounts = (its, sug) => Object.entries(comboState).map(([key, c]) => {
        const rows = its.filter((i) => i.combo === key);
        if (!rows.length) return null; // si quitaste todos sus productos, el combo no va más
        const share = rows.reduce((a, i) => a + (sug?.row(i)?.total || 0), 0);
        return { ...c, key, share, amount: Math.round(comboDiscount(c, share, c.n)) };
      }).filter(Boolean);
      // todo lo que entra en la cuenta del pedido
      const calc = (f, its) => {
        const pack = packaging(its);
        const ship = Number(f.clientShipping) || 0;
        const charged = f.shippingFree ? 0 : ship;
        const ships = supplierShipping(its);
        const other = 0; // ya no se cargan otros extras
        const sug = orderSuggestion(its, ships, pack, ship - charged);
        const combos = comboDiscounts(its, sug);
        // sugerido de cada renglón: el precio del combo (con su descuento) se reparte entre sus productos según lo que cuesta cada uno
        const weight = (i) => sug?.row(i)?.total || i.unitCost * i.qty || i.qty || 1;
        const rowSug = (i) => {
          const sg = sug?.row(i), c = i.combo && combos.find((x) => x.key === i.combo);
          const final = c ? c.share - c.amount : 0;
          if (!c || (!final && !c.share)) return sg;
          const t = (final * weight(i)) / its.filter((x) => x.combo === c.key).reduce((a, x) => a + weight(x), 0);
          return { total: t, unit: i.qty ? t / i.qty : 0 };
        };
        const sugTotal = (sug?.total || 0) - combos.reduce((a, c) => a + c.amount, 0);
        return { pack, ship, charged, ships, other, sug, sugTotal, combos, rowSug };
      };
      const refresh = (redrawCosts = false) => {
        if (redrawCosts) drawCostTable();
        const f = readForm(form);
        const its = collectItems();
        const { pack, ship, charged, ships, other, sugTotal, combos, rowSug } = calc(f, its);
        const total = Number(f.total) || sugTotal;
        const usingSug = !Number(f.total) && sugTotal > 0;
        its.forEach((i) => {
          const sg = rowSug(i);
          const u = $(`[data-sug-unit="${i.key}"]`, el), t = $(`[data-sug-total="${i.key}"]`, el);
          if (u) u.textContent = sg ? money(sg.unit) : "—";
          if (t) t.textContent = sg ? money(sg.total) : "—";
        });
        $(".pay-fields", el).classList.toggle("hidden", !!f.gift);
        $("#cost-table", el).classList.toggle("is-gift", !!f.gift);
        if (f.gift) {
          // regalo: no hay venta ni ganancia, solo lo que te cuesta (y eso se resta de tu ganancia del mes)
          const goods = its.reduce((a, i) => a + i.qty * i.unitCost, 0);
          const shipCost = ships.reduce((a, x) => a + (x.free ? 0 : x.cost), 0);
          const cost = goods + pack.total + shipCost + other;
          $("#pay-sum", el).innerHTML = `<div class="price-line total"><span>🎁 Regalo · no se cobra</span><span>${money(0)}</span></div>`;
          $("#analysis", el).innerHTML = its.length ? `<div class="gift-box"><b>🎁 Este regalo te cuesta ${money(cost)}</b>
            <div class="price-line"><span>Productos</span><b>${money(goods)}</b></div>
            ${pack.total ? `<div class="price-line"><span>Packaging</span><b>${money(pack.total)}</b></div>` : ""}
            ${shipCost ? `<div class="price-line"><span>Envío de proveedores</span><b>${money(shipCost)}</b></div>` : ""}
            <p class="small muted" style="margin:6px 0 0">No suma ventas ni ganancia: este monto se resta de tu ganancia del mes de entrega.</p></div>` : "";
          return;
        }
        const toCharge = total + charged;
        const dep = f.paidFull ? toCharge : Number(f.deposit) || 0;
        $("#pack-total", el).textContent = pack.total ? `${money(pack.total)} por pedido` : "Sin packaging";
        $("#pay-sum", el).innerHTML = `
          ${usingSug ? combos.filter((c) => c.discountType !== "cost").map((c) => `<div class="price-line"><span>🎁 ${c.discountType === "price" ? `Combo ${esc(c.name)} a ${money(c.discount * (c.n || 1))}` : `Descuento combo ${esc(c.name)}${c.n > 1 ? ` x${c.n}` : ""}`}</span><b>${c.amount >= 0 ? "−" : "+"}${money(Math.abs(c.amount))}</b></div>`).join("") : ""}
          <div class="price-line"><span>Venta${usingSug ? " (sugerido)" : ""}</span><b>${money(total)}</b></div>
          ${charged ? `<div class="price-line"><span>+ Envío</span><b>${money(charged)}</b></div>` : ""}
          <div class="price-line"><span>Total a cobrar</span><b>${money(toCharge)}</b></div>
          <div class="price-line"><span>Seña</span><b>${money(dep)}</b></div>
          <div class="price-line total"><span>Saldo</span><span>${money(Math.max(0, toCharge - dep))}</span></div>`;
        $("#analysis", el).innerHTML = its.length ? saleAnalysis({ its, sugTotal, total, usingSug, ships, other, payMethod: f.payMethod, pack, ship, charged }) : "";
        const t = f.eventDate || f.deadline;
        const dow = t ? new Date(t + "T12:00").getDay() : -1;
        $("#fri-hint", el).innerHTML = dow === 5 || dow === 6
          ? `⚠️ Es para un <b>${dow === 5 ? "viernes" : "sábado"}</b>: te aviso 3 semanas antes (${fmtDate(addDays(t, -21))}) y 2 semanas antes (${fmtDate(addDays(t, -14))}) para pedir al proveedor.` : "";
      };
      const bindRow = (r) => {
        $("[data-rm]", r).onclick = (e) => { e.preventDefault(); r.remove(); refresh(true); };
        const prod = $('[name="product"]', r);
        // precio por escala: al cambiar la cantidad cambia el costo c/u
        $('[name="qty"]', r).addEventListener("input", () => {
          const p = db.get("products", $('[name="productId"]', r).value);
          if (tiersOf(p).length) $('[name="unitCost"]', r).value = Math.round(unitCostFor(p, $('[name="qty"]', r).value) * 100) / 100;
        });
        // si no está en el catálogo: botón para crearlo como producto rápido
        const quick = $(".it-quick", r);
        const showQuick = () => {
          const name = prod.value.trim(), pid = $('[name="productId"]', r).value;
          const known = products.find((x) => x.name.toLowerCase() === name.toLowerCase());
          quick.innerHTML = name && !known && !pid ? `<button type="button" class="btn sm soft" data-qnew>✨ Crear «${esc(name)}» como producto nuevo</button>`
            : pid && db.get("products", pid) ? `${priceInfo(db.get("products", pid))}${!db.get("products", pid).price ? ` <button type="button" class="btn sm ghost" data-qedit>✏️ Completar datos del producto (precio, proveedor, teléfono)</button>` : ""}` : "";
          $("[data-qnew]", quick) && ($("[data-qnew]", quick).onclick = async () => {
            const p = await saveProduct({ name, category: $('[name="category"]', r).value || "", supplierId: $('[name="itemSupplier"]', r).value || "", size: "small", priceMode: "unit", price: 0, notes: "Producto rápido: completar datos" });
            products.push(p);
            $('[name="productId"]', r).value = p.id;
            toast("✨ Producto creado", "Después completale el precio y el proveedor en el catálogo.");
            showQuick();
          });
          $("[data-qedit]", quick) && ($("[data-qedit]", quick).onclick = () => openProductForm(db.get("products", pid), { onSave: (p) => {
            // al completar el producto se trae el precio y el proveedor al pedido
            const i = products.findIndex((x) => x.id === p.id); if (i >= 0) products[i] = p; else products.push(p);
            prod.value = p.name; prod.onchange();
          } }));
        };
        prod.addEventListener("input", () => { $('[name="productId"]', r).value = ""; showQuick(); });
        showQuick();
        prod.onchange = () => {
          const p = products.find((x) => x.name.toLowerCase() === prod.value.toLowerCase());
          showQuick();
          if (!p) return;
          $('[name="productId"]', r).value = p.id;
          if (p.category) $('[name="category"]', r).value = p.category;
          // si viene en pack (o tiene mínimo), la cantidad arranca en esas unidades
          const q = $('[name="qty"]', r), packQ = p.priceMode === "pack" ? Number(p.packQty) || 0 : 0;
          const want = packQ || Number(p.minQty) || 0;
          if (want > 1 && (Number(q.value) || 0) <= 1) q.value = want;
          $('[name="unitCost"]', r).value = Math.round(unitCostFor(p, q.value) * 100) / 100; // el packaging se suma aparte
          if (p.supplierId) $('[name="itemSupplier"]', r).value = p.supplierId;
          refresh(true);
        };
      };
      $$(".item-row", items).forEach(bindRow);
      $("#add-item", el).onclick = () => { items.insertAdjacentHTML("beforeend", itemRow()); bindRow(items.lastElementChild); };
      // Armar combo: con los productos tildados del pedido (mismo proveedor, un solo precio) o uno ya guardado
      const addCombo = (c, n) => {
        const key = `k${Date.now().toString(36)}`;
        comboState[key] = { key, comboId: c.id, name: c.name, discountType: c.discountType, discount: Number(c.discount) || 0, n };
        return key;
      };
      $("#add-combo", el).onclick = () => openComboBuilder(collectItems().filter((i) => !i.combo), {
        onBuild: (c, keys, sup) => {
          const key = addCombo(c, 1), ls = comboLines(c);
          for (const [n, k] of keys.entries()) {
            const r = rowOf(k);
            // si el producto se acaba de crear en el catálogo, el renglón queda vinculado a él
            if (!$('[name="productId"]', r).value && c.lines[n]?.productId) { products.push(db.get("products", c.lines[n].productId)); $('[name="product"]', r).onchange(); }
            $('[name="combo"]', r).value = key;
            if (ls[n]) $('[name="unitCost"]', r).value = Math.round(ls[n].unitCost * 100) / 100; // costo del combo repartido
            $('[name="itemSupplier"]', r).value = sup;
            $(".it-combo", r)?.remove();
            r.insertAdjacentHTML("beforeend", comboChip(c.name));
          }
          refresh(true);
        },
        onPick: (c, n) => {
          const key = addCombo(c, n);
          $$(".item-row", items).forEach((r) => { if (!$('[name="product"]', r).value.trim()) r.remove(); }); // saca el renglón vacío
          for (const l of comboLines(c, n)) {
            items.insertAdjacentHTML("beforeend", itemRow({ product: l.product, productId: l.productId, category: l.category, qty: l.qty, unitCost: Math.round(l.unitCost * 100) / 100, supplierId: l.supplierId, combo: key, comboName: c.name }));
            bindRow(items.lastElementChild);
          }
          refresh(true);
        },
      });
      // si cambia un producto o una cantidad se rehace el cuadro de costos; si no, solo los números
      form.addEventListener("input", (e) => refresh(!!e.target.closest("#items")));
      form.addEventListener("change", (e) => { if (e.target.closest("#items")) refresh(true); });
      // autocompletar cliente existente
      // Si el nombre coincide con una ficha, el pedido queda vinculado a ese cliente
      const clientHint = () => {
        const c = db.get("clients", form.clientId.value);
        $("#c-hint", el).innerHTML = c ? `<span style="color:var(--ok)">✔ Ficha de ${esc(c.name)} · ${c.orders?.length ?? clients.find((x) => x.id === c.id)?.orders.length ?? 0} pedidos</span>` : form.c_name.value ? `<span class="muted">Cliente nuevo: se crea su ficha al guardar</span>` : "";
        drawLoyal();
      };
      // Tarjeta Cliente VIP: si la clienta tiene un premio sin usar, se ofrece aplicarlo a este pedido
      let reward = o.reward || null;
      const drawLoyal = () => {
        const box = $("#loyal-box", el);
        const info = form.clientId.value ? loyaltyOf(form.clientId.value, { exceptOrder: o.id }) : null;
        if (reward) {
          box.innerHTML = `<div class="loyal-banner on">💖 Premio de la tarjeta aplicado: <b>${esc(reward.label)}</b>${reward.amount ? ` (−${money(reward.amount)})` : ""} <button type="button" class="btn sm ghost" id="lr-off">Quitar</button></div>`;
          $("#lr-off", box).onclick = () => { if (reward.pct && reward.before != null) { form.total.value = reward.before; refresh(); } reward = null; drawLoyal(); };
          return;
        }
        if (!info?.loyal) { box.innerHTML = ""; return; }
        box.innerHTML = info.available.length
          ? `<div class="loyal-banner">🎁 <b>Esta clienta tiene ${info.available.map((p) => esc(p.label)).join(" + ")} por su Tarjeta Cliente VIP.</b> ¿Lo aplicás a este pedido?
              <div class="row" style="margin-top:6px">${info.available.map((p) => `<button type="button" class="btn sm primary" data-reward="${p.key}">${p.pct ? `Aplicar ${esc(p.label)}` : `Darle ${esc(p.label)}`}</button>`).join("")}</div></div>`
          : `<div class="small muted" style="margin-top:6px">💖 Cliente Fidelizado · ${info.inCard}/${info.B} stickers · ${esc(loyaltyText(info))}</div>`;
        $$("[data-reward]", box).forEach((b) => (b.onclick = () => {
          const p = info.available.find((x) => x.key === b.dataset.reward); if (!p) return;
          reward = { key: p.key, label: p.label, pct: p.pct };
          if (p.pct) {
            // el descuento va sobre el total escrito o, si está vacío, sobre el sugerido
            const base = Number(form.total.value) || calc(readForm(form), collectItems()).sugTotal;
            if (!base) { reward = null; return toast("Primero cargá los productos", "Así calculo el descuento sobre el total."); }
            reward.before = form.total.value;
            reward.amount = Math.round((base * p.pct) / 100);
            form.total.value = Math.round(base - reward.amount);
            refresh();
          }
          drawLoyal();
        }));
      };
      form.c_name.addEventListener("change", () => {
        const c = clients.find((x) => x.name.toLowerCase().trim() === form.c_name.value.toLowerCase().trim());
        if (c) {
          form.clientId.value = c.id;
          form.c_phone.value = c.phone || form.c_phone.value; form.c_province.value = c.province || form.c_province.value; form.c_city.value = c.city || form.c_city.value; form.c_dni.value = c.dni || form.c_dni.value;
        } else if (!o.clientId) form.clientId.value = ""; // en un pedido existente, cambiar el nombre corrige la ficha
        clientHint();
      });
      clientHint();
      drawCostTable();
      refresh();
      $("#of-save", el).onclick = async () => {
        const f = readForm(form);
        if (!f.c_name) { form.c_name.focus(); return toast("Falta el nombre del cliente", "", { urgent: true }); }
        const its = collectItems();
        // el total de la venta se reparte entre los productos (para saber cuánto deja cada uno)
        const { pack, ships, other, sugTotal, combos, rowSug } = calc(f, its);
        const weights = its.map((i) => (rowSug(i) ? rowSug(i).total : i.unitCost * i.qty || i.qty || 1));
        const W = weights.reduce((a, b) => a + b, 0) || 1;
        const total = f.gift ? 0 : Number(f.total) || sugTotal || its.reduce((a, i) => a + i.qty * i.unitPrice, 0);
        const clientShipping = Number(f.clientShipping) || 0;
        its.forEach((i, k) => { i.unitPrice = i.qty ? Math.round((total * weights[k]) / W / i.qty) : 0; delete i.key; });
        const data = {
          ...o,
          client: { name: f.c_name, phone: f.c_phone, province: f.c_province, city: f.c_city, address: placeText({ province: f.c_province, city: f.c_city }), dni: fmtDni(f.c_dni) }, clientId: f.clientId,
          items: its,
          reward: reward ? { key: reward.key, label: reward.label, pct: reward.pct || 0, amount: reward.amount || 0 } : null,
          combos: combos.map(({ key, comboId, name, discountType, discount, n, amount }) => ({ key, comboId, name, discountType, discount, n, amount })),
          saleTotal: total,
          total: total + (f.shippingFree ? 0 : clientShipping), // lo que paga el cliente
          clientShipping, shippingFree: !!f.shippingFree,
          packaging: { keys: pack.keys, total: pack.total },
          deposit: f.gift ? 0 : Number(f.deposit) || 0,
          paidFull: f.gift ? true : f.paidFull, payMethod: f.gift ? "" : f.payMethod, gift: !!f.gift,
          supplierShip: ships, otherCost: other,
          extraCost: ships.reduce((a, x) => a + (x.free ? 0 : x.cost), 0) + other, // envío de proveedores + otros extras
          eventDate: f.eventDate, deadline: f.deadline, status: f.status,
          shipping: f.shipping, supplierId: its.find((i) => i.supplierId)?.supplierId || "", courier: f.courier, tracking: f.tracking, notes: f.notes,
        };
        // N° de seguimiento nuevo: anoto el día (llega en 4 a 5 días) y el pedido pasa a "Recibir del proveedor"
        if (data.tracking && data.tracking !== o.tracking) {
          data.trackingAt = today();
          if (BEFORE_SUPPLIER.includes(data.status)) data.status = "esperando";
        }
        if (!data.tracking) data.trackingAt = "";
        if (data.status === "esperando" && !data.supplierOrderedAt) data.supplierOrderedAt = today();
        data.number ||= nextNumber();
        const saved = await saveOrder(data);
        api.close();
        toast(isNew ? "✨ Pedido guardado" : "Pedido actualizado", `${saved.client.name} · ${money(saved.total)}`, { action: { label: "Ver pedido", run: () => openOrderDetail(saved.id) } });
      };
    },
  });
}

export async function saveOrder(data) {
  // pedidos nuevos (por ejemplo los que dicta Dex) llevan el packaging de siempre
  if (!data.id && data.packaging === undefined) {
    const on = settings().hidden.filter((h) => h.on);
    data.packaging = { keys: on.map((h) => h.key), total: on.reduce((a, h) => a + Number(h.cost || 0), 0) }; // uno por pedido
  }
  // sin provincia pero con teléfono de Catamarca (3834 / 3835): se completa sola
  if (data.client && !data.client.province && !data.client.city) {
    const pl = placeFromPhone(data.client.phone);
    if (pl) data.client = { ...data.client, ...pl, address: placeText(pl) };
  }
  // vincula (o crea) la ficha del cliente y guarda su copia en el pedido
  if (data.client?.name) {
    const cl = await ensureClient(data.client, data.clientId);
    data.clientId = cl.id;
    data.client = snapshot(cl);
  }
  data.number ||= nextNumber();
  data.status ||= "senado";
  // si se guarda como entregado, queda 100% pago (logPayment anota el saldo en la caja)
  if (data.status === "entregado" && !data.gift) { data.paidFull = true; data.deliveredAt ||= today(); }
  logPayment(data.id ? db.get("orders", data.id) : null, data);
  return db.put("orders", data);
}

// Caja diaria: cada vez que entra plata en un pedido (seña o saldo) queda anotado el día y el medio de pago
export function logPayment(prev, next) {
  const before = prev ? orderPaid(prev) : 0, now = next.gift ? 0 : orderPaid(next);
  if (now > before) next.payments = [...(next.payments || prev?.payments || []), { date: today(), amount: now - before, method: next.payMethod || "Sin especificar" }];
}

// Clientes con sus pedidos y totales (de las fichas)
export const uniqueClients = clientsWithStats;

export { num };
