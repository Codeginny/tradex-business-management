// Cuotas: "quiero en limpio $X" -> cuánto cobrarle al cliente en 3, 6 y 9 cuotas
// (con comisión, IVA, financiación y retenciones ya sumadas), listo para mandarle.
import { settings } from "../db.js";
import { icon, esc, money, cuotasOptions } from "../utils.js";
import { $, $$, toast } from "../ui.js";

const state = { amount: "", medio: 0, plans: JSON.parse(localStorage.getItem("v-cuotas-plans") || "[3,6,9]"), transfer: true, concept: "" };

function message(rows, transfer) {
  const lines = [];
  if (state.concept) lines.push(`Para tu pedido de ${state.concept}:`);
  lines.push("Estas son las opciones de pago 💳");
  if (transfer) lines.push(`• Transferencia: ${money(transfer.price)}`);
  for (const r of rows) lines.push(`• ${r.n} cuotas de ${money(r.cuota)} (total ${money(r.price)})`);
  lines.push("¿Con cuál te queda mejor? 😊");
  return lines.join("\n");
}

export function render(el) {
  const s = settings();
  const available = s.financing.filter((f) => f.n > 1).map((f) => f.n);
  el.innerHTML = `<div class="stack">
    <div class="card cuotas-in">
      <label class="field big-field">Quiero en limpio
        <div class="money-input"><span>$</span><input type="number" inputmode="numeric" id="cq-amount" min="0" placeholder="150000" value="${esc(state.amount)}"></div>
      </label>
      <div class="grid g2">
        <label class="field">Cobro con<select id="cq-medio">${s.payMedia.map((m, i) => `<option value="${i}" ${i === state.medio ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label>
        <label class="field">Producto (opcional, para el mensaje)<input id="cq-concept" value="${esc(state.concept)}" placeholder="Ej: 40 tazas personalizadas"></label>
      </div>
      <div class="row">
        <span class="small muted">Cuotas:</span>
        ${available.map((n) => `<label class="chip ${state.plans.includes(n) ? "accent" : ""}" style="cursor:pointer"><input type="checkbox" data-n="${n}" ${state.plans.includes(n) ? "checked" : ""} hidden> x${n}</label>`).join("")}
        <label class="check small"><input type="checkbox" id="cq-transfer" ${state.transfer ? "checked" : ""}> Incluir precio por transferencia</label>
      </div>
    </div>
    <div id="cq-out"></div>
  </div>`;

  const draw = () => {
    const amount = Number(state.amount) || 0;
    const out = $("#cq-out", el);
    if (!amount) { out.innerHTML = `<div class="empty card"><div class="big">💳</div><p>Poné cuánto querés que te quede en limpio y te digo cuánto cobrar en cuotas.</p></div>`; return; }
    const all = cuotasOptions(amount, { medio: state.medio, mode: "net" });
    const rows = all.filter((r) => r.key.startsWith("c") && !r.planZ && state.plans.includes(r.n)).sort((a, b) => a.n - b.n);
    const transfer = state.transfer ? all.find((r) => r.key === "cuenta") : null;
    const ivaLabel = `IVA ${s.iva}%${s.ivaOnFinancing ? "" : " (sobre comisión)"}`;
    out.innerHTML = `
      <div class="cuotas-grid">${rows.map((r) => `
        <div class="card cuota-card">
          <div class="cuota-n">${r.n} cuotas de</div>
          <div class="cuota-v">${money(r.cuota)}</div>
          <div class="cuota-t">Total a cobrar <b>${money(r.price)}</b></div>
          <div class="cuota-parts">
            <div><span>Comisión ${r.comm}%</span><span>${money(r.parts.comision)}</span></div>
            <div><span>${ivaLabel}</span><span>${money(r.parts.iva)}</span></div>
            <div><span>Financiación ${r.fin}%</span><span>${money(r.parts.financiacion)}</span></div>
            ${r.parts.iibb ? `<div><span>Retención IIBB ${s.iibb}%</span><span>${money(r.parts.iibb)}</span></div>` : ""}
            <div class="neto"><span>Te queda limpio</span><span>${money(r.net)}</span></div>
          </div>
        </div>`).join("") || `<p class="muted">Elegí al menos una opción de cuotas.</p>`}
      </div>
      ${transfer ? `<p class="small muted">Por transferencia / dinero en cuenta: cobrar ${money(transfer.price)} (comisión ${transfer.comm}% + IVA).</p>` : ""}
      <div class="card stack">
        <h3 style="margin:0">💬 Mensaje para el cliente</h3>
        <textarea id="cq-msg" rows="6">${esc(message(rows, transfer))}</textarea>
        <div class="row"><button class="btn primary" id="cq-copy">${icon("copy")} Copiar</button>
          <a class="btn wa" id="cq-wa" target="_blank" rel="noopener">${icon("wa")} Enviar por WhatsApp</a></div>
      </div>`;
    const msg = $("#cq-msg", out);
    const setWa = () => ($("#cq-wa", out).href = `https://wa.me/?text=${encodeURIComponent(msg.value)}`);
    msg.oninput = setWa; setWa();
    $("#cq-copy", out).onclick = () => { navigator.clipboard?.writeText(msg.value); toast("Mensaje copiado", "Pegalo en el chat del cliente"); };
  };

  $("#cq-amount", el).oninput = (e) => { state.amount = e.target.value; draw(); };
  $("#cq-medio", el).onchange = (e) => { state.medio = Number(e.target.value); draw(); };
  $("#cq-concept", el).oninput = (e) => { state.concept = e.target.value.trim(); draw(); };
  $("#cq-transfer", el).onchange = (e) => { state.transfer = e.target.checked; draw(); };
  $$("[data-n]", el).forEach((c) => (c.onchange = () => {
    const n = Number(c.dataset.n);
    state.plans = c.checked ? [...new Set([...state.plans, n])] : state.plans.filter((x) => x !== n);
    localStorage.setItem("v-cuotas-plans", JSON.stringify(state.plans));
    c.parentElement.classList.toggle("accent", c.checked);
    draw();
  }));
  draw();
  setTimeout(() => { if (!state.amount) $("#cq-amount", el)?.focus(); }, 50);
  return { title: "Cuotas", sub: "Cuánto cobrar para que te quede limpio lo que querés" };
}
