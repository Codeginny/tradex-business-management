// 📊 Estadísticas: 6 gráficos para planear los próximos pedidos, comparando los últimos 3 meses,
// y una lista de consejos para el mes que viene. Un pedido cuenta en el mes de su entrega (igual que Finanzas).
import { db } from "../db.js";
import { esc, money, today, monthKey, MONTHS, orderTotal, orderCost, orderQty } from "../utils.js";
import { $$ } from "../ui.js";
import { itemSupplierId } from "../alerts.js";

const state = { month: "" };
export const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// ---------- meses ----------
const lower = (s) => s.toLowerCase();
export const shiftMonth = (mk, n) => { const [y, m] = mk.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
export const mName = (mk) => MONTHS[Number(mk.slice(5, 7)) - 1].replace(/^./, (c) => c.toUpperCase());
const mShort = (mk) => mName(mk).slice(0, 3);
const monthOf = (o) => monthKey(o.deadline || o.eventDate || o.createdAt?.slice(0, 10));
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
const shortMoney = (n) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1).replace(".", ",")} M` : Math.abs(n) >= 1e3 ? `$${Math.round(n / 1e3)} mil` : money(n));

// números de un mes
export function monthStats(mk) {
  const orders = db.all("orders").filter((o) => !o.archived && monthOf(o) === mk);
  const withCost = orders.filter((o) => orderCost(o));
  const sales = orders.reduce((a, o) => a + orderTotal(o), 0);
  const profit = withCost.reduce((a, o) => a + orderTotal(o) - orderCost(o), 0);
  const salesWithCost = withCost.reduce((a, o) => a + orderTotal(o), 0);
  const earned = new Map(), provs = new Map(), cats = new Map(), sups = new Map(), dows = Array(7).fill(0);
  for (const o of orders) {
    const prov = o.client?.province || "Sin provincia";
    provs.set(prov, (provs.get(prov) || 0) + 1);
    // ganancia del pedido (venta − costos, incluidos envío y packaging) repartida entre sus productos según lo que se cobró de cada uno
    const its = o.items || [];
    if (orderCost(o)) {
      const w = its.map((i) => (Number(i.qty) || 0) * (Number(i.unitPrice) || Number(i.unitCost) || 1));
      const wsum = w.reduce((a, b) => a + b, 0) || 1;
      const gain = orderTotal(o) - orderCost(o);
      its.forEach((i, n) => { const k = (i.productId && db.get("products", i.productId)?.name) || i.product || "Sin nombre"; earned.set(k, (earned.get(k) || 0) + (gain * w[n]) / wsum); });
    }
    const day = o.eventDate || o.deadline;
    if (day) dows[(new Date(day + "T12:00").getDay() + 6) % 7]++;
    for (const i of o.items || []) {
      const qty = Number(i.qty) || 0;
      const p = i.productId && db.get("products", i.productId);
      const cat = i.category || p?.category || "Sin categoría";
      cats.set(cat, (cats.get(cat) || 0) + qty * (Number(i.unitPrice) || 0));
      const sup = db.get("suppliers", itemSupplierId(i, o))?.name || "Sin proveedor";
      const cost = qty * (Number(i.unitCost) || 0);
      if (cost) sups.set(sup, (sups.get(sup) || 0) + cost);
    }
  }
  return {
    mk, orders, sales, profit, count: orders.length, units: orders.reduce((a, o) => a + orderQty(o), 0),
    ticket: orders.filter((o) => !o.gift).length ? sales / orders.filter((o) => !o.gift).length : 0,
    gifts: orders.filter((o) => o.gift).reduce((a, o) => a + orderCost(o), 0), margin: salesWithCost ? Math.round((profit / salesWithCost) * 100) : null,
    noCost: orders.length - withCost.length, earned, provs, cats, sups, dows,
    lowMargin: withCost.filter((o) => !o.gift && (orderTotal(o) - orderCost(o)) / (orderTotal(o) || 1) < 0.25),
  };
}

// ---------- gráficos (SVG / HTML livianos, con tooltip al pasar el mouse) ----------
const tip = (t) => `data-tip="${esc(t)}"`;
const roundTop = (x, y, w, h, r) => { r = Math.min(r, w / 2, h); return h <= 0 ? "" : `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; };

