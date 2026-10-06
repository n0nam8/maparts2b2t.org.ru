const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => (
  {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]
));
const LS = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }
};

// Folders and files.
const IMG = 'data/arts/';
const NOIMG = 'data/assets/no-image.png';

// Minimal monochrome icons for the theme button.
const ICON = {
  moon: '<svg class="ico" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>',
  sun: '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
};

let D = [];            // arts
let LOC = {};          // loaded locales
let T = {};            // current locale
let TF = {};           // fallback locale (en)
let F;                 // catalog filters
let cols = 0;          // cards per row on the home page
const S = {lang: 'ru', nsfw: false};
let SEL = new Set();           // selected arts (ids)
let selectMode = false;
let onSel = null;              // set by the catalog, called when the selection changes
let backHash = '#/catalog';     // page to return to from an art page (catalog keeps its filters)
let curPage = '';               // page on the screen: home / catalog / art
let savedScroll = null;         // {hash, y}: where the page we left for an art was scrolled

// ---------- helpers ----------

const t = k => T[k] ?? TF[k] ?? k;
const P = (k, n) => {
  const o = t(k);
  return (o[new Intl.PluralRules(S.lang).select(n)] || o.other || '').replace('{n}', n);
};
const tg = g => T['tag.' + g] ?? TF['tag.' + g] ?? g;
const vis = a => S.nsfw || !a.tags.includes('nsfw');
const hasSize = a => !!a.size;
const area = a => (hasSize(a) ? a.size[0] * a.size[1] : 0);
const ti = a => esc(a.name || t('na'));
const pad = n => String(n).padStart(2, '0');

// Dates in arts.json: "dd.mm.yy" or "mm.yy" (no day). Anything else = no date.
// Inside the site they are kept as "YYYY-MM-DD" / "YYYY-MM".
const normDate = v => {
  const m = String(v ?? '').trim().match(/^(?:(\d{1,2})\.)?(\d{1,2})\.(\d{2})$/);
  if (!m) return '';
  const [d, mo, y] = [+m[1] || 0, +m[2], 2000 + +m[3]];
  if (mo < 1 || mo > 12 || d > 31) return '';
  return `${y}-${pad(mo)}` + (d ? `-${pad(d)}` : '');
};

