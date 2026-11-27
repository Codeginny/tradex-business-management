// TRADEX 1.0 — servidor local
// Sirve la app (carpeta public/) y expone el asistente con IA en /api/*.
// La app funciona sin IA (modo local); con ANTHROPIC_API_KEY en .env se activa el asistente inteligente.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import { createStore } from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");

// --- .env mínimo (sin dependencias) ---
const envFile = path.join(here, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = Number(process.env.PORT || 5190);
const MODEL = process.env.TRADEX_MODEL || "claude-opus-5-5";
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = hasKey ? new Anthropic() : null;
const PIN = (process.env.TRADEX_PIN || "").trim();

// Datos centrales y copias diarias (las carpetas se pueden cambiar en .env, por ejemplo a una carpeta de Google Drive)
const store = createStore({
  dataDir: path.resolve(here, process.env.DATA_DIR || "data"),
  backupDir: path.resolve(here, process.env.BACKUP_DIR || path.join(process.env.DATA_DIR || "data", "backups")),
});
const runBackup = () => { try { const n = store.backup(); if (n) console.log(`  💾 Copia de seguridad: ${n}`); } catch (e) { console.error("Copia de seguridad falló:", e.message); } };
runBackup();
setInterval(runBackup, 60 * 60 * 1000); // revisa cada hora; hace una copia por día

const lanUrls = () => Object.values(os.networkInterfaces()).flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => `http://${i.address}:${PORT}`);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

