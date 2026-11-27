// Calendario: entregas, eventos, pedir/recibir del proveedor, tareas y feriados con alerta.
import { icon, esc, today, addDays, startOfWeek, parseISO, iso, MONTHS, fmtDate } from "../utils.js";
import { $, $$ } from "../ui.js";
import { calendarEvents } from "../alerts.js";
import { openOrderDetail } from "./orders.js";
import { openTaskForm } from "./agenda.js";
import { db } from "../db.js";

const state = { month: today().slice(0, 7), sel: today() };
const TYPES = [["delivery", "📦 Entregas"], ["event", "🎉 Eventos"], ["order", "📝 Pedir a proveedor"], ["receive", "🚚 Recibir proveedor"], ["task", "📌 Tareas"], ["holiday", "⚠️ Feriados"]];

export function render(el) {
  const [y, m] = state.month.split("-").map(Number);
  const first = iso(new Date(y, m - 1, 1));
  const gridStart = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const events = calendarEvents(days[0], days.at(-1));
  const byDay = Object.groupBy ? Object.groupBy(events, (e) => e.date) : events.reduce((a, e) => ((a[e.date] ||= []).push(e), a), {});
  const t = today();

  el.innerHTML = `<div class="stack">
    <div class="row">
      <button class="btn icon" id="c-prev">${icon("chevL")}</button>
      <h2 style="font-size:20px;min-width:170px;text-align:center;text-transform:capitalize">${MONTHS[m - 1]} ${y}</h2>
      <button class="btn icon" id="c-next">${icon("chevR")}</button>
      <button class="btn sm" id="c-today">Hoy</button>
      <span class="grow"></span>
      <div class="legend">${TYPES.map(([k, l]) => `<span class="ev t-${k}">${l}</span>`).join("")}</div>
    </div>
    <div class="cal">
      ${["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => `<div class="dow">${d}</div>`).join("")}
      ${days.map((d) => {
        const ev = byDay[d] || [];
        const hol = ev.find((e) => e.type === "holiday");
        return `<div class="day ${d.slice(0, 7) !== state.month ? "out" : ""} ${d === t ? "today" : ""} ${d === state.sel ? "sel" : ""} ${hol ? "holiday" : ""}" data-d="${d}">
          <div class="num"><span>${parseISO(d).getDate()}</span>${hol ? '<span title="Feriado">⚠️</span>' : ""}</div>
          ${ev.slice(0, 4).map((e) => `<div class="ev t-${e.type}" style="${e.done ? "opacity:.5;text-decoration:line-through" : ""}">${esc(e.text)}</div>`).join("")}
          ${ev.length > 4 ? `<div class="small muted">+${ev.length - 4} más</div>` : ""}
          <div class="dots">${ev.slice(0, 5).map((e) => `<i class="ev t-${e.type}" style="padding:0"></i>`).join("")}</div>
        </div>`;
      }).join("")}
    </div>
    <div class="card" id="c-day"></div>
  </div>`;

  const drawDay = () => {
    const ev = byDay[state.sel] || [];
    $("#c-day", el).innerHTML = `<div class="card-head"><h3>${fmtDate(state.sel, { long: true })}</h3><button class="btn sm soft" id="c-add">${icon("plus")} Tarea</button></div>
      ${ev.length ? `<div class="stack">${ev.map((e) => `<div class="ev t-${e.type}" style="padding:10px 12px;font-size:14px;cursor:${e.orderId || e.taskId ? "pointer" : "default"};white-space:normal" ${e.orderId ? `data-o="${e.orderId}"` : ""} ${e.taskId ? `data-t="${e.taskId}"` : ""}>${esc(e.text)}${e.type === "holiday" ? " — correo y proveedores no trabajan" : ""}</div>`).join("")}</div>` : `<p class="muted">Nada agendado este día.</p>`}`;
    $("#c-add", el).onclick = () => openTaskForm({ date: state.sel });
    $$("[data-o]", el).forEach((x) => (x.onclick = () => openOrderDetail(x.dataset.o)));
    $$("[data-t]", el).forEach((x) => (x.onclick = () => openTaskForm(db.get("tasks", x.dataset.t))));
  };
  const shift = (n) => { const d = new Date(y, m - 1 + n, 1); state.month = iso(d).slice(0, 7); render(el); };
  $("#c-prev", el).onclick = () => shift(-1);
  $("#c-next", el).onclick = () => shift(1);
  $("#c-today", el).onclick = () => { state.month = t.slice(0, 7); state.sel = t; render(el); };
  $$("[data-d]", el).forEach((c) => (c.onclick = () => { state.sel = c.dataset.d; $$(".day.sel", el).forEach((x) => x.classList.remove("sel")); c.classList.add("sel"); drawDay(); }));
  drawDay();
  return { title: "Calendario", sub: "Entregas, proveedores, tareas y feriados" };
}
