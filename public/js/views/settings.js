// Ajustes: datos del negocio, reglas de precio, costos ocultos, tarjetas, WhatsApp, feriados extra, datos de ejemplo.
import { db, settings, saveSettings, COLLECTIONS, syncNow, pinHeader } from "../db.js";
import { syncBadge } from "../app.js";
import { categories, renameCategory } from "../categories.js";
import { icon, esc, money, today, addDays, holidaysOf, fmtDate, download } from "../utils.js";
import { $, $$, toast, confirmBox, readForm } from "../ui.js";
import { aiAvailable } from "../assistant.js";
import { syncNotifications } from "../alerts.js";

export function render(el) {
  const s = settings();
  const year = new Date().getFullYear();
  el.innerHTML = `<form class="stack" id="st">
    <div class="card stack" id="sync-card"><h3>☁️ Sincronización y copias de seguridad</h3><p class="muted small" style="margin:0">Cargando…</p></div>
    <div class="grid g2">
      <div class="card stack"><h3>🏷️ Tu negocio</h3>
        <label class="field">Nombre<input name="businessName" value="${esc(s.businessName)}"></label>
        <label class="field">Teléfono<input name="businessPhone" value="${esc(s.businessPhone)}"></label>
        <label class="field">Dirección / redes (sale en el comprobante)<input name="businessAddress" value="${esc(s.businessAddress)}"></label>
        <label class="field">Dónde retiran los pedidos (para los mensajes)<input name="pickupInfo" value="${esc(s.pickupInfo)}"></label>
      </div>
      <div class="card stack"><h3>📈 Regla de ganancia y envíos</h3>
        <div class="grid g3">
          <label class="field">Ganancia %<input type="number" name="markup" value="${s.markup}"></label>
          <label class="field">Si supera…<input type="number" name="markupThreshold" value="${s.markupThreshold}"></label>
          <label class="field">…pasa a %<input type="number" name="markupHigh" value="${s.markupHigh}"></label>
        </div>
        <div class="grid g2">
          <label class="field">Envío pocos productos<input type="number" name="shipSmall" value="${s.shipSmall}"></label>
          <label class="field">Envío grande / pesado<input type="number" name="shipBig" value="${s.shipBig}"></label>
        </div>
        <div class="small muted">🤖 Asistente IA: ${aiAvailable() ? '<span class="badge-on">activo</span>' : '<span class="badge-off">modo local</span> — agregá tu ANTHROPIC_API_KEY en el archivo .env para que entienda frases libres y busque datos en internet.'}</div>
      </div>
    </div>
    <div class="grid g2">
      <div class="card"><h3>🏷️ Categorías de productos</h3>
        <p class="small muted" style="margin-top:0">Si le cambiás el nombre a una, se actualiza en todos tus productos y pedidos.</p>
        <div class="stack" style="gap:6px" id="st-cats">${categories().map((c, i) => `<div class="row" data-cat="${i}" style="flex-wrap:nowrap"><input data-k="name" value="${esc(c)}"><button type="button" class="btn ghost icon danger" data-rmc="${i}" title="Quitar">${icon("x")}</button></div>`).join("")}</div>
        <button type="button" class="btn sm soft" id="add-c" style="margin-top:8px">${icon("plus")} Nueva categoría</button>
      </div>
      <div class="card"><h3>🎁 Packaging (uno por pedido)</h3>
        <div class="stack" id="st-hidden">${s.hidden.map((h, i) => `<div class="row" data-h="${i}" style="flex-wrap:nowrap"><input type="checkbox" data-k="on" ${h.on ? "checked" : ""} title="Aplicar por defecto" style="width:20px;height:20px"><input data-k="name" value="${esc(h.name)}"><input type="number" data-k="cost" value="${h.cost}" style="width:110px"><button type="button" class="btn ghost icon danger" data-rmh="${i}">${icon("x")}</button></div>`).join("")}</div>
        <button type="button" class="btn sm soft" id="add-h" style="margin-top:8px">${icon("plus")} Agregar</button>
      </div>
      <div class="card"><h3>💳 Cobros con Naranja X (monotributo)</h3>
        <div class="grid g2" style="margin-bottom:10px">
          <label class="field">IVA sobre la comisión %<input type="number" name="iva" value="${s.iva}"></label>
          <label class="field">Retención IIBB % (si te aplican)<input type="number" step="0.01" name="iibb" value="${s.iibb}"></label>
        </div>
        <label class="check" style="margin-bottom:10px"><input type="checkbox" name="ivaOnFinancing" ${s.ivaOnFinancing ? "checked" : ""}> Sumar IVA también sobre la financiación de las cuotas</label>
        <div class="small"><b>Comisiones por medio (% sin IVA)</b></div>
        <div class="small muted" style="display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:6px;margin:6px 0 2px"><span>Medio</span><span>En cuenta</span><span>Débito</span><span>Crédito</span></div>
        <div class="stack" style="gap:6px">${s.payMedia.map((m, i) => `<div data-pm="${i}" style="display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:6px"><input data-k="name" value="${esc(m.name)}"><input type="number" step="0.01" data-k="cuenta" value="${m.cuenta}"><input type="number" step="0.01" data-k="debito" value="${m.debito}"><input type="number" step="0.01" data-k="credito" value="${m.credito}"></div>`).join("")}</div>
        <div class="small" style="margin-top:12px"><b>Costo de financiación por cuotas (%)</b> <span class="muted">· cuotas 0 = Plan Z</span></div>
        <div class="stack" style="gap:6px;margin-top:6px" id="st-fin">${s.financing.map((f, i) => `<div class="row" data-fin="${i}" style="flex-wrap:nowrap"><input data-k="label" value="${esc(f.label)}"><input type="number" data-k="n" value="${f.n}" style="width:70px" title="Cantidad de cuotas"><input type="number" step="0.01" data-k="rate" value="${f.rate}" style="width:90px" title="% financiación"><button type="button" class="btn ghost icon danger" data-rmf="${i}">${icon("x")}</button></div>`).join("")}</div>
        <button type="button" class="btn sm soft" id="add-f" style="margin-top:8px">${icon("plus")} Agregar plan de cuotas</button>
      </div>
    </div>
    <div class="card"><h3>${icon("wa")} Mensajes prearmados de WhatsApp</h3>
      <p class="small muted" style="margin-top:0">Podés usar: {nombre} {total} {sena} {saldo} {evento} {entrega} {producto} {retiro}</p>
      <div class="stack" id="st-wa">${s.waTemplates.map((t, i) => `<div class="grid" data-w="${i}" style="grid-template-columns:180px 1fr 40px;gap:8px"><input data-k="name" value="${esc(t.name)}"><textarea data-k="text" rows="2">${esc(t.text)}</textarea><button type="button" class="btn ghost icon danger" data-rmw="${i}">${icon("x")}</button></div>`).join("")}</div>
      <button type="button" class="btn sm soft" id="add-w" style="margin-top:8px">${icon("plus")} Agregar mensaje</button>
    </div>
    <div class="grid g2">
      <div class="card"><h3>⚠️ Feriados ${year}</h3>
        <div class="small" style="columns:2;column-gap:20px">${holidaysOf(year).map((h) => `<div>${fmtDate(h.date)} · ${esc(h.name)}</div>`).join("")}</div>
        <h3 style="margin-top:14px">Feriados extra (provinciales, días sin correo)</h3>
        <div class="stack" id="st-hol">${(s.extraHolidays || []).map((h, i) => `<div class="row" data-x="${i}" style="flex-wrap:nowrap"><input type="date" data-k="date" value="${h.date}" style="width:170px"><input data-k="name" value="${esc(h.name)}"><button type="button" class="btn ghost icon danger" data-rmx="${i}">${icon("x")}</button></div>`).join("")}</div>
        <button type="button" class="btn sm soft" id="add-x" style="margin-top:8px">${icon("plus")} Agregar feriado</button>
      </div>
      <div class="card stack"><h3>🧪 Datos</h3>
        <p class="small muted" style="margin:0">Todo se guarda en este dispositivo (funciona sin internet). Usá Finanzas → Exportar para respaldos.</p>
        <button type="button" class="btn" id="demo">${icon("sparkle")} Cargar datos de ejemplo</button>
        <button type="button" class="btn danger" id="wipe">${icon("trash")} Borrar todos los datos</button>
      </div>
    </div>
    <div class="row" style="position:sticky;bottom:12px;justify-content:flex-end"><button type="button" class="btn primary" id="st-save">${icon("check")} Guardar ajustes</button></div>
  </form>`;

  const rowsOf = (sel) => $$(sel, el).map((r) => Object.fromEntries($$("[data-k]", r).map((i) => [i.dataset.k, i.type === "checkbox" ? i.checked : i.type === "number" ? Number(i.value) : i.value])));
  const collect = () => {
    const f = readForm($("#st", el));
    const keep = {};
    for (const k of ["businessName", "businessPhone", "businessAddress", "pickupInfo"]) keep[k] = f[k];
    for (const k of ["markup", "markupThreshold", "markupHigh", "shipSmall", "shipBig", "iva", "iibb"]) keep[k] = Number(f[k]) || 0;
    keep.ivaOnFinancing = !!f.ivaOnFinancing;
    keep.categories = rowsOf("[data-cat]").map((r) => r.name.trim()).filter(Boolean);
    keep.hidden = rowsOf("[data-h]").map((h, i) => ({ ...h, key: s.hidden[i]?.key || `h${Date.now()}${i}` }));
    keep.payMedia = rowsOf("[data-pm]");
    keep.financing = rowsOf("[data-fin]");
    keep.waTemplates = rowsOf("[data-w]");
    keep.extraHolidays = rowsOf("[data-x]").filter((h) => h.date);
    return keep;
  };
  const saveAndRerender = async (mut) => { const c = collect(); await applyRenames(c.categories); mut?.(c); await saveSettings(c); render(el); };

  // si se renombró una categoría, se actualiza en productos y pedidos
  const applyRenames = async (next) => {
    const before = categories();
    let n = 0;
    for (let i = 0; i < Math.min(before.length, next.length); i++) if (before[i] !== next[i] && !next.includes(before[i])) n += await renameCategory(before[i], next[i]);
    if (n) toast("🏷️ Categoría renombrada", `Se actualizó en ${n} productos/pedidos`);
  };
  $("#add-c", el).onclick = () => saveAndRerender((c) => c.categories.push("Nueva categoría"));
  $("#st-save", el).onclick = async () => { const c = collect(); await applyRenames(c.categories); await saveSettings(c); toast("✅ Ajustes guardados"); syncNotifications({ silent: true }); };
  $("#add-h", el).onclick = () => saveAndRerender((c) => c.hidden.push({ key: `h${Date.now()}`, name: "Nuevo costo", cost: 0, on: false }));
  $("#add-f", el).onclick = () => saveAndRerender((c) => c.financing.push({ label: "Nuevo plan", n: 3, rate: 10 }));
  $("#add-w", el).onclick = () => saveAndRerender((c) => c.waTemplates.push({ name: "Nuevo mensaje", text: "Hola {nombre}! " }));
  $("#add-x", el).onclick = () => saveAndRerender((c) => c.extraHolidays.push({ date: today(), name: "Feriado provincial" }));
  for (const [attr, key] of [["rmh", "hidden"], ["rmf", "financing"], ["rmw", "waTemplates"], ["rmx", "extraHolidays"], ["rmc", "categories"]]) {
    $$(`[data-${attr}]`, el).forEach((b) => (b.onclick = () => saveAndRerender((c) => c[key].splice(Number(b.dataset[attr]), 1))));
  }
  $("#demo", el).onclick = async () => { if (await confirmBox("Los datos de ejemplo se suman a tus datos reales y se copian a todos tus dispositivos. Usalo solo para probar.", "Cargar ejemplo")) loadDemo(); };
  drawSync($("#sync-card", el));
  $("#wipe", el).onclick = async () => {
    if (!(await confirmBox("Se borran TODOS los pedidos, proveedores, productos y tareas en TODOS tus dispositivos (celular y compu). Las copias diarias de la compu no se tocan.", "Borrar todo"))) return;
    for (const c of COLLECTIONS) if (c !== "settings") await db.removeAll(c);
    toast("Datos borrados", "La copia diaria anterior sigue guardada en la compu.");
  };
  return { title: "Ajustes", sub: "Configurá TRADEX a tu medida" };
}

