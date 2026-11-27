// "Dex", la asistente por voz.
// Le dictás "Sofía me compró 40 tazas para el sábado 20" y te va preguntando lo que falta,
// completando la ficha sola. También guarda precios de proveedores, busca los productos más baratos
// y anota tareas. Con IA (ANTHROPIC_API_KEY) entiende frases libres y busca datos de proveedores en internet;
// sin IA usa un intérprete local que funciona offline.
import { db, settings, pinHeader } from "./db.js";
import {
  icon, esc, money, fmtDate, today, addDays, parseISO, iso, num, DOW, MONTHS, CHANNELS, SHIPPING, COURIERS, CATEGORIES,
  cuotasOptions, cuotasMessage,
} from "./utils.js";
import { $, $$, toast } from "./ui.js";
import { guessCategory } from "./categories.js";

let aiOn = false;
export const aiAvailable = () => aiOn && navigator.onLine;
// El dictado solo anda con Chrome en una conexión segura (localhost o https). En el celular por Wi-Fi (http://IP) no:
// ahí Dex se usa escribiendo.
export const voiceAvailable = () => !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) && window.isSecureContext;

export async function api(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...pinHeader() }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// ---------------- estado ----------------
const S = { open: false, messages: [], intent: "none", draft: null, pending: null, skipped: new Set(), tts: localStorage.getItem("v-tts") !== "0", handsFree: false, listening: false, busy: false };
let rec = null;
let lastChanged = new Set();

const LABELS = {
  order: { clientName: "Cliente", items: "Productos", total: "Total", deposit: "Seña", eventDate: "Evento", deadline: "Entrega", phone: "Teléfono", address: "Dirección", dni: "DNI", channel: "Canal", shipping: "Envío", courier: "Transporte prov.", notes: "Notas" },
  supplier_price: { supplierName: "Proveedor", product: "Producto", category: "Categoría", price: "Precio", packQty: "Precio por", minQty: "Mínimo", shippingCost: "Envío", province: "Provincia", phone: "Teléfono", social: "Redes" },
  agenda: { title: "Tarea", date: "Fecha", type: "Tipo" },
};
const emptyDraft = (intent) => ({
  order: { clientName: "", phone: "", address: "", dni: "", items: [], total: 0, deposit: 0, eventDate: "", deadline: "", channel: "", shipping: "", courier: "", notes: "" },
  supplier_price: { supplierName: "", product: "", category: "", price: 0, packQty: 0, minQty: 0, shippingCost: 0, province: "", phone: "", social: "" },
  agenda: { title: "", date: "", type: "" },
}[intent] || null);

// ---------------- UI ----------------
export function initAssistant() {
  fetch("/api/status").then((r) => r.json()).then((d) => { aiOn = !!d.ai; }).catch(() => {});
  $("#fab").onclick = () => (S.open ? closeAssistant() : openAssistant(true));
}

export function openAssistant(listen = false) {
  S.open = true;
  const root = $("#assistant-root");
  root.innerHTML = `
  <div class="assistant" role="dialog" aria-label="Asistente Dex">
    <div class="as-head">
      <div class="av">D</div>
      <div class="grow"><b>Dex</b><div class="small" style="opacity:.85">${aiAvailable() ? "Asistente inteligente · IA" : "Asistente · modo local"}</div></div>
      <button class="btn icon sm" id="as-tts" title="Leer respuestas en voz alta">${icon("speaker")}</button>
      <button class="btn icon sm" id="as-close" title="Cerrar">${icon("x")}</button>
    </div>
    <div class="as-msgs" id="as-msgs"></div>
    <div class="suggest" id="as-sug"></div>
    <div class="as-draft hidden" id="as-draft"></div>
    <form class="as-input" id="as-form">
      ${voiceAvailable() ? `<button type="button" class="mic" id="as-mic" title="Hablar">${icon("mic")}</button>` : ""}
      <input id="as-text" placeholder="${voiceAvailable() ? "Escribí o tocá el micrófono…" : "Escribile a Dex…"}" autocomplete="off" enterkeyhint="send">
      <button class="btn icon primary" title="Enviar">${icon("send")}</button>
    </form>
  </div>`;
  $("#as-close").onclick = closeAssistant;
  $("#as-tts").style.opacity = S.tts ? 1 : 0.5;
  $("#as-tts").onclick = () => { S.tts = !S.tts; localStorage.setItem("v-tts", S.tts ? "1" : "0"); $("#as-tts").style.opacity = S.tts ? 1 : 0.5; if (!S.tts) speechSynthesis?.cancel(); };
  $("#as-form").onsubmit = (e) => { e.preventDefault(); const v = $("#as-text").value.trim(); if (v) { $("#as-text").value = ""; S.handsFree = false; send(v); } };
  if ($("#as-mic")) $("#as-mic").onclick = () => { if (S.listening) { S.handsFree = false; stopListening(); } else { S.handsFree = true; startListening(); } };
  if (!S.messages.length) botSay(`¡Hola! Soy Dex 💜 Contame qué pasó: “Sofía me compró 40 tazas para el sábado 20”, “Insumos Sur vende ecovasos a 1300” o “pasame las 3 botellas más baratas”.`, { silent: true });
  else drawMessages();
  drawDraft();
  drawSuggestions();
  if (listen && voiceAvailable()) startListening();
  else if (!S.messages.some((m) => m.role === "user")) setTimeout(() => $("#as-text")?.focus(), 250);
}

function closeAssistant() {
  S.open = false; S.handsFree = false;
  stopListening(); speechSynthesis?.cancel();
  $("#assistant-root").innerHTML = "";
}

function drawMessages() {
  const box = $("#as-msgs");
  if (!box) return;
  box.innerHTML = S.messages.map((m) => `<div class="msg ${m.role === "user" ? "me" : "bot"}">${m.html || esc(m.content)}</div>`).join("") + (S.busy ? `<div class="msg bot typing">Dex está pensando…</div>` : "");
  box.scrollTop = box.scrollHeight;
  $$("[data-as-act]", box).forEach((b) => (b.onclick = () => runAction(b.dataset.asAct, b.dataset.id)));
}

function drawSuggestions() {
  const el = $("#as-sug");
  if (!el) return;
  const list = S.intent === "none"
    ? ["Nuevo pedido", "Guardar precio de proveedor", "Las 3 botellas más baratas", "Recordame algo urgente"]
    : S.pending === "confirm" ? ["Sí, guardalo", "Cancelar"] : ["No sé", "Saltear", "Cancelar"];
  el.innerHTML = list.map((s) => `<button>${s}</button>`).join("");
  $$("button", el).forEach((b) => (b.onclick = () => { S.handsFree = false; send(b.textContent === "Nuevo pedido" ? "Quiero cargar un pedido nuevo" : b.textContent === "Guardar precio de proveedor" ? "Quiero guardar un precio de proveedor" : b.textContent === "Recordame algo urgente" ? "Quiero anotar algo urgente para hoy" : b.textContent); }));
}

