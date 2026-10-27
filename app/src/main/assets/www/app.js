(function () {
  var $ = function (id) { return document.getElementById(id); };
  function quitApp() {
    try { NaibarAndroid.exit(); return; } catch (err) {}
    try { window.close(); } catch (err2) {}
  }
  var K = { L: 37, U: 38, R: 39, D: 40, OK: 13, BACK: 461, CHUP: 427, CHDN: 428, PGUP: 33, PGDN: 34, PLAY: 415, PAUSE: 19, STOP: 413, RW: 412, FF: 417 };
  var SCREENS = ['plist', 'form', 'home', 'browse'];
  var MODES = {
    live:   { name: 'Live TV', cats: 'get_live_categories',   items: 'get_live_streams' },
    movie:  { name: 'Movies',  cats: 'get_vod_categories',    items: 'get_vod_streams' },
    series: { name: 'Series',  cats: 'get_series_categories', items: 'get_series' }
  };
  var MODE_KEYS = ['live', 'movie', 'series'];
  var ASP = [{ n: 'Fit', c: 'contain', w: 1280 }, { n: 'Fill', c: 'cover', w: 1280 }, { n: 'Stretch', c: 'fill', w: 1280 }, { n: '4:3', c: 'fill', w: 960 }];
  var VIRT = [{ category_id: '__search', category_name: 'Search' }, { category_id: '__all', category_name: 'All' },
              { category_id: '__fav', category_name: 'Favorites' }, { category_id: '__recent', category_name: 'Recently watched' }];

  var video = $('video'), screen = 'plist', token = 0, osdTimer = null, barTimer = null, lastSave = 0;
  var pls = [], plSel = 0, editIdx = -1, cfg = null, base = '', info = null, cache = { cats: {} };
  var homeSel = 0, mode = 'live', view = 'browse', pane = 0, favs = {};
  var B = { left: [], ls: 0, right: [], rs: 0 }, E = { left: [], ls: 0, right: [], rs: 0 };
  var P = { list: [], idx: 0, kind: 'live', ts: false, series: '', resume: 0, epgText: '', epgFrac: 0, epgTimes: '' };
  var pState = 'none', btns = [], btnSel = 0, chSel = 0, aspIdx = 0;
  var formFields = [], formIdx = 0;

  function store(k, v) { try { if (v === undefined) { return localStorage.getItem(k); } localStorage.setItem(k, v); } catch (e) {} return null; }
  function enc(s) { return encodeURIComponent(s); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clamp(v, n) { return Math.max(0, Math.min(n - 1, v)); }
  function S() { return view === 'browse' ? B : E; }
  var tb = -1, lastBack = 0;
  function topIds() {
    var a = [];
    if (screen === 'home') { return ['hmBack']; }
    if (view === 'browse') { a.push('nbView'); }
    a.push('nbBack', 'nbHome'); return a;
  }
  function refreshTb() {
    var els = document.getElementsByClassName('nb'), i, ids = topIds();
    if (tb >= ids.length) { tb = ids.length - 1; }
    for (i = 0; i < els.length; i++) { els[i].className = 'nb'; }
    if (tb >= 0) { $(ids[tb]).className = 'nb focus'; }
  }
  function setTb(i) { tb = i; refreshTb(); }
  function go(name) {
    var i;
    try { if (document.activeElement && document.activeElement !== document.body) { document.activeElement.blur(); } } catch (err) {}
    for (i = 0; i < SCREENS.length; i++) { $(SCREENS[i]).style.display = SCREENS[i] === name ? 'block' : 'none'; }
    $('searchBox').style.display = 'none'; video.style.display = 'none'; screen = name;
    tb = -1; refreshTb();
  }
  function osd(t, ms) {
    var o = $('osd'); o.textContent = t; o.style.display = 'block';
    clearTimeout(osdTimer); osdTimer = setTimeout(function () { o.style.display = 'none'; }, ms || 2500);
  }
  function msg(t, ok) { $('browseMsg').style.color = ok ? '#8fa3c0' : '#ff7b7b'; $('browseMsg').textContent = t; }
  function b64(s) { try { return decodeURIComponent(escape(atob(s))); } catch (e) { return ''; } }
  function hm(ts) { var d = new Date(ts * 1000); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmt(s) {
    if (!s || isNaN(s) || s === Infinity) { return '0:00'; }
    s = Math.floor(s); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(x);
  }

  /* ---------- api ---------- */
  function api(action, extra, cb) {
    var url = base + '/player_api.php?username=' + enc(cfg.user) + '&password=' + enc(cfg.pass) +
      (action ? '&action=' + action : '') + (extra || '');
    var x = new XMLHttpRequest();
    x.open('GET', url, true); x.timeout = 60000;
    x.onload = function () {
      if (x.status !== 200) { cb('Server error ' + x.status); return; }
      try { cb(null, JSON.parse(x.responseText)); } catch (e) { cb('Invalid server response'); }
    };
    x.onerror = function () { cb('Cannot reach server'); };
    x.ontimeout = function () { cb('Server timed out'); };
    x.send();
  }
  function ensureAll(cb) {
    if (cache[mode]) { cb(null, cache[mode]); return; }
    api(MODES[mode].items, '', function (err, d) {
      if (err) { cb(err); return; }
      cache[mode] = d || []; cb(null, cache[mode]);
    });
  }

  /* ---------- favorites, recent, resume ---------- */
  function pid(it) { return String(it.series_id || it.stream_id); }
  function acc() { return cfg.user + '@' + cfg.host; }
  function readJson(k, def) { try { return JSON.parse(store(k) || def); } catch (e) { return JSON.parse(def); } }
  function getFavs(m) { return readJson('xtv_fav_' + m + '_' + acc(), '{}'); }
  function toggleFav(m, it) {
    var f = getFavs(m), id = pid(it);
    if (f[id]) { delete f[id]; } else { f[id] = 1; }
    store('xtv_fav_' + m + '_' + acc(), JSON.stringify(f)); return !!f[id];
  }
  function getRec(m) { return readJson('xtv_rec_' + m + '_' + acc(), '[]'); }
  function addRec(m, it) {
    var a = getRec(m), id = pid(it), i;
    for (i = a.length - 1; i >= 0; i--) { if (pid(a[i]) === id) { a.splice(i, 1); } }
    a.unshift(it); store('xtv_rec_' + m + '_' + acc(), JSON.stringify(a.slice(0, 30)));
  }
  function posKey() { var it = P.list[P.idx]; return 'xtv_pos_' + acc() + '_' + P.kind + '_' + (it.id || it.stream_id); }

  /* ---------- lists ---------- */
  function renderList(el, items, sel, active, label, cls, icon, pick) {
    var rows = icon ? 7 : 10, i, d, im, u, start = Math.max(0, Math.min(sel - Math.floor(rows / 2), items.length - rows));
    el.innerHTML = '';
    for (i = start; i < Math.min(items.length, start + rows); i++) {
      d = document.createElement('div');
      d.className = 'row' + (icon ? ' ic' : '') + (i === sel ? ' sel' : '') + (i === sel && active ? ' act' : '') + (cls && cls(items[i]) ? ' fav' : '');
      if (icon) {
        im = document.createElement('img'); im.className = 'pic'; u = icon(items[i]);
        im.onerror = function () { this.style.visibility = 'hidden'; };
        if (u) { im.src = u; } else { im.style.visibility = 'hidden'; }
        d.appendChild(im);
      }
      d.appendChild(document.createTextNode(label(items[i], i)));
      if (pick) { d.onclick = (function (n) { return function () { pick(n); }; })(i); }
      el.appendChild(d);
    }
  }
  function iconOf(c) {
    var u = c.stream_icon || c.cover || (c.info && (c.info.movie_image || c.info.cover_big)) || '';
    return /^https?:\/\//i.test(u) ? u : '';
  }
  var COLS = 5;
  function gridOn() {
    var v = store('xtv_grid_' + mode);
    if (v === null || v === undefined) { v = mode === 'live' ? '0' : '1'; }
    return v === '1';
  }
  function isGrid() { return view === 'browse' && gridOn(); }
  function toggleGrid() {
    if (view !== 'browse') { return; }
    store('xtv_grid_' + mode, gridOn() ? '0' : '1'); renderBrowse();
    osd(gridOn() ? 'Tiles view' : 'List view');
  }
  function toggleCurrentFav() {
    var s = S(), f;
    if (view !== 'browse' || !s.right[s.rs]) { return; }
    f = toggleFav(mode, s.right[s.rs]); favs = getFavs(mode); osd(f ? 'Added to favorites' : 'Removed from favorites');
    if (B.left[B.ls].category_id === '__fav') { loadItems(); pane = 1; }
  }
  function renderGrid(el, items, sel, active, pick) {
    var selRow = Math.floor(sel / COLS), total = Math.ceil(items.length / COLS),
        first = Math.max(0, Math.min(selRow - 1, total - 2)), i, d, im, u, end = Math.min(items.length, (first + 2) * COLS);
    el.innerHTML = '';
    for (i = first * COLS; i < end; i++) {
      d = document.createElement('div');
      d.className = 'gt' + (i === sel ? ' sel' : '') + (i === sel && active ? ' act' : '') + (favs[pid(items[i])] ? ' fav' : '');
      im = document.createElement('img'); im.className = 'gp'; u = iconOf(items[i]);
      im.onerror = function () { this.style.visibility = 'hidden'; };
      if (u) { im.src = u; } else { im.style.visibility = 'hidden'; }
      d.appendChild(im);
      u = document.createElement('div'); u.className = 'gn'; u.textContent = items[i].name || ''; d.appendChild(u);
      if (pick) { d.onclick = (function (n) { return function () { pick(n); }; })(i); }
      el.appendChild(d);
    }
  }
  function activateRight() {
    if (view === 'episodes') { play(E.right, E.rs, 'ep'); }
    else if (mode === 'series') { if (B.right[B.rs]) { openSeries(B.right[B.rs]); } }
    else if (B.right[B.rs]) { play(B.right, B.rs, mode); }
  }
  function pickLeft(i) {
    var s = S();
    setTb(-1); s.ls = i; pane = 0;
    if (view === 'browse') {
      renderBrowse();
      if (B.left[i].category_id === '__search') { openSearch(); } else { askAdult = true; loadItems(); askAdult = false; }
    } else { s.right = s.left[i].eps; s.rs = 0; renderBrowse(); }
  }
  function pickRight(i) {
    var s = S();
    setTb(-1); s.rs = i; pane = 1; renderBrowse(); activateRight();
  }
  function renderBrowse() {
    var s = S();
    $('nbView').style.display = view === 'browse' ? 'inline-block' : 'none';
    $('nbView').textContent = gridOn() ? 'List view' : 'Tiles view';
    refreshTb();
    renderList($('leftList'), s.left, s.ls, tb < 0 && pane === 0, function (c) { return view === 'browse' ? c.category_name + (lockedCat(c) ? '  (locked)' : '') : 'Season ' + c.n; }, null, null, pickLeft);
    if (isGrid()) { renderGrid($('rightList'), s.right, s.rs, tb < 0 && pane === 1, pickRight); return; }
    renderList($('rightList'), s.right, s.rs, tb < 0 && pane === 1, function (c, i) {
      if (view === 'browse') { return (mode === 'live' ? (i + 1) + '   ' : '') + c.name; }
      return (c.episode_num ? c.episode_num + '. ' : '') + (c.title || 'Episode');
    }, function (c) { return view === 'browse' && favs[pid(c)]; }, iconOf, pickRight);
  }
  function renderPl() {
    renderList($('plList'), pls.concat([{ name: '+ Add playlist' }]), plSel, true, function (p) { return p.name; }, null, null, function (i) { plSel = i; if (i >= pls.length) { openForm(-1); } else { openPlaylist(pls[i]); } });
  }

  /* ---------- playlists ---------- */
  function loadPls() { pls = readJson('xtv_pls', '[]'); }
  function savePls() { store('xtv_pls', JSON.stringify(pls)); }
  function normHost(h) {
    h = h.replace(/^\s+|\s+$/g, '').replace(/\/+$/, '');
    if (h && !/^https?:\/\//i.test(h)) { h = 'http://' + h; }
    return h;
  }
  function showPlaylists() { go('plist'); plSel = Math.min(plSel, pls.length); renderPl(); }
  function openForm(i) {
    editIdx = i;
    var p = i >= 0 ? pls[i] : { name: '', host: '', user: '', pass: '' };
    $('formTitle').textContent = i >= 0 ? 'Edit playlist' : (pls.length ? 'Add playlist' : 'Add your first playlist');
    $('welcome').textContent = (i < 0 && !pls.length) ? 'Welcome! Add your playlist to start watching.' : '';
    $('fName').value = p.name; $('fHost').value = p.host; $('fUser').value = p.user; $('fPass').value = p.pass;
    $('bDelete').style.display = i >= 0 ? 'inline-block' : 'none';
    formFields = ['fName', 'fHost', 'fUser', 'fPass', 'bSave'].concat(i >= 0 ? ['bDelete'] : []).concat(['bCancel']);
    go('form'); curForm(0);
  }
  function curForm(i) {
    var n;
    formIdx = i;
    for (n = 0; n < formFields.length; n++) { $(formFields[n]).classList.remove('cur'); }
    $(formFields[i]).classList.add('cur');
  }
  function saveForm() {
    var p = { name: $('fName').value, host: normHost($('fHost').value), user: $('fUser').value, pass: $('fPass').value };
    if (!p.host || !p.user || !p.pass) { return; }
    if (!p.name) { p.name = p.host.replace(/^https?:\/\//, ''); }
    if (editIdx >= 0) { pls[editIdx] = p; } else { pls.push(p); plSel = pls.length - 1; }
    savePls(); showPlaylists();
  }
  function openPlaylist(p) {
    cfg = p; base = p.host; cache = { cats: {} };
    $('plMsg').style.color = '#8fa3c0'; $('plMsg').textContent = 'Connecting...';
    api('', '', function (err, d) {
      $('plMsg').style.color = '#ff7b7b';
      if (err) { $('plMsg').textContent = err; return; }
      if (!d || !d.user_info || String(d.user_info.auth) !== '1') { $('plMsg').textContent = 'Login rejected. Edit the playlist and check the username and password.'; return; }
      $('plMsg').textContent = ''; info = d.user_info; $('homeTitle').textContent = p.name; showHome();
    });
  }

  /* ---------- dashboard ---------- */
  function tick() {
    var d = new Date(); $('clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function showHome() {
    unlocked = false; go('home'); tick();
    var u = info || {}, e = u.exp_date ? new Date(u.exp_date * 1000) : null, t = $('tiles').children, i;
    $('acct').textContent = 'Expires: ' + (e ? e.getDate() + '/' + (e.getMonth() + 1) + '/' + e.getFullYear() : 'Unlimited') +
      '     Connections: ' + (u.active_cons || 0) + '/' + (u.max_connections || '?');
    for (i = 0; i < t.length; i++) { t[i].className = t[i].className.replace(' sel', '') + (i === homeSel ? ' sel' : ''); }
  }
  setInterval(tick, 30000);

  /* ---------- browse ---------- */
  function openMode(m) {
    mode = m; view = 'browse'; pane = 0; B.left = []; B.right = []; B.ls = 0; B.rs = 0;
    go('browse'); $('leftTitle').textContent = MODES[m].name; $('rightTitle').textContent = '';
    msg('Loading...', true); renderBrowse();
    function ready(real) {
      B.left = VIRT.concat(real); B.ls = real.length ? VIRT.length : 1;
      msg(''); renderBrowse(); loadItems();
    }
    if (cache.cats[m]) { ready(cache.cats[m]); return; }
    api(MODES[m].cats, '', function (err, d) {
      if (err) { msg(err); return; }
      cache.cats[m] = d || []; ready(cache.cats[m]);
    });
  }
  /* ---------- parental lock ---------- */
  var ADULT_RE = /adult|xxx|porn|erotic|\+\s?18|18\s?\+|\bsex\b|للكبار|اباح|إباح|بالغين/i;
  var unlocked = false, askAdult = false;
  var PADKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Cancel', '0', 'Delete'];
  var pin = { val: '', mode: 'verify', sel: 10, items: [], acts: [], ok: null, cancel: null, prev: 'home', first: '' };
  function lockOn() { return store('xtv_lock') !== '0'; }
  function getPin() { return store('xtv_pin') || '0000'; }
  function isAdultCat(c) { return ADULT_RE.test((c && c.category_name) || ''); }
  function lockedCat(c) { return lockOn() && !unlocked && isAdultCat(c); }
  function hideAdult(list) {
    var ids = {}, a = cache.cats[mode] || [], r = [], i;
    if (!lockOn() || unlocked) { return list; }
    for (i = 0; i < a.length; i++) { if (isAdultCat(a[i])) { ids[a[i].category_id] = 1; } }
    for (i = 0; i < list.length; i++) { if (!ids[list[i].category_id]) { r.push(list[i]); } }
    return r;
  }
  function pinDraw() {
    var d = $('pinDots'), k = $('pinKeys'), i, x, items = pin.mode === 'menu' ? pin.items : PADKEYS;
    d.innerHTML = '';
    if (pin.mode !== 'menu') { for (i = 0; i < 4; i++) { x = document.createElement('span'); x.className = 'dot' + (i < pin.val.length ? ' f' : ''); d.appendChild(x); } }
    k.innerHTML = '';
    for (i = 0; i < items.length; i++) {
      x = document.createElement('div'); x.className = 'pk' + (pin.mode === 'menu' ? ' wide' : '') + (i === pin.sel ? ' on' : ''); x.textContent = items[i];
      x.onclick = (function (n) { return function () { pin.sel = n; pinPress(n); }; })(i);
      k.appendChild(x);
    }
  }
  function pinMsg(t, ok) { $('pinMsg').style.color = ok ? '#9aa3b8' : '#ff8a7a'; $('pinMsg').textContent = t; }
  function askPin(title, okFn, cancelFn, mode) {
    pin = { val: '', mode: mode || 'verify', sel: 10, items: [], acts: [], ok: okFn, cancel: cancelFn, prev: screen === 'pin' ? pin.prev : screen, first: '' };
    $('pinTitle').textContent = title;
    pinMsg(pin.mode === 'verify' && !store('xtv_pin') ? 'Default PIN: 0000' : '', true);
    pinDraw(); $('pinBox').style.display = 'block'; screen = 'pin';
  }
  function closePin(ok) {
    var f = ok ? pin.ok : pin.cancel;
    $('pinBox').style.display = 'none'; screen = pin.prev;
    if (f) { f(); }
  }
  function pinSubmit() {
    var v = pin.val;
    if (pin.mode === 'verify') {
      if (v === getPin()) { closePin(true); } else { pin.val = ''; pinMsg('Wrong PIN. Try again.'); pinDraw(); }
    } else if (pin.mode === 'new') {
      pin.first = v; pin.val = ''; pin.mode = 'confirm'; $('pinTitle').textContent = 'Confirm new PIN'; pinMsg(''); pinDraw();
    } else if (pin.mode === 'confirm') {
      if (v === pin.first) { store('xtv_pin', v); closePin(false); osd('PIN changed'); }
      else { pin.val = ''; pin.mode = 'new'; $('pinTitle').textContent = 'Enter new PIN'; pinMsg('PINs did not match. Try again.'); pinDraw(); }
    }
  }
  function pinDigit(dg) {
    if (pin.mode === 'menu' || pin.val.length >= 4) { return; }
    pin.val += dg; pinDraw();
    if (pin.val.length === 4) { setTimeout(pinSubmit, 150); }
  }
  function pinPress(n) {
    var key;
    if (pin.mode === 'menu') { pin.acts[n](); return; }
    key = PADKEYS[n];
    if (key === 'Cancel') { closePin(false); }
    else if (key === 'Delete') { pin.val = pin.val.slice(0, -1); pinDraw(); }
    else { pinDigit(key); }
  }
  function openLockMenu() {
    pin.mode = 'menu'; pin.sel = 0; pin.val = ''; $('pinTitle').textContent = 'Parental control'; pinMsg(lockOn() ? 'Adult categories are locked.' : 'Adult categories are open.', true);
    pin.items = [lockOn() ? 'Turn lock off' : 'Turn lock on', 'Change PIN', 'Close'];
    pin.acts = [
      function () { store('xtv_lock', lockOn() ? '0' : '1'); unlocked = false; closePin(false); osd(lockOn() ? 'Lock is on' : 'Lock is off'); },
      function () { pin.mode = 'new'; pin.val = ''; pin.sel = 10; $('pinTitle').textContent = 'Enter new PIN'; pinMsg(''); pinDraw(); },
      function () { closePin(false); }
    ];
    pinDraw();
  }
  function homeAction(n) {
    if (n < 3) { openMode(MODE_KEYS[n]); }
    else if (n === 3) { cache = { cats: {} }; osd('Reloaded. Lists will refresh when opened.'); }
    else if (n === 4) { askPin('Enter PIN for parental control', openLockMenu, null); }
    else { quitApp(); }
  }
  function loadItems() {
    var t = ++token, c = B.left[B.ls], id = c.category_id;
    B.right = []; B.rs = 0; favs = getFavs(mode);
    $('rightTitle').textContent = c.category_name; renderBrowse();
    if (id.charAt(0) !== '_' && lockedCat(c)) {
      if (askAdult) {
        askAdult = false;
        askPin('Enter PIN to open this category', function () { unlocked = true; renderBrowse(); loadItems(); }, function () { msg('Locked category. Press OK and enter your PIN.', true); });
      } else { msg('Locked category. Press OK and enter your PIN.', true); }
      return;
    }
    function done(list) {
      if (t !== token) { return; }
      B.right = list; msg(list.length ? '' : 'Nothing here yet.'); renderBrowse();
    }
    if (id === '__search') { msg('Press OK to search', true); return; }
    if (id === '__recent') { done(hideAdult(getRec(mode))); return; }
    msg('Loading...', true);
    if (id === '__all' || id === '__fav') {
      ensureAll(function (err, all) {
        var r = [], i;
        if (t !== token) { return; }
        if (err) { msg(err); return; }
        if (id === '__all') { done(hideAdult(all)); return; }
        for (i = 0; i < all.length; i++) { if (favs[pid(all[i])]) { r.push(all[i]); } }
        done(hideAdult(r));
      });
      return;
    }
    api(MODES[mode].items, '&category_id=' + enc(id), function (err, d) {
      if (t !== token) { return; }
      if (err) { msg(err); return; }
      done(d || []);
    });
  }
  function openSearch() {
    screen = 'search'; $('searchBox').style.display = 'block'; $('searchInput').value = ''; $('searchInput').focus();
  }
  function closeSearch() { $('searchBox').style.display = 'none'; $('searchInput').blur(); screen = 'browse'; }
  function runSearch() {
    var q = $('searchInput').value.toLowerCase().replace(/^\s+|\s+$/g, ''), t = ++token;
    if (!q) { return; }
    closeSearch(); msg('Searching...', true);
    ensureAll(function (err, all) {
      var r = [], i;
      if (t !== token) { return; }
      if (err) { msg(err); return; }
      for (i = 0; i < all.length && r.length < 500; i++) { if ((all[i].name || '').toLowerCase().indexOf(q) > -1) { r.push(all[i]); } }
      r = hideAdult(r); B.right = r; B.rs = 0; pane = r.length ? 1 : 0; favs = getFavs(mode);
      $('rightTitle').textContent = 'Search: ' + q; msg(r.length ? '' : 'No results.', !r.length); renderBrowse();
    });
  }
  function openSeries(item) {
    addRec('series', item); msg('Loading episodes...', true);
    api('get_series_info', '&series_id=' + enc(item.series_id), function (err, d) {
      var eps = (d && d.episodes) || {}, keys = [], k, seasons = [], i;
      if (err) { msg(err); return; }
      for (k in eps) { if (eps.hasOwnProperty(k)) { keys.push(k); } }
      keys.sort(function (a, b) { return a - b; });
      for (i = 0; i < keys.length; i++) { if (eps[keys[i]] && eps[keys[i]].length) { seasons.push({ n: keys[i], eps: eps[keys[i]] }); } }
      if (!seasons.length) { msg('No episodes found.'); return; }
      msg(''); P.series = item.name; E.left = seasons; E.ls = 0; E.right = seasons[0].eps; E.rs = 0;
      view = 'episodes'; pane = 1;
      $('leftTitle').textContent = item.name; $('rightTitle').textContent = 'Episodes'; renderBrowse();
    });
  }

  /* ---------- player ---------- */
  function itemName(it) {
    if (P.kind === 'ep') {
      if (it.title && /S\d+\s*E\d+/i.test(it.title)) { return it.title; }
      return P.series + '  S' + E.left[E.ls].n + 'E' + (it.episode_num || '?') + (it.title ? '  ' + it.title : '');
    }
    return it.name;
  }
  function itemUrl(it, ext) {
    var c = enc(cfg.user) + '/' + enc(cfg.pass) + '/';
    if (P.kind === 'live') { return base + '/live/' + c + it.stream_id + '.' + (ext || 'm3u8'); }
    if (P.kind === 'movie') { return base + '/movie/' + c + it.stream_id + '.' + (ext || it.container_extension || 'mp4'); }
    return base + '/series/' + c + it.id + '.' + (ext || it.container_extension || 'mp4');
  }
  function extList(it, kind) {
    var all = ['mp4', 'm3u8', 'mkv', 'ts'], out, i;
    if (kind === 'live') { return ['m3u8', 'ts']; }
    out = [it.container_extension || 'mp4'];
    for (i = 0; i < all.length; i++) { if (out.indexOf(all[i]) < 0) { out.push(all[i]); } }
    return out;
  }
  var watchdog = null;
  function arm() {
    clearTimeout(watchdog);
    watchdog = setTimeout(function () { if (screen === 'player' && video.readyState < 2) { tryNext(); } }, 25000);
  }
  function mask(u) { return u.replace(/\/(live|movie|series)\/[^\/]+\/[^\/]+\//, '/$1/***/***/'); }
  function resolveUrl(seg, url) {
    if (/^https?:\/\//i.test(seg)) { return seg; }
    if (seg.charAt(0) === '/') { return url.match(/^https?:\/\/[^\/]+/)[0] + seg; }
    return url.replace(/[?#].*$/, '').replace(/[^\/]*$/, '') + seg;
  }
  function headCheck(url, cb) {
    var x = new XMLHttpRequest(), fin = false;
    function end(t) { if (!fin) { fin = true; cb(t); } }
    x.open('GET', url, true); x.timeout = 12000;
    x.onreadystatechange = function () {
      if (x.readyState === 2) { end('HTTP ' + x.status + ', ' + (x.getResponseHeader('Content-Type') || 'unknown type')); try { x.abort(); } catch (e) {} }
    };
    x.onerror = function () { end('no answer'); };
    x.ontimeout = function () { end('timed out'); try { x.abort(); } catch (e) {} };
    x.send();
  }
  function probe(url, code) {
    var x = new XMLHttpRequest(), done = false, hls = /\.m3u8/i.test(url);
    function say(t) { if (done) { return; } done = true; osd('Cannot play. Video error ' + code + '. ' + t + '  (' + mask(url) + ')', 25000); }
    osd('Cannot play. Checking the server...', 25000);
    x.open('GET', url, true); x.timeout = 15000;
    x.onreadystatechange = function () {
      var ct, lines, i, seg = '', ok;
      if (x.readyState === 2 && !hls) {
        ct = x.getResponseHeader('Content-Type') || 'unknown type'; ok = x.status === 200 || x.status === 206;
        say('Server replied HTTP ' + x.status + ', ' + ct + '. ' + (ok ? 'The file exists, so this TV probably cannot decode it.' : x.status === 404 ? 'Stream not found on the server.' : x.status === 401 || x.status === 403 ? 'Access refused for this account.' : ''));
        try { x.abort(); } catch (e) {}
      } else if (x.readyState === 4 && hls && !done) {
        if (x.status !== 200) { say('Server replied HTTP ' + x.status + '.'); return; }
        lines = x.responseText.split(/\r?\n/);
        for (i = 0; i < lines.length; i++) { if (lines[i] && lines[i].charAt(0) !== '#') { seg = lines[i].replace(/^\s+|\s+$/g, ''); break; } }
        if (!seg) { say('The HLS playlist is empty (' + x.responseText.length + ' bytes).'); return; }
        headCheck(resolveUrl(seg, url), function (t) { say('HLS playlist found. First segment: ' + t + '. ' + (/^HTTP 200|^HTTP 206/.test(t) ? 'The stream is reachable; the TV may not support its video format.' : '')); });
      }
    };
    x.onerror = function () { say('Server did not answer.'); };
    x.ontimeout = function () { say('Server timed out.'); try { x.abort(); } catch (e) {} };
    x.send();
  }
  function tryNext() {
    var code = video.error ? video.error.code : 0;
    clearTimeout(watchdog);
    P.ei++;
    if (P.ei < P.exts.length) {
      osd('Trying format ' + P.exts[P.ei] + '...', 4000);
      video.src = itemUrl(P.list[P.idx], P.exts[P.ei]); video.play(); arm();
    } else {
      $('buf').style.display = 'none';
      probe(itemUrl(P.list[P.idx], P.exts[0]), code);
    }
  }
  function applyAspect() {
    var a = ASP[aspIdx];
    video.style.objectFit = a.c; video.style.width = a.w + 'px'; video.style.left = ((1280 - a.w) / 2) + 'px';
  }
  function play(list, idx, kind) {
    var it = list[idx], p;
    P.list = list; P.idx = idx; P.kind = kind; P.ts = false; P.resume = 0; pState = 'none'; screen = 'player';
    $('browse').style.display = 'none'; $('chPanel').style.display = 'none'; $('searchBox').style.display = 'none';
    video.style.display = 'block'; applyAspect();
    if (kind !== 'ep') { addRec(kind, it); }
    if (kind !== 'live') { p = parseInt(store(posKey()) || '0', 10); P.resume = p || 0; }
    P.exts = extList(it, kind); P.ei = 0;
    video.src = itemUrl(it, P.exts[0]); video.play(); arm();
    P.epgText = ''; P.epgFrac = 0; P.epgTimes = '';
    showBar(false);
    if (kind === 'live') { loadEpg(it, idx); }
  }
  function loadEpg(it, idx) {
    api('get_short_epg', '&stream_id=' + enc(it.stream_id) + '&limit=2', function (err, d) {
      var l, a, n, s, e, now;
      if (err || P.idx !== idx || screen !== 'player' || !d || !d.epg_listings || !d.epg_listings.length) { return; }
      l = d.epg_listings; a = l[0]; n = l[1]; now = Math.floor(Date.now() / 1000);
      s = +a.start_timestamp; e = +a.stop_timestamp;
      P.epgText = 'Now: ' + b64(a.title) + (n ? '        Next: ' + b64(n.title) : '');
      P.epgFrac = e > s ? Math.max(0, Math.min(1, (now - s) / (e - s))) : 0;
      P.epgTimes = hm(s) + ' - ' + hm(e);
      updateBar();
    });
  }
  function stop() {
    clearTimeout(watchdog); video.pause(); video.removeAttribute('src'); video.load();
    $('bar').style.display = 'none'; $('chPanel').style.display = 'none'; $('buf').style.display = 'none'; pState = 'none';
    go('browse'); renderBrowse();
  }
  function step(dir) {
    var n = P.idx + dir;
    if (n < 0) { n = P.list.length - 1; } if (n >= P.list.length) { n = 0; }
    S().rs = n; play(P.list, n, P.kind);
  }
  function seek(sec) {
    if (P.kind === 'live') { return; }
    video.currentTime = Math.max(0, video.currentTime + sec); showBar(pState === 'ctrl');
  }
  function toggle() { if (video.paused) { video.play(); } else { video.pause(); } showBar(pState === 'ctrl'); }

  /* ---------- bar and controls ---------- */
  function updateBar() {
    var it = P.list[P.idx], frac = 0, times = '';
    $('barTitle').textContent = (P.kind === 'live' ? (P.idx + 1) + '   ' : '') + itemName(it);
    if (P.kind === 'live') { $('barSub').textContent = P.epgText; frac = P.epgFrac; times = P.epgTimes; }
    else {
      $('barSub').textContent = video.paused ? 'Paused' : '';
      frac = video.duration ? video.currentTime / video.duration : 0; times = fmt(video.currentTime) + ' / ' + fmt(video.duration);
    }
    $('progFill').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; $('barTimes').textContent = times;
  }
  function showBar(withBtns) {
    $('bar').style.display = 'block'; $('btns').style.display = withBtns ? 'block' : 'none';
    updateBar(); clearTimeout(barTimer);
    barTimer = setTimeout(hideBar, withBtns ? 10000 : 5000);
  }
  function hideBar() { $('bar').style.display = 'none'; if (pState === 'ctrl') { pState = 'none'; } }
  function hasTracks(t) {
    var l = t === 'audio' ? video.audioTracks : video.textTracks;
    return !!l && l.length > (t === 'audio' ? 1 : 0);
  }
  function cycleTracks(t) {
    var l = t === 'audio' ? video.audioTracks : video.textTracks, i, cur = -1, n;
    for (i = 0; i < l.length; i++) { if (t === 'audio' ? l[i].enabled : l[i].mode === 'showing') { cur = i; } }
    n = cur + 1;
    for (i = 0; i < l.length; i++) {
      if (t === 'audio') { l[i].enabled = (i === n % l.length); } else { l[i].mode = (i === n ? 'showing' : 'disabled'); }
    }
    osd((t === 'audio' ? 'Audio: ' : 'Subtitles: ') + (t !== 'audio' && n >= l.length ? 'Off' : (l[n % l.length].label || l[n % l.length].language || (n % l.length) + 1)));
  }
  var IC = {
    back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
    home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
    play: 'M8 5v14l11-7z',
    pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
    prev: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
    next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
    rew: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
    fwd: 'M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z',
    aspect: 'M19 12h-2v3h-3v2h5v-5zM7 9h3V7H5v5h2V9zm14-6H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16.01H3V4.99h18v14.02z',
    list: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
    audio: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
    subs: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z',
    star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    star0: 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z'
  };
  function iconSvg(key) {
    var extra = (key === 'rew' || key === 'fwd') ? '<text x="12" y="16" font-size="8" font-weight="bold" text-anchor="middle" fill="currentColor">10</text>' : '';
    return '<svg viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="' + IC[key] + '"/>' + extra + '</svg>';
  }
  function buildBtns() {
    var live = P.kind === 'live', b = [], isFav;
    b.push(['Back', stop, 'back']);
    if (live) { b.push(['Channels', openCh, 'list']); }
    b.push(['Prev', function () { step(-1); }, 'prev']);
    if (!live) {
      b.push(['-10 s', function () { seek(-10); }, 'rew']);
      b.push([video.paused ? 'Play' : 'Pause', toggle, video.paused ? 'play' : 'pause']);
      b.push(['+10 s', function () { seek(10); }, 'fwd']);
    }
    b.push(['Next', function () { step(1); }, 'next']);
    b.push(['Aspect', function () { aspIdx = (aspIdx + 1) % ASP.length; store('xtv_asp', aspIdx); applyAspect(); osd('Aspect: ' + ASP[aspIdx].n); }, 'aspect']);
    if (hasTracks('audio')) { b.push(['Audio', function () { cycleTracks('audio'); }, 'audio']); }
    if (hasTracks('text')) { b.push(['Subtitles', function () { cycleTracks('text'); }, 'subs']); }
    if (live) {
      isFav = !!getFavs('live')[pid(P.list[P.idx])];
      b.push(['Favorite', function () {
        osd(toggleFav('live', P.list[P.idx]) ? 'Added to favorites' : 'Removed from favorites');
      }, isFav ? 'star' : 'star0']);
    }
    b.push(['Home', goHome, 'home']);
    btns = b;
  }
  function goHome() {
    if (screen === 'player') { stop(); }
    showHome();
  }
  function fakeKey(code) {
    var ev = document.createEvent('Event'); ev.initEvent('keydown', true, true); ev.keyCode = code; document.dispatchEvent(ev);
  }
  function renderBtns() {
    var el = $('btns'), i, d;
    el.innerHTML = '';
    for (i = 0; i < btns.length; i++) {
      d = document.createElement('div'); d.className = 'cb' + (i === btnSel ? ' on' : '');
      d.innerHTML = '<div class="ci">' + iconSvg(btns[i][2]) + '</div><div class="cl">' + btns[i][0] + '</div>';
      d.onclick = (function (n) { return function () {
        btnSel = n; btns[n][1]();
        if (pState === 'ctrl') { buildBtns(); btnSel = clamp(btnSel, btns.length); renderBtns(); showBar(true); }
      }; })(i);
      el.appendChild(d);
    }
  }
  function openCtrl() {
    var i;
    pState = 'ctrl'; buildBtns(); btnSel = 0;
    for (i = 0; i < btns.length; i++) { if (btns[i][0] === 'Play' || btns[i][0] === 'Pause' || btns[i][0] === 'Channels') { btnSel = i; } }
    renderBtns(); showBar(true);
  }
  function renderCh() {
    renderList($('chList'), P.list, chSel, true, function (c, i) { return (i + 1) + '   ' + c.name; }, null, iconOf, function (i) { closeCh(); S().rs = i; play(P.list, i, 'live'); });
  }
  function openCh() { pState = 'chlist'; chSel = P.idx; $('bar').style.display = 'none'; $('chPanel').style.display = 'block'; renderCh(); }
  function closeCh() { pState = 'none'; $('chPanel').style.display = 'none'; }

  video.addEventListener('error', function () {
    if (screen !== 'player') { return; }
    tryNext();
  });
  video.addEventListener('waiting', function () { if (screen === 'player') { $('buf').style.display = 'block'; } });
  video.addEventListener('playing', function () { $('buf').style.display = 'none'; clearTimeout(watchdog); });
  video.addEventListener('loadedmetadata', function () {
    if (P.resume > 0 && video.duration && P.resume < video.duration - 30) { video.currentTime = P.resume; osd('Resumed at ' + fmt(P.resume)); }
    P.resume = 0;
  });
  video.addEventListener('timeupdate', function () {
    if (screen !== 'player') { return; }
    if ($('bar').style.display === 'block' && P.kind !== 'live') { updateBar(); }
    if (P.kind !== 'live' && video.currentTime > 10 && Date.now() - lastSave > 5000) { lastSave = Date.now(); store(posKey(), String(Math.floor(video.currentTime))); }
  });
  video.addEventListener('ended', function () {
    if (screen !== 'player' || P.kind === 'live') { return; }
    store(posKey(), '');
    if (P.kind === 'ep' && P.idx + 1 < P.list.length) { step(1); } else { stop(); }
  });

  /* ---------- keys ---------- */
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, s, d, f, ids, el;
    if (k === K.BACK) { lastBack = Date.now(); e.preventDefault(); }
    if (screen === 'pin') {
      e.preventDefault();
      if (k === K.BACK) { closePin(false); }
      else if (pin.mode !== 'menu' && ((k >= 48 && k <= 57) || (k >= 96 && k <= 105))) { pinDigit(String(k >= 96 ? k - 96 : k - 48)); }
      else if (k === 8 && pin.mode !== 'menu') { pin.val = pin.val.slice(0, -1); pinDraw(); }
      else if (k === K.OK) { pinPress(pin.sel); }
      else if (k === K.U || k === K.D || k === K.L || k === K.R) {
        if (pin.mode === 'menu') { if (k === K.U) { pin.sel = clamp(pin.sel - 1, pin.items.length); } else if (k === K.D) { pin.sel = clamp(pin.sel + 1, pin.items.length); } }
        else { pin.sel = clamp(pin.sel + (k === K.R ? 1 : k === K.L ? -1 : k === K.D ? 3 : -3), 12); }
        pinDraw();
      }
      return;
    }
    if (screen === 'plist') {
      if (k === K.U || k === K.D) { plSel = clamp(plSel + (k === K.D ? 1 : -1), pls.length + 1); renderPl(); }
      else if (k === K.OK) { if (plSel >= pls.length) { openForm(-1); } else { openPlaylist(pls[plSel]); } }
      else if (k === K.R && plSel < pls.length) { openForm(plSel); }
      else if (k === K.BACK) { quitApp(); }
      e.preventDefault(); return;
    }
    if (screen === 'form') {
      d = formFields[formIdx]; el = $(d);
      if (el.tagName === 'INPUT' && document.activeElement === el) {
        if (k === K.OK) { el.blur(); curForm(clamp(formIdx + 1, formFields.length)); e.preventDefault(); }
        else if (k === K.BACK) { el.blur(); e.preventDefault(); }
        return;
      }
      if (k === K.U || k === K.D) { curForm(clamp(formIdx + (k === K.D ? 1 : -1), formFields.length)); }
      else if (k === K.OK) {
        if (el.tagName === 'INPUT') { el.focus(); }
        else if (d === 'bSave') { saveForm(); } else if (d === 'bDelete') { pls.splice(editIdx, 1); savePls(); plSel = 0; showPlaylists(); } else if (d === 'bCancel') { showPlaylists(); }
      }
      else if ((k === K.L || k === K.R) && d.charAt(0) === 'b') { curForm(clamp(formIdx + (k === K.R ? 1 : -1), formFields.length)); }
      else if (k === K.BACK) { showPlaylists(); }
      e.preventDefault(); return;
    }
    if (screen === 'home') {
      if (tb >= 0) {
        if (k === K.D || k === K.U) { setTb(-1); } else if (k === K.OK || k === K.BACK) { showPlaylists(); }
        e.preventDefault(); return;
      }
      if (k === K.U) { setTb(0); }
      else if (k === K.L || k === K.R) { homeSel = clamp(homeSel + (k === K.R ? 1 : -1), 6); showHome(); }
      else if (k === K.OK) { homeAction(homeSel); }
      else if (k === K.BACK) { showPlaylists(); }
      e.preventDefault(); return;
    }
    if (screen === 'search') {
      if (k === K.OK) { runSearch(); } else if (k === K.BACK) { closeSearch(); }
      return;
    }
    if (screen === 'browse') {
      s = S();
      if (tb >= 0) {
        ids = topIds();
        if (k === K.BACK) { setTb(-1); }
        else {
          if (k === K.L) { setTb(clamp(tb - 1, ids.length)); }
          else if (k === K.R) { setTb(clamp(tb + 1, ids.length)); }
          else if (k === K.D) { setTb(-1); }
          else if (k === K.OK) {
            if (ids[tb] === 'nbView') { toggleGrid(); }
            else if (ids[tb] === 'nbBack') { setTb(-1); fakeKey(461); }
            else { goHome(); }
          }
          e.preventDefault(); return;
        }
      }
      if (k === K.BACK) {
        if (view === 'episodes') { view = 'browse'; pane = 1; $('leftTitle').textContent = MODES[mode].name; $('rightTitle').textContent = B.left[B.ls].category_name; }
        else if (pane === 1) { pane = 0; } else { showHome(); return; }
      }
      else if (k === 404) { toggleGrid(); }
      else if (k === 403) { if (pane === 1) { toggleCurrentFav(); } }
      else if (isGrid() && pane === 1 && (k === K.L || k === K.R || k === K.U || k === K.D)) {
        if (k === K.L) { if (s.rs % COLS === 0) { pane = 0; } else { s.rs--; } }
        else if (k === K.R) { if (s.rs + 1 < s.right.length) { s.rs++; } }
        else if (k === K.U) { if (s.rs >= COLS) { s.rs -= COLS; } else { setTb(0); } }
        else if (s.rs + COLS < s.right.length) { s.rs += COLS; }
        else if (Math.floor(s.rs / COLS) < Math.floor((s.right.length - 1) / COLS)) { s.rs = s.right.length - 1; }
      }
      else if (k === K.U && ((pane === 0 && s.ls === 0) || (pane === 1 && s.rs === 0))) { setTb(0); }
      else if (k === K.L) { pane = 0; }
      else if (k === K.R) {
        if (pane === 0) { if (s.right.length) { pane = 1; } }
        else { toggleCurrentFav(); }
      }
      else if (k === K.U || k === K.D || k === K.PGUP || k === K.PGDN) {
        d = (k === K.D || k === K.PGDN ? 1 : -1) * (k === K.PGUP || k === K.PGDN ? 10 : 1);
        if (pane === 0) {
          s.ls = clamp(s.ls + d, s.left.length);
          if (view === 'browse') { renderBrowse(); loadItems(); return; }
          s.right = s.left[s.ls].eps; s.rs = 0;
        } else { s.rs = clamp(s.rs + d * (isGrid() && (k === K.U || k === K.D) ? COLS : 1), s.right.length); }
      }
      else if (k === K.OK) {
        if (pane === 0) {
          if (view === 'browse' && B.left[B.ls].category_id === '__search') { openSearch(); return; }
          if (view === 'browse' && lockedCat(B.left[B.ls])) { askAdult = true; loadItems(); askAdult = false; return; }
          if (s.right.length) { pane = 1; }
        }
        else if (view === 'episodes') { play(E.right, E.rs, 'ep'); return; }
        else if (mode === 'series') { if (B.right[B.rs]) { openSeries(B.right[B.rs]); } return; }
        else if (B.right[B.rs]) { play(B.right, B.rs, mode); return; }
      }
      renderBrowse(); e.preventDefault(); return;
    }
    if (screen === 'player') {
      e.preventDefault();
      if (k === K.PLAY) { video.play(); return; }
      if (k === K.PAUSE) { video.pause(); return; }
      if (k === K.STOP) { stop(); return; }
      if (k === K.RW) { seek(-10); return; }
      if (k === K.FF) { seek(10); return; }
      if (pState === 'chlist') {
        if (k === K.U || k === K.D) { chSel = clamp(chSel + (k === K.D ? 1 : -1), P.list.length); renderCh(); }
        else if (k === K.PGUP || k === K.PGDN) { chSel = clamp(chSel + (k === K.PGDN ? 10 : -10), P.list.length); renderCh(); }
        else if (k === K.OK) { closeCh(); S().rs = chSel; play(P.list, chSel, 'live'); }
        else if (k === K.BACK || k === K.L || k === K.R) { closeCh(); }
        return;
      }
      if (pState === 'ctrl') {
        if (k === K.L || k === K.R) { btnSel = clamp(btnSel + (k === K.R ? 1 : -1), btns.length); renderBtns(); showBar(true); }
        else if (k === K.OK) {
          btns[btnSel][1]();
          if (pState === 'ctrl') { buildBtns(); btnSel = clamp(btnSel, btns.length); renderBtns(); showBar(true); }
        }
        else if (k === K.BACK || k === K.U || k === K.D) { hideBar(); }
        return;
      }
      if (k === K.BACK) { stop(); }
      else if (k === K.OK || (k === K.R && P.kind === 'live')) { openCtrl(); }
      else if (P.kind === 'live') {
        if (k === K.U || k === K.CHUP || k === K.PGUP) { step(1); }
        else if (k === K.D || k === K.CHDN || k === K.PGDN) { step(-1); }
        else if (k === K.L) { openCh(); }
      }
      else {
        if (k === K.L) { seek(-10); } else if (k === K.R) { seek(10); }
        else if (k === K.U || k === K.D) { showBar(false); }
        else if (P.kind === 'ep' && (k === K.CHUP || k === K.PGUP)) { step(1); }
        else if (P.kind === 'ep' && (k === K.CHDN || k === K.PGDN)) { step(-1); }
      }
    }
  });
  ['fName', 'fHost', 'fUser', 'fPass', 'bSave', 'bDelete', 'bCancel'].forEach(function (id) { $(id).addEventListener('focus', function () { if (formFields.indexOf(id) > -1) { curForm(formFields.indexOf(id)); } }); });
  function deletePl() { pls.splice(editIdx, 1); savePls(); plSel = 0; showPlaylists(); }
  $('bSave').addEventListener('click', saveForm);
  $('bDelete').addEventListener('click', deletePl);
  $('bCancel').addEventListener('click', showPlaylists);

  (function () {
    var t = $('tiles').children, i;
    for (i = 0; i < t.length; i++) {
      t[i].onclick = (function (n) { return function () {
        homeSel = n; showHome(); homeAction(n);
      }; })(i);
    }
  })();
  $('prog').addEventListener('click', function (e) {
    if (P.kind === 'live' || !video.duration) { return; }
    video.currentTime = Math.max(0, Math.min(1, e.offsetX / this.offsetWidth)) * video.duration;
    showBar(pState === 'ctrl');
  });
  var wheelTimer = null;
  $('browse').addEventListener('mousewheel', function (e) {
    var s = S(), dir = e.wheelDelta < 0 ? 1 : -1;
    e.preventDefault();
    if (!$('leftList').parentNode.contains(e.target)) {
      pane = 1; s.rs = clamp(s.rs + dir * (isGrid() ? COLS : 1), s.right.length);
    } else {
      pane = 0; s.ls = clamp(s.ls + dir, s.left.length);
      if (view === 'browse') { renderBrowse(); clearTimeout(wheelTimer); wheelTimer = setTimeout(loadItems, 250); return; }
      s.right = s.left[s.ls].eps; s.rs = 0;
    }
    setTb(-1); renderBrowse();
  });
  $('video').addEventListener('click', function () { if (screen === 'player' && pState === 'none') { openCtrl(); } });
  $('nbBack').addEventListener('click', function () { fakeKey(461); });
  $('nbHome').addEventListener('click', goHome);
  $('nbView').addEventListener('click', toggleGrid);
  $('hmBack').addEventListener('click', function () { fakeKey(461); });
  document.addEventListener('keyup', function (e) { if (e.keyCode === K.BACK) { e.preventDefault(); } });
  try { history.pushState(null, ''); history.pushState(null, ''); } catch (err) {}
  window.addEventListener('popstate', function () {
    try { history.pushState(null, ''); } catch (err) {}
    if (Date.now() - lastBack > 700) { lastBack = Date.now(); fakeKey(K.BACK); }
  });
  window.__nbKey = fakeKey;
  var maxW = 0, maxH = 0;
  function fit() {
    var z;
    maxW = Math.max(maxW, window.innerWidth || 0, 1280); maxH = Math.max(maxH, window.innerHeight || 0, 720);
    z = Math.max(1, Math.min(maxW / 1280, maxH / 720));
    document.body.style.zoom = z;
  }
  fit(); window.addEventListener('resize', fit);
  aspIdx = parseInt(store('xtv_asp') || '0', 10) || 0;
  loadPls();
  if (!pls.length) { openForm(-1); } else { showPlaylists(); }
})();
