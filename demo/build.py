#!/usr/bin/env python3
"""Build the in-browser live demo (no server needed) from public/ into demo/build/."""
import os, re, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import sys
# `python3 demo/build.py` builds demo/build (shareable copy); `python3 demo/build.py --site` builds public/demo,
# the "Try the demo" sandbox on rbooked.com. Both run fully in the browser and never touch real data.
SITE = '--site' in sys.argv
SRC = os.path.join(ROOT, 'public')
OUT = os.path.join(SRC, 'demo') if SITE else os.path.join(ROOT, 'demo', 'build')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(os.path.join(OUT, 'css')); os.makedirs(os.path.join(OUT, 'js')); os.makedirs(os.path.join(OUT, 'admin'))
files = {
  'index.html': 'index.html', 'restaurant.html': 'restaurant.html', 'reservation.html': 'reservation.html',
  'for-restaurants.html': 'for-restaurants.html', 'login.html': 'login.html', 'embed.html': 'embed.html',
  'forgot.html': 'forgot.html', 'reset-password.html': 'reset-password.html', 'terms.html': 'terms.html', 'review.html': 'review.html', 'privacy.html': 'privacy.html',
  'admin/index.html': 'admin.html', 'admin/admin.js': 'admin/admin.js', 'admin/admin.css': 'admin/admin.css',
  'css/app.css': 'css/app.css', 'js/common.js': 'js/common.js', 'js/booking.js': 'js/booking.js', 'js/matcher.js': 'js/matcher.js',
  'js/samples.js': 'js/samples.js', 'js/places.js': 'js/places.js', 'js/menu-import.js': 'js/menu-import.js', 'js/pricing.js': 'js/pricing.js',
  'js/rbmap.js': 'js/rbmap.js',
}
REPL = [
  ('<a href="/map">Map</a>', ''), ('href="/explore"', 'href="index.html"'), ('<a href="/login" class="btn sm nav-login" data-login>Log in</a>', '<a href="admin.html" class="btn sm nav-login">Restaurant dashboard</a>'),
  ('href="/css/', 'href="css/'), ('src="/js/', 'src="js/'),
  ('href="/admin/admin.css"', 'href="admin/admin.css"'), ('src="/admin/admin.js"', 'src="admin/admin.js"'),
  ('href="/"', 'href="index.html"'), ('/for-restaurants#signup', 'for-restaurants.html#signup'),
  ('href="/for-restaurants"', 'href="for-restaurants.html"'), ('href="/terms"', 'href="terms.html"'), ('href="/privacy"', 'href="privacy.html"'), ('href="/forgot"', 'href="forgot.html"'), ('href="/login"', 'href="login.html"'),
  ("'/login'", "'login.html'"), ("'/admin/#welcome'", "'admin.html#welcome'"), ("'/admin/'", "'admin.html'"),
  ('href="/admin/"', 'href="admin.html"'), ('/restaurant?slug=', 'restaurant.html?slug='),
  ('${TB.base || location.origin}/reservation.html', 'reservation.html'),
  ('src="/js/matcher.js"', 'src="js/matcher.js"'), ('src="/embed.html?r=', 'src="embed.html?r='),
  ('href="/api/admin/emails/${e.id}" target="_blank" rel="noopener"', 'href="#emails" data-email="${e.id}"'),
  ('href="#settings" data-view="settings"', 'href="#preferences" data-view="preferences"'),
  ("settings: ['Settings', viewSettings]", "preferences: ['Settings', viewSettings]"),
  ('href="#settings"', 'href="#preferences"'),
  ('<script src="js/common.js"></script>', '<script src="js/matcher.js"></script>\n<script src="js/places.js"></script>\n<script src="js/samples.js"></script>\n<script src="mock-api.js"></script>\n<script src="js/common.js"></script>'),
]
for src, dst in files.items():
    s = open(os.path.join(SRC, src), encoding='utf-8').read()
    for a, b in REPL:
        s = s.replace(a, b)
    if SITE and dst.endswith('.html'):
        s = s.replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="robots" content="noindex">', 1)
    if dst == 'index.html' and not SITE:  # the main page is wrapped in a document skeleton at publish time
        s = re.sub(r'<!doctype html>\s*', '', s, flags=re.I)
        s = re.sub(r'</?(html|head|body)\b[^>]*>\s*', '', s, flags=re.I)
    open(os.path.join(OUT, dst), 'w', encoding='utf-8').write(s)
shutil.copy(os.path.join(ROOT, 'demo', 'mock-api.js'), os.path.join(OUT, 'mock-api.js'))
if SITE:  # on rbooked.com the other tools load from /vendor; only the map needs a copy next to the demo
    shutil.copytree(os.path.join(SRC, 'vendor', 'leaflet'), os.path.join(OUT, 'vendor', 'leaflet'))
else:
    shutil.copytree(os.path.join(SRC, 'vendor'), os.path.join(OUT, 'vendor'))
print('built', OUT)
