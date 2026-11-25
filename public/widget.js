/*!
 * Rbooked booking widget.
 * Inline:  <div data-rbooked="your-slug"></div><script src="https://YOUR-DOMAIN/widget.js" async></script>
 * Button:  <script src="https://YOUR-DOMAIN/widget.js" data-restaurant="your-slug" data-mode="button" async></script>
 * Options (on the div or script tag): data-color="#c2410c", data-party="2", data-label="Reserve a table"
 */
(function () {
  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    for (var i = s.length - 1; i >= 0; i--) if (/widget\.js/.test(s[i].src)) return s[i];
  })();
  var origin = new URL(script.src).origin;
  var frames = [];

  function src(slug, opts) {
    var q = 'r=' + encodeURIComponent(slug);
    if (opts.color) q += '&color=' + encodeURIComponent(opts.color.replace('#', ''));
    if (opts.party) q += '&party=' + encodeURIComponent(opts.party);
    return origin + '/embed.html?' + q;
  }

  function makeFrame(slug, opts) {
    var f = document.createElement('iframe');
    f.src = src(slug, opts);
    f.title = 'Reserve a table';
    f.loading = 'lazy';
    f.setAttribute('allow', 'clipboard-write');
    f.style.cssText = 'width:100%;max-width:480px;min-height:420px;border:0;display:block;margin:0 auto;background:transparent;color-scheme:light';
    f.dataset.slug = slug;
    frames.push(f);
    return f;
  }

  function inline(el) {
    if (el.dataset.tbMounted) return;
    el.dataset.tbMounted = '1';
    el.appendChild(makeFrame(el.getAttribute('data-rbooked'), { color: el.dataset.color, party: el.dataset.party }));
  }

  function button(slug, opts) {
    var color = opts.color || '#c2410c';
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = opts.label || 'Reserve a table';
    b.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483000;background:' + color +
      ';color:#fff;border:0;border-radius:999px;padding:14px 22px;font:600 15px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);cursor:pointer';
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483001;display:none;align-items:center;justify-content:center;padding:16px';
    var box = document.createElement('div');
    box.style.cssText = 'position:relative;width:100%;max-width:480px;max-height:92vh;overflow:auto;border-radius:14px';
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.style.cssText = 'position:absolute;top:6px;right:8px;z-index:2;background:#fff;border:0;border-radius:50%;width:32px;height:32px;font-size:22px;line-height:1;cursor:pointer';
    var frame = null;
    box.appendChild(close);
    overlay.appendChild(box);
    b.onclick = function () {
      if (!frame) { frame = makeFrame(slug, opts); box.appendChild(frame); }
      overlay.style.display = 'flex';
    };
    close.onclick = function () { overlay.style.display = 'none'; };
    overlay.onclick = function (e) { if (e.target === overlay) overlay.style.display = 'none'; };
    document.body.appendChild(b);
    document.body.appendChild(overlay);
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== origin || !e.data) return;
    if (e.data.type === 'rbooked:height') {
      frames.forEach(function (f) { if (f.contentWindow === e.source) f.style.height = (e.data.height + 4) + 'px'; });
    }
    if (e.data.type === 'rbooked:booked') {
      document.dispatchEvent(new CustomEvent('rbooked:booked', { detail: { code: e.data.code } }));
    }
  });

  function init() {
    var nodes = document.querySelectorAll('[data-rbooked]');
    for (var i = 0; i < nodes.length; i++) inline(nodes[i]);
    var slug = script.getAttribute('data-restaurant');
    if (slug && script.getAttribute('data-mode') === 'button') {
      button(slug, { color: script.getAttribute('data-color'), party: script.getAttribute('data-party'), label: script.getAttribute('data-label') });
    } else if (slug && !nodes.length) {
      var holder = document.createElement('div');
      script.parentNode.insertBefore(holder, script.nextSibling);
      holder.setAttribute('data-rbooked', slug);
      if (script.getAttribute('data-color')) holder.dataset.color = script.getAttribute('data-color');
      inline(holder);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
