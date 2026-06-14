window.DnD = window.DnD || {};

DnD.dice = (() => {
  const form = document.getElementById('diceForm');
  if (!form) return null;

  const quick = form.querySelectorAll('.quick-dice button');
  quick.forEach(b => {
    b.addEventListener('click', () => {
      const input = form.querySelector('input[name=expression]');
      const cur = input.value.trim();
      const token = b.dataset.quick; // e.g. "1d20"
      const tokSides = /^1d(\d+)$/i.exec(token)?.[1];
      // If the last term is NdS of the same die, increment N (1d12 → 2d12 → 3d12…).
      if (tokSides) {
        const lastRe = new RegExp(`(^|\\+)(\\d+)d${tokSides}$`, 'i');
        const m = cur.match(lastRe);
        if (m) {
          const n = parseInt(m[2], 10) + 1;
          const head = cur.slice(0, m.index);
          const sep = m[1] === '+' ? '+' : '';
          input.value = `${head}${sep}${n}d${tokSides}`;
          input.focus();
          return;
        }
      }
      input.value = cur ? `${cur}+${token}` : token;
      input.focus();
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const expression = String(fd.get('expression') || '').trim();
    if (!expression) return;
    const mode = fd.get('mode');
    DnD.session?.rollDice({
      expression,
      label: fd.get('label') || null,
      advantage: mode === 'adv',
      disadvantage: mode === 'dis'
    });
  });

  const manualBtn = document.getElementById('btnManualRoll');
  if (manualBtn) {
    manualBtn.addEventListener('click', () => DnD.openModal('manualModal'));
  }

  const manualForm = document.getElementById('manualForm');
  if (manualForm) {
    manualForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(manualForm);
      DnD.session?.manualRoll({
        expression: String(fd.get('expression') || '').trim(),
        total: Number(fd.get('total')),
        label: fd.get('label') || null
      });
      DnD.closeModal('manualModal');
      manualForm.reset();
    });
  }

  return {
    // Render a roll payload inside a chat message body.
    renderPayload(payload) {
      if (!payload) return '';
      if (payload.manual) {
        return `<div><strong>${payload.total}</strong> <span class="notes">(manual)</span></div>`;
      }
      function dieClass(v, sides, kept) {
        if (!kept) return 'drop';
        if (v === sides) return 'crit';
        if (v === 1) return 'fumble';
        return '';
      }
      const parts = (payload.parts || []).map(p => {
        if (p.type === 'flat') return (p.value >= 0 ? '+' : '') + p.value;
        const prefix = p.sign < 0 ? '−' : '';
        // adv/dis format: each die is a pair, show [a,b]→pick with the dropped one struck.
        if (p.mode === 'adv' || p.mode === 'dis') {
          const pairs = p.pairs.map((pair, i) => {
            const picked = p.pickIdx[i];
            const a = `<span class="${dieClass(pair[0], p.sides, picked === 0)}">${pair[0]}</span>`;
            const b = `<span class="${dieClass(pair[1], p.sides, picked === 1)}">${pair[1]}</span>`;
            return `[${a}, ${b}]→<strong>${p.picks[i]}</strong>`;
          }).join(' ');
          return `${prefix}${p.count}d${p.sides} ${pairs}`;
        }
        // Regular roll; keptIdx tells us which index was kept (handles duplicate values).
        const keptSet = new Set(p.keptIdx || p.rolls.map((_, i) => i));
        const rolls = p.rolls.map((r, i) =>
          `<span class="${dieClass(r, p.sides, keptSet.has(i))}">${r}</span>`
        ).join(', ');
        return `${prefix}${p.count}d${p.sides}[${rolls}]`;
      }).join(' ');
      const advTag = payload.advantage ? ' <em>(adv)</em>' : payload.disadvantage ? ' <em>(dis)</em>' : '';
      return `<div class="roll-body"><strong>${payload.total}</strong>${advTag} <span class="notes">${parts}</span></div>`;
    }
  };
})();
