// TRADEX 1.0 — arranque, navegación, tema y modo offline.
import { db, settings, saveSettings, syncState, onSyncChange, startSync } from "./db.js";
import { icon, typingDni, isCuit } from "./utils.js";
import { $, $$, modal, toast } from "./ui.js";
import { syncNotifications, activeAlerts } from "./alerts.js";
import { renderBell, toggleBell, askOncePerDay } from "./todos.js";
import { initAssistant, voiceAvailable } from "./assistant.js";
import { initMoneyInputs } from "./moneyinput.js";
import { startWorkTimer, endOfDay, workChip } from "./worktime.js";
import * as dashboard from "./views/dashboard.js";
import * as orders from "./views/orders.js";
import * as clients from "./views/clients.js";
import * as loyalty from "./views/loyalty.js";
import * as suppliers from "./views/suppliers.js";
import * as products from "./views/products.js";
import * as quote from "./views/quote.js";
import * as calendar from "./views/calendar.js";
import * as billing from "./views/billing.js";
import * as finance from "./views/finance.js";
import * as stats from "./views/stats.js";
import * as cuotas from "./views/cuotas.js";
import * as personal from "./views/personal.js";
import * as config from "./views/settings.js";

// Cada apartado tiene su paleta: violeta (pedidos), rosa-fucsia (proveedores), celeste-agua (agenda y finanzas), verde (finanzas personales)
const ROUTES = [
  { path: "personal", label: "Finanzas personales", icon: "piggy", palette: "green", group: "Finanzas personales", view: personal },
  { path: "", label: "Inicio", icon: "home", palette: "violet", group: "Pedidos y clientes", view: dashboard },
  { path: "pedidos", label: "Pedidos", icon: "bag", palette: "violet", group: "Pedidos y clientes", view: orders },
  { path: "clientes", label: "Clientes", icon: "users", palette: "violet", group: "Pedidos y clientes", view: clients },
  { path: "fidelizacion", label: "Fidelización", icon: "star", palette: "violet", group: "Pedidos y clientes", view: loyalty },
  { path: "proveedores", label: "Proveedores", icon: "factory", palette: "pink", group: "Proveedores e insumos", view: suppliers },
  { path: "productos", label: "Productos", icon: "box", palette: "pink", group: "Proveedores e insumos", view: products },
  { path: "cotizador", label: "Cotizador", icon: "calc", palette: "pink", group: "Proveedores e insumos", view: quote },
  { path: "cuotas", label: "Cuotas", icon: "card", palette: "pink", group: "Proveedores e insumos", view: cuotas },
  { path: "calendario", label: "Calendario", icon: "cal", palette: "aqua", group: "Agenda y finanzas", view: calendar },
  { path: "facturar", label: "Facturar", icon: "receipt", palette: "aqua", group: "Agenda y finanzas", view: billing },
  { path: "finanzas", label: "Finanzas", icon: "wallet", palette: "aqua", group: "Agenda y finanzas", view: finance },
  { path: "estadisticas", label: "Estadísticas", icon: "chart", palette: "aqua", group: "Agenda y finanzas", view: stats },
  { path: "ajustes", label: "Ajustes", icon: "cog", palette: "violet", group: null, view: config },
];
const GROUP_COLOR = { "Pedidos y clientes": "#8b3dff", "Proveedores e insumos": "#8b3dff", "Agenda y finanzas": "#8b3dff", "Finanzas personales": "#8b3dff" };
const MOBILE = ["", "pedidos", "productos", "cuotas", "calendario"];

let current = null;

function routeFromHash() {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  return { route: ROUTES.find((r) => r.path === path) || ROUTES.find((r) => r.path === ""), params: Object.fromEntries(new URLSearchParams(query || "")) };
}

