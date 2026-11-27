// Módulo 2 — Proveedores: ficha, calificación, demoras, envíos, matrices, catálogos PDF.
import { db, settings } from "../db.js";
import { icon, esc, money, fmtDate, waLink, num, CATEGORIES, today } from "../utils.js";
import { $, $$, modal, toast, confirmBox, readForm, options, stars, autocomplete } from "../ui.js";
import { supplierSuggestions } from "../suggest.js";
import { categoryOptions, categories, guessCategory } from "../categories.js";
import { api, aiAvailable } from "../assistant.js";

const PROVINCES = ["Buenos Aires", "CABA", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán"];
let q = "";

export const socialUrl = (s) => {
  const v = String(s || "").trim();
  if (!v) return "";
  if (/^https?:\/\//.test(v)) return v;
  if (v.startsWith("@")) return `https://instagram.com/${v.slice(1)}`;
  if (/\./.test(v)) return `https://${v}`;
  return `https://instagram.com/${v}`;
};

export function render(el) {
  const all = db.all("suppliers").sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name));
  const draw = () => {
    const list = all.filter((s) => !q || `${s.name} ${s.contact} ${s.province}`.toLowerCase().includes(q.toLowerCase()));
    $("#s-list", el).innerHTML = list.length ? `<div class="list">${list.map((s) => {
      const prods = db.all("products").filter((p) => p.supplierId === s.id);
      return `<article class="card stack" style="gap:8px">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div><h3 style="margin:0">${esc(s.name)}</h3><div class="small muted">${esc(s.contact || "")}${s.province ? ` · 📍 ${esc(s.province)}` : ""}</div></div>
          ${stars(s.rating || 0)}
        </div>
        <div class="row">
          <span class="chip">⏱️ ${s.leadDays || "?"} días de demora</span>
          <span class="chip">🚚 ${Number(s.shippingCost) === 0 && s.shippingCost !== "" ? "sin envío (misma provincia)" : `envío ${money(s.shippingCost || settings().shipSmall)}`}</span>
          ${s.matrixCost ? `<span class="chip warn">🖨️ Matriz ${money(s.matrixCost)}</span>` : ""}
          <span class="chip accent">${prods.length} productos</span>
        </div>
        ${s.alias ? `<div class="small">💳 Alias/CBU: <b>${esc(s.alias)}</b> <button class="btn ghost sm" data-copy="${esc(s.alias)}">${icon("copy")}</button></div>` : ""}
        ${s.minimum ? `<div class="small">📦 Mínimos: ${esc(s.minimum)}</div>` : ""}
        <div class="row">
          ${s.phone ? `<a class="btn wa sm" target="_blank" rel="noopener" href="${waLink(s.phone, `Hola ${s.contact || ""}! Te escribo de ${settings().businessName}. `)}">${icon("wa")} WhatsApp</a>` : ""}
          ${s.social ? `<a class="btn sm" target="_blank" rel="noopener" href="${socialUrl(s.social)}">Redes</a>` : ""}
          ${s.website ? `<a class="btn sm" target="_blank" rel="noopener" href="${socialUrl(s.website)}">${icon("globe")} Web</a>` : ""}
          <span class="grow"></span>
          <button class="btn sm" data-cat="${s.id}" title="Subir lista de precios en PDF">${icon("upload")} PDF</button>
          <button class="btn sm soft" data-edit="${s.id}">${icon("edit")}</button>
        </div>
      </article>`;
    }).join("")}</div>` : `<div class="empty card"><div class="big">🏭</div><p>Cargá tu primer proveedor o dictale a Dex: “Insumos Sur vende tazas a 2500”.</p></div>`;
    $$("[data-edit]", el).forEach((b) => (b.onclick = () => openSupplierForm(db.get("suppliers", b.dataset.edit))));
    $$("[data-cat]", el).forEach((b) => (b.onclick = () => importCatalog(b.dataset.cat)));
    $$("[data-copy]", el).forEach((b) => (b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast("Alias copiado"); }));
  };
  el.innerHTML = `<div class="stack"><div class="search">${icon("search")}<input type="search" id="s-q" placeholder="Buscar proveedor, contacto o provincia…" value="${esc(q)}"></div><div id="s-list"></div></div>`;
  $("#s-q", el).oninput = (e) => { q = e.target.value; draw(); };
  autocomplete($("#s-q", el), supplierSuggestions);
  draw();
  return {
    title: "Proveedores",
    sub: `${all.length} proveedores`,
    actions: `<button class="btn" id="imp-pdf">${icon("upload")}<span class="desktop-only">Catálogo PDF</span></button><button class="btn primary" id="new-sup">${icon("plus")}<span class="desktop-only">Nuevo proveedor</span></button>`,
    bind: (a) => { $("#new-sup", a).onclick = () => openSupplierForm(); $("#imp-pdf", a).onclick = () => importCatalog(); },
  };
}