function drawDraft() {
  const el = $("#as-draft");
  if (!el) return;
  const d = S.draft, labels = LABELS[S.intent];
  if (!d || !labels) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const show = (k, v) => {
    if (k === "items") return v.length ? v.map((i) => `${i.qty || "?"} × ${esc(i.product)}${i.unitPrice ? ` a ${money(i.unitPrice)}` : ""}`).join("<br>") : "";
    if (/Date$|^deadline$|^date$/.test(k)) return v ? fmtDate(v, { long: true }) : "";
    if (k === "shippingCost" && v === -1) return "Sin envío (misma provincia)";
    if (k === "packQty") return v > 1 ? `${v} unidades (${money((d.price || 0) / v)} c/u)` : v === 1 ? "1 unidad" : "";
    if (["total", "deposit", "price", "shippingCost"].includes(k)) return v ? money(v) : "";
    return esc(v || "");
  };
  el.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:6px"><b>${S.intent === "order" ? "🛍️ Ficha del pedido" : S.intent === "agenda" ? "📌 Tarea" : "🏭 Precio de proveedor"}</b><span class="small muted">se completa sola</span></div>
    <div class="kv">${Object.entries(labels).map(([k, l]) => `<span>${l}</span><span class="${lastChanged.has(k) ? "new" : ""}">${show(k, d[k]) || '<span class="muted">—</span>'}</span>`).join("")}</div>`;
}

function botSay(text, { html = "", silent = false }: Rec = {}) {
  S.messages.push({ role: "assistant", content: text, html: html ? `${esc(text)}${html}` : "" });
  drawMessages();
  if (!silent) speak(text);
  else if (S.handsFree) setTimeout(startListening, 300);
}

// ---------------- voz ----------------
function speak(text) {
  if (!S.tts || !("speechSynthesis" in window)) { if (S.handsFree && S.intent !== "none") setTimeout(startListening, 300); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[💜✨🛍️📌🏭✅⚠️🔎]/gu, ""));
  u.lang = "es-AR";
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find((v) => v.lang === "es-AR") || voices.find((v) => v.lang === "es-US") || voices.find((v) => v.lang?.startsWith("es")) || null;
  u.rate = 1.05;
  u.onend = () => { if (S.handsFree && S.open && S.intent !== "none") startListening(); };
  speechSynthesis.speak(u);
}

function startListening() {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) { toast("Tu navegador no tiene reconocimiento de voz", "Usá Google Chrome (en la compu o Android). Mientras tanto podés escribir."); S.handsFree = false; return; }
  if (S.listening || S.busy) return;
  speechSynthesis?.cancel();
  rec = new SR();
  rec.lang = "es-AR";
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = "";
  rec.onresult = (e) => {
    let interim = "";
    for (const r of e.results) (r.isFinal ? (finalText = r[0].transcript) : (interim += r[0].transcript));
    const input = $("#as-text");
    if (input) input.value = finalText || interim;
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed") toast("Permiso de micrófono denegado", "Habilitalo en el candado de la barra de direcciones.");
    else if (e.error === "network") toast("El dictado necesita internet", "Podés escribir: todo lo demás funciona sin conexión.");
    S.handsFree = false;
  };
  rec.onend = () => {
    S.listening = false;
    $("#as-mic")?.classList.remove("rec");
    const input = $("#as-text");
    const text = (finalText || input?.value || "").trim();
    if (text) { if (input) input.value = ""; send(text); }
  };
  S.listening = true;
  $("#as-mic")?.classList.add("rec");
  try { rec.start(); } catch { S.listening = false; }
}
function stopListening() {
  try { rec?.stop(); } catch {}
  S.listening = false;
  $("#as-mic")?.classList.remove("rec");
}

// ---------------- conversación ----------------
async function send(text) {
  S.messages.push({ role: "user", content: text });
  if (/^(cancel|cancelar|olvidate|borr[aá] todo)/i.test(text.trim())) { reset(); botSay("Listo, lo cancelé. ¿Qué más necesitás?"); drawDraft(); drawSuggestions(); return; }
  if ((S.intent === "none" || S.intent === "query") && answerCuotas(text)) return;
  if ((S.intent === "none" || S.intent === "query") && answerCombos(text)) return;
  S.busy = true; drawMessages();
  const before = JSON.stringify(S.draft || {});
  let turn;
  try {
    turn = aiAvailable() ? await aiTurn() : localTurn(text);
  } catch (e) {
    console.warn("IA no disponible, uso modo local:", (e as Error).message);
    turn = localTurn(text);
  }
  S.busy = false;
  // marcar campos que cambiaron para resaltarlos
  const prev = JSON.parse(before);
  lastChanged = new Set(Object.keys(S.draft || {}).filter((k) => JSON.stringify(S.draft[k]) !== JSON.stringify(prev[k]) && (Array.isArray(S.draft[k]) ? S.draft[k].length : S.draft[k])));
  drawDraft();
  if (S.intent === "query" && turn.query) return answerQuery(turn.query, turn.reply);
  if (turn.ready) return commit(turn.reply);
  botSay(turn.reply);
  drawSuggestions();
}

async function aiTurn() {
  const context = {
    today: today(),
    clients: db.all("clients").map((c) => c.name),
    suppliers: db.all("suppliers").map((s) => s.name),
  };
  const out = await api("/api/assistant", { messages: S.messages.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content })), draft: S.draft, intent: S.intent, context });
  if (!out?.reply) throw new Error("respuesta vacía");
  S.intent = out.intent;
  if (out.intent === "order") S.draft = out.order;
  else if (out.intent === "supplier_price") S.draft = out.supplierPrice;
  else if (out.intent === "agenda") S.draft = out.agenda;
  else if (out.intent !== "query") S.draft = null;
  S.pending = out.ready ? null : S.pending;
  return { reply: out.reply, ready: out.ready && S.intent !== "query", query: out.intent === "query" ? out.query : null };
}

function reset() { S.intent = "none"; S.draft = null; S.pending = null; S.skipped = new Set(); lastChanged = new Set(); }

// ---------------- guardar ----------------
async function commit(reply) {
  const d = S.draft, intent = S.intent;
  reset();
  drawDraft(); drawSuggestions();
  if (intent === "order") {
    const { saveOrder } = await import("./views/orders.js");
    const { unitCostFor } = await import("./views/products.js");
    const products = db.all("products");
    const items = (d.items || []).filter((i) => i.product).map((i) => {
      const p = products.find((x) => x.name.toLowerCase().includes(i.product.toLowerCase()) || i.product.toLowerCase().includes(x.name.toLowerCase()));
      return { product: i.product, qty: Number(i.qty) || 1, unitPrice: Number(i.unitPrice) || 0, unitCost: p ? unitCostFor(p, Number(i.qty) || 1) : 0, productId: p?.id || "", category: p?.category || guessCat(i.product) };
    });
    let total = Number(d.total) || items.reduce((a, i) => a + i.qty * i.unitPrice, 0);
    if (total && items.length === 1 && !items[0].unitPrice) items[0].unitPrice = Math.round(total / items[0].qty);
    const o = await saveOrder({
      // saveOrder busca la ficha del cliente (por teléfono, DNI o nombre) y completa lo que falte
      client: { name: d.clientName, phone: d.phone || "", address: d.address || "", dni: d.dni || "" },
      items, total, deposit: Math.max(0, Number(d.deposit) || 0), paidFull: Number(d.deposit) >= total && total > 0,
      eventDate: d.eventDate, deadline: d.deadline || (d.eventDate ? addDays(d.eventDate, -1) : ""), channel: d.channel, shipping: d.shipping, courier: d.courier, notes: d.notes,
      status: Number(d.deposit) >= total && total > 0 ? "pagado" : "senado", supplierId: items.find((i) => i.productId) ? db.get("products", items.find((i) => i.productId).productId)?.supplierId : "",
    });
    const sat = o.eventDate && [5, 6].includes(parseISO(o.eventDate).getDay());
    botSay(`¡Listo! Guardé el pedido de ${o.client.name} por ${money(o.total)}.${sat ? " Como es para un fin de semana, te aviso 3 y 2 semanas antes para pedirle al proveedor." : ""}`,
      { html: `<div class="row" style="margin-top:8px"><button class="btn sm soft" data-as-act="order" data-id="${o.id}">Ver pedido</button><button class="btn sm" data-as-act="receipt" data-id="${o.id}">Comprobante PDF</button></div>` });
  } else if (intent === "supplier_price") {
    await saveSupplierPrice(d);
  } else if (intent === "agenda") {
    await db.put("tasks", { title: d.title, date: d.date || today(), type: d.type || "trabajo", urgent: /urgent/i.test(S.messages.slice(-6).map((m) => m.content).join(" ")), done: false });
    const { syncNotifications } = await import("./alerts.js");
    syncNotifications();
    botSay(`Anotado en la agenda para el ${fmtDate(d.date || today(), { long: true })}: ${d.title}.`);
  }
}

async function saveSupplierPrice(d) {
  const { saveProduct } = await import("./views/products.js");
  const { autoCompleteSupplier } = await import("./views/suppliers.js");
  const st = settings();
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
  let sup = db.all("suppliers").find((s) => norm(s.name) === norm(d.supplierName)) || db.all("suppliers").find((s) => norm(s.name).includes(norm(d.supplierName)) || norm(d.supplierName).includes(norm(s.name)));
  const isNewSup = !sup;
  sup = await db.put("suppliers", {
    ...(sup || { name: d.supplierName, rating: 0, leadDays: 7, shippingCost: st.shipSmall }),
    ...(d.province && !sup?.province ? { province: d.province } : {}),
    ...(d.phone && !sup?.phone ? { phone: d.phone } : {}),
    ...(d.social && !sup?.social ? { social: d.social } : {}),
  });
  const prev = db.all("products").find((p) => p.supplierId === sup.id && norm(p.name) === norm(d.product));
  const ship = Number(d.shippingCost) || 0;
  const packQty = Number(d.packQty) > 1 ? Number(d.packQty) : 0; // el precio dicho era por varias unidades
  const pack = packQty ? { priceMode: "pack", packPrice: Number(d.price) || 0, packQty } : { priceMode: "unit" };
  await saveProduct({
    ...(prev || {}), name: prev?.name || cap(d.product), category: d.category || prev?.category || guessCat(d.product), supplierId: sup.id,
    price: packQty ? (Number(d.price) || 0) / packQty : Number(d.price) || 0, ...pack, minQty: d.minQty || (packQty || "") || prev?.minQty || "",
    ...(ship === -1 ? { size: "none", shipping: "" } : ship ? (ship === st.shipBig ? { size: "big", shipping: "" } : ship === st.shipSmall ? { size: "small", shipping: "" } : { shipping: ship }) : {}),
  });
  const unitNow = packQty ? Number(d.price) / packQty : Number(d.price);
  const change = prev && Math.round(prev.price) !== Math.round(unitNow) ? ` (antes ${money(prev.price)} c/u)` : "";
  botSay(`Guardé ${d.product} de ${sup.name} a ${packQty ? `${money(d.price)} las ${packQty} unidades (${money(d.price / packQty)} c/u)` : money(d.price)}${change}.${isNewSup ? " Cargué al proveedor nuevo." : ""}`);
  if (!sup.phone || !sup.social) {
    if (!aiAvailable()) { botSay(`A ${sup.name} le faltan teléfono o redes. Con la IA activa los busco en internet; por ahora completalos en Proveedores.`, { silent: true }); return; }
    botSay(`🔎 Busco en internet el teléfono y las redes de ${sup.name}…`, { silent: true });
    const r = await autoCompleteSupplier(db.get("suppliers", sup.id));
    const p = r?.patch || {};
    const got = [p.phone && `teléfono ${p.phone}`, p.social && `redes ${p.social}`, p.website && `web ${p.website}`, p.address && `dirección ${p.address}`].filter(Boolean);
    botSay(got.length ? `Encontré: ${got.join(", ")}. Lo guardé en la ficha; revisalo por las dudas.` : `No encontré datos públicos de ${sup.name}. Podés cargarlos a mano.`,
      { html: r?.source ? `<div class="small" style="margin-top:6px">Fuente: <a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.source)}</a></div>` : "" });
  }
}

async function answerQuery(q, reply) {
  const { findProducts, suggestedPrice, productShipping } = await import("./views/products.js");
  const { socialUrl } = await import("./views/suppliers.js");
  const list = findProducts({ search: q.search, sort: q.sort || "cheapest", limit: q.limit || 3 });
  S.intent = "none"; S.draft = null; drawDraft(); drawSuggestions();
  if (!list.length) return botSay(`No tengo productos cargados que coincidan con “${q.search}”. Podés cargarlos en Productos o importar un PDF del proveedor.`);
  const rows = list.map((p) => {
    const s = db.get("suppliers", p.supplierId);
    const sug = suggestedPrice(p);
    return `<div class="result-mini"><div class="thumb">${p.image ? `<img src="${p.image}">` : "📦"}</div>
      <div class="grow small"><b>${esc(p.name)}</b> — <b>${money(p.price)}</b><br>
      🏭 ${esc(s?.name || "s/proveedor")}${s?.rating ? ` ${"★".repeat(s.rating)}` : ""} · precio del ${fmtDate(p.priceDate, { year: true })}<br>
      ${s?.social ? `<a href="${esc(socialUrl(s.social))}" target="_blank" rel="noopener">${esc(s.social)}</a> ` : ""}${s?.website ? `<a href="${esc(socialUrl(s.website))}" target="_blank" rel="noopener">web</a>` : ""}
      ${s?.phone ? ` · 📞 ${esc(s.phone)}` : ""}<br>Venta sugerida: <b>${money(sug.unit)}</b> c/u (x${sug.qty})</div></div>`;
  }).join("");
  // Recomendación: menor costo final por unidad (incluye envío) y mejor calificación
  const ranked = list.map((p) => {
    const qty = Number(p.minQty) || 1;
    return { p, s: db.get("suppliers", p.supplierId), landed: (p.price * qty + productShipping(p)) / qty };
  }).sort((a, b) => a.landed - b.landed || (b.s?.rating || 0) - (a.s?.rating || 0));
  const best = ranked[0];
  const old = list.filter((p) => p.priceDate && p.priceDate < addDays(today(), -60));
  let rec = `Te recomiendo ${best.p.name} de ${best.s?.name || "ese proveedor"}: con el envío te queda en ${money(best.landed)} por unidad.`;
  if (ranked[1] && best.s?.rating && ranked[1].s?.rating > best.s.rating) rec += ` Ojo: ${ranked[1].s.name} tiene mejor calificación.`;
  if (old.length) rec += ` Hay ${old.length === 1 ? "un precio" : "precios"} de hace más de 2 meses, conviene confirmarlo.`;
  botSay(`${reply && !/busco/i.test(reply) ? reply + " " : ""}Estas son las ${list.length} opciones ${q.sort === "expensive" ? "más caras" : "más baratas"} de ${q.search || "tu catálogo"}. ${rec}`, { html: `<div>${rows}</div>` });
}

// "Presupuesto de 13 vasos con valijita chica, luego con valija XL…" -> se arma acá con la lista del proveedor
// (sin IA, siempre exacto): precio por unidad de cada cosa y el precio del combo del proveedor, sin envío ni ganancia
const nrm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
// rasgos que distinguen un producto de otro (para elegir el suelto y el combo correctos)
const FEATS = { xl: /\bxl\b|grande|maxi/, masa: /masa|cortante|amasar/, palo: /amasar|palo|palito/, lavable: /lavable|prueba de agua|agua/, glitter: /glitter/ };
const feats = (t) => new Set(Object.keys(FEATS).filter((k) => FEATS[k].test(nrm(t))));
const KINDS: [string, RegExp][] = [["vaso", /vaso|milkshake|milk shake/], ["valija", /valij|valija/], ["lunchera", /lunch|lonch/], ["bolsita", /bolsit/]];
const kindOf = (t) => KINDS.find(([, re]) => re.test(nrm(t)))?.[0];

function answerCombos(text) {
  const x = nrm(text);
  if (!/presupuest|combo|cotiz/.test(x) || !/\bcon\b/.test(x)) return false;
  const qty = Number((words2num(x).match(/\b(\d{1,4})\b/) || [])[1]) || 1;
  // proveedor nombrado en el mensaje (el que más palabras comparte)
  const sups = db.all("suppliers").map((s) => ({ s, hits: nrm(s.name).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && x.includes(w)).length })).sort((a, b) => b.hits - a.hits);
  const sup = sups[0]?.hits ? sups[0].s : null;
  const prods = db.all("products").filter((p) => p.price && (!sup || p.supplierId === sup.id));
  const loose = prods.filter((p) => !/combo/i.test(p.category || "") && !/^combo/i.test(p.name));
  const combos = prods.filter((p) => /combo/i.test(p.category || "") || /^combo/i.test(p.name));
  const wantsWater = FEATS.lavable.test(x);
  // cada combo pedido: "13 vasos milkshake con valijita chica", "luego 13 vasos con valija grande XL"…
  const segs = x.split(/\b(?:y\s+)?(?:luego|despues|tambien)\b|;|\n/).filter((sg) => /\bcon\b/.test(sg) && KINDS.some(([, re]) => re.test(sg)));
  if (!segs.length) return false;
  const pick = (desc, kind) => {
    const want = feats(desc);
    if (kind === "vaso" && wantsWater) want.add("lavable");
    if (kind !== "vaso") want.delete("lavable"); // "a prueba de agua" es del vaso
    const ok = loose.filter((p) => kindOf(p.name) === kind);
    // los que tienen todo lo pedido y nada de más; si no hay, los que tienen todo lo pedido; y de esos el más barato
    const exact = ok.filter((p) => { const f = feats(p.name); return [...want].every((k) => f.has(k)) && [...f].every((k) => want.has(k)); });
    const enough = ok.filter((p) => [...want].every((k) => feats(p.name).has(k)));
    return (exact.length ? exact : enough).sort((a, b) => a.price - b.price)[0];
  };
  const out = segs.map((sg) => {
    const parts = sg.split(/\bcon\b/).map((t) => t.trim()).filter(Boolean);
    // "valijita que tiene adentro masa…": lo que viene después del primer "con" es una sola cosa
    // cada parte termina donde termina la oración ("… palito de amasar. Dame el precio…")
    const comps = [parts[0], parts.slice(1).join(" con ").split(/[.!?](?:\s|$)/)[0]].map((t) => ({ t, kind: kindOf(t) })).filter((c) => c.kind);
    const items = comps.map((c) => ({ ...c, p: pick(c.t, c.kind) }));
    const all = new Set(items.flatMap((i) => (i.p ? [...feats(i.p.name)] : [])));
    const kinds = new Set(items.map((i) => i.kind));
    const combo = combos.filter((c) => { const f = feats(c.name); return [...kinds].every((k) => nrm(c.name).includes(k === "valija" ? "vali" : k)) && [...all].every((k) => f.has(k)) && [...f].every((k) => all.has(k)); })
      .sort((a, b) => a.price - b.price)[0];
    return { items, combo, sum: items.reduce((a, i) => a + (i.p?.price || 0), 0) };
  });
  if (!out.some((o) => o.items.some((i) => i.p))) return false;
  S.intent = "none"; S.draft = null; drawDraft(); drawSuggestions();
  const uniq = [...new Map(out.flatMap((o) => o.items.filter((i) => i.p).map((i) => [i.p.id, i.p]))).values()];
  const html = `<div class="small" style="margin-top:6px"><b>1. Precio por unidad en la lista</b>${uniq.map((p) => `<div>• ${esc(p.name)} — <b>${money(p.price)}</b>${p.minQty ? ` <span class="muted">(mínimo ${esc(String(p.minQty))} suelto)</span>` : ""}</div>`).join("")}
    <b style="display:block;margin-top:8px">2. Combo del proveedor (x${qty}, sin envío ni ganancia)</b>
    ${out.map((o, i) => `<div style="margin-top:4px">${i + 1}) ${o.items.map((it) => esc(it.p?.name || `${it.t} (no lo encontré)`)).join(" + ")}<br>
      Suelto: ${money(o.sum)} c/u · ${o.combo ? `Combo “${esc(o.combo.name)}”: <b>${money(o.combo.price)}</b> c/u → <b>${money(o.combo.price * qty)}</b>` : `sin combo en la lista → <b>${money(o.sum * qty)}</b>`}</div>`).join("")}
    ${sup ? `<div class="muted" style="margin-top:6px">🏭 ${esc(sup.name)}${uniq[0]?.priceDate ? ` · precios del ${fmtDate(uniq[0].priceDate, { year: true })}` : ""}</div>` : ""}</div>`;
  const total = out.map((o, i) => `${i + 1}) ${money((o.combo?.price || o.sum) * qty)}`).join(", ");
  botSay(`Te armé el presupuesto de ${out.length} combo${out.length === 1 ? "" : "s"} x${qty}${sup ? ` con ${sup.name}` : ""}: ${total}.`, { html });
  return true;
}

// "¿Cuánto sale en 6 cuotas si quiero 150 mil?" -> se calcula acá con las tasas de Naranja X (sin IA, siempre exacto)
function answerCuotas(text) {
  if (!/cuota|financ|tarjeta|naranja|plan z|nave|link de pago/i.test(text)) return false;
  const amounts = [...words2num(text).matchAll(/\$?\s*(\d[\d.,]*)\s*(mil|k|lucas)?/gi)].map((m) => parseMoney(m[0])).filter((v) => v >= 1000);
  if (!amounts.length) return false;
  const amount = Math.max(...amounts);
  const medio = /nave/i.test(text) ? 1 : 0;
  const mode = /(le cobro|si cobro|cobrando|me queda|me quedan)/i.test(text) ? "gross" : "net";
  const asked = Number((text.match(/(\d{1,2})\s*cuotas/i) || [])[1]) || 0;
  const rows = cuotasOptions(amount, { medio, mode });
  const pick = rows.filter((r) => (asked ? r.n === asked : [3, 6, 12].includes(r.n) && r.key !== "cuenta" && r.key !== "debito"));
  const head = mode === "net" ? `Para que te queden limpios ${money(amount)} con ${rows[0].medio}` : `Si le cobrás ${money(amount)} con ${rows[0].medio}`;
  const say = pick.length
    ? `${head}: ${pick.map((r) => (mode === "net" ? (r.n > 1 ? `${r.n} cuotas de ${money(r.cuota)}, total ${money(r.price)}` : `${r.label}: ${money(r.price)}`) : `${r.label}, te quedan ${money(r.net)}`)).join("; ")}. Transferencia: ${money(rows[0][mode === "net" ? "price" : "net"])}.`
    : `${head}. Te dejo todas las opciones.`;
  const table = `<table style="margin-top:8px;font-size:12.5px"><thead><tr><th>Forma</th><th class="right">Cobrar</th><th class="right">Cuotas</th><th class="right">Te queda</th></tr></thead><tbody>
    ${rows.map((r) => `<tr style="${r.n === asked && r.key.startsWith("c") ? "background:var(--accent-soft)" : ""}"><td>${esc(r.label)}</td><td class="right nowrap"><b>${money(r.price)}</b></td><td class="right nowrap">${r.planZ ? "a elección" : r.n > 1 ? `${r.n}×${money(r.cuota)}` : "1 pago"}</td><td class="right nowrap">${money(r.net)}</td></tr>`).join("")}
    </tbody></table><div class="small muted" style="margin-top:4px">Incluye comisión + 21% IVA (no recuperable en monotributo) y financiación.</div>
    <div class="row" style="margin-top:8px"><button class="btn sm soft" data-as-act="copycuotas" data-id="${amount}|${medio}|${mode}">Copiar mensaje para el cliente</button></div>`;
  botSay(say, { html: table });
  return true;
}

async function runAction(act, id) {
  if (act === "copycuotas") { const [a, medio, mode] = id.split("|"); navigator.clipboard?.writeText(cuotasMessage(Number(a), { medio: Number(medio), mode })); toast("Mensaje copiado", "Pegalo en el chat del cliente"); return; }
  if (act === "order") { const { openOrderDetail } = await import("./views/orders.js"); openOrderDetail(id); }
  if (act === "receipt") { const { printReceipt } = await import("./receipt.js"); printReceipt(db.get("orders", id)); }
}

// =====================================================================
// Intérprete local (sin IA): detecta la intención, extrae datos y pregunta lo que falta.
// =====================================================================
const NUMS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100, ciento: 100, doscientos: 200, trescientos: 300 };
const SKIP = /^(no s[eé]|nose|no|saltear|salte[aá]|despu[eé]s|ninguno|ninguna|nada|no tiene|no lo s[eé]|pas[aá]|siguiente)\.?$/i;
const YES = /^(s[ií]|dale|ok|okey|guard[aá]lo|guardalo|guardar|listo|perfecto|confirmo|correcto|de una|s[ií],? guardalo)(?=$|[\s,.!])/i;

const cap = (s) => String(s || "").trim().replace(/^\p{L}/u, (c) => c.toUpperCase());
const guessCat = (name) => guessCategory(String(name || ""));
function words2num(t) { return t.replace(/\b(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce|quince|veinte|treinta|cuarenta|cincuenta|cien|ciento|doscientos|trescientos)\b/gi, (w) => NUMS[w.toLowerCase()]); }

// "$65.000", "65 mil", "2800", "1,5 millones"
export function parseMoney(t) {
  const m = String(t).match(/\$?\s*(\d+(?:[.,]\d+)*)\s*(mil|k|lucas|millones|mill[oó]n)?/i);
  if (!m) return 0;
  let v = num(m[1]);
  if (/^\d+,\d+$/.test(m[1])) v = Number(m[1].replace(",", "."));
  if (m[2] && /mil|k|lucas/i.test(m[2])) v *= 1000;
  if (m[2] && /mill/i.test(m[2])) v *= 1000000;
  return Math.round(v);
}

// "el sábado 20", "20 de diciembre", "20/12", "mañana", "en 2 semanas", "el viernes que viene"
export function parseDateES(text, base = today()) {
  const t = String(text).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const b = parseISO(base);
  const fut = (d) => { if (iso(d) < base) d.setFullYear(d.getFullYear() + 1); return iso(d); };
  let m;
  if ((m = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : b.getFullYear();
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
    return m[3] ? iso(d) : fut(d);
  }
  const months = MONTHS.map((x) => x.normalize("NFD").replace(/\p{M}/gu, ""));
  if ((m = t.match(new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${months.join("|")})`)))) return fut(new Date(b.getFullYear(), months.indexOf(m[2]), Number(m[1])));
  if (/\bpasado manana\b/.test(t)) return addDays(base, 2);
  if (/\bmanana\b/.test(t)) return addDays(base, 1);
  if (/\bhoy\b/.test(t)) return base;
  if ((m = t.match(/\ben\s+(\d+)\s+(dia|semana|mes)/))) return addDays(base, Number(m[1]) * (m[2] === "dia" ? 1 : m[2] === "semana" ? 7 : 30));
  const dows = DOW.map((x) => x.normalize("NFD").replace(/\p{M}/gu, ""));
  if ((m = t.match(new RegExp(`\\b(${dows.join("|")})(?:\\s+(\\d{1,2}))?`)))) {
    const target = dows.indexOf(m[1]);
    if (m[2]) {
      // el día de la semana con ese número (busca en los próximos 12 meses)
      for (let i = 0; i < 370; i++) { const d = addDays(base, i); const x = parseISO(d); if (x.getDate() === Number(m[2]) && x.getDay() === target) return d; }
    }
    let d = addDays(base, 1);
    while (parseISO(d).getDay() !== target) d = addDays(d, 1);
    if (/que viene|proxima semana|semana que viene/.test(t) && diffWeek(base, d) === 0) d = addDays(d, 7);
    return d;
  }
  if ((m = t.match(/\b(?:el|para el|dia)\s+(\d{1,2})\b(?!\s*(?:taza|vaso|botella|unidad|producto|u\b))/))) {
    const d = new Date(b.getFullYear(), b.getMonth(), Number(m[1]));
    if (iso(d) < base) d.setMonth(d.getMonth() + 1);
    return iso(d);
  }
  return "";
}
const diffWeek = (a, b) => Math.floor((+parseISO(b) - +parseISO(a)) / (7 * 86400000));