async function drawSync(card) {
  let status = {}, backups = null;
  try { status = await (await fetch("/api/status")).json(); } catch {}
  try { const r = await fetch("/api/backups", { headers: pinHeader() }); if (r.ok) backups = await r.json(); } catch {}
  const kb = (n) => n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`;
  card.innerHTML = `<h3>☁️ Sincronización y copias de seguridad</h3>
    <div class="row"><span id="sync-badge-st">${syncBadge()}</span><button type="button" class="btn sm" id="sync-now">${icon("wifi")} Sincronizar ahora</button></div>
    <p class="small muted" style="margin:0">Todo lo que cargás se guarda primero en este dispositivo y se sube solo a la compu. El celular y la compu se ponen al día entre sí cada vez que están conectados al mismo Wi-Fi.</p>
    ${status.pin ? `<div class="row"><label class="field grow">PIN de TRADEX<input type="password" inputmode="numeric" id="pin" value="${esc(localStorage.getItem("v-pin") || "")}" placeholder="El que pusiste en .env"></label><button type="button" class="btn primary" id="pin-save" style="align-self:flex-end">Guardar PIN</button></div>` : `<p class="small" style="margin:0">🔓 La compu no tiene PIN: cualquiera en tu Wi-Fi podría ver los datos. Agregá <code>TRADEX_PIN</code> en el archivo .env.</p>`}
    ${status.urls?.length ? `<div class="small">📱 <b>Para abrir en el celular</b> (mismo Wi-Fi): ${status.urls.map((u) => `<code>${esc(u)}</code>`).join(" o ")}</div>` : ""}
    ${backups ? `<div><div class="row" style="justify-content:space-between"><b>💾 Copias diarias en la compu (${backups.backups.length})</b><button type="button" class="btn sm soft" id="bk-now">${icon("download")} Hacer copia ahora</button></div>
      <div class="small muted">Carpeta: <code>${esc(backups.dir)}</code> · se hace una por día y se guardan 60 días + la primera de cada mes para siempre.</div>
      <div class="stack" style="gap:4px;margin-top:8px;max-height:200px;overflow:auto">${backups.backups.slice(0, 30).map((b) => `<div class="row" style="justify-content:space-between"><span>${fmtDate(b.date, { year: true })} <span class="muted small">${kb(b.size)}</span></span><button type="button" class="btn sm ghost" data-bk="${b.name}">${icon("download")}</button></div>`).join("") || `<span class="muted small">Todavía no hay copias (se crea la primera cuando cargues datos).</span>`}</div></div>`
      : `<p class="small muted" style="margin:0">No pude ver las copias de la compu ${status.pin ? "(revisá el PIN)" : "(¿está prendida?)"}.</p>`}`;
  card.querySelector("#sync-now").onclick = async () => { await syncNow(); card.querySelector("#sync-badge-st").innerHTML = syncBadge(); };
  const pinBtn = card.querySelector("#pin-save");
  if (pinBtn) pinBtn.onclick = async () => { localStorage.setItem("v-pin", card.querySelector("#pin").value.trim()); await syncNow(); toast("🔒 PIN guardado en este dispositivo"); drawSync(card); };
  const bk = card.querySelector("#bk-now");
  if (bk) bk.onclick = async () => { await syncNow(); const r = await fetch("/api/backup-now", { method: "POST", headers: pinHeader() }); toast(r.ok ? "💾 Copia hecha" : "No se pudo hacer la copia"); drawSync(card); };
  card.querySelectorAll("[data-bk]").forEach((b) => (b.onclick = async () => {
    const r = await fetch(`/api/backup-file?name=${encodeURIComponent(b.dataset.bk)}`, { headers: pinHeader() });
    if (r.ok) download(b.dataset.bk, await r.blob());
  }));
}

async function loadDemo() {
  const t = today();
  // próximos viernes / sábado para mostrar la regla de avisos
  const nextDow = (dow, weeks) => { let d = addDays(t, weeks * 7); while (new Date(d + "T12:00").getDay() !== dow) d = addDays(d, 1); return d; };
  const sur = await db.put("suppliers", { name: "Insumos Sur", contact: "Marcela", province: "Buenos Aires", phone: "11 5555-1234", alias: "insumos.sur.mp", social: "@insumossur", leadDays: 10, shippingCost: 30000, rating: 5, minimum: "caja x120, x250", notes: "Cumple siempre, buena calidad" });
  const cba = await db.put("suppliers", { name: "Serigrafía Córdoba", contact: "Pablo", province: "Córdoba", phone: "351 444-5566", alias: "serigrafia.cba", social: "@serigrafiacba", leadDays: 14, shippingCost: 65000, matrixCost: 40000, matrixNote: "Serigrafía 1 color, por diseño", rating: 4 });
  const ar = await db.put("suppliers", { name: "Botellas AR", contact: "Lucía", province: "Santa Fe", phone: "341 222-3344", social: "@botellasar", website: "botellasar.com.ar", leadDays: 7, shippingCost: 30000, rating: 3 });
  const P = [
    ["Taza cerámica blanca 11oz", "Tazas", sur.id, 2800, 36], ["Ecovaso 500cc", "Ecovasos", sur.id, 1300, 120], ["Botella aluminio 600ml", "Botellas", ar.id, 4500, 24],
    ["Botella plástica 500ml", "Botellas", ar.id, 1900, 50], ["Botella térmica acero 500ml", "Botellas", sur.id, 9800, 12], ["Vela de soja en lata", "Velas", sur.id, 2500, 24],
    ["Kit skincare mini", "Skincare", cba.id, 7200, 10], ["Caja kraft 15x15", "Cajas", sur.id, 650, 120], ["Ecovaso serigrafiado 1 color", "Ecovasos", cba.id, 1700, 250],
  ];
  const prods = [];
  for (const [name, category, supplierId, price, minQty] of P) prods.push(await db.put("products", { name, category, supplierId, price, minQty, size: category === "Botellas" ? "big" : "small", priceDate: addDays(t, -Math.floor(Math.random() * 60)), priceHistory: [{ date: addDays(t, -90), price: Math.round(price * 0.85) }, { date: t, price }] }));
  const O = [
    ["Sofía Gómez", "383 4123456", "Instagram", nextDow(6, 2), -1, "senado", [[prods[0], 40, 6500]], 100000, "Quiere la caja en dorado, con cinta rosa y sin tapa"],
    ["Martín Ruiz", "383 4987654", "WhatsApp", nextDow(5, 3), -2, "pagado", [[prods[8], 250, 3800]], 950000, "Egresados 5to B, logo en blanco"],
    ["Carla Pérez", "381 5551212", "Recomendación", addDays(t, 3), -1, "esperando", [[prods[5], 30, 6000], [prods[7], 30, 1800]], 120000, "Comunión de Juli, etiquetas lila"],
    ["Valentina Díaz", "383 4001122", "Instagram", addDays(t, 1), 0, "entregar", [[prods[6], 15, 16000]], 240000, ""],
    ["Lucas Fernández", "383 4778899", "WhatsApp", addDays(t, 40), -3, "senado", [[prods[2], 60, 10500]], 200000, "Boda, grabado con iniciales"],
    ["Ana Torres", "383 4665544", "Recomendación", addDays(t, -20), -2, "entregado", [[prods[1], 120, 3200]], 384000, ""],
  ];
  let n = db.all("orders").length;
  for (const [name, phone, channel, eventDate, dl, status, items, deposit, notes] of O) {
    const its = items.map(([p, qty, unitPrice]) => ({ product: p.name, productId: p.id, category: p.category, qty, unitPrice, unitCost: p.price + 1300 }));
    await db.put("orders", {
      number: String(++n).padStart(4, "0"), client: { name, phone, address: "San Fernando del Valle de Catamarca", dni: "" }, items: its,
      total: its.reduce((a, i) => a + i.qty * i.unitPrice, 0), deposit, paidFull: status === "pagado" || status === "entregado", eventDate, deadline: addDays(eventDate, dl), status, channel,
      shipping: ["Correo", "Retiro en local", "Moto/Uber"][n % 3], courier: ["Andreani", "Via Cargo", "Correo Argentino", "Flecha Bus Cargas"][n % 4], supplierId: items[0][0].supplierId,
      supplierOrderedAt: status === "esperando" ? addDays(t, -8) : "", notes, extraCost: 30000,
    });
  }
  await db.put("tasks", { title: "Pasar presupuesto a Lucía (egresados)", date: t, type: "cliente", urgent: true });
  await db.put("tasks", { title: "Pagar matriz de serigrafía", date: addDays(t, 2), type: "proveedor" });
  toast("✨ Datos de ejemplo cargados", "Recorré Pedidos, Calendario y Finanzas");
  syncNotifications();
}
