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
  /* 详解正文里的 **加粗**。
     顺序不能反 —— 必须先 esc 再替换：反过来的话，内容里的尖括号会变成真标签。
     esc 不产生 `*`，所以这步替换是安全的。
     （2026-11-18 补：此前 esc 直接输出，25 处 ** 在页面上显示成字面星号。） */
  function rich(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
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
  var TOTAL_ABBR = 0;   // 原表条数 + 编辑补充，renderAbbr 里写入，filterAbbr 复用

  /* 分类重排：按 notes.taxonomy 把原表分类改名 / 拆出新栏，并可追加原表没有的分类。
     返回 [{en, cn, items, intro}]，顺序即页面顺序；items 每项都带 orig（原始分类名）。

     ⚠️ orig 必须记在**每一条**上，不能只记在分类上：详解是按「原分类 + 英文前缀」匹配的。
        一个栏可能同时收多个来源的条目（如「包装运输」从商务类抽 8 条、从物料类抽 5 条），
        若只保留分类级的单一 orig，另一来源的条目详解会静默消失（不报错，按钮就是没了）。 */
  function buildCategories() {
    var plan = NOTES.taxonomy || {};
    var rename = plan.rename || {};
    var extracts = plan.extract || [];
    var out = [];        // 正常位置，按原表分类顺序
    var tail = [];       // atEnd 的栏，排到全部分类之后
    var byName = {};     // 同名栏合并：多条 extract 指向同一个新栏时共用一桶
    var selfOf = {};     // 原分类 en -> 它落的桶（改名后可能与别的分类同桶）

    function bucket(en, cn, intro) {
      if (!byName[en]) byName[en] = { en: en, cn: cn, items: [], intro: intro || '' };
      return byName[en];
    }
    function place(b, anchor, atEnd) {
      if (out.indexOf(b) >= 0 || tail.indexOf(b) >= 0) return;
      if (atEnd) { tail.push(b); return; }
      var i = out.indexOf(anchor);
      if (i < 0) out.push(b); else out.splice(i + 1, 0, b);
    }

    /* 第一遍：按原表顺序把各分类的桶建好。
       必须先建完再分流 —— 否则「零部件名称」会被「安装方式」搬件时提前插入，
       整个栏位顺序就跟着乱了（踩过）。改名合并到同一桶时不会重复入列。 */
    DATA.abbr.forEach(function (c) {
      var r = rename[c.en] || null;
      var b = bucket(r ? r.en : c.en, r ? r.cn : c.cn, r ? r.intro : '');
      selfOf[c.en] = b;
      if (out.indexOf(b) < 0 && tail.indexOf(b) < 0) out.push(b);
    });

    /* 第二遍：条目按 extract 规则分流。条目自带 orig，详解才能按原分类名匹配。 */
    DATA.abbr.forEach(function (c) {
      var self = selfOf[c.en];
      var mine = extracts.filter(function (x) { return x.from === c.en; });

      c.items.forEach(function (it) {
        var target = null;
        for (var i = 0; i < mine.length; i++) {
          if (mine[i].items.indexOf(it.en) >= 0) { target = mine[i]; break; }
        }
        var dest = target ? bucket(target.en, target.cn, target.intro) : self;
        if (target) place(dest, self, target.atEnd);
        dest.items.push({ en: it.en, cn: it.cn, orig: c.en });
      });

      // items 为空的 extract = 新开一个空栏（供 notes.extras 落位），也要建桶
      mine.forEach(function (x) {
        if (x.items && x.items.length) return;
        place(bucket(x.en, x.cn, x.intro), self, x.atEnd);
      });
    });

    return out.concat(tail);
  }

  function renderAbbr() {
    var host = $('#abbr-list');
    var chips = $('#abbr-chips');
    if (!host) return;

    /* 编辑补充词条：原表没有、后来补进去的（数据见 glossary-notes.js 的 extras）。
       按分类并进对应分组，并在条目上标「编辑补充」—— 不能让读者误以为是原表内容。 */
    var EXTRAS = (NOTES.extras && NOTES.extras.abbr) || [];
    var extrasIn = function (cat) {
      return EXTRAS.filter(function (x) { return x.cat === cat; });
    };
    var totalAbbr = DATA.meta.abbrCount + EXTRAS.length;
    TOTAL_ABBR = totalAbbr;

    // 重排后的分类，空分类（条目与补充都被搬空）不渲染，也不进 chips
    var CATS = buildCategories().filter(function (c) {
      return c.items.length + extrasIn(c.en).length > 0;
    });

    // 分类 chips
    var html = ['<button class="chip on" type="button" data-cat="all">全部 <b>' + totalAbbr + '</b></button>'];
    CATS.forEach(function (c) {
      html.push('<button class="chip" type="button" data-cat="' + esc(c.en) + '">' +
        esc(c.cn) + ' <b>' + (c.items.length + extrasIn(c.en).length) + '</b></button>');
    });
    chips.innerHTML = html.join('');

    // 分组列表
    var frag = [];
    CATS.forEach(function (c) {
      var intro = c.intro || NOTES.categories[c.en] || NOTES.categories[c.en.toLowerCase()] || '';
      var groupExtras = extrasIn(c.en);
      frag.push('<section class="gx-group" data-cat="' + esc(c.en) + '">');
      frag.push('<div class="gx-group-head"><h3>' + esc(c.cn) +
        ' <span class="gx-group-en">' + esc(c.en) + '</span>' +
        '<span class="gx-count">' + (c.items.length + groupExtras.length) + ' 条</span></h3>' +
        (intro ? '<p class="gx-intro">' + rich(intro) + '</p>' : '') + '</div>');
      frag.push('<div class="gx-grid">');
      c.items.forEach(function (it) {
        var note = findAbbrNote(it.orig, it.en);
        var body = '';
        if (note) {
          body = '<div class="gx-note">' +
            (note.tag ? '<span class="gx-tag">' + esc(note.tag) + '</span>' : '') +
            (note.err ? '<span class="gx-tag gx-tag--err">原表待核</span>' : '') +
            '<p>' + rich(note.note) + '</p>' +
            (note.ex ? '<p class="gx-ex"><span>例</span>' + rich(note.ex) + '</p>' : '') +
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
      // 补充词条排在分组末尾，永远带详解
      groupExtras.forEach(function (x) {
        frag.push(
          '<div class="gx-item has-note gx-item--extra" data-cat="' + esc(c.en) + '">' +
            '<div class="gx-row">' +
              '<div class="gx-main"><span class="gx-en">' + esc(x.en) + '</span>' +
                '<span class="gx-cn">' + esc(x.cn) + '</span></div>' +
              '<button class="gx-toggle" type="button" aria-expanded="false">详解</button>' +
            '</div>' +
            '<div class="gx-note">' +
              '<span class="gx-tag gx-tag--extra">编辑补充</span>' +
              (x.tag ? '<span class="gx-tag">' + esc(x.tag) + '</span>' : '') +
              '<p>' + rich(x.note) + '</p>' +
              (x.ex ? '<p class="gx-ex"><span>例</span>' + rich(x.ex) + '</p>' : '') +
            '</div>' +
          '</div>');
      });
      frag.push('</div></section>');
    });
    host.innerHTML = frag.join('');

    // 首屏统计与页签徽标里的缩写数同样运行时取，别和 chips 三份数字各说各话
    ['#stat-abbr', '#tab-abbr-count'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.textContent = String(totalAbbr);
    });
    // 分类数同理：重排后是 12 栏，写死「10 类」就会跟 chips 对不上
    var catStat = $('#stat-cats');
    if (catStat) catStat.textContent = '行业缩写 · ' + CATS.length + ' 类';

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
    if (out) out.textContent = '显示 ' + shown + ' / ' + TOTAL_ABBR;
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
          '<p>' + rich(note.note) + '</p>' +
          (note.ex ? '<p class="gx-ex"><span>例</span>' + rich(note.ex) + '</p>' : '') +
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
        (c && c.note ? '<p class="q-note">' + rich(c.note) + '</p>' : '') +
        '</figure>';
    }).join('');
  }

  /* ── 勘误表 ───────────────────────────────────────────────────── */
  function renderErrata() {
    var host = $('#errata-body');
    if (!host) return;
    var list = NOTES.errata || [];
    host.innerHTML = list.map(function (e) {
      return '<tr><td><code>' + esc(e.term) + '</code></td><td>' + esc(e.issue) + '</td><td>' + esc(e.fix) + '</td></tr>';
    }).join('');
    /* 首屏统计里的「处原表勘误」运行时取值：写死会在下次补勘误时忘改
       （HTML 里留了同样的静态值，供禁用 JS 时兜底）。 */
    var stat = $('#stat-errata');
    if (stat) stat.textContent = String(list.length);
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