export function openSupplierForm(s = null) {
  const isNew = !s;
  s = s ? { ...s } : { rating: 0, leadDays: 7, shippingCost: settings().shipSmall };
  const st = settings();
  modal({
    title: isNew ? "Nuevo proveedor" : `Editar ${esc(s.name)}`,
    wide: true,
    body: `<form class="stack" id="sf">
      <div class="grid g3">
        <label class="field">Nombre del proveedor *<input name="name" required value="${esc(s.name || "")}"></label>
        <label class="field">Nombre del contacto<input name="contact" value="${esc(s.contact || "")}"></label>
        <label class="field">Provincia<input name="province" list="dl-prov" value="${esc(s.province || "")}"></label>
        <label class="field">Teléfono / WhatsApp<input name="phone" type="tel" value="${esc(s.phone || "")}"></label>
        <label class="field">CBU / Alias<input name="alias" value="${esc(s.alias || "")}"></label>
        <label class="field">Red social (Instagram)<input name="social" value="${esc(s.social || "")}" placeholder="@proveedor"></label>
        <label class="field">Página web<input name="website" value="${esc(s.website || "")}"></label>
        <label class="field">Mínimos de compra<input name="minimum" value="${esc(s.minimum || "")}" placeholder="Ej: caja x120, x250"></label>
      </div>
      <datalist id="dl-prov">${PROVINCES.map((p) => `<option value="${p}">`).join("")}</datalist>
      <fieldset><legend>⏱️ Demora, envío y matrices</legend>
        <div class="grid g4">
          <label class="field">Demora (fabricar + enviar), en días<input name="leadDays" type="number" min="0" value="${s.leadDays ?? ""}"></label>
          <label class="field">Costo de envío fijo<select name="shipPreset">
            <option value="0" ${s.shippingCost !== "" && s.shippingCost != null && Number(s.shippingCost) === 0 ? "selected" : ""}>Sin envío (misma provincia) · $0</option>
            <option value="${st.shipSmall}" ${Number(s.shippingCost) === st.shipSmall ? "selected" : ""}>Pocos productos · ${money(st.shipSmall)}</option>
            <option value="${st.shipBig}" ${Number(s.shippingCost) === st.shipBig ? "selected" : ""}>Grande / pesado · ${money(st.shipBig)}</option>
            <option value="custom" ${![0, st.shipSmall, st.shipBig].includes(Number(s.shippingCost)) ? "selected" : ""}>Otro monto…</option></select></label>
          <label class="field">Monto de envío<input name="shippingCost" type="number" min="0" value="${s.shippingCost ?? ""}"></label>
          <label class="field">Cobra matriz/plancha<input name="matrixCost" type="number" min="0" value="${s.matrixCost ?? ""}" placeholder="Ej: 40000"></label>
        </div>
        <label class="field" style="margin-top:10px">Detalle de la matriz<input name="matrixNote" value="${esc(s.matrixNote || "")}" placeholder="Ej: serigrafía 1 color, se cobra una sola vez por diseño"></label>
      </fieldset>
      <fieldset><legend>⭐ Calificación</legend>
        <div class="row"><div class="stars" id="rate">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-r="${n}" class="${n <= (s.rating || 0) ? "on" : ""}">★</button>`).join("")}</div>
        <span class="small muted">según cumplimiento y calidad</span></div>
        <label class="field" style="margin-top:8px">Notas (cumplimiento, calidad, forma de pago…)<textarea name="notes">${esc(s.notes || "")}</textarea></label>
      </fieldset>
      <div class="small muted" id="lookup-res"></div>
    </form>`,
    foot: `${!isNew ? `<button class="btn danger" id="sf-del">${icon("trash")}</button>` : ""}
      <button class="btn" id="sf-look" ${aiAvailable() ? "" : 'disabled title="Necesita la IA configurada y conexión"'}>${icon("globe")} Buscar datos en internet</button>
      <button class="btn" data-close>Cancelar</button><button class="btn primary" id="sf-save">${icon("check")} Guardar</button>`,
    onMount: (el, m) => {
      const form = $("#sf", el);
      let rating = s.rating || 0;
      $$("[data-r]", el).forEach((b) => (b.onclick = () => { rating = Number(b.dataset.r); $$("[data-r]", el).forEach((x) => x.classList.toggle("on", Number(x.dataset.r) <= rating)); }));
      form.shipPreset.onchange = () => { if (form.shipPreset.value !== "custom") form.shippingCost.value = form.shipPreset.value; };
      $("#sf-look", el).onclick = async () => {
        if (!form.name.value) return toast("Escribí primero el nombre del proveedor");
        $("#lookup-res", el).textContent = "🔎 Buscando en internet…";
        const info = await lookupSupplier({ name: form.name.value, province: form.province.value });
        if (!info) { $("#lookup-res", el).textContent = "No se pudo buscar ahora."; return; }
        const filled = fillMissing(form, info);
        $("#lookup-res", el).innerHTML = filled.length ? `✅ Completé: ${filled.join(", ")}${info.source ? ` · fuente: <a href="${esc(info.source)}" target="_blank" rel="noopener">${esc(info.source)}</a>` : ""}. Revisalo antes de guardar.` : "No encontré datos nuevos públicos.";
      };
      $("#sf-del", el) && ($("#sf-del", el).onclick = async () => { if (await confirmBox(`¿Borrar a ${esc(s.name)}? Sus productos quedan sin proveedor.`, "Borrar")) { await db.remove("suppliers", s.id); m.close(); } });
      $("#sf-save", el).onclick = async () => {
        const f = readForm(form);
        if (!f.name) return form.name.focus();
        delete f.shipPreset;
        const saved = await db.put("suppliers", { ...s, ...f, rating });
        m.close();
        toast(isNew ? "✨ Proveedor guardado" : "Proveedor actualizado", saved.name);
      };
    },
  });
}

function fillMissing(form, info) {
  const map = { phone: info.phone || info.whatsapp, province: info.province, social: info.instagram || info.facebook, website: info.website };
  const filled = [];
  for (const [k, v] of Object.entries(map)) if (v && form[k] && !form[k].value) { form[k].value = v; filled.push(k === "social" ? "redes" : k === "website" ? "web" : k === "phone" ? "teléfono" : k === "address" ? "dirección" : "provincia"); }
  return filled;
}

// Busca teléfono, dirección y redes públicas del proveedor (IA + búsqueda web)
export async function lookupSupplier({ name, product = "", province = "" }) {
  if (!aiAvailable()) return null;
  try { return await api("/api/lookup", { name, product, province }); } catch (e) { toast("No se pudo buscar", e.message); return null; }
}

// Completa en segundo plano los datos que falten de un proveedor ya guardado
export async function autoCompleteSupplier(s) {
  if (s.phone && s.social) return null;
  const info = await lookupSupplier({ name: s.name, province: s.province });
  if (!info) return null;
  const patch = {};
  if (!s.phone && (info.phone || info.whatsapp)) patch.phone = info.phone || info.whatsapp;
  if (!s.social && (info.instagram || info.facebook)) patch.social = info.instagram || info.facebook;
  if (!s.website && info.website) patch.website = info.website;
  if (!s.province && info.province) patch.province = info.province;
  if (Object.keys(patch).length) await db.put("suppliers", { ...s, ...patch, lookupSource: info.source || "" });
  return { patch, source: info.source };
}

// ---------- Catálogo PDF -> productos ----------
export function importCatalog(supplierId = "") {
  const sups = db.all("suppliers");
  modal({
    title: "📄 Importar lista de precios (PDF)",
    wide: true,
    body: `<div class="stack">
      <p class="muted small" style="margin:0">Subí el PDF del proveedor y cargo todos los artículos a tus productos con su nombre de proveedor. ${aiAvailable() ? "Uso la IA para leerlo (más preciso)." : "Sin IA: leo el texto del PDF y detecto renglones con precio (revisá el resultado)."}</p>
      <div class="grid g2">
        <label class="field">Proveedor<select id="ci-sup">${options(sups.map((s) => [s.id, s.name]), supplierId, "— Nuevo proveedor —")}</select></label>
        <label class="field" id="ci-new-wrap">Nombre del nuevo proveedor<input id="ci-new" placeholder="Ej: Mayorista Souvenirs"></label>
      </div>
      <label class="field">Archivo PDF<input type="file" id="ci-file" accept="application/pdf"></label>
      <div id="ci-out"></div>
    </div>`,
    foot: `<button class="btn" data-close>Cerrar</button><button class="btn primary" id="ci-go" disabled>${icon("check")} Importar seleccionados</button>`,
    onMount: (el, m) => {
      let rows = [];
      const supSel = $("#ci-sup", el);
      const toggleNew = () => $("#ci-new-wrap", el).classList.toggle("hidden", !!supSel.value);
      supSel.onchange = toggleNew; toggleNew();
      $("#ci-file", el).onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        $("#ci-out", el).innerHTML = `<p>⏳ Leyendo ${esc(file.name)}…</p>`;
        try {
          rows = await extractCatalog(file, supSel.selectedOptions[0]?.text || $("#ci-new", el).value);
        } catch (err) {
          $("#ci-out", el).innerHTML = `<p style="color:var(--u-red)">No pude leer el PDF: ${esc(err.message)}</p>`; return;
        }
        $("#ci-out", el).innerHTML = rows.length ? `<p><b>${rows.length}</b> artículos encontrados. Podés corregir antes de importar.</p>
          <div class="table-wrap" style="max-height:340px;overflow:auto"><table><thead><tr><th></th><th>Artículo</th><th>Categoría</th><th>Precio</th><th>Mínimo</th></tr></thead><tbody>
          ${rows.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" checked></td>
            <td><input data-f="name" data-i="${i}" value="${esc(r.name)}"></td>
            <td><select data-f="category" data-i="${i}">${categoryOptions(r.category)}</select></td>
            <td><input data-f="price" data-i="${i}" type="number" value="${r.price}" style="width:110px"></td>
            <td><input data-f="minQty" data-i="${i}" type="number" value="${r.minQty || ""}" style="width:80px"></td></tr>`).join("")}
          </tbody></table></div>` : `<p>No encontré artículos con precio en ese PDF.</p>`;
        $$("[data-f]", el).forEach((inp) => (inp.onchange = () => { rows[inp.dataset.i][inp.dataset.f] = inp.type === "number" ? Number(inp.value) : inp.value; }));
        $("#ci-go", el).disabled = !rows.length;
      };
      $("#ci-go", el).onclick = async () => {
        let sid = supSel.value;
        if (!sid) {
          const name = $("#ci-new", el).value.trim();
          if (!name) return toast("Poné el nombre del proveedor");
          sid = (await db.put("suppliers", { name, rating: 0, leadDays: 7, shippingCost: settings().shipSmall })).id;
        }
        const chosen = $$('input[type=checkbox][data-i]', el).filter((c) => c.checked).map((c) => rows[c.dataset.i]);
        const existing = db.all("products").filter((p) => p.supplierId === sid);
        let created = 0, updated = 0;
        for (const r of chosen) {
          const prev = existing.find((p) => p.name.toLowerCase() === r.name.toLowerCase());
          if (prev) {
            if (Number(prev.price) !== Number(r.price)) { prev.priceHistory = [...(prev.priceHistory || []), { date: today(), price: Number(r.price) }]; prev.priceDate = today(); }
            await db.put("products", { ...prev, price: Number(r.price), minQty: r.minQty || prev.minQty, category: r.category || prev.category }); updated++;
          } else {
            await db.put("products", { name: r.name, category: r.category || guessCategory(r.name), price: Number(r.price), minQty: r.minQty || "", supplierId: sid, priceDate: today(), priceHistory: [{ date: today(), price: Number(r.price) }] }); created++;
          }
        }
        m.close();
        toast("📄 Catálogo importado", `${created} productos nuevos, ${updated} precios actualizados`);
      };
    },
  });
}

