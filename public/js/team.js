/* Main facilitator only: add and remove facilitators, see which rooms are open. All text goes through textContent. */
(function () {
  const { h, $, api } = P;
  const root = $('#root');
  const MODE = { screen: 'Shared screen', phones: 'Phones, facilitator paces', self: 'Self-paced' };
  const PHASE = (r) => (r.phase === 'lobby' ? 'in the lobby' : r.phase === 'running' ? 'running' : r.phase === 'final' ? 'finished' : 'running');
  let shell = null, tableBox = null, pinBox = null, err = null, timer = null;

  const message = (name, pin) => 'You have facilitator access to the survey game, ' + name + '.\nLog in: ' + location.origin + '/host\nYour PIN: ' + pin + '\nHow to run it: ' + location.origin + '/host/help\nYou get your own room, so nothing you do affects other groups. Please keep the PIN private: it also shows the answers to every round.';
  async function copy(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; } ta.remove();
    }
    const old = btn.textContent; btn.textContent = ok ? 'Copied' : 'Copy failed: select the text'; setTimeout(() => { btn.textContent = old; }, 1800);
  }
  function showPin(r, verb) {
    const b = h('button', { class: 'sbtn', text: 'Copy message for chat', onclick: () => copy(message(r.name, r.pin), b) });
    pinBox.replaceChildren(h('div', { class: 'tpin' },
      h('div', null, h('b', { text: r.name }), ' ' + verb + '. This PIN is shown only once:'),
      h('div', { class: 'big', text: r.pin }),
      h('div', { class: 'row' }, b, h('button', { class: 'sbtn sec', text: 'Done', onclick: () => pinBox.replaceChildren() }))));
  }
  async function call(path, body, after) {
    err.textContent = '';
    try { const r = await api(path, body); if (after) after(r); await load(); }
    catch (e) { if (e.status === 401) return P.staffLogin(root, boot); err.textContent = e.message; }
  }
  const roomText = (room) => (room ? 'Room ' + room.code + ': ' + (MODE[room.mode] || room.mode) + ', ' + PHASE(room) + ', ' + room.players + (room.players === 1 ? ' player' : ' players') : 'No room open');
  const when = (ms) => (ms ? new Date(ms).toLocaleString() : 'Not yet');

  function draw(d) {
    tableBox.replaceChildren(
      h('div', { class: 'twrap' }, h('table', { class: 'ttable' },
        h('thead', null, h('tr', null, h('th', { text: 'Facilitator' }), h('th', { text: 'Room' }), h('th', { text: 'Last login' }), h('th'))),
        h('tbody', null,
          h('tr', null, h('td', null, h('b', { text: 'You' }), ' (main)'), h('td', { text: roomText(d.main.room) }), h('td', { text: '' }), h('td')),
          d.facilitators.map((f) => h('tr', null,
            h('td', { text: f.name }), h('td', { text: roomText(f.room) }), h('td', { text: when(f.lastLogin) }),
            h('td', { class: 'acts' },
              h('button', { class: 'sbtn sec', text: 'New PIN', onclick: () => { if (confirm('Give ' + f.name + ' a new PIN? The old PIN and their current login stop working.')) call('/api/host/team/pin', { id: f.id }, (r) => showPin(r, 'has a new PIN')); } }),
              h('button', { class: 'sbtn sec danger', text: 'Remove', onclick: () => { if (confirm('Remove ' + f.name + '? Access stops now and any room they have open ends for its players, who keep their reports.')) call('/api/host/team/remove', { id: f.id }); } }))))))),
      ...(d.facilitators.length ? [] : [h('p', { class: 'muted tnote', text: 'Nobody added yet.' })]));
  }
  async function load() {
    try { draw(await api('/api/host/team')); }
    catch (e) {
      clearInterval(timer); timer = null;
      if (e.status === 401) return P.staffLogin(root, boot);
      root.replaceChildren(h('div', { class: 'team' }, h('h1', { text: 'Facilitators' }), h('p', { text: e.status === 403 ? 'Only the main facilitator can manage this list. You can run your own room from the host screen.' : 'Could not load: ' + e.message }), h('a', { class: 'sbtn', href: '/host', text: 'Go to the host screen' })));
    }
  }
  async function boot() {
    const name = h('input', { type: 'text', maxlength: 20, placeholder: 'Name', 'aria-label': 'Facilitator name' });
    const add = async () => { const v = name.value.trim(); if (!v) { name.focus(); return; } await call('/api/host/team/add', { name: v }, (r) => { showPin(r, 'added'); name.value = ''; }); };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    pinBox = h('div'); tableBox = h('div'); err = h('div', { class: 'err' });
    shell = h('div', { class: 'team' },
      h('h1', { text: 'Facilitators' }),
      h('p', { class: 'muted', text: 'Each person gets their own PIN and their own room, so several groups can run at once and nobody can end another group\'s game. They can also read all rounds and answers, but cannot see or change this list.' }),
      h('div', { class: 'tadd' }, name, h('button', { class: 'sbtn', text: 'Add facilitator', onclick: add }), h('a', { class: 'sbtn sec', href: '/host', text: 'Host screen' })),
      err, pinBox, h('h2', { text: 'People and rooms' }), tableBox);
    root.replaceChildren(shell);
    await load();
    if (!timer) timer = setInterval(load, 10000);
  }
  boot();
})();