function detectIntent(t) {
  const x = t.toLowerCase();
  if (/(m[aá]s barat|m[aá]s car|cu[aá]nto (sale|cuesta|est[aá])|qu[eé] precio|pas[aá]me|busc[aá]me|dame (el|los|las)|cu[aá]les son|^dame precio|precios? de (las?|los?) |buscar precio|lista de precios de (las?|los?|todas?|todos?) |listado)/.test(x)) return "query";
  if (/(record[aá]|anot[aá]|agend[aá]|tengo que|no me olvide|tarea|urgente para)/.test(x)) return "agenda";
  if (/(\bvende\b|\bvenden\b|proveedor|me cobra|precio de proveedor|lista de precio)/.test(x) && !/me compr/.test(x)) return "supplier_price";
  if (/(compr[oó]|me pidi[oó]|encarg[oó]|pedido|me encarg|quiere \d|cliente)/.test(x)) return "order";
  return "none";
}

// --- extracción oportunista de datos de un pedido en cualquier frase ---
function extractOrder(t, d) {
  const x = words2num(t);
  let m;
  if ((m = x.match(/^(?:la |el )?(?:cliente )?([\p{L} ]{2,40}?)\s+(?:me\s+)?(?:compr[oó]|pidi[oó]|encarg[oó]|quiere|me pidi[oó])/iu))) {
    const n = m[1].replace(/\b(hoy|ayer|reci[eé]n|la|el|cliente)\b/gi, "").trim();
    if (n && !/^(quiero|cargar|un|una|nuevo|pedido)$/i.test(n)) d.clientName = cap(n);
  }
  if ((m = x.match(/(\d+)\s+(?:unidades de\s+)?([\p{L}][\p{L} ]{2,40}?)(?=\s+(?:a|por|para|de\s+\$|con|en|que|total|y)\b|[,.]|$)/iu)) && !/^(de|mil|dias?|semanas?|cuotas?)\b/i.test(m[2])) {
    const product = m[2].trim();
    const it = d.items.find((i) => i.product.toLowerCase() === product.toLowerCase()) || (d.items.push({ product, qty: 0, unitPrice: 0 }), d.items.at(-1));
    it.qty = Number(m[1]);
    const pm = x.slice(m.index + m[0].length).match(/^\s*(?:a|por)\s+(\$?\s*[\d.,]+\s*(?:mil|k)?)\s*(c\/u|cada un[oa])?/i);
    if (pm) { const v = parseMoney(pm[1]); if (pm[2] || v < 100000) it.unitPrice = v; else d.total = v; }
  }
  if ((m = x.match(/total\s*(?:de|es|son)?\s*(\$?\s*[\d.,]+\s*(?:mil|k)?)/i))) d.total = parseMoney(m[1]);
  if ((m = x.match(/se[ñn]\w*\s*(?:de|con|es|fue|son)?\s*(\$?\s*[\d.,]+\s*(?:mil|k)?)/i) || x.match(/(\$?\s*[\d.,]+\s*(?:mil|k)?)\s*(?:de|en|como)\s+se[ñn]a/i))) d.deposit = parseMoney(m[1]);
  if (/pag[oó] todo|100 ?%|pag[oó] el total/i.test(x) && d.total) d.deposit = d.total;
  if ((m = x.match(/(?:tel[eé]fono|cel(?:ular)?|whats\w*|n[uú]mero)\s*(?:es)?\s*([\d\s-]{7,})/i))) d.phone = m[1].trim();
  if ((m = x.match(/dni\s*(?:es)?\s*([\d.]{7,10})/i))) d.dni = m[1].replace(/\./g, "");
  if ((m = x.match(/(?:direcci[oó]n|vive en|domicilio)\s*(?:es)?\s*(.+)$/i))) d.address = m[1].trim();
  if ((m = x.match(/(?:entrega|entregar|entregarlo|lo necesita|para entregar)[^.]*?((?:el\s+)?(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|\d{1,2}[/-]\d{1,2}|\d{1,2} de \w+|ma[ñn]ana|hoy)[^,.]*)/i))) d.deadline = parseDateES(m[1]) || d.deadline;
  else if ((m = x.match(/(?:para el|evento|boda|comuni[oó]n|cumple\w*|egres\w*|fiesta)[^.]*?((?:el\s+)?(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|\d{1,2}[/-]\d{1,2}|\d{1,2} de \w+)[^,.]*)/i))) d.eventDate = parseDateES(m[1]) || d.eventDate;
  for (const c of CHANNELS) if (new RegExp(`\\b${c.slice(0, 5)}`, "i").test(x) && /(vino|instagram|whats|recomend|facebook|por )/i.test(x)) d.channel = c;
  if (/recomend/i.test(x)) d.channel = "Recomendación";
  if (/retir/i.test(x)) d.shipping = "Retiro en local"; else if (/\b(moto|uber|cadete)\b/i.test(x)) d.shipping = "Moto/Uber"; else if (/\bcorreo\b/i.test(x) && !/argentino/i.test(x)) d.shipping = "Correo";
  for (const [c, r] of <[string, RegExp][]>[["Andreani", /andreani/i], ["Flecha Bus Cargas", /flecha/i], ["Via Cargo", /v[ií]a ?cargo/i], ["Correo Argentino", /correo argentino/i]]) if (r.test(x)) d.courier = c;
  if ((m = x.match(/(?:nota|quiere que|que sea|anot[aá] que)\s*:?\s*(.+)$/i))) d.notes = m[1].trim();
}

