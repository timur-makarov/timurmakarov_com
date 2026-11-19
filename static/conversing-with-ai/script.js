(function () { try { var t = localStorage.getItem('elephant.theme'); t = t ? JSON.parse(t) : null; if (!t) { t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } document.documentElement.setAttribute('data-theme', t); } catch (e) { document.documentElement.setAttribute('data-theme', 'light'); } })();

document.addEventListener('DOMContentLoaded', function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var store = { get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
  function safe(name, fn) { try { fn(); } catch (e) { if (window.console) console.error('[widget ' + name + ']', e); } }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  var toastT = null;
  function toast(msg) { var t = $('.toast'); if (!t) return; t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 1600); }
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) { return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return fallback(); }); }
    return Promise.resolve(fallback());
    function fallback() { var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) { } document.body.removeChild(ta); return ok; }
  }

  /* theme */
  safe('theme', function () {
    $$('.theme-toggle').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = document.documentElement; var n = r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        r.setAttribute('data-theme', n); store.set('elephant.theme', n); document.dispatchEvent(new Event('themechange'));
      });
    });
  });

  /* toc + scrollspy */
  safe('toc', function () {
    var list = $('#toc-list'); if (!list) return;
    $$('main [data-toc]').forEach(function (el) {
      var li = document.createElement('li'); li.className = 'toc-' + (el.getAttribute('data-toc-level') || 'chapter');
      var a = document.createElement('a'); a.href = '#' + el.id; a.innerHTML = el.getAttribute('data-toc'); li.appendChild(a);
      if (el.matches('article.lesson')) { var c = document.createElement('span'); c.className = 'toc-check'; c.setAttribute('data-for', el.id); li.appendChild(c); }
      list.appendChild(li);
    });
    var nav = $('#toc');
    var links = {}; $$('#toc-list a').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) {
          if (!en.isIntersecting) return;
          $$('#toc-list a.active').forEach(function (x) { x.classList.remove('active'); });
          var a = links[en.target.id]; if (!a) return; a.classList.add('active');
          var top = a.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop, h = nav.clientHeight;
          if (top < nav.scrollTop + 40 || top > nav.scrollTop + h - 60) { nav.scrollTo({ top: Math.max(0, top - h / 3), behavior: 'smooth' }); }
        });
      }, { rootMargin: '-12% 0px -78% 0px' });
      $$('main [data-toc]').forEach(function (el) { obs.observe(el); });
    }
    var tg = $('.toc-toggle');
    if (tg) { tg.addEventListener('click', function () { nav.classList.toggle('open'); }); }
    list.addEventListener('click', function (e) { if (e.target.closest('a')) nav.classList.remove('open'); });
  });

  /* reading bar */
  safe('readbar', function () {
    var bar = $('.readbar span'); if (!bar) return; var tick = false;
    function upd() { var h = document.documentElement.scrollHeight - innerHeight; bar.style.width = (h > 0 ? Math.min(100, 100 * scrollY / h) : 0) + '%'; tick = false; }
    addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(upd); } }, { passive: true }); upd();
  });

  /* learned progress */
  safe('progress', function () {
    var KEY = 'elephant.learned.v3'; var learned = store.get(KEY, []);
    var lessons = $$('article.lesson');
    function has(id) { return learned.indexOf(id) >= 0; }
    function render() {
      var n = 0;
      lessons.forEach(function (l) {
        var d = has(l.id); if (d) n++;
        l.classList.toggle('is-learned', d);
        var b = $('.learned-btn', l); if (b) { b.textContent = d ? '✓ Learned (click to unmark)' : 'Mark as learned'; b.setAttribute('aria-pressed', d ? 'true' : 'false'); }
        var c = $('.toc-check[data-for="' + l.id + '"]'); if (c) c.textContent = d ? '✓' : '';
      });
      $$('.progress-count').forEach(function (e) { e.textContent = n + ' / ' + lessons.length + ' lessons learned'; });
      $$('.progress-bar>span').forEach(function (e) { e.style.width = (lessons.length ? 100 * n / lessons.length : 0) + '%'; });
    }
    lessons.forEach(function (l) {
      var f = document.createElement('footer'); f.className = 'lesson-foot';
      var b = document.createElement('button'); b.type = 'button'; b.className = 'learned-btn';
      b.addEventListener('click', function () { var i = learned.indexOf(l.id); if (i >= 0) learned.splice(i, 1); else learned.push(l.id); store.set(KEY, learned); render(); });
      f.appendChild(b); l.appendChild(f);
    });
    render();
  });

  /* copy buttons */
  safe('copy', function () {
    $$('pre.prompt').forEach(function (pre) {
      var w = document.createElement('div'); w.className = 'copy-wrap'; pre.parentNode.insertBefore(w, pre); w.appendChild(pre);
      var b = document.createElement('button'); b.type = 'button'; b.className = 'copy-btn'; b.textContent = 'Copy';
      b.addEventListener('click', function () { copyText(pre.textContent).then(function (ok) { toast(ok ? 'Copied' : 'Select and copy manually'); }); });
      w.appendChild(b);
    });
  });


  /* elephant */
  safe('elephant', function () {
    var svg = $('#elephant'); if (!svg) return; var panel = $('#elephant-panel');
    var EL = {
      trunk: { name: 'Trunk', man: '“It’s a snake!”', is: 'The vivid, moving datum: the anecdote, the last incident, the screenshot that went viral. Mobile, salient, easy to grab.', model: 'Models and people both over-weight what is vivid and recent. One concrete story late in a context can outweigh a careful base rate stated earlier.', move: 'Ask: “How common is this? What is the base rate? What would an ordinary week look like?”', lesson: 'Salience is not centrality.' },
      ear: { name: 'Ear', man: '“It’s a fan!”', is: 'The surface that moves air: what people say about the thing (discourse, sentiment, reputation).', model: 'The model’s home ground. It returns a map of discourse (“a portal, not a portrait”): what is said about X, weighted by how much was written.', move: 'Ask: “Is this a claim about X, or about what people say about X? Who said it, from where, with what evidence?”', lesson: 'Talk about the elephant is not the elephant.' },
      leg: { name: 'Leg', man: '“It’s a pillar!”', is: 'What holds the system up: infrastructure, constraints, budgets, physics, incentives. Stable, load-bearing, boring.', model: 'Little gets written about maintenance, constraints, and null results, so answers give them little weight.', move: 'Ask: “What has to stay true for any of this to work? Which constraint would end it?”', lesson: 'What holds it up is not what it does, but nothing happens without it.' },
      side: { name: 'Side', man: '“It’s a wall!”', is: 'The big flat surface: the panorama, the abstraction, the “big picture” with no parts.', model: 'Abstraction looks deep and needs no facts. Asked to “go deeper,” models tend to climb the ladder of abstraction.', move: 'Ask: “Give one concrete instance with numbers. Where is the boundary? What is excluded on purpose?”', lesson: 'A big picture without parts is a wall, not an elephant.' },
      tusk: { name: 'Tusk', man: '“It’s a spear!”', is: 'The sharp edge: risks, failure modes, the worst case.', model: 'Ask for risks and you get generic dangers, the costume of prudence, unless you anchor them in structure.', move: 'Ask: “Through which stock, delay and early signal would this fail?” That is a pre-mortem on structure.', lesson: 'The danger is part of the animal, not the animal.' },
      tail: { name: 'Tail', man: '“It’s a rope!”', is: 'The end of the process: outcomes, lagging indicators, last quarter’s numbers.', model: 'Text is full of after-the-fact explanations. Give a model an outcome and it will fluently supply a cause.', move: 'Ask: “Which earlier, leading signals produced this? What delay separates cause and effect?”', lesson: 'Holding the end of a process is not holding the process.' },
      eye: { name: 'Eye', man: '“It’s looking at me.”', is: 'The part the parable forgets: the elephant notices you. Inquiry changes both the system and the inquirer.', model: 'The model continues from your words, so your framing selects which elephant gets described. Then your dominanta selects what you see in the answer.', move: 'Ask: “Would the answer change if I had wanted the opposite?” (the swap test)', lesson: 'The observer is part of the system.' }
    };
    function show(k) {
      var d = EL[k]; if (!d) return;
      $$('.el-part', svg).forEach(function (p) { p.classList.toggle('sel', p.getAttribute('data-part') === k); });
      panel.innerHTML = '<h6>' + d.name + ' — the blind man says ' + d.man + '</h6><dl><dt>In inquiry</dt><dd>' + d.is + '</dd><dt>With a model</dt><dd>' + d.model + '</dd><dt>Your move</dt><dd>' + d.move + '</dd><dt>Lesson</dt><dd><strong>' + d.lesson + '</strong></dd></dl>';
    }
    $$('.el-part', svg).forEach(function (p) {
      p.setAttribute('tabindex', '0');
      p.addEventListener('click', function () { show(p.getAttribute('data-part')); });
      p.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(p.getAttribute('data-part')); } });
    });
    var lb = $('#elephant-lights');
    if (lb) {
      lb.addEventListener('click', function () {
        svg.classList.toggle('lit'); lb.textContent = svg.classList.contains('lit') ? 'Lights off' : 'Lights on: show the whole';
        if (svg.classList.contains('lit')) { panel.innerHTML = '<h6>Lights on</h6><p>Snake, fan, pillar, wall, spear, rope: each report is true of a part. The whole appears only when the reports are placed in a structure that makes all of them true at once. Now look past the animal. It lives in a herd on a savanna (the container), it walks (a process, not an object), and it is looking back at you (you are inside the system). Nobody in the parable touched the inside: metabolism, history, the herd’s rules. That darkness is where your next question lives.</p>'; }
      });
    }
  });

  /* senses chooser */
  safe('senses', function () {
    var sel = $('#sense-q'); if (!sel) return; var out = $('#sense-out');
    var S = {
      world: { lead: 'Correspondence', then: 'Invariance: is my wording doing the work?', test: 'Bind it. Name the source type, then open it. With no check, the status is “unbound”: not confirmed, not refuted.', fake: 'A specific detail, a citation-shaped string, a number with a unit.' },
      why: { lead: 'Mechanism', then: 'Prediction, or an interruption test. Coherence as a filter.', test: 'Name the mediating process, the stock it changes, the delay, and what would interrupt it. If you can’t imagine the interruption, you have a label.', fake: 'A story with agents and morals, or a diagram that redraws the story with arrows.' },
      built: { lead: 'Coherence', then: 'Invariance under rewording and under a new example.', test: 'Remove one premise and see what falls. State the contrapositive of a key inference. Search the state block for contradictions.', fake: 'A novel or a conspiracy theory: smooth, and it never snags on itself.' },
      will: { lead: 'Prediction', then: 'Mechanism as the reason to expect it; correspondence on the current state.', test: 'Before you look, write the proposition, the horizon, the observation that counts, and what you will do on a hit or a miss.', fake: '“We should see improvement over time.”' },
      act: { lead: 'Decision quality', then: 'Correspondence on the constraints, prediction on the effects, and an explicit loss.', test: 'State the asymmetric loss, what is reversible, and what you would do if the main uncertainty resolved the other way. If the action doesn’t change, stop researching that claim.', fake: 'The median helpful action for a generic organization.' },
      robust: { lead: 'Invariance', then: 'Consilience, if it survives.', test: 'Swap your preferred conclusion. Rephrase without cue words. Change the language, persona, representation, or model family.', fake: 'The same sentence in a new tone.' },
      agree: { lead: 'Consilience', then: 'Correspondence on each line of evidence.', test: 'Find two or more lines of evidence with different blind spots: a measurement and a document, an experiment and an expert who was there.', fake: 'Two articles copying one press release. Two answers from the same model.' },
      value: { lead: 'Stop: this is a choice', then: 'You may test coherence among the values you state.', test: 'Check whether a goal contradicts your values or itself. Do not let a framework derive the values.', fake: 'A recommendation dressed up as a finding about what matters.' }
    };
    function upd() { var d = S[sel.value]; out.innerHTML = '<dl><dt>Lead with</dt><dd><strong>' + d.lead + '</strong></dd><dt>Then</dt><dd>' + d.then + '</dd><dt>Test</dt><dd>' + d.test + '</dd><dt>Costume</dt><dd>' + d.fake + '</dd></dl>'; }
    sel.addEventListener('change', upd); upd();
  });

  /* holon zoom */
  safe('holon', function () {
    var root = $('#holon'); if (!root) return;
    var level = 'whole', stack = [], zooms = 0, log = [];
    var q = $('#h-q', root), logEl = $('#h-log', root), stEl = $('#h-stack', root), here = $('#h-here', root), lvEl = $('#h-level', root);
    var pos = { container: [260, 26], whole: [260, 88], relation: [260, 186], part: [196, 168] };
    function say(m, c) { log.unshift({ m: m, c: c || '' }); log = log.slice(0, 6); render(); }
    function render() {
      $$('[data-level]', root).forEach(function (e) { e.classList.toggle('on', e.getAttribute('data-level') === level); });
      stEl.innerHTML = stack.length ? stack.map(function (p, i) { return '<li><b>' + (i + 1) + '.</b> ' + esc(p.q || '(no question written)') + ' <span>@ ' + p.level + '</span></li>'; }).reverse().join('') : '<li class="muted">empty</li>';
      logEl.innerHTML = log.map(function (l) { return '<li class="' + l.c + '">' + l.m + '</li>'; }).join('');
      var p = pos[level]; here.setAttribute('transform', 'translate(' + p[0] + ',' + p[1] + ')'); lvEl.textContent = level.toUpperCase();
    }
    var M = {
      PIN: function () { stack.push({ q: q.value.trim(), level: level }); zooms = 0; if (stack.length > 3) say('Four or more pins: older pins belong outside the prompt, or the model won’t find them. Keep three visible.', 'warn'); say('PIN: “' + esc(q.value.trim() || '(no question written)') + '” @ ' + level + '. Now you may leave.', 'ok'); },
      IN: function () {
        var n = { container: 'whole', whole: 'part' }[level];
        if (!n) { say(level === 'part' ? 'IN from a part means a subpart. Declare a depth budget (“two levels, then RETURN”).' : 'IN from a relation: pick one endpoint (a part), or RETURN.', 'warn'); return; }
        if (!stack.length) say('Unpinned move. Pin the question first, or you may not find your way back.', 'warn');
        zooms++; if (zooms > 1) say('Double zoom without a RETURN. This is how a component becomes the world.', 'warn');
        level = n; say('IN → ' + level + '. Say which question about the larger level this serves. If you can’t, you are escaping, not zooming.');
      },
      OUT: function () {
        var n = { part: 'whole', relation: 'whole', whole: 'container' }[level];
        if (!n) { say('OUT from the container: cosmology warning. Name a loop up there that changes your action, or come back.', 'warn'); return; }
        if (!stack.length) say('Unpinned move. Pin first.', 'warn');
        level = n; say('OUT → ' + level + '. Name the constraint this level imposes on the one you left. Then come back.');
      },
      ACROSS: function () {
        if (level !== 'part' && level !== 'whole') { say('ACROSS works between two named parts. Go IN to a part first.', 'warn'); return; }
        level = 'relation'; say('ACROSS → relation. Stay on the link: what moves, in which direction, with what delay, and what happens if one end changes. Don’t drift into either part’s history.');
      },
      RETURN: function () {
        if (!stack.length) { say('Nothing pinned, so nothing to return to. This is how silent abandon happens.', 'warn'); return; }
        var p = stack.pop(); level = p.level; zooms = 0; q.value = p.q; say('RETURN → ' + level + '. First line: restate “' + esc(p.q || '(no question)') + '”. Then the delta: what changed? (“Nothing” is a valid and useful answer.)', 'ok');
      }
    };
    $$('[data-move]', root).forEach(function (b) { b.addEventListener('click', function () { M[b.getAttribute('data-move')](); }); });
    render();
  });

  /* session card */
  safe('session', function () {
    var f = $('#session-card'); if (!f) return; var KEY = 'elephant.session';
    var fields = $$('[name]', f); var saved = store.get(KEY, {});
    fields.forEach(function (e) { if (saved[e.name] != null) e.value = saved[e.name]; e.addEventListener('input', save); e.addEventListener('change', save); });
    function save() { var o = {}; fields.forEach(function (e) { o[e.name] = e.value; }); store.set(KEY, o); }
    function v(n) { var e = f.elements[n]; return e && e.value ? e.value.trim() : ''; }
    function dash(n) { return v(n) || '—'; }
    function block() {
      return ['=== STATE (authoritative: use this, not the vibe of the thread) ===',
        'GOAL (G): ' + dash('goal'), 'USE (what the answer is for): ' + dash('use'), 'DONE WHEN: ' + dash('done'), 'OUT OF SCOPE: ' + dash('scope'),
        'LOSS (worse error; irreversible parts): ' + dash('loss'), 'MODE: ' + v('mode') + '   CEREMONY: level ' + v('level'), 'HOLON (container / whole / part in focus): ' + dash('holon'),
        'DEFINITIONS (locked): ' + dash('defs'), 'PREMISES (hypotheses, not facts; P1, P2…): ' + dash('premises'),
        'COMMITMENTS (choice · rejected alternative · reopens if): ' + dash('commits'), 'CLAIMS (id · claim · sense · status · test): ' + dash('claims'),
        'CONTRADICTIONS (do not resolve silently): ' + dash('contra'), 'PREDICTIONS (proposition · horizon · resolution rule): ' + dash('preds'),
        'PARKED: ' + dash('parked'), 'OUTER LOG (trigger · keep/revise/split · when): ' + dash('outer'), '=== END STATE ==='].join('\n');
    }
    var T = {
      open: function () { return block() + '\n\nThis turn (mode: ' + v('mode') + '):\n- Do not recommend an action yet.\n- Restate G and DONE WHEN in two sentences so I can correct drift.\n- List missing facts as missing. “Unknown” is a valid answer and costs you nothing.\n- Then give only: the boundary of the whole (inside / outside / excluded on purpose), and the pattern over time if known. Otherwise write “shape unknown” and the data that would show it.'; },
      turn: function () { return 'MODE: ' + v('mode') + ' · LEVEL SHIFT: none\nUse the STATE below as the state, not the vibe of the thread. New load-bearing claims need: id, sense, status, test. If you are about to change G or the level, stop and name DRIFT or a LEVEL SHIFT instead of doing it silently.\n\n' + block(); },
      close: function () { return block() + '\n\nClose the session:\n- Rewrite the state as it is, not as a success story. Flag every status you upgrade, and why.\n- List predictions with horizons, unbound load-bearing claims, and considered-and-declined challenges.\n- Give me 5 questions I should be able to answer without you if I understood this session. Don’t answer them.\n- One sentence: what would make the next session a continuation rather than a restart?'; }
    };
    var pre = $('#sc-preview');
    $$('[data-sc]', f.parentNode).forEach(function (b) { b.addEventListener('click', function () { var t = T[b.getAttribute('data-sc')](); pre.textContent = t; copyText(t).then(function (ok) { toast(ok ? 'Copied to clipboard' : 'Shown below: copy manually'); }); }); });
    var clr = $('#sc-clear'); if (clr) clr.addEventListener('click', function () { if (!confirm('Clear the session card?')) return; fields.forEach(function (e) { if (e.tagName === 'SELECT') e.selectedIndex = 0; else e.value = ''; }); save(); pre.textContent = ''; });
  });
});

