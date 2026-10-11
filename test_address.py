# 地址查詢：定位被拒時改輸入地址，Nominatim 漸進縮短，並可改對雨量站鄉鎮。
import json
import time
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8090/"
SHOTS = "/tmp/rain-shots/"

RAIN = {
    "generated": "2026-10-10T12:00:00+08:00",
    "stations": [
        {"id": "C0U710", "name": "蘇澳", "county": "宜蘭縣", "town": "蘇澳鎮", "lat": 24.595, "lon": 121.843, "t": "2026-10-10T12:00:00+08:00", "now": 0, "m10": 0, "h1": 0, "h24": 1.5},
        {"id": "C0U720", "name": "永樂國小", "county": "宜蘭縣", "town": "蘇澳鎮", "lat": 24.575, "lon": 121.842, "t": "2026-10-10T12:00:00+08:00", "now": 0, "m10": 0, "h1": 2, "h24": 8},
        {"id": "C0U730", "name": "東澳嶺", "county": "宜蘭縣", "town": "南澳鄉", "lat": 24.520, "lon": 121.830, "t": "2026-10-10T12:00:00+08:00", "now": None, "m10": None, "h1": None, "h24": None},
        {"id": "C0U690", "name": "冬山", "county": "宜蘭縣", "town": "冬山鄉", "lat": 24.634, "lon": 121.792, "t": "2026-10-10T12:00:00+08:00", "now": 0, "m10": 1, "h1": 3, "h24": 10},
        {"id": "C0A9A0", "name": "大安", "county": "臺北市", "town": "大安區", "lat": 25.026, "lon": 121.543, "t": "2026-10-10T12:00:00+08:00", "now": 0, "m10": 0, "h1": 0, "h24": 0},
        {"id": "C0A980", "name": "信義", "county": "臺北市", "town": "信義區", "lat": 25.033, "lon": 121.565, "t": "2026-10-10T12:00:00+08:00", "now": 0, "m10": 0, "h1": 0, "h24": 0},
        {"id": "C0A770", "name": "中山", "county": "臺北市", "town": "中山區", "lat": 25.064, "lon": 121.533, "t": "2026-10-10T12:00:00+08:00", "now": 0, "m10": 0, "h1": 0, "h24": 0},
        {"id": "C0B010", "name": "基隆", "county": "基隆市", "town": "中山區", "lat": 25.133, "lon": 121.740, "t": "2026-10-10T12:00:00+08:00", "now": 0, "m10": 0, "h1": 0, "h24": 0},
        {"id": "C0V440", "name": "前鎮", "county": "高雄市", "town": "前鎮區", "lat": 22.587, "lon": 120.316, "t": "2026-10-10T12:00:00+08:00", "now": 0, "m10": 0, "h1": 0, "h24": 0},
    ],
}
WX = {
    "generated": "2026-10-10T12:00:00+08:00",
    "stations": [
        {"id": "467060", "name": "蘇澳", "town": "蘇澳鎮", "lat": 24.596, "lon": 121.851, "t": "2026-10-10T12:00:00+08:00", "temp": 26.5, "rh": 80, "ws": 3.2, "wd": 45, "gust": 5.1},
        {"id": "466920", "name": "臺北", "town": "中正區", "lat": 25.037, "lon": 121.564, "t": "2026-10-10T12:00:00+08:00", "temp": 28.0, "rh": 70, "ws": 1.2, "wd": 90, "gust": 2.0},
    ],
}

HITS = {
    "台北101": [{"display_name": "台北101, 信義區, 臺北市, 臺灣", "lat": "25.0338352", "lon": "121.5644995"}],
    "臺北市大安區": [{"display_name": "大安區, 臺北市, 臺灣", "lat": "25.0263", "lon": "121.5435"}],
    "高雄市前鎮區": [{"display_name": "前鎮區, 高雄市, 臺灣", "lat": "22.5900", "lon": "120.3100"}],
    "中山區": [
        {"display_name": "中山區, 臺北市, 臺灣", "lat": "25.0643611", "lon": "121.5334680"},
        {"display_name": "中山區, 基隆市, 臺灣", "lat": "25.1528145", "lon": "121.7295955"},
    ],
}