function extractSupplier(t, d) {
  const x = words2num(t);
  let m;
  if ((m = x.match(/^(?:el proveedor |la proveedora |proveedor )?([\p{L}\d .&]{2,40}?)\s+(?:vende|venden|me vende|tiene|me cobra)\s+(?:el |la |los |las )?(.+?)(?:\s+(?:a|por|en)\s+(\$?\s*[\d.,]+\s*(?:mil|k)?))?(?=\s+(?:c\/u|cada|m[ií]nimo|x\s?\d|env[ií]o|y|las|los|por|el|la)\b|[,.]|$)/iu))) {
    if (!/quiero|guardar/i.test(m[1])) d.supplierName = cap(m[1].trim());
    d.product = m[2].trim();
    if (m[3]) d.price = parseMoney(m[3]);
  } else if ((m = x.match(/(?:a|por|precio)\s+(\$?\s*[\d.,]+\s*(?:mil|k)?)/i))) d.price ||= parseMoney(m[1]);
  // precio por cantidad: "a 45 mil las 30", "por 25 unidades", "el pack de 50", "la docena"
  if ((m = x.match(/(?:las|los|por|x|cada|el pack de|la caja de|el paquete de|la bolsa de)\s*(\d+)\s*(?:unidades|unid|u\b|piezas)?/i)) && /unid|las \d|los \d|pack|caja|paquete|bolsa|piezas/i.test(m[0])) d.packQty = Number(m[1]);
  if (/docena/i.test(x)) d.packQty = 12;
  if (/(por|c\/u|cada) unidad|c\/u/i.test(x)) d.packQty = 1;
  if ((m = x.match(/m[ií]nimo\s*(?:de\s*)?(?:x\s*)?(\d+)|\bx\s?(\d{2,4})\b|caja\s*(?:de|x)\s*(\d+)/i))) d.minQty = Number(m[1] || m[2] || m[3]);
  if ((m = x.match(/env[ií]o\s*(?:de|suma|sale)?\s*(\$?\s*[\d.,]+\s*(?:mil|k)?)/i))) d.shippingCost = parseMoney(m[1]);
  if (/grande|pesad/i.test(x)) d.shippingCost = settings().shipBig;
  if (/sin env[ií]o|env[ií]o gratis|no (tiene|lleva|paga) env[ií]o|misma provincia|es de ac[aá]/i.test(x)) d.shippingCost = -1; // -1 = no paga envío
  if ((m = x.match(/\b(?:es de|est[aá] en|de la provincia de)\s+([\p{L} ]+)/iu))) d.province = cap(m[1]);
  if ((m = x.match(/(?:tel[eé]fono|whats\w*|cel\w*)\s*(?:es)?\s*([\d\s-]{7,})/i))) d.phone = m[1].trim();
  if ((m = x.match(/(@[\w.]+)/))) d.social = m[1];
}

