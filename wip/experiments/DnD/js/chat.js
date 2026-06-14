window.DnD = window.DnD || {};

DnD.chat = (() => {
  const log = document.getElementById('chatLog');
  const form = document.getElementById('chatForm');
  const target = document.getElementById('chatTarget');
  if (!log || !form) return null;

  let filter = 'all';
  document.querySelectorAll('.tabs.small .tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tabs.small .tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      filter = t.dataset.chatTab || 'all';
      Array.from(log.children).forEach(renderFilter);
    });
  });

  function renderFilter(el) {
    const kind = el.dataset.kind;
    if (filter === 'all') { el.style.display = ''; return; }
    if (filter === 'rolls') { el.style.display = kind === 'roll' ? '' : 'none'; return; }
    if (filter === 'whispers') { el.style.display = kind === 'whisper' ? '' : 'none'; return; }
    if (filter === 'dm') { el.style.display = kind === 'dm-note' ? '' : 'none'; return; }
  }

  function fmtKindTag(kind) {
    if (kind === 'roll') return 'roll';
    if (kind === 'whisper') return 'whisper';
    if (kind === 'dm-note') return 'dm note';
    return '';
  }

  function renderOne(msg) {
    const el = document.createElement('div');
    el.className = `chat-msg kind-${msg.kind}`;
    el.dataset.kind = msg.kind;
    const tag = fmtKindTag(msg.kind);
    let extra = '';
    if (msg.kind === 'whisper' && msg.targetUserId) {
      extra = ` → <em>${DnD.escape(DnD.session?.usernameFor(msg.targetUserId) || `#${msg.targetUserId}`)}</em>`;
    }
    let body = DnD.escape(msg.content);
    if (msg.kind === 'roll' && msg.payload) {
      body = (DnD.dice?.renderPayload(msg.payload)) || body;
    }
    el.innerHTML = `
      <div>
        ${tag ? `<span class="tag">${tag}</span>` : ''}
        <span class="who">${DnD.escape(msg.username)}</span>${extra}
        <span class="when">${DnD.fmtTime(msg.createdAt)}</span>
      </div>
      <div class="body">${body}</div>
    `;
    renderFilter(el);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const content = String(fd.get('content') || '').trim();
    if (!content) return;
    const targetId = target.value ? Number(target.value) : null;
    if (targetId) DnD.session?.whisper(targetId, content);
    else DnD.session?.chat(content);
    form.reset();
    target.value = '';
  });

  return {
    push: renderOne,
    clear: () => { log.innerHTML = ''; },
    setTargets(members) {
      const me = window.authManager.currentUser?.userId;
      target.innerHTML = '<option value="">Say (all)</option>';
      for (const m of members) {
        if (m.userId === me) continue;
        const opt = document.createElement('option');
        opt.value = String(m.userId);
        opt.textContent = `whisper @${m.username}${m.role === 'dm' ? ' (DM)' : ''}`;
        target.appendChild(opt);
      }
    }
  };
})();
