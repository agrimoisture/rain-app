import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        geolocation={"latitude": 24.595, "longitude": 121.851}, permissions=["geolocation"], service_workers="block")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto("http://localhost:8090/"); pg.wait_for_selector(".st .wx", timeout=15000); pg.wait_for_timeout(500)
    print("HEADER:", pg.inner_text("#wxNow").replace("\n", " | "))
    for t in pg.eval_on_selector_all(".st", "e=>e.map(x=>x.querySelector('.st-name').textContent+'｜'+(x.querySelector('.wx')||{}).textContent)"):
        print(t)
    pg.screenshot(path="screenshots/suao_temp.png")
    print("errors:", errs)
    b.close()
