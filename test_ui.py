import json, sys
from playwright.sync_api import sync_playwright
BASE = "http://localhost:8090/"
SHOTS = "/workspace/rain_app/screenshots/"
places = {"suao": (24.595, 121.851), "taipei": (25.0375, 121.5637)}
out = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    for key, (lat, lon) in places.items():
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                            geolocation={"latitude": lat, "longitude": lon}, permissions=["geolocation"], locale="zh-TW",
                            service_workers="block")
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.goto(BASE); pg.wait_for_selector(".st", timeout=15000)
        pg.wait_for_timeout(500)
        pg.screenshot(path=f"{SHOTS}{key}_nearby.png")
        out[key] = pg.eval_on_selector_all(".st", "els=>els.map(e=>e.querySelector('.st-name').textContent+'｜'+e.querySelector('.st-sub').textContent+'｜'+e.querySelector('.badge').textContent+'｜'+[...e.querySelectorAll('.nums b')].map(x=>x.textContent).join('/'))")
        pg.screenshot(path=f"{SHOTS}{key}_full.png", full_page=True)
        if key == "suao":
            pg.click("#toggleMapBtn"); pg.wait_for_timeout(2500)
            pg.locator("#mapWrap").scroll_into_view_if_needed()
            pg.screenshot(path=f"{SHOTS}suao_map.png")
            pg.click("#toggleMapBtn")
            pg.once("dialog", lambda d: d.accept("田區"))
            pg.click("#savePlaceBtn"); pg.wait_for_timeout(300)
            pg.fill("#searchInput", "冬山"); pg.wait_for_timeout(300)
            pg.evaluate("window.scrollTo(0, document.body.scrollHeight)"); pg.wait_for_timeout(200)
            pg.screenshot(path=f"{SHOTS}suao_saved_search.png")
            out["saved"] = pg.evaluate("localStorage.getItem('rainapp.savedPlaces')")
            out["search_hits"] = pg.locator("#searchList .row").count()
        out[key + "_errors"] = errs
        ctx.close()
    # denied geolocation
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, service_workers="block")
    pg = ctx.new_page(); pg.goto(BASE); pg.wait_for_timeout(3000)
    out["denied_msg"] = pg.text_content("#msg")
    pg.screenshot(path=f"{SHOTS}no_location.png")
    b.close()
print(json.dumps(out, ensure_ascii=False, indent=1))
