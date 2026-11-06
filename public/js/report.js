(function () {
  const { h, $, tr, api, store, TAGS, TAGS_AR } = P;
  const root = $('#root');
  const token = decodeURIComponent(location.pathname.split('/').pop() || '');
  let data = null, lang = 'en';
  const T = {
    en: { title: 'My report', total: 'Total points', rank: 'Rank', ko: 'Knock-outs hit', of: 'of', your: 'Your answer', best: 'Best answer', pts: 'points', none: 'You did not answer this round.', late: 'You joined after this round.', why: 'Why', std: 'Standards', real: 'Real case', source: 'Source', reported: 'reported', print: 'Print or save as PDF', lang: 'العربية', out: { best: 'Best answer', partly: 'Partly right', wrong: 'Not this time', knockout: 'Knock-out', none: 'No answer' }, unfinished: 'The game is still running; later rounds will appear after they are revealed.', gone: 'This report is no longer available.', missing: 'Report not found.' },
    ar: { title: 'تقريري', total: 'مجموع النقاط', rank: 'الترتيب', ko: 'إجابات إقصائية', of: 'من', your: 'إجابتك', best: 'أفضل إجابة', pts: 'نقطة', none: 'لم تجب في هذه الجولة.', late: 'انضممت بعد هذه الجولة.', why: 'السبب', std: 'المعايير', real: 'حالة حقيقية', source: 'المصدر', reported: 'وفق تقارير', print: 'اطبع أو احفظ PDF', lang: 'English', out: { best: 'أفضل إجابة', partly: 'صحيحة جزئيا', wrong: 'ليس هذه المرة', knockout: 'إقصاء', none: 'بلا إجابة' }, unfinished: 'اللعبة مستمرة؛ ستظهر الجولات التالية بعد كشفها.', gone: 'هذا التقرير لم يعد متاحا.', missing: 'التقرير غير موجود.' },
  };
  function draw() {
    const t = T[lang], d = data;
    document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t.title + ' - ' + d.name;
    const L = (o) => tr(o, lang);
    const optLabel = (r, key) => { const i = r.options.findIndex((o) => o.key === key); const o = r.options[i]; return o ? ['▲', '◆', '●', '■'][i] + ' ' + L(o.text) : ''; };
    const nodes = [
      h('div', { class: 'bar' }, h('button', { onclick: () => window.print(), text: t.print }), h('button', { class: 'sec', onclick: () => { lang = lang === 'ar' ? 'en' : 'ar'; store('play_lang', lang); draw(); }, text: t.lang })),
      h('h1', { text: t.title + ' - ' + d.name }),
      h('div', { class: 'muted', text: L(d.meta.title) }),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', { text: d.total }), t.total),
        h('div', { class: 'stat' }, h('b', { text: d.rank ? '#' + d.rank : '-' }), t.rank + ' ' + t.of + ' ' + d.of),
        h('div', { class: 'stat' }, h('b', { text: d.knockouts }), t.ko)),
      d.finished ? null : h('p', { class: 'muted', text: t.unfinished }),
      d.rounds.map((r) => {
        const rc = r.realCase, S = (x) => (typeof x === 'string' ? x : L(x));
        return h('section', { class: 'rcard' },
          h('h3', { text: (r.index + 1) + '. ' + L(r.title) }),
          h('div', { class: 'muted', text: r.clock + ' - ' + L(r.place) }),
          h('p', { style: 'font-weight:600;margin:10px 0', text: L(r.question) }),
          h('div', null, h('span', { class: 'badge ' + r.outcome, text: t.out[r.outcome] }), '  ', h('b', { text: r.points + ' ' + t.pts }), r.bonus ? h('span', { class: 'muted', text: '  (+' + r.bonus + ')' }) : null),
          r.answered ? h('div', { class: 'ans you' }, h('small', { text: t.your }), optLabel(r, r.yourKey), r.feedback ? h('div', { class: 'muted', text: L(r.feedback) }) : null) : h('p', { class: 'muted', text: r.joinedAfter ? t.late : t.none }),
          r.best && r.yourKey !== r.best.key ? h('div', { class: 'ans bestans' }, h('small', { text: t.best }), optLabel(r, r.best.key)) : null,
          h('h4', { text: t.why }),
          h('ul', null, r.why.map((w) => h('li', null, h('span', { class: 'tag', title: (lang === 'ar' ? TAGS_AR : TAGS)[w.tag] || '', text: w.tag }), L(w.text)))),
          r.standards.length ? h('div', { class: 'std' }, h('small', { class: 'muted', text: t.std + ': ' }), r.standards.map((s) => h('span', { text: s }))) : null,
          h('div', { class: 'case' }, h('b', { text: t.real + (rc.status === 'partly' ? ' (' + t.reported + ')' : '') + ': ' + S(rc.title) }), h('div', { text: S(rc.text) }), h('small', { class: 'muted', text: t.source + ': ' + S(rc.source) })));
      })];
    root.replaceChildren(...nodes.flat().filter(Boolean));
  }
  api('/api/report/' + encodeURIComponent(token)).then((d) => { data = d; lang = d.lang === 'ar' ? 'ar' : 'en'; draw(); })
    .catch((e) => { root.replaceChildren(h('p', { text: e.status === 410 ? T.en.gone : T.en.missing })); });
})();
