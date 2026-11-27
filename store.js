// Base de datos central de TRADEX (en la compu) + copias de seguridad diarias.
// Cada celular o navegador guarda una copia local y sincroniza contra este archivo:
//   data/tradex.json            -> todos los datos (la "fuente de verdad")
//   data/backups/tradex-AAAA-MM-DD.json -> una copia por día
// Las copias usan el mismo formato que "Restaurar respaldo" de la app.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const COLLECTIONS = ["orders", "clients", "suppliers", "products", "tasks", "notifications", "settings", "worklog", "quotes", "personal", "combos"];
const KEEP_DAILY_DAYS = 60; // además se guarda para siempre la primera copia de cada mes

export function createStore({ dataDir, backupDir }) {
  const file = path.join(dataDir, "tradex.json");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  // Fotos de productos: un archivo por foto en data/fotos (nombre = huella del contenido, no se repiten)
  const photoDir = path.join(dataDir, "fotos");
  fs.mkdirSync(photoDir, { recursive: true });
  function savePhoto(dataUrl) {
    const m = String(dataUrl || "").match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
    if (!m) return null;
    const buf = Buffer.from(m[2], "base64");
    const ext = m[1] === "png" ? "png" : m[1] === "webp" ? "webp" : "jpg";
    const name = `${crypto.createHash("sha1").update(buf).digest("hex").slice(0, 20)}.${ext}`;
    const target = path.join(photoDir, name);
    if (!fs.existsSync(target)) fs.writeFileSync(target, buf);
    return `/fotos/${name}`;
  }
  // Si un producto llega con la foto adentro (versión vieja de la app o celular sin conexión), se pasa a archivo
  const withPhotoFile = (col, doc) => {
    if (col !== "products" || doc.deleted || !String(doc.image || "").startsWith("data:")) return doc;
    const url = savePhoto(doc.image);
    return url ? { ...doc, image: url } : doc;
  };

  // docs: { "orders/abc": { col, doc, rev } } ; rev crece con cada cambio recibido
  let db = { serverId: crypto.randomUUID(), rev: 0, docs: {} };
  // Primera vez: arranca con los datos ficticios de demo/tradex-demo.json (si están)
  const demoFile = new URL("./demo/tradex-demo.json", import.meta.url);
  if (fs.existsSync(file)) db = JSON.parse(fs.readFileSync(file, "utf8"));
  else if (process.env.TRADEX_DEMO !== "0" && fs.existsSync(demoFile)) { db = JSON.parse(fs.readFileSync(demoFile, "utf8")); save(); }
  else save();

  // ---------- clientes ----------
  // Cada pedido apunta a una ficha de cliente (clientId). Si llega un pedido sin ficha
  // (de una versión vieja de la app), la compu la busca por teléfono, DNI o nombre, o la crea.
  const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
  const phoneKey = (p) => String(p || "").replace(/\D/g, "").slice(-8);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function findClient(c) {
    const list = Object.values(db.docs).filter((e) => e.col === "clients" && !e.doc.deleted).map((e) => e.doc);
    const pk = phoneKey(c.phone);
    return (pk.length >= 6 && list.find((x) => phoneKey(x.phone) === pk))
      || (c.dni && list.find((x) => String(x.dni || "").replace(/\D/g, "") === String(c.dni).replace(/\D/g, "")))
      || list.find((x) => norm(x.name) === norm(c.name));
  }
  function putClient(doc) { db.docs[`clients/${doc.id}`] = { col: "clients", doc, rev: ++db.rev }; }
  function linkOrder(doc) {
    if (doc.deleted || doc.clientId || !doc.client?.name) return doc;
    const now = new Date().toISOString();
    let cl = findClient(doc.client);
    if (!cl) {
      cl = { id: newId(), name: doc.client.name.trim(), phone: doc.client.phone || "", address: doc.client.address || "", dni: doc.client.dni || "", createdAt: doc.createdAt || now, updatedAt: now };
      putClient(cl);
    } else {
      const patch = {};
      for (const k of ["phone", "address", "dni"]) if (!cl[k] && doc.client[k]) patch[k] = doc.client[k];
      if (Object.keys(patch).length) putClient({ ...cl, ...patch, updatedAt: now });
    }
    return { ...doc, clientId: cl.id, updatedAt: now };
  }
  (function migrate() {
    let n = 0;
    for (const e of Object.values(db.docs)) {
      if (e.col !== "orders" || e.doc.deleted || e.doc.clientId) continue;
      const linked = linkOrder(e.doc);
      if (linked !== e.doc) { db.docs[`orders/${linked.id}`] = { col: "orders", doc: linked, rev: ++db.rev }; n++; }
    }
    // "Ecovasos" pasó a llamarse "Vasos"
    let r = 0;
    for (const e of Object.values(db.docs)) {
      if (e.doc.deleted) continue;
      if (e.col === "products" && e.doc.category === "Ecovasos") { e.doc = { ...e.doc, category: "Vasos", updatedAt: new Date().toISOString() }; e.rev = ++db.rev; r++; }
      if (e.col === "orders" && (e.doc.items || []).some((i) => i.category === "Ecovasos")) {
        e.doc = { ...e.doc, items: e.doc.items.map((i) => (i.category === "Ecovasos" ? { ...i, category: "Vasos" } : i)), updatedAt: new Date().toISOString() }; e.rev = ++db.rev; r++;
      }
    }
    // fotos guardadas adentro de los productos -> archivos en data/fotos
    let f = 0;
    for (const e of Object.values(db.docs)) {
      const conv = withPhotoFile(e.col, e.doc);
      if (conv !== e.doc) { e.doc = { ...conv, updatedAt: new Date().toISOString() }; e.rev = ++db.rev; f++; }
    }
    if (f) console.log(`  🖼️ ${f} fotos pasaron a archivos en data/fotos`);
    if (n || r || f) { save(); if (n) console.log(`  👥 ${n} pedidos vinculados a su ficha de cliente`); if (r) console.log(`  🏷️ ${r} registros pasaron de "Ecovasos" a "Vasos"`); }
  })();

  function save() {
    // escritura atómica: si se corta la luz a mitad, el archivo anterior queda intacto
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file);
  }

  // Recibe cambios de un dispositivo y devuelve todo lo nuevo desde "since".
  // Si dos dispositivos editan lo mismo, gana la edición más reciente.
  function sync({ since = 0, changes = [] }) {
    let touched = 0;
    for (const { col, doc: incoming } of changes) {
      if (!COLLECTIONS.includes(col) || !incoming?.id) continue;
      const doc = col === "orders" ? linkOrder(incoming) : withPhotoFile(col, incoming);
      const key = `${col}/${doc.id}`;
      const cur = db.docs[key];
      if (!cur || (doc.updatedAt || "") >= (cur.doc.updatedAt || "")) {
        db.docs[key] = { col, doc, rev: ++db.rev };
        touched++;
      }
    }
    if (touched) save();
    const out = Object.values(db.docs).filter((e) => e.rev > since).map(({ col, doc }) => ({ col, doc }));
    return { serverId: db.serverId, rev: db.rev, changes: out };
  }

  function dump() {
    const out = { app: "TRADEX", exportedAt: new Date().toISOString() };
    for (const c of COLLECTIONS) out[c] = [];
    for (const { col, doc } of Object.values(db.docs)) if (!doc.deleted) out[col].push(doc);
    return out;
  }

  const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function backup({ force = false } = {}) {
    const name = `tradex-${localDay()}.json`;
    const target = path.join(backupDir, name);
    const hasData = Object.values(db.docs).some((e) => !e.doc.deleted && e.col !== "notifications");
    if (!hasData || (!force && fs.existsSync(target))) return null;
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(dump()));
    fs.renameSync(`${target}.tmp`, target);
    backupPhotos();
    prune();
    return name;
  }

  // Las fotos se copian una sola vez a la carpeta de copias (las que ya están no se vuelven a copiar)
  function backupPhotos() {
    const dest = path.join(backupDir, "fotos");
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(photoDir)) if (!fs.existsSync(path.join(dest, f))) fs.copyFileSync(path.join(photoDir, f), path.join(dest, f));
  }

  function listBackups() {
    return fs.readdirSync(backupDir)
      .filter((f) => /^tradex-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort().reverse()
      .map((name) => ({ name, date: name.slice(8, 18), size: fs.statSync(path.join(backupDir, name)).size }));
  }

  // Borra copias diarias viejas, pero conserva siempre la primera de cada mes
  function prune() {
    const limit = localDay(new Date(Date.now() - KEEP_DAILY_DAYS * 86400000));
    const firstOfMonth = new Set();
    const seen = new Set();
    for (const b of [...listBackups()].reverse()) {
      const m = b.date.slice(0, 7);
      if (!seen.has(m)) { seen.add(m); firstOfMonth.add(b.name); }
    }
    for (const b of listBackups()) if (b.date < limit && !firstOfMonth.has(b.name)) fs.unlinkSync(path.join(backupDir, b.name));
  }

  const backupPath = (name) => (/^tradex-\d{4}-\d{2}-\d{2}\.json$/.test(name) ? path.join(backupDir, name) : null);
  const stats = () => ({ docs: Object.values(db.docs).filter((e) => !e.doc.deleted).length, rev: db.rev });

  return { sync, backup, listBackups, backupPath, stats, file, backupDir, savePhoto, photoDir };
}