const ORDER_SLOTS = [
  ["clientName", "¿Cómo se llama el cliente?"],
  ["items", "¿Qué producto compró y cuántas unidades?"],
  ["price", "¿A qué precio por unidad o cuál es el total?"],
  ["deposit", "¿Cuánto dejó de seña?"],
  ["eventDate", "¿Para qué fecha es el evento?"],
  ["deadline", "¿Para cuándo hay que entregarlo?"],
  ["phone", "¿Me pasás el teléfono del cliente?"],
  ["channel", "¿Por dónde vino: Instagram, WhatsApp o recomendación?"],
  ["shipping", "¿Cómo se entrega: por correo, retira en el local o en moto/Uber?"],
  ["notes", "¿Alguna nota? Por ejemplo colores o detalles del packaging."],
];
const SUP_SLOTS = [
  ["supplierName", "¿Qué proveedor lo vende?"],
  ["product", "¿Qué producto es?"],
  ["price", "¿A qué precio? Si es por varias unidades decime cuántas, por ejemplo “45 mil las 30”."],
  ["minQty", "¿Cuál es el mínimo de compra?"],
  ["shippingCost", `¿Cuánto suma de envío? Decime “sin envío” si es de tu provincia, “chico” (${money(30000)}), “grande” (${money(65000)}) o el monto.`],
  ["province", "¿De qué provincia es?"],
];

