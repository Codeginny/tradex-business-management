// Catálogo de productos por proveedor (con foto, mínimos, envío, historial de precio y alternativos).
import { db, settings, pinHeader } from "../db.js";
import { icon, esc, money, fmtDate, today, CATEGORIES, resizeImage, priceFromCost, hiddenCostsPerUnit } from "../utils.js";
import { $, $$, modal, toast, confirmBox, readForm, options, stars, autocomplete } from "../ui.js";
import { productSuggestions, supplierSuggestions, norm } from "../suggest.js";
import { waLink } from "../utils.js";
import { categories, categoryOptions, guessCategory } from "../categories.js";
import { socialUrl, importCatalog } from "./suppliers.js";
import { combosHTML, openComboForm } from "./combos.js";

const state = { q: "", cat: "", sort: "rec" };

// Envío que suma el producto: el propio, o según tamaño (chico $30.000 / grande $65.000)
export const productShipping = (p) => {
  const s = settings();
  if (p.size === "none") return 0; // misma provincia: no paga envío
  if (p.shipping !== "" && p.shipping != null && !isNaN(p.shipping)) return Number(p.shipping);
  if (p.size === "big") return s.shipBig;
  const sc = db.get("suppliers", p.supplierId)?.shippingCost;
  return sc !== "" && sc != null && !isNaN(sc) ? Number(sc) : s.shipSmall;
};

// Precio por escala: [{min, price}] de menor a mayor cantidad. Devuelve el costo c/u para esa cantidad.
export const tiersOf = (p) => (p?.priceMode === "tiers" && Array.isArray(p.tiers) ? p.tiers : []);
export function unitCostFor(p, qty) {
  const t = tiersOf(p);
  if (!t.length) return Number(p.price) || 0;
  const q = Number(qty) || 0;
  return Number((t.filter((x) => q >= x.min).pop() || t[0]).price);
}
const tiersText = (p) => tiersOf(p).map((t) => `x${t.min}+ ${money(t.price)}`);

// Precio de venta sugerido para una cantidad: (costo x cant + envío + costos ocultos) + ganancia 60% (o 50% si supera $100.000)
export function suggestedPrice(p, qty) {
  qty = Math.max(1, Number(qty) || Number(p.minQty) || 1);
  const goods = unitCostFor(p, qty) * qty;
  const ship = productShipping(p);
  const hidden = hiddenCostsPerUnit(); // packaging: uno por pedido (bolsita, lapicera, tarjetita…)
  const r = priceFromCost(goods + ship + hidden);
  return { qty, goods, ship, hidden, ...r, unit: r.price / qty };
}

export function findProducts({ search = "", sort = "cheapest", limit = 5 } = {}) {
  const words = search.toLowerCase().replace(/s\b/g, "").split(/\s+/).filter((w) => w.length > 2);
  let list = db.all("products").filter((p) => {
    const hay = `${p.name} ${p.category}`.toLowerCase();
    return !words.length || words.some((w) => hay.includes(w));
  });
  list.sort((a, b) => sort === "expensive" ? b.price - a.price : sort === "recent" ? (b.priceDate || "").localeCompare(a.priceDate || "") : a.price - b.price);
  return list.slice(0, limit || 5);
}

export function alternativesOf(p) {
  const key = p.name.toLowerCase().split(/\s+/).slice(0, 2).join(" ");
  return db.all("products").filter((x) => x.id !== p.id && x.supplierId !== p.supplierId && x.name.toLowerCase().includes(key));
}


// Costo real por unidad puesto en tu casa: precio + envío repartido en el mínimo de compra
export const landedUnit = (p) => { const q = Math.max(1, Number(p.minQty) || 1); return (Number(p.price) * q + productShipping(p)) / q; };

