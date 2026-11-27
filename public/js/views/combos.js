// Combos con descuento: varios productos del catálogo (cada uno con su cantidad y su proveedor) a un precio especial.
// Se arman en Productos y se suman a un pedido con "Agregar combo".
import { db, settings } from "../db.js";
import { icon, esc, money, priceFromCost, hiddenCostsPerUnit } from "../utils.js";
import { $, $$, modal, toast, confirmBox, readForm, options } from "../ui.js";
import { productShipping, unitCostFor, saveProduct } from "./products.js";

const COL = "combos";
export const allCombos = () => db.all(COL).sort((a, b) => a.name.localeCompare(b.name));

// Envío de un proveedor cuando el producto no es suyo: el de su ficha o el chico de siempre (igual que en el pedido)
export const supplierShipDefault = (sid) => { const sc = db.get("suppliers", sid)?.shippingCost; return sc !== "" && sc != null && !isNaN(sc) ? Number(sc) : settings().shipSmall; };

// Renglones del combo (x n combos) con su costo: el que cargaste en el renglón o el del catálogo para esa cantidad
export function comboLines(c, n = 1) {
  const lines = (c.lines || []).map((l) => {
    const p = db.get("products", l.productId);
    const qty = (Number(l.qty) || 0) * n;
    const own = Number(l.cost) > 0 ? Number(l.cost) : 0;
    return { p, product: p?.name || l.name || "Producto borrado", productId: l.productId, category: p?.category || "", qty,
      supplierId: l.supplierId || p?.supplierId || "", unitCost: own || (p ? unitCostFor(p, qty) : 0) };
  });
  // combo con costo del proveedor: lo que te cobra por 1 de cada producto, repartido según lo que cuesta cada uno suelto
  if (c.discountType === "cost" && Number(c.discount) > 0) {
    const base = lines.reduce((a, l) => a + l.unitCost, 0);
    for (const l of lines) l.unitCost = base ? (Number(c.discount) * l.unitCost) / base : Number(c.discount) / lines.length;
  }
  return lines;
}

// Descuento en plata sobre el precio sin descuento (nunca más que el precio).
// Con "price" el combo tiene precio fijo (en discount va ese precio): el descuento es lo que falta para llegar (o lo que sobra, si es más caro).
export const comboDiscount = (c, list, n = 1) => c.discountType === "cost" ? 0 // el descuento ya está en el costo
  : c.discountType === "price" ? list - (Number(c.discount) || 0) * n
  : Math.max(0, Math.min(list, c.discountType === "fixed" ? (Number(c.discount) || 0) * n : (list * (Number(c.discount) || 0)) / 100));

// Precio del combo con las mismas reglas que un pedido: productos + envío (uno por proveedor) + packaging (uno) + ganancia
export function comboPrice(c) {
  const lines = comboLines(c);
  const goods = lines.reduce((a, l) => a + l.qty * l.unitCost, 0);
  const g = new Map();
  for (const l of lines) {
    if (!l.supplierId) continue;
    const def = l.p && l.p.supplierId === l.supplierId ? productShipping(l.p) : supplierShipDefault(l.supplierId);
    g.set(l.supplierId, Math.max(g.get(l.supplierId) ?? 0, def));
  }
  const ship = [...g.values()].reduce((a, b) => a + b, 0);
  const hidden = hiddenCostsPerUnit();
  const cost = goods + ship + hidden;
  if (c.discountType === "cost") {
    // sin combo: los mismos productos con el costo del catálogo; con combo: el costo del proveedor + tu ganancia de siempre
    const full = comboLines({ ...c, discountType: "" }).reduce((a, l) => a + l.qty * l.unitCost, 0);
    const list = full ? priceFromCost(full + ship + hidden).price : 0;
    const final = goods ? priceFromCost(cost).price : 0;
    return { lines, goods, full, ship, hidden, cost, list, discount: list - final, final, profit: final - cost };
  }
  const list = goods ? priceFromCost(cost).price : 0;
  const discount = comboDiscount(c, list);
  const final = list - discount;
  return { lines, goods, ship, hidden, cost, list, discount, final, profit: final - cost };
}

