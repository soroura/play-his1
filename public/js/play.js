(function () {
  const { h, $, tr, api, store, SHAPES, TAGS, TAGS_AR } = P;
  const root = $('#root');
  const token = store('play_token');
  if (!token) { location.replace('/'); return; }
  let st = null, lang = 'en', version = null, key = '', recvAt = 0, timerEl = null, barEl = null, offline = false, busy = false;

  const T = {
    en: {
      in: 'You are in', wait: 'Waiting for the host to start', players: (n) => n + ' players joined',
      look: 'Look at the shared screen', round: (i, n) => 'Round ' + i + ' of ' + n,
      locked: 'Answer locked', lockedSub: 'Waiting for the others and the reveal', none: 'No answer sent',
      best: 'Best answer', partly: 'Partly right', wrong: 'Not this time', knockout: 'Knock-out', pts: 'points',
      bonus: (b) => '+' + b + ' speed bonus', bestWas: 'Best answer', next: 'Wait for the next round',
      rank: (r, n) => 'You are ' + r + ' of ' + n, total: 'Total', final: 'Game over', report: 'Open my report', help: 'How to play',
      gotit: 'Got it', lost: 'Connection lost, retrying...', time: 'Time is up', sent: 'Sending...', ko: 'Knock-out',
      howTitle: 'How to play',
      how: ['Watch the shared screen: a survey day unfolds at the hospital.', 'Answer on your own device before the timer ends.', 'Faster right answers score more.', 'Some choices are Knock-outs: they would fail a real GAHAR survey.', 'At the end, open your personal report.'],
      howPhones: ['A survey day unfolds at the hospital: read each scene here on your phone.', 'The facilitator moves everyone to the next step.', 'Answer before the timer ends. Faster right answers score more.', 'Some choices are Knock-outs: they would fail a real GAHAR survey.', 'At the end, open your personal report.'],
      howSelf: ['A survey day unfolds at the hospital: read each scene here on your phone.', 'Go at your own speed. There is no timer, and you can leave and come back on this device.', 'Each answer gets feedback straight away. Then tap Next.', 'Some choices are Knock-outs: they would fail a real GAHAR survey.', 'At the end, open your personal report.'],
      showAll: 'Show all', goQ: 'Go to the question', waitQ: 'The facilitator will open the question', reread: 'Read the scene again', why: 'Why', real: 'Real case', reported: 'reported', source: 'Source', std: 'Standards',
      nextRound: 'Next round', seeResult: 'See my result', done: 'You finished', doneSub: 'Your rank can change while others finish.', waitNext: 'The facilitator will move on',
    },
    ar: {
      in: 'لقد انضممت', wait: 'في انتظار بدء المقدم', players: (n) => 'انضم ' + n + ' لاعب',
      look: 'انظر إلى الشاشة المشتركة', round: (i, n) => 'الجولة ' + i + ' من ' + n,
      locked: 'تم تثبيت إجابتك', lockedSub: 'في انتظار الآخرين ثم الكشف', none: 'لم ترسل إجابة',
      best: 'أفضل إجابة', partly: 'صحيحة جزئيا', wrong: 'ليس هذه المرة', knockout: 'إقصاء', pts: 'نقطة',
      bonus: (b) => '+' + b + ' مكافأة سرعة', bestWas: 'أفضل إجابة', next: 'انتظر الجولة التالية',
      rank: (r, n) => 'ترتيبك ' + r + ' من ' + n, total: 'المجموع', final: 'انتهت اللعبة', report: 'افتح تقريري', help: 'كيف تلعب',
      gotit: 'فهمت', lost: 'انقطع الاتصال، جارٍ إعادة المحاولة...', time: 'انتهى الوقت', sent: 'جارٍ الإرسال...', ko: 'إقصاء',
      howTitle: 'كيف تلعب',
      how: ['شاهد الشاشة المشتركة: يوم مسح يجري في المستشفى.', 'أجب على جهازك قبل انتهاء المؤقت.', 'الإجابات الصحيحة الأسرع تحصل على نقاط أكثر.', 'بعض الخيارات إقصائية: ستفشل في مسح GAHAR حقيقي.', 'في النهاية افتح تقريرك الشخصي.'],
      howPhones: ['يوم مسح يجري في المستشفى: اقرأ كل مشهد هنا على هاتفك.', 'ينقل الميسر الجميع إلى الخطوة التالية.', 'أجب قبل انتهاء المؤقت. الإجابات الصحيحة الأسرع تحصل على نقاط أكثر.', 'بعض الخيارات إقصائية: ستفشل في مسح GAHAR حقيقي.', 'في النهاية افتح تقريرك الشخصي.'],
      howSelf: ['يوم مسح يجري في المستشفى: اقرأ كل مشهد هنا على هاتفك.', 'تقدم بالسرعة التي تناسبك. لا يوجد مؤقت، ويمكنك المغادرة والعودة على هذا الجهاز.', 'تحصل على التعليق فور كل إجابة. ثم اضغط التالي.', 'بعض الخيارات إقصائية: ستفشل في مسح GAHAR حقيقي.', 'في النهاية افتح تقريرك الشخصي.'],
      showAll: 'اعرض الكل', goQ: 'انتقل إلى السؤال', waitQ: 'سيفتح الميسر السؤال', reread: 'اقرأ المشهد مرة أخرى', why: 'السبب', real: 'حالة حقيقية', reported: 'وفق تقارير', source: 'المصدر', std: 'المعايير',
      nextRound: 'الجولة التالية', seeResult: 'اعرض نتيجتي', done: 'لقد انتهيت', doneSub: 'قد يتغير ترتيبك بينما ينهي الآخرون.', waitNext: 'سينتقل الميسر إلى الخطوة التالية',
    },
  };
  const t = () => T[lang];

  const mode = () => (st && st.game && st.game.mode) || 'screen';
  function helpCard(onClose) {
    const list = mode() === 'self' ? t().howSelf : mode() === 'phones' ? t().howPhones : t().how;
    return h('div', { class: 'card' }, h('h2', { text: t().howTitle }), h('ol', null, list.map((x) => h('li', { text: x }))),
      h('button', { class: 'btn', style: 'margin-top:16px;width:100%', onclick: onClose, text: t().gotit }));
  }
  let showHelp = false;
  try { showHelp = !sessionStorage.getItem('play_help_seen'); } catch (e) { /* ignore */ }
  function closeHelp() { showHelp = false; try { sessionStorage.setItem('play_help_seen', '1'); } catch (e) { /* ignore */ } key = ''; render(); }

  function frame(...kids) {
    return h('div', { class: 'screen', dir: lang === 'ar' ? 'rtl' : 'ltr', lang },
      h('div', { class: 'topline' },
        h('span', { class: 'nm', text: st.name }),
        h('span', { style: 'display:flex;gap:6px' },
          h('button', { class: 'langbtn', onclick: () => { showHelp = true; key = ''; render(); }, text: '?' }),
          h('button', { class: 'langbtn', onclick: switchLang, text: lang === 'ar' ? 'EN' : 'ع' }))),
      offline ? h('div', { class: 'toast offline', text: t().lost }) : null,
      ...kids);
  }
  async function switchLang() {
    const nl = lang === 'ar' ? 'en' : 'ar';
    store('play_lang', nl);
    try { await api('/api/join', { token, lang: nl }); } catch (e) { /* ignore */ }
    st.lang = nl; lang = nl; key = ''; render();
  }
  function mount(node) { root.replaceChildren(node); }

  function sceneInfo() {
    const r = st.round;
    return h('div', { class: 'center' },
      h('div', { class: 'sub', text: t().round(r.index + 1, st.game.rounds) + (r.clock ? ' - ' + r.clock : '') }),
      h('div', { class: 'big', text: tr(r.title, lang) }),
      h('div', { class: 'sub', text: tr(r.place, lang) }),
      h('div', { class: 'card', style: 'margin-top:10px', text: t().look }));
  }

  // ---------- scene on the phone (phones and self-paced modes) ----------
  let sceneTimer = null;
  const sceneShown = {}; // lines already shown per round, so a re-render does not replay the scene
  const LINE_MS = 1400;
  function sceneBox(r, sc, lines) {
    return h('div', { class: 'psc psc-' + sc.style },
      sc.image ? h('img', { class: 'pimg', src: '/' + sc.image, alt: tr(r.title, lang) }) : null,
      lines.map(lineEl));
  }
  function lineEl(ln) {
    return h('div', { class: 'pl ' + ln.tone }, ln.t ? h('span', { class: 't', text: ln.t }) : null, ln.who ? h('b', { text: ln.who }) : null, h('span', { class: 'x', text: tr(ln.text, lang) }));
  }
  function phoneScene() {
    const r = st.round, sc = st.scene, lines = sc.lines, self = mode() === 'self', from = 'scene:' + st.game.round;
    let shown = sceneShown[r.id] || 0;
    const box = sceneBox(r, sc, lines.slice(0, shown));
    const action = h('div', { class: 'pact' });
    const showAll = h('button', { class: 'btn sec', text: t().showAll, onclick: () => { clearTimeout(sceneTimer); while (shown < lines.length) addLine(false); } });
    function refresh() {
      if (shown < lines.length) action.replaceChildren(showAll);
      else if (self) action.replaceChildren(h('button', { class: 'btn', text: t().goQ, onclick: () => selfGo(from) }));
      else action.replaceChildren(h('div', { class: 'sub', text: t().waitQ }));
    }
    function addLine(scroll) {
      const el = lineEl(lines[shown++]);
      sceneShown[r.id] = shown;
      box.append(el);
      refresh();
      if (scroll && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
    function step() { if (shown < lines.length) { addLine(true); sceneTimer = setTimeout(step, LINE_MS); } }
    refresh();
    if (shown < lines.length) sceneTimer = setTimeout(step, 500);
    return [
      h('div', { class: 'pshead' }, h('div', { class: 'sub', text: t().round(r.index + 1, st.game.rounds) + (r.clock ? ' - ' + r.clock : '') }), h('div', { class: 'big', text: tr(r.title, lang) }), h('div', { class: 'sub', text: tr(r.place, lang) })),
      box, action];
  }
  async function selfGo(from) {
    if (busy) return;
    busy = true;
    try { await api('/api/next', { token, from }); }
    catch (e) { toast(e.offline ? t().lost : e.message); }
    busy = false; version = null; poll(true);
  }
  function detailCards() {
    const d = st.detail;
    if (!d) return null;
    const rc = d.realCase, tags = lang === 'ar' ? TAGS_AR : TAGS;
    return [
      h('div', { class: 'card pd' }, h('h3', { text: t().why }), h('ul', { class: 'pwhy' }, d.why.map((w) => h('li', null, h('span', { class: 'ptag', title: tags[w.tag] || '', text: w.tag }), h('div', { text: tr(w.text, lang) }))))),
      h('div', { class: 'card pd' }, h('h3', { text: t().real + (rc.status === 'partly' ? ' (' + t().reported + ')' : '') }), h('b', { text: tr(rc.title, lang) }), h('div', { text: tr(rc.text, lang) }), h('small', { class: 'psrc', text: t().source + ': ' + tr(rc.source, lang) })),
      d.standards.length ? h('div', { class: 'pstd' }, h('small', { text: t().std + ': ' }), d.standards.map((s) => h('span', { text: s }))) : null];
  }

  function remaining() { return Math.max(0, (st.game.remainingMs || 0) - (performance.now() - recvAt)); }

  function questionView() {
    const r = st.round, locked = st.answer, self = mode() === 'self';
    timerEl = self ? null : h('div', { class: 'timernum', text: '' });
    barEl = self ? null : h('div', null);
    const tiles = r.options.map((o, i) => {
      const cls = 'tile c' + i + (locked ? (locked.key === o.key ? ' mine' : ' dim') : '');
      return h('button', { class: cls, disabled: !!locked || undefined, 'data-key': o.key, onclick: () => send(o.key) },
        h('span', { class: 'sh', text: SHAPES[i] }), h('span', { text: tr(o.text, lang) }));
    });
    return h('div', { class: 'screen', dir: lang === 'ar' ? 'rtl' : 'ltr', lang },
      h('div', { class: 'topline' }, h('span', { class: 'nm', text: st.name }), h('span', { class: 'pill', text: t().round(r.index + 1, st.game.rounds) })),
      offline ? h('div', { class: 'toast offline', text: t().lost }) : null,
      st.scene ? h('details', { class: 'prere' }, h('summary', { text: t().reread }), sceneBox(r, st.scene, st.scene.lines)) : null,
      h('div', { class: 'qtext', text: tr(r.question, lang) }),
      timerEl, self ? null : h('div', { class: 'timerbar' }, barEl),
      locked ? h('div', { class: 'sub', style: 'text-align:center;margin-bottom:6px', text: self ? t().locked : t().locked + ' - ' + t().lockedSub }) : null,
      h('div', { class: 'tiles' }, tiles));
  }
  function tickTimer() {
    if (!timerEl || !st || st.game.phase !== 'question') return;
    const ms = remaining();
    timerEl.textContent = ms > 0 ? String(Math.ceil(ms / 1000)) : t().time;
    barEl.style.width = Math.max(0, Math.min(100, (ms / (st.game.totalMs || 1)) * 100)) + '%';
  }
  async function send(k) {
    if (busy || st.answer) return;
    busy = true;
    st.answer = { key: k }; key = ''; render(); // optimistic lock
    try { await api('/api/answer', { token, key: k }); }
    catch (e) { if (!e.offline) { st.answer = null; toast(e.message); } else { try { await api('/api/answer', { token, key: k }); } catch (e2) { st.answer = null; toast(e2.message); } } }
    busy = false; version = null; poll(true);
  }
  function toast(msg) { const el = h('div', { class: 'toast', text: msg }); document.body.append(el); setTimeout(() => el.remove(), 3500); }

  function revealView() {
    const r = st.result || {};
    const o = r.outcome || 'none';
    const label = o === 'best' ? t().best : o === 'partly' ? t().partly : o === 'knockout' ? t().knockout : o === 'wrong' ? t().wrong : t().none;
    const opt = st.round.options.find((x) => x.key === r.key);
    const bestOpt = st.round.options.find((x) => x.key === (st.best && st.best.key));
    return frame(
      h('div', { class: 'result ' + o },
        h('div', { class: 'big', text: label }),
        h('div', { class: 'pts', text: '+' + (r.points || 0) }),
        h('div', { text: t().pts + (r.bonus ? ' (' + t().bonus(r.bonus) + ')' : '') }),
        r.knockout ? h('div', { class: 'stamp', text: t().ko }) : null,
        r.feedback ? h('div', { class: 'fb', text: tr(r.feedback, lang) }) : null,
        !r.key && r.bestFeedback ? h('div', { class: 'fb', text: tr(r.bestFeedback, lang) }) : null),
      bestOpt && o !== 'best' ? h('div', { class: 'card', style: 'margin-top:12px' }, h('div', { class: 'sub', text: t().bestWas }), h('div', { style: 'font-size:18px;font-weight:600', text: SHAPES[st.round.options.indexOf(bestOpt)] + ' ' + tr(bestOpt.text, lang) })) : null,
      opt ? null : null,
      detailCards(),
      mode() === 'self'
        ? h('div', { class: 'pact' }, h('button', { class: 'btn', text: st.game.round + 1 < st.game.rounds ? t().nextRound : t().seeResult, onclick: () => selfGo('reveal:' + st.game.round) }))
        : h('div', { class: 'sub', style: 'text-align:center;margin-top:14px', text: mode() === 'phones' ? t().waitNext : t().next }));
  }

  function leaderView() {
    const rk = st.rank;
    return frame(h('div', { class: 'center' },
      h('div', { class: 'rankbox' },
        h('div', { class: 'sub', text: rk ? t().rank(rk.rank, rk.of) : '' }),
        h('div', { class: 'r', text: rk ? '#' + rk.rank : '-' }),
        h('div', { class: 'big', text: rk ? t().total + ': ' + rk.total : '' }),
        rk && rk.delta ? h('div', { class: 'sub', text: '+' + rk.delta }) : null),
      h('div', { class: 'sub', text: t().next })));
  }

  function finalView() {
    const rk = st.rank || { rank: '-', of: '-', total: 0 };
    const pod = (st.podium || []).map((p, i) => h('div', { class: 'p' + (i + 1) }, h('b', { text: '#' + p.rank }), h('span', { text: p.name })));
    return frame(h('div', { class: 'center' },
      h('div', { class: 'big', text: t().final }),
      pod.length ? h('div', { class: 'podium', style: 'width:100%' }, pod) : null,
      h('div', { class: 'rankbox', style: 'width:100%' },
        h('div', { class: 'sub', text: t().rank(rk.rank, rk.of) }),
        h('div', { class: 'big', text: t().total + ': ' + rk.total })),
      h('a', { class: 'btn', style: 'text-decoration:none;display:block;width:100%;text-align:center', href: '/report/' + token, text: t().report })));
  }

  function doneView() {
    const rk = st.rank || { rank: '-', of: '-', total: 0 };
    return frame(h('div', { class: 'center' },
      h('div', { class: 'big', text: t().done }),
      h('div', { class: 'rankbox', style: 'width:100%' },
        h('div', { class: 'sub', text: t().rank(rk.rank, rk.of) }),
        h('div', { class: 'r', text: '#' + rk.rank }),
        h('div', { class: 'big', text: t().total + ': ' + rk.total })),
      h('div', { class: 'sub', text: t().doneSub }),
      h('a', { class: 'btn', style: 'text-decoration:none;display:block;width:100%;text-align:center', href: '/report/' + token, text: t().report })));
  }

  let lastSpot = '';
  function render() {
    if (!st) return;
    lang = st.lang === 'ar' ? 'ar' : 'en';
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    const g = st.game;
    const k = [g.phase, g.round, st.answer && st.answer.key, lang, showHelp, offline, g.phase === 'lobby' ? st.players : '', g.phase === 'done' && st.rank ? st.rank.rank + '/' + st.rank.of : ''].join('|');
    if (k === key) return;
    key = k; timerEl = null; barEl = null; clearTimeout(sceneTimer);
    const spot = g.phase + ':' + g.round;
    if (spot !== lastSpot) { lastSpot = spot; window.scrollTo(0, 0); }
    if (showHelp) { mount(frame(helpCard(closeHelp))); return; }
    switch (g.phase) {
      case 'lobby': mount(frame(h('div', { class: 'center' }, h('div', { class: 'big', text: t().in }), h('div', { class: 'sub', text: st.name }), h('div', { class: 'sub', text: t().wait + h0() }), h('div', { class: 'pill', text: t().players(st.players || 0) })))); break;
      case 'scene': mount(st.scene ? frame(phoneScene()) : frame(sceneInfo())); break;
      case 'done': mount(doneView()); break;
      case 'question': mount(questionView()); tickTimer(); break;
      case 'reveal': mount(revealView()); break;
      case 'leaderboard': mount(leaderView()); break;
      case 'final': mount(finalView()); break;
    }
  }
  const h0 = () => '';

  let timer = null;
  async function poll(force) {
    clearTimeout(timer);
    try {
      const r = await api('/api/state?token=' + encodeURIComponent(token) + (version != null && !force ? '&v=' + version : ''));
      if (offline) { offline = false; key = ''; }
      if (!r.same) { st = r; recvAt = performance.now(); version = r.version; if (!st.answer && st.game.phase === 'question') st.answer = null; }
      else if (st) { st.version = version; }
      render();
    } catch (e) {
      if (e.status === 404) { store('play_token', null); location.replace('/'); return; }
      if (!offline) { offline = true; key = ''; render(); }
    }
    timer = setTimeout(poll, 1500);
  }
  setInterval(tickTimer, 200);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(true); });
  window.addEventListener('online', () => poll(true));
  poll(true);
})();