// Busca por palabras (sin tildes, "botellas" encuentra "botella"), en nombre, categoría y proveedor
function searchProducts(q, cat) {
  const words = norm(q).split(/\s+/).filter(Boolean).map((w) => (w.length > 4 ? w.replace(/(es|s)$/, "") : w));
  return db.all("products").filter((p) => {
    if (cat && p.category !== cat) return false;
    const hay = norm(`${p.name} ${p.category} ${db.get("suppliers", p.supplierId)?.name || ""}`);
    return words.every((w) => hay.includes(w));
  });
}
// Cuántas veces se pidió cada producto (por su ID, o por el nombre si el renglón se escribió a mano)
export function productStats() {
  const products = db.all("products");
  const byName = (name) => { const n = norm(name); return n && (products.find((p) => norm(p.name) === n) || products.find((p) => norm(p.name).includes(n) || n.includes(norm(p.name)))); };
  const stats = new Map();
  for (const o of db.all("orders")) {
    if (o.archived) continue;
    for (const i of o.items || []) {
      const p = (i.productId && db.get("products", i.productId)) || byName(i.product);
      if (!p) continue;
      const st = stats.get(p.id) || { units: 0, orders: new Set(), last: "", profit: 0 };
      const q = Number(i.qty) || 0;
      st.units += q;
      st.orders.add(o.id);
      const d = o.deadline || o.eventDate || o.createdAt?.slice(0, 10) || "";
      if (d > st.last) st.last = d;
      if (Number(i.unitCost)) st.profit += q * ((Number(i.unitPrice) || 0) - Number(i.unitCost));
      stats.set(p.id, st);
    }
  }
  return stats;
}

const SORTS = [["rec", "⭐ Recomendado (más barato con envío)"], ["top", "🔥 Más pedidos"], ["cheap", "Precio: menor a mayor"], ["exp", "Precio: mayor a menor"], ["date", "Precio más reciente"], ["name", "A–Z"]];
function sortProducts(list, stats) {
  const rating = (p) => Number(db.get("suppliers", p.supplierId)?.rating) || 0;
  const units = (p) => stats.get(p.id)?.units || 0;
  return list.sort((a, b) =>
    state.sort === "cheap" ? a.price - b.price
    : state.sort === "exp" ? b.price - a.price
    : state.sort === "date" ? (b.priceDate || "").localeCompare(a.priceDate || "")
    : state.sort === "name" ? a.name.localeCompare(b.name)
    : state.sort === "top" ? units(b) - units(a) || landedUnit(a) - landedUnit(b)
    // recomendado: el que te sale más barato puesto en tu casa (con envío); a igual costo, el proveedor mejor calificado
    : landedUnit(a) - landedUnit(b) || rating(b) - rating(a));
}

// 🏆 Top 5 de los más pedidos + con qué proveedor conviene comprarlos hoy
function topOrderedHTML(stats) {
  const groups = new Map();
  for (const [id, st] of stats) {
    const p = db.get("products", id);
    if (!p) continue;
    const family = [p, ...alternativesOf(p)];
    const key = family.map((x) => x.id).sort()[0];
    const g = groups.get(key) || { p, family, units: 0, orders: new Set(), last: "", profit: 0 };
    g.units += st.units; st.orders.forEach((x) => g.orders.add(x)); if (st.last > g.last) g.last = st.last; g.profit += st.profit;
    groups.set(key, g);
  }
  const top = [...groups.values()].sort((a, b) => b.units - a.units).slice(0, 5);
  if (!top.length) return `<div class="card small muted">🏆 Cuando cargues pedidos con productos de tu catálogo, acá vas a ver los más pedidos y a qué proveedor te conviene comprarlos.</div>`;
  return `<div class="card table-wrap otable-wrap" style="max-height:none"><div class="card-head" style="padding:12px 14px 0"><h3>🏆 Top 5 más pedidos</h3><span class="small muted">tenelos con precio al día y pedí con tiempo</span></div>
    <table class="otable" style="min-width:860px"><thead><tr><th>#</th><th>Producto</th><th class="right">Unidades vendidas</th><th class="right">Pedidos</th><th>Último pedido</th><th class="right">Ganancia</th><th>Te conviene comprarlo a</th><th></th></tr></thead>
    <tbody>${top.map((g, i) => {
      const bestOpt = [...g.family].sort((a, b) => landedUnit(a) - landedUnit(b))[0];
      const sup = db.get("suppliers", bestOpt.supplierId);
      return `<tr data-p="${bestOpt.id}"><td class="trophy" title="Puesto ${i + 1}">${["🏆", "🥈", "🥉", "🏅", "🎖️"][i]}</td><td><b>${esc(g.p.name)}</b><div class="small muted">${esc(g.p.category || "")}</div></td>
        <td class="right"><b>${g.units}</b></td><td class="right">${g.orders.size}</td><td class="nowrap">${g.last ? fmtDate(g.last, { year: true }) : "—"}</td>
        <td class="right nowrap" style="color:var(--ok)">${g.profit ? money(g.profit) : "—"}</td>
        <td class="nowrap">${sup ? `<b>${esc(sup.name)}</b> ${stars(sup.rating || 0)}` : "—"}<div class="small muted">${money(landedUnit(bestOpt))} c/u con envío${g.family.length > 1 ? ` · ${g.family.length} proveedores` : ""}</div></td>
        <td><button class="btn sm primary" data-pick="${bestOpt.id}">Elegir</button></td></tr>`;
    }).join("")}</tbody></table></div>`;
}

