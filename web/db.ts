// Almacenamiento offline-first con IndexedDB + sincronización con la compu.
// Cada dispositivo guarda todo localmente (funciona sin internet) y anota sus cambios en una "bandeja de salida".
// Cuando llega a la compu (servidor TRADEX), sube esos cambios y baja los de los demás dispositivos.

const DB_NAME = "tradex";
const DB_VERSION = 7;
export const COLLECTIONS = ["orders", "clients", "suppliers", "products", "tasks", "notifications", "settings", "worklog", "quotes", "personal", "combos"];

let idb;
const cache = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
const listeners = new Set<(col: string) => void>();
let meta = { id: "sync", rev: 0, serverId: "", lastSync: "" };

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const c of COLLECTIONS) if (!d.objectStoreNames.contains(c)) d.createObjectStore(c, { keyPath: "id" });
      if (!d.objectStoreNames.contains("outbox")) d.createObjectStore("outbox", { keyPath: "key" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "id" });
    };
    req.onsuccess = () => {
      // si otra pestaña abre una versión nueva de la app, esta se recarga sola para no trabarla
      req.result.onversionchange = () => { req.result.close(); location.reload(); };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => document.dispatchEvent(new CustomEvent("tradex-blocked"));
  });
}

function tx(col, mode, fn): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = idb.transaction(col, mode);
    const r = fn(t.objectStore(col));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}
const getAll = (col): Promise<any[]> => new Promise((res) => { const r = idb.transaction(col).objectStore(col).getAll(); r.onsuccess = () => res(r.result); });

async function enqueue(col, doc) {
  await tx("outbox", "readwrite", (s) => s.put({ key: `${col}/${doc.id}`, col, doc }));
  scheduleSync();
}

export const db = {
  async init() {
    idb = await open();
    for (const c of COLLECTIONS) (await getAll(c)).forEach((row) => cache[c].set(row.id, row));
    meta = (await getAll("meta")).find((m) => m.id === "sync") || meta;
    // primera vez con sincronización: todo lo que ya había en este dispositivo se sube
    if (!meta.serverId && !(await getAll("outbox")).length) {
      for (const c of COLLECTIONS) for (const row of cache[c].values()) await tx("outbox", "readwrite", (s) => s.put({ key: `${c}/${row.id}`, col: c, doc: row }));
    }
  },
  all(col) { return [...cache[col].values()]; },
  get(col, id) { return cache[col].get(id); },
  async put(col, obj) {
    obj.id ||= uid();
    obj.updatedAt = new Date().toISOString();
    obj.createdAt ||= obj.updatedAt;
    cache[col].set(obj.id, obj);
    await tx(col, "readwrite", (s) => s.put(obj));
    await enqueue(col, obj);
    emit(col);
    return obj;
  },
  async remove(col, id) {
    cache[col].delete(id);
    await tx(col, "readwrite", (s) => s.delete(id));
    // se avisa al resto de los dispositivos que se borró
    await enqueue(col, { id, deleted: true, updatedAt: new Date().toISOString() });
    emit(col);
  },
  async removeAll(col) {
    for (const id of [...cache[col].keys()]) await this.remove(col, id);
  },
  // Respaldo completo (JSON) y restauración (se propaga a todos los dispositivos)
  dump() { return { app: "TRADEX", exportedAt: new Date().toISOString(), ...Object.fromEntries(COLLECTIONS.map((c) => [c, this.all(c)])) }; },
  async restore(data) {
    for (const c of COLLECTIONS) {
      if (!Array.isArray(data[c])) continue;
      const keep = new Set(data[c].map((r) => r.id));
      for (const id of [...cache[c].keys()]) if (!keep.has(id)) await this.remove(c, id);
      for (const row of data[c]) await this.put(c, { ...row });
    }
    emit("*");
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

function emit(col) { listeners.forEach((fn) => fn(col)); }

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------------- sincronización ----------------
export const syncState = { status: "idle", pending: 0, lastSync: "", error: "" };
const syncListeners = new Set<(s: typeof syncState) => void>();
export const onSyncChange = (fn) => syncListeners.add(fn);
const setSync = (patch) => { Object.assign(syncState, patch); syncListeners.forEach((fn) => fn(syncState)); };
export const pinHeader = () => ({ "x-tradex-pin": localStorage.getItem("v-pin") || "" });

let syncing = false, again = false, timer;
function scheduleSync(ms = 1500) { clearTimeout(timer); timer = setTimeout(syncNow, ms); }

export async function syncNow() {
  if (!idb) return;
  if (syncing) { again = true; return; }
  syncing = true;
  try {
    const outbox = await getAll("outbox");
    setSync({ status: "syncing", pending: outbox.length });
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...pinHeader() },
      body: JSON.stringify({ since: meta.rev, changes: outbox.map(({ col, doc }) => ({ col, doc })) }),
    });
    if (res.status === 401) { setSync({ status: "pin", pending: outbox.length, error: "Falta el PIN" }); return; }
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const data = await res.json();
    // lo que se subió sale de la bandeja (salvo que se haya vuelto a editar mientras tanto)
    for (const o of outbox) {
      const cur: any = await new Promise((r) => { const q = idb.transaction("outbox").objectStore("outbox").get(o.key); q.onsuccess = () => r(q.result); });
      if (cur && cur.doc.updatedAt === o.doc.updatedAt) await tx("outbox", "readwrite", (s) => s.delete(o.key));
    }
    if (meta.serverId && meta.serverId !== data.serverId) {
      // la compu tiene una base nueva (por ejemplo se borró la carpeta data): le volvemos a subir todo lo de acá
      for (const c of COLLECTIONS) for (const row of cache[c].values()) await tx("outbox", "readwrite", (s) => s.put({ key: `${c}/${row.id}`, col: c, doc: row }));
      meta = { ...meta, serverId: data.serverId, rev: 0 };
      again = true;
    } else {
      const changed = await applyRemote(data.changes);
      meta = { ...meta, serverId: data.serverId, rev: data.rev, lastSync: new Date().toISOString() };
      if (changed) emit("*");
    }
    await tx("meta", "readwrite", (s) => s.put(meta));
    setSync({ status: "ok", pending: (await getAll("outbox")).length, lastSync: meta.lastSync, error: "" });
  } catch (e) {
    setSync({ status: "offline", pending: (await getAll("outbox")).length, error: (e as Error).message });
  } finally {
    syncing = false;
    if (again) { again = false; scheduleSync(200); }
  }
}

