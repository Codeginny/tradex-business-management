// Sugerencias para los buscadores (sin importar mayúsculas ni tildes)
import { db } from "./db.js";
import { money } from "./utils.js";
import { clientsWithStats } from "./clientdb.js";

export const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
const has = (text, q) => norm(text).includes(norm(q));

export function clientSuggestions(q) {
  const digits = q.replace(/\D/g, "");
  return clientsWithStats()
    .filter((c) => has(c.name, q) || (digits.length >= 3 && (String(c.phone || "").replace(/\D/g, "").includes(digits) || String(c.dni || "").includes(digits))))
    .sort((a, b) => norm(a.name).indexOf(norm(q)) - norm(b.name).indexOf(norm(q)) || b.orders.length - a.orders.length)
    .map((c) => ({ icon: "👤", label: c.name, sub: [c.phone, `${c.orders.length} pedido${c.orders.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ") }));
}
export function supplierSuggestions(q) {
  return db.all("suppliers").filter((s) => has(`${s.name} ${s.contact} ${s.province}`, q))
    .map((s) => ({ icon: "🏭", label: s.name, sub: [s.contact, s.province, `${db.all("products").filter((p) => p.supplierId === s.id).length} productos`].filter(Boolean).join(" · ") }));
}
export function productSuggestions(q) {
  return db.all("products").filter((p) => has(`${p.name} ${p.category}`, q)).sort((a, b) => a.price - b.price)
    .map((p) => ({ icon: "📦", label: p.name, sub: `${money(p.price)} · ${db.get("suppliers", p.supplierId)?.name || "sin proveedor"}` }));
}
