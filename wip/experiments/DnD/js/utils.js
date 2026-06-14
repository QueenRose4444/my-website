window.DnD = window.DnD || {};

DnD.$ = (sel, root = document) => root.querySelector(sel);
DnD.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

DnD.escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

DnD.toast = (msg, kind = '') => {
  const el = DnD.$('#toast');
  if (!el) { console.log('[toast]', msg); return; }
  el.textContent = msg;
  el.className = 'toast';
  if (kind) el.classList.add(kind);
  el.classList.remove('hidden');
  clearTimeout(DnD._toastTimer);
  DnD._toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
};

DnD.fmtTime = (ts) => {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

DnD.ability = {
  mod: (score) => Math.floor((Number(score || 10) - 10) / 2),
  fmt: (score) => {
    const m = DnD.ability.mod(score);
    return (m >= 0 ? '+' : '') + m;
  }
};

DnD.proficiencyBonus = (level) => {
  const l = Math.max(1, Math.min(20, Number(level) || 1));
  return Math.ceil(l / 4) + 1; // 5e table: 1-4:+2, 5-8:+3, 9-12:+4, 13-16:+5, 17-20:+6
};

DnD.openModal = (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  el.querySelectorAll('[data-close]').forEach(b => {
    b.onclick = () => el.classList.add('hidden');
  });
  el.addEventListener('click', (e) => {
    if (e.target === el) el.classList.add('hidden');
  }, { once: true });
};
DnD.closeModal = (id) => document.getElementById(id)?.classList.add('hidden');

DnD.debounce = (fn, ms = 400) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

DnD.getQuery = (key) => new URLSearchParams(location.search).get(key);

DnD.download = (name, content, type = 'application/json') => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
};
