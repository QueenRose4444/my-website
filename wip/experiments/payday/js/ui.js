/* ui.js — in-page dialogs, replacing the browser's native ones.
 * ---------------------------------------------------------------------------
 * `prompt()`, `confirm()` and `alert()` open OS/Chrome chrome that has none of the
 * page's styling, cannot be themed, blocks the whole tab, and looks like a phishing
 * warning on a phone. Rose spotted it immediately: "even adding categories opens a
 * chrome popup instead of a webpage popup".
 *
 * These are promise-based drop-in replacements. They return the same shapes the
 * natives do — a string or null from ask(), a boolean from confirm() — so a call
 * site only changes by adding `await`.
 *
 * ⚠ NEVER reintroduce a native dialog. If you need one that is not here, add it.
 */
(function () {
  'use strict';

  var host = null;

  function build() {
    if (host) return host;
    host = document.createElement('div');
    host.className = 'auth-modal ui-dialog';
    host.innerHTML =
        '<div class="auth-modal-content dialog-box" role="dialog" aria-modal="true" aria-labelledby="uiDlgTitle">'
      +   '<h2 id="uiDlgTitle"></h2>'
      +   '<p class="dialog-body"></p>'
      +   '<div class="dialog-field"><input type="text" class="dialog-input" autocomplete="off"></div>'
      +   '<ul class="dialog-choices"></ul>'
      +   '<div class="edit-actions">'
      +     '<button type="button" class="dialog-ok primary"></button>'
      +     '<button type="button" class="dialog-cancel"></button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(host);
    return host;
  }

  function open(opts) {
    var h = build();
    var box = h.querySelector('.dialog-box');
    var title = h.querySelector('h2');
    var body = h.querySelector('.dialog-body');
    var field = h.querySelector('.dialog-field');
    var input = h.querySelector('.dialog-input');
    var choices = h.querySelector('.dialog-choices');
    var ok = h.querySelector('.dialog-ok');
    var cancel = h.querySelector('.dialog-cancel');

    title.textContent = opts.title || '';
    body.textContent = opts.body || '';
    body.hidden = !opts.body;
    field.hidden = !opts.input;
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '';
    ok.textContent = opts.okLabel || 'OK';
    ok.classList.toggle('danger-btn', !!opts.danger);
    cancel.textContent = opts.cancelLabel || 'Cancel';

    choices.innerHTML = '';
    choices.hidden = !(opts.choices && opts.choices.length);
    (opts.choices || []).forEach(function (c) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dialog-choice';
      b.textContent = c.label;
      b.dataset.value = c.value;
      li.appendChild(b);
      choices.appendChild(li);
    });

    // The element that had focus, so it can be handed back on close — otherwise
    // keyboard users land at the top of the document every time.
    var previous = document.activeElement;
    h.style.display = 'flex';
    (opts.input ? input : ok).focus();
    if (opts.input) input.select();

    return new Promise(function (resolve) {
      function close(value) {
        h.style.display = 'none';
        document.removeEventListener('keydown', onKey, true);
        h.removeEventListener('click', onClick);
        choices.removeEventListener('click', onChoice);
        if (previous && previous.focus) previous.focus();
        resolve(value);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(opts.input ? null : false); }
        else if (e.key === 'Enter' && opts.input) { e.preventDefault(); close(input.value); }
        else if (e.key === 'Tab') {
          // Keep focus inside the dialog.
          var f = box.querySelectorAll('button, input');
          if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      function onClick(e) {
        if (e.target === h) close(opts.input ? null : false);
        else if (e.target === ok) close(opts.input ? input.value : true);
        else if (e.target === cancel) close(opts.input ? null : false);
      }
      function onChoice(e) {
        var b = e.target.closest('.dialog-choice');
        if (b) close(b.dataset.value);
      }
      document.addEventListener('keydown', onKey, true);
      h.addEventListener('click', onClick);
      choices.addEventListener('click', onChoice);
    });
  }

  window.UI = {
    /** Like prompt(). Resolves to the string, or null if cancelled. */
    ask: function (opts) { return open(Object.assign({ input: true }, opts)); },

    /** Like confirm(). Resolves true/false. */
    confirm: function (opts) {
      return open(Object.assign({ okLabel: 'OK' }, opts, { input: false }));
    },

    /**
     * A list to choose from, plus a free-text field for a new value. One dialog
     * instead of prompt()'s "type a number or a name" instruction, which was
     * asking the user to parse a menu out of a sentence.
     */
    pick: function (opts) {
      return open(Object.assign({ input: true, okLabel: 'Use this name' }, opts));
    },
  };
})();