// Llamada base: Opus 5.5 con fallback del servidor ante rechazos de seguridad.
async function ask({ system, messages, tools, format, effort = "low", maxTokens = 16000 }) {
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
    output_config: { effort, ...(format ? { format: { type: "json_schema", schema: format } } : {}) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    ...(tools ? { tools } : {}),
  };
  let res = await client.beta.messages.create(params);
  // Las búsquedas web largas pueden pausar el turno: lo retomamos.
  let guard = 0;
  while (res.stop_reason === "pause_turn" && guard++ < 4) {
    params.messages = [...params.messages, { role: "assistant", content: res.content }];
    res = await client.beta.messages.create(params);
  }
  if (res.stop_reason === "refusal") throw new Error("La IA no pudo responder esa consulta.");
  return res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

// ---------- Asistente conversacional ----------
const itemSchema = {
  type: "object", additionalProperties: false,
  required: ["product", "qty", "unitPrice"],
  properties: { product: { type: "string" }, qty: { type: "number" }, unitPrice: { type: "number" } },
};
const assistantSchema = {
  type: "object", additionalProperties: false,
  required: ["reply", "intent", "ready", "order", "supplierPrice", "query", "agenda"],
  properties: {
    reply: { type: "string" },
    intent: { type: "string", enum: ["order", "supplier_price", "query", "agenda", "none"] },
    ready: { type: "boolean" },
    order: {
      type: "object", additionalProperties: false,
      required: ["clientName", "phone", "address", "dni", "items", "total", "deposit", "eventDate", "deadline", "channel", "shipping", "courier", "notes"],
      properties: {
        clientName: { type: "string" }, phone: { type: "string" }, address: { type: "string" }, dni: { type: "string" },
        items: { type: "array", items: itemSchema },
        total: { type: "number" }, deposit: { type: "number" },
        eventDate: { type: "string" }, deadline: { type: "string" },
        channel: { type: "string" }, shipping: { type: "string" }, courier: { type: "string" }, notes: { type: "string" },
      },
    },
    supplierPrice: {
      type: "object", additionalProperties: false,
      required: ["supplierName", "product", "category", "price", "packQty", "minQty", "shippingCost", "province", "phone", "social"],
      properties: {
        supplierName: { type: "string" }, product: { type: "string" }, category: { type: "string" },
        price: { type: "number" }, packQty: { type: "number" }, minQty: { type: "number" }, shippingCost: { type: "number" },
        province: { type: "string" }, phone: { type: "string" }, social: { type: "string" },
      },
    },
    query: {
      type: "object", additionalProperties: false, required: ["search", "limit", "sort"],
      properties: { search: { type: "string" }, limit: { type: "number" }, sort: { type: "string", enum: ["cheapest", "expensive", "recent"] } },
    },
    agenda: {
      type: "object", additionalProperties: false, required: ["title", "date", "type"],
      properties: { title: { type: "string" }, date: { type: "string" }, type: { type: "string" } },
    },
  },
};

const ASSISTANT_SYSTEM = `Sos "Dex", la asistente de TRADEX, un emprendimiento argentino de regalos personalizados y souvenirs para eventos (bodas, comuniones, egresos). Hablás en español rioplatense, cálida y breve (las respuestas se leen en voz alta: máximo 2 oraciones, sin emojis ni markdown).

Tu trabajo es completar fichas a partir de lo que te dicta la dueña:
- intent "order": un cliente compró algo. Campos: clientName, phone, address, dni, items (product, qty, unitPrice), total, deposit (seña), eventDate, deadline (fecha de entrega), channel (Instagram | WhatsApp | Recomendación | Otro), shipping (Correo | Retiro en local | Moto/Uber), courier (Andreani | Flecha Bus Cargas | Via Cargo | Correo Argentino | ""), notes.
- intent "supplier_price": guardar un precio de proveedor. Campos: supplierName, product, category (Tazas, Vasos, Botellas, Velas, Skincare, Mochilas, Difusor, Centro de mesa, Llaveros; si no encaja en ninguna, vacío), price (el precio tal como lo dice), packQty (si el precio es por varias unidades, ej. "45000 las 30", packQty=30; si es por unidad, 1), minQty, shippingCost (si no lo dice, 0; si dice que no tiene envío o que es de su misma provincia, -1), province, phone, social.
- intent "query": pregunta sobre productos/precios (ej. "las 3 botellas más baratas"): completá search (palabra clave en singular), limit y sort. El sistema mostrará los resultados; en reply decí algo corto como "Te busco las opciones".
- intent "agenda": anotar una tarea/recordatorio: title, date (YYYY-MM-DD), type (cliente | proveedor | trabajo | otro).

Reglas:
- Siempre devolvé la ficha COMPLETA acumulada (lo ya conocido del borrador + lo nuevo). Lo que no se sepa va como "" o 0.
- Fechas en formato YYYY-MM-DD. Hoy es {{TODAY}}. Interpretá "el sábado 20", "para fin de mes", etc.
- Si el total no se dice pero hay items con precio, calculá total = suma qty*unitPrice.
- Preguntá UNO o DOS datos faltantes por vez, empezando por los importantes: (pedido) cliente, producto/cantidad, total, seña, fecha del evento, fecha de entrega, teléfono, canal, envío. (proveedor) nombre del proveedor, producto, precio, mínimo de compra, provincia.
- Si la dueña dice "no sé", "después", "saltear" o "no tiene", dejalo vacío y seguí.
- Para proveedores: si falta teléfono o redes, avisá que lo vas a buscar en internet al guardar.
- Cuando estén los datos importantes, resumí en una oración y preguntá si guardás. Si confirma ("sí", "dale", "guardalo"), poné ready=true.
- Si no se entiende la intención, intent "none" y preguntá qué quiere hacer.`;

async function handleAssistant(body) {
  const { messages = [], draft = null, intent = "none", context = {} } = body;
  const today = context.today || new Date().toISOString().slice(0, 10);
  const system = ASSISTANT_SYSTEM.replace("{{TODAY}}", today);
  const state = `Estado actual (no lo repitas al usuario):\nintent=${intent}\nborrador=${JSON.stringify(draft)}\nclientes conocidos=${(context.clients || []).slice(0, 60).join(", ")}\nproveedores conocidos=${(context.suppliers || []).slice(0, 60).join(", ")}`;
  // La conversación debe empezar con la dueña y alternar turnos: se unen mensajes seguidos del mismo rol.
  const convo = [];
  for (const m of messages.slice(-20)) {
    if (!convo.length && m.role !== "user") continue;
    const last = convo[convo.length - 1];
    if (last && last.role === m.role) last.content += `\n${m.content}`;
    else convo.push({ role: m.role, content: m.content });
  }
  // El estado viaja junto al último mensaje de la dueña.
  const lastMsg = convo[convo.length - 1];
  if (lastMsg && lastMsg.role === "user") lastMsg.content = `[${state}]\n\n${lastMsg.content}`;
  const text = await ask({ system, messages: convo, format: assistantSchema, effort: "low" });
  return parseJson(text);
}

// ---------- Búsqueda de datos de proveedores en internet ----------
async function handleLookup({ name, product = "", province = "" }) {
  const text = await ask({
    system: "Buscás datos de contacto PÚBLICOS de comercios y proveedores mayoristas de Argentina. Nunca inventes datos: si no lo encontrás, dejalo vacío. Respondé SOLO con un objeto JSON.",
    messages: [{
      role: "user",
      content: `Buscá en internet al proveedor "${name}"${product ? ` (vende ${product})` : ""}${province ? ` en ${province}` : ""}, Argentina. Devolvé JSON con: {"phone":"","address":"","province":"","instagram":"","facebook":"","website":"","whatsapp":"","source":"url donde lo encontraste"}`,
    }],
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4, user_location: { type: "approximate", country: "AR" } }],
    effort: "low",
  });
  return parseJson(text) || {};
}

