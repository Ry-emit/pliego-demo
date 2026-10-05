/* Pliego demo — stage, transitions and contact sheet. Spec: ../05-transitions.md, ../06-pages-navigation.md */
(() => {
  'use strict';

  // One entry per menu number. Sheet codes: H = one landscape photo, VV = spread,
  // VVV = triptych, fH / fV = one photo shown whole (FIT). `fx` is the series' transition.
  const SECTIONS = [
    { n: '01', name: 'Portada', fx: 'push', stage: 'paper', opener: false, sheets: ['H', 'VV', 'H', 'VVV', 'H', 'fV', 'VV', 'H'] },
    { n: '02', name: 'Retratos', fx: 'split', stage: 'paper', opener: true, sheets: ['VV', 'VV', 'H', 'VV', 'VVV', 'H'] },
    { n: '03', name: 'Calle', fx: 'cut', stage: 'ink', opener: true, sheets: ['H', 'H', 'VV', 'H', 'fH', 'H', 'H'] },
    { n: '04', name: 'Paisaje', fx: 'blinds', stage: 'paper', opener: true, sheets: ['H', 'H', 'VVV', 'H', 'H', 'VV'] },
    { n: '05', name: 'Info', page: 'info' }
  ];
  const FX_NAMES = { push: 'Empuje', split: 'Partido', cut: 'Corte', blinds: 'Persiana' };
  const MODES = { 1: 'full', 2: 'spread', 3: 'triptych' };
  const EASE_PHOTO = 'cubic-bezier(0.76, 0, 0.24, 1)';
  const EASE_UI = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
  const IMAGE_FILE = /\.(jpe?g|png|webp|avif|gif)$/i;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const pad = n => String(n).padStart(2, '0');
  const el = (tag, cls, html) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  };

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const portrait = matchMedia('(orientation: portrait)');
  const touch = matchMedia('(hover: none)');
  const narrow = matchMedia('(max-width: 720px)');

  const stage = $('#stage'), contact = $('#contact'), grid = $('#grid'), info = $('#info');
  const menu = $('#menu'), counter = $('#counter'), caption = $('#caption'), lab = $('#lab');
  const curtain = $('#curtain'), zoomLayer = $('#zoom'), cursor = $('#cursor'), index = $('#index');

  /* ---------- Model: sections → sheets → slots ---------- */
  const slots = [];
  SECTIONS.forEach((sec, si) => {
    if (sec.page) return;
    sec.slots = [];
    sec.wide = sec.opener ? [{ mode: 'opener' }] : [];
    for (const code of sec.sheets) {
      const fit = code[0] === 'f';
      const letters = [...(fit ? code.slice(1) : code)];
      const sheet = { mode: fit ? 'fit' : MODES[letters.length], slots: [] };
      for (const o of letters) {
        const id = slots.length + 1;
        // Neighbouring slots alternate paper / ink so the zero-gap joins stay visible while empty
        const phTone = fit ? (sec.stage === 'ink' ? 'light' : 'dark') : (id % 2 ? 'light' : 'dark');
        const slot = { id, o, r: o === 'H' ? 3 / 2 : 2 / 3, sec: si, phTone, photo: null };
        slots.push(slot);
        sec.slots.push(slot);
        sheet.slots.push(slot);
      }
      sec.wide.push(sheet);
    }
    sec.count = sec.slots.length;
    sec.list = sec.wide;
  });

  /* ---------- State ---------- */
  let s = 0, i = 0, view = 'stage';   // view: stage | contact | info
  let curEl = null;                   // sheet at rest on the stage
  let T = null;                       // running transition
  let labFx = '';                     // demo override of the series' transition
  let contactFor = -1;
  let mouse = null;
  let drag = null;
  let ignoreClickUntil = 0;
  const photos = [];
  const sheetCache = new Map();

  /* ---------- Sheets per screen shape ---------- */
  const ratioOf = slot => (slot.photo ? slot.photo.w / slot.photo.h : slot.r);
  const sheetOf = slot => Math.max(0, SECTIONS[slot.sec].list.findIndex(sh => sh.slots && sh.slots.includes(slot)));
  let shape = '', shapeRoom = 0;

  // Wide screens show the authored sheets (photos side by side). Tall screens re-flow each series:
  // full-width photos are stacked, in order, until the screen is full.
  function buildLists() {
    const now = SECTIONS[s].list && SECTIONS[s].list[i];
    const anchor = now && now.slots ? now.slots[0] : null;
    const tall = portrait.matches, room = innerHeight / innerWidth;
    shape = tall ? 'tall' : 'wide';
    shapeRoom = room;
    for (const sec of SECTIONS) {
      if (sec.page) continue;
      if (!tall) { sec.list = sec.wide; continue; }
      sec.list = sec.opener ? [{ mode: 'opener' }] : [];
      let sheet = null, sum = 0;
      // A stack that nearly fills the screen is stretched to fill it; a short one sits whole on the stage colour
      const close = () => { if (sheet) sheet.fill = sum >= room * 0.65 ? 'cover' : 'contain'; };
      for (const slot of sec.slots) {
        const h = 1 / ratioOf(slot);
        if (sheet && sum + h <= room * 1.3) { sheet.slots.push(slot); sum += h; continue; }
        close();
        sheet = { mode: 'stack', slots: [slot] };
        sum = h;
        sec.list.push(sheet);
      }
      close();
    }
    sheetCache.clear();
    if (anchor) i = sheetOf(anchor);
  }

  /* ---------- Photos: loading, luminance, slot assignment ---------- */
  const G = 16;
  const probe = document.createElement('canvas');
  probe.width = probe.height = G;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  const linear = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

  function lumGrid(img) {
    try {
      probeCtx.drawImage(img, 0, 0, G, G);
      const d = probeCtx.getImageData(0, 0, G, G).data;
      const out = new Float32Array(G * G);
      for (let k = 0; k < G * G; k++) out[k] = 0.2126 * linear(d[k * 4]) + 0.7152 * linear(d[k * 4 + 1]) + 0.0722 * linear(d[k * 4 + 2]);
      return out;
    } catch { return null; }
  }

  // Ink or paper, whichever contrasts more with the photo around (u, v)
  function photoTone(photo, u, v) {
    if (!photo.lum) return 'dark';
    const cx = Math.min(G - 1, Math.max(0, Math.floor(u * G))), cy = Math.min(G - 1, Math.max(0, Math.floor(v * G)));
    let sum = 0, n = 0;
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      if (x < 0 || y < 0 || x >= G || y >= G) continue;
      sum += photo.lum[y * G + x]; n++;
    }
    return sum / n > 0.186 ? 'light' : 'dark';
  }

  function loadPhoto({ url, name }) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ url, name, base: name.replace(/\.[^.]+$/, ''), w: img.naturalWidth, h: img.naturalHeight, lum: lumGrid(img) });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // Photos in ./fotos/ are found through the local server's folder listing. On static hosting
  // there is no listing, so fotos/fotos.json (written by servir.py) is read instead.
  async function discover() {
    const usable = h => IMAGE_FILE.test(h) && !h.startsWith('.') && !h.includes('/');
    const entries = list => list.filter(usable)
      .map(h => ({ url: 'fotos/' + h, name: decodeURIComponent(h) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    try {
      const res = await fetch('fotos/');
      if (res.ok) {
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const found = entries($$('a', doc).map(a => a.getAttribute('href') || ''));
        if (found.length) return found;
      }
    } catch { /* no listing here */ }
    try {
      const res = await fetch('fotos/fotos.json');
      if (res.ok) return entries((await res.json()).map(encodeURIComponent));
    } catch { /* no list either */ }
    return [];
  }

  // A file called 07.jpg goes to slot 07; the rest fill free slots of their own orientation, in order
  function assign() {
    slots.forEach(slot => { slot.photo = null; });
    const rest = [];
    for (const p of photos) {
      const slot = /^\d{1,2}$/.test(p.base) ? slots[+p.base - 1] : null;
      if (slot && !slot.photo) slot.photo = p; else rest.push(p);
    }
    for (const p of rest) {
      const o = p.w >= p.h ? 'H' : 'V';
      const slot = slots.find(x => !x.photo && x.o === o);
      if (slot) slot.photo = p;
    }
    contactFor = -1;
    buildLists();
  }

  async function addPhotos(entries) {
    const loaded = (await Promise.all(entries.map(loadPhoto))).filter(Boolean);
    if (!loaded.length) return;
    photos.push(...loaded);
    assign();
    stopTransition();
    renderHard();
  }

  /* ---------- Building sheets ---------- */
  function buildMedia(slot) {
    const p = slot.photo;
    let media;
    if (p) {
      media = el('img', 'media');
      media.src = p.url;
      media.alt = p.base;
      media.decoding = 'sync';
      media.draggable = false;
      media.style.setProperty('--r', p.w / p.h);
      media.dataset.o = p.w >= p.h ? 'H' : 'V';
    } else {
      media = el('div', 'media ph', `<div class="ph__c"><span class="ph__n">${pad(slot.id)}</span><span class="ph__l label">(Hueco ${slot.o === 'H' ? 'horizontal' : 'vertical'})</span></div>`);
      media.setAttribute('role', 'img');
      media.setAttribute('aria-label', `Hueco ${pad(slot.id)}`);
      media.dataset.tone = slot.phTone;
      media.style.setProperty('--r', slot.r);
      media.dataset.o = slot.o;
    }
    media.dataset.slot = slot.id;
    return media;
  }

  function getSheet(si, idx) {
    const key = si + ':' + idx;
    if (sheetCache.has(key)) return sheetCache.get(key);
    const sec = SECTIONS[si], sh = sec.list[idx];
    const sheet = el('div', 'sheet');
    sheet.dataset.mode = sh.mode;
    if (sh.fill) sheet.dataset.fill = sh.fill;
    sheet.dataset.stage = sec.stage;
    const inner = el('div', 'sheet__in');
    if (sh.mode === 'opener') {
      inner.classList.add('opener');
      inner.innerHTML = `<p class="figure figure--xl">${sec.n}</p><div class="opener__t"><h2 class="title title--xl">${sec.name}</h2><p class="label">(${sec.count} fotos · Lugar · 2026)</p></div>`;
    } else {
      for (const slot of sh.slots) {
        const panel = el('div', 'panel');
        panel.style.setProperty('--r', ratioOf(slot));
        panel.style.setProperty('--g', 1 / ratioOf(slot));
        panel.append(buildMedia(slot));
        inner.append(panel);
      }
    }
    sheet.append(inner);
    sheetCache.set(key, sheet);
    return sheet;
  }

  function resetSheet(sheet) {
    for (const a of sheet.getAnimations({ subtree: true })) a.cancel();
    sheet.style.cssText = '';
    sheet.firstElementChild.style.cssText = '';
    for (const m of $$('.media', sheet)) m.style.visibility = '';
  }

  const decodeAll = node => Promise.all($$('img', node).map(img => img.decode().catch(() => {})));

  function preload() {
    const n = SECTIONS[s].list.length;
    for (const k of [i + 1, i + 2, i - 1]) if (k >= 0 && k < n) decodeAll(getSheet(s, k));
  }

  /* ---------- Tone of whatever lies under a point ---------- */
  function mediaTone(media, u, v) {
    const slot = slots[media.dataset.slot - 1];
    return slot.photo ? photoTone(slot.photo, u, v) : slot.phTone;
  }

  // Hit-tests the page, so it stays right while sheets are moving, clipped or scaled
  function surfaceTone(x, y) {
    for (const e of document.elementsFromPoint(x, y)) {
      if (e.classList.contains('media')) {
        const r = e.getBoundingClientRect();
        return mediaTone(e, (x - r.left) / r.width, (y - r.top) / r.height);
      }
      if (e.classList.contains('sheet') || e === stage) return e.dataset.stage === 'ink' ? 'dark' : 'light';
      if (e === curtain || e === contact || e === info || e === index) return 'light';
    }
    return 'light';
  }

  const toneUnder = node => {
    const r = node.getBoundingClientRect();
    return surfaceTone(r.left + r.width / 2, r.top + r.height / 2);
  };

  /* ---------- On-photo text: menu, counter, caption ---------- */
  const fxNow = () => labFx || SECTIONS[s].fx || 'push';

  function updateChrome() {
    const sec = SECTIONS[s];
    $$('a', menu).forEach((a, k) => {
      a.classList.toggle('is-current', k === s);
      if (k === s) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    const onStage = view === 'stage';
    counter.hidden = caption.hidden = !onStage;
    if (onStage) {
      const sh = sec.list[i];
      counter.textContent = `${pad(sec.opener ? i : i + 1)} / ${pad(sec.list.length - (sec.opener ? 1 : 0))}`;
      caption.textContent = sh.mode === 'opener'
        ? `(${sec.name})`
        : `(${sec.name}) · ` + sh.slots.map(slot => (slot.photo ? slot.photo.base : `Hueco ${pad(slot.id)}`)).join(' + ');
    }

    lab.hidden = view === 'info' || lab.dataset.off === '1';
    if (!lab.hidden) {
      for (const b of $$('[data-fx]', lab)) {
        b.classList.toggle('is-on', b.dataset.fx === labFx);
        if (!b.dataset.fx) b.textContent = sec.fx ? `Serie · ${FX_NAMES[sec.fx]}` : 'Serie';
      }
      $('#lab-count').textContent = `${pad(slots.filter(x => x.photo).length)} / ${slots.length} huecos`;
    }
    document.title = `${sec.n} ${sec.name} — Pliego`;
    updateTones();
  }

  // Each piece of text flips between ink and paper the moment a different photo passes under it
  function updateTones() {
    for (const a of menu.children) a.dataset.tone = toneUnder(a.firstElementChild);
    for (const node of [counter, caption, ...(lab.hidden ? [] : lab.children)]) if (!node.hidden && node.offsetWidth) node.dataset.tone = toneUnder(node);
    updateCursor();
  }

  // Pointer label names what a click will do in that zone
  function updateCursor() {
    let text = '';
    if (mouse && mouse.onStage && view === 'stage' && curtain.hidden) {
      text = mouse.x < innerWidth * 0.3 ? (i > 0 ? '(Back)' : '') : '(Press)';
    }
    cursor.hidden = !text;
    stage.classList.toggle('has-cursor', !!text);
    if (!text) return;
    cursor.firstElementChild.textContent = text;
    cursor.style.transform = `translate(${mouse.x}px, ${mouse.y}px)`;
    cursor.dataset.tone = surfaceTone(mouse.x, mouse.y);
  }

  /* ---------- Rendering the resting state ---------- */
  function renderPage() {
    const sec = SECTIONS[s];
    document.body.dataset.view = view;
    stage.hidden = view !== 'stage';
    contact.hidden = view !== 'contact';
    info.hidden = view !== 'info';
    stage.classList.remove('is-zooming');
    if (view === 'stage') {
      stage.dataset.stage = sec.stage;
      const cur = getSheet(s, i);
      for (const child of [...stage.children]) if (child !== cur) child.remove();
      resetSheet(cur);
      if (cur.parentNode !== stage) stage.append(cur);
      curEl = cur;
      preload();
    } else {
      stage.replaceChildren();
      curEl = null;
    }
    if (view === 'contact') buildContact();
    updateChrome();
  }

  function renderHard() {
    curtain.hidden = true;
    zoomLayer.replaceChildren();
    renderPage();
  }

  /* ---------- Transition plumbing ---------- */
  function newTransition() {
    const me = {
      anims: [], timers: [], extras: [], dead: false, raf: 0,
      cancel() {
        this.dead = true;
        cancelAnimationFrame(this.raf);
        this.timers.forEach(clearTimeout);
        this.anims.forEach(a => a.cancel());
        this.extras.forEach(e => e.remove());
      }
    };
    const tick = () => { if (me.dead) return; updateTones(); me.raf = requestAnimationFrame(tick); };
    me.raf = requestAnimationFrame(tick);
    return me;
  }

  function anim(me, node, keyframes, options) {
    const a = node.animate(keyframes, { easing: EASE_PHOTO, fill: 'both', ...options });
    me.anims.push(a);
    return a;
  }

  // Counter and caption change their text as a hard cut halfway through
  function atHalf(me, ms) {
    me.timers.push(setTimeout(updateChrome, ms / 2));
  }

  function settle(me) {
    Promise.all(me.anims.map(a => a.finished)).then(() => finish(me), () => {});
  }

  function finish(me) {
    if (T !== me) return;
    T = null;
    me.cancel();
    renderHard();
  }

  function stopTransition() {
    if (!T) return;
    const t = T;
    T = null;
    t.cancel();
  }

  // A new input snaps the running transition to its end state
  function snap() {
    if (!T) return;
    stopTransition();
    renderHard();
  }

  /* ---------- Photo → photo ---------- */
  const FX = {
    // Both sheets travel edge to edge; the photos drift the other way inside them
    push(me, out, inc, dir) {
      const d = touch.matches ? 500 : 700;
      inc.style.visibility = '';
      anim(me, out, { transform: ['translateX(0%)', `translateX(${-dir * 100}%)`] }, { duration: d });
      anim(me, out.firstElementChild, { transform: ['translateX(0%)', `translateX(${dir * 12}%)`] }, { duration: d });
      anim(me, inc, { transform: [`translateX(${dir * 100}%)`, 'translateX(0%)'] }, { duration: d });
      anim(me, inc.firstElementChild, { transform: [`translateX(${-dir * 12}%)`, 'translateX(0%)'] }, { duration: d });
      return d;
    },

    // A blade crosses the frame and uncovers the next sheet
    cut(me, out, inc, dir) {
      const d = 650;
      inc.style.visibility = '';
      anim(me, inc, { clipPath: [dir > 0 ? 'inset(0% 0% 0% 100%)' : 'inset(0% 100% 0% 0%)', 'inset(0% 0% 0% 0%)'] }, { duration: d });
      anim(me, inc.firstElementChild, { transform: ['scale(1.08)', 'scale(1)'] }, { duration: d });
      anim(me, out, { transform: ['translateX(0%)', `translateX(${-dir * 8}%)`] }, { duration: d });
      return d;
    },

    // The screen splits in two halves that leave in opposite directions
    async split(me, out, inc, dir) {
      const d = 800, stacked = portrait.matches, axis = stacked ? 'X' : 'Y';
      const clips = stacked ? ['inset(0% 0% 50% 0%)', 'inset(50% 0% 0% 0%)'] : ['inset(0% 50% 0% 0%)', 'inset(0% 0% 0% 50%)'];
      const parts = [];
      for (const [src, incoming] of [[out, false], [inc, true]]) for (const half of [0, 1]) {
        const clone = src.cloneNode(true);
        clone.style.visibility = '';
        clone.style.clipPath = clips[half];
        clone.setAttribute('aria-hidden', 'true');
        parts.push({ clone, incoming, half });
        me.extras.push(clone);
      }
      await Promise.all(parts.map(p => decodeAll(p.clone)));
      if (me.dead) return 0;
      out.style.visibility = 'hidden';
      for (const { clone, incoming, half } of parts) {
        const sign = (half ? 1 : -1) * dir;
        stage.append(clone);
        anim(me, clone, {
          transform: incoming
            ? [`translate${axis}(${-sign * 100}%)`, `translate${axis}(0%)`]
            : [`translate${axis}(0%)`, `translate${axis}(${sign * 100}%)`]
        }, { duration: d });
      }
      return d;
    },

    // The next sheet arrives in vertical strips, one after another
    async blinds(me, out, inc, dir) {
      const n = portrait.matches ? 4 : 6, each = 520, gap = 45, W = stage.clientWidth;
      const strips = Array.from({ length: n }, () => {
        const clone = inc.cloneNode(true);
        clone.style.visibility = '';
        clone.setAttribute('aria-hidden', 'true');
        me.extras.push(clone);
        return clone;
      });
      await Promise.all(strips.map(decodeAll));
      if (me.dead) return 0;
      strips.forEach((clone, k) => {
        const left = Math.round(k * W / n);
        const right = k === n - 1 ? 0 : Math.max(0, W - Math.round((k + 1) * W / n) - 1);
        stage.append(clone);
        anim(me, clone, { clipPath: [`inset(0px ${right}px 100% ${left}px)`, `inset(0px ${right}px 0% ${left}px)`] },
          { duration: each, delay: (dir > 0 ? k : n - 1 - k) * gap });
      });
      return each + (n - 1) * gap;
    }
  };

  async function runSheet(out, inc, dir) {
    const me = T = newTransition();
    resetSheet(inc);
    inc.style.visibility = 'hidden';
    stage.append(inc);
    await decodeAll(inc);          // hold, then move: never show a half-loaded photo
    if (me.dead) return;
    if (reduced.matches) return finish(me);
    const d = await FX[fxNow()](me, out, inc, dir);
    if (me.dead) return;
    atHalf(me, d);
    settle(me);
  }

  function step(dir) {
    if (view !== 'stage') return;
    const list = SECTIONS[s].list, next = i + dir;
    if (next < 0) return;
    if (next >= list.length) return goSection((s + 1) % SECTIONS.length);
    snap();
    const out = curEl;
    i = next;
    pushURL();
    runSheet(out, getSheet(s, i), dir);
  }

  // First photo of the visit rises from the bottom edge
  function rise() {
    if (reduced.matches || view !== 'stage' || !curEl) return;
    const me = T = newTransition();
    anim(me, curEl, { clipPath: ['inset(100% 0% 0% 0%)', 'inset(0% 0% 0% 0%)'] }, { duration: 900 });
    anim(me, curEl.firstElementChild, { transform: ['translateY(6%)', 'translateY(0%)'] }, { duration: 900 });
    settle(me);
  }

  /* ---------- Section → section: the orange curtain ---------- */
  function goSection(target, sheetIndex = 0) {
    const sec = SECTIONS[target], nextView = sec.page || 'stage';
    if (!T && target === s && view === nextView && (nextView !== 'stage' || i === sheetIndex)) return;
    snap();
    s = target; i = sheetIndex; view = nextView;
    pushURL();
    if (reduced.matches) return renderHard();

    const me = T = newTransition();
    $('#curtain-n').textContent = sec.n;
    $('#curtain-l').textContent = `(${sec.name})`;
    curtain.hidden = false;
    updateCursor();
    anim(me, curtain, { transform: ['translateY(100%)', 'translateY(0%)'] }, { duration: 450 }).finished.then(() => {
      if (me.dead) return;
      renderPage();
      if (view === 'info') info.scrollTop = 0;
      me.timers.push(setTimeout(() => {
        anim(me, curtain, { transform: ['translateY(0%)', 'translateY(-100%)'] }, { duration: 450 })
          .finished.then(() => finish(me), () => {});
      }, 150));
    }, () => {});
  }

  /* ---------- Contact sheet ---------- */
  function buildContact() {
    if (contactFor !== s) {
      contactFor = s;
      grid.replaceChildren();
      for (const sh of SECTIONS[s].list) for (const slot of sh.slots || []) {
        const thumb = el('button', 'thumb');
        thumb.type = 'button';
        thumb.dataset.slot = slot.id;
        thumb.dataset.tone = slot.photo ? photoTone(slot.photo, 0.1, 0.9) : slot.phTone;
        thumb.setAttribute('aria-label', `Abrir ${slot.photo ? slot.photo.base : 'hueco ' + pad(slot.id)}`);
        thumb.append(buildMedia(slot), el('span', 'thumb__n label', pad(slot.id)));
        grid.append(thumb);
      }
      contact.scrollTop = 0;
    }
    layoutContact();
  }

  // Justified rows: every photo keeps its ratio, every row fills the width exactly
  function layoutContact() {
    const W = contact.clientWidth, target = Math.min(260, Math.max(140, innerHeight * 0.22));
    let row = [], sum = 0, y = 0;
    const place = (items, h, fill) => {
      let x = 0;
      const top = Math.round(y), bottom = Math.round(y + h);
      items.forEach((item, k) => {
        const x0 = Math.round(x);
        x += item.r * h;
        const x1 = fill && k === items.length - 1 ? W : Math.round(x);
        Object.assign(item.thumb.style, { left: x0 + 'px', top: top + 'px', width: x1 - x0 + 'px', height: bottom - top + 'px' });
      });
      y += h;
    };
    for (const thumb of $$('.thumb', grid)) {
      const slot = slots[thumb.dataset.slot - 1];
      const r = slot.photo ? slot.photo.w / slot.photo.h : slot.r;
      row.push({ thumb, r });
      sum += r;
      if (sum * target >= W) { place(row, W / sum, true); row = []; sum = 0; }
    }
    if (row.length) place(row, target, false);
    grid.style.height = Math.round(y) + 'px';
  }

  function makeZoomer(media, box) {
    const zoomer = el('div', 'zoomer');
    Object.assign(zoomer.style, { left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' });
    const clone = media.cloneNode(true);
    clone.style.visibility = '';
    zoomer.append(clone);
    zoomLayer.append(zoomer);
    return zoomer;
  }

  // The crop a panel applies to its photo, written as a clip on the uncropped photo box
  const cropClip = (box, panel) =>
    `inset(${Math.max(0, panel.top - box.top)}px ${Math.max(0, box.right - panel.right)}px ${Math.max(0, box.bottom - panel.bottom)}px ${Math.max(0, panel.left - box.left)}px)`;
  const toThumb = (box, t) => `translate(${t.left - box.left}px, ${t.top - box.top}px) scale(${t.width / box.width})`;
  const NO_CLIP = 'inset(0px 0px 0px 0px)', AT_REST = 'translate(0px, 0px) scale(1)';

  // Contact sheet → stage: the thumbnail grows into its place on the sheet
  async function zoomIn(slot) {
    snap();
    const from = $(`.thumb[data-slot="${slot.id}"]`, grid).getBoundingClientRect();
    i = sheetOf(slot); view = 'stage';
    pushURL();
    if (reduced.matches) return renderHard();

    const me = T = newTransition();
    const inc = getSheet(s, i);
    resetSheet(inc);
    inc.style.visibility = 'hidden';
    stage.dataset.stage = SECTIONS[s].stage;
    stage.replaceChildren(inc);
    stage.classList.add('is-zooming');
    stage.hidden = false;
    await decodeAll(inc);
    if (me.dead) return;

    const media = $(`.media[data-slot="${slot.id}"]`, inc);
    const box = media.getBoundingClientRect(), panel = media.parentNode.getBoundingClientRect();
    const zoomer = makeZoomer(media, box);
    me.extras.push(zoomer);
    anim(me, zoomer, { transform: [toThumb(box, from), AT_REST], clipPath: [NO_CLIP, cropClip(box, panel)] }, { duration: 600 });
    if (inc.querySelectorAll('.panel').length > 1) {
      // The other photos of the sheet arrive behind it
      media.style.visibility = 'hidden';
      inc.style.visibility = '';
      anim(me, inc, { clipPath: ['inset(0% 0% 0% 100%)', 'inset(0% 0% 0% 0%)'] }, { duration: 600 });
    }
    atHalf(me, 600);
    settle(me);
  }

  // Stage → contact sheet: the photo flies back to its cell
  function zoomOut() {
    if (view !== 'stage') return;
    snap();
    const slot = (SECTIONS[s].list[i].slots || [])[0];
    const media = slot && $(`.media[data-slot="${slot.id}"]`, curEl);
    const box = media && media.getBoundingClientRect(), panel = media && media.parentNode.getBoundingClientRect();
    view = 'contact';
    pushURL();
    if (!media || reduced.matches) return renderHard();

    const me = T = newTransition();
    const zoomer = makeZoomer(media, box);
    zoomer.style.clipPath = cropClip(box, panel);
    me.extras.push(zoomer);
    contact.hidden = false;
    buildContact();
    const thumb = $(`.thumb[data-slot="${slot.id}"]`, grid);
    thumb.scrollIntoView({ block: 'center' });
    stage.hidden = true;
    anim(me, zoomer, { transform: [AT_REST, toThumb(box, thumb.getBoundingClientRect())], clipPath: [cropClip(box, panel), NO_CLIP] }, { duration: 600 });
    atHalf(me, 600);
    settle(me);
  }

  function leaveContact() {
    const slot = (SECTIONS[s].list[i].slots || [])[0];
    if (slot) return zoomIn(slot);
    snap();
    view = 'stage';
    pushURL();
    renderHard();
  }

  /* ---------- URL: every sheet has its own address ---------- */
  function hashNow() {
    const sec = SECTIONS[s];
    if (sec.page) return `#/${sec.n}`;
    if (view === 'contact') return `#/${sec.n}/contactos`;
    return `#/${sec.n}/${pad(sec.opener ? i : i + 1)}`;
  }

  function pushURL() {
    const hash = hashNow();
    if (location.hash !== hash) history.pushState(null, '', hash);
  }

  function readURL() {
    s = 0; i = 0; view = 'stage';
    const m = /^#\/(\d\d)(?:\/(\w+))?/.exec(location.hash);
    const k = m ? SECTIONS.findIndex(sec => sec.n === m[1]) : -1;
    if (k < 0) return;
    s = k;
    const sec = SECTIONS[k];
    if (sec.page) { view = sec.page; return; }
    if (m[2] === 'contactos') { view = 'contact'; return; }
    const n = parseInt(m[2], 10);
    if (!Number.isNaN(n)) i = Math.min(sec.list.length - 1, Math.max(0, sec.opener ? n : n - 1));
  }

  /* ---------- Index overlay (touch menu) ---------- */
  function openIndex() {
    index.hidden = false;
    if (!reduced.matches) index.animate({ transform: ['translateY(-100%)', 'translateY(0%)'] }, { duration: 450, easing: EASE_PHOTO });
  }

  function closeIndex() {
    if (index.hidden) return;
    if (reduced.matches) { index.hidden = true; return; }
    index.animate({ transform: ['translateY(0%)', 'translateY(-100%)'] }, { duration: 450, easing: EASE_PHOTO, fill: 'forwards' })
      .finished.then(a => { index.hidden = true; a.cancel(); });
  }

  /* ---------- Touch: the sheet follows the finger (PUSH only) ---------- */
  function setPush(out, inc, dir, p) {
    out.style.transform = `translateX(${-dir * p * 100}%)`;
    out.firstElementChild.style.transform = `translateX(${dir * p * 12}%)`;
    inc.style.transform = `translateX(${dir * (1 - p) * 100}%)`;
    inc.firstElementChild.style.transform = `translateX(${-dir * (1 - p) * 12}%)`;
  }

  function dragStart(dir) {
    snap();
    drag.dir = dir;
    const next = i + dir;
    if (fxNow() !== 'push' || reduced.matches || next < 0 || next >= SECTIONS[s].list.length) { drag.simple = true; return; }
    drag.out = curEl;
    drag.inc = getSheet(s, next);
    resetSheet(drag.inc);
    stage.append(drag.inc);
    drag.p = 0;
  }

  function dragEnd(dx, ms) {
    const d = drag;
    drag = null;
    if (!d || !d.active) return;
    ignoreClickUntil = performance.now() + 400;
    if (d.simple) { if (Math.abs(dx) > 40 && Math.sign(dx) === -d.dir) step(d.dir); return; }

    const flick = Math.abs(dx) / ms > 0.5 && Math.sign(dx) === -d.dir;
    const go = d.p > 0.2 || flick;
    const me = T = newTransition();
    const ms2 = go ? Math.max(150, 500 * (1 - d.p)) : 300;
    const run = (node, to) => anim(me, node, { transform: [node.style.transform, to] }, { duration: ms2, easing: EASE_UI });
    run(d.out, go ? `translateX(${-d.dir * 100}%)` : 'translateX(0%)');
    run(d.out.firstElementChild, go ? `translateX(${d.dir * 12}%)` : 'translateX(0%)');
    run(d.inc, go ? 'translateX(0%)' : `translateX(${d.dir * 100}%)`);
    run(d.inc.firstElementChild, go ? 'translateX(0%)' : `translateX(${-d.dir * 12}%)`);
    if (go) {
      i += d.dir;
      pushURL();
      curEl = d.inc;
      updateChrome();
    }
    settle(me);
  }

  /* ---------- Wiring ---------- */
  function buildMenu() {
    SECTIONS.forEach((sec, k) => {
      const a = el('a', '', `<span class="menu__n">${sec.n}</span><span class="menu__l label">(${sec.name})</span>`);
      a.href = `#/${sec.n}`;
      a.dataset.tone = 'light';
      a.addEventListener('click', e => {
        e.preventDefault();
        if (touch.matches || narrow.matches) openIndex(); else goSection(k);
      });
      menu.append(a);

      const row = el('button', 'index__row', `<span class="label">${sec.n}</span><span class="title title--s">${sec.name}</span><span class="label">${sec.page ? '' : `(${sec.count} fotos)`}</span>`);
      row.type = 'button';
      row.addEventListener('click', () => { index.hidden = true; goSection(k); });
      $('#index-rows').append(row);
    });
  }

  stage.addEventListener('click', e => {
    if (performance.now() < ignoreClickUntil) return;
    step(e.clientX < innerWidth * 0.3 ? -1 : 1);
  });

  stage.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || view !== 'stage') return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), active: false };
  });
  stage.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
      drag.active = true;
      try { stage.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      dragStart(dx < 0 ? 1 : -1);
    }
    if (drag.simple) return;
    drag.p = Math.min(1, Math.max(0, -drag.dir * dx / innerWidth));
    setPush(drag.out, drag.inc, drag.dir, drag.p);
    updateTones();
  });
  for (const type of ['pointerup', 'pointercancel']) {
    stage.addEventListener(type, e => {
      if (drag && e.pointerId === drag.id) dragEnd(e.clientX - drag.x, performance.now() - drag.t);
    });
  }

  counter.addEventListener('click', zoomOut);
  grid.addEventListener('click', e => {
    const thumb = e.target.closest('.thumb');
    if (thumb) zoomIn(slots[thumb.dataset.slot - 1]);
  });

  let scrollTick = 0;
  contact.addEventListener('scroll', () => {
    cancelAnimationFrame(scrollTick);
    scrollTick = requestAnimationFrame(updateTones);
  }, { passive: true });

  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    mouse = { x: e.clientX, y: e.clientY, onStage: e.target instanceof Element && !!e.target.closest('#stage') };
    updateCursor();
  });
  document.documentElement.addEventListener('mouseleave', () => { mouse = null; updateCursor(); });

  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea')) return;
    const k = e.key;
    if (k === ' ' && e.target.closest('button, a')) return;
    if (k === 'Escape') {
      if (!index.hidden) closeIndex();
      else if (view === 'stage') zoomOut();
      else if (view === 'contact') leaveContact();
    } else if (view === 'stage' && (k === 'ArrowRight' || k === ' ' || k === 'PageDown')) { e.preventDefault(); step(1); }
    else if (view === 'stage' && (k === 'ArrowLeft' || k === 'PageUp')) { e.preventDefault(); step(-1); }
    else if (/^[1-9]$/.test(k) && SECTIONS[k - 1]) goSection(k - 1);
    else if (k === 't' || k === 'T') {            // demo: cycle the transition
      const order = ['', 'push', 'split', 'cut', 'blinds'];
      labFx = order[(order.indexOf(labFx) + 1) % order.length];
      updateChrome();
    } else if (k === 'h' || k === 'H') {          // demo: hide / show the controls
      lab.dataset.off = lab.dataset.off === '1' ? '' : '1';
      updateChrome();
    }
  });

  lab.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'lab-toggle') { lab.classList.toggle('is-open'); updateChrome(); }
    else if (b.dataset.fx != null) { labFx = b.dataset.fx; updateChrome(); }
    else if (b.id === 'lab-add') $('#lab-file').click();
    else if (b.id === 'lab-hide') { lab.dataset.off = '1'; updateChrome(); }
  });

  const fromFiles = files => addPhotos([...files].filter(f => f.type.startsWith('image/')).map(f => ({ url: URL.createObjectURL(f), name: f.name })));
  $('#lab-file').addEventListener('change', e => { fromFiles(e.target.files); e.target.value = ''; });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer) fromFiles(e.dataTransfer.files); });

  $('#index-close').addEventListener('click', closeIndex);
  index.addEventListener('click', e => { if (e.target === index) closeIndex(); });

  addEventListener('popstate', () => { stopTransition(); readURL(); renderHard(); });
  addEventListener('resize', () => {
    snap();
    const tall = portrait.matches, room = innerHeight / innerWidth;
    // Phone toolbars sliding in and out must not re-flow the series; a resized desktop window may
    const reflow = (tall ? 'tall' : 'wide') !== shape || (tall && !touch.matches && Math.abs(room - shapeRoom) / shapeRoom > 0.05);
    if (reflow) { buildLists(); renderHard(); return; }
    if (view === 'contact') layoutContact();
    updateChrome();
  });

  /* ---------- Start ---------- */
  (async () => {
    buildMenu();
    const found = await discover();
    photos.push(...(await Promise.all(found.map(loadPhoto))).filter(Boolean));
    assign();
    readURL();
    renderHard();
    history.replaceState(null, '', hashNow());
    rise();
    if (document.fonts) document.fonts.ready.then(updateTones);
  })();
})();
