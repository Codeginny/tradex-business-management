// Facturar: todos los pedidos con CUIT de los últimos 4 meses que todavía no facturaste, por cliente, con el total
import { db } from "../db.js";
import { esc, money, fmtDate, fmtDni, isCuit, orderTotal, itemsText, today, statusOf } from "../utils.js";
import { $$, toast } from "../ui.js";
import { openOrderDetail } from "./orders.js";

// un grupo por cliente (ficha o, si no tiene, nombre)
function byClient(list) {
  const map = new Map();
  for (const o of list) {
    const key = o.clientId || o.client?.name || "sin";
    if (!map.has(key)) map.set(key, { name: o.client?.name || "Sin nombre", clientId: o.clientId, orders: [] });
    map.get(key).orders.push(o);
  }
  return [...map.values()].map((g) => {
    const c = g.clientId && db.get("clients", g.clientId);
    return { ...g, dni: fmtDni(c?.dni || g.orders.find((o) => o.client?.dni)?.client.dni), total: g.orders.reduce((a, o) => a + orderTotal(o), 0) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

const orderRow = (o) => `<div class="row bill-order" data-o="${o.id}"><span class="grow small">${esc(itemsText(o, " · ") || "Sin productos")}</span>
  <span class="small muted">${o.status === "entregado" ? `entregado ${fmtDate(o.deliveredAt || o.deadline)}` : `${statusOf(o.status).label} · ${fmtDate(o.deadline || orderDay(o))}`}</span><b class="small">${money(orderTotal(o))}</b></div>`;

// fecha del pedido para el corte de 4 meses (se factura cada 2 o 3 meses)
const orderDay = (o) => o.deliveredAt || (o.createdAt || "").slice(0, 10) || o.deadline || "";
const since = () => { const d = new Date(); d.setMonth(d.getMonth() - 4); d.setDate(1); return d.toISOString().slice(0, 10); };

export function render(el) {
  // solo los que tienen CUIT llevan factura
  const cuitOf = (o) => (o.clientId && db.get("clients", o.clientId)?.dni) || o.client?.dni;
  const done = db.all("orders").filter((o) => !o.archived && !o.gift && isCuit(cuitOf(o)) && orderDay(o) >= since());
  const pending = byClient(done.filter((o) => !o.invoicedAt));
  const invoiced = done.filter((o) => o.invoicedAt).sort((a, b) => b.invoicedAt.localeCompare(a.invoicedAt)).slice(0, 30);
  const total = pending.reduce((a, g) => a + g.total, 0);

  el.innerHTML = `<div class="stack">
    <div class="card bill-sum"><span>🧾 Por facturar</span><b>${money(total)}</b><span class="small muted">${pending.length} cliente${pending.length === 1 ? "" : "s"} · pedidos con CUIT de los últimos 4 meses</span></div>
    ${pending.length ? `<div class="table-wrap card"><table class="bill-table"><thead><tr><th>Cliente</th><th>DNI / CUIT</th><th>Pedidos</th><th class="right">Monto total</th><th></th></tr></thead><tbody>
      ${pending.map((g, i) => `<tr><td><b>${esc(g.name)}</b></td><td class="nowrap">${g.dni ? `<b>${esc(g.dni)}</b>` : `<span class="muted">Falta cargar</span>`}</td>
        <td>${g.orders.map(orderRow).join("")}</td><td class="right nowrap"><b>${money(g.total)}</b></td>
        <td><button class="btn sm primary" data-bill="${i}">✔ Ya facturé</button></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty card"><div class="big">🎉</div><p>No tenés nada pendiente de facturar.</p></div>`}
    ${invoiced.length ? `<details class="card"><summary><b>✅ Ya facturados</b> <span class="small muted">(últimos ${invoiced.length})</span></summary>
      <div class="stack" style="gap:6px;margin-top:8px">${invoiced.map((o) => `<div class="row bill-order" data-o="${o.id}"><b class="small">${esc(o.client?.name || "")}</b><span class="grow small muted">${esc(itemsText(o, " · "))}</span>
        <span class="small">${money(orderTotal(o))} · facturado ${fmtDate(o.invoicedAt)}</span><button class="btn sm ghost" data-unbill="${o.id}">Deshacer</button></div>`).join("")}</div></details>` : ""}
  </div>`;

  $$("[data-o]", el).forEach((r) => (r.onclick = (e) => { if (!e.target.closest("button")) openOrderDetail(r.dataset.o); }));
  $$("[data-bill]", el).forEach((b) => (b.onclick = async () => {
    const g = pending[b.dataset.bill]; b.disabled = true;
    for (const o of g.orders) await db.put("orders", { ...o, invoicedAt: today() });
    toast("🧾 Facturado", `${g.name} · ${money(g.total)}`);
  }));
  $$("[data-unbill]", el).forEach((b) => (b.onclick = async () => { const o = db.get("orders", b.dataset.unbill); if (o) await db.put("orders", { ...o, invoicedAt: "" }); }));
  return { title: "Facturar", sub: `${pending.length} cliente${pending.length === 1 ? "" : "s"} por facturar · ${money(total)}` };
}
