const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, normalize } = require('../parser.js');

const TODAY = '2026-11-12T12:00:00'; // torstai
const p = (t) => parse(t, { today: TODAY }).entries;
const pick = (e) => ({ date: e.date, job: e.job, hours: e.hours, km: e.km });

test('lukusanat', () => {
  assert.equal(normalize('kahdeksan tuntia'), '8 tuntia');
  assert.equal(normalize('seitsemän ja puoli tuntia'), '7.5 tuntia');
  assert.equal(normalize('puolitoista tuntia'), '1.5 tuntia');
  assert.equal(normalize('kaksikymmentäviisi kilometriä'), '25 kilometriä');
  assert.equal(normalize('kaksisataakolmekymmentäneljä'), '234');
  assert.equal(normalize('yksi kaksi kolme neljä'), '1234');
  assert.equal(normalize('kaksi tuntia ja viisitoista minuuttia'), '2.25 tuntia');
});

test('perustapaus numeroin', () => {
  assert.deepEqual(p('Työnumero 1234, 8 tuntia, 45 km').map(pick),
    [{ date: '2026-11-12', job: '1234', hours: 8, km: 45 }]);
});

test('perustapaus sanoin ja eilen', () => {
  assert.deepEqual(p('eilen työnumerolle 5521 seitsemän ja puoli tuntia ajoa neljäkymmentäkaksi kilometriä').map(pick),
    [{ date: '2026-11-11', job: '5521', hours: 7.5, km: 42 }]);
});

test('useampi työnumero samassa sanelussa', () => {
  assert.deepEqual(p('työnumero 1234 neljä tuntia ja työnumero 5678 kolme ja puoli tuntia, kilometrit 30').map(pick), [
    { date: '2026-11-12', job: '1234', hours: 4, km: null },
    { date: '2026-11-12', job: '5678', hours: 3.5, km: 30 },
  ]);
});

test('tunnit ennen työnumeroa', () => {
  assert.deepEqual(p('neljä tuntia työnumerolle 1234 ja kolme tuntia työnumerolle 5678').map(pick), [
    { date: '2026-11-12', job: '1234', hours: 4, km: null },
    { date: '2026-11-12', job: '5678', hours: 3, km: null },
  ]);
});

test('kellonajat ja tauko', () => {
  const [e] = p('maanantaina kello 7 - 15.30 kohde 880 ruokatauko 30 min');
  assert.equal(e.date, '2026-11-09');
  assert.equal(e.job, '880');
  assert.equal(e.start, '07:00');
  assert.equal(e.end, '15:30');
  assert.equal(e.hours, 8);
});

test('kellonajat sanoin', () => {
  const [e] = p('seitsemästä neljään työnumero 1200');
  assert.equal(e.hours, 9);
  assert.equal(e.job, '1200');
});

test('päivämäärä numeroin ja kuvaus', () => {
  const [e] = p('10.11. työnumero 2024-15 6 h kuvaus putkien asennus');
  assert.equal(e.date, '2026-11-10');
  assert.equal(e.job, '2024-15');
  assert.equal(e.hours, 6);
  assert.equal(e.note, 'Putkien asennus');
});

test('jäljelle jäävät sanat kuvaukseksi', () => {
  const [e] = p('1234 kahdeksan tuntia sähköasennuksia');
  assert.equal(e.job, '1234');
  assert.equal(e.note, 'Sähköasennuksia');
});

test('puuttuva työnumero varoittaa', () => {
  const [e] = p('kuusi tuntia');
  assert.equal(e.hours, 6);
  assert.deepEqual(e.warnings, ['Työnumero puuttuu']);
});

test('eri päivät samassa sanelussa', () => {
  assert.deepEqual(p('maanantaina 1234 8 tuntia, tiistaina 1234 7 tuntia 20 km').map(pick), [
    { date: '2026-11-09', job: '1234', hours: 8, km: null },
    { date: '2026-11-10', job: '1234', hours: 7, km: 20 },
  ]);
});

test('puoli tuntia ja minuutit', () => {
  assert.equal(p('työnumero 77 puoli tuntia')[0].hours, 0.5);
  assert.equal(p('työnumero 77 45 minuuttia')[0].hours, 0.75);
  assert.equal(p('työnumero 77 1,5 h')[0].hours, 1.5);
});
