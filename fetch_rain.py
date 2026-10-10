#!/usr/bin/env python3
"""抓取中央氣象署開放資料，輸出精簡的公開 JSON：
  - O-A0002-001 自動雨量站觀測 → public/rain.json
  - O-A0001-001 自動氣象站觀測（氣溫、濕度、風）→ public/weather.json

金鑰只從環境變數 CWA_API_KEY 讀取，不會寫進輸出檔，也不會印出。
用法：CWA_API_KEY=xxxx python3 fetch_rain.py
"""
import json
import os
import ssl
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone, timedelta

BASE = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/"
RAIN_ID = "O-A0002-001"
WX_ID = "O-A0001-001"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "public", "rain.json")
WX_OUT = os.path.join(HERE, "public", "weather.json")
TPE = timezone(timedelta(hours=8))


def ssl_context():
    # CWA 憑證缺少 Subject Key Identifier，Python 3.13 預設的 VERIFY_X509_STRICT 會拒絕。
    # 只關掉這個嚴格旗標，憑證鏈與主機名稱驗證仍然保留。
    ctx = ssl.create_default_context()
    if hasattr(ssl, "VERIFY_X509_STRICT"):
        ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return ctx


def fetch(key, dataset):
    url = f"{BASE}{dataset}?Authorization={urllib.request.quote(key)}&format=JSON"
    req = urllib.request.Request(url, headers={"User-Agent": "rain-app/1.0"})
    try:
        with urllib.request.urlopen(req, context=ssl_context(), timeout=60) as r:
            return json.load(r)
    except Exception as e:  # 不要把含金鑰的 URL 印出來
        msg = str(e).replace(key, "***")
        raise RuntimeError(f"{dataset} 抓取失敗：{type(e).__name__}: {msg}") from None


def num(el, name):
    """回傳雨量數值；-998、-99 等負值（缺測／維修）回傳 None。"""
    try:
        v = float(el[name]["Precipitation"])
    except (KeyError, TypeError, ValueError):
        return None
    return None if v < 0 else round(v, 1)


def wgs84(geo):
    for c in geo.get("Coordinates", []):
        if c.get("CoordinateName") == "WGS84":
            try:
                return float(c["StationLatitude"]), float(c["StationLongitude"])
            except (KeyError, ValueError):
                return None
    return None


def val(v, lo=None, hi=None):
    """一般數值；-99、-999 等缺測值或超出範圍回傳 None。"""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x <= -90 or (lo is not None and x < lo) or (hi is not None and x > hi):
        return None
    return round(x, 1)


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def ok(data):
    return str(data.get("success")).lower() == "true"


def build_rain(data):
    stations = []
    for s in data["records"]["Station"]:
        geo = s.get("GeoInfo", {})
        ll = wgs84(geo)
        if not ll:
            continue
        el = s.get("RainfallElement", {})
        stations.append({
            "id": s.get("StationId"),
            "name": s.get("StationName"),
            "county": geo.get("CountyName"),
            "town": geo.get("TownName"),
            "lat": round(ll[0], 6),
            "lon": round(ll[1], 6),
            "t": s.get("ObsTime", {}).get("DateTime"),
            "now": num(el, "Now"),        # 本日累積（自當日 00:00 起）
            "m10": num(el, "Past10Min"),
            "h1": num(el, "Past1hr"),
            "h3": num(el, "Past3hr"),
            "h24": num(el, "Past24hr"),
        })
    return stations


def build_weather(data):
    stations = []
    for s in data["records"]["Station"]:
        geo = s.get("GeoInfo", {})
        ll = wgs84(geo)
        if not ll:
            continue
        we = s.get("WeatherElement", {})
        gust = (we.get("GustInfo") or {}).get("PeakGustSpeed")
        row = {
            "id": s.get("StationId"),
            "name": s.get("StationName"),
            "town": geo.get("TownName"),
            "lat": round(ll[0], 6),
            "lon": round(ll[1], 6),
            "t": s.get("ObsTime", {}).get("DateTime"),
            "temp": val(we.get("AirTemperature"), -30, 50),
            "rh": val(we.get("RelativeHumidity"), 0, 100),
            "ws": val(we.get("WindSpeed"), 0, 80),        # m/s
            "wd": val(we.get("WindDirection"), 0, 360),   # 度，風的來向
            "gust": val(gust, 0, 100),                    # m/s，可能缺
        }
        if row["temp"] is None and row["rh"] is None and row["ws"] is None:
            continue  # 全部缺測的站不輸出
        stations.append(row)
    return stations


def main():
    key = os.environ.get("CWA_API_KEY", "").strip()
    if not key:
        sys.exit("請設定環境變數 CWA_API_KEY")
    now = datetime.now(TPE).isoformat(timespec="seconds")
    failed = False

    try:
        data = fetch(key, RAIN_ID)
        if not ok(data):
            raise RuntimeError(f"{RAIN_ID} API 回傳失敗")
        st = build_rain(data)
        write_json(OUT, {"source": f"中央氣象署開放資料 {RAIN_ID}", "generated": now, "count": len(st), "stations": st})
        print(f"已寫入 {OUT}：{len(st)} 站")
    except Exception as e:
        print(e, file=sys.stderr); failed = True

    try:
        data = fetch(key, WX_ID)
        if not ok(data):
            raise RuntimeError(f"{WX_ID} API 回傳失敗")
        st = build_weather(data)
        write_json(WX_OUT, {"source": f"中央氣象署開放資料 {WX_ID}", "generated": now, "count": len(st), "stations": st})
        print(f"已寫入 {WX_OUT}：{len(st)} 站")
    except Exception as e:
        print(e, file=sys.stderr); failed = True

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
