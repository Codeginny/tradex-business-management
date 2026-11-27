// Campos de dinero: "$" adelante, puntos de miles mientras escribís y ",00" al final.
// El resto del código sigue leyendo el número limpio (input.value devuelve "45000"),
// así que no hace falta tocar cada formulario: se aplica solo a los campos de plata.
const MONEY_NAMES = new Set(["total", "deposit", "extraCost", "unitPrice", "unitCost", "price", "packPrice", "shipping", "altPrice", "shippingCost", "matrixCost", "shipSmall", "shipBig", "markupThreshold", "clientShipping"]);
const MONEY_IDS = new Set(["k-cost", "cu-m", "cq-amount"]);
const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

const fmtInt = (digits) => (digits ? Number(digits).toLocaleString("es-AR") : "");
function toDisplay(v) {
  if (v === "" || v == null || isNaN(Number(v))) return "";
  const n = Number(v);
  const int = Math.trunc(n);
  const cents = Math.round(Math.abs(n - int) * 100);
  return int.toLocaleString("es-AR") + (cents ? `,${String(cents).padStart(2, "0")}` : "");
}
const fromDisplay = (t) => (t ? String(t).replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "") : "");

const isMoney = (el) => el instanceof HTMLInputElement && !el.dataset.moneyOn && el.type !== "hidden" && (MONEY_NAMES.has(el.name) || MONEY_IDS.has(el.id) || el.dataset.money === "1");

function enhance(input) {
  const initial = native.get.call(input);
  input.dataset.moneyOn = "1";
  input.dataset.money = "1";
  input.type = "text";
  input.inputMode = "numeric";
  input.autocomplete = "off";
  const ownPrefix = input.closest(".money-input"); // el campo grande de Cuotas ya tiene su "$"
  let suffix = null;
  if (!ownPrefix) {
    const wrap = document.createElement("span");
    wrap.className = "money-wrap";
    input.before(wrap);
    wrap.innerHTML = `<span class="m-pre">$</span>`;
    wrap.append(input);
    suffix = document.createElement("span");
    suffix.className = "m-suf";
    suffix.textContent = ",00";
    wrap.append(suffix);
  }
  const syncSuffix = () => { if (suffix) suffix.style.visibility = native.get.call(input).includes(",") || !native.get.call(input) ? "hidden" : "visible"; };
  Object.defineProperty(input, "value", {
    configurable: true,
    get() { return fromDisplay(native.get.call(this)); },
    set(v) { native.set.call(this, toDisplay(v)); syncSuffix(); },
  });
  input.value = initial;
  // mientras escribís: solo números, con puntos de miles; el cursor queda donde estaba
  input.addEventListener("input", () => {
    const raw = native.get.call(input);
    const pos = input.selectionStart ?? raw.length;
    const intPart = raw.split(",")[0];
    const digitsBefore = raw.slice(0, Math.min(pos, intPart.length)).replace(/\D/g, "").length;
    const digits = intPart.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    const out = fmtInt(digits);
    native.set.call(input, out);
    let seen = 0, caret = 0;
    while (caret < out.length && seen < digitsBefore) { if (/\d/.test(out[caret])) seen++; caret++; }
    try { input.setSelectionRange(caret, caret); } catch {}
    syncSuffix();
  });
}

function scan(root) {
  if (isMoney(root)) enhance(root);
  root.querySelectorAll?.("input").forEach((el) => isMoney(el) && enhance(el));
}

export function initMoneyInputs() {
  scan(document.body);
  new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && scan(n)))).observe(document.body, { childList: true, subtree: true });
}
