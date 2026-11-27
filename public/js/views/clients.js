// Clientes: cada uno tiene su ficha (editable en un solo lugar) con todo su historial de pedidos.
import { db, settings } from "../db.js";
import { icon, esc, money, fmtDate, fmtDni, waLink, orderTotal, orderBalance, orderCost, statusOf, statusPill, itemsList } from "../utils.js";
import { $, $$, modal, toast, confirmBox, readForm, options, autocomplete } from "../ui.js";
import { clientSuggestions } from "../suggest.js";
import { clientsWithStats, clientOrders, saveClient, mergeClients } from "../clientdb.js";
import { openOrderForm, openOrderDetail } from "./orders.js";
import { placeFields, bindPlaces, placeText } from "../places.js";
import { loyaltyOf, vipCardHTML, loyaltyWa } from "../loyalty.js";

let q = "";

export function render(el) {
  const all = clientsWithStats();
  const draw = () => {
    const ql = q.toLowerCase(), digits = q.replace(/\D/g, "");
    const list = all.filter((c) => !q || c.name.toLowerCase().includes(ql) || (digits.length >= 3 && (String(c.phone || "").replace(/\D/g, "").includes(digits) || String(c.dni || "").includes(digits))));
    $("#c-list", el).innerHTML = list.length ? `<div class="card table-wrap otable-wrap"><table class="otable" style="min-width:900px">
      <thead><tr><th>Último pedido</th><th>Cliente</th><th>Teléfono</th><th>DNI / CUIL</th><th>Dirección</th><th class="right">Pedidos</th><th class="right">Compró</th><th class="right">Ganancia</th><th class="right">Saldo</th><th></th></tr></thead>
      <tbody>${list.map((c) => `<tr data-client="${c.id}">
        <td class="nowrap">${c.last ? fmtDate(c.last, { year: true }) : "—"}</td>
        <td class="nowrap"><b>${esc(c.name)}</b>${loyaltyOf(c.id).loyal ? ` <span class="chip accent" title="Cliente Fidelizado (Tarjeta Cliente VIP)">💖</span>` : ""}</td>
        <td class="nowrap">${esc(c.phone || "—")}</td>
        <td class="nowrap">${esc(fmtDni(c.dni) || "—")}</td>
        <td class="small">${esc(placeText(c) || "—")}</td>
        <td class="right">${c.orders.length}</td>
        <td class="right nowrap">${money(c.spent)}</td>
        <td class="right nowrap" style="color:var(--ok)">${c.profit ? money(c.profit) : "—"}</td>
        <td class="right nowrap" style="color:${c.balance ? "var(--u-red)" : "var(--ok)"}">${c.balance ? `<b>${money(c.balance)}</b>` : "—"}</td>
        <td class="nowrap right">${c.phone ? `<a class="btn wa sm icon" target="_blank" rel="noopener" title="WhatsApp" href="${waLink(c.phone, `Hola ${c.name.split(" ")[0]}! `)}">${icon("wa")}</a>` : ""}
          <button class="btn sm soft" data-new="${c.id}" title="Nuevo pedido para este cliente">${icon("plus")}</button></td>
      </tr>`).join("")}</tbody>
      <tfoot><tr><td></td><td><b>${list.length} clientes</b></td><td colspan="3"></td><td class="right"><b>${list.reduce((a, c) => a + c.orders.length, 0)}</b></td>
        <td class="right nowrap"><b>${money(list.reduce((a, c) => a + c.spent, 0))}</b></td><td class="right nowrap"><b>${money(list.reduce((a, c) => a + c.profit, 0))}</b></td>
        <td class="right nowrap" style="color:var(--u-red)"><b>${money(list.reduce((a, c) => a + c.balance, 0))}</b></td><td></td></tr></tfoot></table></div>`
      : `<div class="empty card"><div class="big">👥</div><p>${q ? "No encontré clientes con esa búsqueda." : "Todavía no hay clientes. Se crean solos al cargar un pedido, o con “Nuevo cliente”."}</p></div>`;
    $$("[data-client]", el).forEach((r) => (r.onclick = (e) => { if (!e.target.closest("a, button")) openClientCard(r.dataset.client); }));
    $$("[data-new]", el).forEach((b) => (b.onclick = () => newOrderFor(b.dataset.new)));
  };
  el.innerHTML = `<div class="stack">
    <div class="search">${icon("search")}<input type="search" id="c-q" placeholder="Buscar por nombre, teléfono, DNI o CUIL…" value="${esc(q)}"></div>
    <div id="c-list"></div></div>`;
  $("#c-q", el).oninput = (e) => { q = e.target.value; draw(); };
  autocomplete($("#c-q", el), clientSuggestions);
  draw();
  return {
    title: "Clientes",
    sub: `${all.length} clientes · ${settings().businessName}`,
    actions: `<button class="btn primary" id="new-client">${icon("plus")}<span class="desktop-only">Nuevo cliente</span></button>`,
    bind: (a) => ($("#new-client", a).onclick = () => openClientCard()),
  };
}

