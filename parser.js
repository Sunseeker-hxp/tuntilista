/*
 * Tuntilista – sanelun tulkinta.
 * Muuttaa suomenkielisen sanelun (esim. "eilen työnumero 1234 seitsemän ja puoli tuntia,
 * ajoa 42 kilometriä") kirjausriveiksi: päivä, työnumero, tunnit, kilometrit, kuvaus.
 * Toimii selaimessa (window.TuntiParser) ja Nodessa (module.exports).
 */
(function (global) {
  'use strict';

  // ---------- Lukusanat ----------
  // c: '' = perusmuoto/genetiivi/partitiivi, 'el' = elatiivi (-sta), 'il' = illatiivi (-en)
  const UNITS = {};
  function forms(v, nom, el, il) {
    nom.forEach((f) => (UNITS[f] = { v, c: '' }));
    el.forEach((f) => (UNITS[f] = { v, c: 'el' }));
    il.forEach((f) => (UNITS[f] = { v, c: 'il' }));
  }
  forms(0, ['nolla', 'nollan'], ['nollasta'], ['nollaan']);
  forms(1, ['yksi', 'yhden'], ['yhdestä'], ['yhteen']);
  forms(2, ['kaksi', 'kahden', 'kahta'], ['kahdesta'], ['kahteen']);
  forms(3, ['kolme', 'kolmen', 'kolmea'], ['kolmesta'], ['kolmeen']);
  forms(4, ['neljä', 'neljän', 'neljää'], ['neljästä'], ['neljään']);
  forms(5, ['viisi', 'viiden', 'viittä'], ['viidestä'], ['viiteen']);
  forms(6, ['kuusi', 'kuuden', 'kuutta'], ['kuudesta'], ['kuuteen']);
  forms(7, ['seitsemän', 'seitsemää'], ['seitsemästä'], ['seitsemään']);
  forms(8, ['kahdeksan', 'kahdeksaa'], ['kahdeksasta'], ['kahdeksaan']);
  forms(9, ['yhdeksän', 'yhdeksää'], ['yhdeksästä'], ['yhdeksään']);
  const TENS = { kymmenen: '', kymmentä: '', kymmenestä: 'el', kymmeneen: 'il' };
  const OTHER = ['toista', 'sata', 'sataa', 'tuhat', 'tuhatta'];
  const MORPHEMES = Object.keys(UNITS)
    .concat(Object.keys(TENS), OTHER)
    .sort((a, b) => b.length - a.length);

  function tokenizeNumberWord(w) {
    const out = [];
    let i = 0;
    while (i < w.length) {
      const m = MORPHEMES.find((x) => w.startsWith(x, i));
      if (!m) return null;
      out.push(m);
      i += m.length;
    }
    return out.length ? out : null;
  }

  function numberValue(tokens) {
    let total = 0, pending = 0, lastUnit = false, cas = '';
    for (const t of tokens) {
      if (UNITS[t]) {
        total += pending;
        pending = UNITS[t].v;
        cas = UNITS[t].c;
        lastUnit = true;
        continue;
      }
      if (t in TENS) {
        if (lastUnit && t !== 'kymmenen') pending *= 10;
        else { total += pending; pending = 10; }
        cas = TENS[t];
        lastUnit = false;
        continue;
      }
      lastUnit = false;
      if (t === 'toista') pending += 10;
      else if (t === 'sata') { total += pending; pending = 100; }
      else if (t === 'sataa') pending = (pending || 1) * 100;
      else if (t === 'tuhat') { total += pending + 1000; pending = 0; }
      else if (t === 'tuhatta') { total = (total + (pending || 1)) * 1000; pending = 0; }
    }
    return { v: total + pending, c: cas };
  }

  const L = 'a-zåäö';
  const END = '(?=$|[\\s,.;:!?])';

  /** Muuttaa lukusanat numeroiksi ja yhtenäistää desimaalit ym. */
  function normalize(text) {
    let t = String(text || '')
      .toLowerCase()
      .replace(/[–—−]/g, '-')
      .replace(/puolitoista/g, '1,5');

    const words = t.split(/\s+/).filter(Boolean);
    const out = [];
    let run = [];
    const flush = (trail) => {
      if (!run.length) return;
      let s;
      const digitsOnly = run.length > 1 && run.every((r) => r.length === 1 && UNITS[r[0]] && !UNITS[r[0]].c);
      if (digitsOnly) {
        // "yksi kaksi kolme neljä" -> 1234 (työnumerot luetellaan usein numero kerrallaan)
        s = run.map((r) => UNITS[r[0]].v).join('');
      } else {
        const n = numberValue([].concat(...run));
        s = String(n.v) + (n.c === 'el' ? ':stä' : n.c === 'il' ? ':een' : '');
      }
      out.push(s + (trail || ''));
      run = [];
    };
    for (const w of words) {
      const m = w.match(new RegExp('^([' + L + ']+)([^' + L + ']*)$'));
      const toks = m && tokenizeNumberWord(m[1]);
      if (toks) {
        run.push(toks);
        if (m[2] || numberValue(toks).c) flush(m[2]);
        continue;
      }
      flush();
      out.push(w);
    }
    flush();
    t = ' ' + out.join(' ') + ' ';

    t = t
      .replace(/(\d),(\d)/g, '$1.$2')
      .replace(/(\d+(?:\.\d+)?) ja puoli(?= )/g, (_, n) => String(parseFloat(n) + 0.5))
      .replace(/(\d+(?:\.\d+)?) ja vartti(?= )/g, (_, n) => String(parseFloat(n) + 0.25))
      .replace(/(\d+) pilkku (\d+)/g, '$1.$2')
      .replace(/(\d+) varttia(?= )/g, (_, n) => String(n * 0.25) + ' tuntia')
      .replace(/ puolen(?= tunnin)/g, ' 0.5')
      .replace(/ vartin(?= )/g, ' 0.25 tunnin')
      .replace(/ vartti(?= )/g, ' 0.25 tuntia')
      .replace(/ puoli(?= )/g, ' 0.5')
      // "2 tuntia (ja) 15 minuuttia" -> "2.25 tuntia"
      .replace(new RegExp('(\\d+(?:\\.\\d+)?) ?(?:h|tuntia|tunti|tunnin) (?:ja )?(\\d+) ?min[' + L + ']*' + END, 'g'),
        (_, h, m) => round2(parseFloat(h) + m / 60) + ' tuntia');

    return t.replace(/\s+/g, ' ').trim();
  }

  // ---------- Päivämäärät ----------
  const MONTHS = ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu'];
  const WEEKDAYS = ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'];
  const RELATIVE = [
    ['ylihuomenna', 2], ['toissa ?päivänä', -2], ['toissapäivänä', -2],
    ['eilen', -1], ['tänään', 0], ['huomenna', 1],
  ];

  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function round2(n) { return Math.round(n * 100) / 100; }

  function mkDate(today, day, month, year) {
    day = +day; month = +month;
    if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
    let y = year ? +year : today.getFullYear();
    if (year && year.length === 2) y = 2000 + y;
    let d = new Date(y, month - 1, day, 12);
    if (d.getMonth() !== month - 1) return null;
    // ilman vuotta: kauas tulevaisuuteen osuva päivä tarkoittaa todennäköisesti viime vuotta
    if (!year && d - today > 31 * 864e5) d = new Date(y - 1, month - 1, day, 12);
    return iso(d);
  }

  /** Korvaa tekstin numeropäivät (12.11. / 12.11.2026 / 12. marraskuuta) merkillä @YYYY-MM-DD. */
  function markDates(t, today) {
    t = t.replace(/(^|[^\d.])(\d{1,2})\. ?(\d{1,2})\.(\d{4}|\d{2})?(?!\d)/g, (all, p, d, m, y) => {
      const s = mkDate(today, d, m, y);
      return s ? p + '@' + s + ' ' : all;
    });
    t = t.replace(new RegExp('(\\d{1,2})\\.? ?(' + MONTHS.join('|') + ')kuu(?:ta|n)?' + END, 'g'), (all, d, mon) => {
      const s = mkDate(today, d, MONTHS.indexOf(mon) + 1);
      return s ? '@' + s + ' ' : all;
    });
    return t;
  }

  function extractDate(c, today) {
    let text = ' ' + c + ' ';
    let date = null;
    const m = text.match(/@(\d{4}-\d{2}-\d{2})/);
    if (m) { date = m[1]; text = text.replace(m[0], ' '); }
    for (const [w, n] of RELATIVE) {
      const re = new RegExp('(^|\\s)' + w + END);
      if (re.test(text)) { if (!date) date = iso(addDays(today, n)); text = text.replace(re, '$1'); }
    }
    const wre = new RegExp('(^|\\s)(?:(viime|ensi) )?(' + WEEKDAYS.join('|') + ')(?:na|n)?' + END);
    const wm = text.match(wre);
    if (wm) {
      const wd = WEEKDAYS.indexOf(wm[3]);
      let diff = (today.getDay() - wd + 7) % 7;
      if (wm[2] === 'viime' && diff === 0) diff = 7;
      if (wm[2] === 'ensi') diff = -((wd - today.getDay() + 7) % 7 || 7);
      if (!date) date = iso(addDays(today, -diff));
      text = text.replace(wm[0], wm[1]);
    }
    return { date, text };
  }

  // ---------- Yksittäinen lauseke ----------
  const NUM = '(\\d+(?:\\.\\d+)?)';
  const JOB_KW = '(?:työ ?numero[' + L + ']*|työ ?nro|työ ?n:o|tilaus ?numero[' + L + ']*|tilaus[' + L + ']*|' +
    'projekti[' + L + ']*|kohtee[' + L + ']*|kohde|numero[' + L + ']*|nro|n:o)';
  const STOP = new Set(('ja sekä klo kello tein teen tehty tehtiin tehnyt tunnit tuntia tunteja tunti työtä töitä työ ' +
    'kirjaa kirjaan kirjaus kirjaa merkitse merkkaa merkkaan laita lisää oli on olin olen olen yhteensä ' +
    'ajoa ajoin ajettu ajoja ajo ajoi kilometrit kilometriä km sitten myös lisäksi plus noin eli niin että ' +
    'mulla minulla mä minä mun tuli tulee siihen siitä sille sinne tälle tänne päivä päivälle ' +
    'työnumero työnumerolle työnumerolla numerolle numerolla tauko ruokatauko asti saakka alkaen').split(' '));

  const TRIM_RE = new RegExp('^[^\\w' + L + ']+|[^\\w' + L + ']+$', 'g');

  function parseClause(c) {
    const info = { job: null, hours: null, km: null, start: null, end: null, breakH: 0, note: '' };
    let rest = ' ' + c + ' ';
    const take = (re, fn) => {
      const m = rest.match(re);
      if (m && fn(m) !== false) { rest = rest.replace(m[0], ' '); return true; }
      return false;
    };

    // Työnumero avainsanan perässä
    take(new RegExp(JOB_KW + ' ?:? ?([a-z]{0,3}-?\\d[\\d\\-/]*)'), (m) => { info.job = m[1].replace(/[-/]+$/, '').toUpperCase(); });

    // Kellonajat: "7-15.30", "klo 7.00 - 15.30", "7:stä 15:een"
    const T = '(\\d{1,2})(?:[.:](\\d{2}))?';
    take(new RegExp('(?:klo |kello )?' + T + ' ?(?:-|:?stä|:?sta|alkaen) ?(?:klo |kello |- )?' + T +
      '(?::?een|:?ään|:?aan|:?en|:?än| asti| saakka)?' + END), (m) => {
      const s = +m[1] + (+m[2] || 0) / 60;
      let e = +m[3] + (+m[4] || 0) / 60;
      if (s > 24 || e > 24 || (+m[2] || 0) > 59 || (+m[4] || 0) > 59) return false;
      if (e <= s) e += 12;
      if (e <= s) e += 12;
      info.start = pad(m[1]) + ':' + (m[2] || '00');
      info.end = pad(m[3]) + ':' + (m[4] || '00');
      info.rangeH = e - s;
    });

    // Tauko: "tauko 30 min", "puolen tunnin ruokatauko"
    const unitH = (n, u) => (u ? (/^min/.test(u) ? n / 60 : n) : n >= 5 ? n / 60 : n);
    take(new RegExp('(?:ruoka)?tauko[' + L + ']* (?:oli )?' + NUM + ' ?(min[' + L + ']*|h|tunti[' + L + ']*|tunnin)?' + END),
      (m) => { info.breakH = unitH(parseFloat(m[1]), m[2]); }) ||
    take(new RegExp(NUM + ' ?(min[' + L + ']*|h|tunti[' + L + ']*|tunnin) (?:ruoka)?tauko[' + L + ']*' + END),
      (m) => { info.breakH = unitH(parseFloat(m[1]), m[2]); });

    // Tunnit ja minuutit
    let h = 0, found = false;
    rest = rest.replace(new RegExp(NUM + ' ?(?:h|t|tuntia|tunnin|tunti|tuntii|tuntiin|tunniksi)' + END, 'g'),
      (_, n) => { h += parseFloat(n); found = true; return ' '; });
    rest = rest.replace(new RegExp('(\\d+) ?(?:min|minuuttia|minuutin|minuutti|minsaa)' + END, 'g'),
      (_, n) => { h += n / 60; found = true; return ' '; });
    if (!found) {
      rest = rest.replace(new RegExp('(^|\\s)(?:tunti|tunnin)' + END), (_, p) => { h = 1; found = true; return p + ' '; });
    }
    if (found) info.hours = round2(h);
    else if (info.rangeH != null) info.hours = round2(info.rangeH - info.breakH);

    // Kilometrit
    take(new RegExp(NUM + ' ?(?:km|kilometri[' + L + ']*|kilometre[' + L + ']*|kilsa[' + L + ']*|kilsoja)' + END),
      (m) => { info.km = parseFloat(m[1]); }) ||
    take(new RegExp('(?:km|kilometri[' + L + ']*|kilometre[' + L + ']*|kilsat|kilsoja|ajokilometri[' + L + ']*|ajo[' + L + ']*) ?:? ?(?:oli |on |yhteensä )?' + NUM + END),
      (m) => { info.km = parseFloat(m[1]); });

    // Työnumero ilman avainsanaa: vähintään 3-numeroinen luku, jota ei ole jo tulkittu
    if (!info.job) {
      take(/(^|[^\d.:,\-@])(\d{3,}(?:-\d+)?)(?![\d.:,])/, (m) => { info.job = m[2]; });
    }

    // Kuvaus: "kuvaus/selite/tehtävä ..." tai jäljelle jäävät sanat
    let note = '';
    take(new RegExp('(?:kuvaus|selite|tehtävä|työtehtävä|lisätieto|huomio)[' + L + ']* ?:? ?(.+)$'), (m) => { note = m[1]; });
    const leftovers = rest.split(/\s+/)
      .map((w) => w.replace(TRIM_RE, ''))
      .filter((w) => w && !STOP.has(w) && !/^[-:.,]+$/.test(w));
    note = (note + ' ' + leftovers.join(' ')).replace(/\s+/g, ' ').trim();
    info.note = note;
    return info;
  }

  function isEmpty(e) { return e.job == null && e.hours == null && e.km == null && !e.note; }

  /**
   * Tulkitsee sanelun. Palauttaa { normalized, entries: [{date, job, hours, km, start, end, note, warnings}] }.
   * opts.today: Date tai ISO-merkkijono (oletus: nyt)
   */
  function parse(text, opts) {
    opts = opts || {};
    const today = opts.today ? new Date(opts.today) : new Date();
    today.setHours(12, 0, 0, 0);

    const normalized = normalize(text);
    const marked = markDates(normalized, today);
    const clauses = marked
      .split(/\s*(?:[,;!?]|\.(?=\s|$)|\s(?:ja|sekä|lisäksi|plus|sitten|seuraavaksi|ja sitten)\s)\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    const entries = [];
    let cur = null;
    let firstDate = null;
    for (const c of clauses) {
      const d = extractDate(c, today);
      const info = parseClause(d.text);
      info.date = d.date;
      if (d.date && !firstDate) firstDate = d.date;
      if (isEmpty(info) && !info.date) continue;

      const startNew = !cur ||
        (info.job && cur.job && info.job !== cur.job) ||
        (info.hours != null && cur.hours != null) ||
        (info.date && cur.date && info.date !== cur.date && !isEmpty(cur));
      if (startNew) {
        cur = { date: null, job: null, hours: null, km: null, start: null, end: null, note: '' };
        entries.push(cur);
      }
      for (const k of ['date', 'job', 'hours', 'start', 'end']) if (cur[k] == null && info[k] != null) cur[k] = info[k];
      if (info.km != null) cur.km = round2((cur.km || 0) + info.km);
      if (info.note) cur.note = (cur.note ? cur.note + ', ' : '') + info.note;
    }

    let lastDate = null;
    const result = entries.filter((e) => !isEmpty(e)).map((e) => {
      const date = e.date || lastDate || firstDate || iso(today);
      lastDate = date;
      const note = e.note ? e.note.charAt(0).toUpperCase() + e.note.slice(1) : '';
      const warnings = [];
      if (!e.job) warnings.push('Työnumero puuttuu');
      if (e.hours == null && e.km == null) warnings.push('Tunnit puuttuvat');
      return { date, job: e.job || '', hours: e.hours, km: e.km, start: e.start, end: e.end, note, warnings };
    });
    return { normalized, entries: result };
  }

  const api = { parse, normalize, iso };
  global.TuntiParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
