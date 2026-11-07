(function () {
  const { h, $, api, store, SHAPES, TAGS, TAGS_AR } = P;
  const root = $('#root');
  let content = null, byId = new Map(), st = null, version = null, recvAt = 0, key = '', dyn = {}, polling = false, err = '';

  const bi = (o, cls) => {
    if (o == null) return null;
    if (typeof o === 'string') return h('div', { class: cls || '', text: o });
    return [h('div', { class: cls || '', text: o.en }), o.ar ? h('div', { class: 'ar ' + (cls || ''), dir: 'rtl', text: o.ar }) : null];
  };
  const remaining = () => Math.max(0, ((st.game && st.game.remainingMs) || 0) - (performance.now() - recvAt));
  const roundOf = (idx) => { const g = st.game; const id = g.roundIds && g.roundIds[idx]; return id === undefined ? null : byId.get(id) || null; };
  const phaseKey = () => (st && st.game ? st.game.id + ':' + st.game.phase + ':' + st.game.round : 'none');

  async function act(what, body) {
    try { const r = await api('/api/host/' + what, body || { from: st && st.game ? st.game.phase + ':' + st.game.round : undefined }); err = ''; applyState(r); }
    catch (e) { if (e.status === 401) { P.staffLogin(root, boot); } else { err = e.message; renderTop(); } }
  }

  // ---------- top bar (always visible, dynamic bits updated in place) ----------
  function renderTop() {
    const g = st && st.game;
    const phase = g ? g.phase : 'none';
    const b = (label, fn, cls) => h('button', { class: 'sbtn' + (cls ? ' ' + cls : ''), onclick: fn, text: label });
    const btns = [];
    if (g) {
      if (phase === 'lobby') btns.push(b(g.mode === 'self' ? 'Open the exercise' : 'Start game', () => act('advance')));
      if (phase === 'scene') btns.push(b('Open question', () => act('advance')));
      if (phase === 'question') { btns.push(b('Reveal now', () => act('reveal'))); btns.push(b('+15 s', () => act('extend'), 'sec')); }
      if (phase === 'reveal') btns.push(b('Leaderboard', () => act('advance')));
      if (phase === 'leaderboard') btns.push(b(g.round + 1 < g.rounds ? 'Next round' : 'Final podium', () => act('advance')));
    }
    dyn.timer = h('div', { class: 'ntimer mono', text: '' });
    dyn.prog = h('div', { class: 'nprog' });
    const label = !g ? 'No game running' : phase === 'lobby' ? 'LOBBY' : phase === 'final' ? 'FINAL' : phase === 'running' ? 'SELF-PACED' : 'ROUND ' + (g.round + 1) + ' / ' + g.rounds;
    const top = h('header', { class: 'ntop' },
      h('div', { class: 'ni1' }, g ? h('div', { class: 'code mono', text: g.code }) : null, h('div', null, h('div', { class: 'rl', text: label }), h('div', { class: 'ph muted', text: g ? 'phase: ' + phase : 'Open /host and create a game' }))),
      dyn.timer, dyn.prog,
      h('div', { class: 'nctl' }, btns, err ? h('span', { class: 'err', text: err }) : null,
        h('a', { class: 'sbtn sec', href: '/host', target: '_blank', rel: 'noopener', text: 'Host' }),
        h('a', { class: 'sbtn sec', href: '/host/review', target: '_blank', rel: 'noopener', text: 'Review' })));
    const old = $('.ntop');
    if (old) old.replaceWith(top); else root.prepend(top);
    updateDyn();
  }

  function updateDyn() {
    if (!st || !st.game) return;
    const g = st.game;
    if (dyn.timer) {
      if (g.phase === 'question') { const s = Math.ceil(remaining() / 1000); dyn.timer.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); dyn.timer.classList.toggle('low', s <= 10); }
      else dyn.timer.textContent = '';
    }
    if (dyn.prog) {
      if (g.phase === 'question' || g.phase === 'reveal') dyn.prog.textContent = 'answered ' + (st.answered || 0) + ' / ' + (st.answerTotal || 0);
      else if (g.phase === 'lobby') dyn.prog.textContent = (st.names ? st.names.length : 0) + ' players joined';
      else if (g.phase === 'running' && st.board) dyn.prog.textContent = st.board.finished + ' of ' + st.board.total + ' finished';
      else dyn.prog.textContent = '';
    }
  }

  // ---------- body ----------
  const list = (arr) => (arr && arr.length ? h('ul', null, arr.map((m) => h('li', null, bi(m)))) : h('div', { class: 'muted', text: 'none set for this round' }));

  function roundBody(r, phase, rv) {
    const best = r.options.find((o) => o.score === 1000);
    const counts = new Map(); if (rv) rv.options.forEach((o) => counts.set(o.key, o.count));
    const total = rv ? rv.options.reduce((a, o) => a + o.count, 0) : 0;
    const rc = r.realCase;
    return [
      h('section', { class: 'nsec head' },
        h('div', { class: 'nk muted', text: 'Round ' + r.id + '  -  ' + r.clock + '  -  ' + r.place.en + '  -  ' + r.minutes + ' min' }),
        h('h1', null, bi(r.title)),
        h('div', { class: 'nq' }, h('small', { class: 'muted', text: 'Question' }), bi(r.question, 'qq'))),
      h('div', { class: 'cols' },
        h('div', { class: 'col' },
          ...(rv ? [h('section', { class: 'nsec' }, h('h2', { text: 'Options' + (phase === 'reveal' || phase === 'leaderboard' ? ' - how the room answered' : '') }),
            r.options.map((o, i) => h('div', { class: 'nopt' + (o.score === 1000 ? ' best' : '') + (o.knockout ? ' ko' : '') },
              h('span', { class: 'shape s' + i, text: SHAPES[i] }),
              h('div', { class: 'ob' },
                h('div', { class: 'oh' }, h('b', { text: o.key }), o.score === 1000 ? h('span', { class: 'badge best', text: 'Best' }) : o.score > 0 ? h('span', { class: 'badge', text: 'Partly right' }) : null, o.knockout ? h('span', { class: 'badge ko', text: 'Knock-out' }) : null,
                  rv ? h('span', { class: 'cnt mono', text: (counts.get(o.key) || 0) + ' (' + Math.round(((counts.get(o.key) || 0) / (total || 1)) * 100) + '%)' }) : null),
                bi(o.text, 'ot'), h('div', { class: 'of' }, bi(o.feedback)))))), h('section', { class: 'nsec bestbox' }, h('h2', { text: 'Best answer' }),
            h('div', { class: 'bestrow' }, h('span', { class: 'shape s' + r.options.indexOf(best), text: SHAPES[r.options.indexOf(best)] }), h('div', null, h('b', { text: best.key + '.' }), bi(best.text, 'bt'))),
            h('h3', { text: 'Why it is best' }),
            h('ul', { class: 'why' }, r.why.map((w) => h('li', null, h('span', { class: 'tag', title: TAGS[w.tag] + ' / ' + TAGS_AR[w.tag], text: w.tag }), h('div', null, bi(w.text))))))] : [h('section', { class: 'nsec bestbox' }, h('h2', { text: 'Best answer' }),
            h('div', { class: 'bestrow' }, h('span', { class: 'shape s' + r.options.indexOf(best), text: SHAPES[r.options.indexOf(best)] }), h('div', null, h('b', { text: best.key + '.' }), bi(best.text, 'bt'))),
            h('h3', { text: 'Why it is best' }),
            h('ul', { class: 'why' }, r.why.map((w) => h('li', null, h('span', { class: 'tag', title: TAGS[w.tag] + ' / ' + TAGS_AR[w.tag], text: w.tag }), h('div', null, bi(w.text)))))), h('section', { class: 'nsec' }, h('h2', { text: 'Options' + (phase === 'reveal' || phase === 'leaderboard' ? ' - how the room answered' : '') }),
            r.options.map((o, i) => h('div', { class: 'nopt' + (o.score === 1000 ? ' best' : '') + (o.knockout ? ' ko' : '') },
              h('span', { class: 'shape s' + i, text: SHAPES[i] }),
              h('div', { class: 'ob' },
                h('div', { class: 'oh' }, h('b', { text: o.key }), o.score === 1000 ? h('span', { class: 'badge best', text: 'Best' }) : o.score > 0 ? h('span', { class: 'badge', text: 'Partly right' }) : null, o.knockout ? h('span', { class: 'badge ko', text: 'Knock-out' }) : null,
                  rv ? h('span', { class: 'cnt mono', text: (counts.get(o.key) || 0) + ' (' + Math.round(((counts.get(o.key) || 0) / (total || 1)) * 100) + '%)' }) : null),
                bi(o.text, 'ot'), h('div', { class: 'of' }, bi(o.feedback))))))]),
        ),
        h('div', { class: 'col' },
          h('section', { class: 'nsec fbox' }, h('h4', { text: 'Key messages' }), list(r.keyMessages), h('h4', { text: 'Discussion prompts' }), list(r.discussion)),
          h('section', { class: 'nsec' }, h('h2', { text: 'Real case' + (rc.status === 'partly' ? ' (reported, partly verified)' : '') }), h('b', null, bi(rc.title)), h('div', null, bi(rc.text)), h('small', { class: 'muted' }, 'Source: ', bi(rc.source)),
            h('div', { class: 'chips' }, r.standards.map((s) => h('span', { class: 'chip', text: s })))))),
    ];
  }

  function nextUp() {
    const g = st.game;
    const nx = g.phase === 'leaderboard' || g.phase === 'reveal' || g.phase === 'question' || g.phase === 'scene' ? roundOf(g.round + 1) : null;
    if (g.phase === 'final' || g.phase === 'lobby') return null;
    return h('div', { class: 'nextup' }, nx ? [h('b', { text: 'Next up: ' }), 'Round ' + nx.id + ' - ' + nx.title.en + ' (' + nx.place.en + ')'] : h('b', { text: 'This is the last round. Final podium comes next.' }));
  }

  function render() {
    const g = st.game;
    const body = h('div', { class: 'nbody' });
    if (!g) body.append(h('div', { class: 'nsec' }, h('h1', { text: 'No game is running' }), h('p', { text: 'Create a game on the host screen (/host). This page follows it automatically.' })));
    else if (g.phase === 'final' || g.phase === 'running') {
      const rounds = g.roundIds.map((id) => byId.get(id)).filter(Boolean);
      const running = g.phase === 'running';
      body.append(h('div', { class: 'nsec' }, h('h1', { text: running ? 'Self-paced: people are on different rounds' : 'Game finished - wrap-up' }), h('p', { class: 'muted', text: running ? 'These notes do not follow one round. Key messages for your debrief are below; progress is on the host screen.' : 'Key messages from the rounds you played. Tell players to open their personal report on their phone.' })),
        ...rounds.map((r) => h('section', { class: 'nsec fbox' }, h('h4', { text: 'Round ' + r.id + ': ' + r.title.en }), list(r.keyMessages))));
    } else {
      const idx = g.phase === 'lobby' ? 0 : g.round;
      const r = roundOf(idx);
      if (!r) body.append(h('div', { class: 'nsec' }, h('p', { text: 'Round not found in content.' })));
      else {
        if (g.phase === 'lobby') body.append(h('div', { class: 'nextup' }, h('b', { text: 'Lobby. ' }), 'First round: ' + r.title.en + '. ' + g.rounds + ' rounds selected.'));
        body.append(...roundBody(r, g.phase, st.reveal));
        const n = nextUp(); if (n) body.append(n);
      }
    }
    const old = $('.nbody');
    if (old) old.replaceWith(body); else root.append(body);
  }

  function applyState(r) {
    if (r.same) { updateDyn(); return; }
    st = r; recvAt = performance.now(); version = r.version;
    if (!st.game) { if (key !== 'none') { key = 'none'; render(); renderTop(); } updateDyn(); return; }
    const k = phaseKey();
    if (k !== key) { key = k; render(); renderTop(); }
    else updateDyn();
  }

  async function poll() {
    try { applyState(await api('/api/host/state' + (version != null ? '?v=' + version : ''))); }
    catch (e) { if (e.status === 401) { polling = false; P.staffLogin(root, boot); return; } }
    setTimeout(poll, 1000);
  }

  async function boot() {
    try {
      content = await api('/api/host/content');
      byId = new Map(content.rounds.map((r) => [r.id, r]));
    } catch (e) { if (e.status === 401) return P.staffLogin(root, boot); root.replaceChildren(h('p', { class: 'err', text: 'Could not load: ' + e.message })); return; }
    root.replaceChildren(); key = ''; version = null; st = null;
    if (!polling) { polling = true; setInterval(() => { if (st) updateDyn(); }, 250); }
    poll();
  }
  boot();
})();
