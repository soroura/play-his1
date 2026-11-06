(function () {
  const { h, $, api, store, SHAPES, TAGS, TAGS_AR } = P;
  const root = $('#root');
  let data = null;
  let lang = ['en', 'ar', 'both'].includes(store('rev_lang')) ? store('rev_lang') : 'both';
  let filter = ['all', 'core', 'extra'].includes(store('rev_filter')) ? store('rev_filter') : 'all';

  // bilingual text according to the language toggle; s may be a plain string (real case fields)
  function bi(o, cls) {
    if (o == null) return null;
    if (typeof o === 'string') return h('div', { class: cls || '', text: o });
    const out = [];
    if (lang !== 'ar' || !o.ar) out.push(h('div', { class: cls || '', text: o.en }));
    if (lang !== 'en' && o.ar) out.push(h('div', { class: 'ar ' + (cls || ''), dir: 'rtl', text: o.ar }));
    return out;
  }
  const setOf = (r) => r.set || 'core';
  const minOf = (r) => r.minutes || 8;
  const visible = () => data.rounds.filter((r) => filter === 'all' || setOf(r) === filter);

  function toolbar(list) {
    const seg = (items, cur, set) => h('span', { class: 'seg' }, items.map(([k, label]) => h('button', { class: 'sbtn sec' + (cur === k ? ' on' : ''), onclick: () => set(k), text: label })));
    const mins = list.reduce((a, r) => a + minOf(r), 0);
    return h('header', { class: 'tb' },
      h('div', null, h('h1', { text: 'Round review' }), h('div', { class: 'muted', text: data.meta.title.en + ' - ' + list.length + ' rounds shown, about ' + mins + ' min (plus 5 min intro and close)' })),
      h('div', { class: 'tools' },
        seg([['en', 'EN'], ['ar', 'AR'], ['both', 'EN + AR']], lang, (k) => { lang = k; store('rev_lang', k); draw(); }),
        seg([['all', 'All'], ['core', 'Core'], ['extra', 'Extra']], filter, (k) => { filter = k; store('rev_filter', k); draw(); }),
        h('button', { class: 'sbtn', onclick: () => window.print(), text: 'Print' }),
        h('a', { class: 'sbtn sec', href: '/host', target: '_blank', rel: 'noopener', text: 'Host' }),
        h('a', { class: 'sbtn sec', href: '/host/notes', target: '_blank', rel: 'noopener', text: 'Notes' })));
  }

  function legend() {
    return h('div', { class: 'legend' }, h('b', { text: 'Why tags: ' }), Object.keys(TAGS).map((k) => h('span', { class: 'lg' }, h('span', { class: 'tag', text: k }), TAGS[k] + (lang !== 'en' ? ' / ' + TAGS_AR[k] : ''))));
  }

  function nav(list) {
    return h('nav', { class: 'nav', 'aria-label': 'Rounds' }, list.map((r) => h('a', { href: '#r-' + r.id, class: 'ni', onclick: (e) => { e.preventDefault(); const t = document.getElementById('r-' + r.id); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
      h('span', { class: 'n', text: r.id }), h('span', { class: 'tt' }, h('span', { text: r.title.en }), h('small', null, h('span', { class: 'badge ' + setOf(r), text: setOf(r) }), ' ' + minOf(r) + ' min')))));
  }

  function sceneBlock(r) {
    const s = r.scene;
    return h('div', { class: 'scene' },
      h('div', { class: 'lbl' }, h('b', { text: 'Scene' }), '  style: ', h('code', { text: s.style }), s.image ? ['  image: ', h('code', { text: s.image })] : null, '  ' + s.lines.length + ' lines'),
      s.lines.map((ln) => h('div', { class: 'ln ' + ln.tone },
        h('span', { class: 'lt mono', text: ln.t || '' }),
        h('span', { class: 'lw', text: ln.who || '' }),
        h('div', { class: 'lx' }, bi(ln.text)),
        h('span', { class: 'tn', text: ln.tone }))));
  }

  function optionRows(r) {
    return h('div', { class: 'opts' }, r.options.map((o, i) => h('div', { class: 'opt' + (o.score === 1000 ? ' best' : '') + (o.knockout ? ' ko' : '') },
      h('span', { class: 'shape s' + i, 'aria-hidden': 'true', text: SHAPES[i] }),
      h('div', { class: 'ob' },
        h('div', { class: 'oh' }, h('b', { text: o.key }), o.score === 1000 ? h('span', { class: 'badge best', text: 'Best answer' }) : null, o.knockout ? h('span', { class: 'badge ko', text: 'Knock-out' }) : null, h('span', { class: 'pts mono', text: o.score + ' pts' })),
        h('div', { class: 'ot' }, bi(o.text)),
        h('div', { class: 'of' }, h('small', { class: 'muted', text: 'Feedback' }), bi(o.feedback))))));
  }

  function roundCard(r) {
    const rc = r.realCase;
    const list = (arr) => (arr && arr.length ? h('ul', null, arr.map((m) => h('li', null, bi(m)))) : h('div', { class: 'muted', text: 'none set' }));
    return h('section', { class: 'rcard', id: 'r-' + r.id },
      h('div', { class: 'rh' },
        h('span', { class: 'rn', text: r.id }),
        h('div', { class: 'rt' }, h('h2', null, bi(r.title)), h('div', { class: 'rp muted' }, r.clock + '  -  ', bi(r.place))),
        h('div', { class: 'rm' }, h('span', { class: 'badge ' + setOf(r), text: setOf(r) }), h('span', { class: 'mono', text: minOf(r) + ' min' }), h('span', { class: 'mono muted', text: r.timeLimit + ' s timer' }))),
      sceneBlock(r),
      h('div', { class: 'q' }, h('small', { class: 'muted', text: 'Question' }), bi(r.question, 'qt')),
      optionRows(r),
      h('div', { class: 'two' },
        h('div', { class: 'panel' }, h('h3', { text: 'Why' }), h('ul', { class: 'why' }, r.why.map((w) => h('li', null, h('span', { class: 'tag', title: TAGS[w.tag] + ' / ' + TAGS_AR[w.tag], text: w.tag }), h('div', null, bi(w.text)))))),
        h('div', { class: 'panel' }, h('h3', { text: 'Real case' + (rc.status === 'partly' ? ' (partly verified, say "reported")' : ' (verified)') }),
          h('b', null, bi(rc.title)), h('div', null, bi(rc.text)), h('small', { class: 'muted' }, 'Source: ', bi(rc.source)),
          h('div', { class: 'chips' }, h('small', { class: 'muted', text: 'Standards: ' }), r.standards.map((s) => h('span', { class: 'chip', text: s }))))),
      h('div', { class: 'fbox' }, h('h4', { text: 'Facilitator box' }), h('b', { text: 'Key messages' }), list(r.keyMessages), h('b', { text: 'Discussion prompts' }), list(r.discussion)));
  }

  function draw() {
    const list = visible();
    root.replaceChildren(h('div', { class: 'wrap' }, toolbar(list), legend(),
      h('div', { class: 'layout' }, nav(list), h('main', { class: 'main' }, list.length ? list.map(roundCard) : h('p', { class: 'muted', text: 'No rounds in this filter.' })))));
  }

  async function start() {
    try { data = await api('/api/host/content'); draw(); }
    catch (e) { if (e.status === 401) P.staffLogin(root, start); else root.replaceChildren(h('p', { class: 'err', text: 'Could not load: ' + e.message })); }
  }
  start();
})();
