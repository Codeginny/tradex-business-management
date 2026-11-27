// Fichas de clientes: cada pedido apunta a una ficha (clientId).
// El pedido guarda además una copia de nombre/teléfono/dirección/DNI para mostrarlos rápido;
// cuando se edita la ficha, esa copia se actualiza en todos sus pedidos.
import { db } from "./db.js";
import { orderTotal, orderBalance, orderCost } from "./utils.js";

const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
const phoneKey = (p) => String(p || "").replace(/\D/g, "").slice(-8);
const FIELDS = ["name", "phone", "address", "province", "city", "dni"];

export const snapshot = (c) => Object.fromEntries(FIELDS.map((k) => [k, c?.[k] || ""]));

export function findClient(c: Rec = {}) {
  const list = db.all("clients");
  const pk = phoneKey(c.phone);
  return (pk.length >= 6 && list.find((x) => phoneKey(x.phone) === pk))
    || (c.dni && list.find((x) => String(x.dni || "").replace(/\D/g, "") === String(c.dni).replace(/\D/g, "")))
    || (c.name && list.find((x) => norm(x.name) === norm(c.name)))
    || null;
}

export const clientOrders = (id) => db.all("orders").filter((o) => o.clientId === id && !o.archived);
// Tarjetita de clientes fieles: un sticker por cada compra en la que se lo diste
export const clientStickers = (id) => clientOrders(id).filter((o) => o.sticker).length;

// Actualiza la copia del cliente en todos sus pedidos
export async function refreshOrdersOf(client) {
  const snap = snapshot(client);
  for (const o of clientOrders(client.id)) {
    if (FIELDS.some((k) => (o.client?.[k] || "") !== snap[k])) await db.put("orders", { ...o, client: snap });
  }
}

// Devuelve la ficha del cliente de un pedido: la existente (actualizada con lo nuevo) o una nueva
export async function ensureClient(data, clientId) {
  data = { ...data, name: String(data?.name || "").trim() };
  const chosen = clientId && db.get("clients", clientId);
  let cl = chosen || findClient(data);
  if (!cl) return db.put("clients", { ...snapshot(data), notes: "" });
  // Si el pedido ya estaba vinculado a la ficha, lo que se editó en el pedido corrige la ficha.
  // Si la ficha se encontró por teléfono/DNI/nombre, solo se completan los datos que le faltan.
  const patch: Rec = {};
  for (const k of FIELDS) if (data[k] && data[k] !== cl[k] && (chosen || !cl[k])) patch[k] = data[k];
  if (Object.keys(patch).length) {
    cl = await db.put("clients", { ...cl, ...patch });
    await refreshOrdersOf(cl);
  }
  return cl;
}

export async function saveClient(c) {
  const saved = await db.put("clients", { ...c, name: String(c.name || "").trim() });
  await refreshOrdersOf(saved);
  return saved;
}

// Une dos fichas del mismo cliente: los pedidos de "drop" pasan a "keep" y "drop" se borra
export async function mergeClients(keepId, dropId) {
  const keep = db.get("clients", keepId), drop = db.get("clients", dropId);
  if (!keep || !drop || keepId === dropId) return;
  const patch: Rec = {};
  for (const k of FIELDS) if (!keep[k] && drop[k]) patch[k] = drop[k];
  if (drop.notes) patch.notes = [keep.notes, drop.notes].filter(Boolean).join("\n");
  const merged = await db.put("clients", { ...keep, ...patch });
  for (const o of clientOrders(dropId)) await db.put("orders", { ...o, clientId: keepId, client: snapshot(merged) });
  await db.remove("clients", dropId);
  await refreshOrdersOf(merged);
}

// Ficha + números de cada cliente
export function clientsWithStats() {
  const byId: Rec = {};
  for (const o of db.all("orders")) if (o.clientId && !o.archived) (byId[o.clientId] ||= []).push(o);
  return db.all("clients").map((c) => {
    const orders = byId[c.id] || [];
    const withCost = orders.filter((o) => orderCost(o));
    return {
      ...c, orders,
      spent: orders.reduce((a, o) => a + orderTotal(o), 0),
      balance: orders.reduce((a, o) => a + orderBalance(o), 0),
      profit: withCost.reduce((a, o) => a + orderTotal(o) - orderCost(o), 0),
      last: orders.map((o) => o.deadline || o.eventDate || o.createdAt?.slice(0, 10) || "").sort().at(-1) || "",
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
