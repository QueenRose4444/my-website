window.DnD = window.DnD || {};

DnD.map = (() => {
  const surface = document.getElementById('mapSurface');
  if (!surface) return null;
  const tokens = new Map(); // tokenId -> element

  // Build: surface > stage > (img, tokens...). The stage is sized to the image's
  // actual display dimensions so token positions (0..1) always map 1:1 to image
  // coords regardless of browser width or surface aspect ratio.
  const stage = document.createElement('div');
  stage.className = 'map-stage';
  stage.hidden = true;
  const imgEl = document.createElement('img');
  imgEl.className = 'map-img';
  imgEl.alt = '';
  imgEl.draggable = false;
  stage.appendChild(imgEl);
  surface.appendChild(stage);

  let naturalW = 0;
  let naturalH = 0;

  function fitStage() {
    if (!naturalW || !naturalH) return;
    const r = surface.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const aspect = naturalW / naturalH;
    let w, h;
    if (r.width / r.height > aspect) {
      h = r.height; w = h * aspect;
    } else {
      w = r.width; h = w / aspect;
    }
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
  }

  imgEl.addEventListener('load', () => {
    naturalW = imgEl.naturalWidth;
    naturalH = imgEl.naturalHeight;
    fitStage();
  });

  const ro = new ResizeObserver(fitStage);
  ro.observe(surface);

  function ensureEmpty(show) {
    let empty = surface.querySelector('.map-empty');
    if (show) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'map-empty';
        empty.textContent = 'No map set.';
        surface.appendChild(empty);
      }
    } else if (empty) {
      empty.remove();
    }
  }

  function baseUrl(path) {
    if (!path) return null;
    if (path.startsWith('http')) return path;
    return DnD.api.uploads.url(path);
  }

  function setImage(path) {
    const url = baseUrl(path);
    if (url) {
      // Append cache-buster only if the path itself didn't change — forces
      // a refetch when the server emits the same path twice (rare but cheap).
      imgEl.src = url;
      stage.hidden = false;
      ensureEmpty(false);
    } else {
      imgEl.removeAttribute('src');
      stage.hidden = true;
      naturalW = 0; naturalH = 0;
      stage.style.width = '';
      stage.style.height = '';
      ensureEmpty(true);
    }
  }

  function clearTokens() {
    for (const el of tokens.values()) el.remove();
    tokens.clear();
  }

  function renderToken(tok) {
    let el = tokens.get(tok.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'token';
      el.dataset.id = tok.id;
      el.title = tok.label || '';
      stage.appendChild(el);
      tokens.set(tok.id, el);

      let dragging = false;
      let startPointerId = null;
      el.addEventListener('pointerdown', (e) => {
        const isDm = DnD.session?.isDm();
        const canMove = isDm || tok.ownerUserId === window.authManager.currentUser?.userId;
        if (!canMove) { el.classList.add('locked'); return; }
        e.preventDefault();
        dragging = true;
        startPointerId = e.pointerId;
        el.setPointerCapture(e.pointerId);
        el.classList.add('dragging');
      });
      el.addEventListener('pointermove', (e) => {
        if (!dragging || e.pointerId !== startPointerId) return;
        const rect = stage.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        el.style.left = `${x * 100}%`;
        el.style.top  = `${y * 100}%`;
        tok.x = x; tok.y = y;
      });
      const end = (e) => {
        if (!dragging || e.pointerId !== startPointerId) return;
        dragging = false;
        el.classList.remove('dragging');
        DnD.session?.moveToken(tok.id, tok.x, tok.y);
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);

      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!DnD.session?.isDm()) return;
        if (confirm(`Remove token "${tok.label}"?`)) DnD.session.removeToken(tok.id);
      });
    }
    el.style.left = `${(tok.x || 0) * 100}%`;
    el.style.top  = `${(tok.y || 0) * 100}%`;
    el.style.width = `${32 * (tok.size || 1)}px`;
    el.style.height = `${32 * (tok.size || 1)}px`;
    if (tok.imagePath) {
      el.style.backgroundImage = `url('${baseUrl(tok.imagePath)}')`;
      el.textContent = '';
    } else {
      el.style.backgroundColor = tok.color || 'var(--accent)';
      el.textContent = (tok.label || '?').slice(0, 2).toUpperCase();
    }
  }

  function applyState(mapState) {
    // mapState: { imagePath, tokens, activeMapId? } from REST or `map:active-changed`.
    const s = mapState?.map || mapState || {};
    setImage(s.imagePath);
    clearTokens();
    (s.tokens || []).forEach(renderToken);
    updateAddTokenBtn(!!s.imagePath || !!s.activeMapId);
  }

  function applyActiveMap({ imagePath, tokens, mapId } = {}) {
    setImage(imagePath);
    clearTokens();
    (tokens || []).forEach(renderToken);
    updateAddTokenBtn(!!mapId);
  }

  function updateAddTokenBtn(hasActive) {
    const btn = document.getElementById('btnAddToken');
    if (btn) btn.disabled = !hasActive;
  }

  function moveTokenLocal(tokenId, x, y) {
    const el = tokens.get(tokenId);
    if (!el) return;
    el.style.left = `${x * 100}%`;
    el.style.top  = `${y * 100}%`;
  }

  function removeTokenLocal(tokenId) {
    const el = tokens.get(tokenId);
    if (el) { el.remove(); tokens.delete(tokenId); }
  }

  const btnAddToken = document.getElementById('btnAddToken');
  if (btnAddToken) btnAddToken.addEventListener('click', () => DnD.session?.openTokenModal());

  return { applyState, applyActiveMap, renderToken, setImage, moveTokenLocal, removeTokenLocal, clearTokens };
})();
