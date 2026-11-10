/* ==========================================================================
   外贸英语 · 邮件英语学习站 —— 站点交互（零依赖，零构建）
   --------------------------------------------------------------------------
   按页面元素是否存在自动初始化，各页共用同一份文件：
     · 顶栏「目录 ▾」（≤1139px）
     · 当前导航高亮 / 正文目录滚动高亮
     · 一键复制（模板、句式）
     · 模板变量实时替换
     · 句式库：分类 + 搜索 + 收藏
     · 检查清单：勾选状态本地记忆
     · 自测：逐题判定 + 计分
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 小工具 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      if (val === null) { localStorage.removeItem(key); return null; }
      localStorage.setItem(key, val);
    } catch (e) { /* 隐私模式：静默降级，不影响阅读 */ }
    return val;
  }
  function storeJSON(key, val) {
    if (val === undefined) {
      try { return JSON.parse(store(key) || '[]'); } catch (e) { return []; }
    }
    store(key, JSON.stringify(val));
    return val;
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#te-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'te-toast';
      el.setAttribute('role', 'status');
      el.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:28px', 'transform:translateX(-50%) translateY(8px)',
        'padding:9px 16px', 'border-radius:9px', 'font-size:13px', 'font-weight:600',
        'background:var(--color-surface-elevated)', 'color:var(--color-text-primary)',
        'border:1px solid var(--color-border)', 'box-shadow:0 12px 32px rgba(0,0,0,.28)',
        'z-index:300', 'opacity:0', 'transition:opacity .18s, transform .18s',
        'pointer-events:none', 'max-width:calc(100vw - 40px)'
      ].join(';');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    requestAnimationFrame(function () {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(8px)';
    }, 1800);
  }

  /* ---------- 复制 ---------- */
  function copyText(text) {
    if (navigator.clipboard && location.protocol !== 'file:') {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); }
      catch (e) { reject(e); }
      finally { document.body.removeChild(ta); }
    });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    e.preventDefault();
    var text = btn.getAttribute('data-copy');
    if (text === 'self') {
      var host = btn.closest('[data-copy-host]');
      text = host ? host.innerText : '';
    }
    copyText(text.trim()).then(function () {
      toast('已复制到剪贴板');
      var old = btn.getAttribute('data-label') || btn.textContent;
      btn.setAttribute('data-label', old);
      btn.textContent = '已复制';
      setTimeout(function () { btn.textContent = btn.getAttribute('data-label') || old; }, 1400);
    }).catch(function () {
      toast('复制失败，请手动选中文字');
    });
  });

  /* ---------- 顶栏「目录 ▾」 ---------- */
  (function navToggle() {
    var btn = $('.nav-toggle');
    var nav = $('.navlinks');
    if (!btn || !nav) return;
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        nav.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        btn.focus();
      }
    });
    $$('a', nav).forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      });
    });
  })();

  /* ---------- 当前导航高亮 ----------
     用文件名 + 目录比对，子目录页面（/email/*.html）命中的是「邮件英语」。 */
  (function activeNav() {
    var here = location.pathname.split('/').pop() || 'index.html';
    var inEmail = location.pathname.indexOf('/email/') >= 0;
    $$('.navlinks a').forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('/').pop();
      var isTopic = a.getAttribute('data-topic') === 'email';
      var match;
      if (here === 'index.html') {
        /* 两个首页：根首页只亮「首页」，主题首页亮「邮件英语」 */
        match = inEmail ? isTopic : (!isTopic && href === 'index.html');
      } else {
        /* 其余页面按文件名精确命中，避免主题首页误亮 */
        match = !isTopic && href === here;
      }
      if (match) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); }
    });
  })();

  /* ---------- 正文目录滚动高亮 ---------- */
  (function scrollSpy() {
    var links = $$('.toc a[href^="#"]');
    if (!links.length) return;
    var heads = links.map(function (a) {
      return document.getElementById(a.getAttribute('href').slice(1));
    }).filter(Boolean);
    if (!heads.length) return;
    function update() {
      var y = window.scrollY + 110, cur = heads[0];
      heads.forEach(function (h) { if (h.offsetTop <= y) cur = h; });
      links.forEach(function (a) {
        a.classList.toggle('active', a.getAttribute('href') === '#' + cur.id);
      });
    }
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { update(); ticking = false; });
    }, { passive: true });
    update();
  })();

  /* ---------- 模板库：变量实时替换 ---------- */
  (function templates() {
    var blocks = $$('[data-template]');
    if (!blocks.length) return;

    var KEY = 'te-tpl-vars';
    var saved = {};
    try { saved = JSON.parse(store(KEY) || '{}') || {}; } catch (e) { saved = {}; }

    var inputs = $$('[data-var]');
    inputs.forEach(function (inp) {
      var k = inp.getAttribute('data-var');
      if (saved[k]) inp.value = saved[k];
      inp.addEventListener('input', function () {
        saved[k] = inp.value;
        store(KEY, JSON.stringify(saved));
        renderAll();
      });
    });

    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    blocks.forEach(function (block) {
      var pre = $('pre', block);
      if (!pre) return;
      block.__raw = pre.textContent.replace(/^\n+|\s+$/g, '');
    });

    function fill(raw) {
      return raw.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, function (m, k) {
        var v = (saved[k] || '').trim();
        return v || m;
      });
    }

    function renderAll() {
      blocks.forEach(function (block) {
        var pre = $('pre', block);
        var filled = fill(block.__raw);
        /* 未填的占位符高亮成主色，填过的保持正文色 */
        pre.innerHTML = esc(filled).replace(/\{\{[A-Za-z0-9_]+\}\}/g, function (m) {
          return '<span class="var-hl">' + m + '</span>';
        });
        var copyBtn = $('[data-copy]', block);
        if (copyBtn) copyBtn.setAttribute('data-copy', filled);
      });
    }

    var reset = $('#tpl-reset');
    if (reset) {
      reset.addEventListener('click', function () {
        inputs.forEach(function (i) { i.value = ''; });
        saved = {};
        store(KEY, null);
        renderAll();
        toast('已清空自定义内容');
      });
    }

    renderAll();
  })();

  /* ---------- 句式库：分类 + 搜索 + 收藏 ---------- */
  (function phrases() {
    var list = $('#phrase-list');
    if (!list) return;

    var KEY = 'te-fav';
    var favs = storeJSON(KEY);
    var activeCat = 'all';
    var q = '';

    var search = $('#phrase-search');
    var chips = $$('.chip[data-cat]');

    function apply() {
      var shown = 0;
      $$('.phrase-group', list).forEach(function (group) {
        var cat = group.getAttribute('data-cat');
        var catOK = activeCat === 'all' || cat === activeCat;
        var inner = 0;
        $$('.phrase', group).forEach(function (row) {
          var text = row.textContent.toLowerCase();
          var hit = catOK && (!q || text.indexOf(q) >= 0);
          row.hidden = !hit;
          if (hit) inner++;
        });
        group.hidden = inner === 0;
        shown += inner;
      });
      var empty = $('#phrase-empty');
      if (empty) empty.hidden = shown !== 0;
      var count = $('#phrase-count');
      if (count) count.textContent = shown + ' 条';
    }

    if (search) {
      search.addEventListener('input', function () {
        q = search.value.trim().toLowerCase();
        apply();
      });
    }
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        chips.forEach(function (c) { c.classList.remove('on'); });
        chip.classList.add('on');
        activeCat = chip.getAttribute('data-cat');
        apply();
      });
    });

    /* 收藏：只存句式索引，重排文案不影响 */
    function paintFav(row) {
      var btn = $('.fav-btn', row);
      if (!btn) return;
      var on = favs.indexOf(row.getAttribute('data-id')) >= 0;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.title = on ? '取消收藏' : '收藏这句';
    }

    $$('.phrase', list).forEach(function (row) { paintFav(row); });

    list.addEventListener('click', function (e) {
      var btn = e.target.closest('.fav-btn');
      if (!btn) return;
      var row = btn.closest('.phrase');
      var id = row.getAttribute('data-id');
      var i = favs.indexOf(id);
      if (i >= 0) favs.splice(i, 1); else favs.push(id);
      storeJSON(KEY, favs);
      paintFav(row);
      toast(i >= 0 ? '已取消收藏' : '已收藏');
    });

    var onlyFav = $('#only-fav');
    if (onlyFav) {
      onlyFav.addEventListener('click', function () {
        var on = onlyFav.classList.toggle('on');
        onlyFav.setAttribute('aria-pressed', String(on));
        $$('.phrase', list).forEach(function (row) {
          var isFav = favs.indexOf(row.getAttribute('data-id')) >= 0;
          row.hidden = on ? !isFav : false;
        });
        if (on) {
          $$('.phrase-group', list).forEach(function (g) {
            g.hidden = $$('.phrase', g).every(function (r) { return r.hidden; });
          });
        } else {
          apply();
        }
      });
    }

    apply();
  })();

  /* ---------- 检查清单：本地记忆 ---------- */
  (function checklist() {
    var list = $('#checklist');
    if (!list) return;
    var KEY = 'te-check';
    var done = storeJSON(KEY);

    function sync() {
      var boxes = $$('input[type=checkbox]', list);
      boxes.forEach(function (b) {
        b.checked = done.indexOf(b.getAttribute('data-id')) >= 0;
      });
      var bar = $('#check-bar');
      var txt = $('#check-text');
      var n = done.length;
      if (bar) bar.style.width = Math.round((n / boxes.length) * 100) + '%';
      if (txt) txt.textContent = n + ' / ' + boxes.length + ' 项已确认' + (n === boxes.length ? ' · 可以发了' : '');
    }

    list.addEventListener('change', function (e) {
      var b = e.target;
      if (b.type !== 'checkbox') return;
      var id = b.getAttribute('data-id');
      var i = done.indexOf(id);
      if (b.checked && i < 0) done.push(id);
      if (!b.checked && i >= 0) done.splice(i, 1);
      storeJSON(KEY, done);
      sync();
    });

    var reset = $('#check-reset');
    if (reset) {
      reset.addEventListener('click', function () {
        done = [];
        storeJSON(KEY, done);
        sync();
        toast('已重置');
      });
    }

    sync();
  })();

  /* ---------- 自测 ---------- */
  (function quiz() {
    var root = $('#quiz');
    if (!root) return;
    var questions = $$('.quiz-q', root);
    var total = questions.length;
    var answered = {};
    var right = 0;

    function updateScore() {
      var n = Object.keys(answered).length;
      var score = $('#score');
      var meta = $('#score-meta');
      if (score) score.textContent = right + ' / ' + total;
      if (meta) {
        meta.textContent = n === total
          ? (right === total ? '全对。这套句式可以放心抄进邮件了。'
            : right >= total * 0.7 ? '基本过关，把错题的说明再看一遍。'
              : '建议回到「结构与语气」和「句式库」再过一轮。')
          : '已答 ' + n + ' / ' + total + ' 题';
      }
    }

    root.addEventListener('click', function (e) {
      var opt = e.target.closest('.opt');
      if (!opt) return;
      var qBox = opt.closest('.quiz-q');
      var qid = qBox.getAttribute('data-q');
      if (answered[qid]) return;

      var opts = $$('.opt', qBox);
      var isRight = opt.getAttribute('data-correct') === 'true';
      opts.forEach(function (o) {
        o.disabled = true;
        if (o.getAttribute('data-correct') === 'true') o.classList.add('right');
      });
      if (!isRight) opt.classList.add('wrong');
      else right++;
      answered[qid] = isRight;

      var exp = $('.q-exp', qBox);
      if (exp) exp.hidden = false;
      updateScore();
    });

    var again = $('#quiz-reset');
    if (again) {
      again.addEventListener('click', function () {
        answered = {}; right = 0;
        $$('.quiz-q', root).forEach(function (qBox) {
          $$('.opt', qBox).forEach(function (o) {
            o.disabled = false;
            o.classList.remove('right', 'wrong');
          });
          var exp = $('.q-exp', qBox);
          if (exp) exp.hidden = true;
        });
        updateScore();
        window.scrollTo({ top: root.offsetTop - 90, behavior: 'smooth' });
      });
    }

    updateScore();
  })();

  /* ---------- 章节进度条（内容页顶部细线） ---------- */
  (function readProgress() {
    if (!$('.prose')) return;
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;top:0;left:0;height:2px;width:0;z-index:120;background:var(--color-brand-light);transition:width .1s linear';
    document.body.appendChild(bar);
    window.addEventListener('scroll', function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
    }, { passive: true });
  })();
})();
