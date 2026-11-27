// Inicio: resumen del día, alertas urgentes y próximas entregas.
import { db, settings } from "../db.js";
import {
  icon, esc, money, fmtDate, today, addDays, startOfWeek, monthKey, orderTotal, orderBalance, orderCost, orderPaid, itemsText,
  longWeekends, BEFORE_SUPPLIER, DOW, MONTHS, parseISO, statusPill, STATUSES, dayLabel, LEGACY_STATUS,
} from "../utils.js";
import { $, $$, modal, toast, confirmBox } from "../ui.js";
import { activeAlerts, itemSupplierId } from "../alerts.js";
import { orderCard, openOrderForm, openOrderDetail, sortOrders, setStatus, markDelivered, undoDelivered } from "./orders.js";
import { loyaltyOf, loyaltyConf } from "../loyalty.js";
import { openTaskForm } from "./agenda.js";
import { openClientCard } from "./clients.js";
import { openAssistant, voiceAvailable } from "../assistant.js";
import { workChip } from "../worktime.js";
import { norm } from "../suggest.js";
import { sortedTodos, todoListHTML, bindTodoList, problemNote, solveProblem } from "../todos.js";
import { monthStats, vbars, hbars, donut, card, empty, bindTooltip, mName, shiftMonth, DOW as DOW_SHORT } from "./stats.js";

