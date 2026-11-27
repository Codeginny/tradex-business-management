// 🔔 Campanita: las tareas del día con los proveedores, para tildar cuando las hacés.
// Se arman solas con el estado de cada pedido:
//  - Comprale al proveedor (desde el aviso de 3/2 semanas antes, hasta que lo tildás)
//  - Preguntale si lo envía mañana / cómo va el pedido (mientras no hay N° de seguimiento)
//  - Con N° de seguimiento: llega en 4 a 5 días → "Andreani viene hoy" o "Andá al correo"
import { db } from "./db.js";
import { today, addDays, diffDays, fmtDate, esc, icon, BEFORE_SUPPLIER, itemsText } from "./utils.js";
import { toast } from "./ui.js";
import { supplierReminders, orderSupplierIds, itemSupplierId } from "./alerts.js";

export const TRACK_DAYS = [4, 5]; // con el N° de seguimiento, llega entre 4 y 5 días después

// Fecha en que salió el paquete: cuando se cargó el N° de seguimiento (los pedidos viejos usan su última
// modificación) o cuando tocaste "Ya lo envió" en la campanita
export const trackingDate = (o) => (o.tracking ? o.trackingAt || o.updatedAt?.slice(0, 10) || null : o.shippedAt || null);
export const trackingArrival = (o) => { const d = trackingDate(o); return d ? addDays(d, TRACK_DAYS[0]) : null; };

const supplierNames = (o) => {
  return orderSupplierIds(o).map((id) => db.get("suppliers", id)?.name).filter(Boolean).join(" y ") || "el proveedor";
};
// Qué productos son: "Difusores cuadrado… (25)"; si hay varios proveedores, agrupados por proveedor
const whatOf = (o) => {
  const ids = orderSupplierIds(o);
  const line = (its) => its.map((i) => `${i.product} (${i.qty})`).join(" · ");
  if (ids.length <= 1) return line(o.items || []);
  return ids.map((id) => `${db.get("suppliers", id)?.name || "Proveedor"}: ${line((o.items || []).filter((i) => itemSupplierId(i, o) === id))}`).join("\n");
};
const HOME = ["Andreani"]; // estos traen el paquete a tu casa; los demás se retiran