def main():
    import os
    os.makedirs(SHOTS, exist_ok=True)
    calls = []
    errors = []

    def handle(route):
        url = route.request.url
        if "nominatim.openstreetmap.org" in url:
            q = parse_qs(urlparse(url).query)
            for key in ("format", "countrycodes", "accept-language", "limit"):
                assert key in q, url
            assert q["format"][0] == "json"
            assert q["countrycodes"][0] == "tw"
            assert q["accept-language"][0] == "zh-TW"
            assert q["limit"][0] == "5"
            query = q.get("q", [""])[0]
            calls.append((time.time(), query))
            body = HITS.get(query, [])
            route.fulfill(status=200, content_type="application/json", body=json.dumps(body, ensure_ascii=False))
            return
        if "leaflet" in url:
            if url.endswith(".css"):
                route.fulfill(status=200, content_type="text/css", body="")
            else:
                route.fulfill(status=200, content_type="application/javascript", body="")
            return
        if "rain.json" in url:
            route.fulfill(status=200, content_type="application/json", body=json.dumps(RAIN, ensure_ascii=False))
            return
        if "weather.json" in url:
            route.fulfill(status=200, content_type="application/json", body=json.dumps(WX, ensure_ascii=False))
            return
        route.continue_()

    with sync_playwright() as p:
        b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        ctx = b.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            locale="zh-TW",
            service_workers="block",
        )
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/*", handle)
        pg.goto(BASE, wait_until="domcontentloaded")
        pg.wait_for_function("() => document.querySelector('#msg') && !document.querySelector('#msg').hidden", timeout=15000)
        msg = pg.text_content("#msg")
        assert "查詢" in msg and "地址" in msg and "台北101" in msg, msg
        assert "八仙" not in pg.content()
        pg.wait_for_function("() => document.activeElement && document.activeElement.id === 'addrInput'", timeout=3000)
        pg.screenshot(path=SHOTS + "denied_geo.png")
        assert pg.get_attribute("#addrInput", "placeholder") == "例如：台北101、冬山"

        pg.fill("#addrInput", "台北")
        pg.wait_for_timeout(400)
        assert calls == [], "輸入時不該呼叫地址服務"

        pg.fill("#addrInput", "台北101")
        pg.click("#addrBtn")
        pg.wait_for_function("() => document.querySelector('#resolved') && !document.querySelector('#resolved').hidden", timeout=15000)
        qs = [q for _, q in calls]
        assert qs == ["台北101"], qs
        label = pg.text_content("#placeLabel")
        resolved = pg.text_content("#resolved")
        assert "台北101" in label, label
        assert "台北101" in resolved and "已改查" not in resolved, resolved
        names = pg.eval_on_selector_all(".st .st-name", "els => els.map(e => e.textContent)")
        assert names[0] == "信義", names
        assert "28.0" in pg.inner_text("#wxNow"), pg.inner_text("#wxNow")
        pg.screenshot(path=SHOTS + "address_taipei101.png", full_page=True)

        n = len(calls)
        pg.click("#addrBtn")
        pg.wait_for_timeout(500)
        assert len(calls) == n, calls[n:]
        cache = json.loads(pg.evaluate("localStorage.getItem('rainapp.geocodeCache')"))
        assert cache["台北101"]["results"][0]["lat"] == 25.0338352

        pg.fill("#addrInput", "台北市大安區羅斯福路一段1號")
        pg.click("#addrBtn")
        pg.wait_for_function("() => (document.querySelector('#resolved')||{}).textContent.includes('大安')", timeout=20000)
        qs = [q for _, q in calls]
        assert qs[n:] == [
            "台北市大安區羅斯福路一段1號",
            "臺北市大安區羅斯福路一段1號",
            "臺北市大安區羅斯福路一段",
            "臺北市大安區",
        ], qs[n:]
        assert pg.eval_on_selector(".st .st-name", "e => e.textContent") == "大安"

        pg.fill("#addrInput", "高雄市前鎮區中山二路5號")
        pg.click("#addrBtn")
        pg.wait_for_function("() => (document.querySelector('#resolved')||{}).textContent.includes('前鎮')", timeout=20000)
        qs = [q for _, q in calls]
        assert "高雄市前鎮區" in qs, qs
        assert "高雄市前鎮" not in qs, qs
        assert pg.eval_on_selector(".st .st-name", "e => e.textContent") == "前鎮"

        pg.fill("#addrInput", "中山區")
        pg.click("#addrBtn")
        pg.wait_for_selector("#addrPicks .pick", timeout=10000)
        picks = pg.eval_on_selector_all("#addrPicks .pick", "els => els.map(e => e.innerText)")
        assert len(picks) == 2, picks
        assert any("臺北" in t for t in picks) and any("基隆" in t for t in picks), picks
        assert "中山" not in pg.text_content("#placeLabel")
        pg.screenshot(path=SHOTS + "address_picks.png")
        pg.locator("#addrPicks .pick").filter(has_text="臺北").click()
        pg.wait_for_function("() => document.querySelector('#placeLabel').textContent.includes('中山')")
        assert pg.eval_on_selector(".st .st-name", "e => e.textContent") == "中山"
        assert pg.locator("#addrPicks").get_attribute("hidden") is not None

        pg.once("dialog", lambda d: d.accept("公司"))
        pg.click("#savePlaceBtn")
        pg.wait_for_function("() => document.body.innerText.includes('公司')")
        saved = json.loads(pg.evaluate("localStorage.getItem('rainapp.savedPlaces')"))
        assert saved[-1]["name"] == "公司", saved
        assert abs(saved[-1]["lat"] - 25.0643611) < 1e-6
        pg.locator(".chip button[data-go]").click()
        assert pg.text_content("#placeLabel") == "公司"

        pg.fill("#searchInput", "冬山")
        pg.wait_for_selector("#searchList .row")
        assert pg.locator("#searchList .row").count() >= 1
        pg.click("#searchList .row")
        pg.wait_for_function("() => document.querySelector('#placeLabel').textContent.includes('冬山')")
        assert "冬山站" in pg.text_content("#placeLabel")

        before = len(calls)
        pg.fill("#addrInput", "冬山")
        pg.click("#addrBtn")
        pg.wait_for_function("() => (document.querySelector('#resolved')||{}).textContent.includes('雨量站')", timeout=10000)
        assert [q for _, q in calls][before:] == ["冬山"], calls[before:]
        assert "宜蘭縣冬山鄉" in pg.text_content("#placeLabel")
        assert pg.eval_on_selector(".st .st-name", "e => e.textContent") == "冬山"
        pg.screenshot(path=SHOTS + "address_town_fallback.png", full_page=True)

        pg.fill("#addrInput", "沒有這個地方xyz")
        pg.click("#addrBtn")
        pg.wait_for_function("() => document.querySelector('#msg').textContent.includes('找不到')", timeout=10000)
        for a, c in zip(calls, calls[1:]):
            assert c[0] - a[0] >= 1.0, calls
        assert errors == [], errors
        ctx.close()

        ctx = b.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            locale="zh-TW",
            service_workers="block",
            geolocation={"latitude": 24.595, "longitude": 121.851},
            permissions=["geolocation"],
        )
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/*", handle)
        pg.goto(BASE, wait_until="domcontentloaded")
        pg.wait_for_selector(".st", timeout=15000)
        pg.wait_for_function("() => document.querySelector('#placeLabel').textContent.includes('我的位置')")
        assert pg.eval_on_selector(".st .st-name", "e => e.textContent") == "蘇澳"
        assert pg.locator("#addrInput").count() == 1
        pg.screenshot(path=SHOTS + "gps_still_works.png", full_page=True)
        assert errors == [], errors
        b.close()
    print("ok", len(calls), "nominatim calls")


if __name__ == "__main__":
    main()
