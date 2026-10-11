# 附近有沒有下雨（雨量站即時查詢 Web App）

用手機打開，自動找出離你最近的 5 個中央氣象署自動雨量站，顯示「正在下雨／剛下過／沒下雨」與 10 分鐘、1 小時、24 小時雨量。
可搜尋站名或鄉鎮，輸入地址或地標查附近雨量站，也能把「田區」「公司」等常用地點存在手機（localStorage），並可加到主畫面（PWA）。

定位被拒絕或沒有定位時，頁面上方可輸入地址、地標或鄉鎮（例如 `台北101`、`冬山`）再按「查詢」。查詢使用 OpenStreetMap Nominatim（不需金鑰）：只在按下按鈕時送出、每秒最多 1 次，結果暫存在 localStorage。台灣門牌常查不到，會依序改試去掉號／巷／弄、再去掉路名，最後用鄉鎮市區加縣市；仍沒有結果就對照雨量站的縣市、鄉鎮名稱。多個結果可點選，查到的位置也能存成常用地點。

資料來源：中央氣象署開放資料
- O-A0002-001 自動雨量站觀測（約 1,340 站，約每 10 分鐘更新）→ `public/rain.json`
- O-A0001-001 自動氣象站觀測（氣溫、濕度、風速、風向、陣風；約 850 站，每小時更新）→ `public/weather.json`

每個雨量站會附上「最近一個氣溫有效的氣象站」的氣溫、濕度與風（並標出該站名稱與距離）；頁首顯示查詢位置最近氣象站的現況。-99、-999 等缺測值會略過不顯示。風向是風吹來的方向（8 方位），風速 0 顯示「靜風」。

## 判斷規則
- 近 10 分鐘雨量 > 0 → 🌧 正在下雨
- 否則近 1 小時雨量 > 0 → 🌦 剛下過（1 小時內有下）
- 其他 → ☀️ 沒下雨
- 數值為負（-998、-99 等缺測／維修）→ 顯示「—」，兩者都缺時標「資料缺測」
- 「今日累積」是 API 的 Now 欄位（當天 00:00 起累積）

## 檔案
| 檔案 | 用途 |
|---|---|
| `fetch_rain.py` | 伺服器端抓資料，輸出精簡的 `public/rain.json` 與 `public/weather.json`（不含金鑰）。只用 Python 標準函式庫 |
| `public/index.html`, `app.js`, `style.css` | 前端，無需 build，地圖用免費 Leaflet + OpenStreetMap |
| `public/manifest.json`, `sw.js`, `icon-*.png` | PWA（加到主畫面、離線時顯示上次資料） |
| `.github/workflows/update.yml` | GitHub Actions：每 10 分鐘抓資料並發布到 GitHub Pages |

## 本機執行
```bash
export CWA_API_KEY=你的授權碼      # 不要寫進任何檔案或 git
python3 fetch_rain.py              # 產生 public/rain.json、public/weather.json
cd public && python3 -m http.server 8090
# 瀏覽器開 http://localhost:8090
```
注意：手機瀏覽器的定位功能只在 HTTPS 或 localhost 下可用，所以要用手機實際定位，需放到下面的 GitHub Pages（HTTPS）。

關於 TLS：CWA 的憑證缺少 Subject Key Identifier，Python 3.13 預設會拒絕。`fetch_rain.py` 只關掉 `VERIFY_X509_STRICT` 這個旗標，憑證鏈與主機名稱仍照常驗證。

## 免費上線方案：GitHub Pages + GitHub Actions
金鑰只存在 GitHub 的加密 Secret 裡，網頁上只有 `rain.json` 公開資料。

1. 申請 GitHub 帳號（免費），建立一個新的 **Public** repository（例如 `rain-app`；免費帳號的 Pages 需要公開 repo）。
2. 把本資料夾內容 push 上去（`.gitignore` 已排除 `rain.json`、`.venv`、截圖）。
3. Settings → Secrets and variables → Actions → New repository secret：名稱 `CWA_API_KEY`，值填授權碼。
4. Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。
5. Actions 頁籤 → 「更新雨量資料並發布到 GitHub Pages」→ Run workflow 跑第一次。
6. 網址會是 `https://<帳號>.github.io/rain-app/`，用手機打開 → 分享 → 加入主畫面。

之後 workflow 每 10 分鐘自動更新（GitHub 的排程常延遲 3–15 分鐘，屬正常）。公開 repo 的 Actions 分鐘數免費。
若 repo 60 天沒有任何 commit，GitHub 會暫停排程，需到 Actions 頁面重新啟用。