// Tareas de hoy (hechas o no)
export function todayTodos() {
  const t = today();
  const out = [];
  for (const o of db.all("orders")) {
    if (o.archived || o.status === "entregado") continue;
    const cli = o.client?.name || "Cliente";
    const sup = supplierNames(o);
    const what = whatOf(o);
    if (BEFORE_SUPPLIER.includes(o.status)) {
      const first = supplierReminders(o)[0];
      if (first && t >= first.date) {
        out.push({ id: `buy-${o.id}`, orderId: o.id, what, kind: "buy", icon: "🛒", urgent: true,
          title: `Comprale a ${sup}`, body: `Pedido de ${cli}${o.eventDate || o.deadline ? ` · es para el ${fmtDate(o.eventDate || o.deadline)}` : ""}`, doneLabel: "Ya lo compré" });
      }
      continue;
    }
    if (o.status !== "esperando") continue;
    const tr = trackingDate(o);
    if (!tr) {
      const d = o.supplierOrderedAt ? diffDays(t, o.supplierOrderedAt) : 1;
      if (d < 1) continue; // lo compraste hoy
      out.push(d <= 2
        ? { id: `askship-${o.id}-${t}`, orderId: o.id, what, kind: "ask", icon: "📦", title: `Preguntale a ${sup} si lo envía mañana`, body: `Pedido de ${cli} · cuando te pase el N° de seguimiento cargalo en el pedido` }
        : { id: `askhow-${o.id}-${t}`, orderId: o.id, what, kind: "ask", icon: "💬", title: `Preguntale a ${sup} cómo va el pedido`, body: `Pedido de ${cli} · lo compraste hace ${d} días y todavía no hay N° de seguimiento` });
      continue;
    }
    const arrive = addDays(tr, TRACK_DAYS[0]);
    if (t < arrive) continue;
    const courier = o.courier || "el correo";
    const home = HOME.includes(o.courier);
    out.push(home
      ? { id: `home-${o.id}`, orderId: o.id, what, kind: "arrive", icon: "🚚", urgent: true, title: `${courier} viene a tu casa ${t === arrive ? "hoy" : "(ya debería haber pasado)"} con el paquete de ${sup}`, body: `Pedido de ${cli}${o.tracking ? ` · seguimiento ${o.tracking}` : ""}`, doneLabel: "Ya llegó" }
      : { id: `pickup-${o.id}`, orderId: o.id, what, kind: "arrive", icon: "📮", urgent: true, title: `Andá a ${courier}: ya debe haber llegado el paquete de ${sup}`, body: `Pedido de ${cli}${o.tracking ? ` · seguimiento ${o.tracking}` : ""}`, doneLabel: "Ya lo retiré" });
  }
  for (const k of db.all("tasks")) {
    if (!(k.date && k.date <= t && (!k.done || k.doneAt === t))) continue;
    // si etiquetaste a una clienta con @, se muestra el detalle de su pedido
    const ro = k.orderId && db.get("orders", k.orderId);
    out.push({ id: `task-${k.id}`, taskId: k.id, kind: "task", icon: k.urgent ? "🔥" : "📌", title: k.title, taskDone: k.done, refOrder: ro?.id,
      what: ro ? itemsText(ro, "\n") : "",
      body: [k.date < t ? `Vencida · ${fmtDate(k.date)}` : k.movedFrom ? `Pasó del ${fmtDate(k.movedFrom)}` : "Tarea de hoy", ro && `Pedido de ${ro.client?.name || "la clienta"}${ro.deadline ? ` · entrega ${fmtDate(ro.deadline)}` : ""}${ro.eventDate ? ` · evento ${fmtDate(ro.eventDate)}` : ""}`].filter(Boolean).join(" · ") });
  }
  return out.map((x) => ({ ...x, done: x.kind === "task" ? !!x.taskDone : !!db.get("notifications", `todo-${x.id}`)?.done }));
}
export const pendingCount = () => todayTodos().filter((x) => !x.done).length;

// Tildar una tarea. Algunas además mueven el pedido de etapa (se puede deshacer).
async function check(x, done) {
  if (x.kind === "task") {
    const k = db.get("tasks", x.taskId);
    if (!k) return;
    await db.put("tasks", { ...k, done, doneAt: done ? today() : "" });
    if (done) toast("✔ Hecho", k.title, { action: { label: "Deshacer", run: () => check(x, false) } });
    return;
  }
  const o = db.get("orders", x.orderId);
  if (done && o && x.kind === "shipped") {
    await db.put("orders", { ...o, shippedAt: today() });
    toast("🚚 Anotado: ya lo envió", `Te aviso en ${TRACK_DAYS[0]} a ${TRACK_DAYS[1]} días, cuando tenga que llegar el paquete de ${o.client?.name}.`,
      { action: { label: "Deshacer", run: () => db.put("orders", { ...db.get("orders", o.id), shippedAt: "" }) } });
    return;
  }
  if (done && o && (x.kind === "buy" || x.kind === "arrive")) {
    const prev = { status: o.status, supplierOrderedAt: o.supplierOrderedAt || "" };
    const patch = x.kind === "buy" ? { status: "esperando", supplierOrderedAt: o.supplierOrderedAt || today() } : { status: "entregar", receivedAt: today() };
    await db.put("orders", { ...o, ...patch });
    toast(x.kind === "buy" ? "🛒 Anotado: ya lo compraste" : "📦 Anotado: ya tenés el paquete", x.kind === "buy" ? `El pedido de ${o.client?.name} pasó a “Recibir del proveedor”.` : `El pedido de ${o.client?.name} pasó a “Entregar / despachar”.`,
      { action: { label: "Deshacer", run: () => db.put("orders", { ...db.get("orders", o.id), ...prev }) } });
    return;
  }
  await db.put("notifications", { id: `todo-${x.id}`, kind: "todo", done, at: new Date().toISOString(), dismissed: true, title: x.title });
  if (done) toast("✔ Hecho", x.title, { action: { label: "Deshacer", run: () => check(x, false) } });
}