function renderNav() {
  const alerts = activeAlerts().length;
  let html = `<div class="brand"><div class="brand-logo">T</div><div><div class="brand-name">TRADEX</div><div class="brand-ver">Gestión · v1.0</div></div></div>`;
  let group;
  for (const r of ROUTES) {
    if (r.group && r.group !== group) { group = r.group; html += `<div class="nav-group"><i style="background:${GROUP_COLOR[group]}"></i>${group}</div>`; }
    if (!r.group && group !== "__") { group = "__"; html += `<div class="nav-group">Sistema</div>`; }
    html += `<a class="nav-link" href="#/${r.path}" data-path="${r.path}">${icon(r.icon)}<span>${r.label}</span>${r.badge && alerts ? `<span class="count">${alerts}</span>` : ""}</a>`;
  }
  html += `<div class="sidebar-foot"><div class="work-slot">${workChip()}</div>
    <button class="btn eod-btn" data-eod>🌙 Fin del día</button>
    <div id="net-badge"></div>
    <button class="btn" id="mode-btn">${currentMode() === "dark" ? icon("sun") + " Modo claro" : icon("moon") + " Modo oscuro"}</button></div>`;
  $("#sidebar").innerHTML = html;

  $("#bottom-nav").innerHTML = MOBILE.map((p) => {
    const r = ROUTES.find((x) => x.path === p);
    return `<a href="#/${p}" data-path="${p}">${icon(r.icon)}<span>${r.label}</span></a>`;
  }).join("") + `<a href="#" id="more-btn">${icon("list")}<span>Más</span>${alerts ? `<span class="count">${alerts}</span>` : ""}</a>`;

  $("#mode-btn").onclick = toggleMode;
  $("#mode-top").onclick = toggleMode;
  $("#more-btn").onclick = (e) => { e.preventDefault(); openMore(); };
  markActive();
  renderNet();
  renderBell();
}

function openMore() {
  const alerts = activeAlerts().length;
  modal({
    title: "Menú",
    body: `<div class="stack">${ROUTES.map((r) => `<a class="nav-link" href="#/${r.path}" data-close>${icon(r.icon)}<span>${r.label}</span>${r.badge && alerts ? `<span class="count">${alerts}</span>` : ""}</a>`).join("")}
      <div class="work-slot">${workChip()}</div>
      <button class="btn eod-btn" data-eod data-close>🌙 Fin del día</button>
      <div id="net-badge-m">${syncBadge()}</div>
      <button class="btn" id="mode-btn-m" data-close>${currentMode() === "dark" ? icon("sun") + " Modo claro" : icon("moon") + " Modo oscuro"}</button></div>`,
    onMount: (el) => { $("#mode-btn-m", el).onclick = toggleMode; },
  });
}

function markActive() {
  const path = current?.route.path ?? "";
  $$("[data-path]").forEach((a) => a.classList.toggle("active", a.dataset.path === path));
}

// El modo claro/oscuro se elige por dispositivo (el celular y la compu pueden tener uno distinto)
const currentMode = () => localStorage.getItem("v-mode") || settings().mode || "light";
async function toggleMode() {
  localStorage.setItem("v-mode", currentMode() === "dark" ? "light" : "dark");
  applyMode();
  renderNav();
}
function applyMode() {
  document.documentElement.dataset.mode = currentMode();
  const b = $("#mode-top");
  if (b) { b.innerHTML = icon(currentMode() === "dark" ? "sun" : "moon"); b.title = currentMode() === "dark" ? "Pasar a modo claro" : "Pasar a modo oscuro"; }
}

// Estado de la sincronización con la compu
export function syncBadge() {
  const s = syncState;
  const hora = s.lastSync ? new Date(s.lastSync).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "";
  if (s.status === "ok" && !s.pending) return `<span class="badge-on">${icon("check")} Sincronizado ${hora}</span>`;
  if (s.status === "pin") return `<a href="#/ajustes" class="badge-off" style="text-decoration:none">${icon("alert")} Falta el PIN para sincronizar</a>`;
  if (s.status === "syncing") return `<span class="badge-on">${icon("wifi")} Sincronizando…</span>`;
  if (s.status === "offline") return `<span class="badge-off">${icon("wifi")} Sin conexión con la compu${s.pending ? ` · ${s.pending} cambios guardados acá` : ""}</span>`;
  return `<span class="badge-on">${icon("wifi")} Guardado</span>`;
}
function renderNet() {
  document.querySelectorAll("#net-badge, #net-badge-m").forEach((el) => (el.innerHTML = syncBadge()));
}