export function render(el) {
  const all = db.all("products");
  const draw = () => {
    const stats = productStats();
    const list = sortProducts(searchProducts(state.q, state.cat), stats);
    const best = list.length > 1 ? [...list].sort((a, b) => landedUnit(a) - landedUnit(b))[0] : null;
    $("#p-count", el).textContent = state.q || state.cat ? `${list.length} resultado${list.length === 1 ? "" : "s"}` : "";
    $("#p-top", el).innerHTML = !state.q && !state.cat && all.length ? topOrderedHTML(stats) : "";
    $("#p-combos", el).innerHTML = !state.q && !state.cat ? combosHTML() : "";
    if (!list.length) {
      $("#p-list", el).innerHTML = `<div class="empty card"><div class="big">📦</div><p>${all.length ? "No encontré productos con esa búsqueda." : "No hay productos. Cargalos a mano, importá un PDF del proveedor o dictáselos a Dex."}</p></div>`;
    } else {
      $("#p-list", el).innerHTML = `<div class="card table-wrap otable-wrap"><table class="otable ptable">
      <thead><tr><th></th><th>Producto</th><th>Proveedor</th><th class="right">Precio c/u</th><th class="right">Mínimo</th><th class="right">Envío</th><th class="right" title="Precio + envío repartido en el mínimo de compra">Costo real c/u</th><th>Precio del</th><th></th></tr></thead>
      <tbody>${list.map((p) => {
        const s = db.get("suppliers", p.supplierId);
        return `<tr data-p="${p.id}" class="${best && best.id === p.id ? "best" : ""}">
          <td><div class="thumb">${p.image ? `<img src="${p.image}" alt="">` : "📦"}</div></td>
          <td><div class="pname-row"><b>${esc(p.name)}</b><button class="btn sm ghost icon dup-btn" data-dup="${p.id}" title="Duplicar (para cargar otra variante: color, tamaño…)">${icon("copy")}</button></div>${best && best.id === p.id ? '<span class="chip ok">⭐ Recomendado</span>' : ""}<div class="small muted">${esc(p.category || "Sin categoría")}</div></td>
          <td class="nowrap">${s ? `${esc(s.name)}<div class="small">${stars(s.rating || 0)}</div>` : '<span class="muted">—</span>'}</td>
          <td class="right nowrap"><b style="font-size:15px">${money(p.price)}</b>${p.priceMode === "pack" ? `<div class="small muted">${money(p.packPrice)} x${p.packQty}</div>` : ""}${tiersOf(p).length > 1 ? `<div class="small muted tiers-mini" title="Precio c/u según cantidad">${tiersText(p).slice(1).join("<br>")}</div>` : ""}</td>
          <td class="right">${p.minQty ? `x${esc(p.minQty)}` : "—"}</td>
          <td class="right nowrap muted">${productShipping(p) ? money(productShipping(p)) : "sin envío"}</td>
          <td class="right nowrap"><b>${money(landedUnit(p))}</b></td>
          <td class="nowrap small">${fmtDate(p.priceDate, { year: true })}</td>
          <td class="nowrap"><button class="btn sm primary" data-pick="${p.id}">Elegir</button></td></tr>`;
      }).join("")}</tbody></table></div>
      <p class="small muted">⭐ Recomendado = el que te sale más barato por unidad con el envío incluido; a igual costo, el proveedor con más estrellas. Tocá una fila para ver o editar la ficha.</p>`;
    }
    $$("[data-p]", el).forEach((c) => (c.onclick = (e) => { if (!e.target.closest("button, a")) openProductForm(db.get("products", c.dataset.p)); }));
    $$("[data-pick]", el).forEach((b) => (b.onclick = () => choose(db.get("products", b.dataset.pick))));
    $$("[data-dup]", el).forEach((b) => (b.onclick = () => duplicateProduct(db.get("products", b.dataset.dup))));
    $$("[data-combo]", el).forEach((r) => (r.onclick = () => openComboForm(db.get("combos", r.dataset.combo))));
  };
  el.innerHTML = `<div class="stack">
    <div class="row">
      <div class="search grow" style="min-width:220px">${icon("search")}<input type="search" id="p-q" placeholder="Escribí una palabra: botella, taza, vela…" value="${esc(state.q)}"></div>
      <select id="p-sort" style="width:auto">${options(SORTS, state.sort, null)}</select>
      <span class="small muted" id="p-count"></span>
    </div>
    <div class="chips-filter wrap"><button data-c="" class="${!state.cat ? "on" : ""}">Todas <span class="chip-n">${all.length}</span></button>${categories().map((c) => `<button data-c="${c}" class="${state.cat === c ? "on" : ""}">${c}</button>`).join("")}</div>
    <div id="p-combos"></div>
    <div id="p-list"></div>
    <div id="p-top"></div></div>`;
  $("#p-q", el).oninput = (e) => { state.q = e.target.value; draw(); };
  autocomplete($("#p-q", el), (x) => [...productSuggestions(x), ...supplierSuggestions(x).slice(0, 3)]);
  $("#p-sort", el).onchange = (e) => { state.sort = e.target.value; draw(); };
  $$("[data-c]", el).forEach((b) => (b.onclick = () => { state.cat = b.dataset.c; render(el); }));
  draw();
  return {
    title: "Productos",
    sub: `${all.length} productos en el catálogo`,
    actions: `<button class="btn" id="p-combo">🎁<span class="desktop-only">Nuevo combo</span></button><button class="btn" id="p-pdf">${icon("upload")}<span class="desktop-only">Importar PDF</span></button><button class="btn primary" id="p-new">${icon("plus")}<span class="desktop-only">Nuevo producto</span></button>`,
    bind: (a) => { $("#p-new", a).onclick = () => openProductForm(); $("#p-pdf", a).onclick = () => importCatalog(); $("#p-combo", a).onclick = () => openComboForm(); },
  };
}

