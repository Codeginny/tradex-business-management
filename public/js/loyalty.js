// Tarjeta Cliente VIP (fidelización): un sticker por compra. Al llegar a un casillero con premio,
// el premio queda para la próxima compra. Cuando se completa la tarjeta, empieza una nueva.
// Los stickers salen de los pedidos (botón "Cliente VIP") más los extra de la ficha (ej: por subir foto a Instagram).
import { db, settings, saveSettings } from "./db.js";
import { esc, money, waLink } from "./utils.js";
import { clientOrders } from "./clientdb.js";

// Igual que la tarjeta impresa: 10 casilleros y estos premios
export const DEFAULT_LOYALTY = { boxes: 10, minPurchase: 15000, prizes: { 4: "🎁 Regalo", 6: "10% OFF", 8: "🎁 Regalo", 10: "15% OFF" } };
export const loyaltyConf = () => ({ ...DEFAULT_LOYALTY, ...(settings().loyalty || {}) });
export const saveLoyaltyConf = (patch) => saveSettings({ loyalty: { ...loyaltyConf(), ...patch } });
// "10% OFF" -> 10 (los regalos no tienen porcentaje)
export const prizePct = (label) => Number(String(label || "").match(/(\d+)\s*%/)?.[1]) || 0;

// Estado de la tarjeta de un cliente. exceptOrder: el pedido que se está editando (su premio no cuenta como usado)
export function loyaltyOf(clientId, { exceptOrder } = {}) {
  const conf = loyaltyConf();
  const B = Math.max(1, Number(conf.boxes) || 10);
  const cl = clientId ? db.get("clients", clientId) : null;
  const orders = clientId ? clientOrders(clientId) : [];
  const stickers = orders.filter((o) => o.sticker).length + (Number(cl?.bonusStickers) || 0);
  const cycle = stickers ? Math.floor((stickers - 1) / B) : 0; // la tarjeta llena se sigue viendo hasta el próximo sticker
  const inCard = stickers - cycle * B;
  const prizeAt = (box) => conf.prizes?.[box] || "";
  // premios ganados (en todas las tarjetas) y los que ya se usaron en un pedido
  const earned = [];
  for (let n = 1; n <= stickers; n++) {
    const box = ((n - 1) % B) + 1;
    if (prizeAt(box)) earned.push({ key: `${Math.floor((n - 1) / B)}-${box}`, box, label: prizeAt(box), pct: prizePct(prizeAt(box)) });
  }
  const used = new Set(orders.filter((o) => o.reward?.key && o.id !== exceptOrder).map((o) => o.reward.key));
  const available = earned.filter((p) => !used.has(p.key));
  let next = null;
  for (let n = stickers + 1; n <= stickers + B; n++) {
    const box = ((n - 1) % B) + 1;
    if (prizeAt(box)) { next = { box, label: prizeAt(box), missing: n - stickers }; break; }
  }
  return { conf, B, client: cl, stickers, cycle, inCard, earned, available, next, loyal: stickers > 0, prizeAt };
}

// "Le falta 1 compra para 10% OFF" / "Tiene 10% OFF para usar"
export function loyaltyText(info) {
  if (info.available.length) return `🎁 Tiene ${info.available.map((p) => p.label).join(" + ")} para usar en su próxima compra`;
  if (info.next) return `Le falta${info.next.missing === 1 ? "" : "n"} ${info.next.missing} compra${info.next.missing === 1 ? "" : "s"} para ${info.next.label}`;
  return "";
}

// La tarjeta como la impresa: dos filas de casilleros, pintados los que ya tienen sticker
export function vipCardHTML(info, name = "") {
  const boxes = [...Array(info.B)].map((_, k) => k + 1);
  return `<div class="vip-card">
    <div class="vip-head"><span class="vip-title">Tarjeta Cliente VIP</span><span class="vip-name">${esc(name)}</span></div>
    <div class="vip-grid" style="grid-template-columns:repeat(${Math.ceil(info.B / 2)}, 1fr)">${boxes.map((b) => {
      const on = b <= info.inCard, prize = info.prizeAt(b);
      return `<div class="vip-dot ${on ? "on" : ""} ${prize ? "prize" : ""}" title="Casillero ${b}${prize ? ` · ${esc(prize)}` : ""}">${prize ? `<small>${esc(prize)}</small>` : on ? "💖" : `<span>${b}</span>`}</div>`;
    }).join("")}</div>
    <div class="vip-foot">${info.stickers ? `${info.inCard}/${info.B} stickers${info.cycle ? ` · tarjeta N° ${info.cycle + 1}` : ""}` : "Todavía sin stickers"}${loyaltyText(info) ? ` · <b>${esc(loyaltyText(info))}</b>` : ""}</div>
  </div>`;
}

// Mensaje de WhatsApp para avisarle que tiene (o está por tener) un premio
export function loyaltyMessage(info, name) {
  const n = String(name || "").split(" ")[0];
  if (info.available.length) return `Hola ${n}! 💖 Te cuento que en tu Tarjeta Cliente VIP de ${settings().businessName} tenés ${info.available.map((p) => p.label).join(" + ")} para usar en tu próxima compra. ¿Te armo algo lindo? ✨`;
  if (info.next) return `Hola ${n}! 💖 Te falta${info.next.missing === 1 ? "" : "n"} ${info.next.missing === 1 ? "solo 1 sticker" : `${info.next.missing} stickers`} en tu Tarjeta Cliente VIP para ganarte ${info.next.label}. ¡En tu próxima compra${info.next.missing === 1 ? " lo tenés" : " te acercás un montón"}! ✨ Cada compra desde ${money(info.conf.minPurchase)} suma.`;
  return "";
}
export const loyaltyWa = (info, c) => (c?.phone ? waLink(c.phone, loyaltyMessage(info, c.name)) : "");
