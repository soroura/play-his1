(function () {
  const { h, $, tr, api, store, SHAPES, TAGS } = P;
  const app = $('#app'), controls = $('#controls');
  let st = null, version = null, recvAt = 0, key = '', authed = true, hidden = false;
  let muted = store('play_muted') === '1';
  let sceneCtl = null, dyn = {}, timers = [];

  // ---------- audio ----------
  let actx = null;
  function beep(freq, dur, type, vol) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq; g.gain.value = vol || 0.06;
      o.connect(g); g.connect(actx.destination); o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur); o.stop(actx.currentTime + dur);
    } catch (e) { /* audio unavailable */ }
  }
  const sfx = { line: () => beep(660, 0.08, 'triangle'), crit: () => beep(220, 0.25, 'sawtooth', 0.05), q: () => { beep(523, 0.15); setTimeout(() => beep(784, 0.25), 150); }, tick: () => beep(880, 0.05, 'square', 0.03), reveal: () => { beep(392, 0.15); setTimeout(() => beep(587, 0.3), 160); }, join: () => beep(740, 0.06, 'sine', 0.03) };

  // ---------- helpers ----------
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  function clearTimers() { if (dyn.clockTimer) clearInterval(dyn.clockTimer); timers.forEach(clearTimeout); timers = []; sceneCtl = null; dyn = {}; }
  const bi = (o, cls) => [h('div', { class: cls || 'en', text: o && o.en ? o.en : '' }), o && o.ar ? h('div', { class: 'ar ' + (cls ? cls + '2' : ''), text: o.ar }) : null];
  const remaining = () => Math.max(0, (st.game.remainingMs || 0) - (performance.now() - recvAt));
  const phaseKey = () => (st && st.game ? st.game.id + ':' + st.game.phase + ':' + st.game.round : 'none');

  // ---------- login ----------
  function loginView() {
    clearTimers(); key = 'login'; controls.hidden = true;
    const pin = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', placeholder: 'PIN', 'aria-label': 'Host PIN' });
    const err = h('div', { class: 'err' });
    const go = async () => {
      try { await api('/api/host/login', { pin: pin.value }); authed = true; version = null; key = ''; poll(true); }
      catch (e) { err.textContent = e.message; pin.select(); }
    };
    pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'display', style: 'font-size:48px;color:var(--gold)', text: 'Host' }), pin, h('button', { class: 'btn', onclick: go, text: 'Log in' }), err));
    pin.focus();
  }

  // ---------- header ----------
  function header() {
    const g = st.game, r = st.round;
    return h('div', { class: 'hd' },
      h('span', null, h('b', { text: st.meta.hospital }), r ? '  -  ' + (r.clock || '') + '  ' + tr(r.place, 'en') : ''),
      h('span', { class: 'rt', text: g.phase === 'lobby' ? 'LOBBY' : g.phase === 'final' ? 'FINAL' : 'ROUND ' + (g.round + 1) + ' / ' + g.rounds }));
  }

  // ---------- lobby ----------
  function lobbyView() {
    const g = st.game;
    dyn.names = h('div', { class: 'names' });
    dyn.count = h('div', { class: 'count', text: '0 players' });
    app.replaceChildren(header(), h('div', { class: 'lobby' },
      h('div', { class: 'joinbox' },
        h('div', { class: 'sub', style: 'font-size:26px', text: 'Join on your phone or laptop' }),
        h('div', { class: 'joinurl', text: g.joinUrl.replace(/^https?:\/\//, '') }),
        h('div', { class: 'sub', style: 'font-size:26px;margin-top:14px', text: 'Room code' }),
        h('div', { class: 'roomcode', text: g.code }),
        h('div', { class: 'ar', style: 'font-size:24px;color:var(--soft)', text: 'ادخل الرابط واكتب رمز الغرفة' })),
      h('div', null, dyn.count, dyn.names)));
    updateLobby();
  }
  let shownNames = 0;
  function updateLobby() {
    if (!dyn.names) return;
    const names = st.names || [];
    dyn.count.textContent = names.length + (names.length === 1 ? ' player' : ' players');
    if (names.length < shownNames) { dyn.names.replaceChildren(); shownNames = 0; }
    for (let i = shownNames; i < names.length; i++) dyn.names.append(h('span', { text: names[i] }));
    if (names.length > shownNames) sfx.join();
    shownNames = names.length;
  }

  // ---------- scenes ----------
  const COLORS = ['#e53935', '#8e24aa', '#1e88e5', '#00897b', '#f4511e', '#6d4c41', '#3949ab', '#c0ca33'];
  const colorOf = (n) => { let x = 0; for (const c of n) x = (x * 31 + c.charCodeAt(0)) | 0; return COLORS[Math.abs(x) % COLORS.length]; };

  function sceneView() {
    const r = st.round, sc = st.scene;
    const stage = h('div', { class: 'scene' });
    app.replaceChildren(header(), h('div', { class: 'stitle' }, h('span', { class: 't1', text: tr(r.title, 'en') }), r.title.ar ? h('span', { class: 't2 ar', text: r.title.ar }) : null, h('span', { class: 'pl', text: r.clock + '  -  ' + tr(r.place, 'en') + (r.place.ar ? '  -  ' + r.place.ar : '') })), stage,
      h('div', { class: 'skip', text: 'Space: show everything, then Space again for the question.' }));
    const lines = sc.lines;
    const interval = { feed: 2200, chat: 2600, document: 1700, photo: 2200 }[sc.style] || 2000;
    let shown = 0, items = [];
    const build = {
      feed: () => {
        const clock = h('div', { class: 'clock', text: (r.clock || '') + ':00' });
        const feed = h('div', { class: 'feed' });
        stage.append(h('div', { class: 'sc-feed' }, h('div', { class: 'lbl', text: tr(r.place, 'en') + ' - incident feed' }), clock, feed));
        const box = stage.firstChild;
        let base = (lines[0] && lines[0].t) || r.clock || '00:00', sec = 0;
        const tickId = setInterval(() => { sec = Math.min(59, sec + 1); clock.textContent = base + ':' + String(sec).padStart(2, '0'); }, 400);
        dyn.clockTimer = tickId;
        return (ln) => {
          if (ln.t) { base = ln.t; sec = 0; clock.textContent = base + ':00'; }
          feed.append(h('div', { class: 'ev ' + ln.tone }, ln.t ? h('span', { class: 't', text: ln.t }) : null, ln.who ? h('b', { text: ln.who }) : null, h('span', { text: ln.text.en }), ln.text.ar ? h('div', { class: 'ar', text: ln.text.ar }) : null));
          if (ln.tone === 'crit') { box.classList.add('red'); sfx.crit(); } else sfx.line();
        };
      },
      chat: () => {
        const msgs = h('div', { class: 'msgs' });
        stage.append(h('div', { class: 'sc-chat' }, h('div', { class: 'phone' }, h('div', { class: 'pscreen' }, h('div', { class: 'phdr' }, tr(r.place, 'en'), h('small', { text: r.place.ar || st.meta.hospital })), msgs))));
        return (ln, done) => {
          const add = () => {
            typing && typing.remove();
            if (!ln.who) msgs.append(h('div', { class: 'sys ' + ln.tone }, h('div', { text: ln.text.en }), ln.text.ar ? h('div', { class: 'ar', text: ln.text.ar }) : null));
            else msgs.append(h('div', { class: 'msg ' + ln.tone }, h('div', { class: 'who', style: 'color:' + colorOf(ln.who), text: ln.who }), h('div', { text: ln.text.en }), ln.text.ar ? h('div', { class: 'ar', text: ln.text.ar }) : null, ln.t ? h('div', { class: 'tm', text: ln.t }) : null));
            msgs.scrollTop = msgs.scrollHeight;
            ln.tone === 'crit' ? sfx.crit() : sfx.line();
            done && done();
          };
          let typing = null;
          if (ln.who && !done) { typing = h('div', { class: 'typing', text: ln.who + ' is typing...' }); msgs.append(typing); msgs.scrollTop = msgs.scrollHeight; later(add, 700); }
          else add();
        };
      },
      document: () => {
        const box = h('div', { class: 'sc-doc' });
        stage.append(box);
        return (ln) => { box.append(h('div', { class: 'dl ' + ln.tone }, h('span', { class: 't', text: ln.t || '' }), h('span', { class: 'tx' }, ln.who ? h('b', { text: ln.who + ': ' }) : null, ln.text.en, ln.text.ar ? h('div', { class: 'ar', text: ln.text.ar }) : null))); sfx.line(); };
      },
      photo: () => {
        const co = h('div', { class: 'callouts' });
        stage.append(h('div', { class: 'sc-photo' }, h('img', { src: '/' + sc.image, alt: tr(r.title, 'en') }), co));
        return (ln) => { co.append(h('div', { class: 'co' }, h('span', { class: 'n', text: ln.t || '' }), h('div', null, h('div', { text: ln.text.en }), ln.text.ar ? h('div', { class: 'ar', text: ln.text.ar }) : null))); sfx.line(); };
      },
    };
    const add = (build[sc.style] || build.document)();
    const step = () => { if (shown < lines.length) { add(lines[shown++]); } };
    // chat uses typing delay so lines are chained from timers
    later(function next() { if (shown < lines.length) { step(); later(next, interval); } }, 700);
    sceneCtl = { skip: () => { if (shown >= lines.length) return false; timers.forEach(clearTimeout); timers = []; while (shown < lines.length) { const ln = lines[shown++]; add(ln, () => {}); } return true; } };
  }

  // ---------- question ----------
  function optTile(o, i, extra) {
    return h('div', { class: 'otile c' + i, 'data-key': o.key }, h('div', { class: 'row' }, h('span', { class: 'sh', text: SHAPES[i] }), h('div', null, h('div', { class: 'tx', text: o.text.en }), o.text.ar ? h('div', { class: 'tx2 ar', text: o.text.ar }) : null)), extra);
  }
  function questionView() {
    const r = st.round;
    dyn.timer = h('div', { class: 'timer', text: '' });
    dyn.fill = h('div'); dyn.prog = h('span', { text: '' });
    app.replaceChildren(header(),
      h('div', { class: 'qbox' }, h('div', { style: 'flex:1' }, h('div', { class: 'q', text: r.question.en }), r.question.ar ? h('div', { class: 'qa ar', text: r.question.ar }) : null), dyn.timer),
      h('div', { class: 'prog' }, dyn.prog, h('div', { class: 'bar' }, dyn.fill)),
      h('div', { class: 'otiles' }, r.options.map((o, i) => optTile(o, i))));
    sfx.q();
    updateQuestion();
  }
  let lastTick = -1;
  function updateQuestion() {
    if (!dyn.timer) return;
    const total = st.answerTotal || 0, n = st.answered || 0;
    dyn.prog.textContent = n + ' / ' + total + ' answered';
    dyn.fill.style.width = (total ? Math.min(100, (n / total) * 100) : 0) + '%';
  }
  function tickTimer() {
    if (!st || !st.game || st.game.phase !== 'question' || !dyn.timer) return;
    const s = Math.ceil(remaining() / 1000);
    dyn.timer.textContent = String(s);
    dyn.timer.classList.toggle('low', s <= 10);
    if (s <= 5 && s > 0 && s !== lastTick) sfx.tick();
    lastTick = s;
  }

  // ---------- reveal ----------
  function revealView() {
    const r = st.round, rv = st.reveal;
    const sum = rv.options.reduce((a, o) => a + o.count, 0) || 1;
    const tiles = rv.options.map((o, i) => {
      const cls = o.key === rv.best ? ' win' : ' dim';
      const t = optTile(o, i, [h('span', { class: 'cnt', text: o.count + ' (' + Math.round((o.count / sum) * 100) + '%)' }), h('span', { class: 'fill', 'data-w': (o.count / sum) * 100 }), o.knockout ? h('div', { class: 'ko', text: 'KNOCK-OUT' }) : null]);
      t.className += cls;
      return t;
    });
    const why = h('ul', { class: 'why' }, rv.why.map((w) => h('li', null, h('span', { class: 'tag', title: TAGS[w.tag] || '', text: w.tag }), h('div', null, h('div', { text: w.text.en }), w.text.ar ? h('div', { class: 'ar', text: w.text.ar }) : null))));
    const rc = rv.realCase;
    const cs = (x) => (typeof x === 'string' ? x : x.en);
    app.replaceChildren(header(),
      h('div', { class: 'qbox' }, h('div', { style: 'flex:1' }, h('div', { class: 'q', text: r.question.en }))),
      h('div', { class: 'otiles rev' }, tiles),
      h('div', { class: 'revgrid' },
        h('div', { class: 'panel why' }, h('h3', { text: 'Why' }), why),
        h('div', { class: 'panel case' }, h('h3', { text: 'Real case' + (rc.status === 'partly' ? ' (reported)' : '') }), h('b', { text: cs(rc.title) }), h('div', { text: cs(rc.text) }), h('div', { class: 'src', text: 'Source: ' + cs(rc.source) }),
          rv.options.some((o) => o.knockout) ? h('div', { class: 'src', text: 'Knock-out: this choice would fail a real GAHAR survey.' }) : null,
          rv.standards.length ? h('div', { class: 'std' }, rv.standards.map((s) => h('span', { text: s }))) : null)));
    later(() => document.querySelectorAll('.fill').forEach((f) => { f.style.width = f.dataset.w + '%'; }), 100);
    sfx.reveal();
  }

  // ---------- leaderboard / final ----------
  function leaderView() {
    app.replaceChildren(header(), h('div', { class: 'lb' }, h('h2', { text: 'Leaderboard' }),
      st.leaderboard.map((p, i) => h('div', { class: 'lbrow', style: 'animation-delay:' + i * 0.15 + 's' }, h('span', { class: 'rk', text: p.rank }), h('span', { class: 'nm', text: p.name }), p.delta ? h('span', { class: 'dl', text: '+' + p.delta }) : null, h('span', { class: 'tt', text: p.total })))));
  }
  function finalView() {
    const pod = st.podium || [];
    const order = [pod[1], pod[0], pod[2]].filter(Boolean);
    app.replaceChildren(header(), h('div', { class: 'fin' }, h('h2', { text: 'Final podium' }),
      pod.length ? h('div', { class: 'pod' }, order.map((p) => h('div', { class: 'p' + p.rank }, h('div', { class: 'display', style: 'font-size:56px', text: '#' + p.rank }), h('div', { class: 'nm', text: p.name }), h('div', { class: 'tt', text: p.total })))) : h('div', { class: 'sub', text: 'No players' }),
      h('div', { class: 'sub', style: 'font-size:24px', text: 'Open your personal report on your phone.' })));
  }

  // ---------- noGame ----------
  function noGameView() {
    app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'display', style: 'font-size:56px;color:var(--gold)', text: st.meta.title.en }), h('div', { class: 'sub', text: st.rounds + ' rounds - ' + st.meta.hospital }),
      h('button', { class: 'btn', onclick: () => act('game'), text: 'Create game' })));
  }

  // ---------- controls ----------
  function renderControls() {
    controls.hidden = hidden || !st || !authed;
    if (controls.hidden) return;
    const g = st.game, ph = g ? g.phase : 'none';
    const b = (label, fn, cls) => h('button', { class: 'btn' + (cls ? ' ' + cls : ''), onclick: fn, text: label });
    const kids = [];
    if (ph === 'none') kids.push(b('Create game', () => act('game')));
    if (ph === 'lobby') kids.push(b('Start game  [Space]', () => act('advance')));
    if (ph === 'scene') kids.push(b('Question  [Space]', next));
    if (ph === 'question') { kids.push(b('Reveal now  [R]', () => act('reveal'))); kids.push(b('+15 s  [+]', () => act('extend'), 'sec')); }
    if (ph === 'reveal') kids.push(b('Leaderboard  [L]', () => act('advance')));
    if (ph === 'leaderboard') kids.push(b(g.round + 1 < g.rounds ? 'Next round  [Space]' : 'Final podium  [Space]', () => act('advance')));
    if (ph === 'final') kids.push(b('New game', () => { if (confirm('Start a new game? Players will need the new code.')) act('game'); }, 'sec'));
    kids.push(b(muted ? 'Sound off [M]' : 'Sound on [M]', toggleMute, 'sec'));
    kids.push(b('Hide [H]', () => { hidden = true; renderControls(); }, 'sec'));
    kids.push(h('a', { href: '/host/help', target: '_blank', rel: 'noopener', style: 'color:var(--soft)', text: 'Run sheet' }));
    kids.push(h('span', { class: 'hint', text: g ? g.phase + (g.phase === 'lobby' ? '' : ' - round ' + (g.round + 1)) + ' - room ' + g.code : '' }));
    controls.replaceChildren(...kids);
  }
  function toggleMute() { muted = !muted; store('play_muted', muted ? '1' : '0'); renderControls(); }

  async function act(what, body) {
    try {
      const r = await api('/api/host/' + what, body || { from: st && st.game ? st.game.phase + ':' + st.game.round : undefined });
      applyState(r);
    } catch (e) { if (e.status === 401) { authed = false; loginView(); } else alert(e.message); }
  }
  function next() {
    if (!st || !st.game) return;
    if (st.game.phase === 'scene' && sceneCtl && sceneCtl.skip()) return;
    act('advance');
  }

  document.addEventListener('keydown', (e) => {
    if (!authed || !st || e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key, ph = st.game ? st.game.phase : 'none';
    if (k === ' ' || k === 'ArrowRight') { e.preventDefault(); if (ph === 'question') return; if (ph === 'final') return; if (ph !== 'none') next(); }
    else if (k === 'r' || k === 'R') { if (ph === 'question') act('reveal'); }
    else if (k === '+' || k === '=') { if (ph === 'question') act('extend'); }
    else if (k === 'l' || k === 'L') { if (ph === 'reveal') act('advance'); }
    else if (k === 'h' || k === 'H') { hidden = !hidden; renderControls(); }
    else if (k === 'm' || k === 'M') toggleMute();
  });

  // ---------- state ----------
  function applyState(r) {
    if (r.same) { renderControls(); return; }
    st = r; recvAt = performance.now(); version = r.version; authed = true;
    const k = st.game ? phaseKey() : 'none';
    if (k !== key) {
      key = k; clearTimers(); shownNames = 0; lastTick = -1;
      const ph = st.game ? st.game.phase : 'none';
      if (ph === 'none') noGameView();
      else if (ph === 'lobby') lobbyView();
      else if (ph === 'scene') sceneView();
      else if (ph === 'question') questionView();
      else if (ph === 'reveal') revealView();
      else if (ph === 'leaderboard') leaderView();
      else if (ph === 'final') finalView();
      if (ph === 'final') updateLobby();
    } else if (st.game) {
      if (st.game.phase === 'lobby') updateLobby();
      if (st.game.phase === 'question') updateQuestion();
    }
    renderControls();
  }
  let pt = null;
  async function poll(force) {
    clearTimeout(pt);
    if (authed) {
      try { applyState(await api('/api/host/state' + (version != null && !force ? '?v=' + version : ''))); }
      catch (e) { if (e.status === 401) { authed = false; loginView(); } }
    }
    pt = setTimeout(poll, 1000);
  }
  setInterval(tickTimer, 200);
  poll(true);
})();
