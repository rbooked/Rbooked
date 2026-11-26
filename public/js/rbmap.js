/* Small restaurant maps (home page + restaurant page). Leaflet is self-hosted and only loaded when a map
   is about to scroll into view, so pages stay fast. Map tiles: OpenStreetMap (free, attribution shown). */
(function () {
  let loading = null;
  const VENDOR = (window.RBOOKED_DEMO ? '' : '/') + 'vendor/leaflet/';
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = VENDOR + 'leaflet.css'; document.head.appendChild(css);
      const s = document.createElement('script'); s.src = VENDOR + 'leaflet.js'; s.async = true;
      s.onload = () => resolve(window.L); s.onerror = () => { loading = null; reject(new Error('map failed to load')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function whenVisible(el, fn) {
    if (!('IntersectionObserver' in window)) return fn();
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '300px' });
    io.observe(el);
  }
  function pinIcon(L, label) {
    return L.divIcon({ className: 'rb-pin-wrap', html: `<span class="rb-pin"><span>${esc(label)}</span></span>`, iconSize: [34, 42], iconAnchor: [17, 40], popupAnchor: [0, -36] });
  }
  /**
   * Draw pins in `el`. pins: [{lat, lng, name, slug, cuisine, city, state, tag, image_url}].
   * opts.center {lat,lng} (zoom there), opts.single (one restaurant: no popups needed, fixed zoom),
   * opts.link(pin) -> href for the popup's button.
   */
  function draw(el, pins, opts = {}) {
    if (!el) return;
    whenVisible(el, () => loadLeaflet().then((L) => {
      if (el._rbMap) { el._rbMap.remove(); el._rbMap = null; }
      // On phones the map doesn't grab your finger while you scroll the page; tap "Move map" to explore it.
      const touch = L.Browser.mobile || ('ontouchstart' in window);
      const map = L.map(el, { scrollWheelZoom: false, tap: !touch, dragging: !touch, touchZoom: !touch, doubleClickZoom: !touch, zoomControl: !opts.single && !touch, attributionControl: true, fadeAnimation: !touch, zoomAnimation: !touch, markerZoomAnimation: !touch });
      if (touch && !opts.single) {
        const btn = L.DomUtil.create('button', 'rb-map-move', el); btn.type = 'button'; btn.textContent = 'Move map';
        L.DomEvent.disableClickPropagation(btn);
        btn.onclick = () => {
          const on = !map.dragging.enabled();
          [map.dragging, map.touchZoom].forEach((h) => (on ? h.enable() : h.disable()));
          btn.textContent = on ? 'Done' : 'Move map'; btn.classList.toggle('on', on);
        };
      }
      el._rbMap = map; map.attributionControl.setPrefix(false);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
      const pts = [];
      for (const p of pins) {
        if (p.lat == null || p.lng == null) continue;
        const m = L.marker([p.lat, p.lng], { icon: pinIcon(L, (p.name || '?').trim().charAt(0).toUpperCase()), title: p.name, keyboard: true }).addTo(map);
        if (!opts.single) {
          const href = opts.link ? opts.link(p) : window.TB && TB.rlink ? TB.rlink(p.slug) : `/r/${encodeURIComponent(p.slug)}`;
          m.bindPopup(`<div class="rb-pop">${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : ''}
            <b>${esc(p.name)}</b><div class="muted small">${esc([p.cuisine, p.city].filter(Boolean).join(' · '))}</div>
            ${p.tag ? `<div class="rb-pop-tag">${esc(p.tag)}</div>` : ''}<a class="btn sm" href="${esc(href)}">Book a table</a></div>`, { maxWidth: 240, minWidth: 180 });
        }
        pts.push([p.lat, p.lng]);
      }
      if (opts.single && pts[0]) map.setView(pts[0], 15);
      else if (opts.center) {
        map.setView([opts.center.lat, opts.center.lng], 11);
        const near = pts.filter((q) => map.distance(q, [opts.center.lat, opts.center.lng]) < 40000);
        if (near.length) map.fitBounds(L.latLngBounds([...near, [opts.center.lat, opts.center.lng]]), { padding: [36, 36], maxZoom: 14 });
      } else if (pts.length === 1) map.setView(pts[0], 13);
      else if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 14 });
      else map.setView([39.5, -98.35], 3);
      setTimeout(() => map.invalidateSize(), 50);
    }).catch(() => { el.classList.add('rb-map-off'); el.innerHTML = '<p class="muted small">The map couldn’t load right now.</p>'; }));
  }
  window.TBMap = { draw, loadLeaflet };
})();
