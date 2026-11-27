// Horas trabajadas: mientras TRADEX está abierta se anota cada minuto del día.
// Si la tenés abierta en la compu y en el celular a la vez, ese minuto cuenta una sola vez.
// Además, el botón "Fin del día" guarda todo, hace la copia de seguridad y te muestra el resumen.
import { db, uid, syncNow, syncState, pinHeader } from "./db.js";
import { today, addDays, startOfWeek, money, fmtDate, orderTotal, esc } from "./utils.js";
import { modal } from "./ui.js";

const deviceId = (() => {
  let id = localStorage.getItem("v-device");
  if (!id) { id = uid(); localStorage.setItem("v-device", id); }
  return id;
})();
const minuteNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const docId = (day) => `${day}_${deviceId}`;

let mine = { day: today(), minutes: new Set<number>() };
let lastSave = 0;

function load(day) {
  const doc = db.get("worklog", docId(day));
  return { day, minutes: new Set<number>(doc?.minutes || []) };
}
async function save(force = false) {
  if (!force && Date.now() - lastSave < 5 * 60 * 1000) return; // se guarda cada 5 minutos
  lastSave = Date.now();
  const prev = db.get("worklog", docId(mine.day)) || {};
  await db.put("worklog", { ...prev, id: docId(mine.day), date: mine.day, device: deviceId, minutes: [...mine.minutes].sort((a, b) => a - b) });
}
function tick() {
  if (mine.day !== today()) { save(true); mine = load(today()); }
  mine.minutes.add(minuteNow());
  save();
  document.dispatchEvent(new CustomEvent("tradex-worktime"));
}

export function startWorkTimer() {
  mine = load(today());
  tick();
  setInterval(tick, 60 * 1000);
  window.addEventListener("pagehide", () => save(true));
}

// minutos trabajados en un día (sumando todos los dispositivos sin repetir)
export function minutesOn(day) {
  const set = new Set(day === mine.day ? mine.minutes : []);
  for (const w of db.all("worklog")) if (w.date === day) (w.minutes || []).forEach((m) => set.add(m));
  return set.size;
}
export const minutesBetween = (from, to) => { let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) n += minutesOn(d); return n; };
export const fmtHours = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`);
export const workEmoji = (min) => (min < 120 ? "☕" : min < 300 ? "💪" : min < 480 ? "🔥" : "🦸‍♀️");
export const workChip = () => { const m = minutesOn(today()); return `<span class="work-chip" title="Tiempo con TRADEX abierta hoy">${workEmoji(m)} Hoy: ${fmtHours(m)}</span>`; };

// 🌙 Fin del día
export async function endOfDay() {
  const m = modal({
    title: "🌙 Fin del día",
    body: `<div class="stack" id="eod"><p>⏳ Guardando todo y haciendo la copia de seguridad…</p></div>`,
  });
  const box = m.el.querySelector("#eod");
  await save(true);
  await syncNow();
  let backup = null;
  try {
    const r = await fetch("/api/backup-now", { method: "POST", headers: pinHeader() });
    if (r.ok) backup = (await r.json()).name;
  } catch {}
  const t = today();
  const min = minutesOn(t);
  const week = minutesBetween(startWorkTimerWeekStart(t), t);
  const monthStart = `${t.slice(0, 7)}-01`;
  const month = minutesBetween(monthStart, t);
  const orders = db.all("orders").filter((o) => !o.archived);
  const newToday = orders.filter((o) => o.createdAt?.slice(0, 10) === t);
  const deliveredToday = orders.filter((o) => o.deliveredAt === t);
  const tomorrow = orders.filter((o) => o.deadline === addDays(t, 1) && o.status !== "entregado");
  const tasksTomorrow = db.all("tasks").filter((k) => !k.done && k.date === addDays(t, 1));
  const saved = syncState.status === "ok" && !syncState.pending;
  const msg = min < 120 ? "¡Buen trabajo! A descansar ☕" : min < 300 ? "¡Qué buen día! 💪" : min < 480 ? "¡Día intenso, te lo ganaste! 🔥" : "¡Sos una máquina! Ahora a descansar de verdad 🦸‍♀️";
  box.innerHTML = `
    <div class="eod-hero"><div class="eod-emoji">${workEmoji(min)}</div>
      <div><div class="eod-hours">Hoy trabajaste ${fmtHours(min)}</div><div>${msg}</div></div></div>
    <div class="grid g3">
      <div class="card stat"><span class="label">⏱️ Esta semana</span><span class="value">${fmtHours(week)}</span></div>
      <div class="card stat"><span class="label">📅 Este mes</span><span class="value">${fmtHours(month)}</span></div>
      <div class="card stat"><span class="label">🛍️ Pedidos nuevos hoy</span><span class="value">${newToday.length}</span><span class="hint">${money(newToday.reduce((a, o) => a + orderTotal(o), 0))}</span></div>
    </div>
    ${deliveredToday.length ? `<p>✅ Entregaste ${deliveredToday.length} pedido${deliveredToday.length === 1 ? "" : "s"} hoy.</p>` : ""}
    ${tomorrow.length || tasksTomorrow.length ? `<div class="card"><b>📌 Mañana</b>
      ${tomorrow.map((o) => `<div class="small">📦 Entregar a ${esc(o.client?.name)} (${fmtDate(o.deadline)})</div>`).join("")}
      ${tasksTomorrow.map((k) => `<div class="small">${k.urgent ? "🔥" : "📌"} ${esc(k.title)}</div>`).join("")}</div>` : `<p class="muted">📌 Mañana no tenés entregas ni tareas agendadas.</p>`}
    <div class="eod-status ${saved && backup ? "ok" : "warn"}">
      ${saved ? "✅ Todo guardado en la compu" : `⚠️ Hay ${syncState.pending} cambio${syncState.pending === 1 ? "" : "s"} guardado${syncState.pending === 1 ? "" : "s"} solo en este dispositivo (no se pudo conectar con la compu). Se suben solos la próxima vez que se conecte.`}<br>
      ${backup ? `💾 Copia de seguridad hecha: ${esc(backup)}` : "⚠️ No se pudo hacer la copia de seguridad ahora (la compu hace una sola todos los días igual)."}
    </div>
    <p style="text-align:center;font-size:17px;margin:4px 0 0"><b>${saved ? "Ya podés apagar la compu. ¡Hasta mañana! 🌙" : "Revisá la conexión antes de apagar la compu."}</b></p>`;
  m.el.querySelector(".modal").insertAdjacentHTML("beforeend", `<div class="modal-foot"><button class="btn primary" data-close>¡Hasta mañana! 👋</button></div>`);
}
const startWorkTimerWeekStart = (t) => startOfWeek(t);
