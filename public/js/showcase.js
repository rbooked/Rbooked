/* "See it in action": a lively slider of the sample restaurants from the Rbooked demo (restaurant-facing pages only). */
(function () {
  const box = document.getElementById('showcase');
  if (!box || !window.TBSamples) return;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // The same sample restaurants the demo is filled with. Each card opens that sample's page in the demo.
  const SAMPLES = [
    ['Ember & Rye', 'New American', 'New York, NY', 3, '#b45309', 'Wood-fired plates and a deep rye list'],
    ['Tía Luz Cocina', 'Mexican', 'San Francisco, CA', 2, '#15803d', 'Masa made daily, mezcal flights'],
    ['Kumo Sushi Bar', 'Japanese', 'New York, NY', 4, '#1e3a8a', 'Omakase counter and a la carte sushi'],
    ['Osteria Lume', 'Italian', 'New York, NY', 3, '#9f1239', 'Handmade pasta, candlelit corners'],
    ['Smoke Signal BBQ', 'Barbecue', 'Austin, TX', 2, '#7c2d12', 'Central Texas brisket and ribs'],
    ['Fern & Fig', 'Vegetarian', 'Portland, OR', 2, '#4d7c0f', 'Produce-driven plates from local farms'],
    ['Harbor Oyster House', 'Seafood', 'Portland, OR', 3, '#0e7490', 'Pacific oysters and whole grilled fish'],
    ['Sol y Sal', 'Spanish & Tapas', 'Miami, FL', 3, '#b91c1c', 'Tapas and paella for two'],
    ['Little Saffron', 'Indian', 'New York, NY', 2, '#c2410c', 'Regional cooking around a tandoor'],
    ['Silver Lake Noodle', 'Thai', 'Los Angeles, CA', 2, '#7e22ce', 'Boat noodles and late-night curries'],
    ['Marrow & Vine', 'Steakhouse', 'San Francisco, CA', 4, '#7f1d1d', 'Dry-aged steaks and cabernet'],
    ['Pilsen Table', 'Latin American', 'Chicago, IL', 2, '#be185d', 'Arepas, ceviche and cocktails'],
    ['The Copper Kettle', 'Gastropub', 'Portland, OR', 2, '#a16207', 'Pub classics and 24 taps'],
  ];
  // Inside the demo itself, links stay in the demo folder.
  const inDemo = /\/demo(\/|$)/.test(location.pathname) || location.protocol === 'file:';
  const D = inDemo ? '' : '/demo/';
  const IMG = inDemo && location.protocol === 'file:' ? 'img/demo/' : '/img/demo/';
  const slug = (n) => n.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const TIMES = [['6:00', '6:45', '8:30'], ['5:30', '7:15', '9:00'], ['7:00', '7:30', '9:15'], ['6:15', '8:00', '8:45']];
  box.innerHTML = `<div class="sc-head"><div><span class="sc-kicker">See it in action</span>
      <h2 class="serif">Restaurants look great on Rbooked</h2>
      <p class="muted">Sample restaurants from the Rbooked demo. Tap one to see the page your guests get.</p></div>
      <div class="sc-arrows"><button type="button" class="sc-arrow" data-dir="-1" aria-label="Previous">‹</button><button type="button" class="sc-arrow" data-dir="1" aria-label="Next">›</button></div></div>
    <div class="sc-track" tabindex="0" aria-label="Sample restaurants">${SAMPLES.map(([name, cuisine, city, price, color, line], i) => {
    const r = { name, cuisine, accent_color: color };
    return `<a class="sc-card" href="${D}restaurant.html?slug=${slug(name)}" style="--c:${color}">
        <span class="sc-img"><img class="sc-photo" src="${IMG}${slug(name)}.jpg" alt="" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async"><span class="sc-badge">Sample</span>
          <img class="sc-logo" src="${window.TBSamples.logoArt(r)}" alt=""></span>
        <span class="sc-body"><b class="sc-name">${esc(name)}</b><span class="sc-meta">${esc(cuisine)} · ${'$'.repeat(price)} · ${esc(city)}</span>
          <span class="sc-line">${esc(line)}</span>
          <span class="sc-times">${TIMES[i % TIMES.length].map((t) => `<span>${t} PM</span>`).join('')}</span></span></a>`;
  }).join('')}</div>
    <div class="sc-foot"><a class="btn lg" href="${D}admin.html#reservations">▶ Try the restaurant side</a><a class="btn lg secondary" href="${D}index.html">See the diner side</a></div>`;
  const track = box.querySelector('.sc-track');
  const step = () => { const c = track.querySelector('.sc-card'); return c ? c.getBoundingClientRect().width + 14 : 300; };
  const go = (dir) => {
    const end = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    if (dir > 0 && end) track.scrollTo({ left: 0, behavior: 'smooth' });
    else track.scrollBy({ left: dir * step(), behavior: 'smooth' });
  };
  box.querySelectorAll('.sc-arrow').forEach((b) => { b.onclick = () => { go(Number(b.dataset.dir)); hold(); }; });
  // Glide on its own every few seconds; stop for a while once someone touches it.
  let pausedUntil = 0; const hold = () => { pausedUntil = Date.now() + 12000; };
  ['pointerdown', 'touchstart', 'wheel', 'focusin'].forEach((ev) => track.addEventListener(ev, hold, { passive: true }));
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) setInterval(() => { if (Date.now() > pausedUntil && !document.hidden) go(1); }, 3200);
})();