export function alertList(alerts, el) {
  return alerts.length ? alerts.map((a) => `
    <div class="alert-item ${a.urgent ? "urgent" : ""}">
      <div class="ic">${a.icon}</div>
      <div class="grow"><div class="t">${esc(a.title)}</div><div class="b">${esc(a.body)}</div>
        ${a.late ? `<div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${LATE_ACTS.map(([k, label]) => `<button class="btn sm ${k === "entregue" ? "primary" : "ghost"}" data-late="${k}" data-id="${a.orderId}">${label}</button>`).join("")}</div>` : ""}</div>
      <div class="acts">
        ${a.orderId ? `<button class="btn sm soft" data-open="${a.orderId}">Ver</button>` : ""}
        <button class="btn sm ghost icon" data-dismiss="${a.id}" title="Descartar (queda en el historial)">${icon("x")}</button>
      </div>
    </div>`).join("") : `<div class="empty"><div class="big">🌸</div><p>¡Nada urgente por ahora!</p></div>`;
}
// "Ver" despliega abajo del aviso los botones del pedido (Ya lo compré, Ya le pregunté…), también los que ya tocaste,
// con "Deshacer" por si apretaste uno sin querer
function orderButtons(box, id) {
  const list = sortedTodos().filter((x) => x.orderId === id);
  box.innerHTML = `${list.length ? `<div class="bell-list">${todoListHTML(list)}</div>` : `<p class="small muted">Este pedido no tiene tareas con el proveedor para hoy.</p>`}
    <button class="btn sm ghost" data-full="${id}">Abrir el pedido completo</button>`;
  bindTodoList(box, list, () => orderButtons(box, id));
  $("[data-full]", box).onclick = () => openOrderDetail(id);
}
// Pedido atrasado: botones que cambian la etapa y lo anotan en la agenda de hoy
const LATE_ACTS = [["encargar", "🛒 Encargar"], ["encargue", "✔ Ya encargué"], ["camino", "🚚 En camino"], ["entrego", "📦 Hoy lo entrego"], ["entregue", "✔ Ya lo entregué"], ["falta", "🧩 Falta algo"]];
async function lateAction(o, k, extra = "") {
  const t = today(), who = o.client?.name || "la clienta", what = itemsText(o, " · ");
  const plus = what ? `: ${what}` : "";
  // si ya está anotada hoy, no se repite
  const task = (title, done = false) => db.all("tasks").some((x) => x.orderId === o.id && x.date === t && x.title === title)
    ? null : db.put("tasks", { title, date: t, type: "trabajo", orderId: o.id, done, doneAt: done ? t : "" });
  if (k === "encargar") { await setStatus(o, "pedir"); await task(`🛒 Encargar al proveedor el pedido de ${who}${plus}`); }
  if (k === "encargue") { await setStatus(o, "esperando"); await task(`✔ Encargué el pedido de ${who}${plus}`, true); }
  if (k === "camino") { await setStatus(o, "esperando"); await task(`🚚 Está en camino el pedido de ${who}${plus}`); }
  if (k === "entrego") { await setStatus(o, "entregar"); await db.put("orders", { ...db.get("orders", o.id), handoff: { type: "entrega", date: t } }); await task(`📦 Hoy entrego el pedido de ${who}${plus}`); }
  if (k === "entregue") { await setStatus(o, "entregado"); await task(`✔ Entregué el pedido de ${who}${plus}`, true); }
  if (k === "falta") { await db.put("orders", { ...db.get("orders", o.id), problem: { text: `Falta: ${extra}`, at: t } }); await task(`🧩 Falta para el pedido de ${who}: ${extra}`); }
  // ya lo resolviste: el aviso de atrasado sale (queda en el historial) y sigue en la agenda
  const n = db.get("notifications", `late-${o.id}-${t}`);
  if (n) await db.put("notifications", { ...n, dismissed: true });
}
// "Falta algo": se abre un renglón para escribir qué falta (ej: "hacer las estampitas")
function faltaPrompt(b, o) {
  const row = b.parentElement;
  if (row.nextElementSibling?.matches(".falta-row")) return row.nextElementSibling.querySelector("input").focus();
  row.insertAdjacentHTML("afterend", `<div class="row falta-row" style="gap:6px;margin-top:6px"><input class="grow" placeholder="¿Qué falta? Ej: hacer las estampitas"><button class="btn sm primary">Anotar</button></div>`);
  const box = row.nextElementSibling, inp = box.querySelector("input");
  const save = async () => { const v = inp.value.trim(); if (!v) return inp.focus(); box.querySelector("button").disabled = true; await lateAction(o, "falta", v); };
  inp.onkeydown = (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") box.remove(); };
  box.querySelector("button").onclick = save;
  inp.focus();
}
export function bindAlerts(el) {
  $$("[data-late]", el).forEach((b) => (b.onclick = async () => {
    const o = db.get("orders", b.dataset.id); if (!o) return;
    if (b.dataset.late === "falta") return faltaPrompt(b, o);
    $$(`[data-late][data-id="${o.id}"]`, el).forEach((x) => (x.disabled = true)); // que un doble toque no lo anote dos veces
    await lateAction(o, b.dataset.late);
  }));
  $$("[data-open]", el).forEach((b) => (b.onclick = () => {
    const item = b.closest(".alert-item");
    const open = item.nextElementSibling?.classList.contains("alert-btns");
    $$(".alert-btns", el).forEach((x) => x.remove());
    if (open) return;
    const box = document.createElement("div");
    box.className = "alert-btns";
    item.after(box);
    orderButtons(box, b.dataset.open);
  }));
  $$("[data-dismiss]", el).forEach((b) => (b.onclick = async () => {
    const n = db.get("notifications", b.dataset.dismiss);
    if (n) { n.dismissed = true; await db.put("notifications", n); }
  }));
}

// "hace 5 min", "hace 3 h", "ayer 21:40", "4/11 18:05"
function whenAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso), mins = Math.round((Date.now() - d) / 60000);
  const hm = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (mins < 1) return "recién";
  if (mins < 60) return `hace ${mins} min`;
  if (d.toDateString() === new Date().toDateString()) return `hoy ${hm}`;
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return `ayer ${hm}`;
  return `${d.getDate()}/${d.getMonth() + 1} ${hm}`;
}
const newest = (list) => list.filter((x) => x.createdAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

// Cartel: el último cliente y el último pedido que registraste
function lastAdded() {
  const c = newest(db.all("clients").filter((x) => x.name));
  const o = newest(db.all("orders").filter((x) => x.client?.name));
  if (!c && !o) return "";
  return `<div class="card last-added">
    ${c ? `<button class="la-item" data-last-client="${c.id}"><span class="la-ic">👤</span><span class="la-txt">
      <span class="la-k">Último cliente · ${whenAgo(c.createdAt)}</span>
      <b>${esc(c.name)}</b><span class="small muted">${esc([c.phone, c.address].filter(Boolean).join(" · ") || "Sin teléfono")}</span></span></button>` : ""}
    ${o ? `<button class="la-item" data-o="${o.id}"><span class="la-ic">🛍️</span><span class="la-txt">
      <span class="la-k">Último pedido · ${whenAgo(o.createdAt)}</span>
      <b>${esc(o.client.name)} · ${money(orderTotal(o))}</b><span class="small muted">${esc(itemsText(o, " · ") || "Sin productos")}</span><span>${statusPill(o.status)}</span></span></button>` : ""}
  </div>`;
}


// ---------- Agenda de Tradex ----------
const dash = { week: 0, delPage: 0 }; // delPage: página de "Últimos entregados" (0 = los más recientes)
const fullDate = (t) => { const d = parseISO(t); const w = DOW[d.getDay()]; return `${w[0].toUpperCase()}${w.slice(1)}, ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`; };

// Caja de hoy: lo que entró en señas y saldos, por medio de pago
function cashToday(t) {
  const by = new Map();
  for (const o of db.all("orders")) for (const p of o.payments || []) if (p.date === t) by.set(p.method, (by.get(p.method) || 0) + Number(p.amount || 0));
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  return `<div class="cash-box" title="Señas y saldos que cobraste hoy">
    <span class="small">💰 Caja de hoy</span><b>${money(total)}</b>
    <span class="small">${by.size ? [...by].map(([m, v]) => `${esc(m)} ${money(v)}`).join(" · ") : "Todavía no entró plata hoy"}</span></div>`;
}

// Entregas del finde: viernes, sábado y domingo (este finde, o el que viene si hoy es lunes a jueves)
function weekendList(active, t) {
  const dow = parseISO(t).getDay();
  const fri = addDays(t, dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow);
  const sun = addDays(fri, 2);
  const list = active.filter((o) => o.deadline >= fri && o.deadline <= sun).sort((a, b) => a.deadline.localeCompare(b.deadline));
  return `<div class="card"><div class="card-head"><h3>🛍️ Para entregar este finde</h3><span class="small muted">${fmtDate(fri)} al ${fmtDate(sun)} · ${list.length}</span></div>
    ${list.length ? `<div class="stack" style="gap:6px">${list.map((o) => `<div class="row" style="cursor:pointer" data-o="${o.id}">
      <span class="chip">${DOW[parseISO(o.deadline).getDay()]}</span><b>${esc(o.client?.name || "Clienta")}</b>
      <span class="grow">${esc(itemsText(o, " · ") || "Sin productos")}${o.eventDate ? ` <span class="muted">(${fmtDate(o.eventDate)})</span>` : ""}</span></div>`).join("")}</div>`
      : `<p class="muted small">No hay entregas para el finde. 🌸</p>`}</div>`;
}

// "@" en los renglones de la agenda: etiquetar a una clienta y vincular su pedido
function mentionPicker(inp) {
  const box = document.createElement("div");
  box.className = "mention-box"; box.hidden = true;
  inp.after(box); inp.parentElement.style.position ||= "relative";
  let opts = [], sel = 0;
  const query = () => /@([^@]*)$/.exec(inp.value.slice(0, inp.selectionStart))?.[1];
  const draw = () => {
    box.innerHTML = opts.map((o, i) => `<button type="button" class="${i === sel ? "on" : ""}" data-i="${i}"><b>${esc(o.client?.name || "Clienta")}</b>
      <span class="small muted">${esc(itemsText(o, " · ") || "Sin productos")}${o.deadline ? ` · entrega ${fmtDate(o.deadline)}` : ""}</span></button>`).join("");
    box.hidden = !opts.length;
    $$("[data-i]", box).forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); pick(opts[b.dataset.i]); }));
  };
  const pick = (o) => {
    const pos = inp.selectionStart, before = inp.value.slice(0, pos).replace(/@([^@]*)$/, `@${o.client?.name || "Clienta"} `);
    inp.value = before + inp.value.slice(pos);
    inp.dataset.order = o.id;
    inp.setSelectionRange(before.length, before.length);
    opts = []; draw();
  };
  inp.addEventListener("input", () => {
    const q = query();
    if (q == null || q.length > 30) { opts = []; return draw(); }
    const n = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    opts = db.all("orders").filter((o) => !o.archived && o.status !== "entregado" && n(o.client?.name).includes(n(q)))
      .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999")).slice(0, 6);
    sel = 0; draw();
  });
  inp.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : opts.length - 1)) % opts.length; draw(); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopImmediatePropagation(); pick(opts[sel]); }
    else if (e.key === "Escape") { opts = []; draw(); }
  });
  inp.addEventListener("blur", () => setTimeout(() => { opts = []; draw(); }, 150));
}

