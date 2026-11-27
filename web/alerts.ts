// Motor de alertas y eventos del calendario.
// Regla clave: pedidos para viernes o sábado avisan 3 y 2 semanas antes para pedir al proveedor.
import { db, settings } from "./db.js";
import {
  today, addDays, parseISO, fmtDate, diffDays, targetDate, BEFORE_SUPPLIER, orderBalance, money,
  holidayMap, longWeekends, iso, itemsText,
} from "./utils.js";
import { toast } from "./ui.js";
import { personalAlerts, personalEvents } from "./views/personal.js";

// Proveedor de cada producto del pedido: el elegido en el renglón, el del catálogo o (pedidos viejos) el principal
export const itemSupplierId = (i, o: Rec = {}) => i.supplierId || (i.productId && db.get("products", i.productId)?.supplierId) || o.supplierId || "";
export const orderSupplierIds = (o) => [...new Set((o.items || []).map((i) => itemSupplierId(i, o)).filter(Boolean))];

export function leadDays(o) {
  const ids = orderSupplierIds(o);
  const days = [...ids].map((id) => Number(db.get("suppliers", id)?.leadDays) || 0);
  return Math.max(7, ...days);
}

// Fechas recordatorio "pedir al proveedor" de un pedido
export function supplierReminders(o) {
  const t = targetDate(o);
  if (!t) return [];
  const dow = parseISO(t).getDay();
  if (dow === 5 || dow === 6) {
    return [
      { key: "ord3", date: addDays(t, -21), label: "3 semanas antes" },
      { key: "ord2", date: addDays(t, -14), label: "2 semanas antes", urgent: true },
    ];
  }
  const base = o.deadline || t;
  return [{ key: "ordl", date: addDays(base, -(leadDays(o) + 3)), label: `según demora del proveedor (${leadDays(o)} días)`, urgent: true }];
}

// con N° de seguimiento llega 4 días después de cargarlo; si no, según la demora del proveedor
export const expectedArrival = (o) => o.tracking ? addDays(o.trackingAt || o.updatedAt?.slice(0, 10) || today(), 4) : o.shippedAt ? addDays(o.shippedAt, 4) : o.supplierOrderedAt ? addDays(o.supplierOrderedAt, leadDays(o)) : null;

export function computeAlerts() {
  const t = today();
  const out = [];
  const name = (o) => o.client?.name || "Cliente";
  for (const o of db.all("orders")) {
    if (o.status === "entregado" || o.archived) continue;
    const td = targetDate(o);
    if (BEFORE_SUPPLIER.includes(o.status)) {
      for (const r of supplierReminders(o)) {
        if (t >= r.date && (!td || t <= td)) {
          out.push({
            id: `${r.key}-${o.id}`, orderId: o.id, urgent: !!r.urgent, icon: "📝",
            title: `Pedir al proveedor: ${name(o)}`,
            body: `Es para el ${fmtDate(td, { long: true })} (${r.label}). ${itemsText(o)}`,
          });
        }
      }
    }
    const arr = expectedArrival(o);
    if (o.status === "esperando" && arr && t >= addDays(arr, -1)) {
      out.push({ id: `rcv-${o.id}-${arr}`, orderId: o.id, icon: "🚚", title: `Llega pedido del proveedor (${name(o)})`, body: `${itemsText(o)} · Fecha estimada ${fmtDate(arr)}${o.courier ? ` · viene por ${o.courier}` : ""}${o.tracking ? ` · seguimiento ${o.tracking}` : ""}` });
    }
    if (o.deadline) {
      const n = diffDays(o.deadline, t);
      if (n < 0) out.push({ id: `late-${o.id}-${t}`, orderId: o.id, urgent: true, icon: "⏰", late: true, title: `Pedido atrasado: ${name(o)}`, body: `La entrega era el ${fmtDate(o.deadline)}${itemsText(o) ? ` · ${itemsText(o)}` : ""}` });
      else if (n <= 1 && o.handoff?.date !== t) out.push({ id: `dlv-${o.id}-${o.deadline}-${n}`, orderId: o.id, urgent: n === 0, icon: "📦", title: `Entregar ${n === 0 ? "HOY" : "mañana"}: ${name(o)}`, body: `${o.shipping || "Entrega"}${o.courier ? ` · ${o.courier}` : ""}` });
      if (n >= 0 && n <= 3 && orderBalance(o) > 0) out.push({ id: `bal-${o.id}-${o.deadline}`, orderId: o.id, icon: "💰", title: `Cobrar saldo de ${name(o)}`, body: `Saldo pendiente ${money(orderBalance(o))}` });
    }
  }
  // las tareas no van en avisos: ya están en la agenda del día
  for (const w of longWeekends(t, 12)) {
    out.push({ id: `lw-${w.from}`, icon: "⚠️", title: `Fin de semana largo: ${fmtDate(w.from)} al ${fmtDate(w.to)}`, body: `${w.names.join(", ")}. El correo y los proveedores no trabajan: adelantá envíos y pedidos.` });
  }
  out.push(...personalAlerts()); // vencimientos de gastos fijos y préstamos por devolver
  return out;
}