// Elegir un producto: cotizarlo, armar un pedido o escribirle al proveedor
function choose(p) {
  const s = db.get("suppliers", p.supplierId);
  const qty = Math.max(1, Number(p.minQty) || 1);
  const sug = suggestedPrice(p, qty);
  modal({
    title: `Elegiste: ${esc(p.name)}`,
    body: `<div class="stack">
      <div class="row"><div class="thumb" style="width:64px;height:64px">${p.image ? `<img src="${p.image}" alt="">` : "📦"}</div>
        <div><b>${esc(p.name)}</b><div class="small muted">${s ? `${esc(s.name)} · ${stars(s.rating || 0)}` : "Sin proveedor"}</div>
        <div>${money(p.price)} c/u · costo real ${money(landedUnit(p))} c/u · venta sugerida <b style="color:var(--ok)">${money(sug.unit)}</b> c/u (x${qty})</div></div></div>
      <div class="grid g2">
        <button class="btn primary" id="ch-quote">${icon("calc")} Cotizarlo</button>
        <button class="btn" id="ch-order">${icon("bag")} Nuevo pedido con este producto</button>
        ${s?.phone ? `<a class="btn wa" target="_blank" rel="noopener" href="${waLink(s.phone, `Hola ${s.contact || ""}! Te consulto por ${p.name}${p.minQty ? ` (x${p.minQty})` : ""}. ¿Sigue a ${money(p.price)}?`)}">${icon("wa")} Consultar al proveedor</a>` : ""}
        <button class="btn" id="ch-edit">${icon("edit")} Ver / editar ficha</button>
      </div></div>`,
    onMount: (el, m) => {
      $("#ch-quote", el).onclick = async () => { m.close(); (await import("./quote.js")).addToQuote(p.id, qty); location.hash = "#/cotizador"; };
      $("#ch-order", el).onclick = async () => {
        m.close();
        (await import("./orders.js")).openOrderForm({ status: "senado", client: {}, supplierId: p.supplierId,
          items: [{ product: p.name, productId: p.id, category: p.category, qty, unitCost: Math.round(p.price), unitPrice: Math.round(sug.unit) }] });
      };
      $("#ch-edit", el).onclick = () => { m.close(); openProductForm(p); };
    },
  });
}

