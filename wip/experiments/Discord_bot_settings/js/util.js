/* ============================================================
 * util.js — DOM helpers, toast, time, markdown, placeholders
 * ============================================================ */

function $(id) { return document.getElementById(id); }

// Insert text at the current cursor position in an <input>/<textarea>,
// preserving focus and moving the cursor to after the inserted text. Fires
// an `input` event so listeners (e.g. preview renderers) re-run.
function insertAtCursor(el, text) {
  if (!el) return;
  el.focus();
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  el.value = before + text + after;
  const pos = start + text.length;
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function escapeAttr(s) { return escapeHtml(s); }

/* role int color → hex */
function roleColor(intColor) {
  if (!intColor) return "var(--text-dim)";
  return "#" + Number(intColor).toString(16).padStart(6, "0");
}

/* ---------------- toast ---------------- */
const TOAST_ICON = { ok: "fa-circle-check", error: "fa-circle-exclamation", neutral: "fa-circle-info" };
function toast(msg, kind = "neutral") {
  if (kind === "") kind = "neutral";
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.innerHTML = `<i class="fas ${TOAST_ICON[kind] || TOAST_ICON.neutral}"></i><span>${escapeHtml(msg)}</span>`;
  els.toastHost.appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity 220ms, transform 220ms";
    t.style.opacity = "0";
    t.style.transform = "translateX(20px)";
    setTimeout(() => t.remove(), 240);
  }, 3500);
}

/* ---------------- time ---------------- */
function fmtDateTime(iso, opts) {
  try { return new Date(iso).toLocaleString(undefined, opts || { dateStyle: "medium", timeStyle: "short" }); }
  catch { return String(iso); }
}

/* relative time, e.g. "in 3 days" / "2 hours ago" */
function fmtRelative(iso) {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const units = [
    ["year", 31536e6], ["month", 2592e6], ["day", 864e5],
    ["hour", 36e5], ["minute", 6e4],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "minute") {
      return rtf.format(Math.round(diff / ms), unit);
    }
  }
  return "now";
}

/* datetime-local value (local clock) from a Date */
function toDatetimeLocalValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localTimezone() { return Intl.DateTimeFormat().resolvedOptions().timeZone; }

/* ---------------- reminder minutes ---------------- */
function humaniseMinutes(n) {
  if (n >= 1440 && n % 1440 === 0) return `${n / 1440}d`;
  if (n >= 60 && n % 60 === 0) return `${n / 60}h`;
  return `${n}m`;
}
function parseHumanMinutes(raw) {
  const s = String(raw).trim().toLowerCase();
  if (!s) return NaN;
  if (/^\d+$/.test(s)) return Number(s);
  const re = /(\d+)\s*([dhm])/g;
  let total = 0, m, any = false;
  while ((m = re.exec(s)) !== null) {
    any = true;
    const v = Number(m[1]);
    total += m[2] === "d" ? v * 1440 : m[2] === "h" ? v * 60 : v;
  }
  return any ? total : NaN;
}

/* ---------------- markdown (Discord subset) ----------------
 * Mentions are looked up against window.DC_LOOKUPS which the embeds editor
 * populates on tab load:
 *   { channels: [{id, name, type}], roles: [{id, name, color}],
 *     emojis: [{id, name, animated}] }
 * Unknown mentions stay raw (matches Discord's own fallback).
 * ---------------------------------------------------------- */
