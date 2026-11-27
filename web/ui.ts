// Piezas de interfaz reutilizables: modal, toasts, confirmación, lectura de formularios.
import { icon, esc } from "./utils.js";

// Búsquedas en el DOM: devuelven any porque cada vista sabe qué tipo de elemento pidió.
const $ = (s: string, el: ParentNode = document): any => el.querySelector(s);
export { $ };
export const $$ = (s: string, el: ParentNode = document): any[] => [...el.querySelectorAll(s)];

// Formularios abiertos con cambios sin guardar (para avisar antes de cerrar o recargar la página)
const dirtyModals = new Set();
window.addEventListener("beforeunload", (e) => { if (dirtyModals.size) { e.preventDefault(); e.returnValue = ""; } });

export function modal({ title, body, foot = "", wide = false, onMount, onClose }: Rec) {
  const root = $("#modal-root");
  const wrap = document.createElement("div");
  wrap.className = "modal-back";
  wrap.innerHTML = `
    <div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${title}</h2><button class="btn ghost icon x" data-close aria-label="Cerrar">${icon("x")}</button></div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ""}
    </div>`;
  // Se marca "con cambios" cuando la persona escribe o elige algo en el formulario
  const markDirty = (e) => { if (e.isTrusted && e.target.closest(".modal-body") && e.target.matches("input, select, textarea")) dirtyModals.add(wrap); };
  wrap.addEventListener("input", markDirty);
  wrap.addEventListener("change", markDirty);
  // close(): cierre del programa (por ejemplo al guardar), sin preguntar
  const close = () => { dirtyModals.delete(wrap); wrap.remove(); document.removeEventListener("keydown", onKey); onClose?.(); };
  // cierre pedido por la persona: si hay cambios sin guardar, pregunta antes
  let asking = false;
  const tryClose = async () => {
    if (asking) return;
    if (dirtyModals.has(wrap)) {
      asking = true;
      const leave = await confirmBox("Tenés datos cargados sin guardar. Si salís, se pierden.", "Sí, salir sin guardar", { title: "¿Seguro que querés abandonar el formulario?", cancel: "Seguir completando" });
      asking = false;
      if (!leave) return;
    }
    close();
  };
  const onKey = (e) => { if (e.key === "Escape" && root.lastElementChild === wrap) tryClose(); };
  wrap.addEventListener("click", (e) => { if (e.target === wrap || (e.target as Element).closest("[data-close]")) tryClose(); });
  document.addEventListener("keydown", onKey);
  root.appendChild(wrap);
  const api = { el: wrap, close, tryClose, isDirty: () => dirtyModals.has(wrap) };
  onMount?.(wrap, api);
  return api;
}

export function confirmBox(text, okLabel = "Sí, continuar", { title = "¿Confirmás?", cancel = "Cancelar" }: Rec = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: `<p>${text}</p>`,
      foot: `<button class="btn" data-close>${cancel}</button><button class="btn primary" id="cf-ok">${okLabel}</button>`,
      onMount: (el, api) => { $("#cf-ok", el).onclick = () => { resolve(true); api.close(); }; },
      onClose: () => resolve(false), // cerrar de cualquier forma (X, Escape, afuera) = no
    });
    return m;
  });
}

export function toast(title, body = "", { urgent = false, ms = 5000, action }: Rec = {}) {
  const el = document.createElement("div");
  el.className = `toast ${urgent ? "urgent" : ""}`;
  el.innerHTML = `<div><div class="t">${esc(title)}</div>${body ? `<div class="b">${esc(body)}</div>` : ""}
    ${action ? `<button class="btn sm soft" style="margin-top:8px">${esc(action.label)}</button>` : ""}</div>
    <button class="btn ghost icon sm" aria-label="Cerrar">${icon("x")}</button>`;
  const btns = el.querySelectorAll("button");
  if (action) btns[0].onclick = () => { action.run(); el.remove(); };
  btns[btns.length - 1].onclick = () => el.remove();
  $("#toasts").appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms);
}

// Lee los campos [name] de un contenedor como objeto (números, checkboxes y fechas incluidos)
export function readForm(el) {
  const out: Rec = {};
  for (const f of $$("[name]", el)) {
    if (f.type === "checkbox") out[f.name] = f.checked;
    else if (f.type === "number" || f.dataset.money) out[f.name] = f.value === "" ? "" : Number(f.value);
    else out[f.name] = f.value.trim();
  }
  return out;
}

export const options = (list, sel, empty = "") =>
  (empty !== null ? `<option value="">${empty}</option>` : "") +
  list.map((v) => {
    const [val, label] = Array.isArray(v) ? v : [v, v];
    return `<option value="${esc(val)}" ${String(val) === String(sel ?? "") ? "selected" : ""}>${esc(label)}</option>`;
  }).join("");

export function stars(n = 0) {
  return `<span class="stars" title="${n}/5">${"★".repeat(Math.round(n))}${'<span style="opacity:.25">★</span>'.repeat(5 - Math.round(n))}</span>`;
}

// Autocompletar: mientras escribís sugiere nombres (clientes, proveedores, productos).
// source(q) devuelve [{ icon, label, sub, value }]. Al elegir, completa el campo y filtra.
export function autocomplete(input, source, { onPick }: Rec = {}) {
  const wrap = input.parentElement;
  wrap.style.position = "relative";
  const box = document.createElement("div");
  box.className = "ac-box hidden";
  wrap.appendChild(box);
  let items = [], idx = -1;
  const close = () => { box.classList.add("hidden"); idx = -1; };
  const draw = () => {
    const q = input.value.trim();
    items = q ? source(q).slice(0, 8) : [];
    if (!items.length) return close();
    box.innerHTML = items.map((it, i) => `<button type="button" class="ac-item ${i === idx ? "on" : ""}" data-i="${i}">
      <span class="ac-ic">${it.icon || ""}</span><span class="ac-txt"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span></button>`).join("");
    box.classList.remove("hidden");
  };
  const pick = (i) => {
    const it = items[i];
    if (!it) return;
    input.value = it.value ?? it.label;
    close();
    input.dispatchEvent(new Event("input", { bubbles: true })); // filtra con lo elegido (no vuelve a abrir la lista)
    onPick?.(it);
  };
  input.addEventListener("input", (e) => { if (e.isTrusted) { idx = -1; draw(); } });
  input.addEventListener("focus", draw);
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", (e) => {
    if (box.classList.contains("hidden")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); idx = (idx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; draw(); }
    else if (e.key === "Enter" && idx >= 0) { e.preventDefault(); pick(idx); }
    else if (e.key === "Escape") close();
  });
  box.addEventListener("mousedown", (e) => { const b = (e.target as Element).closest<HTMLElement>("[data-i]"); if (b) { e.preventDefault(); pick(Number(b.dataset.i)); } });
}