// Duplicar: abre el formulario con todo copiado (foto, proveedor, precio, envío…) para cargar otra variante
export function duplicateProduct(p) {
  if (!p) return;
  const copy = { ...p, name: `${p.name} - `, notes: p.notes || "" };
  for (const k of ["id", "createdAt", "updatedAt", "priceHistory", "priceDate"]) delete copy[k];
  openProductForm(copy, { duplicate: true });
}

// Un renglón de escala: "desde X unidades → $ c/u" (sin name, así no lo pisa readForm)
const tierRow = (t = {}) => `<div class="grid g2 tier-row">
  <label class="field">Desde (unidades)<input data-tmin type="number" min="1" value="${t.min ?? ""}" placeholder="20"></label>
  <label class="field">Precio c/u<input data-tprice data-money="1" value="${t.price ?? ""}" placeholder="4331"></label></div>`;

export function openProductForm(p = null, { duplicate = false, onSave } = {}) {
  const isNew = !p?.id;
  p = p ? { ...p } : { category: "", size: "small", priceDate: today() };
  const sups = db.all("suppliers");
  const st = settings();
  let image = p.image || "";
  modal({
    title: duplicate ? `📄 Duplicar: cambiá lo que es distinto en esta variante` : isNew ? "Nuevo producto" : esc(p.name),
    wide: true,
    body: `<form class="grid g2" id="pf">
      <div class="stack">
        <label class="field">Foto del producto<input type="file" accept="image/*" id="pf-img"></label>
        <div class="product-img" id="pf-prev" style="border-radius:14px">${image ? `<img src="${image}">` : icon("img")}</div>
      </div>
      <div class="stack">
        <label class="field">Nombre *<input name="name" required value="${esc(p.name || "")}"></label>
        <div class="grid g2">
          <label class="field">Categoría<select name="category">${categoryOptions(p.category)}</select></label>
          <label class="field">Proveedor<select name="supplierId">${options([...sups.map((s) => [s.id, s.name]), ["__new", "➕ Proveedor nuevo…"]], p.supplierId, "—")}</select></label>
          <label class="field pf-newsup hidden">Nombre del proveedor nuevo<input name="newSupplier" list="pf-sups" placeholder="Ej: Mundo de Creaciones"><datalist id="pf-sups">${sups.map((s) => `<option value="${esc(s.name)}">`).join("")}</datalist></label>
          <label class="field">Teléfono del proveedor<input name="supPhone" type="tel" value="${esc(db.get("suppliers", p.supplierId)?.phone || "")}" placeholder="383 4123456"></label>
          <div class="price-mode" style="grid-column:1/-1">
            <label class="field">¿Cómo te pasó el precio el proveedor?<select name="priceMode">${options([["unit", "Por unidad"], ["pack", "Por cantidad (ej: $45.000 las 30 unidades)"], ["tiers", "Por escala (más cantidad, más barato c/u)"]], p.priceMode || "unit", null)}</select></label>
            <div class="pm-tiers ${p.priceMode === "tiers" ? "" : "hidden"}" style="margin-top:8px">
              <div class="tiers-edit" id="pf-tiers">${[...tiersOf(p), {}, {}].slice(0, Math.max(4, tiersOf(p).length + 1)).map(tierRow).join("")}</div>
              <button type="button" class="btn sm ghost" id="pf-tier-add">${icon("plus")} Otra escala</button>
            </div>
            <div class="grid g3 pm-pack ${p.priceMode === "pack" ? "" : "hidden"}" style="margin-top:8px">
              <label class="field">Precio total<input name="packPrice" type="number" min="0" value="${p.packPrice ?? ""}" placeholder="45000"></label>
              <label class="field">Por cuántas unidades<input name="packQty" type="number" min="1" value="${p.packQty ?? ""}" placeholder="30"></label>
              <div class="field">Sale por unidad<div class="pm-unit-val" id="pm-unit">—</div></div>
            </div>
            <label class="field pm-single ${p.priceMode === "pack" || p.priceMode === "tiers" ? "hidden" : ""}" style="margin-top:8px">Precio de costo c/u<input name="price" type="number" min="0" step="any" value="${p.price ?? ""}"></label>
          </div>
          <label class="field">Mínimo de compra<input name="minQty" type="number" min="0" value="${p.minQty ?? ""}" placeholder="120"></label>
          <label class="field">Tamaño para envío<select name="size">${options([["none", "Sin envío (misma provincia) · $0"], ["small", `Pocos/chicos · ${money(st.shipSmall)}`], ["big", `Grande/pesado · ${money(st.shipBig)}`]], p.size, null)}</select></label>
        </div>
        <label class="field">Notas<textarea name="notes" placeholder="Colores, medidas, técnica de impresión…">${esc(p.notes || "")}</textarea></label>
        ${p.priceHistory?.length ? `<div class="small"><b>Historial de precios</b><br>${p.priceHistory.slice(-6).reverse().map((h) => `${fmtDate(h.date, { year: true })}: ${money(h.price)}`).join(" · ")}</div>` : ""}
        ${(() => { const s = db.get("suppliers", p.supplierId); return s ? `<div class="row">${s.social ? `<a class="btn sm" target="_blank" rel="noopener" href="${socialUrl(s.social)}">Redes de ${esc(s.name)}</a>` : ""}${s.website ? `<a class="btn sm" target="_blank" rel="noopener" href="${socialUrl(s.website)}">${icon("globe")} Web</a>` : ""}</div>` : ""; })()}
      </div>
    </form>`,
    foot: `${!isNew ? `<button class="btn danger" id="pf-del">${icon("trash")}</button><button class="btn" id="pf-dup">${icon("copy")} Duplicar</button>` : ""}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pf-save">${icon("check")} Guardar</button>`,
    onMount: (el, m) => {
      const form = $("#pf", el);
      // precio por cantidad: se calcula el precio por unidad (que es el que usa todo el sistema)
      const priceMode = () => {
        const pack = form.priceMode.value === "pack", tiers = form.priceMode.value === "tiers";
        $(".pm-pack", el).classList.toggle("hidden", !pack);
        $(".pm-tiers", el).classList.toggle("hidden", !tiers);
        $(".pm-single", el).classList.toggle("hidden", pack || tiers);
        if (pack) {
          const total = Number(form.packPrice.value) || 0, qty = Number(form.packQty.value) || 0;
          const unit = total && qty ? total / qty : 0;
          form.price.value = unit ? Math.round(unit * 100) / 100 : "";
          $("#pm-unit", el).innerHTML = unit ? `<b>${money(unit)}</b> c/u` : "—";
          if (qty && !form.minQty.value) form.minQty.value = qty;
        }
      };
      form.priceMode.onchange = () => { if (form.priceMode.value === "pack" && !form.packPrice.value && form.price.value) form.packQty.focus(); priceMode(); };
      form.addEventListener("input", priceMode);
      $("#pf-tier-add", el).onclick = () => $("#pf-tiers", el).insertAdjacentHTML("beforeend", tierRow());
      const readTiers = () => $$(".tier-row", el).map((r) => ({ min: Number($("[data-tmin]", r).value) || 0, price: Number($("[data-tprice]", r).value) || 0 }));
      priceMode();
      // proveedor nuevo o teléfono: se guardan en la ficha del proveedor
      form.supplierId.addEventListener("change", () => {
        $(".pf-newsup", el).classList.toggle("hidden", form.supplierId.value !== "__new");
        if (form.supplierId.value === "__new") form.newSupplier.focus();
        form.supPhone.value = db.get("suppliers", form.supplierId.value)?.phone || "";
      });
      // si escribís un proveedor que ya tenés, se elige ese y se completa su teléfono
      form.newSupplier.addEventListener("input", () => {
        const ex = sups.find((x) => x.name.trim().toLowerCase() === form.newSupplier.value.trim().toLowerCase());
        if (!ex) return;
        form.supplierId.value = ex.id; form.supPhone.value = ex.phone || "";
        $(".pf-newsup", el).classList.add("hidden");
      });
      form.name.addEventListener("change", () => { if (!form.category.value) form.category.value = guessCategory(form.name.value); });
      $("#pf-img", el).onchange = async (e) => {
        if (!e.target.files[0]) return;
        image = await resizeImage(e.target.files[0]);
        $("#pf-prev", el).innerHTML = `<img src="${image}">`;
      };
      // al duplicar, el cursor queda al final del nombre para escribir la variante (ej: "Mochila - roja")
      if (duplicate) setTimeout(() => { form.name.focus(); form.name.setSelectionRange(form.name.value.length, form.name.value.length); }, 60);
      $("#pf-dup", el) && ($("#pf-dup", el).onclick = async () => { if (m.isDirty() && !(await confirmBox("Tenés cambios sin guardar en este producto. ¿Duplicar igual (sin esos cambios)?", "Duplicar igual"))) return; m.close(); duplicateProduct(db.get("products", p.id)); });
      $("#pf-del", el) && ($("#pf-del", el).onclick = async () => { if (await confirmBox(`¿Borrar ${esc(p.name)}?`, "Borrar")) { await db.remove("products", p.id); m.close(); } });
      $("#pf-save", el).onclick = async () => {
        const f = readForm(form);
        if (!f.name) return form.name.focus();
        const { newSupplier, supPhone, ...data } = f;
        if (data.supplierId === "__new") {
          if (!newSupplier?.trim()) return form.newSupplier.focus();
          const ex = db.all("suppliers").find((x) => x.name.trim().toLowerCase() === newSupplier.trim().toLowerCase());
          data.supplierId = (ex || await db.put("suppliers", { name: newSupplier.trim(), phone: supPhone || "", shippingCost: "", rating: 0, leadDays: 14, contact: "", province: "", alias: "", social: "", website: "", minimum: "", matrixCost: "", matrixNote: "", notes: "" })).id;
        }
        const sup = db.get("suppliers", data.supplierId);
        if (sup && (supPhone || "") !== (sup.phone || "")) await db.put("suppliers", { ...sup, phone: supPhone || "" });
        if (data.notes === "Producto rápido: completar datos" && Number(data.price || data.packPrice)) data.notes = "";
        const saved = await saveProduct({ ...p, ...data, image, tiers: readTiers() });
        onSave?.(saved);
        m.close();
        toast(isNew ? "✨ Producto guardado" : "Producto actualizado", f.name);
      };
    },
  });
}

