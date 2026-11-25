/* Shared helpers for all pages. */
(function () {
  const TB = {};
  TB.base = window.TABLEBIRD_BASE || '';

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

  window.TB = TB;
})();