// The date filter works with months: a month is the number year * 12 + month - 1.
const monthOf = s => +s.slice(0, 4) * 12 + +s.slice(5, 7) - 1;                 // from "YYYY-MM[-DD]"
const monthIso = n => `${Math.floor(n / 12)}-${pad(n % 12 + 1)}`;               // "2026-05" (address bar)
const monthStr = n => `${pad(n % 12 + 1)}.${pad(Math.floor(n / 12) % 100)}`;    // "05.26" (shown to the user)
const monthParse = v => {                                                       // "05.26" or "05.2026"
  const m = String(v).trim().match(/^(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!m || +m[1] < 1 || +m[1] > 12) return NaN;
  return (m[2].length === 2 ? 2000 + +m[2] : +m[2]) * 12 + +m[1] - 1;
};

// A date is shown as "dd.mm.yy" or "mm.yy" in every language.
const fd = s => (s.length === 7
  ? `${s.slice(5, 7)}.${s.slice(2, 4)}`
  : `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(2, 4)}`);
const enc = encodeURIComponent;
// links to the catalog; the query is written by hand so that "~" and "," stay readable
const qs = o => '#/catalog?' + Object.entries(o).map(([k, v]) => `${k}=${enc(v)}`).join('&');
const sz = a => (hasSize(a) ? `${a.size[0]} × ${a.size[1]}` : t('na'));
const szFull = a => (hasSize(a) ? `${sz(a)} (${P('maps', area(a))})` : t('na'));
const perRow = () => (innerWidth <= 700 ? 2 : Math.max(1, Math.floor((($('#app').clientWidth - 32) + 16) / 196)));

// Search priority: name (1), author (2), tag in any language (3); 0 = no match.
const tagNames = g => [g, ...Object.values(LOC).map(l => l['tag.' + g])].filter(Boolean).map(x => x.toLowerCase());
const rank = (a, q) => (
  a.name.toLowerCase().includes(q) ? 1 :
  a.authors.some(n => n.toLowerCase().includes(q)) ? 2 :
  a.tags.some(g => tagNames(g).some(n => n.includes(q))) ? 3 : 0
);

// Arts without a date / size always go last, whichever way you sort.
// Dates are "YYYY-MM-DD" or "YYYY-MM": inside one month the arts with a known day go first.
const byDate = d => (a, b) => {
  if (!a.date || !b.date) return !a.date - !b.date;
  const m = a.date.slice(0, 7).localeCompare(b.date.slice(0, 7));
  if (m) return d * m;
  if (a.date.length !== b.date.length) return b.date.length - a.date.length;
  return d * a.date.localeCompare(b.date);
};
// Size: by area, then by width; arts of exactly the same size go by date (newest first).
const bySize = d => (a, b) => {
  if (!hasSize(a) || !hasSize(b)) return !hasSize(a) - !hasSize(b);
  return d * (area(a) - area(b)) || d * (a.size[0] - b.size[0]) || byDate(-1)(a, b);
};
const SORTS = {new: byDate(-1), old: byDate(1), big: bySize(-1), small: bySize(1), sel: byDate(-1)};

const img = a => `<img loading="lazy" src="${IMG}${encodeURIComponent(a.image)}" alt="${ti(a)}"
  onerror="this.onerror=null;this.src='${NOIMG}'">`;

const card = a => `
  <a class="card${SEL.has(a.id) ? ' sel' : ''}" data-id="${esc(a.id)}" href="#/art/${encodeURIComponent(a.id)}">
    ${img(a)}
    <div class="info">
      <b>${ti(a)}</b>
      <span>${esc(a.authors.join(', ') || t('na'))}</span>
      <span>${sz(a)}</span>
    </div>
  </a>`;
const grid = list => `<div class="grid">${list.map(card).join('')}</div>`;

// "" and "-" mean "no data".
const clean = v => {
  const s = String(v ?? '').trim();
  return s === '-' ? '' : s;
};
const list = v => (Array.isArray(v) ? v : [v]).map(clean).filter(Boolean);
const parseSize = v => {
  const n = Array.isArray(v) ? v.map(Number) : (String(v || '').match(/^(\d+)\s*[x×]\s*(\d+)$/i) || []).slice(1).map(Number);
  return n[0] > 0 && n[1] > 0 ? [n[0], n[1]] : null;
};

// arts.json: groups named "1x1", "2x2"... give the size to every art inside;
// any other group ("other") needs an explicit "size" for each art.
function parseArts(raw) {
  const groups = Array.isArray(raw) ? {other: raw} : raw;
  const out = [];
  Object.entries(groups).forEach(([key, arts]) => {
    const def = parseSize(key);
    (arts || []).forEach(a => {
      const image = clean(a && a.image);
      if (!image) return;
      out.push({
        id: image.replace(/\.[^.]+$/, ''),
        image,
        name: clean(a.name),
        authors: list(a.authors),
        size: parseSize(a.size) || def,
        date: normDate(a.date),
        tags: list(a.tags)
      });
    });
  });
  return out;
}

async function j(u) {
  const r = await fetch(u);
  if (!r.ok) throw 0;
  return r.json();
}

// ---------- settings: language, theme, 18+ ----------

function setLang(l) {
  S.lang = l;
  T = LOC[l] || {};
  document.documentElement.lang = l;
  $$('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n); });
  $$('.name').forEach(e => { e.textContent = t('site.name'); });
  document.title = t('site.name');
  $$('#lang button').forEach(b => b.classList.toggle('on', b.dataset.l === l));
  route();
}

const systemTheme = () => (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

function setTheme(v) {
  document.documentElement.dataset.theme = v;
  $('#theme').innerHTML = v === 'dark' ? ICON.sun : ICON.moon;
}

function setNsfw(v) {
  S.nsfw = v;
  LS.set('nsfw', v ? '1' : '0');
  $('#nsfw').checked = v;
  route();
}

function gate(k, yes, no, onYes, onNo) {
  const m = $('#gate');
  $('#g-t').textContent = t(k + '.t');
  $('#g-x').textContent = t(k + '.x');
  $('#g-y').textContent = t(yes);
  $('#g-n').textContent = t(no);
  $('#g-y').onclick = () => { m.classList.remove('on'); onYes(); };
  $('#g-n').onclick = () => { m.classList.remove('on'); if (onNo) onNo(); };
  m.classList.add('on');
}

// ---------- routing ----------

// Art page: where it was opened from (home or catalog with its filters) and the scroll position there.
function route() {
  const [p, q] = location.hash.slice(1).split('?');
  const path = (p || '/').split('/').filter(Boolean);
  const next = path[0] === 'catalog' ? 'catalog' : path[0] === 'art' ? 'art' : 'home';

  if (next === 'art' && curPage !== 'art') savedScroll = {hash: backHash, y: scrollY};
  if (next === 'home') backHash = '#/';

  const inCatalog = next === 'catalog' || (next === 'art' && backHash.startsWith('#/catalog'));
  $$('nav a').forEach(a => a.classList.toggle('on', a.dataset.r === (inCatalog ? 'catalog' : 'home')));
  closeCards();
  if (next !== 'catalog') {
    selectMode = false;
    onSel = null;
  }
  if (next === 'catalog') catalog(new URLSearchParams(q || ''));
  else if (next === 'art') artPage(decodeURIComponent(path[1] || ''));
  else home();

  // a new page starts at the top; coming back from an art restores the old position
  if (next !== curPage) {
    const back = curPage === 'art' && savedScroll && savedScroll.hash === (location.hash || '#/');
    scrollTo(0, back ? savedScroll.y : 0);
  }
  curPage = next;
}

// ---------- home ----------

function home() {
  const A = D.filter(vis);
  cols = perRow();

  const authors = {};
  A.forEach(a => a.authors.forEach(n => { authors[n] = (authors[n] || 0) + 1; }));
  const top = Object.entries(authors).sort((x, y) => y[1] - x[1]).slice(0, 3);

  const block = (title, list, more) => `
    <section>
      <div class="sh">
        <h2>${t(title)}</h2>
        <a class="btn" href="${more}">${t('home.more')} →</a>
      </div>
      ${grid([...list].slice(0, cols))}
    </section>`;

  $('#app').innerHTML = `
    ${block('home.new', [...A].sort(SORTS.new), '#/catalog')}
    ${block('home.big', [...A].sort(SORTS.big), '#/catalog?s=big')}
    <section>
      <h2>${t('home.authors')}</h2>
      <ol class="top">
        ${top.map(([n, c]) => `
          <li><a href="${qs({q: n})}">${esc(n)}</a><span class="mu">${P('arts', c)}</span></li>`).join('')}
      </ol>
    </section>`;
}

// ---------- art page + fullscreen viewer (click to zoom) ----------

function artPage(id) {
  const a = D.find(x => x.id === id);
  if (!a || !vis(a)) {
    $('#app').innerHTML = `<p>${t('art.nf')}</p><a class="btn" href="#/catalog">${t('nav.catalog')}</a>`;
    return;
  }
  $('#app').innerHTML = `
    <a class="mu" href="${esc(backHash)}">← ${t(backHash.startsWith('#/catalog') ? 'nav.catalog' : 'nav.home')}</a>
    <div class="art">
      <div class="shot">${img(a)}</div>
      <div>
        <h1>${ti(a)}</h1>
        <dl>
          <dt>${t('art.authors')}</dt>
          <dd>${a.authors.map(n => `<a href="${qs({q: n})}">${esc(n)}</a>`).join(', ') || t('na')}</dd>
          <dt>${t('art.size')}</dt>
          <dd>${szFull(a)}</dd>
          <dt>${t('art.date')}</dt>
          <dd>${a.date ? fd(a.date) : t('na')}</dd>
          <dt>${t('art.tags')}</dt>
          <dd>${a.tags.map(g => `<a class="chip" href="${qs({tag: g})}">${esc(tg(g))}</a>`).join(' ') || t('na')}</dd>
        </dl>
      </div>
    </div>`;
  $('.shot img').onclick = e => viewer(e.target.src);
}

function viewer(src) {
  const v = $('#view');
  v.innerHTML = `
    <div class="vbar"><button id="v-x">✕</button></div>
    <div class="vimg"><img src="${esc(src)}" alt=""></div>`;

  const box = $('.vimg', v);
  const im = $('img', v);
  const LEVELS = [1, 2];   // one click zooms in, the next one goes back
  let lvl = 0;

  const fit = () => {
    if (!im.naturalWidth) return;
    const s = Math.min(box.clientWidth / im.naturalWidth, box.clientHeight / im.naturalHeight) * LEVELS[lvl];
    im.style.width = im.naturalWidth * s + 'px';
    im.style.height = im.naturalHeight * s + 'px';
    im.style.cursor = lvl === LEVELS.length - 1 ? 'zoom-out' : 'zoom-in';
  };
  const key = e => { if (e.key === 'Escape') close(); };
  const close = () => {
    v.classList.remove('on');
    removeEventListener('resize', fit);
    removeEventListener('keydown', key);
  };

  im.onload = fit;
  fit();
  // click: zoom in around the clicked point (the last step goes back to "fit")
  im.onclick = e => {
    const fx = e.offsetX / im.clientWidth;
    const fy = e.offsetY / im.clientHeight;
    lvl = (lvl + 1) % LEVELS.length;
    fit();
    box.scrollLeft = fx * im.clientWidth - box.clientWidth / 2;
    box.scrollTop = fy * im.clientHeight - box.clientHeight / 2;
  };
  $('#v-x').onclick = close;
  box.onclick = e => { if (e.target === box) close(); };
  addEventListener('resize', fit);
  addEventListener('keydown', key);
  v.classList.add('on');
}

// ---------- catalog ----------

// A slider with two thumbs + two manual inputs.
function range(label, [min, max], [lo, hi], cb, isMonth) {
  const ts = isMonth ? monthStr : x => x;
  const fs = isMonth ? monthParse : Number;
  const type = isMonth ? 'text' : 'number';
  const ph = isMonth ? ` placeholder="${esc(t('f.mfmt'))}"` : '';
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `
    ${label ? `<span class="mu">${label}</span>` : ''}
    <div class="rng">
      <input type="range" min="${min}" max="${max}">
      <input type="range" min="${min}" max="${max}">
    </div>
    <div class="nums"><input type="${type}"${ph}><span>–</span><input type="${type}"${ph}></div>`;
  const [r1, r2, n1, n2] = $$('input', row);

  const show = () => {
    r1.value = lo;
    r2.value = hi;
    n1.value = ts(lo);
    n2.value = ts(hi);
    r1.style.zIndex = lo > (min + max) / 2 ? 2 : 1;
  };
  const set = (a, b) => {
    if (isNaN(a) || isNaN(b)) return show();
    lo = Math.max(min, a);
    hi = Math.min(max, b);
    show();
    cb([lo, hi]);
  };

  r1.oninput = () => set(Math.min(+r1.value, hi), hi);
  r2.oninput = () => set(lo, Math.max(+r2.value, lo));
  n1.onchange = () => set(Math.min(fs(n1.value), hi), hi);
  n2.onchange = () => set(lo, Math.max(fs(n2.value), lo));
  show();
  return row;
}

// A dropdown button "Label: value" with the given rows inside.
function dropdown(label, rows, text) {
  const el = document.createElement('details');
  el.className = 'dd';
  el.innerHTML = '<summary></summary><div class="pop"></div>';
  $('.pop', el).append(...rows);
  const refresh = () => { $('summary', el).textContent = `${label}: ${text()}`; };
  refresh();
  return {el, refresh};
}

function catalog(p) {
  const A = D.filter(vis);
  const months = A.filter(a => a.date).map(a => monthOf(a.date));
  const sized = A.filter(hasSize);
  const B = {
    d: months.length ? [Math.min(...months), Math.max(...months)] : [0, 1],
    w: [1, Math.max(1, ...sized.map(a => a.size[0]))],
    h: [1, Math.max(1, ...sized.map(a => a.size[1]))]
  };
  const cnt = {};
  A.forEach(a => a.tags.forEach(g => { cnt[g] = (cnt[g] || 0) + 1; }));
  // the most used tags first, "nsfw" always at the bottom
  const tags = Object.keys(cnt).sort((x, y) =>
    (x === 'nsfw') - (y === 'nsfw') || cnt[y] - cnt[x] || tg(x).localeCompare(tg(y), S.lang));

  // filters come from the address, so links like #/catalog?q=Steve work
  const rg = (k, f) => {
    const v = (p.get(k) || '').split('~');
    return v.length === 2 ? v.map((x, i) => { x = f(x); return isNaN(x) ? B[k][i] : x; }) : [...B[k]];
  };
  F = {
    q: p.get('q') || '',
    s: p.get('s') || 'new',
    tags: (p.get('tag') || '').split(',').filter(Boolean),
    d: rg('d', monthOf),
    w: rg('w', Number),
    h: rg('h', Number)
  };
  backHash = location.hash;
  if (p.has('sel')) SEL = new Set((p.get('sel') || '').split(/[~|]/).filter(Boolean));
  const same = k => F[k][0] === B[k][0] && F[k][1] === B[k][1];

  $('#app').innerHTML = `
    <h1>${t('nav.catalog')}</h1>
    <div class="bar">
      <input id="q" type="search" placeholder="${esc(t('cat.search'))}" value="${esc(F.q)}">
    </div>
    <div class="frow" id="fr"></div>
    <div class="selbar" id="selbar" hidden>
      <span id="selcnt"></span>
      <button id="copy">${t('sel.copy')}</button>
      <button id="clr">${t('sel.clear')}</button>
    </div>
    <p class="mu" id="cnt"></p>
    <div id="gr"></div>`;

  const R = {};

  const sortList = document.createElement('div');
  sortList.className = 'taglist';
  sortList.innerHTML = Object.keys(SORTS)
    .map(k => `<button class="chip" data-s="${k}">${t('sort.' + k)}</button>`).join('');
  R.sort = dropdown(t('f.sort'), [sortList], () => t('sort.' + F.s));
  $$('.chip', sortList).forEach(c => {
    c.onclick = () => {
      F.s = c.dataset.s;
      R.sort.el.removeAttribute('open');
      R.sort.refresh();
      upd();
    };
  });
  const change = (k, d) => v => { F[k] = v; R[d].refresh(); upd(); };

  R.date = dropdown(t('f.date'),
    [range(null, B.d, F.d, change('d', 'date'), true)],
    () => (same('d') ? t('any.f') : `${monthStr(F.d[0])} – ${monthStr(F.d[1])}`));

  R.size = dropdown(t('f.size'),
    [range(t('f.w'), B.w, F.w, change('w', 'size')), range(t('f.h'), B.h, F.h, change('h', 'size'))],
    () => (same('w') && same('h') ? t('any.m') : `${F.w[0]} × ${F.h[0]} – ${F.w[1]} × ${F.h[1]}`));

  const list = document.createElement('div');
  list.className = 'taglist';
  list.innerHTML = tags.map(g => `<button class="chip" data-g="${esc(g)}">${esc(tg(g))} (${cnt[g]})</button>`).join('');
  R.tag = dropdown(t('f.tag'), [list],
    () => (F.tags.length ? F.tags.map(tg).join(', ') : t('any.m')));
  $$('.chip', list).forEach(c => {
    c.onclick = () => {
      const g = c.dataset.g;
      F.tags = F.tags.includes(g) ? F.tags.filter(x => x !== g) : [...F.tags, g];
      R.tag.refresh();
      upd();
    };
  });

  const reset = document.createElement('button');
  reset.textContent = t('cat.reset');
  reset.onclick = () => { location.hash = '#/catalog'; };
  const mode = document.createElement('button');
  mode.textContent = t('sel.mode');
  mode.classList.toggle('on', selectMode);
  mode.onclick = () => {
    selectMode = !selectMode;
    mode.classList.toggle('on', selectMode);
    updSel();
  };
  $('#fr').append(R.date.el, R.size.el, R.tag.el, mode, reset);
  $('.bar').append(R.sort.el);

  // keep the filters and the selection in the address
  function syncUrl() {
    const o = [];
    if (F.q) o.push('q=' + enc(F.q));
    if (F.s !== 'new') o.push('s=' + F.s);
    if (F.tags.length) o.push('tag=' + F.tags.map(enc).join(','));
    [['d', monthIso], ['w', x => x], ['h', x => x]].forEach(([k, f]) => {
      if (!same(k)) o.push(`${k}=${F[k].map(f).join('~')}`);
    });
    if (SEL.size) o.push('sel=' + [...SEL].map(enc).join('~'));
    history.replaceState(null, '', '#/catalog' + (o.length ? '?' + o.join('&') : ''));
    backHash = location.hash;
  }

  function upd() {
    syncUrl();
    const q = F.q.trim().toLowerCase();
    const inR = (v, r) => v >= r[0] && v <= r[1];
    // with a search query, name matches go first, then authors, then tags
    const r = A.map(a => ({a, k: q ? rank(a, q) : 0}))
      .filter(({a, k}) =>
        (!q || k) &&
        (F.s !== 'sel' || SEL.has(a.id)) &&
        F.tags.every(g => a.tags.includes(g)) &&
        (a.date ? inR(monthOf(a.date), F.d) : same('d')) &&
        (hasSize(a) ? inR(a.size[0], F.w) && inR(a.size[1], F.h) : same('w') && same('h')))
      .sort((x, y) => x.k - y.k || (SORTS[F.s] || SORTS.new)(x.a, y.a))
      .map(x => x.a);

    $('#cnt').textContent = t('found')
      .replace('{arts}', P('arts', r.length))
      .replace('{authors}', P('authors', new Set(r.flatMap(a => a.authors)).size));
    $('#gr').innerHTML = r.length ? grid(r) : `<p class="mu">${t('cat.none')}</p>`;
    $$('.chip[data-g]').forEach(c => c.classList.toggle('on', F.tags.includes(c.dataset.g)));
    $$('.chip[data-s]').forEach(c => c.classList.toggle('on', F.s === c.dataset.s));
  }

  function updSel() {
    $('#selbar').hidden = !(selectMode || SEL.size);
    $('#selcnt').textContent = t('sel.count').replace('{n}', SEL.size);
    $('#copy').disabled = !SEL.size;
    $('#gr').classList.toggle('selecting', selectMode);
  }

  // the link carries the selection and opens it as "selected only"
  $('#copy').onclick = () => {
    const url = location.origin + location.pathname + '#/catalog?sel=' + [...SEL].map(enc).join('~') + '&s=sel';
    const btn = $('#copy');
    const done = () => {
      btn.textContent = t('sel.copied');
      setTimeout(() => { btn.textContent = t('sel.copy'); }, 1500);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('', url));
    else prompt('', url);
  };
  $('#clr').onclick = () => {
    SEL.clear();
    updSel();
    upd();
  };
  onSel = () => {
    updSel();
    if (F.s === 'sel') upd();
    else syncUrl();
  };
  updSel();

  $('#q').oninput = e => { F.q = e.target.value; upd(); };
  upd();
}

// ---------- events ----------

// In the selection mode a click on a card selects / unselects it instead of opening it.
function toggleSel(c) {
  const id = c.dataset.id;
  if (SEL.has(id)) SEL.delete(id);
  else SEL.add(id);
  c.classList.toggle('sel', SEL.has(id));
  if (onSel) onSel();
}

// Touch screens: 1st tap = short info, 2nd tap = open the art.
// Scrolling or tapping elsewhere closes the info.
const touch = matchMedia('(hover:none)');
const closeCards = () => $$('.card.open').forEach(c => c.classList.remove('open'));

$('#app').addEventListener('click', e => {
  const c = e.target.closest('.card');
  if (!c) return;
  if (selectMode) {
    e.preventDefault();
    toggleSel(c);
    return;
  }
  if (!touch.matches || c.classList.contains('open')) return;
  e.preventDefault();
  closeCards();
  c.classList.add('open');
});

document.addEventListener('click', e => {
  if (!e.target.closest('.card')) closeCards();
  $$('.dd[open]').forEach(d => { if (!d.contains(e.target)) d.removeAttribute('open'); });
});

addEventListener('scroll', closeCards, {passive: true});
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';   // the site restores the scroll itself
addEventListener('hashchange', route);
// Esc: art page -> the page it was opened from, catalog -> home (the viewer, a dropdown or the 18+ window take Esc first)
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('#view').classList.contains('on') || $('#gate').classList.contains('on')) return;
  const open = $$('.dd[open]');
  if (open.length) {
    open.forEach(d => d.removeAttribute('open'));
    return;
  }
  const page = (location.hash.slice(1).split('?')[0] || '/').split('/').filter(Boolean)[0];
  if (page === 'art') location.hash = backHash;
  else if (page === 'catalog') location.hash = '#/';
});
addEventListener('resize', () => {
  const p = location.hash.slice(1).split('?')[0];
  if ((p === '' || p === '/') && perRow() !== cols) route();
});