const discountText = (c) => (c.discountType === "cost" ? `costo combo ${money(c.discount)} c/u` : c.discountType === "price" ? `precio fijo ${money(c.discount)}` : Number(c.discount) ? (c.discountType === "fixed" ? `${money(c.discount)} menos` : `${c.discount}% off`) : "sin descuento");
const signed = (n) => `${n >= 0 ? "−" : "+"}${money(Math.abs(n))}`;

// Tarjeta con los combos para la pantalla de Productos
export function combosHTML() {
  const list = allCombos();
  if (!list.length) return "";
  return `<div class="card table-wrap otable-wrap" style="max-height:none"><div class="card-head" style="padding:12px 14px 0"><h3>🎁 Combos</h3><span class="small muted">tocá uno para editarlo</span></div>
    <table class="otable" style="min-width:760px"><thead><tr><th>Combo</th><th>Productos</th><th class="right">Sin descuento</th><th class="right">Descuento</th><th class="right">Precio final</th><th class="right">Ganancia</th></tr></thead>
    <tbody>${list.map((c) => {
      const r = comboPrice(c);
      return `<tr data-combo="${c.id}"><td><b>${esc(c.name)}</b><div class="small muted">${discountText(c)}</div></td>
        <td class="small">${r.lines.map((l) => `x${l.qty} ${esc(l.product)}${l.supplierId ? ` <span class="muted">· ${esc(db.get("suppliers", l.supplierId)?.name || "")}</span>` : ""}`).join("<br>")}</td>
        <td class="right nowrap muted">${money(r.list)}</td><td class="right nowrap">${signed(r.discount)}</td>
        <td class="right nowrap"><b style="font-size:15px">${money(r.final)}</b></td>
        <td class="right nowrap" style="color:${r.profit >= 0 ? "var(--ok)" : "var(--u-red)"}">${money(r.profit)}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}

// Un renglón del combo (sin name, así readForm no lo mezcla con el resto del formulario)
const prodOpts = (sel) => options(db.all("products").sort((a, b) => a.name.localeCompare(b.name)).map((p) => [p.id, p.name]), sel, "Elegí un producto…");
const lineRow = (l = {}) => {
  const p = db.get("products", l.productId);
  return `<div class="grid combo-line" style="grid-template-columns: 2fr 70px 1.4fr 1fr 36px; gap:4px 8px; align-items:end">
    <label class="field">Producto<select data-lprod>${prodOpts(l.productId)}</select></label>
    <label class="field">Cant.<input data-lqty type="number" min="1" value="${l.qty ?? 1}"></label>
    <label class="field">🏭 Proveedor<select data-lsup>${options(db.all("suppliers").map((s) => [s.id, s.name]), l.supplierId || p?.supplierId, "—")}</select></label>
    <label class="field" title="Si lo dejás vacío uso el costo del catálogo">Costo c/u<input data-lcost data-money="1" value="${Number(l.cost) > 0 ? l.cost : ""}" placeholder="${p ? Math.round(unitCostFor(p, l.qty ?? 1)) : "del catálogo"}"></label>
    <button type="button" class="btn ghost icon danger" data-lrm title="Quitar">${icon("x")}</button></div>`;
};

