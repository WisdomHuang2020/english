/* ============================================================================
   留言板前端逻辑（feedback.html / admin.html 共用）
   ----------------------------------------------------------------------------
   与 AHB / control-mode 的 React 版功能对齐，但本站是零构建的多页静态站，
   所以用原生 JS 重写。站点归属由 nginx 的 X-Site 头决定，前端不传。

   三段逻辑靠 DOM 存在性各自启用：
     · #fb-form   → 读者留言表单
     · #fb-admin  → 管理后台（登录 / 初始化 / 列表 / 操作）
     · 其余密码框 → boot() 末尾统一加「小眼睛」
   ========================================================================== */
;(function () {
  'use strict'

  var $ = function (sel, root) { return (root || document).querySelector(sel) }
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)) }

  /* ── 基础工具 ─────────────────────────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  function fmtDate(iso) {
    var d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    var p = function (n) { return n < 10 ? '0' + n : String(n) }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
  }

  /**
   * 统一请求封装。
   * 强制校验 Content-Type：后端没部署时 nginx 的 try_files 会把 /api/* 回落成
   * index.html（200 + HTML），只看 res.ok 会把整页 HTML 当 JSON，
   * 后台则表现为「一条留言都没有」，看起来像数据丢了。
   */
  function api(path, opts) {
    opts = opts || {}
    var init = {
      method: opts.method || 'GET',
      credentials: opts.credentials || 'same-origin',
      headers: { Accept: 'application/json' }
    }
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(opts.body)
    }
    return fetch(path, init).then(function (res) {
      var ct = res.headers.get('content-type') || ''
      return res.text().then(function (text) {
        var data = null
        if (ct.indexOf('application/json') >= 0) {
          try { data = text ? JSON.parse(text) : null } catch (e) { data = null }
        }
        if (!res.ok) {
          throw { status: res.status, message: (data && data.error) || ('请求失败（HTTP ' + res.status + '）') }
        }
        if (data === null) {
          throw { status: 0, message: '接口返回的不是 JSON，可能后端未部署或反向代理未配置' }
        }
        return data
      })
    }, function () {
      throw { status: 0, message: '网络不通，请稍后再试' }
    })
  }

  /* ── 密码框加「小眼睛」 ────────────────────────────────────────────────── */

  var EYE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/>' +
    '<circle cx="12" cy="12" r="3"/></svg>'
  var EYE_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>' +
    '<path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>' +
    '<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="m2 2 20 20"/></svg>'

  function enhancePassword(inp) {
    if (!inp || inp.getAttribute('data-pw') === '1') return
    inp.setAttribute('data-pw', '1')

    var wrap = document.createElement('span')
    wrap.className = 'fb-pw'
    inp.parentNode.insertBefore(wrap, inp)
    wrap.appendChild(inp)

    var btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'fb-pw-eye'
    btn.setAttribute('aria-label', '显示密码')
    btn.setAttribute('title', '显示密码')
    btn.setAttribute('aria-pressed', 'false')
    btn.innerHTML = EYE

    btn.addEventListener('click', function () {
      var show = inp.type === 'password'
      inp.type = show ? 'text' : 'password'
      btn.innerHTML = show ? EYE_OFF : EYE
      var label = show ? '隐藏密码' : '显示密码'
      btn.setAttribute('aria-label', label)
      btn.setAttribute('title', label)
      btn.setAttribute('aria-pressed', show ? 'true' : 'false')
    })

    wrap.appendChild(btn)
  }

  /* ── 读者留言表单 ─────────────────────────────────────────────────────── */

  function initFeedback() {
    var form = $('#fb-form')
    if (!form) return

    var content = $('#fb-content')
    var count = $('#fb-count')
    var submit = $('#fb-submit')
    var alertBox = $('#fb-alert')
    var pageSel = $('#fb-page')
    var contact = $('#fb-contact')
    var honeypot = $('#fb-website')
    var MAX = 4000
    var MIN = 10

    function show(kind, text) {
      if (!alertBox) return
      alertBox.className = 'fb-alert ' + kind
      alertBox.textContent = text
      alertBox.hidden = false
    }

    function sync() {
      var n = content.value.length
      if (count) count.textContent = n + ' / ' + MAX
      var ok = n >= MIN && n <= MAX
      if (submit) submit.disabled = !ok
    }

    content.addEventListener('input', sync)
    sync()

    // 草稿本地留存：写长留言时误刷新不至于全丢
    var DRAFT = 'pk-fb-draft-english'
    try {
      var saved = localStorage.getItem(DRAFT)
      if (saved) {
        var o = JSON.parse(saved)
        if (o.c) content.value = o.c
        if (o.p && pageSel) pageSel.value = o.p
        if (o.m && contact) contact.value = o.m
        sync()
      }
    } catch (e) {}

    function saveDraft() {
      try {
        localStorage.setItem(DRAFT, JSON.stringify({
          c: content.value,
          p: pageSel ? pageSel.value : '',
          m: contact ? contact.value : ''
        }))
      } catch (e) {}
    }

    content.addEventListener('input', saveDraft)
    if (contact) contact.addEventListener('input', saveDraft)
    if (pageSel) pageSel.addEventListener('change', saveDraft)

    form.addEventListener('submit', function (e) {
      e.preventDefault()
      if (submit) { submit.disabled = true; submit.textContent = '提交中…' }
      api('/api/feedback', {
        method: 'POST',
        body: {
          page: pageSel ? pageSel.value : '未指定',
          content: content.value.trim(),
          contact: contact ? contact.value.trim() : '',
          // 蜜罐：正常用户看不到这个字段，填了说明是机器人
          website: honeypot ? honeypot.value : ''
        }
      }).then(function () {
        show('ok', '已提交，谢谢。作者会在后台看到，若留了联系方式会回复你。')
        content.value = ''
        if (contact) contact.value = ''
        try { localStorage.removeItem(DRAFT) } catch (e) {}
        sync()
      }).catch(function (err) {
        show('err', (err && err.message) || '提交失败')
      }).then(function () {
        if (submit) { submit.disabled = false; submit.textContent = '提交' }
        sync()
      })
    })
  }

  /* ── 管理后台 ─────────────────────────────────────────────────────────── */

  function initAdmin() {
    var root = $('#fb-admin')
    if (!root) return

    var loginCard = $('#fb-login-card')
    var setupCard = $('#fb-setup-card')
    var panel = $('#fb-panel')
    var alertBox = $('#fb-alert')
    var listBox = $('#fb-list')
    var whoBox = $('#fb-who')
    var filters = $('#fb-filters')

    var state = { filter: 'all', items: [] }

    function show(kind, text) {
      if (!alertBox) return
      alertBox.className = 'fb-alert ' + kind
      alertBox.textContent = text
      alertBox.hidden = false
    }
    function clearAlert() { if (alertBox) alertBox.hidden = true }

    function view(name) {
      if (loginCard) loginCard.hidden = name !== 'login'
      if (setupCard) setupCard.hidden = name !== 'setup'
      if (panel) panel.hidden = name !== 'panel'
    }

    /* 登录 */
    var loginForm = $('#fb-login-form')
    if (loginForm) {
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault()
        clearAlert()
        var btn = $('#fb-login-submit')
        if (btn) { btn.disabled = true; btn.textContent = '登录中…' }
        api('/api/admin/login', {
          method: 'POST',
          body: { username: $('#fb-username').value.trim(), password: $('#fb-password').value }
        }).then(function () {
          return load()
        }).catch(function (err) {
          if (err && err.status === 503) {
            view('setup')
            show('err', '本站还没初始化管理员，请先在服务器生成令牌并在此设定密码。')
          } else {
            show('err', (err && err.message) || '登录失败')
          }
        }).then(function () {
          if (btn) { btn.disabled = false; btn.textContent = '登录' }
        })
      })
    }

    /* 首次初始化：令牌 + 账号 + 密码 + 再输一次 */
    var setupForm = $('#fb-setup-form')
    if (setupForm) {
      var pw2 = $('#fb-setup-password2')
      var warn = $('#fb-setup-warn')
      function checkMatch() {
        var a = $('#fb-setup-password').value
        var b = pw2.value
        var bad = b.length > 0 && a !== b
        if (warn) {
          warn.textContent = bad ? '两次输入不一致' : ''
          warn.hidden = !bad
        }
        var sb = $('#fb-setup-submit')
        if (sb) sb.disabled = bad || !a || a.length < 8 || !b
      }
      $('#fb-setup-password').addEventListener('input', checkMatch)
      pw2.addEventListener('input', checkMatch)
      checkMatch()

      setupForm.addEventListener('submit', function (e) {
        e.preventDefault()
        clearAlert()
        var a = $('#fb-setup-password').value
        if (a !== pw2.value) { show('err', '两次输入的密码不一致'); return }
        var btn = $('#fb-setup-submit')
        if (btn) { btn.disabled = true; btn.textContent = '提交中…' }
        api('/api/admin/setup', {
          method: 'POST',
          body: {
            token: $('#fb-setup-token').value.trim(),
            username: $('#fb-setup-username').value.trim(),
            password: a
          }
        }).then(function () {
          return api('/api/admin/login', {
            method: 'POST',
            body: { username: $('#fb-setup-username').value.trim(), password: a }
          })
        }).then(function () {
          return load()
        }).catch(function (err) {
          show('err', (err && err.message) || '初始化失败')
        }).then(function () {
          if (btn) { btn.disabled = false; btn.textContent = '设定并登录' }
        })
      })
    }

    /* 改密码：当前 + 新 + 再输一次 */
    var pwForm = $('#fb-pw-form')
    if (pwForm) {
      var pwNew2 = $('#fb-pw-new2')
      var pwWarn = $('#fb-pw-warn')
      function checkNew() {
        var a = $('#fb-pw-new').value
        var b = pwNew2.value
        var bad = b.length > 0 && a !== b
        if (pwWarn) { pwWarn.textContent = bad ? '两次输入不一致' : ''; pwWarn.hidden = !bad }
        var sb = $('#fb-pw-submit')
        if (sb) sb.disabled = bad || !a || a.length < 8 || !b || !$('#fb-pw-current').value
      }
      $('#fb-pw-new').addEventListener('input', checkNew)
      $('#fb-pw-current').addEventListener('input', checkNew)
      pwNew2.addEventListener('input', checkNew)
      checkNew()

      pwForm.addEventListener('submit', function (e) {
        e.preventDefault()
        clearAlert()
        var a = $('#fb-pw-new').value
        if (a !== pwNew2.value) { show('err', '两次输入的新密码不一致'); return }
        // 参数名必须与后端一致：currentPassword / newPassword。
        // 写成 current / next 会静默变成空串，后端一律报「当前密码不正确」。
        api('/api/admin/password', {
          method: 'POST',
          body: { currentPassword: $('#fb-pw-current').value, newPassword: a }
        }).then(function () {
          show('ok', '密码已修改。其它设备上的旧会话已失效。')
          pwForm.reset()
          checkNew()
        }).catch(function (err) {
          show('err', (err && err.message) || '修改失败')
        })
      })
    }

    /* 退出 */
    var logoutBtn = $('#fb-logout')
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        api('/api/admin/logout', { method: 'POST' }).then(function () {
          view('login')
        }).catch(function () { view('login') })
      })
    }

    /* 筛选 */
    if (filters) {
      filters.addEventListener('click', function (e) {
        var b = e.target.closest('.fb-filter')
        if (!b) return
        state.filter = b.getAttribute('data-f')
        $$('.fb-filter', filters).forEach(function (x) {
          x.setAttribute('aria-pressed', String(x === b))
        })
        render()
      })
    }

    function countOf() {
      var c = { all: state.items.length, new: 0, read: 0, archived: 0 }
      state.items.forEach(function (m) {
        if (c[m.status] !== undefined) c[m.status]++
      })
      return c
    }

    function render() {
      if (!listBox) return
      var c = countOf()
      $$('.fb-filter', filters).forEach(function (b) {
        var k = b.getAttribute('data-f')
        var label = b.getAttribute('data-label') || b.textContent
        b.textContent = label + ' ' + (c[k] || 0)
      })

      var items = state.filter === 'all'
        ? state.items
        : state.items.filter(function (m) { return m.status === state.filter })

      if (!items.length) {
        listBox.innerHTML = '<li class="fb-empty">' +
          (state.items.length ? '这个分类下没有留言' : '还没有收到留言') + '</li>'
        return
      }

      listBox.innerHTML = items.map(function (m) {
        var st = m.status === 'new' ? '待读' : m.status === 'read' ? '已读' : '已归档'
        return '<li class="fb-item" data-status="' + esc(m.status) + '">' +
          '<div class="fb-item-head">' +
            '<b>' + esc(m.page || '未指定') + '</b>' +
            '<span class="fb-status" data-s="' + esc(m.status) + '">' + st + '</span>' +
            '<span class="fb-item-meta">' + fmtDate(m.created_at) + (m.contact ? ' · ' + esc(m.contact) : '') + '</span>' +
          '</div>' +
          '<p class="fb-body">' + esc(m.content) + '</p>' +
          '<div class="fb-item-foot">' +
            (m.status !== 'read' ? '<button class="fb-mini" data-act="read" data-id="' + m.id + '">标为已读</button>' : '') +
            (m.status !== 'archived' ? '<button class="fb-mini" data-act="archive" data-id="' + m.id + '">归档</button>' : '') +
            '<button class="fb-mini danger" data-act="del" data-id="' + m.id + '">删除</button>' +
          '</div>' +
        '</li>'
      }).join('')
    }

    if (listBox) {
      listBox.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]')
        if (!b) return
        var id = b.getAttribute('data-id')
        var act = b.getAttribute('data-act')
        if (act === 'del') {
          if (!window.confirm('确定删除这条留言？不可恢复。')) return
          api('/api/admin/messages/' + id, { method: 'DELETE' })
            .then(load).catch(function (err) { show('err', err.message || '删除失败') })
          return
        }
        var status = act === 'read' ? 'read' : 'archived'
        api('/api/admin/messages/' + id, { method: 'PATCH', body: { status: status } })
          .then(load).catch(function (err) { show('err', err.message || '操作失败') })
      })
    }

    function load() {
      return api('/api/admin/me', { credentials: 'include' }).then(function (me) {
        if (whoBox) whoBox.textContent = '已登录：' + me.username
        view('panel')
        return api('/api/admin/messages', { credentials: 'include' })
      }).then(function (data) {
        clearAlert()
        // 接口返回 { items, total, counts }，不是 messages —— 写错会让后台永远显示空列表
        state.items = (data && data.items) || []
        render()
      })
    }

    // 首屏探会话：已登录直接进面板，未登录显示登录卡
    api('/api/admin/me', { credentials: 'include' })
      .then(load)
      .catch(function (err) {
        if (err && err.status === 503) {
          view('setup')
          show('err', '本站还没初始化管理员。在服务器上运行 init-site.mjs 生成令牌，再填入下面的表单。')
        } else {
          view('login')
        }
      })
  }

  /* ── 启动 ─────────────────────────────────────────────────────────────── */

  function boot() {
    initFeedback()
    initAdmin()
    // 放在两个 init 之后：它们可能刚把某个卡片从 hidden 切成可见，
    // 此时节点一定已经在 DOM 里，否则会漏掉刚显示出来的密码框。
    $$('input[type="password"]').forEach(enhancePassword)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
