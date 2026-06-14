window.DnD = window.DnD || {};

// Renders the "My character" card in the session left pane. Editable fields
// autosave via character:update (broadcasts public fields to the room).
DnD.sheet = (() => {
  const host = document.getElementById('mySheet');
  if (!host) return null;
  let currentChar = null;

  // D&D 5e HP math: damage bites tempHp first, overflow drains hp, everything
  // clamps at 0; healing fills hp up to maxHp and leaves tempHp alone.
  function applyHpDelta(data, delta) {
    const maxHp = Math.max(0, Number(data.maxHp ?? 0) | 0);
    let hp      = Number(data.hp ?? 0) | 0;
    let tempHp  = Math.max(0, Number(data.tempHp ?? 0) | 0);
    if (delta < 0) {
      let remaining = -delta;
      const fromTemp = Math.min(tempHp, remaining);
      tempHp -= fromTemp;
      remaining -= fromTemp;
      hp = Math.max(0, hp - remaining);
    } else {
      hp = Math.min(maxHp || hp + delta, hp + delta);
    }
    return { hp, tempHp, maxHp };
  }

  function render(char) {
    currentChar = char;
    if (!char) {
      host.innerHTML = `<div class="empty small">No character bound. <a href="character.html" class="btn tiny ghost">Create one</a></div>`;
      return;
    }
    const d = char.data || {};
    host.innerHTML = `
      <div class="row gap">
        <div class="portrait-preview" style="${char.portraitPath ? `background-image:url('${DnD.api.uploads.url(char.portraitPath)}')` : ''}"></div>
        <div class="grow">
          <div style="font-weight:600">${DnD.escape(d.name || 'Unnamed')}</div>
          <div style="color:var(--ink-mute);font-size:0.85em">
            ${DnD.escape([d.race, d.class, d.level ? `Lv ${d.level}` : null].filter(Boolean).join(' · '))}
          </div>
        </div>
      </div>
      <div class="hp-widget">
        <label style="flex:1">HP
          <input type="number" data-sheet="hp" value="${Number(d.hp ?? 0)}" />
        </label>
        <label style="flex:1">Max
          <input type="number" data-sheet="maxHp" value="${Number(d.maxHp ?? 0)}" />
        </label>
        <label style="flex:1">Temp
          <input type="number" data-sheet="tempHp" value="${Number(d.tempHp ?? 0)}" />
        </label>
      </div>
      <div class="hp-delta">
        <input type="number" min="0" value="5" data-hp-delta="amount" title="amount" />
        <button class="btn tiny danger"  data-hp-delta="dmg">Damage</button>
        <button class="btn tiny"         data-hp-delta="heal">Heal</button>
        <button class="btn tiny ghost"   data-hp-delta="temp">Set temp</button>
      </div>
      <div class="stat-row">
        ${DnD.RULES_5E.abilities.map(a =>
          `<div class="stat-tile">
            <small>${a.id}</small>
            <div>${Number(d[a.id] ?? 10)} <span style="color:var(--ink-mute)">(${DnD.ability.fmt(d[a.id] ?? 10)})</span></div>
          </div>`
        ).join('')}
      </div>
      <label style="display:flex;gap:6px;align-items:center">AC
        <input type="number" data-sheet="ac" value="${Number(d.ac ?? 10)}" />
      </label>
    `;
    host.querySelectorAll('[data-sheet]').forEach(inp => {
      inp.addEventListener('change', () => {
        const patch = {};
        patch[inp.dataset.sheet] = Number(inp.value);
        DnD.session?.updateCharacter(patch);
      });
    });
    host.querySelectorAll('[data-hp-delta]').forEach(btn => {
      if (btn.tagName !== 'BUTTON') return;
      btn.addEventListener('click', () => {
        const amountInp = host.querySelector('[data-hp-delta="amount"]');
        const n = Math.max(0, Number(amountInp?.value) | 0);
        if (!n || !currentChar) return;
        const data = currentChar.data || {};
        if (btn.dataset.hpDelta === 'temp') {
          DnD.session?.updateCharacter({ tempHp: n });
          return;
        }
        const delta = btn.dataset.hpDelta === 'dmg' ? -n : n;
        const { hp, tempHp } = applyHpDelta(data, delta);
        DnD.session?.updateCharacter({ hp, tempHp });
      });
    });
  }

  function applyPublicUpdate(pub) {
    if (!currentChar || currentChar.id !== pub.characterId) return;
    Object.assign(currentChar.data, pub.data || {});
    render(currentChar);
  }

  return { render, applyPublicUpdate, applyHpDelta, get current() { return currentChar; } };
})();