async function extractCatalog(file, supplierName) {
  const buf = await file.arrayBuffer();
  if (aiAvailable()) {
    const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(file); });
    try {
      const out = await api("/api/catalog", { pdfBase64: b64, supplierName });
      if (out?.products?.length) return out.products.filter((p) => p.name && p.price > 0);
    } catch (e) { toast("La IA no pudo leerlo, pruebo en modo local", e.message); }
  }
  // Modo local con pdf.js: cada renglón con un precio se vuelve un artículo
  const pdfjs = await import("/vendor/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const rows = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    const lines = new Map();
    for (const it of content.items) {
      const y = Math.round(it.transform[5]);
      lines.set(y, `${lines.get(y) || ""} ${it.str}`);
    }
    for (const line of [...lines.entries()].sort((a, b) => b[0] - a[0]).map((x) => x[1].replace(/\s+/g, " ").trim())) {
      const m = line.match(/^(.*?[a-záéíóúñ].*?)\s*\$\s*([\d.]+(?:,\d{1,2})?)/i) || line.match(/^(.*?[a-záéíóúñ].*?)\s+([\d]{1,3}(?:\.\d{3})+(?:,\d{1,2})?)\s*$/i);
      if (!m) continue;
      const name = m[1].replace(/[-–:|.]+$/, "").trim();
      const price = num(m[2]);
      if (name.length < 3 || !price) continue;
      const min = line.match(/x\s?(\d{2,4})\b/i);
      rows.push({ name, price, minQty: min ? Number(min[1]) : "", category: guessCategory(name) });
    }
  }
  return rows;
}


export { fmtDate };