// Botones de cada aviso para ir descartando
const PROBLEM = ["problem", "⚠️ Hubo un problema"];
const ACTIONS = {
  buy: [["bought", "🛒 Ya lo compré"], PROBLEM],
  ask: [["asked", "💬 Ya le pregunté"], ["shipped", "🚚 Ya lo envió"], ["got", "📦 Ya lo tengo"], PROBLEM],
  arrive: [["got", "📦 Ya lo tengo"], PROBLEM],
};

// Nota tipo post-it de un pedido ("Falta stock de vinilo negro"): queda fijada hasta que la marcás resuelta
export const problemNote = (o) => (o?.problem?.text ? `<span class="postit sm"><b>⚠️ ${esc(o.problem.text)}</b><span class="small">${fmtDate(o.problem.at)}</span>
  <button type="button" class="btn sm ghost" data-solved="${o.id}">✔ Resuelto</button></span>` : "");
export async function solveProblem(id) { const o = db.get("orders", id); if (o) await db.put("orders", { ...o, problem: null }); }

// La lista de "Para hacer hoy" (se usa en la campanita y en Inicio)
export function todoListHTML(list) {
  return list.map((x) => {
    const o = x.orderId && db.get("orders", x.orderId);
    const txt = `<span class="bi-ic">${x.icon}</span>
      <span class="bi-txt"><span class="t" ${x.kind === "task" ? `contenteditable="true" data-edit-task="${x.taskId}" title="Tocá para editar"` : ""}>${esc(x.title)}</span>${x.what ? `<span class="bi-what">${x.what.split("\n").map((l) => `<span>📦 ${esc(l)}</span>`).join("")}</span>` : ""}<span class="b">${esc(x.body)}</span>
        ${problemNote(o)}
        ${x.orderId && !x.done ? `<span class="bi-acts">${ACTIONS[x.kind].map(([k, label]) => `<button type="button" class="btn sm ${k === ACTIONS[x.kind][0][0] ? "soft" : ""} ${k === "problem" ? "warn" : ""}" data-act="${k}" data-todo="${esc(x.id)}">${label}</button>`).join("")}</span>` : ""}
        ${x.orderId && x.done ? `<span class="bi-acts"><span class="small" style="color:var(--ok)">✔ Hecho</span><button type="button" class="btn sm ghost" data-undo="${esc(x.id)}">Deshacer</button></span>` : ""}</span>
      ${x.orderId || x.refOrder ? `<a class="btn ghost sm" href="#/pedidos?id=${x.orderId || x.refOrder}" title="Ver pedido">Ver</a>` : ""}`;
    const cls = `bell-item ${x.done ? "done" : ""} ${x.urgent && !x.done ? "urgent" : ""}`;
    // las tareas de la agenda se tildan; las de los pedidos tienen botones
    return x.orderId ? `<div class="${cls}">${txt}</div>` : `<label class="${cls}"><input type="checkbox" data-todo="${esc(x.id)}" ${x.done ? "checked" : ""}>${txt}</label>`;
  }).join("");
}
export function bindTodoList(root, list, redraw) {
  const find = (id) => list.find((y) => y.id === id);
  // las tareas que anotaste se editan tocando el texto (sin tildarlas)
  root.querySelectorAll("[data-edit-task]").forEach((n) => {
    n.onclick = (e) => e.preventDefault();
    n.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); n.blur(); } if (e.key === "Escape") { n.textContent = db.get("tasks", n.dataset.editTask)?.title || ""; n.blur(); } };
    n.onblur = async () => { const k = db.get("tasks", n.dataset.editTask), v = n.textContent.trim(); if (k && v && v !== k.title) await db.put("tasks", { ...k, title: v }); else if (k) n.textContent = k.title; };
  });
  root.querySelectorAll("input[data-todo]").forEach((c) => (c.onchange = async () => { await check(find(c.dataset.todo), c.checked); redraw(); }));
  root.querySelectorAll("[data-act]").forEach((b) => (b.onclick = async () => {
    const x = find(b.dataset.todo);
    if (b.dataset.act === "problem") {
      // se abre un post-it para escribir qué pasó
      const acts = b.closest(".bi-acts");
      acts.innerHTML = `<span class="postit edit"><textarea rows="2" placeholder="¿Qué pasó? Ej: falta stock de vinilo negro, demora el transporte…">${esc(db.get("orders", x.orderId)?.problem?.text || "")}</textarea>
        <span class="row"><button type="button" class="btn sm primary" data-psave>Guardar</button><button type="button" class="btn sm ghost" data-pcancel>Cancelar</button></span></span>`;
      const ta = acts.querySelector("textarea");
      ta.focus();
      acts.querySelector("[data-pcancel]").onclick = redraw;
      acts.querySelector("[data-psave]").onclick = async () => {
        const o = db.get("orders", x.orderId);
        if (o && ta.value.trim()) { await db.put("orders", { ...o, problem: { text: ta.value.trim(), at: today() } }); toast("⚠️ Problema anotado", "Queda fijado en el pedido hasta que lo marques resuelto."); }
        redraw();
      };
      return;
    }
    const kind = { asked: x.kind, shipped: "shipped", got: "arrive", bought: "buy" }[b.dataset.act];
    await check({ ...x, kind }, true);
    redraw();
  }));
  root.querySelectorAll("[data-undo]").forEach((b) => (b.onclick = async () => { await check(find(b.dataset.undo), false); redraw(); }));
  root.querySelectorAll("[data-solved]").forEach((b) => (b.onclick = async (e) => { e.preventDefault(); await solveProblem(b.dataset.solved); redraw(); }));
}
export const sortedTodos = () => todayTodos().sort((a, b) => a.done - b.done || (b.urgent || 0) - (a.urgent || 0));

