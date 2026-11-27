// Cotizador: costo + envío por proveedor + costos ocultos + matriz -> precio final con tu ganancia.
import { db, settings } from "../db.js";
import { icon, esc, money, priceFromCost, CATEGORIES } from "../utils.js";
import { $, $$, readForm, options, toast, autocomplete } from "../ui.js";
import { norm } from "../suggest.js";
import { guessCategory } from "../categories.js";
import { today, fmtDate } from "../utils.js";
import { confirmBox } from "../ui.js";
import { productShipping, unitCostFor } from "./products.js";

// Producto rápido (no está en el catálogo): se arma un producto "de mentira" con su proveedor y su envío
const quickProduct = (l, i) => ({ id: "", name: l.quick.name || "Producto rápido", price: (Number(l.quick.price) || 0) / (l.quick.mode === "pack" ? Number(l.quick.packQty) || 1 : 1), supplierId: `quick:${norm(l.quick.supplier) || i}`, supplierName: l.quick.supplier || "Proveedor", shipping: Number(l.quick.ship) || 0 });
const supName = (sid, rows) => db.get("suppliers", sid)?.name || rows.find((r) => r.p.supplierId === sid)?.p.supplierName || "";
import { openOrderForm } from "./orders.js";

const state: Rec = { lines: [{ productId: "", qty: 1 }], hidden: null, matrix: {}, manualMarkup: "", name: "", hq: "", shipOver: {} };

// Suma un producto elegido en "Productos" a la cotización (reemplaza el renglón vacío si lo hay)
export function addToQuote(productId, qty = 1) {
  state.lines = state.lines.filter((l) => l.productId);
  const prev = state.lines.find((l) => l.productId === productId);
  if (prev) prev.qty = Number(qty) || prev.qty; else state.lines.push({ productId, qty: Number(qty) || 1 });
}

export function computeQuote(lines, { hiddenKeys, matrix = {}, manualMarkup, shipOver = {} }: Rec = {}) {
  const s = settings();
  hiddenKeys ??= s.hidden.filter((h) => h.on).map((h) => h.key);
  const rows = lines.map((l, i) => ({ ...l, p: l.quick ? quickProduct(l, i) : db.get("products", l.productId) })).filter((l) => l.p && l.qty > 0 && (!l.quick || l.p.price));
  const goods = rows.reduce((a, l) => a + unitCostFor(l.p, l.qty) * l.qty, 0);
  const qty = rows.reduce((a, l) => a + Number(l.qty), 0);
  // un envío por proveedor (el mayor de sus productos)
  const shipBySup: Rec = {};
  rows.forEach((l) => { const k = l.p.supplierId || "_"; shipBySup[k] = Math.max(shipBySup[k] || 0, productShipping(l.p)); });
  // si ella escribió cuánto le cobraron de envío, manda eso
  Object.keys(shipBySup).forEach((k) => { if (shipOver[k] !== "" && shipOver[k] != null) shipBySup[k] = Number(shipOver[k]) || 0; });
  const ship = Object.values(shipBySup).reduce((a, b) => a + b, 0);
  const hiddenItems = s.hidden.filter((h) => hiddenKeys.includes(h.key)).map((h) => ({ ...h, total: Number(h.cost) || 0 })); // uno por pedido
  const hidden = hiddenItems.reduce((a, h) => a + h.total, 0);
  const matrixTotal = Object.entries(matrix).filter(([, on]) => on).reduce((a, [sid]) => a + Number(db.get("suppliers", sid)?.matrixCost || 0), 0);
  const base = goods + ship + hidden + matrixTotal;
  const r = manualMarkup !== "" && manualMarkup != null
    ? { base, pct: Number(manualMarkup), profit: base * Number(manualMarkup) / 100, price: base * (1 + Number(manualMarkup) / 100) }
    : priceFromCost(base);
  return { rows, goods, qty, ship, shipBySup, supName: (sid) => supName(sid, rows), hiddenItems, hidden, matrixTotal, ...r };
}