export function openComboForm(c = null) {
  const isNew = !c?.id;
  c = c ? { ...c } : { name: "", discountType: "pct", discount: 10, lines: [{ qty: 1 }, { qty: 1 }] };
  modal({
    title: isNew ? "🎁 Nuevo combo" : esc(c.name),
    wide: true,
    body: `<form class="stack" id="cf">
      <div class="grid g3">
        <label class="field">Nombre del combo *<input name="name" required value="${esc(c.name || "")}" placeholder="Ej: Kit egresados"></label>
        <label class="field">Descuento<select name="discountType">${options([["pct", "Porcentaje (%)"], ["fixed", "Monto fijo ($)"], ["price", "Precio final del combo ($)"], ["cost", "Costo del proveedor por combo ($ c/u)"]], c.discountType, null)}</select></label>
        <label class="field">Cuánto (% o $)<input name="discount" type="number" min="0" step="any" value="${c.discount ?? ""}"></label>
      </div>
      <div><b>Productos del combo</b> <span class="small muted">(el proveedor viene del producto, pero podés elegir otro)</span></div>
      <div class="stack" id="cf-lines">${(c.lines?.length ? c.lines : [{ qty: 1 }]).map(lineRow).join("")}</div>
      <div><button type="button" class="btn sm soft" id="cf-add">${icon("plus")} Agregar producto</button></div>
      <div class="price-box" id="cf-sum"></div>
      <label class="field">Notas<textarea name="notes" placeholder="Para qué ocasión es, colores…">${esc(c.notes || "")}</textarea></label>
    </form>`,
    foot: `${!isNew ? `<button class="btn danger" id="cf-del">${icon("trash")}</button>` : ""}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cf-save">${icon("check")} Guardar combo</button>`,
    onMount: (el, m) => {
      const form = $("#cf", el);
      const box = $("#cf-lines", el);
      const readLines = () => $$(".combo-line", box).map((r) => ({ productId: $("[data-lprod]", r).value, qty: Number($("[data-lqty]", r).value) || 0, supplierId: $("[data-lsup]", r).value, cost: Number($("[data-lcost]", r).value) || "" }))
        .filter((l) => l.productId && l.qty > 0);
      const read = () => { const f = readForm(form); return { ...c, ...f, discount: Number(f.discount) || 0, lines: readLines() }; };
      const draw = () => {
        const r = comboPrice(read());
        $("#cf-sum", el).innerHTML = r.lines.length ? `
          <div class="price-line"><span>Productos</span><b>${money(r.goods)}</b></div>
          <div class="price-line"><span>+ Envío de proveedores · packaging</span><b>${money(r.ship + r.hidden)}</b></div>
          <div class="price-line"><span>Precio sin descuento <span class="muted small">(+${settings().markup}% de ganancia)</span></span><b>${money(r.list)}</b></div>
          <div class="price-line"><span>Descuento</span><b>${signed(r.discount)}</b></div>
          <div class="price-line total"><span>Precio final del combo</span><span>${money(r.final)}</span></div>
          <div class="small" style="margin-top:4px;color:${r.profit >= 0 ? "var(--ok)" : "var(--u-red)"}">Te quedan ${money(r.profit)} de ganancia${r.final ? ` (${Math.round((r.profit / r.final) * 100)}%)` : ""}.</div>`
          : `<span class="small muted">Elegí los productos y acá te calculo el precio del combo.</span>`;
      };
      const bindLine = (r) => {
        $("[data-lrm]", r).onclick = () => { r.remove(); draw(); };
        // al elegir el producto se trae su proveedor y su costo del catálogo
        $("[data-lprod]", r).onchange = () => {
          const p = db.get("products", $("[data-lprod]", r).value);
          if (p?.supplierId) $("[data-lsup]", r).value = p.supplierId;
          const want = Number(p?.minQty) || 0, q = $("[data-lqty]", r);
          if (want > 1 && (Number(q.value) || 0) <= 1) q.value = want;
          $("[data-lcost]", r).value = "";
          $("[data-lcost]", r).placeholder = p ? Math.round(unitCostFor(p, q.value)) : "del catálogo";
          draw();
        };
      };
      $$(".combo-line", box).forEach(bindLine);
      $("#cf-add", el).onclick = () => { box.insertAdjacentHTML("beforeend", lineRow()); bindLine(box.lastElementChild); };
      form.addEventListener("input", draw);
      form.addEventListener("change", draw);
      draw();
      $("#cf-del", el) && ($("#cf-del", el).onclick = async () => { if (await confirmBox(`¿Borrar el combo ${esc(c.name)}? Los pedidos que ya lo tienen no cambian.`, "Borrar")) { await db.remove(COL, c.id); m.close(); } });
      $("#cf-save", el).onclick = async () => {
        const data = read();
        if (!data.name) return form.name.focus();
        if (!data.lines.length) return toast("Falta elegir los productos del combo", "", { urgent: true });
        await db.put(COL, data);
        m.close();
        toast(isNew ? "🎁 Combo guardado" : "Combo actualizado", `${data.name} · ${money(comboPrice(data).final)}`);
      };
    },
  });
}