// Guarda registrando la fecha del último cambio de precio
export async function saveProduct(p) {
  const prev = p.id ? db.get("products", p.id) : null;
  // la foto se guarda como archivo en la compu; sin conexión queda adentro y se convierte al sincronizar
  if (String(p.image || "").startsWith("data:")) {
    try {
      const r = await fetch("/api/photo", { method: "POST", headers: { "Content-Type": "application/json", ...pinHeader() }, body: JSON.stringify({ dataUrl: p.image }) });
      if (r.ok) p.image = (await r.json()).url;
    } catch {}
  }
  const tiers = (p.tiers || []).filter((t) => Number(t.min) > 0 && Number(t.price) > 0).map((t) => ({ min: Number(t.min), price: Number(t.price) })).sort((a, b) => a.min - b.min);
  if (p.priceMode === "tiers" && tiers.length) { p.tiers = tiers; p.price = tiers[0].price; p.minQty = tiers[0].min; delete p.packPrice; delete p.packQty; }
  else if (p.priceMode === "pack" && Number(p.packQty) > 0 && Number(p.packPrice) > 0) { p.price = Number(p.packPrice) / Number(p.packQty); delete p.tiers; }
  else { p.priceMode = "unit"; delete p.packPrice; delete p.packQty; delete p.tiers; }
  p.price = Math.round((Number(p.price) || 0) * 100) / 100;
  if (!prev || Number(prev.price) !== p.price) {
    p.priceDate = today();
    p.priceHistory = [...(prev?.priceHistory || []), { date: today(), price: p.price }];
  }
  return db.put("products", p);
}
