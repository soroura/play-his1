/* Shared helpers. All user and content text goes through textContent. */
(function () {
  const SHAPES = ['▲', '◆', '●', '■'];
  const TAGS = { G: 'Survey guide', S: 'Standards 2025', E: 'Egyptian source', X: 'Beyond GAHAR / external', I: 'Design inference' };
  const TAGS_AR = { G: 'دليل المسح', S: 'معايير 2025', E: 'مصدر مصري', X: 'خارج GAHAR / خارجي', I: 'استنتاج تصميمي' };

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }
  const $ = (s, r) => (r || document).querySelector(s);
  function tr(o, lang) {
    if (o == null) return '';
    if (typeof o === 'string') return o;
    return lang === 'ar' && o.ar ? o.ar : o.en || '';
  }
  async function api(path, body) {
    const opt = body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    let res;
    try { res = await fetch(path, opt); } catch (e) { const err = new Error('offline'); err.offline = true; throw err; }
    let data = {};
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) { const err = new Error(data.error || 'Error ' + res.status); err.status = res.status; throw err; }
    return data;
  }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; }
    return null;
  }
  // PIN login box for the facilitator-only pages (review, notes). onOk runs after a successful login.
  function staffLogin(root, onOk) {
    const pin = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', placeholder: 'PIN', 'aria-label': 'Host PIN' });
    const err = h('div', { class: 'err' });
    const go = async () => {
      try { await api('/api/host/login', { pin: pin.value }); onOk(); }
      catch (e) { err.textContent = e.message; pin.select(); }
    };
    pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    root.replaceChildren(h('div', { class: 'slogin' }, h('h1', { text: 'Facilitator login' }), h('p', { text: 'Enter your PIN to continue.' }), pin, h('button', { class: 'sbtn', onclick: go, text: 'Log in' }), err));
    pin.focus();
  }
  window.P = { SHAPES, TAGS, TAGS_AR, h, $, tr, api, store, staffLogin };
})();
