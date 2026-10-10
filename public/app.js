'use strict';
(() => {
  const DATA_URL = 'rain.json';
  const WX_URL = 'weather.json';
  const SAVED_KEY = 'rainapp.savedPlaces';
  const LAST_KEY = 'rainapp.lastPlace';
  const NEAR_N = 5;
  const AUTO_REFRESH_MS = 5 * 60 * 1000;

  const $ = (id) => document.getElementById(id);
  let stations = [];
  let wx = []; // 自動氣象站（氣溫、濕度、風）
  let generated = null;
  let current = null; // {name, lat, lon, source}
  let map = null, mapLayer = null;

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
    if (!current) return;
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
    renderSaved();
  }

  function renderAll() { renderPlace(); renderNear(); renderSearch(); }

  function setPlace(p, { remember = true } = {}) {
    current = p;
    if (remember) localStorage.setItem(LAST_KEY, JSON.stringify(p));
    renderPlace();
    renderNear();
  }

  function showMsg(t) { const m = $('msg'); m.textContent = t; m.hidden = !t; }

  // ---------- 定位 ----------
  function locate() {
    if (!navigator.geolocation) { showMsg('這個瀏覽器不支援定位，請改用搜尋或常用地點。'); return; }
    showMsg('');
    $('placeLabel').textContent = '定位中…';
    navigator.geolocation.getCurrentPosition(
      (pos) => setPlace({ name: '我的位置', lat: pos.coords.latitude, lon: pos.coords.longitude, source: 'gps' }),
      (err) => {
        const why = err.code === 1 ? '沒有定位權限' : err.code === 3 ? '定位逾時' : '無法取得位置';
        showMsg(why + '，請改用下方搜尋或常用地點，或開啟瀏覽器的定位權限。');
        $('placeLabel').textContent = current ? current.name : '尚未定位';
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  // ---------- 常用地點 ----------
  const getSaved = () => { try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; } catch { return []; } };
  const setSaved = (a) => localStorage.setItem(SAVED_KEY, JSON.stringify(a));

  function renderSaved() {
    const a = getSaved();
    const box = $('savedList');
    if (!a.length) { box.innerHTML = '<span class="empty-inline">還沒有。定位或點地圖後按「儲存這個位置」，例如：田區、公司</span>'; return; }
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
    const t = e.target.closest('[data-center],[data-go],[data-del]');
    if (!t) return;
    if (t.dataset.center) centerOnStation(t.dataset.center);
    else if (t.dataset.go) { const p = getSaved()[+t.dataset.go]; if (p) setPlace({ ...p, source: 'saved' }); }
    else if (t.dataset.del) {
      const a = getSaved(); const p = a[+t.dataset.del];
      if (p && confirm(`刪除常用地點「${p.name}」？`)) { a.splice(+t.dataset.del, 1); setSaved(a); renderSaved(); }
    }
  });
  $('locateBtn').addEventListener('click', locate);
  $('refreshBtn').addEventListener('click', loadData);
  $('savePlaceBtn').addEventListener('click', savePlace);
  $('toggleMapBtn').addEventListener('click', toggleMap);
  $('searchInput').addEventListener('input', renderSearch);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadData(); });
  setInterval(() => { if (!document.hidden) loadData(); }, AUTO_REFRESH_MS);

  // ---------- 啟動 ----------
  try { const last = JSON.parse(localStorage.getItem(LAST_KEY)); if (last && last.source !== 'gps') current = last; } catch {}
  renderSaved();
  loadData().then(() => locate());

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