function renderInlineMarkdown(text) {
  if (text == null) return "";
  let out = escapeHtml(String(text));

  // Multi-line code block first (``` … ```), so its content isn't interpreted.
  out = out.replace(/```([\s\S]+?)```/g, (_m, body) =>
    `<pre class="dc-codeblock"><code>${body}</code></pre>`);

  // Headings at start of line.
  out = out.replace(/(^|\n)### ([^\n]+)/g, '$1<div class="dc-h3">$2</div>');
  out = out.replace(/(^|\n)## ([^\n]+)/g, '$1<div class="dc-h2">$2</div>');
  out = out.replace(/(^|\n)# ([^\n]+)/g, '$1<div class="dc-h1">$2</div>');

  // Custom emoji <:name:id> and <a:name:id>.
  out = out.replace(/&lt;(a)?:([\w-]+):(\d+)&gt;/g, (_m, anim, name, id) =>
    `<img class="dc-emoji" src="https://cdn.discordapp.com/emojis/${id}.${anim ? "gif" : "webp"}?size=44" alt=":${name}:" title=":${name}:">`);

  // Channel mentions <#id>.
  out = out.replace(/&lt;#(\d+)&gt;/g, (_m, id) => {
    const ch = (window.DC_LOOKUPS && window.DC_LOOKUPS.channelsById[id]) || null;
    const name = ch ? `#${ch.name}` : `#unknown-channel`;
    return `<span class="dc-mention dc-mention-channel">${escapeHtml(name)}</span>`;
  });

  // Role mentions <@&id>.
  out = out.replace(/&lt;@&amp;(\d+)&gt;/g, (_m, id) => {
    const r = (window.DC_LOOKUPS && window.DC_LOOKUPS.rolesById[id]) || null;
    const name = r ? `@${r.name}` : `@unknown-role`;
    const colorHex = r && r.color ? "#" + r.color.toString(16).padStart(6, "0") : null;
    const style = colorHex
      ? `background:${colorHex}1f;color:${colorHex};` : "";
    return `<span class="dc-mention dc-mention-role" style="${style}">${escapeHtml(name)}</span>`;
  });

  // User mentions <@id>.
  out = out.replace(/&lt;@!?(\d+)&gt;/g, (_m, id) =>
    `<span class="dc-mention dc-mention-user">@user</span>`);

  // @everyone / @here.
  out = out.replace(/@(everyone|here)/g, '<span class="dc-mention dc-mention-everyone">@$1</span>');

  // Links [text](url).
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Underline __x__ (before italic to avoid clobbering).
  out = out.replace(/__([^_\n]+)__/g, '<u>$1</u>');
  // Bold **x**.
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Italic *x* or _x_.
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  // Strikethrough ~~x~~.
  out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  // Spoiler ||x||.
  out = out.replace(/\|\|([^|]+)\|\|/g,
    '<span class="dc-spoiler">$1</span>');
  // Inline code `x`.
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Block quotes "> ".
  out = out.replace(/(^|\n)&gt; ?(.*)/g, '$1<span class="dc-quote">$2</span>');
  return out;
}

/* ---------------- placeholder substitution ---------------- */
function substitutePlaceholders(text, ctx) {
  if (text == null) return text;
  return String(text).replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(ctx, k) ? String(ctx[k]) : m);
}

/* avatar url for a discord user */
function userAvatarUrl(u) {
  if (!u) return "";
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.user_id}/${u.avatar}.png?size=64`;
  const idx = (Number(BigInt(u.user_id) >> 22n) % 6);
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}


/* ============================================================
 * v2 design helpers (added for the Arma Management tab).
 * Lifted from designdocs/v2/output v1/js/util.js.
 * ============================================================ */

// Build a DOM node. `attrs` supports class/html/text/dataset/on<event>.
// `children` can be a string, a node, or an array of either.
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

// Duration between two ISO times → "2h 14m" / "47m" / "just now"
function fmtDuration(fromIso, toIso) {
  const a = new Date(fromIso).getTime();
  const b = toIso ? new Date(toIso).getTime() : Date.now();
  let s = Math.max(0, Math.round((b - a) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600);  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return "just now";
}

// Build a <dialog class="drawer"> with header/body/footer and open it.
// opts: { title, icon, body:[...], footer:[...], narrow:bool, onClose }
// Closes + removes on backdrop/Esc/close-x.
function openDialog({ title, icon, body, footer, narrow = false, wide = false, onClose } = {}) {
  const dlg = document.createElement("dialog");
  dlg.className = "drawer" + (narrow ? " narrow" : "") + (wide ? " wide" : "");

  const closeBtn = el("button", { class: "btn btn-ghost icon-btn", title: "Close", "aria-label": "Close",
    onclick: () => dlg.close() }, [el("i", { class: "fas fa-xmark" })]);

  const header = el("div", { class: "drawer-header" }, [
    el("h3", {}, [icon ? el("i", { class: `fas ${icon}`, style: "color:var(--accent);margin-right:.55rem;font-size:.85em" }) : null, title]),
    closeBtn,
  ]);
  const bodyWrap = el("div", { class: "drawer-body" }, [].concat(body || []));
  const inner = el("div", { class: "drawer-inner" }, [header, bodyWrap]);
  if (footer) inner.appendChild(el("div", { class: "drawer-footer" }, [].concat(footer)));

  dlg.appendChild(inner);
  document.body.appendChild(dlg);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { if (onClose) onClose(); dlg.remove(); });
  dlg.showModal();
  return dlg;
}

function selectWrap(select) {
  return el("div", { class: "select-wrap" }, [select, el("i", { class: "fas fa-chevron-down select-caret" })]);
}
function makeSelect(id, options, value) {
  const s = el("select", { class: "picker", id });
  for (const o of options) {
    const opt = el("option", { value: o.value }, [o.label]);
    if (String(o.value) === String(value)) opt.selected = true;
    s.appendChild(opt);
  }
  return s;
}
