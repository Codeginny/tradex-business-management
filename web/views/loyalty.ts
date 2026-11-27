// Fidelización: quién tiene la Tarjeta Cliente VIP, quién tiene un premio para usar y quién está cerca de uno
// (con el mensaje de WhatsApp listo para avisarle). Abajo se configuran los premios de la tarjeta.
import { db } from "../db.js";
import { icon, esc, money, fmtDate, today } from "../utils.js";
import { $, $$, toast, readForm } from "../ui.js";
import { clientsWithStats } from "../clientdb.js";
import { loyaltyOf, loyaltyText, loyaltyWa, vipCardHTML, loyaltyConf, saveLoyaltyConf } from "../loyalty.js";
import { openClientCard } from "./clients.js";

// Un cliente en la lista: nombre, cómo va su tarjeta y el botón para escribirle
const row = ({ c, info }, withMsg = true) => `<div class="row loyal-row" style="justify-content:space-between">
  <div style="cursor:pointer" data-cl="${c.id}"><b>${esc(c.name)}</b> <span class="chip accent">${info.inCard}/${info.B}</span>
    <div class="small muted">${esc(loyaltyText(info) || "Tarjeta completa")}${c.loyaltyMsgAt ? ` · le escribiste el ${fmtDate(c.loyaltyMsgAt)}` : ""}</div></div>
  ${withMsg ? (c.phone ? `<a class="btn wa sm" target="_blank" rel="noopener" data-msg="${c.id}" href="${loyaltyWa(info, c)}">${icon("wa")} Avisarle</a>` : `<span class="small muted">sin teléfono</span>`) : ""}
</div>`;

export function render(el) {
  const conf = loyaltyConf();
  const loyal = clientsWithStats().map((c) => ({ c, info: loyaltyOf(c.id) })).filter((x) => x.info.loyal);
  const withPrize = loyal.filter((x) => x.info.available.length);
  const near = loyal.filter((x) => !x.info.available.length && x.info.next && x.info.next.missing <= 2).sort((a, b) => a.info.next.missing - b.info.next.missing);
  el.innerHTML = `<div class="stack">
    <div class="grid g3">
      <div class="card stat"><span class="label">💖 Clientes fidelizados</span><span class="value">${loyal.length}</span><span class="hint">con la Tarjeta Cliente VIP</span></div>
      <div class="card stat"><span class="label">🎁 Con premio para usar</span><span class="value">${withPrize.length}</span><span class="hint">avisales que lo tienen</span></div>
      <div class="card stat"><span class="label">⏳ Cerca de un premio</span><span class="value">${near.length}</span><span class="hint">a 1 o 2 compras</span></div>
    </div>
    <div class="grid g2">
      <div class="card"><h3>🎁 Tienen un premio para usar</h3>
        ${withPrize.length ? `<div class="stack">${withPrize.map((x) => row(x)).join("")}</div>` : `<p class="muted">Nadie tiene un premio sin usar.</p>`}</div>
      <div class="card"><h3>⏳ Están cerca de un premio</h3>
        ${near.length ? `<div class="stack">${near.map((x) => row(x)).join("")}</div>` : `<p class="muted">Nadie está a 1 o 2 compras de un premio.</p>`}</div>
    </div>
    <div class="card"><h3>💖 Todos los fidelizados</h3>
      ${loyal.length ? `<div class="stack">${[...loyal].sort((a, b) => b.info.stickers - a.info.stickers).map((x) => row(x, false)).join("")}</div>`
        : `<p class="muted">Todavía no entregaste tarjetitas. En Inicio, en “✅ Últimos entregados”, tocá “💖 Cliente VIP”.</p>`}</div>
    <details class="card"><summary style="cursor:pointer;font-weight:700">⚙️ Premios de la tarjeta</summary>
      <p class="small muted">Escribí el premio de cada casillero (ej: “10% OFF” o “🎁 Regalo”). Los que dejes vacíos son casilleros comunes. Si en el premio ponés un %, al cargar el pedido te ofrezco aplicar el descuento.</p>
      <form id="lc" class="stack">
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">${[...Array(Number(conf.boxes) || 10)].map((_, k) => `<label class="field">Casillero ${k + 1}<input name="p${k + 1}" value="${esc(conf.prizes?.[k + 1] || "")}"></label>`).join("")}</div>
        <div class="grid g3"><label class="field">Cantidad de casilleros<input name="boxes" type="number" min="2" max="20" value="${conf.boxes}"></label>
          <label class="field">Compra mínima para sumar sticker<input name="minPurchase" data-money="1" value="${conf.minPurchase}"></label></div>
        <div id="lc-prev"></div>
        <div><button type="button" class="btn primary" id="lc-save">${icon("check")} Guardar premios</button></div>
      </form></details>
  </div>`;
  $$("[data-cl]", el).forEach((r) => (r.onclick = () => openClientCard(r.dataset.cl)));
  // al tocar "Avisarle" se abre WhatsApp con el mensaje y queda anotado el día
  $$("[data-msg]", el).forEach((a) => a.addEventListener("click", async () => {
    const c = db.get("clients", a.dataset.msg);
    if (c) await db.put("clients", { ...c, loyaltyMsgAt: today() });
  }));
  const form = $("#lc", el);
  const read = () => {
    const f = readForm(form);
    const boxes = Math.min(20, Math.max(2, Number(f.boxes) || 10));
    const prizes: Rec = {};
    for (let b = 1; b <= boxes; b++) if (f[`p${b}`]) prizes[b] = f[`p${b}`];
    return { boxes, prizes, minPurchase: Number(f.minPurchase) || 0 };
  };
  const preview = () => { const r = read(); $("#lc-prev", el).innerHTML = vipCardHTML({ ...loyaltyOf(null), B: r.boxes, prizeAt: (b) => r.prizes[b] || "", conf: { ...conf, ...r } }, "Vista previa"); };
  form.addEventListener("input", preview);
  preview();
  $("#lc-save", el).onclick = async () => { await saveLoyaltyConf(read()); toast("💖 Premios de la tarjeta guardados"); };
  return { title: "Fidelización", sub: `Tarjeta Cliente VIP · ${loyal.length} clientes · compra mínima ${money(conf.minPurchase)}` };
}
