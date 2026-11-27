// Agenda de tareas urgentes + avisos activos + historial de notificaciones.
import { db, settings, saveSettings } from "../db.js";
import { icon, esc, fmtDate, today, relDay } from "../utils.js";
import { $, $$, modal, toast, readForm, options } from "../ui.js";
import { activeAlerts, syncNotifications } from "../alerts.js";
import { alertList, bindAlerts } from "./dashboard.js";

const TYPES = [["cliente", "Cliente"], ["proveedor", "Proveedor"], ["trabajo", "Trabajo por hacer"], ["otro", "Otro"]];
let tab = "tareas";

export function render(el, params) {
  if (params.tab) tab = params.tab;
  const tasks = db.all("tasks").filter((k) => !k.postit).sort((a, b) => (a.done - b.done) || (a.date || "").localeCompare(b.date || ""));
  const alerts = activeAlerts();
  const history = db.all("notifications").sort((a, b) => b.at.localeCompare(a.at));
  const pushOk = "Notification" in window && Notification.permission === "granted" && settings().notifyPush;

  el.innerHTML = `<div class="stack">
    <div class="tabs" style="width:max-content;max-width:100%">
      <button data-tab="tareas" class="${tab === "tareas" ? "on" : ""}">📌 Agenda (${tasks.filter((t) => !t.done).length})</button>
      <button data-tab="avisos" class="${tab === "avisos" ? "on" : ""}">🔔 Avisos (${alerts.length})</button>
      <button data-tab="historial" class="${tab === "historial" ? "on" : ""}">🕘 Historial</button>
    </div>
    ${!pushOk ? `<div class="card row" style="justify-content:space-between"><div><b>🔔 Activá las notificaciones</b><div class="small muted">Para que te aparezcan los avisos en la pantalla del celular o la compu.</div></div><button class="btn primary sm" id="push-on">Activar</button></div>` : ""}
    <div id="ag-body"></div></div>`;

  const body = $("#ag-body", el);
  if (tab === "tareas") {
    body.innerHTML = `<div class="card">${tasks.length ? tasks.map((k) => `
      <div class="task-row ${k.done ? "done" : ""}">
        <input type="checkbox" data-done="${k.id}" ${k.done ? "checked" : ""} style="width:20px;height:20px;accent-color:var(--accent)">
        <div class="grow" data-edit="${k.id}" style="cursor:pointer"><div class="t">${k.urgent ? "🔥 " : ""}${esc(k.title)}</div>
          <div class="small muted">${esc(TYPES.find((t) => t[0] === k.type)?.[1] || "Tarea")} · ${k.date ? `${fmtDate(k.date)} (${relDay(k.date)})` : "sin fecha"}${k.notes ? ` · ${esc(k.notes)}` : ""}</div></div>
        ${!k.done && k.date && k.date < today() ? `<span class="chip u-red">Vencida</span>` : ""}
      </div>`).join("") : `<div class="empty"><div class="big">🗒️</div><p>Anotá lo urgente del día: clientes, proveedores, trabajos por hacer.</p></div>`}</div>`;
    $$("[data-done]", body).forEach((c) => (c.onchange = async () => { const k = db.get("tasks", c.dataset.done); k.done = c.checked; await db.put("tasks", k); }));
    $$("[data-edit]", body).forEach((c) => (c.onclick = () => openTaskForm(db.get("tasks", c.dataset.edit))));
  } else if (tab === "avisos") {
    body.innerHTML = `<div class="card stack">${alertList(alerts)}</div>`;
    bindAlerts(body);
  } else {
    body.innerHTML = `<div class="card stack">${history.length ? history.map((n) => `
      <div class="alert-item" style="${n.dismissed ? "opacity:.6" : ""}"><div class="ic">${n.icon || "🔔"}</div>
        <div class="grow"><div class="t">${esc(n.title)}</div><div class="b">${esc(n.body)}</div><div class="small muted">${new Date(n.at).toLocaleString("es-AR")}${n.dismissed ? " · descartado" : ""}</div></div>
        ${n.dismissed ? `<button class="btn sm soft" data-restore="${n.id}">Restaurar</button>` : ""}</div>`).join("") : `<p class="muted">Todavía no hubo notificaciones.</p>`}</div>`;
    $$("[data-restore]", body).forEach((b) => (b.onclick = async () => { const n = db.get("notifications", b.dataset.restore); n.dismissed = false; await db.put("notifications", n); toast("Aviso restaurado"); }));
  }
  $$("[data-tab]", el).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(el, {}); }));
  $("#push-on", el) && ($("#push-on", el).onclick = async () => {
    if (!("Notification" in window)) return toast("Este navegador no soporta notificaciones");
    const p = await Notification.requestPermission();
    if (p === "granted") { await saveSettings({ notifyPush: true }); toast("🔔 Notificaciones activadas"); syncNotifications(); }
    else toast("Permiso rechazado", "Podés habilitarlo desde la configuración del navegador.");
  });
  return {
    title: "Agenda y avisos",
    sub: `${alerts.length} avisos activos`,
    actions: `<button class="btn primary" id="t-new">${icon("plus")}<span class="desktop-only">Nueva tarea</span></button>`,
    bind: (a) => ($("#t-new", a).onclick = () => openTaskForm({ date: today() })),
  };
}

export function openTaskForm(k = {}) {
  const isNew = !k.id;
  modal({
    title: isNew ? "Nueva tarea / recordatorio" : "Editar tarea",
    body: `<form class="stack" id="tf">
      <label class="field">¿Qué hay que hacer? *<input name="title" required value="${esc(k.title || "")}" placeholder="Ej: Llamar a Insumos Sur por las tazas"></label>
      <div class="grid g2">
        <label class="field">Fecha<input name="date" type="date" value="${k.date || today()}"></label>
        <label class="field">Tipo<select name="type">${options(TYPES, k.type || "trabajo", null)}</select></label>
      </div>
      <label class="check"><input type="checkbox" name="urgent" ${k.urgent ? "checked" : ""}> 🔥 Es urgente</label>
      <label class="field">Notas<textarea name="notes">${esc(k.notes || "")}</textarea></label>
    </form>`,
    foot: `${!isNew ? `<button class="btn danger" id="tf-del">${icon("trash")}</button>` : ""}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="tf-save">${icon("check")} Guardar</button>`,
    onMount: (el, m) => {
      const form = $("#tf", el);
      form.title.focus();
      $("#tf-del", el) && ($("#tf-del", el).onclick = async () => { await db.remove("tasks", k.id); m.close(); });
      $("#tf-save", el).onclick = async () => {
        const f = readForm(form);
        if (!f.title) return form.title.focus();
        await db.put("tasks", { ...k, ...f, done: k.done || false });
        m.close();
        toast("📌 Guardado en la agenda", f.title);
        syncNotifications();
      };
    },
  });
}