// Guarda las alertas nuevas en el historial y las muestra (toast + notificación del sistema)
export async function syncNotifications({ silent = false }: Rec = {}) {
  const alerts = computeAlerts();
  const fresh = [];
  for (const a of alerts) {
    if (db.get("notifications", a.id)) continue;
    await db.put("notifications", { ...a, at: new Date().toISOString(), dismissed: false });
    fresh.push(a);
  }
  if (!silent) {
    fresh.slice(0, 4).forEach((a) => toast(`${a.icon} ${a.title}`, a.body, { urgent: a.urgent, ms: a.urgent ? 12000 : 7000 }));
    if (fresh.length && settings().notifyPush) pushNotify(fresh);
  }
  return alerts;
}

export function activeAlerts() {
  // se muestra el aviso como se arma hoy (productos, botones), no la copia guardada cuando apareció
  const live = new Map(computeAlerts().map((a) => [a.id, a]));
  return db.all("notifications").filter((n) => live.has(n.id) && !n.dismissed).map((n) => ({ ...n, ...live.get(n.id), at: n.at, dismissed: n.dismissed })).sort((a, b) => (b.urgent - a.urgent) || b.at.localeCompare(a.at));
}

async function pushNotify(list) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker?.getRegistration();
  for (const a of list.slice(0, 3)) {
    const opts = { body: a.body, icon: "/icons/icon.svg", badge: "/icons/icon.svg", tag: a.id };
    if (reg) reg.showNotification(`TRADEX · ${a.title}`, opts); else new Notification(`TRADEX · ${a.title}`, opts);
  }
}

// Eventos del calendario entre dos fechas (inclusive)
export function calendarEvents(from, to) {
  const ev = [];
  const inRange = (d) => d && d >= from && d <= to;
  for (const o of db.all("orders")) {
    if (o.archived) continue;
    const n = o.client?.name || "Cliente";
    if (inRange(o.deadline)) ev.push({ date: o.deadline, type: "delivery", text: `📦 Entregar: ${n}`, orderId: o.id, done: o.status === "entregado" });
    if (inRange(o.eventDate)) ev.push({ date: o.eventDate, type: "event", text: `🎉 Evento: ${n}`, orderId: o.id });
    if (BEFORE_SUPPLIER.includes(o.status)) {
      for (const r of supplierReminders(o)) if (inRange(r.date)) ev.push({ date: r.date, type: "order", text: `📝 Pedir proveedor: ${n}`, orderId: o.id });
    }
    const arr = expectedArrival(o);
    if (o.status === "esperando" && inRange(arr)) ev.push({ date: arr, type: "receive", text: `🚚 Llega proveedor: ${n}`, orderId: o.id });
  }
  for (const k of db.all("tasks")) if (inRange(k.date)) ev.push({ date: k.date, type: "task", text: `${k.done ? "✔️" : k.urgent ? "🔥" : "📌"} ${k.title}`, taskId: k.id, done: k.done });
  ev.push(...personalEvents(from, to));
  const hm = holidayMap(parseISO(from).getFullYear());
  for (let d = from; d <= to; d = addDays(d, 1)) if (hm.has(d)) ev.push({ date: d, type: "holiday", text: `⚠️ ${hm.get(d)}` });
  return ev;
}

export { iso };
