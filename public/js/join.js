(function () {
  const { $, api, store } = P;
  let lang = store('play_lang') === 'ar' ? 'ar' : 'en';
  const T = {
    en: { code: 'Room code', nick: 'Nickname', lang: 'Language', go: 'Join', ph: 'Your name', bad: 'Enter the 4-digit room code and a nickname' },
    ar: { code: 'رمز الغرفة', nick: 'الاسم المستعار', lang: 'اللغة', go: 'انضم', ph: 'اسمك', bad: 'أدخل رمز الغرفة المكون من 4 أرقام والاسم المستعار' },
  };
  function setLang(l) {
    lang = l;
    document.documentElement.lang = l;
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    $('#lcode').textContent = T[l].code; $('#lnick').textContent = T[l].nick; $('#llang').textContent = T[l].lang;
    $('#go').textContent = T[l].go; $('#nick').placeholder = T[l].ph;
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.l === l));
  }
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.l)));
  setLang(lang);
  const q = new URLSearchParams(location.search);
  const linkCode = /^\d{4}$/.test(q.get('code') || '') ? q.get('code') : '';
  if (linkCode) { $('#code').value = linkCode; setTimeout(() => $('#nick').focus(), 50); }
  $('#code').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
  store('play_nick') && ($('#nick').value = store('play_nick'));

  // silent rejoin
  const tok = store('play_token');
  if (tok) api('/api/join', linkCode ? { token: tok, code: linkCode } : { token: tok }).then((r) => { store('play_lang', r.lang); location.replace('/play'); }).catch((e) => { if (e.status === 404 || e.status === 409) store('play_token', null); });

  $('#f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const code = $('#code').value.trim(), nickname = $('#nick').value.trim();
    if (!/^\d{4}$/.test(code) || !nickname) { $('#err').textContent = T[lang].bad; return; }
    $('#go').disabled = true; $('#err').textContent = '';
    try {
      const r = await api('/api/join', { code, nickname, lang });
      store('play_token', r.token); store('play_lang', r.lang); store('play_nick', nickname);
      try { sessionStorage.removeItem('play_help_seen'); } catch (e) { /* ignore */ }
      location.href = '/play';
    } catch (e) { $('#err').textContent = e.offline ? 'No connection. Try again.' : e.message; $('#go').disabled = false; }
  });
})();
