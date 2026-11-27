// Módulo 4 — Finanzas: flujo de caja, calculadora de ganancia, cuotas, rentabilidad, gráficos y exportación.
import { db, settings } from "../db.js";
import {
  icon, esc, money, today, monthKey, MONTHS, orderTotal, orderBalance, orderCost, itemsText, priceFromCost, CHANNELS,
  STATUSES, statusOf, statusKey, fmtDate, download, hiddenCostsPerUnit, num, cuotasOptions, cuotasMessage, waLink,
} from "../utils.js";
import { $, $$, toast, confirmBox } from "../ui.js";
import { printHTML } from "../receipt.js";
import { clientsWithStats } from "../clientdb.js";

let tab = "resumen";
const TABS = [["resumen", "💰 Flujo de caja"], ["calc", "🧮 Ganancia"], ["cuotas", "💳 Cuotas"], ["rentab", "🏆 Rentabilidad"], ["graficos", "📊 Gráficos"], ["export", "⬇️ Exportar"]];

const monthOf = (o) => monthKey(o.deadline || o.eventDate || o.createdAt?.slice(0, 10));
const addMonth = (mk, n) => { const [y, m] = mk.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const mLabel = (mk) => { const [y, m] = mk.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };

export function render(el, params) {
  if (params.tab) tab = params.tab;
  el.innerHTML = `<div class="stack">
    <div class="tabs" style="width:max-content;max-width:100%">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="fin"></div></div>`;
  $$("[data-tab]", el).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, "", "#/finanzas"); render(el, {}); }));
  ({ resumen, calc, cuotas, rentab, graficos, export: exporter })[tab]($("#fin", el), params);
  return { title: "Finanzas", sub: "Ganancias, cobros y métricas" };
}

