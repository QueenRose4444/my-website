// util.js - small shared helpers (DOM + data). No app state here.

/** Create a DOM element: el("div", { class: "x", onclick: fn }, child1, "text", ...) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (key === "class") {
      node.className = value;
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (key === "style" && typeof value === "object") {
      Object.assign(node.style, value);
    } else if (key === "checked" || key === "disabled" || key === "selected" || key === "readOnly") {
      node[key] = !!value;
    } else if (key === "value") {
      node.value = value;
    } else {
      node.setAttribute(key, value === true ? "" : value);
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

let uidCounter = 0;
/** Unique-enough id for templates/entries/modules/fields. */
export function uid(prefix = "id") {
  uidCounter = (uidCounter + 1) % 1000;
  return `${prefix}_${Date.now().toString(36)}${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Get a value from an object by dot path ("files.0.buildId"). Returns undefined on any miss. */
export function getPath(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const part of String(path).split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Set a value on an object by dot path, creating intermediate objects/arrays as needed. */
export function setPath(obj, path, value) {
  const parts = String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur[part] === null || cur[part] === undefined || typeof cur[part] !== "object") {
      cur[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

export function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Escape a string for literal use inside a RegExp. */
export function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Derive a camelCase key from a human label: "Game Title" -> "gameTitle". */
export function keyFromLabel(label) {
  const words = String(label)
    .replace(/[^\w\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join("")
    .replace(/^\d+/, "");
}

/** Download text content as a file. */
export function downloadFile(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Copy text to clipboard with a fallback for non-secure contexts. */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Show a toast message. actions: [{label, primary, onClick}] */
export function toast(message, { actions = [], timeout = 6000 } = {}) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const node = el("div", { class: "toast" }, el("div", {}, message));
  if (actions.length) {
    node.append(
      el(
        "div",
        { class: "toast-actions" },
        actions.map((a) =>
          el(
            "button",
            {
              class: a.primary ? "primary" : "",
              onclick: () => {
                a.onClick?.();
                node.remove();
              },
            },
            a.label,
          ),
        ),
      ),
    );
  }
  container.appendChild(node);
  if (timeout) setTimeout(() => node.remove(), timeout);
}