// Armar combo desde el pedido: tildás los productos cargados, van todos al mismo proveedor y les ponés un solo precio.
// El combo queda guardado en Combos (para usarlo otra vez). También se puede elegir uno que ya armaste.
// rows: renglones del pedido que todavía no son de un combo [{ key, product, productId, category, qty, unitCost, supplierId }]
export function openComboBuilder(rows, { onBuild, onPick }) {
  const saved = allCombos();
  const firstSup = rows.find((r) => r.supplierId)?.supplierId || "";
  modal({
    title: "🎁 Armar combo",
    body: `<div class="stack" id="cb">
      ${saved.length ? `<label class="field">¿Qué combo?<select id="cb-use">${options([["", "✨ Armar uno nuevo con productos de este pedido"], ...saved.map((c) => [c.id, `${c.name} · ${money(comboPrice(c).final)}`])], "", null)}</select></label>` : ""}
      <div id="cb-new" class="stack">
        ${rows.length ? `<div><b>Tildá los productos que van en el combo</b></div>
        <div class="stack" style="gap:6px">${rows.map((r) => `<label class="check"><input type="checkbox" data-cb-row="${r.key}" checked> x${r.qty} ${esc(r.product)}${r.unitCost ? ` <span class="muted small">· costo ${money(r.unitCost * r.qty)}</span>` : ""}</label>`).join("")}</div>
        <div class="grid g2">
          <label class="field">Nombre del combo *<input id="cb-name"></label>
          <label class="field">🏭 Proveedor (todos del mismo)<select id="cb-sup">${options(db.all("suppliers").map((x) => [x.id, x.name]), firstSup, "Elegí el proveedor…")}</select></label>
        </div>
        <div class="grid g2">
          <label class="field" title="Lo que te cobra el proveedor por 1 de cada producto tildado">Costo de 1 combo *<input id="cb-price" data-money="1" placeholder="Ej: 6000 por botella + mochila"></label>
          <label class="field" title="Lo que te cobra el proveedor por todos los combos juntos">Costo de todos los combos <span class="muted small" id="cb-n-label"></span><input id="cb-total" data-money="1" placeholder="Si te pasaron el total"></label>
        </div>
        <div class="price-box" id="cb-sum"></div>` : `<p class="small muted">Primero cargá en el pedido los productos que van en el combo (o elegí uno que ya armaste).</p>`}
      </div>
      <div id="cb-saved" class="hidden grid g2">
        <label class="field">¿Cuántos combos?<input id="cb-n" type="number" min="1" value="1"></label>
        <p class="small muted" id="cb-info" style="align-self:end"></p>
      </div></div>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cb-ok">${icon("check")} Listo</button>`,
    onMount: (el, m) => {
      const use = () => db.get(COL, $("#cb-use", el)?.value || "");
      const picked = () => rows.filter((r) => $(`[data-cb-row="${r.key}"]`, el)?.checked);
      // el combo como quedaría, para mostrar costo, sugerido y ganancia
      const draft = () => ({ name: $("#cb-name", el)?.value.trim() || "", discountType: "cost", discount: Number($("#cb-price", el)?.value) || 0,
        lines: picked().map((r) => ({ productId: r.productId, name: r.product, qty: r.qty, supplierId: $("#cb-sup", el).value, cost: r.unitCost || "" })) });
      const draw = () => {
        const c = use();
        $("#cb-new", el).classList.toggle("hidden", !!c);
        $("#cb-saved", el).classList.toggle("hidden", !c);
        if (c) { $("#cb-info", el).innerHTML = `${comboLines(c).map((l) => `x${l.qty} ${esc(l.product)}`).join(" · ")} · ${discountText(c)}`; return; }
        if (!$("#cb-sum", el)) return;
        const d = draft(), r = comboPrice(d);
        const qtys = [...new Set(r.lines.map((l) => l.qty))];
        $("#cb-sum", el).innerHTML = r.lines.length < 2 ? `<span class="small muted">Tildá al menos dos productos.</span>`
          : !d.discount ? `<div class="price-line"><span>Costo suelto (catálogo)</span><b>${money(r.goods)}</b></div><span class="small muted">Escribí cuánto te cobra el proveedor por el combo (1 de cada uno).</span>`
          : `<div class="price-line"><span>Costo del combo${qtys.length === 1 ? ` (x${qtys[0]} × ${money(d.discount)})` : ""}</span><b>${money(r.goods)}</b></div>
          ${r.full > r.goods ? `<div class="small muted">Suelto te salía ${money(r.full)}: ahorrás ${money(r.full - r.goods)} con el combo.</div>` : ""}
          <div class="price-line"><span>+ Envío del proveedor y packaging</span><b>${money(r.ship + r.hidden)}</b></div>
          <div class="price-line total"><span>💚 Precio de venta sugerido (+${settings().markup}%)</span><span>${money(r.final)}</span></div>
          <div class="small" style="margin-top:4px;color:var(--ok)">Te quedan ${money(r.profit)} de ganancia${qtys.length === 1 && qtys[0] ? ` · ${money(r.final / qtys[0])} cada combo` : ""}.</div>`;
      };
      // costo de 1 combo ↔ costo de todos: completás uno y el otro se calcula (cantidad = la de los productos tildados)
      const comboCount = () => { const q = [...new Set(picked().map((r) => Number(r.qty) || 0))]; return q.length === 1 && q[0] > 0 ? q[0] : 0; };
      const syncTotal = () => {
        const n = comboCount(), t = $("#cb-total", el); if (!t) return;
        t.disabled = !n;
        $("#cb-n-label", el).textContent = n ? `(x${n})` : "(los productos tienen cantidades distintas)";
        const price = Number($("#cb-price", el).value) || 0;
        t.value = n && price ? Math.round(price * n * 100) / 100 : "";
      };
      $("#cb-price", el)?.addEventListener("input", syncTotal);
      $("#cb-total", el)?.addEventListener("input", () => {
        const n = comboCount(), total = Number($("#cb-total", el).value) || 0;
        $("#cb-price", el).value = n && total ? Math.round((total / n) * 100) / 100 : "";
      });
      el.addEventListener("change", (e) => { if (e.target.dataset.cbRow) syncTotal(); });
      syncTotal();
      // el nombre sugerido sigue a los productos tildados hasta que lo escribas vos
      let named = false;
      const autoName = () => { if ($("#cb-name", el) && !named) $("#cb-name", el).value = [...new Set(picked().map((r) => r.product))].join(" + ").slice(0, 80); };
      $("#cb-name", el)?.addEventListener("input", () => (named = true));
      el.addEventListener("change", (e) => { if (e.target.dataset.cbRow) autoName(); });
      el.addEventListener("input", draw);
      el.addEventListener("change", draw);
      autoName();
      draw();
      $("#cb-ok", el).onclick = async () => {
        const c = use();
        if (c) { m.close(); return onPick(c, Math.max(1, Number($("#cb-n", el).value) || 1)); }
        const sel = picked(), d = draft(), sup = $("#cb-sup", el)?.value;
        if (sel.length < 2) return toast("Tildá al menos dos productos para el combo", "", { urgent: true });
        if (!sup) return $("#cb-sup", el).focus();
        if (!d.discount) return $("#cb-price", el).focus(); // costo del combo c/u
        if (!d.name) return $("#cb-name", el).focus();
        // los productos que no están en el catálogo se crean, así el combo queda completo en Productos
        for (const [k, r] of sel.entries()) {
          if (r.productId && db.get("products", r.productId)) continue;
          const p = await saveProduct({ name: r.product, category: r.category || "", supplierId: sup, size: "small", priceMode: "unit", price: r.unitCost || 0, notes: r.unitCost ? "" : "Producto rápido: completar datos" });
          d.lines[k].productId = p.id;
        }
        // el costo del renglón se guarda sólo si es distinto al del catálogo
        d.lines = d.lines.map((l) => { const p = db.get("products", l.productId); return Number(l.cost) && p && Math.abs(unitCostFor(p, l.qty) - Number(l.cost)) < 0.01 ? { ...l, cost: "" } : l; });
        const combo = await db.put(COL, { ...d, notes: "" });
        m.close();
        toast("🎁 Combo guardado en Productos", `${combo.name} · costo ${money(combo.discount)} c/u`);
        onBuild(combo, sel.map((r) => r.key), sup);
      };
    },
  });
}