export function render(el) {
  const s = settings();
  state.hidden ??= s.hidden.filter((h) => h.on).map((h) => h.key);
  const products = db.all("products").sort((a, b) => a.name.localeCompare(b.name));
  const supsInQuote = () => [...new Set(state.lines.map((l) => db.get("products", l.productId)?.supplierId).filter(Boolean))].map((id) => db.get("suppliers", id));

  const draw = () => {
    const q = computeQuote(state.lines, { hiddenKeys: state.hidden, matrix: state.matrix, manualMarkup: state.manualMarkup, shipOver: state.shipOver });
    $("#q-lines", el).innerHTML = state.lines.map((l, i) => {
      if (l.quick) { const qk = l.quick, pack = qk.mode === "pack";
        return `<div class="quick-line"><div class="small"><b>⚡ Producto nuevo</b> <span class="muted">(completalo y guardalo en el catálogo)</span></div>
        <div class="row" style="flex-wrap:wrap;gap:6px">
          <input data-q="${i}" data-k="name" value="${esc(qk.name)}" placeholder="Producto" class="grow" style="min-width:160px">
          <select data-q="${i}" data-k="mode" style="width:auto">${options([["unit", "Precio por unidad"], ["pack", "Precio por cantidad"]], qk.mode || "unit", null)}</select>
          <input type="number" min="0" data-q="${i}" data-k="price" value="${esc(String(qk.price))}" placeholder="${pack ? "Precio total" : "Precio c/u"}" style="width:120px">
          ${pack ? `<input type="number" min="1" data-q="${i}" data-k="packQty" value="${esc(String(qk.packQty || ""))}" placeholder="Por cuántas u." style="width:120px">` : ""}
        </div>
        <div class="row" style="flex-wrap:wrap;gap:6px">
          <input data-q="${i}" data-k="supplier" value="${esc(qk.supplier)}" placeholder="Proveedor" list="q-sups" style="width:170px">
          <input data-q="${i}" data-k="phone" value="${esc(qk.phone || "")}" placeholder="Teléfono del proveedor" style="width:170px">
          <input type="number" min="0" data-q="${i}" data-k="ship" value="${esc(String(qk.ship))}" placeholder="Envío" title="Envío de ese proveedor" style="width:110px">
          <input type="number" min="1" data-l="${i}" data-k="qty" value="${l.qty}" style="width:80px" title="Cantidad a cotizar">
          <button class="btn ghost icon danger" data-rm="${i}">${icon("x")}</button></div>
        ${pack && qk.price && qk.packQty ? `<div class="small muted">= ${money(qk.price / qk.packQty)} c/u</div>` : ""}
        <div><button class="btn sm primary" data-save-q="${i}">💾 Guardar en el catálogo</button></div></div>`; }
      const p = db.get("products", l.productId);
      return `<div class="row" style="flex-wrap:nowrap">
        <div class="grow" style="position:relative"><input data-search="${i}" value="${esc(p?.name || "")}" placeholder="Escribí el producto… (ej: mochila, vaso, valijita)" autocomplete="off"></div>
        <input type="number" min="1" data-l="${i}" data-k="qty" value="${l.qty}" style="width:90px" title="Cantidad">
        <button class="btn ghost icon danger" data-rm="${i}">${icon("x")}</button></div>
        ${p ? `<div class="small muted">🏭 ${esc(db.get("suppliers", p.supplierId)?.name || "s/proveedor")} · ${money(unitCostFor(p, l.qty))} c/u · envío ${money(productShipping(p))}</div>` : ""}
        ${p?.minQty && l.qty < p.minQty ? `<div class="small" style="color:var(--warn)">⚠️ El mínimo de compra es x${p.minQty}</div>` : ""}`;
    }).join("");
    const sups = supsInQuote();
    $("#q-matrix", el).innerHTML = sups.filter((x) => x?.matrixCost).map((x) => `<label class="check"><input type="checkbox" data-mx="${x.id}" ${state.matrix[x.id] ? "checked" : ""}> Matriz de ${esc(x.name)} (${money(x.matrixCost)}) ${x.matrixNote ? `<span class="muted small">· ${esc(x.matrixNote)}</span>` : ""}</label>`).join("") || `<span class="muted small">Ningún proveedor de esta cotización cobra matriz.</span>`;
    $("#q-result", el).innerHTML = q.rows.length ? `
      <div class="price-line"><span>Productos (${q.qty} u.)</span><b>${money(q.goods)}</b></div>
      ${Object.entries(q.shipBySup).map(([sid, v]) => `<div class="price-line"><span>🚚 Envío ${esc(q.supName(sid))}</span><input type="number" min="0" class="q-ship" data-ship="${esc(sid)}" value="${Math.round(v)}" title="Escribí lo que te cobra de envío" style="width:120px;text-align:right"></div>`).join("")}
      ${Object.keys(q.shipBySup).length > 1 ? `<div class="small muted">Son ${Object.keys(q.shipBySup).length} proveedores: se suman los ${Object.keys(q.shipBySup).length} envíos (${money(q.ship)}).</div>` : ""}
      ${q.hiddenItems.map((h) => `<div class="price-line"><span>${esc(h.name)}</span><b>${money(h.total)}</b></div>`).join("")}
      ${q.matrixTotal ? `<div class="price-line"><span>Matriz / plancha</span><b>${money(q.matrixTotal)}</b></div>` : ""}
      <div class="price-line" style="border-top:1px solid var(--border);padding-top:6px"><span>Subtotal con envío (tu costo)</span><b>${money(q.base)}</b></div>
      <div class="price-line"><span>Tu ganancia (${q.pct}%)${q.pct === s.markupHigh && state.manualMarkup === "" ? ` <span class="chip warn">superó ${money(s.markupThreshold)}</span>` : ""}</span><b>${money(q.profit)}</b></div>
      <div class="price-line total"><span>💡 Precio sugerido al cliente</span><span>${money(q.price)}</span></div>
      <div class="price-line"><span>Precio sugerido por unidad</span><b>${money(q.price / (q.qty || 1))}</b></div>
      <div class="row" style="margin-top:10px;gap:6px">
        <input id="q-name" class="grow" value="${esc(state.name)}" placeholder="¿Para quién es? (ej: Sofía, cumple 15)">
        <button class="btn" id="q-save">💾 Guardar cotización</button>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="q-order">${icon("bag")} Crear pedido con esto</button>
        <a class="btn" href="#/finanzas?tab=cuotas&monto=${Math.round(q.price)}">${icon("card")} Ver en cuotas</a>
      </div>` : `<p class="muted">Agregá productos para calcular.</p>`;
    $$("[data-ship]", el).forEach((inp) => (inp.onchange = () => { state.shipOver[inp.dataset.ship] = inp.value; draw(); }));
    $("#q-name", el) && ($("#q-name", el).oninput = (e) => (state.name = e.target.value));
    $("#q-save", el) && ($("#q-save", el).onclick = async () => {
      // se guarda una foto de la cotización: así queda aunque después cambien los precios
      await db.put("quotes", {
        name: state.name.trim() || "Sin nombre", date: today(),
        lines: q.rows.map((l) => ({ productId: l.p.id || "", quick: l.quick || null, name: l.p.name, supplier: q.supName(l.p.supplierId), qty: Number(l.qty), unit: unitCostFor(l.p, l.qty) })),
        shipBySup: Object.fromEntries(Object.entries(q.shipBySup).map(([sid, v]) => [q.supName(sid) || "Proveedor", v])),
        goods: q.goods, ship: q.ship, hidden: q.hidden + q.matrixTotal, base: q.base, pct: q.pct, profit: q.profit, price: q.price, qty: q.qty,
        hiddenKeys: state.hidden, manualMarkup: state.manualMarkup,
      });
      toast("💾 Cotización guardada", `${state.name || "Sin nombre"} · ${money(q.price)}`);
      drawHistory();
    });
    $("#q-order", el) && ($("#q-order", el).onclick = () => openOrderForm({
      status: "senado", client: {}, extraCost: Math.round(q.ship + q.matrixTotal), total: Math.round(q.price),
      items: q.rows.map((l) => ({ product: l.p.name, productId: l.p.id || "", category: l.p.category, qty: Number(l.qty), unitCost: Math.round(unitCostFor(l.p, l.qty)), unitPrice: Math.round(q.price / q.qty) })),
      supplierId: db.get("suppliers", q.rows[0]?.p.supplierId) ? q.rows[0].p.supplierId : "",
    }));
    bind();
  };
  const bind = () => {
    $$("[data-l]", el).forEach((inp) => (inp.onchange = () => { state.lines[inp.dataset.l][inp.dataset.k] = inp.dataset.k === "qty" ? Number(inp.value) : inp.value; if (inp.dataset.k === "productId") { const p = db.get("products", inp.value); if (p?.minQty && state.lines[inp.dataset.l].qty < p.minQty) state.lines[inp.dataset.l].qty = Number(p.minQty); } draw(); }));
    $$("[data-search]", el).forEach((inp) => autocomplete(inp, (x) => products.filter((p) => norm(`${p.name} ${p.category} ${db.get("suppliers", p.supplierId)?.name || ""}`).includes(norm(x)))
      .sort((a, b) => a.price - b.price).map((p) => ({ icon: "📦", label: p.name, sub: `${money(p.price)} · ${db.get("suppliers", p.supplierId)?.name || "s/proveedor"}`, id: p.id })), {
      onPick: (it) => { const l = state.lines[inp.dataset.search]; l.productId = it.id; const p = db.get("products", it.id); if (p?.minQty && l.qty < p.minQty) l.qty = Number(p.minQty); draw(); },
    }));
    $$("[data-q]", el).forEach((inp) => (inp.onchange = () => {
      const l = state.lines[inp.dataset.q]; l.quick[inp.dataset.k] = inp.value;
      // al escribir un proveedor conocido se completa su envío
      if (inp.dataset.k === "supplier") {
        const sp = db.all("suppliers").find((x) => norm(x.name) === norm(inp.value));
        if (l.quick.ship === "") l.quick.ship = sp?.shippingCost !== "" && sp?.shippingCost != null ? sp.shippingCost : settings().shipSmall;
        if (sp?.phone && !l.quick.phone) l.quick.phone = sp.phone;
      }
      // se redibuja después de que el cursor pasó al campo siguiente, y se lo deja ahí
      setTimeout(() => { const f = document.activeElement as HTMLElement, key = f?.dataset?.q != null ? `[data-q="${f.dataset.q}"][data-k="${f.dataset.k}"]` : f?.dataset?.l != null ? `[data-l="${f.dataset.l}"][data-k="${f.dataset.k}"]` : ""; draw(); if (key) $(key, el)?.focus(); }, 0);
    }));
    $$("[data-save-q]", el).forEach((b) => (b.onclick = async () => {
      const l = state.lines[b.dataset.saveQ], qk = l.quick;
      const pack = qk.mode === "pack" && Number(qk.packQty) > 0;
      if (!qk.name?.trim() || !Number(qk.price) || !qk.supplier?.trim()) return toast("Faltan datos", "Completá producto, precio y proveedor.");
      if (qk.mode === "pack" && !pack) return toast("Faltan datos", "Poné por cuántas unidades es ese precio.");
      // el proveedor: si ya existe se usa (y se completa el teléfono y el envío que le falten); si no, se crea
      let sup = db.all("suppliers").find((x) => norm(x.name) === norm(qk.supplier));
      const ship = qk.ship === "" ? "" : Number(qk.ship);
      if (!sup) sup = await db.put("suppliers", { name: qk.supplier.trim(), phone: qk.phone || "", shippingCost: ship, rating: 0, leadDays: 14, contact: "", province: "", alias: "", social: "", website: "", minimum: "", matrixCost: "", matrixNote: "", notes: "" });
      else if ((!sup.phone && qk.phone) || (sup.shippingCost === "" && ship !== "")) sup = await db.put("suppliers", { ...sup, phone: sup.phone || qk.phone || "", shippingCost: sup.shippingCost === "" ? ship : sup.shippingCost });
      const unit = Number(qk.price) / (pack ? Number(qk.packQty) : 1);
      const p = await db.put("products", { name: qk.name.trim(), category: guessCategory(qk.name), supplierId: sup.id, size: "small", price: unit, priceDate: today(), priceHistory: [{ date: today(), price: unit }],
        ...(pack ? { priceMode: "pack", packPrice: Number(qk.price), packQty: Number(qk.packQty), minQty: Number(qk.packQty) } : { priceMode: "unit", minQty: "" }), notes: "" });
      state.lines[b.dataset.saveQ] = { productId: p.id, qty: l.qty };
      toast("💾 Guardado en el catálogo", `${p.name} · ${sup.name}`);
      draw();
    }));
    $$("[data-rm]", el).forEach((b) => (b.onclick = () => { state.lines.splice(b.dataset.rm, 1); if (!state.lines.length) state.lines.push({ productId: "", qty: 1 }); draw(); }));
    $$("[data-mx]", el).forEach((c) => (c.onchange = () => { state.matrix[c.dataset.mx] = c.checked; draw(); }));
  };

  el.innerHTML = `<div class="grid g2" style="align-items:start">
    <div class="stack">
      <div class="card"><h3>🧮 Productos a cotizar</h3>
        <div class="stack" id="q-lines"></div>
        <datalist id="q-sups">${db.all("suppliers").map((x) => `<option value="${esc(x.name)}">`).join("")}</datalist>
        <div class="row" style="margin-top:10px;gap:6px"><button class="btn soft sm" id="q-add">${icon("plus")} Agregar producto</button><button class="btn sm" id="q-quick">⚡ Producto nuevo</button></div>
        ${!products.length ? `<p class="small muted">Primero cargá productos en el catálogo.</p>` : ""}
      </div>
      <div class="card"><h3>🎁 Packaging (uno por pedido)</h3>
        <div class="stack">${s.hidden.map((h) => `<label class="check"><input type="checkbox" data-h="${h.key}" ${state.hidden.includes(h.key) ? "checked" : ""}> ${esc(h.name)} · ${money(h.cost)}</label>`).join("")}</div>
        <p class="small muted">Montos editables en Ajustes.</p>
      </div>
      <div class="card"><h3>🖨️ Matrices / planchas</h3><div class="stack" id="q-matrix"></div></div>
      <div class="card"><h3>📈 Ganancia</h3>
        <p class="small muted" style="margin-top:0">Regla automática: ${s.markup}% de ganancia; si la ganancia supera ${money(s.markupThreshold)} pasa a ${s.markupHigh}%.</p>
        <div class="row" style="gap:6px;margin-bottom:8px">${[["", "Automático"], ["60", "60%"], ["50", "50%"]].map(([v, l]) => `<button class="btn sm ${String(state.manualMarkup) === v ? "primary" : "ghost"}" data-mk="${v}">${l}</button>`).join("")}</div>
        <label class="field">Otro % (opcional)<input type="number" id="q-mk" min="0" value="${state.manualMarkup}" placeholder="Automático"></label>
      </div>
    </div>
    <div class="card" style="position:sticky;top:90px"><h3>💜 Resultado</h3><div class="price-box" id="q-result"></div></div>
  </div>
  <div class="card" style="margin-top:18px"><div class="card-head"><h3>📚 Historial de cotizaciones</h3><span class="small muted">${db.all("quotes").length} guardadas</span></div>
    <div class="search" style="margin-bottom:10px">${icon("search")}<input type="search" id="q-hsearch" value="${esc(state.hq)}" placeholder="Buscar por cliente, producto, proveedor o fecha (ej: Sofía, mochila, 16/11)…"></div>
    <div class="stack" id="q-hist"></div></div>`;
  // Historial: buscá por cliente, producto, proveedor o fecha
  const drawHistory = () => {
    const words = norm(state.hq).split(/\s+/).filter(Boolean);
    const list = db.all("quotes").sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .filter((h) => { const hay = norm(`${h.name} ${fmtDate(h.date)} ${h.date} ${(h.lines || []).map((l) => `${l.name} ${l.supplier}`).join(" ")}`); return words.every((w) => hay.includes(w)); });
    $("#q-hist", el).innerHTML = list.length ? list.slice(0, 60).map((h) => `<div class="q-hist-item">
      <div class="grow"><b>${esc(h.name)}</b> <span class="small muted">· ${fmtDate(h.date)}</span>
        <div class="small">${(h.lines || []).map((l) => `${esc(l.name)} x${l.qty} <span class="muted">(${esc(l.supplier || "")}, ${money(l.unit)} c/u)</span>`).join(" · ")}</div>
        <div class="small muted">Costo ${money(h.base)} · ganancia ${h.pct}% ${money(h.profit)}</div></div>
      <div class="right"><b>${money(h.price)}</b><div class="small muted">${money(h.price / (h.qty || 1))} c/u</div>
        <div class="row" style="gap:4px;justify-content:flex-end;margin-top:4px"><button class="btn sm soft" data-hopen="${h.id}">Abrir</button><button class="btn sm ghost icon danger" data-hdel="${h.id}" title="Borrar">${icon("x")}</button></div></div>
    </div>`).join("") : `<p class="muted small">${state.hq ? "No encontré cotizaciones con eso." : "Todavía no guardaste cotizaciones."}</p>`;
    $$("[data-hopen]", el).forEach((b) => (b.onclick = () => {
      const h = db.get("quotes", b.dataset.hopen); if (!h) return;
      // vuelve a armar la cotización con los precios de hoy (o los del producto rápido)
      state.lines = h.lines.map((l) => (l.productId && db.get("products", l.productId) ? { productId: l.productId, qty: l.qty } : { quick: l.quick || { name: l.name, price: l.unit, supplier: l.supplier, phone: "", ship: "", mode: "unit", packQty: "" }, qty: l.qty }));
      state.hidden = h.hiddenKeys || state.hidden; state.manualMarkup = h.manualMarkup ?? ""; state.name = h.name; state.shipOver = {};
      render(el); window.scrollTo({ top: 0, behavior: "smooth" }); toast("Cotización abierta", "Se recalcula con los precios de hoy.");
    }));
    $$("[data-hdel]", el).forEach((b) => (b.onclick = async () => { if (await confirmBox("¿Borrar esta cotización del historial?", "Borrar")) { await db.remove("quotes", b.dataset.hdel); drawHistory(); } }));
  };
  $("#q-hsearch", el).oninput = (e) => { state.hq = e.target.value; drawHistory(); };
  drawHistory();
  $("#q-add", el).onclick = () => { state.lines.push({ productId: "", qty: 1 }); draw(); };
  $("#q-quick", el).onclick = () => { state.lines = state.lines.filter((l) => l.productId || l.quick); state.lines.push({ quick: { name: "", price: "", supplier: "", phone: "", ship: "", mode: "unit", packQty: "" }, qty: 1 }); draw(); $$("[data-q][data-k=name]", el).pop()?.focus(); };
  $$("[data-h]", el).forEach((c) => (c.onchange = () => { state.hidden = $$("[data-h]", el).filter((x) => x.checked).map((x) => x.dataset.h); draw(); }));
  $("#q-mk", el).oninput = (e) => { state.manualMarkup = e.target.value; draw(); };
  $$("[data-mk]", el).forEach((b) => (b.onclick = () => { state.manualMarkup = b.dataset.mk; render(el); }));
  draw();
  return { title: "Cotizador", sub: "Precio de venta con envío, empaque y ganancia" };
}

export { CATEGORIES, readForm, toast };