// Barras verticales agrupadas: grupos (meses o días) × series
export function vbars({ groups, series, fmt = money, labelFmt = shortMoney, height = 210 }) {
  const W = 400, H = height, padL = 8, padB = 26, padT = 22;
  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  const gw = (W - padL * 2) / groups.length;
  const inner = gw * 0.62, bw = Math.min(46, (inner - (series.length - 1) * 2) / series.length);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const grid = [0.5, 1].map((f) => `<line x1="0" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" class="viz-grid"/>`).join("");
  const bars = groups.map((g, gi) => {
    const x0 = padL + gi * gw + (gw - (bw * series.length + 2 * (series.length - 1))) / 2;
    return g.values.map((v, si) => {
      const x = x0 + si * (bw + 2), top = y(Math.max(0, v));
      return `<g ${tip(`${g.label}${series.length > 1 ? ` · ${series[si]}` : ""}: ${fmt(v)}`)}><rect x="${x - 3}" y="${padT}" width="${bw + 6}" height="${H - padT - padB}" fill="transparent"/>
        <path d="${roundTop(x, top, bw, H - padB - top, 4)}" fill="var(--s${si + 1})"/>
        ${v ? `<text x="${x + bw / 2}" y="${top - 6}" text-anchor="middle" class="viz-val">${esc(labelFmt(v))}</text>` : ""}</g>`;
    }).join("") + `<text x="${padL + gi * gw + gw / 2}" y="${H - 8}" text-anchor="middle" class="viz-axis">${esc(g.label)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img">${grid}<line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" class="viz-base"/>${bars}</svg>
    ${series.length > 1 ? `<div class="viz-legend">${series.map((s, i) => `<span><i style="background:var(--s${i + 1})"></i>${esc(s)}</span>`).join("")}</div>` : ""}`;
}

// Barras horizontales (ranking)
export function hbars(entries, fmt) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return `<div class="viz-hbars">${entries.map(([k, v]) => `<div class="hb-row" ${tip(`${k}: ${fmt(v)}`)}>
    <span class="hb-label" title="${esc(k)}">${esc(k)}</span>
    <span class="hb-track"><span class="hb-bar" style="width:${Math.max(2, (v / max) * 100)}%"></span></span>
    <span class="hb-val">${esc(fmt(v))}</span></div>`).join("")}</div>`;
}

// Dona: hasta 5 porciones + "Otros"
export function donut(map, fmt, { center = shortMoney, centerLabel = "total", clickable = false }: Rec = {}) {
  const key = (k) => (clickable && k !== "Otros" ? ` data-dkey="${esc(k)}" style="cursor:pointer"` : "");
  let entries = [...map].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (entries.length > 5) entries = [...entries.slice(0, 4), ["Otros", entries.slice(4).reduce((a, [, v]) => a + v, 0)]];
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const R = 70, r = 44, cx = 80, cy = 80;
  let ang = -Math.PI / 2;
  const pt = (a, rad) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
  const color = (k, i) => (k === "Otros" ? "var(--s-other)" : `var(--s${i + 1})`);
  const arcs = entries.map(([k, v], i) => {
    const a2 = ang + (v / total) * Math.PI * 2 - (entries.length > 1 ? 0.0001 : 0.0002);
    const large = a2 - ang > Math.PI ? 1 : 0;
    const d = entries.length === 1
      ? `M${pt(-Math.PI / 2, R)}A${R},${R} 0 1 1 ${pt(Math.PI * 1.5 - 0.0002, R)}L${pt(Math.PI * 1.5 - 0.0002, r)}A${r},${r} 0 1 0 ${pt(-Math.PI / 2, r)}Z`
      : `M${pt(ang, R)}A${R},${R} 0 ${large} 1 ${pt(a2, R)}L${pt(a2, r)}A${r},${r} 0 ${large} 0 ${pt(ang, r)}Z`;
    ang = a2;
    return `<path d="${d}" fill="${color(k, i)}" class="viz-slice"${key(k)} ${tip(`${k}: ${fmt(v)} (${Math.round((v / total) * 100)}%)`)}/>`;
  }).join("");
  return `<div class="viz-donut"><svg viewBox="0 0 160 160" role="img">${arcs}<text x="80" y="77" text-anchor="middle" class="viz-donut-t">${esc(center(total))}</text><text x="80" y="94" text-anchor="middle" class="viz-axis">${esc(centerLabel)}</text></svg>
    <div class="viz-legend col">${entries.map(([k, v], i) => `<span${key(k)} ${tip(`${k}: ${fmt(v)}`)}><i style="background:${color(k, i)}"></i><b>${esc(k)}</b><em>${Math.round((v / total) * 100)}%</em></span>`).join("")}</div></div>`;
}

export const empty = (txt) => `<div class="viz-empty">${txt}</div>`;
export const card = (title, sub, body) => `<div class="card viz-card"><div class="viz-head"><h3>${title}</h3>${sub ? `<span class="small muted">${sub}</span>` : ""}</div>${body}</div>`;

// ---------- consejos para el mes que viene ----------
function advice(cur, prev, next) {
  const out = [];
  const nextName = lower(mName(next));
  const dv = pct(cur.sales, prev.sales);
  if (dv !== null) out.push(dv >= 0 ? `📈 Vendiste ${dv}% más que en ${lower(mName(prev.mk))}. Repetí lo que funcionó: mismos productos y proveedores.` : `📉 Vendiste ${Math.abs(dv)}% menos que en ${lower(mName(prev.mk))}. Publicá los productos que más ganancia te dejan y ofrecé combos para ${nextName}.`);
  const best = [...cur.earned].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (best.length) out.push(`📣 Hacele más publicidad a ${best.map(([k]) => `“${k}”`).join(" y ")}: ${best.length > 1 ? "son los que más ganancia te dejaron" : "es el que más ganancia te dejó"} (${best.map(([, v]) => money(v)).join(" y ")}). Subí fotos y armá promos para ${nextName}.`);
  const supTotal = [...cur.sups.values()].reduce((a, b) => a + b, 0);
  const mainSup = [...cur.sups].sort((a, b) => b[1] - a[1])[0];
  if (mainSup && supTotal && mainSup[1] / supTotal >= 0.5) out.push(`🤝 ${mainSup[0]} se llevó el ${Math.round((mainSup[1] / supTotal) * 100)}% de tus compras: pedile precio por cantidad o envío gratis.`);
  const weekend = cur.dows[4] + cur.dows[5];
  const dsum = cur.dows.reduce((a, b) => a + b, 0);
  if (dsum && weekend / dsum >= 0.5) out.push(`📅 El ${Math.round((weekend / dsum) * 100)}% de tus entregas cayeron viernes o sábado: comprá al proveedor 3 semanas antes.`);
  if (cur.lowMargin.length) out.push(`⚠️ ${cur.lowMargin.length} pedido${cur.lowMargin.length === 1 ? "" : "s"} dejaron menos de 25% de ganancia. Usá el precio sugerido 💚 del pedido.`);
  if (cur.margin !== null && cur.margin >= 35) out.push(`✅ Tu margen fue ${cur.margin}%: muy bien, mantené los precios.`);
  if (cur.noCost) out.push(`🧾 ${cur.noCost} pedido${cur.noCost === 1 ? "" : "s"} no tienen costo cargado: completalo para que la ganancia sea real.`);
  const nx = monthStats(next);
  if (nx.count) out.push(`🗓️ Para ${nextName} ya tenés ${nx.count} pedido${nx.count === 1 ? "" : "s"} por ${money(nx.sales)}. Revisá la campanita 🔔 para comprar a tiempo.`);
  const SEASON = { "02": "💘 San Valentín (14/2): armá combos para parejas.", "05": "🎓 Llegan pedidos de egresados: pasá presupuestos temprano.", "06": "👨 Día del Padre (3er domingo): preparate desde principio de mes.", "07": "🧒 Día del Niño (agosto): cotizá con tiempo.", "08": "🧒 Día del Niño (3er domingo): reforzá stock.", "09": "🌸 Día de la Madre (octubre): pedí al proveedor este mes.", "10": "🌸 Día de la Madre (3er domingo): es tu fecha fuerte.", "11": "🎄 Fiestas y egresados: los proveedores se demoran, pedí antes.", "12": "🎁 Fin de año: cerrá pedidos antes del 20 y avisá tus vacaciones." };
  if (SEASON[next.slice(5, 7)]) out.push(SEASON[next.slice(5, 7)]);
  if (!cur.count) out.push(`📭 En ${lower(mName(cur.mk))} no hay pedidos cargados todavía.`);
  return out;
}

// ---------- vista ----------
export function render(el) {
  const now = monthKey(today());
  const months = [shiftMonth(now, -2), shiftMonth(now, -1), now];
  if (!months.includes(state.month)) state.month = now;
  const all = months.map(monthStats);
  const cur = all[months.indexOf(state.month)];
  const prev = monthStats(shiftMonth(state.month, -1));
  const next = shiftMonth(state.month, 1);

  const delta = (a, b, fmt = (x) => `${x}%`) => { const d = pct(a, b); return d === null ? "" : `<span class="delta ${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${fmt(Math.abs(d))}</span>`; };
  const row = (label, f, fmt, withDelta = true) => `<tr><td>${label}</td>${all.map((m, i) => `<td class="right nowrap ${m.mk === state.month ? "sel" : ""}">${f(m) === null ? "—" : fmt(f(m))}${withDelta && i ? delta(f(m) || 0, f(all[i - 1]) || 0) : ""}</td>`).join("")}</tr>`;

  const topEarned = [...cur.earned].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  el.innerHTML = `<div class="stack stats-root">
    <div class="row month-tabs">${months.map((m) => `<button class="btn ${m === state.month ? "primary" : ""}" data-month="${m}">${mName(m)}</button>`).join("")}
      <span class="small muted">Cada pedido cuenta en el mes de su entrega.</span></div>

    <div class="card table-wrap"><table class="otable cmp-table" style="min-width:0">
      <thead><tr><th>Comparación</th>${months.map((m) => `<th class="right ${m === state.month ? "sel" : ""}">${mName(m)}</th>`).join("")}</tr></thead>
      <tbody>
        ${row("💰 Ventas", (m) => m.sales, money)}
        ${row("📈 Ganancia", (m) => m.profit, money)}
        ${row("📊 Margen", (m) => m.margin, (v) => `${v}%`, false)}
        ${row("🛍️ Pedidos", (m) => m.count, String)}
        ${row("🎟️ Ticket promedio", (m) => m.ticket, money)}
        ${row("📦 Unidades", (m) => m.units, String)}
        ${all.some((m) => m.gifts) ? row("🎁 Regalos (costo)", (m) => m.gifts, money, false) : ""}
      </tbody></table></div>

    <div class="viz-grid-cards">
      ${card("💰 Ventas y ganancia", "últimos 3 meses", all.some((m) => m.sales) ? vbars({ groups: all.map((m) => ({ label: mName(m.mk), values: [m.sales, m.profit] })), series: ["Ventas", "Ganancia"] }) : empty("Todavía no hay ventas en estos meses."))}
      ${card("🛍️ Cantidad de pedidos", "últimos 3 meses", all.some((m) => m.count) ? vbars({ groups: all.map((m) => ({ label: mName(m.mk), values: [m.count] })), series: ["Pedidos"], fmt: (v) => `${v} pedidos`, labelFmt: String }) : empty("Todavía no hay pedidos en estos meses."))}
      ${card("📣 Productos que más ganancia te dejaron", `${mName(state.month)} · a estos hacele más publicidad`, topEarned.length ? hbars(topEarned, money) : empty(`No hay pedidos con costo cargado en ${lower(mName(state.month))}.`))}
      ${card("🏷️ Ventas por categoría", mName(state.month), cur.cats.size && [...cur.cats.values()].some(Boolean) ? donut(cur.cats, money) : empty(`No hay ventas en ${lower(mName(state.month))}.`))}
      ${card("🤝 Compras por proveedor", `${mName(state.month)} · lo que gastaste`, cur.sups.size ? donut(cur.sups, money) : empty("Cargá el costo de los productos para ver esto."))}
      ${card("📅 Entregas por día de la semana", `${mName(state.month)} · día del evento`, cur.dows.some(Boolean) ? vbars({ groups: DOW.map((d, i) => ({ label: d, values: [cur.dows[i]] })), series: ["Entregas"], fmt: (v) => `${v} entregas`, labelFmt: String, height: 190 }) : empty(`No hay entregas en ${lower(mName(state.month))}.`))}
    </div>

    <div class="card"><div class="viz-head"><h3>💡 Consejos para ${mName(next)}</h3><span class="small muted">según lo que pasó en ${lower(mName(state.month))}</span></div>
      <ol class="tips-list">${advice(cur, prev, next).map((t) => `<li>${t}</li>`).join("")}</ol></div>
  </div>`;

  $$("[data-month]", el).forEach((b) => (b.onclick = () => { state.month = b.dataset.month; render(el); }));
  bindTooltip(el);
  return { title: "Estadísticas", sub: `${mShort(months[0])} · ${mShort(months[1])} · ${mShort(months[2])}` };
}

let tipEl;
export function bindTooltip(el) {
  tipEl ||= Object.assign(document.createElement("div"), { className: "viz-tip" });
  if (!tipEl.isConnected) document.body.append(tipEl);
  tipEl.style.display = "none";
  el.onmousemove = (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) { tipEl.style.display = "none"; return; }
    tipEl.textContent = t.dataset.tip;
    tipEl.style.display = "block";
    const x = Math.min(e.clientX + 14, innerWidth - tipEl.offsetWidth - 8);
    tipEl.style.left = `${x}px`; tipEl.style.top = `${e.clientY + 14}px`;
  };
  el.onmouseleave = () => (tipEl.style.display = "none");
}
