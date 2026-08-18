#!/usr/bin/env python3
"""Screenshot the DEV Zotero main window (or a CSS-selected element) to PNG.
Usage: scripts/dev-shot.py out.png [css-selector] [--dark|--light] [--prefs]
--prefs shoots the Settings window instead of the main window.
--dark/--light force the theme via ui.systemUsesDarkTheme (dev profile only) for the shot,
then restore the pref.
"""
import sys, json, urllib.request, os
port = os.environ.get("ZEST_DEV_PORT", "23124"); token = "zest-dev-5c1e9a27"
def ev(code):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/zest-dev/eval",
        data=json.dumps({"token": token, "code": code}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.loads(r.read().decode()); return d.get("result") if d.get("ok") else "ERROR: " + str(d.get("error"))
out = sys.argv[1]; sel = None; theme = None; prefs = False
for a in sys.argv[2:]:
    if a == "--dark": theme = 1
    elif a == "--light": theme = 0
    elif a == "--prefs": prefs = True
    else: sel = a
pre = ""
post = ""
if theme is not None:
    pre = f"Services.prefs.setIntPref('ui.systemUsesDarkTheme', {theme}); await Zotero.Promise.delay(1200);"
    post = "Services.prefs.clearUserPref('ui.systemUsesDarkTheme'); await Zotero.Promise.delay(300);"
code = pre + """
const win = %s; const doc = win.document;
let x=0,y=0,w=win.innerWidth,h=win.innerHeight;
const sel = %s;
if (sel) { const el = doc.querySelector(sel); if (!el) return 'no element '+sel; const r = el.getBoundingClientRect(); x=r.left; y=r.top; w=r.width; h=r.height; }
const scale = win.devicePixelRatio || 1;
const canvas = doc.createElementNS('http://www.w3.org/1999/xhtml','canvas');
canvas.width = Math.round(w*scale); canvas.height = Math.round(h*scale);
const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
ctx.drawWindow(win, x, y, w, h, 'rgb(255,255,255)');
const dataURL = canvas.toDataURL('image/png');
const bytes = Uint8Array.from(atob(dataURL.split(',')[1]), c => c.charCodeAt(0));
await IOUtils.write(%s, bytes);
""" % ("[...Services.wm.getEnumerator('zotero:pref')][0]" if prefs else "Zotero.getMainWindow()", json.dumps(sel), json.dumps(out)) + post + "return 'saved '+w+'x'+h+' @'+scale;"
print(ev(code))
