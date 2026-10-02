// Bewegung und Interaktion. Alles optional: ohne JS bleibt die Seite vollständig lesbar.
(function () {
  'use strict';
  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // ---------- Überschriften Wort für Wort ----------
  document.querySelectorAll('[data-split]').forEach(function (el) {
    var n = 0;
    function wrap(node, extraClass) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) {
          var frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            var w = document.createElement('span'); w.className = 'w';
            var wi = document.createElement('span'); wi.className = 'wi' + (extraClass ? ' ' + extraClass : '');
            wi.textContent = part; wi.style.setProperty('--d', n++);
            w.appendChild(wi); frag.appendChild(w);
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1 && child.tagName !== 'BR') {
          // Hervorgehobene Passage bleibt eine Einheit (ein durchgehender Verlauf)
          var w2 = document.createElement('span'); w2.className = 'w';
          var wi2 = document.createElement('span'); wi2.className = 'wi ' + child.className;
          wi2.textContent = child.textContent; wi2.style.setProperty('--d', n++);
          w2.appendChild(wi2); node.replaceChild(w2, child);
        }
      });
    }
    wrap(el, '');
    el.setAttribute('aria-label', el.textContent);
  });

  // ---------- Scroll-Reveal ----------
  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  var group = new Map();
  reveals.forEach(function (el) {
    var key = el.parentElement;
    var i = group.get(key) || 0;
    el.style.setProperty('--i', i);
    group.set(key, i + 1);
  });
  if ('IntersectionObserver' in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -40px 0px', threshold: 0 }); // threshold 0: auch sehr hohe Blöcke (lange Tabellen) werden sicher eingeblendet
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }
  requestAnimationFrame(function () { root.classList.add('is-ready'); });

  // ---------- Navigation: Linie beim Scrollen ----------
  var nav = document.querySelector('[data-nav]');
  function onScroll() { if (nav) nav.classList.toggle('scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // ---------- Spotlight auf Kacheln ----------
  if (finePointer) {
    document.querySelectorAll('.spot').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--sx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--sy', (e.clientY - r.top) + 'px');
      });
    });
  }

  // ---------- Magnetische Buttons ----------
  if (finePointer && !reduced) {
    document.querySelectorAll('.magnetic').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) * 0.18;
        var y = (e.clientY - r.top - r.height / 2) * 0.28;
        el.style.setProperty('--mx', x.toFixed(1) + 'px');
        el.style.setProperty('--my', y.toFixed(1) + 'px');
      });
      el.addEventListener('pointerleave', function () {
        el.style.setProperty('--mx', '0px'); el.style.setProperty('--my', '0px');
      });
    });
  }

  // ---------- Zahlen hochzählen ----------
  document.querySelectorAll('[data-countup]').forEach(function (el) {
    var target = parseInt(el.getAttribute('data-countup'), 10) || 0;
    if (reduced || target === 0) { el.textContent = target; return; }
    el.textContent = '0';
    var run = function () {
      var start = null, dur = 1100;
      function step(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 4)));
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    };
    if ('IntersectionObserver' in window) {
      var o = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { o.disconnect(); setTimeout(run, 250); } });
      o.observe(el);
    } else run();
  });

  // Fortschrittsbalken (Verwaltung)
  document.querySelectorAll('[data-progress]').forEach(function (el) {
    var p = Math.max(0, Math.min(100, parseInt(el.getAttribute('data-progress'), 10) || 0));
    setTimeout(function () { el.style.width = p + '%'; }, 400);
  });

  // ---------- Decode-Effekt ----------
  var GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghkmnpqrstuvwxyz23456789-_';
  function decode(el, text, dur) {
    if (reduced) { el.textContent = text; return; }
    var start = null;
    function frame(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var fixed = Math.floor(text.length * p);
      var out = text.slice(0, fixed);
      for (var i = fixed; i < text.length; i++) out += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      el.textContent = out;
      if (p < 1) requestAnimationFrame(frame); else el.textContent = text;
    }
    requestAnimationFrame(frame);
  }

  // ---------- Toast ----------
  var toastEl = document.querySelector('.toast'), toastTimer;
  window.biberToast = function (msg) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.hidden = false;
    requestAnimationFrame(function () { toastEl.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2000);
  };

  // ---------- Theme ----------
  var themeBtn = document.querySelector('[data-theme-toggle]');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var current = root.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('biber-theme', next); } catch (e) { /* egal */ }
  });

  // ---------- Druckseite (Lehrkräfte) ----------
  document.querySelectorAll('[data-print-page]').forEach(function (btn) {
    btn.addEventListener('click', function () { window.print(); });
  });

  // ---------- Zugangsdaten ----------
  var card = document.querySelector('[data-cred]');
  if (!card) return;

  var userOut = card.querySelector('[data-decode]');
  if (userOut) {
    var real = userOut.textContent;
    setTimeout(function () { decode(userOut, real, 900); }, 450);
  }

  function valueOf(field) {
    var out = card.querySelector('[data-field="' + field + '"] [data-value]');
    return out ? (out.getAttribute('data-secret') || out.textContent).trim() : '';
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'sr-only';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy'));
    });
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  var meter = card.querySelector('[data-meter]');
  function updateProgress() {
    var done = card.querySelectorAll('.field.is-done').length;
    if (meter) meter.style.width = (done / 2 * 100) + '%';
    var go = card.querySelector('.go');
    if (go) go.classList.toggle('is-done', done >= 2);
  }

  card.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var field = btn.getAttribute('data-copy');
      var label = btn.querySelector('.lbl');
      copyText(valueOf(field)).then(function () {
        btn.classList.add('done');
        if (label) label.textContent = 'Kopiert';
        btn.closest('.field').classList.add('is-done');
        updateProgress();
        window.biberToast(field === 'username' ? 'Benutzername kopiert.' : 'Passwort kopiert.');
        setTimeout(function () { if (label) label.textContent = 'Kopieren'; btn.classList.remove('done'); }, 1800);
      }).catch(function () { window.biberToast('Kopieren nicht möglich. Bitte abschreiben.'); });
    });
  });

  var revealBtn = card.querySelector('[data-reveal]');
  if (revealBtn) revealBtn.addEventListener('click', function () {
    var out = card.querySelector('[data-field="password"] [data-value]');
    var lbl = revealBtn.querySelector('.lbl');
    var hidden = out.classList.toggle('is-hidden');
    if (hidden) out.textContent = '••••••••';
    else decode(out, out.getAttribute('data-secret'), 650);
    revealBtn.setAttribute('aria-pressed', String(!hidden));
    if (lbl) lbl.textContent = hidden ? 'Anzeigen' : 'Verbergen';
  });

  var printBtn = card.querySelector('[data-print]');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
})();
