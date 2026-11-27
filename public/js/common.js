/* Shared helpers for all pages. */
(function () {
  const TB = {};
  TB.base = window.RBOOKED_BASE || '';
  /** Link to a restaurant's page: /r/<slug> (search-engine friendly), or the demo's file page. */
  TB.rlink = (slug, query = '') => (window.RBOOKED_DEMO
    ? `restaurant.html?slug=${encodeURIComponent(slug)}${query ? `&${query}` : ''}`
    : `/r/${encodeURIComponent(slug)}${query ? `?${query}` : ''}`);

  TB.api = async function (path, opts = {}) {
    const res = await fetch(TB.base + path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  };

  TB.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  TB.time = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  };
  TB.date = (d, opts) => {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', ...(opts || {}) });
  };
  TB.today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  TB.addDays = (ds, n) => {
    const [y, m, d] = ds.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  TB.price = (n) => '$'.repeat(n || 2);
  TB.initials = (name) => name.split(/\s+/).filter((w) => /[A-Za-z]/.test(w[0] || '')).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  TB.thumbStyle = (r) => r.image_url
    ? `background-image:url('${TB.esc(r.image_url)}')`
    : `background:linear-gradient(135deg, ${r.accent_color || '#c2410c'}, #2b1a10)`;
  TB.qs = (k) => new URLSearchParams(location.search).get(k);

  TB.toast = function (msg, isError) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  };

  TB.modal = function (html, onMount) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => back.remove();
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });
    document.body.appendChild(back);
    if (onMount) onMount(back.querySelector('.modal'), close);
    return close;
  };

  // Hearts: tap to like / un-like a restaurant, dish or food photo. No account needed.
  TB.heart = (kind, id, likes, liked, extraClass = '') => `<button type="button" class="heart ${liked ? 'on' : ''} ${extraClass}" data-like="${kind}:${id}" aria-pressed="${liked}" aria-label="${liked ? 'Unlike' : 'Like'}"><i>${liked ? '♥' : '♡'}</i><span>${likes || ''}</span></button>`;
  TB.bindHearts = (root) => {
    root.querySelectorAll('[data-like]').forEach((b) => {
      if (b.dataset.bound) return; b.dataset.bound = '1';
      b.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        const [kind, id] = b.dataset.like.split(':');
        const was = b.classList.contains('on'); const cnt = b.querySelector('span');
        const n0 = Number(cnt.textContent) || 0;
        b.classList.toggle('on', !was); b.querySelector('i').textContent = was ? '♡' : '♥'; cnt.textContent = Math.max(0, n0 + (was ? -1 : 1)) || '';
        if (!was) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
        try {
          const r = await TB.api('/api/public/like', { body: { kind, id: Number(id) } });
          b.classList.toggle('on', r.liked); b.querySelector('i').textContent = r.liked ? '♥' : '♡'; cnt.textContent = r.likes || ''; b.setAttribute('aria-pressed', r.liked);
          document.querySelectorAll(`[data-like="${b.dataset.like}"]`).forEach((o) => { if (o !== b) { o.classList.toggle('on', r.liked); o.querySelector('i').textContent = r.liked ? '♥' : '♡'; o.querySelector('span').textContent = r.likes || ''; } });
        } catch (err) { b.classList.toggle('on', was); b.querySelector('i').textContent = was ? '♥' : '♡'; cnt.textContent = n0 || ''; TB.toast(err.message, true); }
      };
    });
  };

  TB.formData = (form) => {
    const out = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else out[el.name] = el.value;
    }
    return out;
  };

  TB.timeOptions = (sel = '19:00') => {
    let html = '';
    for (let m = 7 * 60; m <= 23 * 60; m += 30) {
      const v = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      html += `<option value="${v}"${v === sel ? ' selected' : ''}>${TB.time(v)}</option>`;
    }
    return html;
  };
  TB.partyOptions = (sel = 2, max = 20) => Array.from({ length: max }, (_, i) => i + 1)
    .map((n) => `<option value="${n}"${n === Number(sel) ? ' selected' : ''}>${n} ${n === 1 ? 'person' : 'people'}</option>`).join('');

  // One "Log in" button for everyone: pick diner or restaurant.
  TB.loginChooser = () => TB.modal(`<h2 class="serif" style="margin:0 0 4px">Log in to Rbooked</h2><p class="muted" style="margin:0 0 14px">Who's logging in?</p>
    <div class="who-pick">
      <a class="who" href="/me"><span class="who-ic" aria-hidden="true">🍽️</span><span><b>I'm a diner</b><small>Your bookings, visits and reviews</small></span><span class="who-go" aria-hidden="true">›</span></a>
      <a class="who" href="/login"><span class="who-ic" aria-hidden="true">🏪</span><span><b>I'm a restaurant</b><small>Reservations, floor plan and your page</small></span><span class="who-go" aria-hidden="true">›</span></a>
    </div>
    <p class="small muted" style="margin:14px 0 0;text-align:center">Own a restaurant? <a href="/for-restaurants">Rbooked for Restaurants</a></p>`);
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-login]');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault(); TB.loginChooser();
  });

  window.TB = TB;
})();
