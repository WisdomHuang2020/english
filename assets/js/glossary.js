/* ==========================================================================
   行业词汇库 · 页面逻辑（零依赖，原生 JS）
   --------------------------------------------------------------------------
   数据：glossary-data.js（自动生成） + glossary-notes.js（人工详解）
   三个视图：缩写速查 / 高频词 / 精句，全部本地渲染，搜索与筛选不刷新页面。
   已掌握状态存 localStorage['pk-glossary-mastered']（只存英文键，不存整条）。
   ========================================================================== */
(function () {
  'use strict';

  var DATA = window.PK_GLOSSARY;
  var NOTES = window.PK_GLOSSARY_NOTES || { abbr: [], words: {}, quotes: [], errata: [], categories: {} };
  if (!DATA) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ── 工具 ─────────────────────────────────────────────────────── */
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/（/g, '(').replace(/）/g, ')')
      .replace(/[\s\u00a0]+/g, '')
      .replace(/[、，,。；;：:]+$/g, '');
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch (e) { return null; }
  }
  function loadMastered() {
    try { return JSON.parse(store('pk-glossary-mastered') || '{}'); } catch (e) { return {}; }
  }
  function saveMastered(m) { store('pk-glossary-mastered', JSON.stringify(m)); }

  var mastered = loadMastered();

  /* 缩写详解匹配：分类一致 + 英文前缀命中（容忍全角括号与多余空格）。
     前缀后必须是非字母数字边界 —— 否则 'PCB' 会把 PCBA、PCB Layout 一起命中，
     同一个详解挂到三条不同条目上，读起来就是错的。 */
  function findAbbrNote(cat, en) {
    var n = norm(en);
    for (var i = 0; i < NOTES.abbr.length; i++) {
      var it = NOTES.abbr[i];
      if (norm(it.cat) !== norm(cat)) continue;
      var key = norm(it.match);
      if (n.indexOf(key) !== 0) continue;
      var next = n.charAt(key.length);
      if (next && /[a-z0-9]/.test(next)) continue;
      return it;
    }
    return null;
  }

  /* ── 视图切换 ─────────────────────────────────────────────────── */
  var views = ['abbr', 'words', 'quotes'];
  function showView(name) {
    if (views.indexOf(name) < 0) name = 'abbr';
    views.forEach(function (v) {
      var panel = $('#panel-' + v);
      // 必须限定 .gx-tab：首屏按钮也带 data-view，用裸属性选择器会命中按钮而不是标签页，
      // 结果面板换了、标签高亮不跟着换（2026-11-10 实测踩到）。
      var tab = $('.gx-tab[data-view="' + v + '"]');
      if (panel) panel.hidden = (v !== name);
      if (tab) tab.setAttribute('aria-selected', v === name ? 'true' : 'false');
    });
    if (history.replaceState) history.replaceState(null, '', '#' + name);
  }
  $$('[data-view]').forEach(function (btn) {
    btn.addEventListener('click', function () { showView(btn.getAttribute('data-view')); });
  });

  /* ── 缩写视图 ─────────────────────────────────────────────────── */
  var abbrIndex = [];   // {el, hay, cat, hasNote}

  function renderAbbr() {
    var host = $('#abbr-list');
    var chips = $('#abbr-chips');
    if (!host) return;

    // 分类 chips
    var html = ['<button class="chip on" type="button" data-cat="all">全部 <b>' + DATA.meta.abbrCount + '</b></button>'];
    DATA.abbr.forEach(function (c) {
      html.push('<button class="chip" type="button" data-cat="' + esc(c.en) + '">' +
        esc(c.cn) + ' <b>' + c.items.length + '</b></button>');
    });
    chips.innerHTML = html.join('');

    // 分组列表
    var frag = [];
    DATA.abbr.forEach(function (c) {
      var intro = NOTES.categories[c.en] || NOTES.categories[c.en.toLowerCase()] || '';
      frag.push('<section class="gx-group" data-cat="' + esc(c.en) + '">');
      frag.push('<div class="gx-group-head"><h3>' + esc(c.cn) +
        ' <span class="gx-group-en">' + esc(c.en) + '</span>' +
        '<span class="gx-count">' + c.items.length + ' 条</span></h3>' +
        (intro ? '<p class="gx-intro">' + esc(intro) + '</p>' : '') + '</div>');
      frag.push('<div class="gx-grid">');
      c.items.forEach(function (it) {
        var note = findAbbrNote(c.en, it.en);
        var body = '';
        if (note) {
          body = '<div class="gx-note">' +
            (note.tag ? '<span class="gx-tag">' + esc(note.tag) + '</span>' : '') +
            (note.err ? '<span class="gx-tag gx-tag--err">原表待核</span>' : '') +
            '<p>' + esc(note.note) + '</p>' +
            (note.ex ? '<p class="gx-ex"><span>例</span>' + esc(note.ex) + '</p>' : '') +
            '</div>';
        }
        frag.push(
          '<div class="gx-item' + (note ? ' has-note' : '') + '" data-cat="' + esc(c.en) + '">' +
            '<div class="gx-row">' +
              '<div class="gx-main"><span class="gx-en">' + esc(it.en) + '</span>' +
                '<span class="gx-cn">' + esc(it.cn) + '</span></div>' +
              (note ? '<button class="gx-toggle" type="button" aria-expanded="false">详解</button>' : '') +
            '</div>' + body +
          '</div>');
      });
      frag.push('</div></section>');
    });
    host.innerHTML = frag.join('');

    // 记录搜索索引
    abbrIndex = $$('.gx-item', host).map(function (el) {
      return {
        el: el,
        hay: norm(el.querySelector('.gx-en').textContent + el.querySelector('.gx-cn').textContent),
        cat: el.getAttribute('data-cat'),
        hasNote: el.classList.contains('has-note')
      };
    });

    // 详解展开
    $$('.gx-toggle', host).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = btn.closest('.gx-item');
        var open = item.classList.toggle('open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.textContent = open ? '收起' : '详解';
      });
    });
  }

  var abbrState = { q: '', cat: 'all', onlyNote: false };
  function filterAbbr() {
    var q = norm(abbrState.q);
    var shown = 0;
    abbrIndex.forEach(function (r) {
      var ok = true;
      if (abbrState.cat !== 'all' && r.cat !== abbrState.cat) ok = false;
      if (ok && abbrState.onlyNote && !r.hasNote) ok = false;
      if (ok && q && r.hay.indexOf(q) < 0) ok = false;
      r.el.hidden = !ok;
      if (ok) shown++;
    });
    $$('.gx-group').forEach(function (g) {
      var visible = $$('.gx-item', g).some(function (el) { return !el.hidden; });
      g.hidden = !visible;
    });
    var out = $('#abbr-count');
    if (out) out.textContent = '显示 ' + shown + ' / ' + DATA.meta.abbrCount;
    var empty = $('#abbr-empty');
    if (empty) empty.hidden = shown !== 0;
  }

  /* ── 高频词视图 ───────────────────────────────────────────────── */
  var wordIndex = [];

  function renderWords() {
    var host = $('#word-list');
    if (!host) return;
    var frag = [];
    DATA.words.forEach(function (w, i) {
      var note = NOTES.words[String(w.en).toLowerCase()] || NOTES.words[String(w.en).toLowerCase().trim()];
      var key = norm(w.en);
      var isDone = !!mastered[key];
      var body = '';
      if (note) {
        body = '<div class="gx-note">' +
          (note.pos ? '<span class="gx-tag">' + esc(note.pos) + '</span>' : '') +
          (note.tag ? '<span class="gx-tag gx-tag--soft">' + esc(note.tag) + '</span>' : '') +
          (note.err ? '<span class="gx-tag gx-tag--err">原表待核</span>' : '') +
          '<p>' + esc(note.note) + '</p>' +
          (note.ex ? '<p class="gx-ex"><span>例</span>' + esc(note.ex) + '</p>' : '') +
          '</div>';
      }
      frag.push(
        '<div class="wx-item' + (note ? ' has-note' : '') + (isDone ? ' done' : '') + '" data-i="' + i + '">' +
          '<div class="gx-row">' +
            '<label class="wx-check" title="标记为已掌握">' +
              '<input type="checkbox" data-master="' + esc(key) + '"' + (isDone ? ' checked' : '') + ' />' +
              '<span></span>' +
            '</label>' +
            '<div class="gx-main"><span class="gx-en">' + esc(w.en) + '</span>' +
              '<span class="gx-cn">' + esc(w.cn) + '</span></div>' +
            (note ? '<button class="gx-toggle" type="button" aria-expanded="false">详解</button>' : '') +
          '</div>' + body +
        '</div>');
    });
    host.innerHTML = frag.join('');

    wordIndex = $$('.wx-item', host).map(function (el) {
      var en = el.querySelector('.gx-en').textContent;
      return {
        el: el,
        hay: norm(en + el.querySelector('.gx-cn').textContent),
        letter: en.trim().charAt(0).toLowerCase()
      };
    });

    // 字母索引
    var letters = {};
    wordIndex.forEach(function (r) { if (/[a-z]/.test(r.letter)) letters[r.letter] = 1; });
    var bar = $('#word-letters');
    if (bar) {
      var lh = ['<button class="gx-letter on" type="button" data-letter="all">全部</button>'];
      Object.keys(letters).sort().forEach(function (l) {
        lh.push('<button class="gx-letter" type="button" data-letter="' + l + '">' + l.toUpperCase() + '</button>');
      });
      bar.innerHTML = lh.join('');
    }

    $$('.gx-toggle', host).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = btn.closest('.wx-item');
        var open = item.classList.toggle('open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.textContent = open ? '收起' : '详解';
      });
    });
    $$('[data-master]', host).forEach(function (box) {
      box.addEventListener('change', function () {
        var k = box.getAttribute('data-master');
        if (box.checked) mastered[k] = 1; else delete mastered[k];
        saveMastered(mastered);
        box.closest('.wx-item').classList.toggle('done', box.checked);
        updateProgress();
      });
    });
  }

  var wordState = { q: '', letter: 'all', hideDone: false };
  function filterWords() {
    var q = norm(wordState.q);
    var shown = 0;
    wordIndex.forEach(function (r) {
      var ok = true;
      if (wordState.letter !== 'all' && r.letter !== wordState.letter) ok = false;
      if (ok && wordState.hideDone && r.el.classList.contains('done')) ok = false;
      if (ok && q && r.hay.indexOf(q) < 0) ok = false;
      r.el.hidden = !ok;
      if (ok) shown++;
    });
    var out = $('#word-count');
    if (out) out.textContent = '显示 ' + shown + ' / ' + DATA.meta.wordCount;
    var empty = $('#word-empty');
    if (empty) empty.hidden = shown !== 0;
  }

  function updateProgress() {
    var total = DATA.meta.wordCount;
    var done = Object.keys(mastered).length;
    var pct = total ? Math.round(done / total * 100) : 0;
    var bar = $('#word-progress-bar');
    var txt = $('#word-progress-text');
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = '已掌握 ' + done + ' / ' + total + '（' + pct + '%）';
  }

  /* ── 精句视图 ─────────────────────────────────────────────────── */
  function renderQuotes() {
    var host = $('#quote-list');
    if (!host) return;
    host.innerHTML = DATA.quotes.map(function (q, i) {
      var c = (NOTES.quotes || [])[i];
      return '<figure class="q-card">' +
        '<blockquote>' + esc(q.en) + '</blockquote>' +
        '<figcaption>' + esc(q.cn) + '</figcaption>' +
        '<div class="q-src">' + esc(q.src) + '</div>' +
        (c && c.note ? '<p class="q-note">' + esc(c.note) + '</p>' : '') +
        '</figure>';
    }).join('');
  }

  /* ── 勘误表 ───────────────────────────────────────────────────── */
  function renderErrata() {
    var host = $('#errata-body');
    if (!host) return;
    host.innerHTML = (NOTES.errata || []).map(function (e) {
      return '<tr><td><code>' + esc(e.term) + '</code></td><td>' + esc(e.issue) + '</td><td>' + esc(e.fix) + '</td></tr>';
    }).join('');
  }

  /* ── 绑定搜索与筛选 ───────────────────────────────────────────── */
  function bind() {
    var s1 = $('#abbr-search');
    if (s1) s1.addEventListener('input', function () { abbrState.q = s1.value; filterAbbr(); });

    var chipBar = $('#abbr-chips');
    if (chipBar) chipBar.addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      $$('.chip', chipBar).forEach(function (c) { c.classList.remove('on'); });
      b.classList.add('on');
      abbrState.cat = b.getAttribute('data-cat');
      filterAbbr();
    });

    var onlyNote = $('#abbr-only-note');
    if (onlyNote) onlyNote.addEventListener('click', function () {
      abbrState.onlyNote = !abbrState.onlyNote;
      onlyNote.classList.toggle('on', abbrState.onlyNote);
      onlyNote.setAttribute('aria-pressed', abbrState.onlyNote ? 'true' : 'false');
      filterAbbr();
    });

    var s2 = $('#word-search');
    if (s2) s2.addEventListener('input', function () { wordState.q = s2.value; filterWords(); });

    var letters = $('#word-letters');
    if (letters) letters.addEventListener('click', function (e) {
      var b = e.target.closest('.gx-letter');
      if (!b) return;
      $$('.gx-letter', letters).forEach(function (c) { c.classList.remove('on'); });
      b.classList.add('on');
      wordState.letter = b.getAttribute('data-letter');
      filterWords();
    });

    var hideDone = $('#word-hide-done');
    if (hideDone) hideDone.addEventListener('click', function () {
      wordState.hideDone = !wordState.hideDone;
      hideDone.classList.toggle('on', wordState.hideDone);
      hideDone.setAttribute('aria-pressed', wordState.hideDone ? 'true' : 'false');
      filterWords();
    });
  }

  /* ── 启动 ─────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    renderAbbr();
    renderWords();
    renderQuotes();
    renderErrata();
    bind();
    filterAbbr();
    filterWords();
    updateProgress();
    var h = (location.hash || '').replace('#', '');
    showView(views.indexOf(h) >= 0 ? h : 'abbr');
  });
})();