/* evidence notes: number them per lesson, show the note on hover, focus or tap */
document.addEventListener('DOMContentLoaded', function () {
  try {
    var all = Array.prototype.slice.call(document.querySelectorAll('.evn[data-ev]'));
    if (!all.length) return;
    var scopes = Array.prototype.slice.call(document.querySelectorAll('article.lesson, section.chapter, header.hero'));
    var seen = [];
    function number(list, host) {
      var ol = document.createElement('ol'); ol.className = 'ev-notes';
      list.forEach(function (el, i) {
        el.textContent = String(i + 1); el.setAttribute('role', 'button'); el.setAttribute('aria-label', 'Evidence note ' + (i + 1));
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
        var li = document.createElement('li'); li.textContent = el.getAttribute('data-ev'); ol.appendChild(li); seen.push(el);
      });
      if (host && list.length) host.appendChild(ol);
    }
    scopes.forEach(function (sc) { number(Array.prototype.slice.call(sc.querySelectorAll('.evn[data-ev]')).filter(function (e) { return seen.indexOf(e) < 0; }), sc); });
    number(all.filter(function (e) { return seen.indexOf(e) < 0; }), null);

    var tip = document.createElement('div'); tip.className = 'ev-tip'; tip.id = 'ev-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
    var cur = null, pinned = false;
    function place(el) {
      tip.style.left = '0px'; tip.style.top = '0px';
      var r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      var x = Math.max(10, Math.min(window.innerWidth - w - 10, r.left + r.width / 2 - w / 2));
      var y = r.top - h - 8; if (y < 8) y = r.bottom + 8;
      tip.style.left = (x + window.scrollX) + 'px'; tip.style.top = (y + window.scrollY) + 'px';
    }
    function show(el) { cur = el; tip.textContent = el.getAttribute('data-ev'); tip.classList.add('on'); el.setAttribute('aria-describedby', 'ev-tip'); place(el); }
    function hide() { if (cur) cur.removeAttribute('aria-describedby'); cur = null; pinned = false; tip.classList.remove('on'); }
    all.forEach(function (el) {
      el.addEventListener('mouseenter', function () { if (!pinned) show(el); });
      el.addEventListener('mouseleave', function () { if (!pinned) hide(); });
      el.addEventListener('focus', function () { if (!pinned) show(el); });
      el.addEventListener('blur', function () { if (!pinned) hide(); });
      el.addEventListener('click', function (e) { e.stopPropagation(); if (pinned && cur === el) { hide(); } else { show(el); pinned = true; } });
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
    });
    document.addEventListener('click', function () { if (pinned) hide(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
    window.addEventListener('resize', function () { if (cur) place(cur); });
  } catch (e) { if (window.console) console.error('[evidence notes]', e); }
});