// ---------- start ----------

(async () => {
  D = parseArts(await j('data/arts.json'));

  // languages: lang/index.json lists the codes (add a language: put lang/xx.json and write xx in index.json)
  const codes = await j('lang/index.json').catch(() => ['ru', 'en']);
  const found = await Promise.all(codes.map(c => j(`lang/${c}.json`).then(d => [c, d]).catch(() => null)));
  found.filter(Boolean).forEach(([c, d]) => { LOC[c] = d; });
  TF = LOC.en || {};

  const codesFound = Object.keys(LOC);
  $('#lang .pop').innerHTML = '<div class="taglist">' + codesFound
    .map(c => `<button class="chip" data-l="${c}">${esc(LOC[c]['lang.name'] || c)}</button>`).join('') + '</div>';
  $$('#lang button').forEach(b => {
    b.onclick = () => {
      $('#lang').removeAttribute('open');
      LS.set('lang', b.dataset.l);
      setLang(b.dataset.l);
    };
  });

  // phones: the burger button shows / hides the tools (NSFW, language, theme)
  $('#burger').onclick = () => {
    const open = $('header').classList.toggle('open');
    $('#burger').setAttribute('aria-expanded', open);
  };

  // language: the saved choice, otherwise the browser's preferred languages, otherwise English
  const prefs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''])
    .map(x => x.slice(0, 2).toLowerCase());
  let l = LS.get('lang');
  if (!LOC[l]) l = prefs.find(x => LOC[x]) || (LOC.en ? 'en' : codesFound[0]);

  // theme: the saved choice, otherwise the system one (and it follows the system until a choice is saved)
  setTheme(LS.get('theme') || systemTheme());
  $('#theme').onclick = () => {
    const v = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    LS.set('theme', v);
    setTheme(v);
  };
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!LS.get('theme')) setTheme(systemTheme());
  });

  S.nsfw = LS.get('age') === 'adult' && LS.get('nsfw') === '1';
  $('#nsfw').checked = S.nsfw;
  $('#nsfw').onchange = e => {
    if (!e.target.checked) return setNsfw(false);
    e.target.checked = false;
    gate('gate2', 'gate.yes', 'gate2.cancel', () => { LS.set('age', 'adult'); setNsfw(true); });
  };

  setLang(l);
  if (!LS.get('age')) {
    gate('gate', 'gate.yes', 'gate.no',
      () => { LS.set('age', 'adult'); setNsfw(true); },
      () => { LS.set('age', 'minor'); setNsfw(false); });
  }
})();
