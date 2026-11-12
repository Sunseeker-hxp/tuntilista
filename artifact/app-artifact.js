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
  // Pilvitallennus: jokaisen käyttäjän oma yksityinen kokoelma (data/users/<id>/...).
  let col = null, settingsDoc = null;
  const persist = () => { if (!col && !store.save('tl.entries', entries)) toast('Tallennus epäonnistui – muisti täynnä?'); };
  const clean = (e) => { const o = {}; for (const k of ['date','job','hours','km','note','start','end','transcript','createdAt']) o[k] = e[k] == null ? null : e[k]; return o; };
  function dbErr(e) { toast(e && e.code === 'quota_exceeded' ? 'Tallennustila täynnä.' : 'Tallennus pilveen epäonnistui. Yritä uudelleen.'); }
  const putEntry = (e) => { if (col) col.doc(e.id).set(clean(e)).catch(dbErr); };
  const dropEntry = (e) => { if (col) col.doc(e.id).delete().catch(dbErr); };
  async function connectDb() {
    if (!window.claude || !window.claude.use) return;
    const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    const id = user && await user.id();
    if (!db || !id) return;
    let c, sd;
    try { c = db.collection('data/users/' + id + '/entries'); sd = db.doc('data/users/' + id + '/settings'); } catch { return; }
    col = c; settingsDoc = sd;
    $('#storeNote').textContent = 'Kirjaukset tallentuvat tiliisi ja näkyvät vain sinulle.';
    const timer = setTimeout(() => toast('Kirjausten lataus kestää…'), 10000);
    let migrated = false;
    col.onSnapshot((snap) => {
      clearTimeout(timer);
      const remote = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // siirrä tähän selaimeen aiemmin tallennetut kirjaukset kerran pilveen
      if (!migrated && !snap.metadata.fromCache) {
        migrated = true;
        const local = store.load('tl.entries', []);
        const known = new Set(remote.map((r) => r.id));
        local.filter((e) => !known.has(e.id)).forEach((e) => { remote.push(e); putEntry(e); });
        if (local.length) store.save('tl.entries', []);
      }
      entries = remote;
      renderToday();
      if ($('#view-list').classList.contains('active') && !dlg.open) renderList();
    }, () => { clearTimeout(timer); toast('Kirjausten lataus epäonnistui.'); });
    sd.get().then((s) => { if (s.exists && s.data().name) { settings.name = s.data().name; nameInput.value = settings.name; } }).catch(() => {});
  }

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
    window.scrollTo(0, 0);
  }

  // ---------- Sanelu (alustan sanelu) ----------
  let dict = null, listening = false;
  const micBtn = $('#micBtn'), transcript = $('#transcript');
  const defaultHint = $('#micHint').innerHTML;
  const noDictHint = 'Napauta tekstikenttää ja sanele <b>näppäimistön mikrofonilla</b>, sitten <b>Tulkitse</b>.<br>Jos teksti tulee englanniksi, vaihda näppäimistön kieleksi <b>suomi</b>.';
  $('#micHint').innerHTML = noDictHint; micBtn.hidden = true;

  function setListening(on) {
    listening = on;
    micBtn.classList.toggle('listening', on);
    micBtn.setAttribute('aria-label', on ? 'Lopeta sanelu' : 'Aloita sanelu');
    $('#micHint').innerHTML = on ? 'Kuuntelen… paina uudelleen kun olet valmis.' : defaultHint;
  }
  (async () => {
    if (!window.claude || !window.claude.use) return;
    dict = await claude.use('dictation');
    if (!dict) return;
    micBtn.hidden = false; $('#micHint').innerHTML = defaultHint;
    dict.onPartial(({ text }) => { transcript.dataset.partial = text; showText(); });
    dict.onFinal(({ text }) => { transcript.value = (transcript.value + text).replace(/^\s+/, ''); transcript.dataset.partial = ''; showText(); });
    dict.onState(({ state, reason }) => {
      if (state === 'idle') {
        setListening(false);
        if (reason === 'unavailable') { micBtn.hidden = true; $('#micHint').innerHTML = noDictHint; }
        else if (reason === 'not_granted') toast('Sanelu ei ole sallittu. Voit kirjoittaa tai käyttää näppäimistön mikrofonia.');
        else if (reason === 'rate_limited') toast('Sanelu on hetken ruuhkainen, yritä pian uudelleen.');
        else if (reason === 'upstream_error') toast('Mikrofoni tai puheentunnistus ei vastannut.');
        if (transcript.value.trim()) interpret();
      } else setListening(true);
    });
  })();
  function showText() {
    const p = transcript.dataset.partial;
    transcript.classList.toggle('live', !!p);
    $('#partial').textContent = p || '';
  }
  micBtn.addEventListener('click', () => {
    if (!dict) { transcript.focus(); return; }
    if (listening) { dict.stop().catch(() => {}); return; }
    dict.start({ language: 'fi' }).catch((e) => {
      if (e && e.code === 'unavailable') {
        // Suomea ei tarjota: ei vaihdeta muuhun kieleen, vaan ohjataan näppäimistön saneluun.
        micBtn.hidden = true; $('#micHint').innerHTML = noDictHint;
        toast('Sovelluksen sanelu ei tue suomea tässä. Käytä näppäimistön mikrofonia.');
      } else if (e && e.code === 'not_granted') toast('Sanelu ei ole sallittu. Voit kirjoittaa tai käyttää näppäimistön mikrofonia.');
    });
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
    return `
      <div class="grid">
        <label><span>Päivä</span><input type="date" data-f="date" value="${esc(e.date)}"></label>
        <label><span>Työnumero</span><input data-f="job" value="${esc(e.job)}" autocapitalize="characters"></label>
        <label><span>Tunnit</span><input data-f="hours" inputmode="decimal" value="${esc(fmtNum(e.hours))}" placeholder="0"></label>
        <label><span>Kilometrit</span><input data-f="km" inputmode="decimal" value="${esc(fmtNum(e.km))}" placeholder="0"></label>
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
    drafts.forEach((d) => {
      const e = { id: d.id, date: d.date, job: d.job, hours: d.hours, km: d.km, note: d.note,
        start: d.start || null, end: d.end || null, transcript: text, createdAt: now };
      entries.push(e); putEntry(e);
    });
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
    const list = weekEntries().sort((a, b) => (a.date + (a.start || '') + a.createdAt).localeCompare(b.date + (b.start || '') + b.createdAt));
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
            <span class="h">${e.hours ? fmtNum(e.hours) + ' h' : ''}</span>
            <span class="meta">${[e.start ? `klo ${esc(e.start)}–${esc(e.end)}` : '', e.km ? fmtNum(e.km) + ' km' : '', esc(e.note)].filter(Boolean).join(' · ') || '&nbsp;'}</span>
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
    resetConfirm($('#delBtn'), 'Poista');
    dlg.showModal();
  });
  // Kaksivaiheinen vahvistus: ensimmäinen napautus kysyy, toinen tekee.
  function resetConfirm(b, label) { b.dataset.armed = ''; b.textContent = label; }
  function armed(b, ask, label) {
    if (b.dataset.armed) return true;
    b.dataset.armed = '1'; b.textContent = ask;
    setTimeout(() => resetConfirm(b, label), 4000);
    return false;
  }
  $('#delBtn').addEventListener('click', (ev) => { if (!armed(ev.currentTarget, 'Vahvista poisto', 'Poista')) ev.preventDefault(); });
  dlg.addEventListener('close', () => {
    if (!editing) return;
    if (dlg.returnValue === 'save') {
      readFields($('#editFields'), editing); putEntry(editing); persist(); toast('Muutokset tallennettu');
    } else if (dlg.returnValue === 'delete') {
      entries = entries.filter((e) => e !== editing); dropEntry(editing); persist(); toast('Kirjaus poistettu');
    }
    editing = null; renderList(); renderToday();
  });

  // ---------- Vienti ----------
  function toCSV(list) {
    const q = (v) => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const num = (n) => (n == null || n === '' ? '' : String(n).replace('.', ','));
    const rows = [['Päivämäärä', 'Viikko', 'Työntekijä', 'Työnumero', 'Tunnit', 'Kilometrit', 'Alku', 'Loppu', 'Kuvaus']];
    list.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => {
      const d = parseISO(e.date);
      rows.push([`${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`, isoWeek(d).week, settings.name, e.job, num(e.hours), num(e.km), e.start || '', e.end || '', e.note]);
    });
    return '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
  }
  let downloads = null;
  (async () => { if (window.claude && window.claude.use) downloads = await claude.use('downloads');
    if (!downloads) { $('#exportBtn').hidden = true; $('#exportAllBtn').hidden = true; } })();
  async function shareFile(name, content) {
    if (!downloads) { toast('Tiedoston lataus ei ole käytössä tässä näkymässä. Käytä Kopioi tekstinä.'); return; }
    try { await downloads.save({ filename: name, data: content }); toast('CSV tallennettu'); }
    catch (e) { if (!e || e.code !== 'declined') toast('CSV:n tallennus ei onnistunut.'); }
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
    list.forEach((e) => lines.push(`${fmtDay(parseISO(e.date))} ${e.job || '-'}: ${fmtNum(e.hours) || 0} h${e.km ? ', ' + fmtNum(e.km) + ' km' : ''}${e.note ? ' (' + e.note + ')' : ''}`));
    lines.push(`Yhteensä ${fmtNum(sum(list, 'hours'))} h, ${fmtNum(sum(list, 'km')) || 0} km`);
    try { await navigator.clipboard.writeText(lines.join('\n')); toast('Kopioitu leikepöydälle'); }
    catch { const t = $('#copyOut'); t.hidden = false; t.value = lines.join('\n'); t.focus(); t.select(); toast('Valitse teksti ja kopioi'); }
  });

  // ---------- Asetukset ----------
  const nameInput = $('#nameInput');
  nameInput.value = settings.name || '';
  nameInput.addEventListener('change', () => { settings.name = nameInput.value.trim(); store.save('tl.settings', settings); if (settingsDoc) settingsDoc.set({ name: settings.name }).catch(dbErr); toast('Nimi tallennettu'); });
  $('#wipeBtn').addEventListener('click', (ev) => {
    if (!entries.length) return;
    if (!armed(ev.currentTarget, `Vahvista: poista ${entries.length} kirjausta`, 'Poista kaikki')) return;
    resetConfirm(ev.currentTarget, 'Poista kaikki');
    entries.forEach(dropEntry); entries = []; persist(); renderList(); renderToday(); toast('Kaikki kirjaukset poistettu');
  });

  renderToday();

  connectDb();
})();