// Los últimos 8 productos que entregaste (del pedido entregado más reciente para atrás), agrupados por pedido,
// con "Deshacer" (vuelve a Para entregar) y "Cliente VIP" (un sticker para la Tarjeta Cliente VIP). Con ‹ › se ven los 8 anteriores.
function lastDelivered(orders) {
  const done = orders.filter((o) => o.status === "entregado")
    .sort((a, b) => (b.deliveredAt || b.deadline || "").localeCompare(a.deliveredAt || a.deadline || "") || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const rows = done.flatMap((o) => (o.items || []).filter((i) => i.product).map((i) => ({ o, i })));
  const pages = Math.max(1, Math.ceil(rows.length / 8));
  dash.delPage = Math.min(Math.max(0, dash.delPage), pages - 1);
  // los productos de la página, juntos por pedido
  const groups = [];
  for (const { o, i } of rows.slice(dash.delPage * 8, dash.delPage * 8 + 8)) {
    const g = groups.at(-1);
    if (g?.o.id === o.id) g.its.push(i); else groups.push({ o, its: [i] });
  }
  const pager = pages > 1 ? `<div class="row" style="justify-content:space-between;margin-top:10px">
      <button class="btn sm soft" data-del-page="1" ${dash.delPage >= pages - 1 ? "disabled" : ""} title="Ver los 8 anteriores">‹ Anteriores</button>
      <span class="small muted">página ${dash.delPage + 1} de ${pages}</span>
      <button class="btn sm soft" data-del-page="-1" ${dash.delPage ? "" : "disabled"} title="Volver a los más recientes">Recientes ›</button></div>` : "";
  return `<div class="card"><h3>✅ Últimos entregados</h3>
    ${groups.length ? `<div class="stack">${groups.map(({ o, its }) => { const lv = o.clientId ? loyaltyOf(o.clientId) : null; return `<div class="stack" style="gap:6px">
      <div class="row" style="justify-content:space-between;cursor:pointer" data-o="${o.id}"><div>${its.map((i) => `<b>${esc(itemsText({ items: [i] }))}</b>`).join("<br>")}<div class="small muted">${esc(o.client?.name || "Cliente")}</div></div><span class="chip">${fmtDate(o.deliveredAt || o.deadline)}</span></div>
      <div class="row">
        <button class="btn sm ghost" data-undo-del="${o.id}">↩️ Deshacer</button>
        ${o.sticker ? `<button class="btn sm soft" data-sticker="${o.id}" title="Tocá para sacarlo si fue un error">💖 Cliente VIP${lv ? ` · ${lv.inCard}/${lv.B}` : ""}</button>`
          : `<button class="btn sm primary" data-sticker="${o.id}">💖 Cliente VIP</button>`}
      </div></div>`; }).join("")}</div>`
      : `<p class="muted">Todavía no entregaste pedidos.</p>`}
    ${pager}
  </div>`;
}

// Planner semanal: una columna por día con entregas, eventos y tus notas/tareas
function weekPlanner(t) {
  const w0 = addDays(startOfWeek(t), dash.week * 7);
  const days = [...Array(6)].map((_, i) => addDays(w0, i)); // de lunes a sábado
  const orders = db.all("orders").filter((o) => !o.archived);
  const tasks = db.all("tasks").filter((k) => !k.postit);
  return `<div class="card planner-card"><div class="card-head"><h3>🗓️ Semana del ${fmtDate(w0)} al ${fmtDate(days[5])}</h3>
      <span class="row"><button class="btn sm ghost" data-week="-1">‹</button><button class="btn sm ${dash.week ? "" : "soft"}" data-week="0">Esta semana</button><button class="btn sm ghost" data-week="1">›</button></span></div>
    <div class="planner">${days.map((dt, i) => {
      const dl = orders.filter((o) => o.deadline === dt && o.status !== "entregado");
      const ev = orders.filter((o) => o.eventDate === dt && o.status !== "entregado"); // si ya lo entregaste, no se muestra la fiesta
      const tk = tasks.filter((k) => k.date === dt).sort((a, b) => !!b.done - !!a.done); // las tildadas van arriba
      return `<div class="pday ${dt === t ? "today" : ""} ${dt < t ? "past" : ""}">
        <div class="pday-head"><b>${DOW_SHORT[i]}</b><span>${parseISO(dt).getDate()}</span></div>
        ${dl.map((o) => `<button class="pdel ${dt === t ? "hl-today" : dt === addDays(t, 1) ? "hl-tomorrow" : dt < t ? "hl-late" : ""}" data-o="${o.id}">
          <b>${esc(o.client?.name || "Cliente")}</b>
          <span class="pd-prod">${esc(itemsText(o, " · ") || "Sin productos")}</span>
          ${o.gift ? `<span class="pd-money">🎁 Regalo</span>` : `<span class="pd-money"><span><i>Total</i>${money(orderTotal(o))}</span><span><i>Seña</i>${money(orderPaid(o))}</span><span class="${orderBalance(o) ? "due" : "ok"}">${orderBalance(o) ? `<i>Saldo</i>${money(orderBalance(o))}` : "✔ Saldado"}</span></span>`}
        </button>`).join("")}
        ${ev.map((o) => `<button class="pchip ev" data-o="${o.id}">🎉 ${esc(o.client?.name || "Evento")}</button>`).join("")}
        ${tk.map((k) => `<label class="ptask ${k.done ? "done" : ""}"><input type="checkbox" data-tk="${k.id}" ${k.done ? "checked" : ""}><span>${k.urgent ? "🔥 " : ""}<span contenteditable="true" data-edit-task="${k.id}" title="Tocá para editar">${esc(k.title)}</span></span></label>`).join("")}
        <input class="padd" data-add-day="${dt}" placeholder="+ Agregar…" title="Agregar nota o tarea (Enter para guardar)">
      </div>`;
    }).join("")}</div></div>`;
}

// Agenda del día: hoja de papel con lo de hoy (proveedores, tareas y avisos)
function dayAgenda(t, alerts) {
  const list = sortedTodos().filter((x) => !x.done); // lo que ya hiciste sale de la lista
  const left = list.length;
  return `<div class="card paper-card day-agenda"><div class="card-head"><div><h3>📅 Agenda del día</h3><div class="pc-date">${fullDate(t)}</div></div>
      <span class="small muted">${left ? `${left} pendiente${left === 1 ? "" : "s"}` : "¡Todo hecho! 🎉"}</span></div>
    <div class="bell-list today-list">${list.length ? todoListHTML(list) : `<p class="muted small" style="padding:8px 0">Nada pendiente con proveedores hoy. ☕</p>`}</div>
    <input class="padd" data-add-day="${t}" placeholder="+ Anotar algo para hoy (Enter para guardar)">
  </div>`;
}

// Números del mes con mini gráficos
function statCards({ active, toOrder, t, monthOrders }) {
  const n = (st) => active.filter((o) => st.includes(o.status)).length;
  const groups = [["Sin pedir", toOrder.length, "var(--s2)"], ["Esperando proveedor", n(["esperando"]), "var(--s1)"], ["Para entregar", n(["entregar"]), "var(--s3)"]];
  const seg = groups.filter(([, v]) => v).map(([l, v, c]) => `<span style="flex:${v};background:${c}" data-tip="${l}: ${v}"></span>`).join("");
  // los próximos 7 días, desde hoy
  const sales = monthOrders.reduce((a, o) => a + orderTotal(o), 0);
  const paid = monthOrders.reduce((a, o) => a + orderPaid(o), 0);
  const toCollect = monthOrders.reduce((a, o) => a + orderBalance(o), 0);
  const withCost = monthOrders.filter((o) => orderCost(o));
  const cost = withCost.reduce((a, o) => a + orderCost(o), 0);
  const profit = withCost.reduce((a, o) => a + orderTotal(o) - orderCost(o), 0);
  const pct = sales ? Math.round((paid / sales) * 100) : 0;
  const R = 26, C = 2 * Math.PI * R;
  const bmax = Math.max(1, sales, cost, profit);
  const bar = (label, v, c) => `<div class="mb-row" data-tip="${label}: ${money(v)}"><span>${label}</span><span class="mb-track"><span style="width:${Math.max(2, (Math.max(0, v) / bmax) * 100)}%;background:${c}"></span></span></div>`;
  return `<div class="grid g3 stats-root stat-viz">
    <div class="card stat"><span class="label">🛍️ Pedidos activos</span><span class="value">${active.length}</span>
      <div class="seg-bar">${seg || `<span style="flex:1;background:var(--surface-2)"></span>`}</div>
      <div class="mini-legend">${groups.map(([l, v, c], i) => `<button type="button" class="legend-btn" data-group="${i}" title="Ver cuáles son y cambiarles el estado"><i style="background:${c}"></i>${l} <b>${v}</b></button>`).join("")}</div></div>
    <div class="card stat"><span class="label">💵 A cobrar este mes</span>
      <div class="ring-row"><svg viewBox="0 0 64 64" class="mini-ring"><circle cx="32" cy="32" r="${R}" class="ring-bg"/><circle cx="32" cy="32" r="${R}" class="ring-fg" stroke-dasharray="${(pct / 100) * C} ${C}" transform="rotate(-90 32 32)"/><text x="32" y="36" text-anchor="middle">${pct}%</text></svg>
        <div><span class="value">${money(toCollect)}</span><span class="hint">cobraste ${money(paid)} de ${money(sales)}</span></div></div></div>
    <div class="card stat"><span class="label">📈 Ganancia estimada del mes</span><span class="value" style="color:${profit >= 0 ? "var(--ok)" : "var(--u-red)"}">${money(profit)}</span>
      <div class="mini-bars">${bar("Ventas", sales, "var(--s1)")}${bar("Costos", cost, "var(--s2)")}${bar("Ganancia", profit, "var(--s3)")}</div></div>
  </div>`;
}

// Al tocar "Sin pedir / Esperando proveedor / Para entregar": la lista de pedidos para cambiarles el estado
const GROUPS = [["📝 Sin pedir", (o) => BEFORE_SUPPLIER.includes(o.status)], ["⏳ Esperando proveedor", (o) => o.status === "esperando"], ["🚚 Para entregar", (o) => o.status === "entregar"]];
function groupList(i) {
  const [title, fits] = GROUPS[i];
  const draw = (el) => {
    const list = sortOrders(db.all("orders").filter((o) => !o.archived && o.status !== "entregado" && fits(o)));
    $(".modal-body", el.closest(".modal")).innerHTML = list.length ? `<div class="stack" style="gap:10px">${list.map((o) => `<div class="group-order">
        <div class="row" style="justify-content:space-between;cursor:pointer" data-go="${o.id}"><div><b>${esc(o.client?.name || "Clienta")}</b><div class="small muted">${esc(itemsText(o, " · ") || "Sin productos")}</div></div><span class="chip">${o.deadline ? fmtDate(o.deadline) : "sin fecha"}</span></div>
        <div class="row" style="gap:4px;flex-wrap:wrap;margin-top:6px">${STATUSES.map((st) => `<button type="button" class="btn sm ${st.key === o.status ? "primary" : "ghost"}" data-st="${st.key}" data-id="${o.id}">${esc(st.label)}</button>`).join("")}</div>
      </div>`).join("")}</div>` : `<p class="muted">No queda ninguno acá ✔</p>`;
    const body = $(".modal-body", el.closest(".modal"));
    $$("[data-st]", body).forEach((b) => (b.onclick = async () => { const o = db.get("orders", b.dataset.id); if (o && o.status !== b.dataset.st) { await setStatus(o, b.dataset.st); draw(body); } }));
    $$("[data-go]", body).forEach((r) => (r.onclick = () => openOrderDetail(r.dataset.go)));
  };
  modal({ title, wide: true, body: "", onMount: (el) => draw($(".modal-body", el) || el) });
}

// con fecha puesta se ve el día (tocalo para cambiarlo); sin fecha, el selector
const recvDate = (label, key, o, it, i) => it[key]
  ? `<span class="small">${label} <button type="button" class="recv-date" data-recv-edit="${key}" data-id="${o.id}" data-i="${i}" title="Tocá para cambiar la fecha">${dayLabel(it[key])}</button></span>`
  : `<label class="small">${label} <input type="date" data-recv="${key}" data-id="${o.id}" data-i="${i}"></label>`;

// Recibir del proveedor: cada producto encargado, con la fecha en que lo envía y la que llegaría
function toReceive() {
  const list = sortOrders(db.all("orders").filter((o) => !o.archived && o.status === "esperando"));
  const rows = list.flatMap((o) => (o.items || []).map((it, i) => ({ o, it, i })));
  return `<div class="card"><h3>📥 Recibir del proveedor</h3>
    ${rows.length ? `<div class="stack" style="gap:10px">${rows.map(({ o, it, i }) => `<div class="recv-item">
      <div class="row" style="justify-content:space-between;cursor:pointer" data-o="${o.id}"><div><b>${esc(it.product || "Producto")}</b> <span class="chip">x${esc(String(it.qty ?? ""))}</span>
        <div class="small muted">🏭 ${esc(db.get("suppliers", itemSupplierId(it, o))?.name || "Sin proveedor")} · para ${esc(o.client?.name || "Clienta")}</div></div></div>
      <div class="row" style="gap:8px;margin-top:6px;flex-wrap:wrap">
        ${recvDate("Me lo envía el", "shipBy", o, it, i)}
        ${recvDate("Me llegaría el", "arriveBy", o, it, i)}
      </div></div>`).join("")}</div>` : `<p class="muted">No estás esperando nada del proveedor ✔</p>`}
  </div>`;
}

// Al tocar una provincia del gráfico: sus clientes (o los que no tienen provincia, para completarla)
function clientsOfProvince(prov) {
  const none = prov === "Sin provincia";
  const list = db.all("clients").filter((c) => c.name && (none ? !c.province : c.province === prov)).sort((a, b) => a.name.localeCompare(b.name));
  modal({
    title: none ? `📍 Clientes sin provincia (${list.length})` : `📍 Clientes de ${esc(prov)} (${list.length})`,
    body: `${none ? `<p class="small muted">Tocá un cliente para abrir su ficha y completarle la provincia y la localidad.</p>` : ""}
      <div class="stack" style="gap:6px">${list.map((c) => `<button class="prov-client" data-cl="${c.id}"><b>${esc(c.name)}</b><span class="small muted">${esc([c.phone, c.city].filter(Boolean).join(" · ") || "Sin datos")}</span></button>`).join("") || `<p class="muted">No hay clientes.</p>`}</div>`,
    onMount: (el, m) => $$("[data-cl]", el).forEach((b) => (b.onclick = () => { m.close(); openClientCard(b.dataset.cl); })),
  });
}

// Métricas y rendimiento (las mismas cuentas que Estadísticas)
function metrics(t) {
  const mk = monthKey(t);
  const months = [-2, -1, 0].map((n) => shiftMonth(mk, n));
  const all = months.map(monthStats);
  const cur = all[2];
  const top = [...cur.earned].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const dowMon = [...cur.dows];
  let open = true;
  try { open = localStorage.getItem("v-dash-metrics") !== "0"; } catch {}
  return `<details class="dash-metrics stats-root" id="dash-metrics" ${open ? "open" : ""}><summary><h3>📊 Métricas y rendimiento</h3><span class="small muted">${mName(mk)}</span></summary>
    <div class="viz-grid-cards">
      ${card("💰 Ventas y ganancia", "últimos 3 meses", all.some((m) => m.sales) ? vbars({ groups: all.map((m) => ({ label: mName(m.mk), values: [m.sales, m.profit] })), series: ["Ventas", "Ganancia"] }) : empty("Todavía no hay ventas."))}
      ${card("🛍️ Pedidos por día de la semana", `${mName(mk)} · día de entrega`, dowMon.some(Boolean) ? vbars({ groups: DOW_SHORT.map((x, i) => ({ label: x, values: [dowMon[i]] })), series: ["Pedidos"], fmt: (v) => `${v} pedidos`, labelFmt: String, height: 190 }) : empty("No hay pedidos este mes."))}
      ${card("📍 Pedidos por provincia", mName(mk), cur.provs.size ? donut(cur.provs, (v) => `${v} pedido${v === 1 ? "" : "s"}`, { center: String, centerLabel: "pedidos", clickable: true }) : empty("Cargá la provincia de tus clientes para ver esto."))}
      ${card("📣 Top 5: más ganancia", `${mName(mk)} · hacele publicidad`, top.length ? hbars(top, money) : empty("No hay pedidos con costo cargado este mes."))}
    </div></details>`;
}

// "Hoy lo retiran / Hoy lo envío" -> tarea en la agenda del día
const handoffTask = (o, type, t) => {
  const what = itemsText(o, " · ");
  if (db.all("tasks").some((k) => k.orderId === o.id && k.date === t && /^(🏠|📦)/.test(k.title || ""))) return;
  return db.put("tasks", { title: `${type === "retira" ? "🏠 Hoy viene a retirar" : "📦 Hoy tengo que enviar el pedido de"} ${o.client?.name || "la clienta"}${what ? `: ${what}` : ""}`, date: t, type: "trabajo", orderId: o.id, done: false, handoff: true });
};
// clave para encontrar tareas repetidas aunque estén escritas un poco distinto
const taskKey = (k) => {
  const n = norm(k.title || "").replace(/@\S+/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (k.orderId && /^(hoy viene a retirar|hoy tengo que enviar|hoy entrego|hoy lo entrego)/.test(n)) return `${k.orderId}|entrega`;
  return n;
};
// pedidos marcados para hoy que no tienen su tarea (p. ej. marcados antes de que existiera esto)
async function syncHandoffs(t) {
  let added = 0;
  // estados viejos (Señado, Saldado, Diseñar, Pagar) pasan a "Pedir"
  for (const o of db.all("orders").filter((x) => LEGACY_STATUS.includes(x.status))) { await db.put("orders", { ...o, status: "pedir" }); added++; }
  // tareas repetidas (mismo texto, mismo día y mismo pedido): queda una sola
  // (también "Hoy viene a retirar" y "Hoy entrego" del mismo pedido, o la misma nota con y sin @clienta)
  const seen = new Set();
  const tasksSorted = db.all("tasks").filter((x) => !x.postit).sort((a, b) => !!b.done - !!a.done);
  for (const k of tasksSorted) {
    const key = `${k.date}|${taskKey(k)}`;
    if (seen.has(key)) { await db.remove("tasks", k.id); added++; } else seen.add(key); // queda la tildada, si hay
  }
  // las tareas que no tildaste pasan solas a hoy (y el pedido marcado para ese día, también)
  for (const k of db.all("tasks").filter((x) => !x.done && !x.postit && x.date && x.date < t)) {
    await db.put("tasks", { ...k, date: t, movedFrom: k.movedFrom || k.date });
    const o = k.orderId && db.get("orders", k.orderId);
    if (o?.handoff && o.handoff.date < t && /^(🏠|📦)/.test(k.title || "")) await db.put("orders", { ...o, handoff: { ...o.handoff, date: t } });
    added++;
  }
  for (const o of db.all("orders").filter((x) => x.handoff?.date === t && !x.archived && x.status !== "entregado")) {
    const has = db.all("tasks").some((k) => k.orderId === o.id && k.date === t && /^(🏠|📦)/.test(k.title || ""));
    if (!has && o.handoff.type !== "entrega") { await handoffTask(o, o.handoff.type, t); added++; }
  }
  return added;
}

export function render(el) {
  syncHandoffs(today()).then((n) => n && render(el));
  const t = today();
  const d = parseISO(t);
  const orders = db.all("orders").filter((o) => !o.archived);
  const active = orders.filter((o) => o.status !== "entregado");
  const w0 = startOfWeek(t);
  const thisWeek = active.filter((o) => o.deadline && o.deadline < addDays(w0, 7));
  const month = monthKey(t);
  const monthOrders = orders.filter((o) => monthKey(o.deadline || o.eventDate) === month);
  const toCollect = monthOrders.reduce((a, o) => a + orderBalance(o), 0);
  const profit = monthOrders.reduce((a, o) => a + (orderTotal(o) - orderCost(o)), 0);
  const toOrder = active.filter((o) => BEFORE_SUPPLIER.includes(o.status));
  // los que marcaste "hoy lo retiran / lo envío" salen de acá y pasan a la agenda del día
  const toDeliver = active.filter((o) => o.status === "entregar" && o.handoff?.date !== t);
  const alerts = activeAlerts();
  const hour = new Date().getHours();
  const hi = hour < 13 ? "¡Buen día" : hour < 20 ? "¡Buenas tardes" : "¡Buenas noches";
  const lw = longWeekends(t, 60).slice(0, 3);

  el.innerHTML = `
  <div class="stack" style="gap:18px">
    <div class="agenda-head">
      <div class="ah-top">
        <div><h1 class="ah-title">Agenda de Tradex</h1>
          <div class="ah-date">${fullDate(t)}</div>
          <div class="small ah-sub">${hi}! ✨ <span class="work-slot">${workChip()}</span> · <b>${alerts.length}</b> avisos y <b>${thisWeek.length}</b> entregas esta semana</div></div>
        ${cashToday(t)}
      </div>
      <div class="row ah-actions">
        <span class="grow"></span>
        <button class="btn primary" id="q-new">${icon("plus")} Nuevo pedido</button>
        <button class="btn" id="q-voice">${voiceAvailable() ? `${icon("mic")} Dictarle a Dex` : `${icon("chat")} Escribirle a Dex`}</button>
        <button class="btn" id="q-task">${icon("bell")} Anotar urgente</button>
        <button class="btn" data-eod>🌙 Fin del día</button>
      </div>
    </div>

    ${lastAdded()}
    ${weekendList(active, t)}
    ${weekPlanner(t)}
    ${dayAgenda(t, alerts)}

    ${statCards({ active, toOrder, t, monthOrders })}

    <div class="grid g2">
      <div class="card"><h3>📝 Pendientes de pedir al proveedor</h3>
        ${toOrder.length ? `<div class="stack">${sortOrders(toOrder).slice(0, 6).map((o) => `<div class="row" style="justify-content:space-between;cursor:pointer" data-o="${o.id}"><div><b>${esc(o.client?.name)}</b><div class="small muted">${esc(itemsText(o))}</div></div><span class="chip">${fmtDate(o.eventDate || o.deadline)}</span></div>`).join("")}</div>` : `<p class="muted">Todo pedido ✔</p>`}
      </div>
      ${toReceive()}
      <div class="card"><h3>🚚 Pendientes de entregar</h3>
        ${toDeliver.length ? `<div class="stack">${sortOrders(toDeliver).map((o) => `<div class="stack" style="gap:6px">
          <div class="row" style="justify-content:space-between;cursor:pointer" data-o="${o.id}"><div><b>${esc(o.client?.name)}</b><div class="small muted">${esc(itemsText(o))}</div></div><span class="chip">${fmtDate(o.deadline || o.eventDate)}</span></div>
          <div class="row"><button class="btn sm ghost" data-handoff="retira" data-id="${o.id}">🏠 Hoy lo retiran</button><button class="btn sm ghost" data-handoff="envio" data-id="${o.id}">📦 Hoy lo envío</button><button class="btn sm ghost" data-falta="${o.id}">🧩 Falta algo</button><button class="btn sm primary" data-delivered="${o.id}">✔ Entregado</button></div>
          ${o.problem?.text ? `<div class="small" style="color:var(--u-red)">⚠️ ${esc(o.problem.text)}</div>` : ""}
        </div>`).join("")}</div>` : `<p class="muted">Nada para entregar ✔</p>`}
      </div>
      ${lastDelivered(orders)}
      <div class="card"><h3>⚠️ Feriados y fines de semana largos</h3>
        ${lw.length ? lw.map((w) => `<div class="alert-item" style="margin-bottom:8px"><div class="ic">⚠️</div><div><div class="t">${fmtDate(w.from)} → ${fmtDate(w.to)} (${w.days} días)</div><div class="b">${esc(w.names.join(", "))} · correo y proveedores sin actividad</div></div></div>`).join("") : `<p class="muted">No hay fines de semana largos en los próximos 2 meses.</p>`}
      </div>
    </div>
    ${metrics(t)}
  </div>`;

  $("#q-new", el).onclick = () => openOrderForm();
  $("#q-voice", el).onclick = () => openAssistant(true);
  $("#q-task", el).onclick = () => openTaskForm({ urgent: true, date: t });
  $$("[data-order]", el).forEach((c) => (c.onclick = () => openOrderDetail(c.dataset.order)));
  $$("[data-last-client]", el).forEach((b) => (b.onclick = () => openClientCard(b.dataset.lastClient)));
  $$("[data-o]", el).forEach((c) => (c.onclick = () => openOrderDetail(c.dataset.o)));
  bindAlerts(el);
  $$("[data-handoff]", el).forEach((b) => (b.onclick = async () => {
    const o = db.get("orders", b.dataset.id); if (!o) return;
    $$(`[data-handoff][data-id="${o.id}"]`, el).forEach((x) => (x.disabled = true));
    await handoffTask(o, b.dataset.handoff, t);
    await db.put("orders", { ...o, handoff: { type: b.dataset.handoff, date: t } });
    render(el);
  }));
  $$("[data-falta]", el).forEach((b) => (b.onclick = () => { const o = db.get("orders", b.dataset.falta); if (o) faltaPrompt(b, o); }));
  $$("[data-del-page]", el).forEach((b) => (b.onclick = () => { dash.delPage += Number(b.dataset.delPage); render(el); }));
  $$("[data-undo-del]", el).forEach((b) => (b.onclick = async () => {
    const o = db.get("orders", b.dataset.undoDel); if (!o) return;
    await db.put("orders", undoDelivered({ ...o }));
    toast("↩️ Entrega deshecha", `${o.client?.name || "Cliente"} volvió a Para entregar`);
    render(el);
  }));
  // Cliente VIP (tarjetita de clientes fieles): un sticker por compra (si lo marcaste por error, se toca de nuevo y se saca)
  $$("[data-sticker]", el).forEach((b) => (b.onclick = async () => {
    const o = db.get("orders", b.dataset.sticker); if (!o) return;
    const min = Number(loyaltyConf().minPurchase) || 0;
    if (!o.sticker && !o.gift && min && orderTotal(o) < min && !(await confirmBox(`Esta compra es de ${money(orderTotal(o))} y la tarjeta suma desde ${money(min)}. ¿Le diste el sticker igual?`, "Sí, sumarlo"))) return;
    const before = o.clientId ? loyaltyOf(o.clientId).earned.length : 0;
    await db.put("orders", { ...o, sticker: o.sticker ? "" : today() });
    const lv = o.clientId ? loyaltyOf(o.clientId) : null;
    toast(o.sticker ? "Sticker sacado" : "💖 Cliente VIP · sticker sumado", `${o.client?.name || "Cliente"}${lv ? ` · ${lv.inCard}/${lv.B} en su tarjetita` : ""}`);
    // si con este sticker llegó a un premio, se avisa (lo usa en la próxima compra)
    if (!o.sticker && lv && lv.earned.length > before) toast(`🎉 ¡${o.client?.name || "La clienta"} ganó ${lv.earned.at(-1).label}!`, "Lo puede usar en su próxima compra. Te lo ofrezco cuando le cargues el pedido.", { ms: 9000 });
    render(el);
  }));
  $$("[data-delivered]", el).forEach((b) => (b.onclick = async () => { const o = db.get("orders", b.dataset.delivered); if (o) { await setStatus(o, "entregado"); render(el); } }));
  // agenda: vistas, semana, tareas, notas y post-its
  const redraw = () => render(el);
  $$("[data-week]", el).forEach((b) => (b.onclick = () => { dash.week = Number(b.dataset.week) ? dash.week + Number(b.dataset.week) : 0; redraw(); }));
  $$("[data-tk]", el).forEach((c) => (c.onchange = async () => { c.closest(".ptask")?.classList.toggle("done", c.checked); // se tacha o vuelve a la normalidad al instante
    const k = db.get("tasks", c.dataset.tk); if (!k) return; await db.put("tasks", { ...k, done: c.checked, doneAt: c.checked ? today() : "" });
    // tildar "Hoy viene a retirar" / "Hoy tengo que enviar" = ya lo entregaste
    const o = c.checked && k.orderId && /^(🏠|📦)/.test(k.title || "") && db.get("orders", k.orderId);
    if (o && o.status !== "entregado") { await db.put("orders", markDelivered({ ...o })); toast("🎉 Pedido entregado", o.client?.name || ""); } }));
  $$("[data-add-day]", el).forEach((inp) => { mentionPicker(inp); inp.onkeydown = async (e) => {
    if (e.key !== "Enter" || !inp.value.trim()) return;
    // el pedido etiquetado con @ queda vinculado si su clienta sigue nombrada en el texto
    const ro = inp.dataset.order && db.get("orders", inp.dataset.order);
    const orderId = ro && inp.value.includes(`@${ro.client?.name || "Clienta"}`) ? ro.id : "";
    await db.put("tasks", { title: inp.value.trim(), date: inp.dataset.addDay, type: "trabajo", done: false, orderId });
    inp.value = ""; inp.blur(); redraw();
  }; });
  $$(".planner [data-edit-task]", el).forEach((n) => {
    n.onclick = (e) => e.preventDefault();
    n.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); n.blur(); } };
    n.onblur = async () => { const k = db.get("tasks", n.dataset.editTask), v = n.textContent.trim(); if (k && v && v !== k.title) await db.put("tasks", { ...k, title: v }); else if (k) n.textContent = k.title; };
  });
  const tl = $(".today-list", el);
  if (tl) bindTodoList(tl, sortedTodos().filter((x) => !x.done), redraw);
  const det = $("#dash-metrics", el);
  if (det) det.ontoggle = () => { try { localStorage.setItem("v-dash-metrics", det.open ? "1" : "0"); } catch {} };
  $$("[data-recv-edit]", el).forEach((b) => (b.onclick = () => {
    const o = db.get("orders", b.dataset.id), it = o?.items?.[b.dataset.i]; if (!it) return;
    b.outerHTML = `<input type="date" value="${esc(it[b.dataset.recvEdit] || "")}" data-recv="${b.dataset.recvEdit}" data-id="${o.id}" data-i="${b.dataset.i}">`;
    bindRecv(el);
  }));
  bindRecv(el);
  // la fecha se guarda apenas la elegís; al salir del campo se redibuja y se ve el día guardado
  function bindRecv(el) { $$("[data-recv]", el).forEach((inp) => {
    inp.onchange = async () => {
      const o = db.get("orders", inp.dataset.id); if (!o || !inp.value) return;
      const items = (o.items || []).map((it, i) => (i === Number(inp.dataset.i) ? { ...it, [inp.dataset.recv]: inp.value } : it));
      await db.put("orders", { ...o, items });
      inp.dataset.saved = o.client?.name || "el pedido";
      if (!inp.nextElementSibling?.classList.contains("recv-ok")) inp.insertAdjacentHTML("afterend", `<span class="recv-ok" style="color:var(--ok)"> ✔ guardada</span>`);
    };
    inp.onblur = () => setTimeout(() => {
      const saved = $$("[data-recv][data-saved]", el);
      if (!saved.length || document.activeElement?.matches("[data-recv]")) return; // si pasaste a otra fecha, espera a que termines
      toast(saved.length > 1 ? "📅 Fechas guardadas" : "📅 Fecha guardada", [...new Set(saved.map((x) => `Pedido de ${x.dataset.saved}`))].join(" · "));
      render(el);
    }, 150);
  }); }
  $$("[data-group]", el).forEach((b) => (b.onclick = () => groupList(Number(b.dataset.group))));
  $$("[data-dkey]", el).forEach((x) => (x.onclick = () => clientsOfProvince(x.dataset.dkey)));
  bindTooltip(el);
  return { title: "Inicio", sub: `${settings().businessName} · resumen del día` };
}
