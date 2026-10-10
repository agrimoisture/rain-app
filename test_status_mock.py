# 用假資料驗證三種狀態與缺測顯示（不改動 public/rain.json）
import json
from playwright.sync_api import sync_playwright
d = json.load(open("public/rain.json"))
ids = {"蘇澳": dict(m10=1.5, h1=6.0, h24=20.0), "永樂國小": dict(m10=0, h1=2.0, h24=8.0), "東澳嶺": dict(m10=None, h1=None, h24=None, now=None)}
for s in d["stations"]:
    if s["name"] in ids and s["county"] == "宜蘭縣": s.update(ids[s["name"]])
body = json.dumps(d, ensure_ascii=False)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True,
                        geolocation={"latitude": 24.595, "longitude": 121.851}, permissions=["geolocation"], service_workers="block")
    pg = ctx.new_page()
    pg.route("**/rain.json*", lambda r: r.fulfill(status=200, content_type="application/json", body=body))
    pg.goto("http://localhost:8090/"); pg.wait_for_selector(".st"); pg.wait_for_timeout(400)
    print(pg.eval_on_selector_all(".badge", "e=>e.map(x=>x.textContent)"))
    pg.screenshot(path="screenshots/status_demo_mock.png")
    b.close()
