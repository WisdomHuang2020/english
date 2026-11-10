/* ==========================================================================
   power-knowledge.tech 站群 · 8 套可切换主题（零构建版）
   --------------------------------------------------------------------------
   给「仓库根目录即发布产物」的站用 —— optical-calculator 那种没有 Vite/React
   的纯静态站。只有一个 <script src="theme.js" defer></script> 就够。

   用法（三行接入）：

     <head>
       <meta name="theme-color" content="#0a0a0a" />
       <script>/* 见 assets/theme-boot.html，首屏防闪必须内联，不能外链 *\/</script>
       <link rel="stylesheet" href="theme-vars.css" />
     </head>
     <body>
       <div id="pk-theme-switcher"></div>   <!-- 放哪就在哪，通常顶栏最右 -->
       <script src="theme.js" defer></script>
     </body>

   与 assets/theme.ts（React 版）契约完全一致，两边可互换：
     ?theme= 优先 → localStorage['pk-theme'] → 默认 dark-teal
   ========================================================================== */
(function () {
  'use strict';

  var KEY = 'pk-theme';
  var DEFAULT_ID = 'dark-teal';

  /* 顺序 = 下拉菜单顺序。dot 只用于菜单里的小色点，取各套主色，
     改主题时不需要动这里 —— 它不参与渲染，只做视觉提示。

     显示名（name）必须与线上各站的 src/theme.ts 逐字一致，否则同一个用户
     在两个站看到的菜单文案不同。2026-11-09 核对 llc-design-tool /
     control-mode / motor-lighting 三处，八项全部相同。 */
  var THEMES = [
    { id: 'dark-teal', name: '深墨 teal', dot: '#14b8a6' },
    { id: 'blue', name: '蓝调浅色', dot: '#0070c0' },
    { id: 'navy-tech', name: '深蓝科技', dot: '#3aa0e8' },
    { id: 'graphite', name: '石墨灰', dot: '#3f4855' },
    { id: 'warm-paper', name: '米白手册', dot: '#9a5b13' },
    { id: 'forest', name: '森林墨绿', dot: '#3fbf7f' },
    { id: 'indigo', name: '靛紫柔光', dot: '#5b4bd6' },
    { id: 'sea-salt', name: '海盐青', dot: '#0e7490' }
  ];

  var IDS = THEMES.map(function (t) { return t.id; });

  /* meta[name=theme-color] 的同步值 = 各套 --color-bg。
     移动端浏览器地址栏会用它，跟主题对不上会有一圈突兀的色边。 */
  var BG = {
    'dark-teal': '#0a0a0a',
    blue: '#f6f7f9',
    'navy-tech': '#0b1a2b',
    graphite: '#f2f3f5',
    'warm-paper': '#faf6ed',
    forest: '#0c1712',
    indigo: '#f6f5fc',
    'sea-salt': '#eef7f7'
  };

  function isThemeId(v) {
    return typeof v === 'string' && IDS.indexOf(v) >= 0;
  }

  /* URL 参数优先于本地存储：方便给人发「带主题的链接」做评审，
     也方便自动化截图逐套比对。 */
  function readInitialTheme() {
    try {
      var q = new URLSearchParams(location.search).get('theme');
      if (isThemeId(q)) return q;
      var s = localStorage.getItem(KEY);
      if (isThemeId(s)) return s;
    } catch (e) { /* 隐私模式 / 禁用存储：静默降级到默认值 */ }
    return DEFAULT_ID;
  }

  var currentId = readInitialTheme();

  /* persist 传 false 表示「只应用、不写盘」。初始化必须传 false ——
     否则打开别人发来的 ?theme= 评审链接，会把收件人自己存的主题永久顶掉。
     切换器点选与外部 PKTheme.applyTheme(id) 仍默认持久化，行为不变。 */
  function applyTheme(id, persist) {
    if (!isThemeId(id)) return;
    currentId = id;
    document.documentElement.dataset.theme = id;
    if (persist !== false) {
      try { localStorage.setItem(KEY, id); } catch (e) {}
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && BG[id]) meta.setAttribute('content', BG[id]);
    /* 给 canvas / SVG 图用：它们不认 CSS 变量，必须靠事件触发重绘。
       订阅方长这样：
         window.addEventListener('pk-theme-change', function (e) { redraw(); }); */
    try {
      window.dispatchEvent(new CustomEvent('pk-theme-change', { detail: id }));
    } catch (e) {
      var ev = document.createEvent('CustomEvent');
      ev.initCustomEvent('pk-theme-change', false, false, id);
      window.dispatchEvent(ev);
    }
    syncSwitcherLabel();
  }

  /* canvas 绘图要用的色值：CSS 变量在这里读不出来，必须解析成具体色值。
     getPropertyValue 在变量未定义时返回空串，所以每项都给兜底。 */
  function readThemeColors() {
    var cs = getComputedStyle(document.documentElement);
    function v(name, fallback) {
      return (cs.getPropertyValue(name) || '').trim() || fallback;
    }
    return {
      grid: v('--color-border', '#404040'),
      frame: v('--color-border-light', '#525252'),
      muted: v('--color-text-muted', '#a3a3a3'),
      secondary: v('--color-text-secondary', '#a3a3a3'),
      accent: v('--color-accent', '#f59e0b'),
      accentLight: v('--color-accent-light', '#fbbf24'),
      /* ← 下面这行按本站命名二选一 */
      primaryLight: v('--color-brand-light', '#14b8a6')
      // primaryLight: v('--color-primary-light', '#14b8a6')
    };
  }

  /* ------------------------------------------------------------------------
     切换器：挂到 #pk-theme-switcher 上。
     一个页面上可能有多处（顶栏一个、移动菜单里一个），全部挂、全部同步。
     没有这个容器就静默跳过 —— 有些站只在页脚放一个 <select>，
     那种情况自己调 applyTheme() 即可，不必强行用本组件。
     ------------------------------------------------------------------------ */
  var mounts = [];

  function buildSwitcher(host) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pk-theme-btn';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', '切换页面配色风格');
    btn.title = '切换页面配色风格';
    btn.innerHTML =
      '<span class="pk-theme-dot" aria-hidden="true"></span>' +
      '<span class="pk-theme-label">风格</span>' +
      '<svg class="pk-theme-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>';

    var menu = document.createElement('div');
    menu.className = 'pk-theme-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    THEMES.forEach(function (t) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'pk-theme-item';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('data-theme-id', t.id);
      item.innerHTML =
        '<span class="pk-theme-dot" style="background:' + t.dot + '" aria-hidden="true"></span>' +
        '<span>' + t.name + '</span>';
      item.addEventListener('click', function () {
        applyTheme(t.id);
        close();
        btn.focus();
      });
      menu.appendChild(item);
    });

    host.appendChild(btn);
    host.appendChild(menu);
    host.classList.add('pk-theme-switcher');

    var open = false;
    function close() {
      open = false;
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      host.classList.remove('open');
    }
    function toggle() {
      open = !open;
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      host.classList.toggle('open', open);
    }

    btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });

    /* 点外面关、Esc 关 —— 两种都要，前者是鼠标习惯，后者是键盘可访问性 */
    document.addEventListener('click', function (e) {
      if (open && !host.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (open && (e.key === 'Escape' || e.key === 'Esc')) { close(); btn.focus(); }
    });

    var inst = { btn: btn, menu: menu, close: close };
    mounts.push(inst);
    return inst;
  }

  function syncSwitcherLabel() {
    if (!mounts.length) return;
    var t = null;
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === currentId) { t = THEMES[i]; break; }
    }
    if (!t) return;
    mounts.forEach(function (inst) {
      var dot = inst.btn.querySelector('.pk-theme-dot');
      if (dot) dot.style.background = t.dot;
      inst.btn.title = '切换页面配色风格（当前：' + t.name + '）';
      var items = inst.menu.querySelectorAll('.pk-theme-item');
      for (var j = 0; j < items.length; j++) {
        var on = items[j].getAttribute('data-theme-id') === currentId;
        items[j].classList.toggle('active', on);
        items[j].setAttribute('aria-checked', String(on));
      }
    });
  }

  function mountAll() {
    var hosts = document.querySelectorAll('#pk-theme-switcher, .pk-theme-switcher:not(.ready)');
    for (var i = 0; i < hosts.length; i++) {
      if (hosts[i].classList.contains('ready')) continue;
      hosts[i].classList.add('ready');
      buildSwitcher(hosts[i]);
    }
    syncSwitcherLabel();
  }

  /* 对外暴露：零构建站也可以直接调 PKTheme.applyTheme('forest') 做联动 */
  window.PKTheme = {
    THEMES: THEMES,
    IDS: IDS,
    BG: BG,
    isThemeId: isThemeId,
    applyTheme: applyTheme,
    readThemeColors: readThemeColors,
    get current() { return currentId; }
  };

  /* 首屏：内联 boot 脚本已经把 data-theme 定好了，这里只同步 meta 与切换器状态，
     重复设置一次 dataset 是幂等的，不用担心闪烁。
     传 false：首屏只应用不写盘，避免 ?theme= 污染 localStorage。 */
  applyTheme(currentId, false);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }
})();