// ---------- panel ----------
let panel = null;
const close = () => { panel?.remove(); panel = null; document.removeEventListener("click", outside, true); };
const outside = (e) => { if (panel && !panel.contains(e.target) && !e.target.closest("#bell-top")) close(); };

function draw() {
  if (!panel || panel.querySelector(".postit.edit")) return; // no se redibuja mientras escribís un problema
  const list = sortedTodos();
  const left = list.filter((x) => !x.done).length;
  panel.innerHTML = `<div class="bell-head"><b>🔔 Para hacer hoy</b><span class="small muted">${left ? `${left} pendiente${left === 1 ? "" : "s"}` : "¡Todo hecho! 🎉"}</span></div>
    ${list.length ? `<div class="bell-list">${todoListHTML(list)}</div>`
      : `<p class="muted small" style="padding:12px 14px">No hay nada para hacer con los proveedores hoy. ☕</p>`}
    <a class="bell-foot" href="#/agenda">Ver agenda y avisos</a>`;
  bindTodoList(panel, list, () => { panel?.querySelector(".postit.edit")?.remove(); draw(); });
  panel.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));
}

export function toggleBell() {
  if (panel) return close();
  panel = document.createElement("div");
  panel.className = "bell-panel";
  document.body.append(panel);
  draw();
  setTimeout(() => document.addEventListener("click", outside, true));
}

// Botón de la barra de arriba + que te pregunte una vez por día
export function renderBell() {
  const b = document.querySelector("#bell-top");
  if (!b) return;
  const n = pendingCount();
  b.innerHTML = `${icon("bell")}${n ? `<span class="count">${n}</span>` : ""}`;
  b.title = n ? `${n} cosa${n === 1 ? "" : "s"} para hacer hoy` : "Nada pendiente hoy";
  draw();
}
export function askOncePerDay() {
  let last = "";
  try { last = localStorage.getItem("v-bell-day") || ""; } catch {}
  if (last === today() || !pendingCount()) return;
  try { localStorage.setItem("v-bell-day", today()); } catch {}
  if (!panel) toggleBell();
}