// ---------- flujo de caja ----------
function resumen(el) {
  const orders = db.all("orders").filter((o) => !o.archived);
  const mk = monthKey(today());
  const next = addMonth(mk, 1);
  const depositsThisMonth = orders.filter((o) => monthKey(o.createdAt?.slice(0, 10)) === mk).reduce((a, o) => a + Math.min(orderTotal(o), Number(o.deposit) || 0), 0);
  const balThis = orders.filter((o) => monthOf(o) === mk).reduce((a, o) => a + orderBalance(o), 0);
  const balNext = orders.filter((o) => monthOf(o) === next).reduce((a, o) => a + orderBalance(o), 0);
  const month = (k) => {
    const list = orders.filter((o) => monthOf(o) === k);
    const sales = list.reduce((a, o) => a + orderTotal(o), 0);
    const cost = list.reduce((a, o) => a + orderCost(o), 0);
    return { list, sales, cost, net: sales - cost };
  };
  const a = month(mk), b = month(next);
  const pending = orders.filter((o) => orderBalance(o) > 0).sort((x, y) => (x.deadline || "9").localeCompare(y.deadline || "9"));
  el.innerHTML = `<div class="stack">
    <div class="grid g4">
      <div class="card stat"><span class="label">Señas cobradas este mes</span><span class="value">${money(depositsThisMonth)}</span><span class="hint">de pedidos cargados en ${mLabel(mk)}</span></div>
      <div class="card stat"><span class="label">Saldos a cobrar este mes</span><span class="value">${money(balThis)}</span><span class="hint">entregas de ${mLabel(mk)}</span></div>
      <div class="card stat"><span class="label">Saldos del mes que viene</span><span class="value">${money(balNext)}</span><span class="hint">${mLabel(next)}</span></div>
      <div class="card stat"><span class="label">Ganancia neta del mes</span><span class="value" style="color:var(--ok)">${money(a.net)}</span><span class="hint">ventas ${money(a.sales)} − costos ${money(a.cost)}</span></div>
    </div>
    <div class="grid g2">
      ${[[mk, a], [next, b]].map(([k, m]) => `<div class="card"><h3>📅 ${mLabel(k)}</h3>
        <div class="price-box"><div class="price-line"><span>Pedidos</span><b>${m.list.length}</b></div>
        <div class="price-line"><span>Ventas</span><b>${money(m.sales)}</b></div>
        <div class="price-line"><span>Costos (proveedor + extras)</span><b>${money(m.cost)}</b></div>
        <div class="price-line total"><span>Ganancia neta</span><span>${money(m.net)}</span></div></div>
        ${m.list.some((o) => !orderCost(o)) ? `<p class="small muted">⚠️ Hay pedidos sin costo cargado: la ganancia puede estar inflada.</p>` : ""}</div>`).join("")}
    </div>
    <div class="card"><h3>💸 Saldos pendientes</h3>${pending.length ? `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Entrega</th><th>Estado</th><th class="right">Total</th><th class="right">Saldo</th></tr></thead><tbody>
      ${pending.map((o) => `<tr><td>${esc(o.client?.name)}</td><td>${fmtDate(o.deadline)}</td><td>${statusOf(o.status).label}</td><td class="right">${money(orderTotal(o))}</td><td class="right" style="color:var(--u-red)"><b>${money(orderBalance(o))}</b></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">¡No hay saldos pendientes! 🎉</p>`}</div>
  </div>`;
}

// ---------- calculadora de ganancia ----------
function calc(el) {
  const s = settings();
  el.innerHTML = `<div class="grid g2" style="align-items:start">
    <div class="card stack"><h3>🧮 Calculadora de precio final</h3>
      <label class="field">Costo del producto (total)<input type="number" id="k-cost" min="0" placeholder="Ej: 120000"></label>
      <label class="field">Envío<select id="k-ship"><option value="0">Sin envío</option><option value="${s.shipSmall}">Pocos productos · ${money(s.shipSmall)}</option><option value="${s.shipBig}">Grande/pesado · ${money(s.shipBig)}</option></select></label>
      <label class="field">Unidades (para empaque y etiquetas)<input type="number" id="k-qty" min="0" value="1"></label>
      <label class="field">% de ganancia deseado<input type="number" id="k-pct" min="0" placeholder="Automático: ${s.markup}% (o ${s.markupHigh}% si supera ${money(s.markupThreshold)})"></label>
    </div>
    <div class="card"><h3>❤️ Precio al cliente</h3><div class="price-box" id="k-out"></div></div>
  </div>`;
  const draw = () => {
    const cost = Number($("#k-cost", el).value) || 0, ship = Number($("#k-ship", el).value) || 0, qty = Number($("#k-qty", el).value) || 0;
    const hidden = qty ? hiddenCostsPerUnit() : 0; // packaging: uno por pedido
    const base = cost + ship + hidden;
    const pctIn = $("#k-pct", el).value;
    const r = pctIn !== "" ? { pct: Number(pctIn), profit: base * Number(pctIn) / 100, price: base * (1 + Number(pctIn) / 100) } : priceFromCost(base);
    $("#k-out", el).innerHTML = `
      <div class="price-line"><span>Costo</span><b>${money(cost)}</b></div>
      <div class="price-line"><span>Envío</span><b>${money(ship)}</b></div>
      <div class="price-line"><span>Empaque y etiquetas</span><b>${money(hidden)}</b></div>
      <div class="price-line"><span>Subtotal con envío</span><b>${money(base)}</b></div>
      <div class="price-line"><span>Ganancia ${r.pct}%</span><b>${money(r.profit)}</b></div>
      <div class="price-line total"><span>Precio final</span><span>${money(r.price)}</span></div>
      ${qty > 1 ? `<div class="price-line"><span>Por unidad</span><b>${money(r.price / qty)}</b></div>` : ""}
      <a class="btn sm soft" style="margin-top:8px" href="#/finanzas?tab=cuotas&monto=${Math.round(r.price)}">${icon("card")} Pasarlo a cuotas</a>`;
  };
  $$("input,select", el).forEach((i) => (i.oninput = draw));
  draw();
}

// ---------- simulador de cuotas (Naranja X: Link de Pago / Nave Mini) ----------
function cuotas(el, params) {
  const s = settings();
  el.innerHTML = `<div class="grid g2" style="align-items:start">
    <div class="card stack"><h3>💳 Simulador de cuotas</h3>
      <label class="field">¿Qué querés calcular?<select id="cu-mode">
        <option value="net">Quiero que me queden limpios… (te digo cuánto cobrar)</option>
        <option value="gross">Le cobro al cliente… (te digo cuánto te queda)</option></select></label>
      <label class="field">Monto<input type="number" id="cu-m" min="0" value="${params.monto || ""}" placeholder="Ej: 150000"></label>
      <label class="field">Medio de cobro<select id="cu-medio">${s.payMedia.map((m, i) => `<option value="${i}">${esc(m.name)}</option>`).join("")}</select></label>
      <p class="small muted" style="margin:0">Como monotributista no recuperás el IVA: se suma como costo el ${s.iva}% de IVA sobre la comisión${s.ivaOnFinancing ? " y sobre la financiación" : ""}${s.iibb ? ` y ${s.iibb}% de Ingresos Brutos` : ""}. Las tasas se cambian en Ajustes.</p>
      <div class="row"><button class="btn soft" id="cu-copy">${icon("copy")} Copiar mensaje para el cliente</button><a class="btn wa" id="cu-wa" target="_blank" rel="noopener">${icon("wa")} WhatsApp</a></div>
    </div>
    <div class="card"><h3>Resultado</h3><div id="cu-out"></div></div></div>`;
  const opts = () => ({ medio: Number($("#cu-medio", el).value), mode: $("#cu-mode", el).value });
  const draw = () => {
    const amount = Number($("#cu-m", el).value) || 0;
    const o = opts();
    $("#cu-out", el).innerHTML = amount ? `<div class="table-wrap"><table><thead><tr><th>Forma de pago</th><th class="right">Cobrar al cliente</th><th class="right">Cuotas</th><th class="right">Comisión + IVA</th><th class="right">Financiación</th><th class="right">Te queda</th></tr></thead><tbody>
      ${cuotasOptions(amount, o).map((r) => `<tr><td><b>${esc(r.label)}</b>${r.key === "cuenta" || r.key === "debito" ? "" : '<div class="small muted">tarjeta de crédito</div>'}</td>
        <td class="right nowrap"><b>${money(r.price)}</b></td>
        <td class="right nowrap">${r.planZ ? "elige el cliente" : r.n > 1 ? `${r.n} × ${money(r.cuota)}` : "1 pago"}</td>
        <td class="right nowrap muted">${(r.comm * (1 + s.iva / 100)).toFixed(2)}%</td>
        <td class="right nowrap muted">${r.fin ? `${r.fin}%` : "—"}</td>
        <td class="right nowrap" style="color:var(--ok)"><b>${money(r.net)}</b><div class="small muted">−${money(r.fees)}</div></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">Ingresá un monto.</p>`;
    $("#cu-wa", el).href = amount ? `https://wa.me/?text=${encodeURIComponent(cuotasMessage(amount, o))}` : "#";
  };
  $("#cu-copy", el).onclick = () => { const a = Number($("#cu-m", el).value); if (!a) return; navigator.clipboard?.writeText(cuotasMessage(a, opts())); toast("Mensaje copiado", "Pegalo en el chat del cliente"); };
  ["#cu-m", "#cu-mode", "#cu-medio"].forEach((x) => ($(x, el).oninput = draw));
  draw();
}

// ---------- rentabilidad por producto / categoría ----------
function rentab(el) {
  const by = {};
  for (const o of db.all("orders")) for (const i of o.items || []) {
    const k = i.category || "Sin categoría";
    by[k] ||= { cat: k, qty: 0, sales: 0, cost: 0, products: {} };
    by[k].qty += Number(i.qty) || 0;
    by[k].sales += (Number(i.qty) || 0) * (Number(i.unitPrice) || 0);
    by[k].cost += (Number(i.qty) || 0) * (Number(i.unitCost) || 0);
    by[k].products[i.product] = (by[k].products[i.product] || 0) + (Number(i.qty) || 0) * ((Number(i.unitPrice) || 0) - (Number(i.unitCost) || 0));
  }
  const rows = Object.values(by).map((r) => ({ ...r, profit: r.sales - r.cost, margin: r.sales ? (r.sales - r.cost) / r.sales : 0 })).sort((a, b) => b.profit - a.profit);
  const max = Math.max(1, ...rows.map((r) => r.profit));
  const best = rows[0];
  const bestMargin = [...rows].sort((a, b) => b.margin - a.margin)[0];
  const topProducts = rows.flatMap((r) => Object.entries(r.products).map(([n, p]) => ({ n, p }))).sort((a, b) => b.p - a.p).slice(0, 8);
  el.innerHTML = rows.length ? `<div class="stack">
    <div class="grid g2">
      <div class="hero"><p style="margin:0">Lo que más ganancia te deja</p><h2>${esc(best.cat)}: ${money(best.profit)}</h2><p>${best.qty} unidades vendidas · margen ${Math.round(best.margin * 100)}%</p></div>
      <div class="hero" style="background:linear-gradient(135deg,#0ea5e9,#14b8a6)"><p style="margin:0">Mejor margen por venta</p><h2>${esc(bestMargin.cat)}: ${Math.round(bestMargin.margin * 100)}%</h2><p>De cada $100 que vendés te quedan $${Math.round(bestMargin.margin * 100)}</p></div>
    </div>
    <div class="card"><h3>🏆 Ganancia por categoría</h3>${rows.map((r) => `<div class="hbar"><span>${esc(r.cat)}</span><div class="track"><span style="width:${Math.max(2, (r.profit / max) * 100)}%"></span></div><b class="nowrap">${money(r.profit)}</b></div>`).join("")}</div>
    <div class="grid g2">
      <div class="card table-wrap"><h3>📋 Detalle</h3><table><thead><tr><th>Categoría</th><th class="right">Unid.</th><th class="right">Ventas</th><th class="right">Margen</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r.cat)}</td><td class="right">${r.qty}</td><td class="right">${money(r.sales)}</td><td class="right">${Math.round(r.margin * 100)}%</td></tr>`).join("")}</tbody></table></div>
      <div class="card"><h3>⭐ Productos estrella</h3>${topProducts.map((t, i) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>${i + 1}. ${esc(t.n)}</span><b>${money(t.p)}</b></div>`).join("")}</div>
    </div>
    <p class="small muted">Se calcula con el precio de venta y el costo c/u cargados en cada pedido.</p></div>`
    : `<div class="empty card"><div class="big">🏆</div><p>Cuando cargues pedidos con costo y categoría vas a ver qué te conviene vender más.</p></div>`;
}

// ---------- gráficos ----------
function graficos(el) {
  const orders = db.all("orders");
  const mk = monthKey(today());
  const months = Array.from({ length: 12 }, (_, i) => addMonth(mk, i - 11));
  const data = months.map((k) => { const l = orders.filter((o) => monthOf(o) === k); return { k, n: l.length, v: l.reduce((a, o) => a + orderTotal(o), 0) }; });
  const max = Math.max(1, ...data.map((d) => d.v));
  const peak = [...data].sort((a, b) => b.v - a.v)[0];
  const ch = CHANNELS.map((c) => { const l = orders.filter((o) => o.channel === c); return { c, n: l.length, v: l.reduce((a, o) => a + orderTotal(o), 0) }; }).filter((x) => x.n).sort((a, b) => b.v - a.v);
  const chMax = Math.max(1, ...ch.map((x) => x.v));
  const st = STATUSES.map((s) => ({ s, n: orders.filter((o) => statusKey(o.status) === s.key).length }));
  el.innerHTML = `<div class="stack">
    <div class="card"><div class="card-head"><h3>📊 Ventas por mes (últimos 12)</h3>${peak?.v ? `<span class="chip accent">Pico: ${mLabel(peak.k)}</span>` : ""}</div>
      <div class="bars">${data.map((d) => `<div class="bar"><span class="b" style="height:${(d.v / max) * 100}%" data-v="${money(d.v)} · ${d.n} pedidos"></span><small>${MONTHS[Number(d.k.slice(5)) - 1].slice(0, 3)}</small></div>`).join("")}</div></div>
    <div class="grid g2">
      <div class="card"><h3>📣 ¿Qué canal te rinde más?</h3>${ch.length ? ch.map((x) => `<div class="hbar"><span>${esc(x.c)}</span><div class="track"><span style="width:${(x.v / chMax) * 100}%"></span></div><b class="nowrap">${money(x.v)} <span class="muted small">(${x.n})</span></b></div>`).join("") : `<p class="muted">Cargá el canal de venta en tus pedidos.</p>`}</div>
      <div class="card"><h3>🧩 Pedidos por estado</h3>${st.map((x) => `<div class="hbar"><span>${x.s.label}</span><div class="track"><span style="width:${(x.n / Math.max(1, orders.length)) * 100}%;background:var(--accent)"></span></div><b>${x.n}</b></div>`).join("")}</div>
    </div></div>`;
}

// ---------- exportar / respaldo ----------
function xmlCell(v) {
  if (typeof v === "number") return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
  return `<Cell><Data ss:Type="String">${String(v ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</Data></Cell>`;
}
function sheet(name, header, rows) {
  return `<Worksheet ss:Name="${name}"><Table><Row ss:StyleID="h">${header.map(xmlCell).join("")}</Row>${rows.map((r) => `<Row>${r.map(xmlCell).join("")}</Row>`).join("")}</Table></Worksheet>`;
}
export function exportExcel() {
  const sups = Object.fromEntries(db.all("suppliers").map((s) => [s.id, s.name]));
  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="h"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#7C3AED" ss:Pattern="Solid"/></Style></Styles>
${sheet("Pedidos", ["N°", "Cliente", "Teléfono", "DNI", "Dirección", "Productos", "Total", "Seña", "Saldo", "100% pago", "Costo", "Ganancia", "Estado", "Evento", "Entrega", "Canal", "Envío", "Transporte proveedor", "Notas"],
  db.all("orders").map((o) => [o.number || "", o.client?.name, o.client?.phone, o.client?.dni, o.client?.address, itemsText(o), orderTotal(o), Number(o.deposit) || 0, orderBalance(o), o.paidFull ? "Sí" : "No", orderCost(o), orderTotal(o) - orderCost(o), statusOf(o.status).label, o.eventDate || "", o.deadline || "", o.channel || "", o.shipping || "", o.courier || "", o.notes || ""]))}
${sheet("Clientes", ["Nombre", "Teléfono", "DNI", "Dirección", "Instagram", "Pedidos", "Compró", "Saldo", "Notas"],
  clientsWithStats().map((c) => [c.name, c.phone, c.dni, c.address, c.instagram, c.orders.length, c.spent, c.balance, c.notes]))}
${sheet("Proveedores", ["Nombre", "Contacto", "Provincia", "Teléfono", "CBU/Alias", "Redes", "Web", "Demora (días)", "Envío", "Matriz", "Calificación", "Notas"],
  db.all("suppliers").map((s) => [s.name, s.contact, s.province, s.phone, s.alias, s.social, s.website, Number(s.leadDays) || 0, Number(s.shippingCost) || 0, Number(s.matrixCost) || 0, Number(s.rating) || 0, s.notes]))}
${sheet("Productos", ["Producto", "Categoría", "Proveedor", "Precio", "Mínimo", "Fecha precio", "Proveedor B", "Precio B"],
  db.all("products").map((p) => [p.name, p.category, sups[p.supplierId] || "", Number(p.price) || 0, p.minQty || "", p.priceDate || "", sups[p.altSupplierId] || "", Number(p.altPrice) || 0]))}
${sheet("Agenda", ["Fecha", "Tarea", "Tipo", "Urgente", "Hecha"], db.all("tasks").map((k) => [k.date, k.title, k.type, k.urgent ? "Sí" : "No", k.done ? "Sí" : "No"]))}
</Workbook>`;
  download(`tradex-${today()}.xls`, xml, "application/vnd.ms-excel");
}

function exporter(el) {
  el.innerHTML = `<div class="grid g3">
    <div class="card stack"><h3>📗 Excel</h3><p class="muted small" style="margin:0">Pedidos, proveedores, productos y agenda en hojas separadas.</p><button class="btn primary" id="x-xls">${icon("download")} Descargar Excel</button></div>
    <div class="card stack"><h3>📄 Reporte PDF</h3><p class="muted small" style="margin:0">Resumen del mes con ventas, cobros y pedidos.</p><button class="btn primary" id="x-pdf">${icon("file")} Generar PDF</button></div>
    <div class="card stack"><h3>💾 Respaldo completo</h3><p class="muted small" style="margin:0">Guardá todo (incluye fotos) para pasarlo a otra compu o celular.</p>
      <button class="btn" id="x-json">${icon("download")} Descargar respaldo</button>
      <label class="btn" style="cursor:pointer">${icon("upload")} Restaurar respaldo<input type="file" id="x-restore" accept="application/json" hidden></label></div>
  </div>`;
  $("#x-xls", el).onclick = exportExcel;
  $("#x-json", el).onclick = () => download(`tradex-respaldo-${today()}.json`, JSON.stringify(db.dump()), "application/json");
  $("#x-restore", el).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!(await confirmBox("Restaurar reemplaza TODOS los datos actuales por los del respaldo.", "Restaurar"))) return;
    try { await db.restore(JSON.parse(await f.text())); toast("✅ Respaldo restaurado"); } catch (err) { toast("Archivo inválido", err.message, { urgent: true }); }
  };
  $("#x-pdf", el).onclick = () => {
    const mk = monthKey(today());
    const list = db.all("orders").filter((o) => monthOf(o) === mk);
    const sales = list.reduce((a, o) => a + orderTotal(o), 0), cost = list.reduce((a, o) => a + orderCost(o), 0), bal = list.reduce((a, o) => a + orderBalance(o), 0);
    printHTML(`Reporte ${mLabel(mk)}`, `
      <div class="head"><div><div class="logo">${esc(settings().businessName)}</div><small>Reporte mensual</small></div><div style="font-size:22px;font-weight:800;text-transform:capitalize">${mLabel(mk)}</div></div>
      <div class="dates"><div><b>Ventas</b><span>${money(sales)}</span></div><div><b>Costos</b><span>${money(cost)}</span></div><div><b>Ganancia neta</b><span>${money(sales - cost)}</span></div><div><b>A cobrar</b><span>${money(bal)}</span></div></div>
      <h2>Pedidos del mes (${list.length})</h2>
      <table><thead><tr><th>Cliente</th><th>Entrega</th><th>Estado</th><th class="r">Total</th><th class="r">Saldo</th></tr></thead><tbody>
      ${list.map((o) => `<tr><td>${esc(o.client?.name)}</td><td>${fmtDate(o.deadline)}</td><td>${statusOf(o.status).label}</td><td class="r">${money(orderTotal(o))}</td><td class="r">${money(orderBalance(o))}</td></tr>`).join("")}</tbody></table>
      <div class="foot">Generado el ${new Date().toLocaleString("es-AR")}</div>`);
  };
}

export { num };