function newOrderFor(id) {
  const c = db.get("clients", id);
  openOrderForm({ status: "senado", items: [{ qty: 1 }], clientId: c.id, client: { name: c.name, phone: c.phone, address: c.address, province: c.province || "", city: c.city || "", dni: c.dni } });
}

// Ficha del cliente: datos editables + historial completo
export function openClientCard(id = null) {
  const c = id ? { ...db.get("clients", id) } : { name: "", phone: "", address: "", dni: "", instagram: "", notes: "" };
  if (id && !c.id) return toast("No encontré esa ficha");
  const orders = id ? clientOrders(id).sort((a, b) => (b.deadline || b.eventDate || "").localeCompare(a.deadline || a.eventDate || "")) : [];
  const spent = orders.reduce((a, o) => a + orderTotal(o), 0);
  const balance = orders.reduce((a, o) => a + orderBalance(o), 0);
  const withCost = orders.filter((o) => orderCost(o));
  const profit = withCost.reduce((a, o) => a + orderTotal(o) - orderCost(o), 0);
  const others = clientsWithStats().filter((x) => x.id !== id);
  modal({
    title: id ? `👤 ${esc(c.name)}` : "Nuevo cliente",
    wide: true,
    body: `<div class="stack">
      <form class="grid g3" id="cf">
        <label class="field">Nombre *<input name="name" required value="${esc(c.name)}"></label>
        <label class="field">Teléfono<input name="phone" type="tel" value="${esc(c.phone || "")}"></label>
        <label class="field">DNI o CUIL<input name="dni" placeholder="Ej: 27-41808224-6" value="${esc(c.dni || "")}"></label>
        ${placeFields("", c)}
        <label class="field">Instagram / redes<input name="instagram" value="${esc(c.instagram || "")}" placeholder="@usuario"></label>
        <label class="field">Notas<input name="notes" value="${esc(c.notes || "")}" placeholder="Ej: prefiere retirar a la tarde"></label>
      </form>
      ${id ? `
      <div id="cl-loyal"></div>
      <div class="grid g4">
        <div class="card stat"><span class="label">Pedidos</span><span class="value">${orders.length}</span></div>
        <div class="card stat"><span class="label">Compró en total</span><span class="value">${money(spent)}</span></div>
        <div class="card stat"><span class="label">Ganancia que dejó</span><span class="value" style="color:var(--ok)">${withCost.length ? money(profit) : "—"}</span></div>
        <div class="card stat"><span class="label">Saldo pendiente</span><span class="value" style="color:${balance ? "var(--u-red)" : "var(--ok)"}">${money(balance)}</span></div>
      </div>
      <div class="card table-wrap otable-wrap"><table class="otable" style="min-width:700px">
        <thead><tr><th>Entrega</th><th>N°</th><th>Productos</th><th class="right">Total</th><th class="right">Saldo</th><th>Estado</th></tr></thead>
        <tbody>${orders.map((o) => `<tr data-o="${o.id}"><td class="nowrap">${o.deadline ? fmtDate(o.deadline, { year: true }) : "—"}</td><td>${esc(o.number || "")}</td>
          <td class="prod">${itemsList(o)}</td><td class="right nowrap">${money(orderTotal(o))}</td>
          <td class="right nowrap" style="color:${orderBalance(o) ? "var(--u-red)" : "var(--ok)"}">${orderBalance(o) ? money(orderBalance(o)) : "Saldado"}</td>
          <td class="nowrap">${statusPill(o.status)}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Sin pedidos todavía.</td></tr>`}</tbody>
      </table></div>
      ${others.length ? `<details class="card"><summary style="cursor:pointer;font-weight:700">🔗 ¿Está repetido? Unir con otra ficha</summary>
        <p class="small muted">Si este cliente quedó cargado dos veces (por ejemplo "Miriam" y "Miriam Gómez"), elegí la otra ficha: sus pedidos pasan a esta y la otra se borra.</p>
        <div class="row"><select id="merge-sel" class="grow">${options(others.map((x) => [x.id, `${x.name}${x.phone ? ` · ${x.phone}` : ""} (${x.orders.length} pedidos)`]), "", "Elegí la ficha repetida…")}</select>
        <button class="btn" id="merge-go" type="button">Unir</button></div></details>` : ""}` : `<p class="small muted" style="margin:0">También se crea sola la primera vez que cargás un pedido con un cliente nuevo.</p>`}
    </div>`,
    foot: `${id && !orders.length ? `<button class="btn danger" id="cl-del">${icon("trash")}</button>` : ""}
      ${id && c.phone ? `<a class="btn wa" target="_blank" rel="noopener" href="${waLink(c.phone, `Hola ${c.name.split(" ")[0]}! `)}">${icon("wa")} WhatsApp</a>` : ""}
      ${id ? `<button class="btn" id="cl-order">${icon("plus")} Nuevo pedido</button>` : ""}
      <button class="btn primary" id="cl-save">${icon("check")} Guardar ficha</button>`,
    onMount: (el, m) => {
      const form = $("#cf", el);
      bindPlaces(form, "");
      // Tarjeta Cliente VIP: si le diste la tarjetita es Cliente Fidelizado. Los stickers extra (ej: por Instagram) se suman acá.
      const drawLoyal = () => {
        const box = $("#cl-loyal", el); if (!box) return;
        const info = loyaltyOf(id), cur = db.get("clients", id) || c;
        box.innerHTML = info.loyal || cur.bonusStickers ? `<div class="stack" style="gap:8px">
          <div class="row"><span class="chip ok" style="font-size:14px">💖 Cliente Fidelizado</span>
            ${cur.phone && (info.available.length || info.next) ? `<a class="btn wa sm" target="_blank" rel="noopener" href="${loyaltyWa(info, cur)}">${icon("wa")} Avisarle cómo va su tarjeta</a>` : ""}</div>
          ${vipCardHTML(info, cur.name)}
          <div class="row small"><span class="muted">Stickers extra (ej: subió foto a Instagram):</span><b>${Number(cur.bonusStickers) || 0}</b>
            <button type="button" class="btn sm soft" data-bonus="1">+1</button><button type="button" class="btn sm ghost" data-bonus="-1" ${Number(cur.bonusStickers) ? "" : "disabled"}>−1</button></div></div>`
          : `<div class="row small muted"><span>Todavía no tiene la Tarjeta Cliente VIP: se activa cuando marcás “💖 Cliente VIP” en un pedido entregado.</span></div>`;
        $$("[data-bonus]", box).forEach((b) => (b.onclick = async () => {
          const x = db.get("clients", id); if (!x) return;
          await db.put("clients", { ...x, bonusStickers: Math.max(0, (Number(x.bonusStickers) || 0) + Number(b.dataset.bonus)) });
          drawLoyal();
        }));
      };
      drawLoyal();
      $$("[data-o]", el).forEach((r) => (r.onclick = () => { m.close(); openOrderDetail(r.dataset.o); }));
      $("#cl-save", el).onclick = async () => {
        const f = readForm(form);
        if (!f.name) return form.name.focus();
        const saved = await saveClient({ ...c, ...f, dni: fmtDni(f.dni), address: placeText(f) });
        m.close();
        toast(id ? "Ficha actualizada" : "✨ Cliente guardado", id && orders.length ? `Se actualizó en sus ${orders.length} pedidos` : saved.name);
      };
      $("#cl-order", el) && ($("#cl-order", el).onclick = () => { m.close(); newOrderFor(id); });
      $("#cl-del", el) && ($("#cl-del", el).onclick = async () => { if (await confirmBox(`¿Borrar la ficha de ${esc(c.name)}?`, "Borrar")) { await db.remove("clients", id); m.close(); } });
      $("#merge-go", el) && ($("#merge-go", el).onclick = async () => {
        const other = db.get("clients", $("#merge-sel", el).value);
        if (!other) return toast("Elegí la ficha repetida");
        if (!(await confirmBox(`Los pedidos de “${esc(other.name)}” pasan a “${esc(c.name)}” y la ficha “${esc(other.name)}” se borra.`, "Unir fichas"))) return;
        await mergeClients(id, other.id);
        m.close();
        toast("🔗 Fichas unidas", c.name);
        openClientCard(id);
      });
    },
  });
}
