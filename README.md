# Tuntilista

Mobiilisovellus (PWA) työtuntien kirjaamiseen sanelemalla. Työntekijä painaa mikrofonia ja sanelee
esim. *”Eilen työnumero 1234 seitsemän ja puoli tuntia, ajoa 42 kilometriä”*. Sovellus tulkitsee
päivän, työnumeron, tunnit, kilometrit ja kuvauksen. Rivit tarkistetaan ennen tallennusta.

## Ominaisuudet
- Suomenkielinen sanelu (selaimen puheentunnistus, `fi-FI`). Lukusanat tunnistetaan (”kaksikymmentäviisi”, ”puolitoista”, ”seitsemän ja puoli”).
- Monta kirjausta yhdellä sanelulla: ”työnumero 1234 neljä tuntia ja työnumero 5678 kolme tuntia”.
- Kellonajat ja tauot: ”kello 7 – 15.30, ruokatauko 30 min” → 8 h.
- Päivät: tänään (oletus), eilen, toissapäivänä, maanantaina, 10.11.
- Matkat: **Aloita matka** / **Lopeta matka** tallentaa lähtö- ja tuloajan sekä -paikan. Ajetut kilometrit mitataan GPS-seurannalla matkan aikana (sovellus auki, näyttö pysyy päällä). Jos seuranta katkeaa, kilometrit lasketaan ajoreitin mukaan (OSRM). Osoitteet haetaan OpenStreetMapin Nominatim-palvelusta.
- Ilman verkkoa: asennuksen jälkeen kirjaukset, matkat ja GPS-kilometrit toimivat offline. Paikat tallentuvat koordinaatteina ja vaihtuvat osoitteiksi, kun verkko palaa. Sanelunappi tarvitsee verkon.
- Viikkonäkymä: päiväkohtaiset summat, viikon tunnit/km, yhteenveto työnumeroittain.
- Vienti: CSV (Excel-yhteensopiva, `;` ja desimaalipilkku) jakovalikon kautta, tai teksti leikepöydälle.
- Toimii offline ja asentuu kotinäytölle. Tiedot tallentuvat puhelimen muistiin.

## Käyttöönotto
Sovellus on pelkkiä staattisia tiedostoja. Se pitää julkaista **HTTPS**-osoitteeseen (esim. GitHub Pages,
Netlify tai Cloudflare Pages), koska mikrofoni ja asennus vaativat sen.
Puhelimessa: avaa osoite → *Lisää kotivalikkoon* / *Asenna sovellus*.

Paikallinen kehitys:
```bash
npm start      # http://localhost:8080
npm test       # sanelun tulkinnan testit
```

## Tiedostot
- `parser.js`: sanelun tulkinta (toimii myös Nodessa, testit `test/`)
- `app.js`: käyttöliittymä, tallennus, vienti
- `index.html`, `style.css`, `manifest.webmanifest`, `sw.js`, `icons/`

## Rajoitukset
- Puheentunnistus: Chrome (Android) ja Safari (iOS 14.5+). Jos selain ei tue sitä, voi käyttää näppäimistön mikrofonia tekstikentässä.
- Tunnistus toimii yleensä vain verkkoyhteyden kanssa.
- Tiedot ovat vain kyseisessä puhelimessa. Vie CSV säännöllisesti. Yhteinen palvelin/tietokanta on luonteva jatkokehitys.