async function applyRemote(changes) {
  let n = 0;
  for (const { col, doc } of changes) {
    if (!cache[col]) continue;
    const local = cache[col].get(doc.id);
    if (local && (local.updatedAt || "") > (doc.updatedAt || "")) continue; // lo de acá es más nuevo
    if (doc.deleted) {
      if (!local) continue;
      cache[col].delete(doc.id);
      await tx(col, "readwrite", (s) => s.delete(doc.id));
    } else {
      if (local && local.updatedAt === doc.updatedAt) continue;
      cache[col].set(doc.id, doc);
      await tx(col, "readwrite", (s) => s.put(doc));
    }
    n++;
  }
  return n;
}

export function startSync() {
  syncNow();
  setInterval(syncNow, 20000);
  window.addEventListener("online", () => syncNow());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNow(); });
}

// Configuración (un único documento "settings/main")
export const DEFAULT_SETTINGS = {
  id: "main",
  mode: "light",
  businessName: "TRADEX",
  businessPhone: "",
  businessAddress: "",
  pickupInfo: "el local",
  markup: 60,
  markupHigh: 50,
  markupThreshold: 100000,
  shipSmall: 30000,
  shipBig: 65000,
  hidden: [
    { key: "bags", name: "Bolsitas", cost: 1000, on: true },
    { key: "labels", name: "Etiquetas", cost: 300, on: true },
    { key: "pens", name: "Regalito lapicera", cost: 800, on: true },
    { key: "cards", name: "Tarjetita", cost: 300, on: true },
  ],
  iva: 21,
  // Cobros con Naranja X (monotributo cat. A): comisión + 21% de IVA sobre la comisión (no se recupera, es costo).
  payMedia: [
    { name: "Link de Pago", cuenta: 0.8, debito: 1.2, credito: 4.5 },
    { name: "Nave Mini", cuenta: 0.8, debito: 2.2, credito: 5.3 },
  ],
  // Costo de financiación por ofrecer cuotas (se suma a la comisión de crédito)
  financing: [
    { label: "Crédito 1 pago", n: 1, rate: 0 },
    { label: "3 cuotas", n: 3, rate: 9.85 },
    { label: "6 cuotas", n: 6, rate: 18.05 },
    { label: "9 cuotas", n: 9, rate: 29.76 },
    { label: "12 cuotas", n: 12, rate: 40.24 },
    { label: "18 cuotas", n: 18, rate: 63.53 },
    { label: "Plan Z", n: 0, rate: 9.85 },
  ],
  ivaOnFinancing: false,
  iibb: 0, // % de retención de Ingresos Brutos, si te la aplican (revisalo en tus extractos)
  extraHolidays: [],
  waTemplates: [
    { name: "Pedido listo", text: "Hola {nombre}! 💜 Te quería avisar que mañana estaría listo tu pedido, lo podés retirar por {retiro}. Avisame a qué hora te viene mejor 😊" },
    { name: "Recordar saldo", text: "Hola {nombre}! ¿Cómo estás? Te recuerdo que el saldo de tu pedido es de {saldo}. Podés transferir al alias que te pasé. ¡Gracias! ✨" },
    { name: "Pedido despachado", text: "Hola {nombre}! Tu pedido ya fue despachado 📦 Apenas tenga el número de seguimiento te lo paso." },
    { name: "Confirmar seña", text: "Hola {nombre}! Recibí tu seña de {sena} 🙌 Tu pedido para el {evento} ya está en marcha. Total {total}, saldo {saldo}." },
  ],
  notifyPush: false,
};

export function settings() {
  return { ...DEFAULT_SETTINGS, ...(db.get("settings", "main") || {}) };
}
export async function saveSettings(patch) {
  return db.put("settings", { ...settings(), ...patch, id: "main" });
}
