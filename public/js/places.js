// Provincia y localidad del cliente, con autocompletado (lista oficial de localidades de Argentina, georef).
// Se escribe sin tildes ("belen" encuentra "Belén") y al elegir la localidad se completa sola la provincia.
import { esc } from "./utils.js";
import { autocomplete } from "./ui.js";
import { norm } from "./suggest.js";

export const PROVINCES = ["Buenos Aires", "CABA", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán"];

let places = null; // { provincia: [localidades] }
const load = () => (places ??= fetch("/vendor/localidades.json").then((r) => r.json()).catch(() => ({})));
load();

// "Belén, Catamarca" (o la dirección vieja si el cliente es de antes)
export const placeText = (c) => [c?.city, c?.province].filter(Boolean).join(", ") || c?.address || "";

// Para clientes viejos con "Belen Catamarca" en la dirección: separa provincia y localidad
export function splitAddress(address = "") {
  const a = norm(address);
  const province = PROVINCES.find((p) => a.includes(norm(p))) || "";
  const city = province ? address.replace(new RegExp(norm(province).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").replace(/[,\s-]+$|^[,\s-]+/g, "").trim() : address.trim();
  return { province, city };
}

// Característica del teléfono → provincia y localidad (se completa sola si están vacías)
const AREA_CODES = [["3834", "Catamarca", "San Fernando del Valle de Catamarca"], ["3835", "Catamarca", "Belén"]];
export function placeFromPhone(phone) {
  let d = String(phone || "").replace(/\D/g, "").replace(/^54/, "").replace(/^9/, "").replace(/^0/, "");
  const hit = AREA_CODES.find(([code]) => d.startsWith(code));
  return hit ? { province: hit[1], city: hit[2] } : null;
}

export function placeFields(prefix, c = {}) {
  const old = !c.province && !c.city && c.address ? splitAddress(c.address) : {};
  return `<label class="field">Provincia<input name="${prefix}province" value="${esc(c.province || old.province || "")}" placeholder="Ej: Catamarca" autocomplete="off"></label>
    <label class="field">Localidad<input name="${prefix}city" value="${esc(c.city || old.city || "")}" placeholder="Ej: Belén" autocomplete="off"></label>`;
}

export async function bindPlaces(form, prefix) {
  const prov = form.querySelector(`[name="${prefix}province"]`), city = form.querySelector(`[name="${prefix}city"]`);
  if (!prov || !city) return;
  const phone = form.querySelector(`[name="${prefix}phone"]`);
  phone?.addEventListener("input", () => {
    const p = placeFromPhone(phone.value);
    if (p && !prov.value.trim() && !city.value.trim()) { prov.value = p.province; city.value = p.city; }
  });
  autocomplete(prov, (q) => PROVINCES.filter((p) => norm(p).includes(norm(q))).map((p) => ({ icon: "📍", label: p })));
  const data = await load();
  autocomplete(city, (q) => {
    const n = norm(q);
    const inProv = PROVINCES.find((p) => norm(p) === norm(prov.value));
    const pool = inProv ? [[inProv, data[inProv] || []]] : Object.entries(data);
    const out = [];
    for (const [p, list] of pool) for (const l of list) if (norm(l).includes(n)) out.push({ icon: "🏘️", label: l, sub: p, value: l, p, starts: norm(l).startsWith(n) });
    return out.sort((a, b) => b.starts - a.starts || a.label.length - b.label.length);
  }, { onPick: (it) => { if (!prov.value) prov.value = it.p; } });
  // si la localidad está escrita sin tilde ("Belen"), queda con el nombre oficial ("Belén")
  const fixCity = () => { const p = PROVINCES.find((x) => norm(x) === norm(prov.value)); const l = p && (data[p] || []).find((x) => norm(x) === norm(city.value)); if (l && l !== city.value) city.value = l; };
  fixCity();
  city.addEventListener("change", fixCity);
  // si la provincia se escribe sin tilde, queda con el nombre oficial
  prov.addEventListener("change", () => { const p = PROVINCES.find((x) => norm(x) === norm(prov.value)); if (p) prov.value = p; });
}
