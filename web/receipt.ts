// Comprobante / recibo lindo para descargar en PDF (usa "Guardar como PDF" del navegador, funciona sin internet).
import { settings } from "./db.js";
import { esc, fmtDni, money, fmtDate, orderTotal, orderPaid, orderBalance, orderQty, statusOf } from "./utils.js";

export function printHTML(title, inner) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: "Plus Jakarta Sans", system-ui, sans-serif; color: #1e1631; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .head { background: #121317; color: #fff; border-radius: 18px; padding: 22px 26px; display: flex; justify-content: space-between; align-items: center; }
    .logo { font-size: 30px; font-weight: 800; letter-spacing: .18em; }
    .head small { opacity: .9; display: block; }
    h2 { font-size: 15px; color: #5b1fd6; margin: 22px 0 8px; text-transform: uppercase; letter-spacing: .08em; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; font-size: 14px; }
    .grid b { color: #6c6483; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; background: #f3eefe; color: #5b21b6; padding: 9px 10px; font-size: 12px; text-transform: uppercase; }
    td { padding: 9px 10px; border-bottom: 1px solid #eee7f7; }
    .r { text-align: right; }
    .totals { margin-left: auto; width: 300px; margin-top: 14px; font-size: 15px; }
    .totals div { display: flex; justify-content: space-between; padding: 5px 0; }
    .totals .big { font-size: 20px; font-weight: 800; color: #5b1fd6; border-top: 2px dashed #d9c4ff; margin-top: 6px; padding-top: 10px; }
    .totals .saldo { background: #fdf2f8; color: #be185d; border-radius: 10px; padding: 8px 10px; font-weight: 800; }
    .dates { display: flex; gap: 12px; margin-top: 18px; }
    .dates div { flex: 1; background: #f6f4fb; border-radius: 14px; padding: 12px 14px; }
    .dates b { display: block; font-size: 12px; color: #6c6483; text-transform: uppercase; }
    .dates span { font-size: 16px; font-weight: 700; }
    .note { margin-top: 16px; background: #ecfeff; border-left: 4px solid #14b8a6; padding: 10px 14px; border-radius: 10px; font-size: 13px; }
    .foot { margin-top: 28px; text-align: center; color: #6c6483; font-size: 12px; }
    .paid { display: inline-block; margin-top: 6px; background: #10b981; color: #fff; padding: 4px 12px; border-radius: 99px; font-weight: 800; font-size: 13px; }
  </style></head><body>${inner}</body></html>`);
  doc.close();
  const go = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); };
  // esperar fuentes (si no hay internet, imprime igual)
  setTimeout(go, 700);
}

export function printReceipt(o) {
  const s = settings();
  const items = (o.items || []).map((i) => `<tr><td>${esc(i.product)}</td><td class="r">${i.qty}</td><td class="r">${money(i.unitPrice)}</td><td class="r">${money(i.qty * i.unitPrice)}</td></tr>`).join("");
  const sub = (o.items || []).reduce((a, i) => a + i.qty * i.unitPrice, 0);
  const total = orderTotal(o);
  const html = `
    <div class="head">
      <div><div class="logo">${esc(s.businessName || "TRADEX")}</div><small>${esc(s.businessPhone || "")} ${esc(s.businessAddress || "")}</small></div>
      <div style="text-align:right"><small>Comprobante de pedido</small><div style="font-size:22px;font-weight:800">N° ${esc(o.number || o.id.slice(-5).toUpperCase())}</div><small>Emitido ${fmtDate(new Date().toISOString().slice(0, 10), { year: true })}</small>
      ${orderBalance(o) === 0 ? '<div class="paid">PAGADO 100%</div>' : ""}</div>
    </div>
    <h2>Cliente</h2>
    <div class="grid">
      <div><b>Nombre:</b> ${esc(o.client?.name)}</div><div><b>Teléfono:</b> ${esc(o.client?.phone || "—")}</div>
      <div><b>Localidad:</b> ${esc(o.client?.address || "—")}</div><div><b>DNI / CUIL:</b> ${esc(fmtDni(o.client?.dni) || "—")}</div>
      <div><b>Entrega:</b> ${esc(o.shipping || "—")}</div><div><b>Estado:</b> ${esc(statusOf(o.status).label)}</div>
    </div>
    <h2>Detalle</h2>
    <table><thead><tr><th>Producto</th><th class="r">Cant.</th><th class="r">Precio unit.</th><th class="r">Subtotal</th></tr></thead><tbody>${items || '<tr><td colspan="4">—</td></tr>'}</tbody></table>
    <div class="totals">
      <div><span>Cantidad de productos</span><b>${orderQty(o)}</b></div>
      <div><span>Subtotal</span><b>${money(sub || total)}</b></div>
      ${o.clientShipping && !o.shippingFree ? `<div><span>Envío</span><b>${money(o.clientShipping)}</b></div>` : o.clientShipping ? `<div><span>Envío</span><b>Gratis</b></div>` : ""}
      <div class="big"><span>Total</span><span>${money(total)}</span></div>
      <div><span>Seña</span><b>${money(o.paidFull ? total : o.deposit)}</b></div>
      <div class="saldo"><span>Saldo</span><span>${money(orderBalance(o))}</span></div>
    </div>
    <div class="dates">
      <div><b>Fecha del evento</b><span>${o.eventDate ? fmtDate(o.eventDate, { long: true }) : "—"}</span></div>
      <div><b>Entrega aproximada</b><span>${o.deadline ? fmtDate(o.deadline, { long: true }) : "—"}</span></div>
    </div>
    ${o.notes ? `<div class="note"><b>Notas:</b> ${esc(o.notes)}</div>` : ""}
    <div class="foot">¡Gracias por elegirnos! 💜 · ${esc(s.businessName || "TRADEX")}</div>`;
  printHTML(`Comprobante ${o.client?.name || ""}`, html);
}
