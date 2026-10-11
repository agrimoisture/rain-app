'use strict';
(() => {
  const DATA_URL = 'rain.json';
  const WX_URL = 'weather.json';
  const SAVED_KEY = 'rainapp.savedPlaces';
  const LAST_KEY = 'rainapp.lastPlace';
  const GEO_KEY = 'rainapp.geocodeCache';
  const GEO_TTL = 30 * 24 * 60 * 60 * 1000;
  const GEO_MAX = 40;
  const NEAR_N = 5;
  const AUTO_REFRESH_MS = 5 * 60 * 1000;
  const COUNTY_NAMES = ['基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣'];

  const $ = (id) => document.getElementById(id);
  let stations = [];
  let wx = []; // 自動氣象站（氣溫、濕度、風）
  let generated = null;
  let current = null; // {name, lat, lon, source}
  let map = null, mapLayer = null;
  let pickState = null;
  let searchGen = 0;
  let locateGen = 0;
  let lastGeoAt = 0;
  let geoQueue = Promise.resolve();

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 資料 ----------
  async function loadData() {
    $('refreshBtn').classList.add('spin');
    try {
      const [r, rw] = await Promise.all([
        fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' }),
        fetch(WX_URL + '?t=' + Date.now(), { cache: 'no-store' }).catch(() => null),
      ]);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      try { wx = rw && rw.ok ? ((await rw.json()).stations || []) : []; } catch { wx = []; }
      stations = d.stations || [];
      generated = d.generated;
      renderDataTime();
      renderAll();
    } catch (e) {
      $('dataTime').textContent = '資料載入失敗，請稍後再試（' + e.message + '）';
    } finally {
      $('refreshBtn').classList.remove('spin');
    }
  }

  function latestObs() {
    let t = null;
    for (const s of stations) if (s.t && (!t || s.t > t)) t = s.t;
    return t;
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = (n) => String(n).padStart(2, '0');
    // 以台灣時間顯示
    const tw = new Date(d.getTime() + (8 * 60 + d.getTimezoneOffset()) * 60000);
    return `${tw.getMonth() + 1}/${tw.getDate()} ${p(tw.getHours())}:${p(tw.getMinutes())}`;
  }

  function renderDataTime() {
    const t = latestObs();
    const ageMin = t ? Math.round((Date.now() - new Date(t)) / 60000) : null;
    const stale = ageMin !== null && ageMin > 40;
    $('dataTime').innerHTML = `觀測時間：${esc(fmtTime(t))}（台灣時間）・共 ${stations.length} 站` +
      (stale ? `<br><span class="stale">資料已超過 ${ageMin} 分鐘未更新</span>` : '');
  }

  // ---------- 判斷 ----------
  function status(s) {
    if (s.m10 == null && s.h1 == null) return { cls: 'na', text: '資料缺測' };
    if ((s.m10 || 0) > 0) return { cls: 'rain', text: '🌧 正在下雨' };
    if ((s.h1 || 0) > 0) return { cls: 'recent', text: '🌦 剛下過' };
    return { cls: 'dry', text: '☀️ 沒下雨' };
  }
  const mm = (v) => (v == null ? '—' : (v === 0 ? '0' : v.toFixed(1)));

  function distKm(a, b, c, d) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (c - a) * rad, dLon = (d - b) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  const fmtDist = (km) => (km < 1 ? Math.round(km * 1000) + ' 公尺' : km.toFixed(1) + ' 公里');

  function nearest(lat, lon, n) {
    return stations.map((s) => ({ s, d: distKm(lat, lon, s.lat, s.lon) }))
      .sort((a, b) => a.d - b.d).slice(0, n);
  }

  // ---------- 氣溫／濕度／風 ----------
  const DIRS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
  const windDir = (deg) => (deg == null ? '' : DIRS[Math.round(deg / 45) % 8] + '風');
  const kmShort = (d) => (d < 10 ? d.toFixed(1) : Math.round(d)) + ' km';

  // 最近一個「氣溫有效」的氣象站
  function nearestWx(lat, lon) {
    let best = null, bd = Infinity;
    for (const w of wx) {
      if (w.temp == null) continue;
      const d = distKm(lat, lon, w.lat, w.lon);
      if (d < bd) { bd = d; best = w; }
    }
    return best ? { w: best, d: bd } : null;
  }

  function windText(w) {
    if (w.ws == null) return '';
    if (w.ws === 0) return '靜風';
    let t = `風速 ${w.ws.toFixed(1)} m/s${w.wd != null ? ' ' + windDir(w.wd) : ''}`;
    if (w.gust != null) t += `（陣風 ${w.gust.toFixed(1)}）`;
    return t;
  }

  function wxParts(w) {
    const parts = [`氣溫 ${w.temp.toFixed(1)}℃`];
    if (w.rh != null) parts.push(`濕度 ${Math.round(w.rh)}%`);
    const wt = windText(w);
    if (wt) parts.push(wt);
    return parts;
  }

  function wxLine(lat, lon) {
    const n = nearestWx(lat, lon);
    if (!n) return '';
    return `<div class="wx">🌡 ${esc(wxParts(n.w).join('・'))}<span class="wx-src">（${esc(n.w.name)}氣象站 ${kmShort(n.d)}）</span></div>`;
  }

  function renderHeaderWx() {
    const box = $('wxNow');
    if (!current) { box.hidden = true; return; }
    const n = nearestWx(current.lat, current.lon);
    if (!n) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="wxnow-main">${esc(n.w.temp.toFixed(1))}<small>℃</small></div>
      <div class="wxnow-detail"><div>${esc(wxParts(n.w).slice(1).join('・') || '濕度、風速缺測')}</div>
      <div class="wx-src">${esc(n.w.name)}氣象站・距離 ${kmShort(n.d)}・${esc(fmtTime(n.w.t))} 觀測</div></div>`;
  }

  // ---------- 畫面 ----------
  function stationCard(s, d) {
    const st = status(s);
    return `<article class="st ${st.cls}" data-id="${esc(s.id)}">
      <div class="st-head">
        <div><div class="st-name">${esc(s.name)}</div>
        <div class="st-sub">${esc(s.county)}${esc(s.town)}${d != null ? '・距離 ' + fmtDist(d) : ''}</div></div>
        <span class="badge ${st.cls}">${st.text}</span>
      </div>
      <div class="nums">
        <div><b>${mm(s.m10)}</b><span>10 分鐘 (mm)</span></div>
        <div><b>${mm(s.h1)}</b><span>1 小時 (mm)</span></div>
        <div><b>${mm(s.h24)}</b><span>24 小時 (mm)</span></div>
      </div>
      ${wxLine(s.lat, s.lon)}
      <div class="st-foot"><span>觀測 ${esc(fmtTime(s.t))}・今日累積 ${mm(s.now)} mm</span>
      <button class="linkbtn" data-center="${esc(s.id)}">以此站為中心</button></div>
    </article>`;
  }

  function renderNear() {
    const box = $('nearList');
    if (!current) { box.innerHTML = '<div class="empty">輸入地址按「查詢」，或按「用我的位置」</div>'; return; }
    if (!stations.length) { box.innerHTML = '<div class="empty">資料載入中…</div>'; return; }
    const list = nearest(current.lat, current.lon, NEAR_N);
    box.innerHTML = list.map(({ s, d }) => stationCard(s, d)).join('');
    renderHeaderWx();
    renderMap(list);
  }

  function renderPlace() {
    if (!current) return;
    $('placeLabel').textContent = current.name;
    $('savePlaceBtn').disabled = false;
    const r = $('resolved');
    if (current.detail) {
      r.hidden = false;
      r.textContent = current.detail;
    } else {
      r.hidden = true;
      r.textContent = '';
    }
    renderSaved();
  }

  function renderAll() { renderPlace(); renderNear(); renderSearch(); }

  function setPlace(p, { remember = true } = {}) {
    current = p;
    if (remember) localStorage.setItem(LAST_KEY, JSON.stringify(p));
    renderPlace();
    renderNear();
  }

  function showMsg(t, kind) {
    const m = $('msg');
    m.textContent = t || '';
    m.hidden = !t;
    m.classList.toggle('info', kind === 'info');
  }

  function focusAddr() {
    const input = $('addrInput');
    if (!input) return;
    input.focus();
  }

  // ---------- 定位 ----------
  function locate() {
    const gen = ++locateGen;
    searchGen++;
    $('addrBtn').disabled = false;
    if (!navigator.geolocation) {
      showMsg('這個瀏覽器不支援定位。請在上方輸入地址、地標或鄉鎮，再按「查詢」。');
      $('placeLabel').textContent = current ? current.name : '尚未定位';
      focusAddr();
      return;
    }
    showMsg('');
    $('placeLabel').textContent = '定位中…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (gen !== locateGen) return;
        setPlace({ name: '我的位置', lat: pos.coords.latitude, lon: pos.coords.longitude, source: 'gps' });
      },
      (err) => {
        if (gen !== locateGen) return;
        const why = err.code === 1 ? '沒有定位權限' : err.code === 3 ? '定位逾時' : '無法取得位置';
        showMsg(why + '。請在上方輸入地址、地標或鄉鎮（例如：台北101），再按「查詢」。');
        $('placeLabel').textContent = current ? current.name : '尚未定位';
        focusAddr();
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  // ---------- 地址查詢（Nominatim，只在按下查詢時、每秒最多 1 次）----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function normTw(s) {
    return String(s || '').replace(/\u3000/g, '').replace(/\s+/g, '').replace(/台/g, '臺');
  }

  function stripLaneNo(q) {
    let s = normTw(q);
    s = s.replace(/[0-9０-９一二三四五六七八九十百千]+號.*$/, '');
    s = s.replace(/[0-9０-９一二三四五六七八九十百千]*巷/g, '');
    s = s.replace(/[0-9０-９一二三四五六七八九十百千]*弄/g, '');
    s = s.replace(/[0-9０-９一二三四五六七八九十百千]+樓.*$/, '');
    s = s.replace(/之[0-9０-９一二三四五六七八九十]+$/, '');
    return s;
  }

  // 拆成縣市、鄉鎮市區、村里，剩下的視為路街
  function splitAdmin(q) {
    const n = normTw(q);
    let county = '';
    let pos = 0;
    for (const c of COUNTY_NAMES) {
      if (n.startsWith(c)) { county = c; pos = c.length; break; }
    }
    if (!county) {
      for (const c of COUNTY_NAMES) {
        const i = n.indexOf(c);
        if (i >= 0) { county = c; pos = i + c.length; break; }
      }
    }
    let rest = n.slice(pos);
    let town = '';
    const tm = rest.match(/^(.{1,4}?)(鄉|鎮|區|市)/);
    if (tm) {
      town = tm[1] + tm[2];
      // 前鎮區、新市區：名稱裡的 鎮/市 不是字尾，後面的「區」才是
      if ((tm[2] === '鎮' || tm[2] === '市' || tm[2] === '鄉') && rest[town.length] === '區' && tm[1].length < 4) {
        town += '區';
      }
      rest = rest.slice(town.length);
    }
    let village = '';
    const vm = rest.match(/^(.{1,4}?)(村|里)/);
    if (vm) { village = vm[1] + vm[2]; rest = rest.slice(village.length); }
    return { county, town, village, rest };
  }

  function extractAdmin(q) {
    const a = splitAdmin(q);
    return { county: a.county, town: a.town };
  }

  function stripRoad(q) {
    const a = splitAdmin(q);
    if (!a.rest || !/(?:大道|路|街)/.test(a.rest)) return '';
    return (a.county || '') + (a.town || '') + (a.village || '');
  }

  function querySteps(raw) {
    const original = String(raw || '').trim();
    const norm = normTw(original);
    const out = [];
    const add = (s) => {
      const t = String(s || '').trim();
      if (t.length < 2 || out.includes(t)) return;
      out.push(t);
    };
    add(original);
    add(norm);
    const noNum = stripLaneNo(norm);
    add(noNum);
    add(stripRoad(noNum));
    const admin = extractAdmin(noNum);
    if (admin.county && admin.town) add(admin.town + admin.county);
    else add(admin.town || admin.county || '');
    return out;
  }

  function shortPlaceName(display, fallback) {
    const drop = /^(台灣|臺灣|Taiwan|中華民國)$/;
    const parts = String(display || '').split(/[,，]/).map((s) => s.trim()).filter((p) => p && !drop.test(p) && !/^\d{3,6}$/.test(p));
    if (!parts.length) return String(fallback || display || '').slice(0, 20);
    const head = parts[0];
    const town = [...parts].reverse().find((p) => /(鄉|鎮|區)$/.test(p));
    const county = [...parts].reverse().find((p) => /(縣|市)$/.test(p) && p.length <= 4);
    const bits = [head];
    if (town && town !== head) bits.push(town);
    else if (county && county !== head) bits.push(county);
    return bits.join(' ').slice(0, 20);
  }

  function readGeoCache() {
    try { return JSON.parse(localStorage.getItem(GEO_KEY)) || {}; } catch { return {}; }
  }
  function cacheGet(q) {
    const row = readGeoCache()[q];
    if (!row || !Array.isArray(row.results)) return undefined;
    if (!row.t || Date.now() - row.t > GEO_TTL) return undefined;
    return row.results;
  }
  function cacheSet(q, results) {
    try {
      const all = readGeoCache();
      all[q] = { t: Date.now(), results };
      const keys = Object.keys(all);
      if (keys.length > GEO_MAX) {
        keys.sort((a, b) => (all[a].t || 0) - (all[b].t || 0));
        for (const k of keys.slice(0, keys.length - GEO_MAX)) delete all[k];
      }
      localStorage.setItem(GEO_KEY, JSON.stringify(all));
    } catch { /* 空間不足時略過快取 */ }
  }

  function throttleGeo() {
    const job = geoQueue.then(async () => {
      const wait = 1100 - (Date.now() - lastGeoAt);
      if (wait > 0) await sleep(wait);
      lastGeoAt = Date.now();
    });
    geoQueue = job.then(() => {}, () => {});
    return job;
  }

  async function nominatimSearch(q) {
    const cached = cacheGet(q);
    if (cached) return cached;
    await throttleGeo();
    const url = 'https://nominatim.openstreetmap.org/search?format=json&countrycodes=tw&accept-language=zh-TW&limit=5&q=' + encodeURIComponent(q);
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const results = [];
    for (const item of (Array.isArray(data) ? data : [])) {
      const lat = Number(item.lat);
      const lon = Number(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const name = String(item.display_name || q);
      results.push({ label: shortPlaceName(name, q), name, lat, lon });
    }
    cacheSet(q, results);
    return results;
  }

  function matchStationsArea(q) {
    const nq = normTw(q);
    if (nq.length < 2 || !stations.length) return [];
    const admin = extractAdmin(nq);
    const groups = new Map();
    for (const s of stations) {
      if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
      const c = normTw(s.county || '');
      const t = normTw(s.town || '');
      if (!c && !t) continue;
      const k = c + '\n' + t;
      let g = groups.get(k);
      if (!g) {
        g = { county: s.county || '', town: s.town || '', c, t, pts: [] };
        groups.set(k, g);
      }
      g.pts.push(s);
    }
    const toHit = (g) => {
      const lat = g.pts.reduce((a, s) => a + s.lat, 0) / g.pts.length;
      const lon = g.pts.reduce((a, s) => a + s.lon, 0) / g.pts.length;
      const label = `${g.county}${g.town}`;
      return { label, name: '以雨量站分布估算', lat, lon };
    };
    const townHits = [];
    for (const g of groups.values()) {
      const short = g.t.replace(/(鄉|鎮|市|區)$/, '');
      let ok = false;
      if (admin.town) {
        const want = normTw(admin.town).replace(/(鄉|鎮|市|區)$/, '');
        ok = (g.t === normTw(admin.town) || (short && short === want)) && (!admin.county || g.c === admin.county);
      } else if (short && (nq === g.t || nq === short)) ok = true;
      if (ok) townHits.push(toHit(g));
    }
    if (townHits.length) {
      townHits.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'));
      return townHits.slice(0, 12);
    }
    const countyOf = (name) => {
      const pts = [];
      let label = name;
      for (const g of groups.values()) {
        if (g.c !== name) continue;
        if (g.county) label = g.county;
        pts.push(...g.pts);
      }
      if (!pts.length) return null;
      return {
        label,
        name: '以雨量站分布估算',
        lat: pts.reduce((a, s) => a + s.lat, 0) / pts.length,
        lon: pts.reduce((a, s) => a + s.lon, 0) / pts.length,
      };
    };
    if (admin.county) {
      const hit = countyOf(admin.county);
      if (hit) return [hit];
    }
    const byC = new Map();
    for (const g of groups.values()) {
      const cshort = g.c.replace(/(縣|市)$/, '');
      if (!cshort || (nq !== g.c && nq !== cshort)) continue;
      if (!byC.has(g.c)) byC.set(g.c, g.county || g.c);
    }
    return [...byC.entries()].map(([c, label]) => {
      const hit = countyOf(c);
      return hit ? { ...hit, label } : null;
    }).filter(Boolean);
  }

  function describeHit(hit, info) {
    if (info.via === 'offline' || info.via === 'station') {
      const where = hit.label || hit.name;
      const why = info.via === 'offline' ? '地圖服務暫時連不上' : `地圖服務找不到「${info.query}」`;
      return `使用位置：${where}\n${why}，改以雨量站分布估算。`;
    }
    if (info.used && normTw(info.used) !== normTw(info.query)) {
      return `使用位置：${hit.name}\n「${info.query}」沒有結果，已改查「${info.used}」。`;
    }
    return `使用位置：${hit.name}`;
  }

  function commitHit(hit, info) {
    setPlace({
      name: hit.label || shortPlaceName(hit.name, info.query),
      lat: hit.lat,
      lon: hit.lon,
      source: 'address',
      query: info.query,
      detail: describeHit(hit, info),
    });
    pickState = null;
    const box = $('addrPicks');
    box.hidden = true;
    box.innerHTML = '';
    showMsg('');
  }

  function showPicks(hits, info) {
    pickState = { hits, info };
    const shortened = info.via === 'nominatim' && info.used && normTw(info.used) !== normTw(info.query);
    const head = info.via === 'offline' || info.via === 'station'
      ? `${info.via === 'offline' ? '地圖服務暫時連不上' : '地圖服務找不到'}「${info.query}」。以下是名稱相符的鄉鎮，請選一個：`
      : shortened
        ? `「${info.query}」沒有直接結果，已改查「${info.used}」。找到多個地點，請選一個：`
        : '找到多個地點，請選一個：';
    const box = $('addrPicks');
    box.hidden = false;
    box.innerHTML = `<div class="pick-hint">${esc(head)}</div>` + hits.map((h, i) => {
      const label = h.label || shortPlaceName(h.name, info.query);
      const sub = h.name && h.name !== label ? `<div class="st-sub">${esc(h.name)}</div>` : '';
      return `<button type="button" class="row pick" data-pick="${i}"><div><b>${esc(label)}</b>${sub}</div></button>`;
    }).join('');
    if (!current) $('placeLabel').textContent = '請選擇地點';
    showMsg('');
  }

  function presentHits(hits, info) {
    if (hits.length === 1) commitHit(hits[0], info);
    else showPicks(hits, info);
  }

  async function searchAddress(raw) {
    const query = String(raw || '').trim();
    if (!query) {
      showMsg('請輸入地址、地標或鄉鎮名稱。');
      focusAddr();
      return;
    }
    if ($('addrBtn').disabled) return;
    const gen = ++searchGen;
    locateGen++;
    pickState = null;
    $('addrPicks').hidden = true;
    $('addrPicks').innerHTML = '';
    $('addrBtn').disabled = true;
    showMsg('查詢中…', 'info');
    try {
      const steps = querySteps(query);
      let hits = [];
      let used = '';
      let netErr = null;
      for (let i = 0; i < steps.length; i++) {
        if (gen !== searchGen) return;
        const step = steps[i];
        if (i > 0) showMsg(`查詢中…改試「${step}」`, 'info');
        try {
          hits = await nominatimSearch(step);
        } catch (e) {
          netErr = e;
          break;
        }
        if (hits.length) { used = step; break; }
      }
      if (gen !== searchGen) return;
      if (!hits.length) {
        const local = matchStationsArea(query);
        if (local.length) {
          presentHits(local, { query, used: query, via: netErr ? 'offline' : 'station' });
          return;
        }
        showMsg(netErr
          ? '地址服務暫時連不上，也對不到雨量站的鄉鎮。請稍後再試，或改用下方搜尋站名。'
          : '找不到這個地方。請試著只輸入鄉鎮或地標，例如：台北101、冬山。');
        $('placeLabel').textContent = current ? current.name : '尚未定位';
        focusAddr();
        return;
      }
      presentHits(hits, { query, used, via: 'nominatim' });
    } finally {
      if (gen === searchGen) $('addrBtn').disabled = false;
    }
  }

  // ---------- 常用地點 ----------
  const getSaved = () => { try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; } catch { return []; } };
  const setSaved = (a) => localStorage.setItem(SAVED_KEY, JSON.stringify(a));

  function renderSaved() {
    const a = getSaved();
    const box = $('savedList');
    if (!a.length) { box.innerHTML = '<span class="empty-inline">還沒有。定位、查地址或點地圖後按「儲存這個位置」，例如：田區、公司</span>'; return; }
    box.innerHTML = a.map((p, i) => {
      const active = current && Math.abs(current.lat - p.lat) < 1e-6 && Math.abs(current.lon - p.lon) < 1e-6;
      return `<span class="chip${active ? ' active' : ''}"><button data-go="${i}">📌 ${esc(p.name)}</button><button class="del" data-del="${i}" aria-label="刪除">✕</button></span>`;
    }).join('');
  }

  function savePlace() {
    if (!current) return;
    const def = current.source === 'gps' ? '田區' : current.name;
    const name = (prompt('幫這個位置取個名字（例如：田區、公司）', def) || '').trim();
    if (!name) return;
    const a = getSaved().filter((p) => p.name !== name);
    a.push({ name: name.slice(0, 20), lat: current.lat, lon: current.lon });
    setSaved(a);
    setPlace({ ...current, name: name.slice(0, 20), source: 'saved' });
  }

  // ---------- 搜尋 ----------
  function renderSearch() {
    const q = $('searchInput').value.trim().replace(/台/g, '臺');
    const box = $('searchList');
    if (!q) { box.innerHTML = ''; return; }
    const hits = stations.filter((s) => (s.name + s.county + s.town + s.id).replace(/台/g, '臺').includes(q)).slice(0, 30);
    if (!hits.length) { box.innerHTML = '<div class="empty-inline">找不到符合的雨量站</div>'; return; }
    box.innerHTML = hits.map((s) => {
      const st = status(s);
      return `<div class="row" data-center="${esc(s.id)}"><div><b>${esc(s.name)}</b> <span class="st-sub">${esc(s.county)}${esc(s.town)}・${esc(s.id)}</span></div>
      <span class="badge ${st.cls}">${st.text}</span></div>`;
    }).join('') + (hits.length === 30 ? '<div class="empty-inline">只顯示前 30 筆，請輸入更精確的名稱</div>' : '');
  }

  function centerOnStation(id) {
    const s = stations.find((x) => x.id === id);
    if (!s) return;
    setPlace({ name: `${s.name}站（${s.town}）`, lat: s.lat, lon: s.lon, source: 'station' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- 地圖 ----------
  function ensureMap() {
    if (map || typeof L === 'undefined') return;
    map = L.map('map', { zoomControl: true }).setView([23.7, 121], 7);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '© OpenStreetMap'
    }).addTo(map);
    mapLayer = L.layerGroup().addTo(map);
    map.on('click', (e) => setPlace({ name: `地圖選點（${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)}）`, lat: e.latlng.lat, lon: e.latlng.lng, source: 'map' }));
  }

  function renderMap(list) {
    if (!map || $('mapWrap').hidden || !current) return;
    mapLayer.clearLayers();
    const color = { rain: '#1565c0', recent: '#0b7a75', dry: '#8a939e', na: '#a15c00' };
    L.circleMarker([current.lat, current.lon], { radius: 8, color: '#d32f2f', fillColor: '#ef5350', fillOpacity: 1 })
      .bindTooltip(current.name).addTo(mapLayer);
    const pts = [[current.lat, current.lon]];
    for (const { s } of list) {
      const st = status(s);
      L.circleMarker([s.lat, s.lon], { radius: 9, color: '#fff', weight: 2, fillColor: color[st.cls], fillOpacity: 0.95 })
        .bindTooltip(`${s.name}：${st.text.replace(/^\S+ /, '')}`).addTo(mapLayer);
      pts.push([s.lat, s.lon]);
    }
    map.fitBounds(pts, { padding: [24, 24], maxZoom: 14 });
  }

  function toggleMap() {
    const w = $('mapWrap');
    w.hidden = !w.hidden;
    if (!w.hidden) { ensureMap(); setTimeout(() => { map && map.invalidateSize(); renderNear(); }, 50); }
  }

  // ---------- 事件 ----------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-center],[data-go],[data-del],[data-pick]');
    if (!t) return;
    if (t.dataset.pick != null && pickState) {
      const hit = pickState.hits[+t.dataset.pick];
      if (hit) commitHit(hit, pickState.info);
      return;
    }
    if (t.dataset.center) centerOnStation(t.dataset.center);
    else if (t.dataset.go) { const p = getSaved()[+t.dataset.go]; if (p) setPlace({ ...p, source: 'saved' }); }
    else if (t.dataset.del) {
      const a = getSaved(); const p = a[+t.dataset.del];
      if (p && confirm(`刪除常用地點「${p.name}」？`)) { a.splice(+t.dataset.del, 1); setSaved(a); renderSaved(); }
    }
  });
  $('locateBtn').addEventListener('click', locate);
  $('addrForm').addEventListener('submit', (e) => { e.preventDefault(); searchAddress($('addrInput').value); });
  $('refreshBtn').addEventListener('click', loadData);
  $('savePlaceBtn').addEventListener('click', savePlace);
  $('toggleMapBtn').addEventListener('click', toggleMap);
  $('searchInput').addEventListener('input', renderSearch);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadData(); });
  setInterval(() => { if (!document.hidden) loadData(); }, AUTO_REFRESH_MS);

  // ---------- 啟動 ----------
  try { const last = JSON.parse(localStorage.getItem(LAST_KEY)); if (last && last.source !== 'gps') current = last; } catch {}
  renderSaved();
  loadData().then(() => { if (searchGen === 0) locate(); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