export function render() {
  current = routeFromHash();
  const { route, params } = current;
  document.documentElement.dataset.palette = route.palette;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta.content = "#8b3dff";
  const view = $("#view");
  const head = route.view.render(view, params) || {};
  $("#page-title").textContent = head.title || route.label;
  $("#page-sub").textContent = head.sub || "";
  $("#topbar-actions").innerHTML = head.actions || "";
  head.bind?.($("#topbar-actions"));
  markActive();
  $("#settings-top").classList.toggle("on", route.path === "ajustes");
}

let pending;
function rerenderSoon(col) {
  if (col === "worklog") return; // el contador de horas no redibuja la pantalla
  clearTimeout(pending);
  pending = setTimeout(() => {
    // no redibujar si la persona está escribiendo en la vista
    const a = document.activeElement;
    if (a?.closest("#view") && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && !["checkbox", "radio"].includes(a.type)) return;
    render();
    renderNav();
  }, 60);
}

async function start() {
  initMoneyInputs();
  // DNI o CUIL: los guiones del CUIT se ponen solos mientras escribís
  document.addEventListener("input", (e) => {
    const i = e.target;
    if (!i.matches?.('input[name="dni"], input[name="c_dni"]')) return;
    const v = typingDni(i.value);
    if (v !== i.value) { i.value = v; i.setSelectionRange(v.length, v.length); }
    const hint = i.parentElement.querySelector(".cuit-hint") || i.insertAdjacentElement("afterend", Object.assign(document.createElement("span"), { className: "small cuit-hint" }));
    hint.textContent = isCuit(v) ? "🧾 Con CUIT: lleva factura" : "";
  });
  document.addEventListener("tradex-blocked", () => toast("Hay otra pestaña de TRADEX abierta con una versión vieja", "Cerrala para terminar de actualizar.", { urgent: true, ms: 0 }));
  await db.init();
  startWorkTimer(); // cuenta el tiempo con TRADEX abierta
  // packaging de siempre: suma la tarjetita y deja todos activados (una sola vez)
  if (!settings().hiddenV2) {
    const hidden = settings().hidden.map((h) => ({ ...h, on: true }));
    if (!hidden.some((h) => h.key === "cards")) hidden.push({ key: "cards", name: "Tarjetita", cost: 300, on: true });
    saveSettings({ hidden, hiddenV2: true });
  }
  applyMode();
  $("#settings-top").innerHTML = `${icon("cog")}<span>Ajustes</span>`;
  $("#bell-top").onclick = (e) => { e.preventDefault(); toggleBell(); };
  $("#fab").innerHTML = icon(voiceAvailable() ? "mic" : "chat");
  $("#fab").title = voiceAvailable() ? "Hablar con Dex" : "Escribirle a Dex";
  renderNav();
  render();
  initAssistant();
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  window.addEventListener("online", () => { renderNet(); });
  window.addEventListener("offline", () => { renderNet(); });
  db.onChange(rerenderSoon);
  document.addEventListener("tradex-worktime", () => document.querySelectorAll(".work-slot").forEach((el) => (el.innerHTML = workChip())));
  document.addEventListener("click", (e) => { if (e.target.closest("[data-eod]")) endOfDay(); });
  let pinWarned = false;
  onSyncChange((s) => {
    renderNet();
    if (s.status === "pin" && !pinWarned) { pinWarned = true; toast("🔒 Ingresá el PIN de TRADEX", "Para sincronizar con la compu.", { urgent: true, ms: 0, action: { label: "Ir a Ajustes", run: () => (location.hash = "#/ajustes") } }); }
  });
  startSync();
  await syncNotifications();
  renderNav();
  setTimeout(askOncePerDay, 2500); // una vez por día te abre la campanita con lo que hay que hacer
  setInterval(() => syncNotifications().then(renderNav), 30 * 60 * 1000);
  if ("serviceWorker" in navigator) {
    // Si hay una versión nueva de TRADEX, avisa para recargar (no recarga sola: podés estar cargando un pedido)
    const hadSW = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadSW) toast("✨ Hay una versión nueva de TRADEX", "Guardá lo que estés cargando y tocá Actualizar.", { ms: 0, action: { label: "Actualizar", run: () => location.reload() } });
    });
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }
}

start();