// ---------- Catálogo PDF -> productos ----------
const catalogSchema = {
  type: "object", additionalProperties: false, required: ["products"],
  properties: {
    products: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["name", "price", "minQty", "category"],
        properties: { name: { type: "string" }, price: { type: "number" }, minQty: { type: "number" }, category: { type: "string" } },
      },
    },
  },
};
async function handleCatalog({ pdfBase64, supplierName = "" }) {
  const text = await ask({
    system: "Extraés listas de precios de proveedores. Precios en pesos argentinos como número (sin $ ni puntos de miles). Si hay precio por cantidad, usá el unitario del mínimo de compra. Categorías: Tazas, Vasos, Botellas, Velas, Skincare, Mochilas, Difusor, Centro de mesa, Llaveros (si no encaja en ninguna, dejala vacía).",
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
        { type: "text", text: `Lista de precios del proveedor ${supplierName}. Extraé todos los artículos.` },
      ],
    }],
    format: catalogSchema,
    effort: "low",
    maxTokens: 32000,
  });
  return parseJson(text) || { products: [] };
}

// ---------- HTTP ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 40e6) reject(new Error("Archivo demasiado grande")); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}
function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

const routes = { "/api/assistant": handleAssistant, "/api/lookup": handleLookup, "/api/catalog": handleCatalog };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/status") return send(res, 200, { ai: hasKey, model: MODEL, sync: true, pin: Boolean(PIN), urls: lanUrls(), backupDir: store.backupDir });
  // Con TRADEX_PIN en .env, nadie más en el Wi-Fi puede leer tus datos ni usar la IA.
  if (url.pathname.startsWith("/api/") && PIN && (req.headers["x-tradex-pin"] || url.searchParams.get("pin")) !== PIN) return send(res, 401, { error: "PIN incorrecto" });
  try {
    if (url.pathname === "/api/sync" && req.method === "POST") { const out = store.sync(await readBody(req)); runBackup(); return send(res, 200, out); }
    if (url.pathname === "/api/photo" && req.method === "POST") {
      const photo = store.savePhoto((await readBody(req)).dataUrl);
      return photo ? send(res, 200, { url: photo }) : send(res, 400, { error: "Foto inválida" });
    }
    if (url.pathname === "/api/backups") return send(res, 200, { backups: store.listBackups(), dir: store.backupDir, ...store.stats() });
    if (url.pathname === "/api/backup-now" && req.method === "POST") return send(res, 200, { name: store.backup({ force: true }) });
    if (url.pathname === "/api/backup-file") {
      const f = store.backupPath(url.searchParams.get("name") || "");
      if (!f || !fs.existsSync(f)) return send(res, 404, { error: "No existe esa copia" });
      res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${path.basename(f)}"` });
      return fs.createReadStream(f).pipe(res);
    }
  } catch (e) {
    console.error(url.pathname, e.message);
    return send(res, 500, { error: e.message });
  }
  if (routes[url.pathname] && req.method === "POST") {
    if (!client) return send(res, 503, { error: "IA no configurada: agregá ANTHROPIC_API_KEY en el archivo .env" });
    try {
      return send(res, 200, await routes[url.pathname](await readBody(req)));
    } catch (e) {
      console.error(url.pathname, e.message);
      return send(res, 500, { error: e.message });
    }
  }
  // Fotos de productos (nombres imposibles de adivinar; se pueden guardar en caché para siempre)
  if (url.pathname.startsWith("/fotos/")) {
    const name = path.basename(url.pathname);
    const f = path.join(store.photoDir, name);
    if (!/^[a-f0-9]{20}\.(jpg|png|webp)$/.test(name) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": name.endsWith("png") ? "image/png" : name.endsWith("webp") ? "image/webp" : "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" });
    return fs.createReadStream(f).pipe(res);
  }
  // Archivos estáticos
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) file = path.join(PUBLIC, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`\n  ✨ TRADEX 1.0 corriendo en http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  📱 Desde el celular (mismo Wi-Fi): ${u}`);
  console.log(`  💾 Datos en ${store.file}`);
  if (!PIN) console.log("  🔓 Sin TRADEX_PIN: cualquiera en tu Wi-Fi podría ver los datos. Configurá uno en .env");
  console.log(hasKey ? `  🤖 Asistente IA activo (${MODEL})\n` : "  ℹ️  Sin ANTHROPIC_API_KEY: el asistente funciona en modo local (sin búsqueda en internet)\n");
});
