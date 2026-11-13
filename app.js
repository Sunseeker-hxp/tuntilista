(() => {
  'use strict';
  const P = window.TuntiParser;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- Tallennus (puhelimen muistiin) ----------
  const store = {
    load(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };
  let entries = store.load('tl.entries', []);
  let settings = store.load('tl.settings', { name: '' });
  let drafts = [];
  let weekOffset = 0;
  const persist = () => { if (!store.save('tl.entries', entries)) toast('Tallennus epäonnistui – muisti täynnä?'); };

  // ---------- Apurit ----------
  const DAYS = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const fmtNum = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('fi-FI', { maximumFractionDigits: 2 }));
  const fmtDay = (d) => DAYS[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '.';
  const toNum = (v) => { const s = String(v == null ? '' : v).trim().replace(',', '.'); if (!s) return null; const n = parseFloat(s); return isNaN(n) ? null : n; };
  function mondayOf(d) { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return { year: t.getUTCFullYear(), week: Math.ceil(((t - y0) / 864e5 + 1) / 7) };
  }
  const sum = (arr, k) => arr.reduce((a, e) => a + (Number(e[k]) || 0), 0);

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // ---------- Näkymät ----------
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  function showView(v) {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
    if (v === 'list') renderList();
    if (v === 'trip') renderTrip();
    window.scrollTo(0, 0);
  }

  // ---------- Sanelu ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false;
  const micBtn = $('#micBtn'), transcript = $('#transcript');

  if (!SR) {
    $('#micHint').innerHTML = 'Tämä selain ei tue puheentunnistusta.<br>Napauta tekstikenttää ja käytä <b>näppäimistön mikrofonia</b>.';
  }

  function setListening(on) {
    listening = on;
    micBtn.classList.toggle('listening', on);
    micBtn.setAttribute('aria-label', on ? 'Lopeta sanelu' : 'Aloita sanelu');
    if (SR) $('#micHint').textContent = on ? 'Kuuntelen… paina uudelleen kun olet valmis.' : 'Paina ja sanele tunnit, työnumero ja kilometrit.';
  }

  micBtn.addEventListener('click', () => {
    if (!SR) { transcript.focus(); return; }
    if (listening) { rec && rec.stop(); return; }
    const base = transcript.value.trim();
    rec = new SR();
    rec.lang = 'fi-FI';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let fin = '', interim = '';
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) fin += r[0].transcript + ' '; else interim += r[0].transcript;
      }
      transcript.value = [base, (fin + interim).trim()].filter(Boolean).join(' ');
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Mikrofonin käyttö on estetty selaimen asetuksista.');
      else if (e.error === 'network') { toast('Puheentunnistus tarvitsee verkon. Kirjoita tai käytä näppäimistön mikrofonia.'); transcript.focus(); }
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Puheentunnistus: ' + e.error);
    };
    rec.onend = () => { setListening(false); if (transcript.value.trim()) interpret(); };
    try { rec.start(); setListening(true); if (navigator.vibrate) navigator.vibrate(30); }
    catch (err) { toast('Sanelua ei voitu aloittaa.'); }
  });

  $('#parseBtn').addEventListener('click', interpret);
  $('#clearBtn').addEventListener('click', () => { transcript.value = ''; drafts = []; renderDrafts(); });

  function interpret() {
    const text = transcript.value.trim();
    if (!text) { toast('Sanele tai kirjoita ensin tunnit.'); return; }
    const res = P.parse(text);
    drafts = res.entries.map((e) => ({ ...e, id: uid() }));
    if (!drafts.length) {
      drafts = [{ id: uid(), date: P.iso(new Date()), job: '', hours: null, km: null, note: text, warnings: ['En tunnistanut tunteja – täytä kentät'] }];
    }
    renderDrafts();
  }

  // ---------- Luonnokset ----------
  function fieldsHTML(e) {
    const km = `<span>Kilometrit</span><input data-f="km" inputmode="decimal" value="${esc(fmtNum(e.km))}" placeholder="0">`;
    return `
      <div class="grid">
        <label><span>Päivä</span><input type="date" data-f="date" value="${esc(e.date)}"></label>
        <label><span>Työnumero</span><input data-f="job" value="${esc(e.job)}" autocapitalize="characters"></label>
        ${e.type === 'trip' ? `
        <label><span>Lähtöaika</span><input type="time" data-f="depTime" value="${esc(e.depTime)}"></label>
        <label><span>Tuloaika</span><input type="time" data-f="arrTime" value="${esc(e.arrTime)}"></label>
        <label class="wide"><span>Lähtöpaikka</span><input data-f="depPlace" value="${esc(e.depPlace)}" placeholder="Katu, paikkakunta"></label>
        <label class="wide"><span>Tulopaikka</span><input data-f="arrPlace" value="${esc(e.arrPlace)}" placeholder="Katu, paikkakunta"></label>
        <label class="wide">${km}</label>` : `
        <label><span>Tunnit</span><input data-f="hours" inputmode="decimal" value="${esc(fmtNum(e.hours))}" placeholder="0"></label>
        <label>${km}</label>`}
        <label class="wide"><span>Kuvaus</span><input data-f="note" value="${esc(e.note)}"></label>
      </div>`;
  }
  function readFields(root, target) {
    root.querySelectorAll('[data-f]').forEach((inp) => {
      const f = inp.dataset.f;
      target[f] = f === 'hours' || f === 'km' ? toNum(inp.value) : inp.value.trim();
    });
    target.job = (target.job || '').toUpperCase();
    return target;
  }

  function renderDrafts() {
    const box = $('#drafts');
    box.innerHTML = drafts.map((d, i) => `
      <div class="card draft" data-id="${d.id}">
        <span class="title">Kirjaus ${drafts.length > 1 ? i + 1 : ''}${d.start ? ` · klo ${esc(d.start)}–${esc(d.end)}` : ''}</span>
        <button class="x" type="button" data-del aria-label="Poista rivi">×</button>
        ${fieldsHTML(d)}
        ${d.warnings && d.warnings.length ? `<div class="warn">${d.warnings.map((w) => `<span>${esc(w)}</span>`).join('')}</div>` : ''}
      </div>`).join('');
    $('#saveBtn').hidden = !drafts.length;
    $('#saveBtn').textContent = drafts.length > 1 ? `Tallenna ${drafts.length} kirjausta` : 'Tallenna';
  }
  $('#drafts').addEventListener('input', (ev) => {
    const card = ev.target.closest('.card'); if (!card) return;
    const d = drafts.find((x) => x.id === card.dataset.id);
    if (d) readFields(card, d);
  });
  $('#drafts').addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-del]')) return;
    const id = ev.target.closest('.card').dataset.id;
    drafts = drafts.filter((d) => d.id !== id);
    renderDrafts();
  });

  $('#saveBtn').addEventListener('click', () => {
    document.querySelectorAll('#drafts .card').forEach((card) => {
      const d = drafts.find((x) => x.id === card.dataset.id); if (d) readFields(card, d);
    });
    const bad = drafts.find((d) => !d.date || (!(d.hours > 0) && !(d.km > 0)));
    if (bad) { toast('Jokaisella rivillä pitää olla päivä ja tunnit tai kilometrit.'); return; }
    const now = new Date().toISOString();
    const text = transcript.value.trim();
    drafts.forEach((d) => entries.push({
      id: d.id, date: d.date, job: d.job, hours: d.hours, km: d.km, note: d.note,
      start: d.start || null, end: d.end || null, transcript: text, createdAt: now,
    }));
    persist();
    toast(drafts.length > 1 ? `Tallennettu ${drafts.length} kirjausta ✓` : 'Tallennettu ✓');
    drafts = []; transcript.value = '';
    renderDrafts(); renderToday();
  });

  function renderToday() {
    const today = P.iso(new Date());
    const h = sum(entries.filter((e) => e.date === today), 'hours');
    $('#todaySum').textContent = h ? `Tänään ${fmtNum(h)} h` : '';
  }

  // ---------- Tuntilista ----------
  function weekBounds() {
    const mon = mondayOf(new Date()); mon.setDate(mon.getDate() + weekOffset * 7);
    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    return { mon, sun, from: P.iso(mon), to: P.iso(sun) };
  }
  const weekEntries = () => { const { from, to } = weekBounds(); return entries.filter((e) => e.date >= from && e.date <= to); };

  function renderList() {
    const { mon, sun } = weekBounds();
    const { week } = isoWeek(mon);
    $('#weekTitle').textContent = `Viikko ${week}` + (weekOffset === 0 ? ' (tämä)' : '');
    $('#weekRange').textContent = `${mon.getDate()}.${mon.getMonth() + 1}. – ${sun.getDate()}.${sun.getMonth() + 1}.${sun.getFullYear()}`;
    const list = weekEntries().sort((a, b) => (a.date + (a.start || a.depTime || '') + a.createdAt).localeCompare(b.date + (b.start || b.depTime || '') + b.createdAt));
    $('#weekHours').textContent = fmtNum(sum(list, 'hours')) || '0';
    $('#weekKm').textContent = fmtNum(sum(list, 'km')) || '0';
    const jobs = {};
    list.forEach((e) => { const k = e.job || '–'; jobs[k] = jobs[k] || { h: 0, km: 0 }; jobs[k].h += Number(e.hours) || 0; jobs[k].km += Number(e.km) || 0; });
    $('#weekJobs').textContent = Object.keys(jobs).length;

    if (!list.length) {
      $('#days').innerHTML = '<p class="empty">Ei kirjauksia tällä viikolla.</p>';
      $('#jobSummary').innerHTML = '';
      return;
    }
    const byDay = {};
    list.forEach((e) => (byDay[e.date] = byDay[e.date] || []).push(e));
    $('#days').innerHTML = Object.keys(byDay).sort().map((date) => {
      const items = byDay[date];
      return `<div class="day">${fmtDay(parseISO(date))}<span>${fmtNum(sum(items, 'hours'))} h</span></div>` +
        items.map((e) => `
          <button class="entry" type="button" data-id="${e.id}">
            <span class="job">${e.job ? esc(e.job) : '<i>ei työnumeroa</i>'}</span>
            <span class="h">${e.hours ? fmtNum(e.hours) + ' h' : e.type === 'trip' ? fmtNum(e.km || 0) + ' km' : ''}</span>
            <span class="meta">${(e.type === 'trip'
              ? [`${esc(e.depTime)} ${esc(e.depPlace)} → ${esc(e.arrTime)} ${esc(e.arrPlace)}`, esc(e.note)]
              : [e.start ? `klo ${esc(e.start)}–${esc(e.end)}` : '', e.km ? fmtNum(e.km) + ' km' : '', esc(e.note)]).filter(Boolean).join(' · ') || '&nbsp;'}</span>
          </button>`).join('');
    }).join('');
    $('#jobSummary').innerHTML = `<h3>Työnumeroittain</h3><table class="jobs"><thead><tr><th>Työnumero</th><th>Tunnit</th><th>Km</th></tr></thead><tbody>` +
      Object.keys(jobs).sort().map((k) => `<tr><td>${esc(k)}</td><td>${fmtNum(jobs[k].h)}</td><td>${fmtNum(jobs[k].km)}</td></tr>`).join('') +
      '</tbody></table>';
  }
  $('#prevWeek').addEventListener('click', () => { weekOffset--; renderList(); });
  $('#nextWeek').addEventListener('click', () => { weekOffset++; renderList(); });

  // Muokkaus
  const dlg = $('#editDlg');
  let editing = null;
  $('#days').addEventListener('click', (ev) => {
    const b = ev.target.closest('.entry'); if (!b) return;
    editing = entries.find((e) => e.id === b.dataset.id); if (!editing) return;
    $('#editFields').innerHTML = fieldsHTML(editing);
    dlg.showModal();
  });
  dlg.addEventListener('close', () => {
    if (!editing) return;
    if (dlg.returnValue === 'save') {
      readFields($('#editFields'), editing); persist(); toast('Muutokset tallennettu');
    } else if (dlg.returnValue === 'delete') {
      if (confirm('Poistetaanko kirjaus?')) { entries = entries.filter((e) => e !== editing); persist(); toast('Kirjaus poistettu'); }
    }
    editing = null; renderList(); renderToday();
  });

  // ---------- Vienti ----------
  function toCSV(list) {
    const q = (v) => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const num = (n) => (n == null || n === '' ? '' : String(n).replace('.', ','));
    const rows = [['Päivämäärä', 'Viikko', 'Työntekijä', 'Työnumero', 'Tunnit', 'Kilometrit', 'Alku', 'Loppu', 'Lähtöaika', 'Lähtöpaikka', 'Tuloaika', 'Tulopaikka', 'Kuvaus']];
    list.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => {
      const d = parseISO(e.date);
      rows.push([`${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`, isoWeek(d).week, settings.name, e.job, num(e.hours), num(e.km), e.start || '', e.end || '', e.depTime || '', e.depPlace || '', e.arrTime || '', e.arrPlace || '', e.note]);
    });
    return '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
  }
  async function shareFile(name, content) {
    const file = new File([content], name, { type: 'text/csv' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  $('#exportBtn').addEventListener('click', () => {
    const list = weekEntries();
    if (!list.length) { toast('Viikolla ei ole kirjauksia.'); return; }
    const { year, week } = isoWeek(weekBounds().mon);
    shareFile(`tuntilista_${year}_vko${week}.csv`, toCSV(list));
  });
  $('#exportAllBtn').addEventListener('click', () => {
    if (!entries.length) { toast('Ei kirjauksia.'); return; }
    shareFile(`tuntilista_kaikki_${P.iso(new Date())}.csv`, toCSV(entries));
  });
  $('#copyBtn').addEventListener('click', async () => {
    const list = weekEntries().sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) { toast('Viikolla ei ole kirjauksia.'); return; }
    const { week } = isoWeek(weekBounds().mon);
    const lines = [`Tuntilista vko ${week}${settings.name ? ' – ' + settings.name : ''}`];
    list.forEach((e) => lines.push(e.type === 'trip'
      ? `${fmtDay(parseISO(e.date))} ${e.job || '-'}: matka ${fmtNum(e.km) || 0} km, ${e.depTime} ${e.depPlace} → ${e.arrTime} ${e.arrPlace}${e.note ? ' (' + e.note + ')' : ''}`
      : `${fmtDay(parseISO(e.date))} ${e.job || '-'}: ${fmtNum(e.hours) || 0} h${e.km ? ', ' + fmtNum(e.km) + ' km' : ''}${e.note ? ' (' + e.note + ')' : ''}`));
    lines.push(`Yhteensä ${fmtNum(sum(list, 'hours'))} h, ${fmtNum(sum(list, 'km')) || 0} km`);
    try { await navigator.clipboard.writeText(lines.join('\n')); toast('Kopioitu leikepöydälle'); }
    catch { toast('Kopiointi ei onnistunut'); }
  });

  // ---------- Asetukset ----------
  const nameInput = $('#nameInput');
  nameInput.value = settings.name || '';
  nameInput.addEventListener('change', () => { settings.name = nameInput.value.trim(); store.save('tl.settings', settings); toast('Nimi tallennettu'); });
  $('#wipeBtn').addEventListener('click', () => {
    if (!entries.length) return;
    if (confirm(`Poistetaanko kaikki ${entries.length} kirjausta pysyvästi?`)) { entries = []; persist(); renderList(); renderToday(); }
  });

  // ---------- Matkat: lähtö/tulo sijainnista, kilometrit ajoreitin mukaan ----------
  // Osoitteet: OpenStreetMap Nominatim. Reitti: OSRM. Molemmille lähetetään vain koordinaatit / paikan nimi.
  let activeTrip = store.load('tl.trip', null);
  let tripDraft = store.load('tl.tripDraft', null);
  const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const saveTripState = () => { store.save('tl.trip', activeTrip); store.save('tl.tripDraft', tripDraft); };

  // Ensimmäinen sijainti on usein karkea (verkkopaikannus). Kerätään sijainteja hetki ja
  // otetaan tarkin; lopetetaan heti, kun tarkkuus on riittävä.
  function getPos(maxMs = 15000, goodM = 15) {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('nogeo'));
      let best = null, id = null;
      const done = (err) => { clearTimeout(timer); navigator.geolocation.clearWatch(id); best ? res(best) : rej(err || new Error('nofix')); };
      const timer = setTimeout(done, maxMs);
      id = navigator.geolocation.watchPosition((p) => {
        const f = { lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
        if (!best || f.acc < best.acc) best = f;
        if (f.acc <= goodM) done();
      }, (err) => { if (err.code === 1) done(err); }, { enableHighAccuracy: true, maximumAge: 0, timeout: maxMs });
    });
  }
  async function fetchJSON(url) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 12000);
    try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }
  const coordText = (p) => p.lat.toFixed(5) + ', ' + p.lon.toFixed(5);
  async function reverseName(pos) {
    try {
      const j = await fetchJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=fi&lat=${pos.lat}&lon=${pos.lon}`);
      const a = j.address || {};
      const street = [a.road || a.pedestrian || a.hamlet || a.suburb, a.house_number].filter(Boolean).join(' ');
      const s = [street, a.city || a.town || a.village || a.municipality].filter(Boolean).join(', ');
      if (s) return s;
    } catch { /* verkko poikki */ }
    return null;
  }
  // Ilman verkkoa paikaksi jää koordinaatit; ne vaihdetaan osoitteeksi, kun verkko palaa.
  const placeName = async (pos) => (navigator.onLine && await reverseName(pos)) || coordText(pos);
  const COORD_RE = /^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/;
  let resolving = false;
  async function resolvePlaces() {
    if (resolving || !navigator.onLine) return;
    resolving = true;
    let changed = false;
    for (const e of entries.filter((x) => x.type === 'trip')) {
      for (const f of ['depPlace', 'arrPlace']) {
        const m = (e[f] || '').match(COORD_RE);
        if (!m) continue;
        const name = await reverseName({ lat: +m[1], lon: +m[2] });
        if (!name) { resolving = false; if (changed) persist(); return; }
        e[f] = name; changed = true;
        await new Promise((r) => setTimeout(r, 1100)); // palvelun käyttöehto: enintään 1 haku sekunnissa
      }
    }
    resolving = false;
    if (changed) { persist(); if ($('#view-list').classList.contains('active')) renderList(); }
  }
  async function geocode(q) {
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) return { lat: +m[1], lon: +m[2] };
    for (const cc of ['&countrycodes=fi', '']) {
      try {
        const j = await fetchJSON('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=fi' + cc + '&q=' + encodeURIComponent(q));
        if (j[0]) return { lat: +j[0].lat, lon: +j[0].lon };
      } catch { return null; }
    }
    return null;
  }
  function haversine(a, b) {
    const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(x));
  }
  async function routeOnline(a, b) {
    if (!navigator.onLine) return null;
    try {
      const j = await fetchJSON(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
      if (j.routes && j.routes[0]) return Math.round(j.routes[0].distance / 100) / 10;
    } catch { /* ei reittiä */ }
    return null;
  }
  async function routeKm(a, b) {
    const km = await routeOnline(a, b);
    return km != null ? { km, exact: true } : { km: Math.round(haversine(a, b) * 1.3 * 10) / 10, exact: false };
  }

  // ---------- GPS-seuranta matkan ajan ----------
  // Summaa ajetun matkan sijaintipisteistä. Toimii ilman verkkoa, mutta vain kun sovellus on auki.
  let watchId = null, wakeLock = null;
  async function requestWake() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); }
    catch { /* näytön päällä pito ei ole pakollinen */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && activeTrip) requestWake(); });
  function startTracking() {
    if (!navigator.geolocation || watchId != null || !activeTrip) return;
    watchId = navigator.geolocation.watchPosition(onFix, () => { if (activeTrip) { activeTrip.acc = null; renderLive(); } },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    requestWake();
  }
  function stopTracking() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }
  function addPoint(tr, pt, minM) {
    if (!tr.last) { tr.last = pt; tr.n = 1; return; }
    const d = haversine(tr.last, pt) * 1000;
    if (d < minM) return;
    // pitkä hyppy pitkän tauon jälkeen = seuranta oli poikki (sovellus taustalla); väli lasketaan suorana viivana
    if (pt.t - tr.last.t > 120000 && d > 300) tr.gaps++;
    tr.m += d; tr.last = pt; tr.n++;
  }
  function onFix(p) {
    if (!activeTrip) return;
    const acc = p.coords.accuracy;
    activeTrip.acc = Math.round(acc);
    if (acc <= 50) {
      const pt = { lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() };
      if (!activeTrip.pos) { activeTrip.pos = { lat: pt.lat, lon: pt.lon, acc: Math.round(acc) }; if (!activeTrip.depPlace) activeTrip.depPlace = coordText(pt); }
      if (!activeTrip.track) activeTrip.track = { m: 0, last: null, gaps: 0, n: 0 };
      // Ennen liikkeelle lähtöä: jos GPS tarkentuu, korjataan lähtöpiste (eikä lasketa korjausta ajetuksi matkaksi)
      const tr0 = activeTrip.track;
      if (tr0.n <= 1 && acc < (activeTrip.pos.acc == null ? 1e9 : activeTrip.pos.acc) - 5 && (!tr0.last || haversine(tr0.last, pt) * 1000 <= Math.max(activeTrip.pos.acc || 0, 100))) {
        activeTrip.pos = { lat: pt.lat, lon: pt.lon, acc: Math.round(acc) };
        tr0.last = pt; tr0.n = 1; activeTrip.depStale = true;
      }
      addPoint(activeTrip.track, pt, Math.max(20, acc)); // kynnys suodattaa paikallaan olon GPS-heilunnan
      store.save('tl.trip', activeTrip);
    }
    renderLive();
  }
  function renderLive() {
    if (!activeTrip) return;
    const tr = activeTrip.track;
    $('#tripKm').textContent = fmtNum(Math.round((tr ? tr.m : 0) / 100) / 10) || '0';
    $('#tripGps').textContent = activeTrip.acc == null ? 'Odotetaan GPS-signaalia…'
      : activeTrip.acc > 50 ? `GPS-signaali heikko (±${activeTrip.acc} m)` : `GPS-tarkkuus ±${activeTrip.acc} m`;
  }
  const kmNoteText = (r) => r.exact ? 'Kilometrit laskettu ajoreitin mukaan lähtö- ja tulopaikan välille. Korjaa, jos ajoit muuta reittiä.'
    : 'Reittiä ei saatu haettua. Kilometrit ovat arvio linnuntie-etäisyydestä – tarkista.';

  function renderTrip() {
    $('#tripIdle').hidden = !!(activeTrip || tripDraft);
    $('#tripActive').hidden = !(activeTrip && !tripDraft);
    $('#tripDraft').hidden = !tripDraft;
    if (activeTrip) renderLive();
    if (activeTrip) $('#tripInfo').textContent = `Lähtö klo ${activeTrip.depTime} · ${activeTrip.depPlace || 'sijainti ei tiedossa'}` + (activeTrip.job ? ` · työnumero ${activeTrip.job}` : '');
    if (tripDraft) { $('#tripFields').innerHTML = fieldsHTML(tripDraft); $('#kmNote').textContent = tripDraft.kmNote || ''; }
  }
  async function locate(btn, busyText) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = busyText;
    let pos = null, place = '';
    try { pos = await getPos(); place = await placeName(pos); }
    catch { toast('Sijaintia ei saatu. Salli sijainnin käyttö tai kirjoita paikka käsin.'); }
    btn.disabled = false; btn.textContent = label;
    return { pos, place };
  }

  $('#tripStart').addEventListener('click', async (ev) => {
    const now = new Date();
    const { pos, place } = await locate(ev.currentTarget, 'Haetaan tarkkaa sijaintia…');
    activeTrip = { date: P.iso(now), depTime: hhmm(now), pos, depPlace: place, job: $('#tripJob').value.trim().toUpperCase() };
    if (pos) activeTrip.track = { m: 0, last: { lat: pos.lat, lon: pos.lon, t: Date.now() }, gaps: 0, n: 1 };
    saveTripState(); renderTrip(); startTracking();
    toast('Matka aloitettu klo ' + activeTrip.depTime);
  });
  $('#tripStop').addEventListener('click', async (ev) => {
    const now = new Date();
    let { pos, place } = await locate(ev.currentTarget, 'Haetaan tarkkaa sijaintia…');
    stopTracking();
    const t = activeTrip, tr = t.track;
    if (!pos && tr && tr.last) { pos = { lat: tr.last.lat, lon: tr.last.lon }; place = await placeName(pos); }
    if (tr && pos) addPoint(tr, { lat: pos.lat, lon: pos.lon, t: Date.now() }, Math.max(20, pos.acc || 0));
    if (t.depStale && t.pos) t.depPlace = await placeName(t.pos);
    tripDraft = { id: uid(), type: 'trip', date: t.date, job: t.job, depTime: t.depTime, depPlace: t.depPlace, arrTime: hhmm(now), arrPlace: place,
      km: null, note: '', a: t.pos, b: pos, aPlace: t.depPlace, bPlace: place, kmNote: '' };
    const d = tripDraft;
    const tracked = tr && tr.n > 1 ? Math.round(tr.m / 100) / 10 : null;
    if (tracked != null && !tr.gaps) {
      d.km = tracked; d.kmNote = 'Kilometrit mitattu GPS:llä ajetun matkan mukaan.';
    } else if (tracked != null) {
      // seurannassa katkoja: GPS-lukema on alaraja, joten käytetään ajoreittiä jos se on pidempi
      const r = t.pos && pos ? await routeOnline(t.pos, pos) : null;
      if (r != null && r > tracked) { d.km = r; d.kmNote = 'GPS-seuranta katkesi matkan aikana (sovellus oli taustalla), joten kilometrit on laskettu ajoreitin mukaan. Tarkista.'; }
      else { d.km = tracked; d.kmNote = 'GPS-seuranta katkesi matkan aikana (sovellus oli taustalla). Kilometrit voivat olla todellista pienemmät – tarkista.'; }
    } else if (t.pos && pos) { const r = await routeKm(t.pos, pos); d.km = r.km; d.kmNote = kmNoteText(r); }
    else d.kmNote = 'Sijainti puuttuu. Kirjoita paikat ja kilometrit käsin.';
    const worst = Math.max((t.pos && t.pos.acc) || 0, (pos && pos.acc) || 0);
    if (worst > 50) d.kmNote += ` Sijainnin tarkkuus oli heikko (±${worst} m) – tarkista paikat.`;
    activeTrip = null; saveTripState(); renderTrip();
  });
  $('#tripCancel').addEventListener('click', () => { stopTracking(); activeTrip = null; saveTripState(); renderTrip(); toast('Matka peruttu'); });
  $('#tripManual').addEventListener('click', () => {
    const now = new Date();
    tripDraft = { id: uid(), type: 'trip', date: P.iso(now), job: $('#tripJob').value.trim().toUpperCase(), depTime: '', depPlace: '', arrTime: '', arrPlace: '', km: null, note: '',
      kmNote: 'Kirjoita lähtö- ja tulopaikka ja paina Laske kilometrit.' };
    saveTripState(); renderTrip();
  });
  $('#tripFields').addEventListener('input', () => { if (tripDraft) { readFields($('#tripFields'), tripDraft); store.save('tl.tripDraft', tripDraft); } });
  $('#tripDiscard').addEventListener('click', () => { tripDraft = null; saveTripState(); renderTrip(); });
  $('#tripCalc').addEventListener('click', async (ev) => {
    const d = readFields($('#tripFields'), tripDraft);
    if (!d.depPlace || !d.arrPlace) { toast('Kirjoita ensin lähtö- ja tulopaikka.'); return; }
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Lasketaan…';
    // GPS-sijaintia käytetään, jos paikan tekstiä ei ole muutettu; muuten haetaan osoitteen perusteella
    const a = d.a && d.depPlace === d.aPlace ? d.a : await geocode(d.depPlace);
    const b = d.b && d.arrPlace === d.bPlace ? d.b : await geocode(d.arrPlace);
    btn.disabled = false; btn.textContent = 'Laske kilometrit';
    if (!a || !b) { toast(`Paikkaa ei löytynyt: ${!a ? d.depPlace : d.arrPlace}. Tarkenna osoitetta tai kirjoita kilometrit käsin.`); return; }
    const r = await routeKm(a, b);
    Object.assign(d, { km: r.km, kmNote: kmNoteText(r), a, b, aPlace: d.depPlace, bPlace: d.arrPlace });
    saveTripState(); renderTrip();
  });
  $('#tripSave').addEventListener('click', () => {
    const d = readFields($('#tripFields'), tripDraft);
    if (!d.date || !d.depTime || !d.depPlace || !d.arrTime || !d.arrPlace) { toast('Täytä päivä, lähtöaika ja -paikka sekä tuloaika ja -paikka.'); return; }
    if (d.km == null) { toast('Kilometrit puuttuvat. Paina Laske kilometrit tai kirjoita ne käsin.'); return; }
    entries.push({ id: d.id, type: 'trip', date: d.date, job: d.job, hours: null, km: d.km, note: d.note,
      depTime: d.depTime, depPlace: d.depPlace, arrTime: d.arrTime, arrPlace: d.arrPlace, createdAt: new Date().toISOString() });
    persist();
    tripDraft = null; saveTripState(); renderTrip();
    toast(`Matka tallennettu: ${fmtNum(d.km)} km ✓`);
    resolvePlaces();
  });
  if (activeTrip) startTracking(); // matka jatkuu, jos sovellus suljettiin välillä

  // ---------- Verkkotila ja asennus ----------
  function netState() { $('#offline').hidden = navigator.onLine; if (navigator.onLine) resolvePlaces(); }
  window.addEventListener('online', netState);
  window.addEventListener('offline', netState);
  netState();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); // pyydä, ettei selain tyhjennä kirjauksia
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#installCard').hidden = false; });
  window.addEventListener('appinstalled', () => { $('#installCard').hidden = true; toast('Sovellus asennettu ✓'); });
  $('#installBtn').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $('#installCard').hidden = true; });

  renderToday();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