function slotMissing(intent, d, key) {
  if (S.skipped.has(key)) return false;
  if (intent === "order") {
    if (key === "items") return !d.items.length || d.items.some((i) => !i.qty);
    if (key === "price") return !d.total && !d.items.some((i) => i.unitPrice);
    if (key === "deposit") return !d.deposit && d.deposit !== -1;
  }
  return !d[key];
}

// Llena el campo que se estaba preguntando con la respuesta de la persona
function fillPending(intent, d, key, t) {
  const x = words2num(t);
  if (SKIP.test(t.trim())) { S.skipped.add(key); return; }
  if (intent === "order") {
    if (key === "clientName") d.clientName = cap(t.replace(/^(se llama|es|la cliente es|el cliente es)\s+/i, "").replace(/[.!]$/, ""));
    else if (key === "items") { const before = d.items.length; extractOrder(x, d); if (d.items.length === before) { const q = x.match(/(\d+)/); d.items.push({ product: x.replace(/\d+/g, "").replace(/^\s*(de|unidades de)\s+/i, "").trim() || "Producto", qty: q ? Number(q[1]) : 1, unitPrice: 0 }); } }
    else if (key === "price") { if (parseDateES(x) && !/\$|mil\b|\d{3,}/.test(x)) return; const v = parseMoney(x); if (/total/i.test(x) || !d.items.length) d.total = v; else if (/c\/u|cada|unidad/i.test(x) || v < 50000) d.items.forEach((i) => (i.unitPrice ||= v)); else d.total = v; }
    else if (key === "deposit") { if (parseDateES(x) && !/\$|mil\b|\d{3,}/.test(x)) return; if (/no dej|nada|sin se/i.test(x)) d.deposit = -1; else if (/\b(todo|el total)\b|100 ?%|por ciento/i.test(x)) d.deposit = d.total || d.items.reduce((a, i) => a + i.qty * i.unitPrice, 0); else d.deposit = parseMoney(x); }
    else if (key === "eventDate" || key === "deadline") { d[key] = parseDateES(x); if (!d[key]) S.skipped.add(key); }
    else if (key === "phone") d.phone = (x.match(/[\d\s-]{7,}/) || [x])[0].trim();
    else if (key === "channel") d.channel = /insta/i.test(x) ? "Instagram" : /whats|wasap|guasap/i.test(x) ? "WhatsApp" : /recom|amig|conocid/i.test(x) ? "Recomendación" : /face/i.test(x) ? "Facebook" : cap(x);
    else if (key === "shipping") d.shipping = /retir|local|busca/i.test(x) ? "Retiro en local" : /moto|uber|cadete/i.test(x) ? "Moto/Uber" : /correo|env[ií]/i.test(x) ? "Correo" : cap(x);
    else if (key === "notes") d.notes = t.trim();
  } else if (intent === "supplier_price") {
    if (key === "supplierName") d.supplierName = cap(t.replace(/^(es|se llama|el proveedor es)\s+/i, ""));
    else if (key === "product") d.product = t.trim();
    else if (key === "price") d.price = parseMoney(x);
    else if (key === "minQty") { const q = x.match(/(\d+)/); d.minQty = q ? Number(q[1]) : 0; if (!q) S.skipped.add(key); }
    else if (key === "shippingCost") d.shippingCost = /sin|no (tiene|lleva|paga)|cero|gratis|misma provincia|de ac[aá]|local|^0$/i.test(x) ? -1 : /grande|pesad/i.test(x) ? settings().shipBig : /chic|poco|normal/i.test(x) ? settings().shipSmall : parseMoney(x);
    else if (key === "province") d.province = cap(t.replace(/^(es de|de)\s+/i, ""));
  }
}

