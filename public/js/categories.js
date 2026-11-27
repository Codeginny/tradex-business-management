// Categorías de productos: se guardan en Ajustes y se pueden agregar desde cualquier lista ("➕ Nueva categoría…").
import { db, settings, saveSettings } from "./db.js";
import { esc, CATEGORIES } from "./utils.js";
import { modal, toast } from "./ui.js";

// Adivina la categoría por el nombre del producto
export function guessCategory(name) {
  const n = name.toLowerCase();
  // primero tus categorías propias ("Llaveros" reconoce "llavero acrílico")
  const own = categories().find((c) => c.length > 3 && n.includes(c.toLowerCase().replace(/(es|s)$/, "")));
  if (own) return own;
  const rules = [["Tazas", /taza|mug|jarro/], ["Vasos", /eco ?vaso|vaso/], ["Botellas", /botell|termo|caramagnola/], ["Velas", /vela|aroma/], ["Skincare", /skin|crema|serum|jab[oó]n|kit facial/], ["Mochilas", /mochila/], ["Difusor", /difusor/], ["Llaveros", /llavero/]];
  // solo sugiere categorías que existen en tu lista; si no reconoce el producto la deja vacía
  const list = categories();
  return rules.find(([c, r]) => list.includes(c) && r.test(n))?.[0] || "";
}

export const categories = () => (settings().categories?.length ? settings().categories : CATEGORIES);

const NEW = "__nueva__";
export const categoryOptions = (selected) => {
  const list = categories();
  const extra = selected && !list.includes(selected) ? [selected] : []; // por si un producto tiene una categoría vieja
  // "Nueva categoría" va arriba de todo, así no hay que bajar hasta el final para encontrarla
  return `<option value="">—</option><option value="${NEW}">➕ Nueva categoría…</option>${[...list, ...extra].sort((a, b) => a.localeCompare(b, "es")).map((c) => `<option value="${esc(c)}" ${c === selected ? "selected" : ""}>${esc(c)}</option>`).join("")}`;
};

export function askNewCategory() {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title: "➕ Nueva categoría",
      body: `<label class="field">Nombre de la categoría<input id="nc-name" placeholder="Ej: Llaveros"></label>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="nc-ok">Agregar</button>`,
      onMount: (el, m) => {
        const input = el.querySelector("#nc-name");
        setTimeout(() => input.focus(), 50);
        const ok = async () => {
          const name = input.value.trim().replace(/^\p{L}/u, (c) => c.toUpperCase());
          if (!name) return input.focus();
          const list = categories();
          const existing = list.find((c) => c.toLowerCase() === name.toLowerCase());
          if (!existing) { await saveSettings({ categories: [...list, name] }); toast("🏷️ Categoría agregada", name); }
          done = true; resolve(existing || name); m.close();
        };
        el.querySelector("#nc-ok").onclick = ok;
        input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); ok(); } };
      },
      onClose: () => { if (!done) resolve(null); },
    });
  });
}

// Cualquier <select> de categoría con la opción "Nueva categoría…" funciona solo
document.addEventListener("change", async (e) => {
  const sel = e.target;
  if (!(sel instanceof HTMLSelectElement) || sel.value !== NEW) return;
  const prev = sel.dataset.prev || "";
  const name = await askNewCategory();
  if (!name) { sel.value = prev; return; }
  if (![...sel.options].some((o) => o.value === name)) sel.insertAdjacentHTML("beforeend", `<option value="${esc(name)}">${esc(name)}</option>`);
  sel.value = name;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}, true);
document.addEventListener("focusin", (e) => { if (e.target instanceof HTMLSelectElement) e.target.dataset.prev = e.target.value; });

// Renombrar una categoría en todos los productos y pedidos
export async function renameCategory(from, to) {
  if (!from || !to || from === to) return 0;
  let n = 0;
  for (const p of db.all("products")) if (p.category === from) { await db.put("products", { ...p, category: to }); n++; }
  for (const o of db.all("orders")) {
    if ((o.items || []).some((i) => i.category === from)) { await db.put("orders", { ...o, items: o.items.map((i) => (i.category === from ? { ...i, category: to } : i)) }); n++; }
  }
  return n;
}

// Menú propio para los <select> de categoría (con mouse): lista con barra para bajar, que no se corta
// aunque haya muchas categorías. El <select> sigue siendo el mismo, así que el formulario no cambia.
let catPanel = null;
const closeCatPanel = () => { catPanel?.remove(); catPanel = null; };
document.addEventListener("mousedown", (e) => {
  if (catPanel && !catPanel.contains(e.target)) closeCatPanel();
  const sel = e.target;
  if (!(sel instanceof HTMLSelectElement) || !sel.querySelector(`option[value="${NEW}"]`) || !matchMedia("(pointer: fine)").matches) return;
  e.preventDefault();
  sel.focus();
  sel.dataset.prev = sel.value;
  const r = sel.getBoundingClientRect();
  const below = innerHeight - r.bottom - 12, above = r.top - 12;
  const up = below < 220 && above > below;
  catPanel = document.createElement("div");
  catPanel.className = "cat-panel";
  catPanel.style.cssText = `left:${r.left}px;width:${Math.max(r.width, 220)}px;max-height:${Math.min(340, up ? above : below)}px;${up ? `bottom:${innerHeight - r.top + 4}px` : `top:${r.bottom + 4}px`}`;
  catPanel.innerHTML = [...sel.options].map((o) => `<button type="button" data-v="${esc(o.value)}" class="${o.value === sel.value ? "on" : ""} ${o.value === NEW ? "new" : ""}">${esc(o.textContent)}</button>`).join("");
  catPanel.onclick = (ev) => {
    const b = ev.target.closest("[data-v]");
    if (!b) return;
    closeCatPanel();
    sel.value = b.dataset.v;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  };
  document.body.append(catPanel);
  catPanel.querySelector(".on")?.scrollIntoView({ block: "nearest" });
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && catPanel) { e.stopPropagation(); closeCatPanel(); } }, true);
addEventListener("resize", closeCatPanel);
document.addEventListener("scroll", (e) => { if (catPanel && !catPanel.contains(e.target)) closeCatPanel(); }, true);