function localTurn(text) {
  const t = text.trim();
  // confirmación final
  if (S.pending === "confirm") {
    if (YES.test(t)) { S.pending = null; return { reply: "", ready: true }; }
    if (/^no\.?$/i.test(t)) { return { reply: "Ok, decime qué querés cambiar (por ejemplo “la seña es 50 mil”) o “cancelar”." }; }
  }
  if (S.intent === "none" || ((!S.pending || S.pending === "confirm") && detectIntent(t) !== "none" && detectIntent(t) !== S.intent)) {
    const intent = detectIntent(t);
    if (intent === "none") return { reply: "No te entendí bien. ¿Querés cargar un pedido, guardar un precio de proveedor, buscar precios o anotar una tarea?" };
    S.intent = intent; S.draft = emptyDraft(intent); S.skipped = new Set(); S.pending = null;
  }
  const d = S.draft;
  if (S.intent === "query") {
    const x = words2num(t.toLowerCase());
    // "todas las mochilas" / "el listado": todas; si no, las 3 más baratas (o las que diga)
    const limit = /\b(todas?|todos?|listado|lista)\b/.test(x) ? 50 : Number((x.match(/\b(\d{1,2})\b/) || [])[1]) || 3;
    const stop = /^(todas?|todos?|listado|lista|buscar|pas[aá]me|dame|busc[aá]me|decime|cu[aá]les|son|el|la|los|las|de|del|precio|precios|m[aá]s|baratas?|baratos?|caras?|caros?|que|tengo|me|mostrame|cu[aá]nto|sale|salen|cuesta|cuestan|opciones|\d+|y|con|su|sus|proveedor|proveedores)$/i;
    const search = x.split(/\s+/).filter((w) => !stop.test(w)).map((w) => w.replace(/(es|s)$/, "")).join(" ");
    return { reply: "", query: { search, limit, sort: /car[oa]s?/.test(x) && !/barat/.test(x) ? "expensive" : "cheapest" } };
  }
  if (S.intent === "agenda") {
    if (!d.title) {
      d.title = cap(t.replace(/^(record[aá]me|anot[aá]|agend[aá]|quiero anotar|tengo que)\s*(que)?\s*/i, "").replace(/\b(para )?(hoy|ma[ñn]ana|pasado ma[ñn]ana|el (lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)( \d{1,2})?)\b/gi, "").replace(/\s+/g, " ").trim());
      if (/^algo urgente/i.test(d.title)) d.title = "";
    } else if (S.pending === "title") d.title = cap(t);
    d.date ||= parseDateES(t) || (S.pending === "date" ? today() : "");
    d.type ||= /cliente/i.test(t) ? "cliente" : /proveedor/i.test(t) ? "proveedor" : "trabajo";
    if (!d.title) { S.pending = "title"; return { reply: "¿Qué tengo que anotar?" }; }
    if (!d.date) { S.pending = "date"; return { reply: "¿Para qué día?" }; }
    S.pending = null;
    return { reply: "", ready: true };
  }
  // pedido o proveedor: completar con lo dicho y preguntar lo que falta
  const slots = S.intent === "order" ? ORDER_SLOTS : SUP_SLOTS;
  if (S.pending && S.pending !== "confirm") fillPending(S.intent, d, S.pending, t);
  if (S.intent === "order") extractOrder(t, d); else extractSupplier(t, d);
  if (S.intent === "order" && !d.total && d.items.some((i) => i.unitPrice)) d.total = d.items.reduce((a, i) => a + i.qty * i.unitPrice, 0);
  const next = slots.find(([k]) => slotMissing(S.intent, d, k));
  if (next) {
    S.pending = next[0];
    const got = S.intent === "order" && next[0] === "items" && d.clientName ? `Perfecto, pedido de ${d.clientName}. ` : "";
    return { reply: got + next[1] };
  }
  S.pending = "confirm";
  if (S.intent === "order") {
    const total = d.total || d.items.reduce((a, i) => a + i.qty * i.unitPrice, 0);
    const dep = Math.max(0, d.deposit);
    return { reply: `Resumen: ${d.clientName}, ${d.items.map((i) => `${i.qty} ${i.product}`).join(" y ")}, total ${money(total)}, seña ${money(dep)}, saldo ${money(total - dep)}${d.eventDate ? `, evento el ${fmtDate(d.eventDate, { long: true })}` : ""}. ¿Lo guardo?` };
  }
  return { reply: `Resumen: ${d.supplierName} vende ${d.product} a ${money(d.price)}${d.packQty > 1 ? ` las ${d.packQty} unidades (${money(d.price / d.packQty)} c/u)` : ""}${d.minQty ? `, mínimo ${d.minQty}` : ""}${d.shippingCost === -1 ? ", sin envío" : d.shippingCost ? `, envío ${money(d.shippingCost)}` : ""}. ¿Lo guardo?` };
}

export { CATEGORIES, SHIPPING };
