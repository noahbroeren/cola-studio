# Cola Studio — website

Website voor **Cola Studio** (colastudio.com). Engelstalig, rustig en premium. Bevat:

- productcatalogus en live voorraad
- vertaalde Weibo-updates
- bestellen via WhatsApp of een agent
- een beheerpaneel

> **Installeren?** Volg **[`docs/RENDER.md`](docs/RENDER.md)** (Render, met kant-en-klare `render.yaml`): stap voor stap, ongeveer 15 minuten. Liever Railway? Dat staat in [`docs/RAILWAY.md`](docs/RAILWAY.md); de code is dezelfde.

> **Demo-content.** Alle producten, prijzen, voorraden en studio-updates zijn fictief en gemarkeerd als demo. Productvisuals zijn illustraties die de site zelf maakt; zodra je echte foto's uploadt, worden die gebruikt. Weg met alle demo-inhoud? Gebruik **Admin → Backup & logs → Remove all demo content**. Demo-posts verdwijnen ook vanzelf van de site zodra er echte Weibo-posts zijn.

---

## Hosting

| | **Render** (gekozen) | Railway | Vercel + Upstash |
|---|---|---|---|
| Starten | **New → Blueprint**: `render.yaml` regelt Docker-build, regio en schijf | Push naar GitHub, Railway bouwt de `Dockerfile` | Push naar GitHub, Vercel deployt |
| Data | Render Disk (`/app/data`, 1 GB) | Railway Volume (`/app/data`) | Upstash Redis |
| Weibo, Weidian, wisselkoersen | Ingebouwde scheduler in de server | Ingebouwde scheduler in de server | Vercel Cron |
| Kosten (indicatie) | ± $7 per maand + $0,25 per GB | $5 per maand incl. $5 gebruik | gratis tiers, daarna per gebruik |
| Handleiding | [`docs/RENDER.md`](docs/RENDER.md) | [`docs/RAILWAY.md`](docs/RAILWAY.md) | [`docs/VERCEL.md`](docs/VERCEL.md) |

Dezelfde code werkt ook op een eigen VPS (`node server.js` of `docker compose up -d`, zie [`docs/BACKEND.md`](docs/BACKEND.md) §3). Er zijn **geen npm-packages** nodig (Node 18+). Producten, voorraad, links en koppelingen beheer je in het beheerpaneel. Daarvoor is nooit een nieuwe build nodig.

### Lokaal proberen

```bash
node server.js            # http://localhost:3000 — beheerpaneel op /admin, wachtwoord lokaal: colastudio
```

Tests draai je met `npm test`.

---

## Pagina's

| Pagina | URL | Inhoud |
|---|---|---|
| Home | `/` | Hero met uitgelicht product, de volgende drop op één regel, 8 uitgelichte stukken, hoe bestellen in 3 stappen, 3 laatste updates |
| Shop | `/products` | Categorieën, filters, zoeken, sorteren |
| Product | `/products/:slug` | Galerij, kleur en maat met voorraad per maat, bestellijst, WhatsApp, agentknop |
| Live stock | `/live-stock` | Voorraad per kleur × maat, ververst vanzelf. Klik op een maat om hem toe te voegen |
| Studio updates | `/updates` | Weibo-posts, automatisch vertaald (English / 中文) |
| How to order | `/how-to-order` | Direct via WhatsApp of via een agent, en verzendtijden |
| Order | `/order` | Bestellijst, gegevens, WhatsApp-bericht met ordernummer |
| About, Contact, FAQ, Size guide | | Korte, rustige pagina's |
| Lookbook, Brand | `/lookbook`, `/brand` | Staan niet in het menu, maar zijn bereikbaar via de zoekfunctie |

Het ontwerp is bewust rustig gehouden. Er zijn geen logo-animaties, preloader, paginaovergangen, eigen cursor of bewegende tekstbanden. Alleen een korte, subtiele fade bij het scrollen.

---

## Beheerpaneel (`/admin`)

- **Products / Inventory / Categories**: producten met foto's, kleuren, maten, voorraadmatrix, Weidian item-ID en agentlinks.
- **Import / export** (op de Products-pagina): *Import from Weidian* (productlinks → concept-producten met voorraad-sync), spreadsheet importeren en exporteren (.xlsx of CSV, met voorbeeld vóór het opslaan) en een leeg sjabloon om in te vullen.
- **Studio updates**: vertalingen nakijken, vastpinnen, verbergen en eigen posts plaatsen.
- **Orders / Messages / Restock requests**.
- **Settings**: WhatsApp-nummer, agents (URL-sjablonen), wisselkoersen, aankondigingsbalk, volgende drop, socials, verzendtabel en demo-markering.
- **Integrations**: Weibo (UID `7354109778` staat al ingesteld), vertaling (Claude/DeepL/Google/LibreTranslate) en Weidian, met testknoppen.
- **Media**, **Backup & logs** (export/import, demo-inhoud verwijderen, serverlog).

### Je eigen catalogus

1. **Settings → WhatsApp ordering**: vul je nummer internationaal in, zonder `+`, bijvoorbeeld `31612345678`.
2. **Settings → Agents & Weidian**: geef elke agent een naam en een URL-sjabloon. Placeholders zijn `{weidianUrl}`, `{itemId}`, `{slug}` en `{name}`.
3. **Products → Import / export**: haal je producten uit Weidian (*Import from Weidian*) of vul het spreadsheet-sjabloon in. Eén voor één kan ook via **New product**.
4. **Integrations → Weidian**: zet de sync aan, dan loopt de voorraad automatisch mee.
5. **Backup & logs → Remove all demo content**.

---

## Koppelingen

- **Weibo**: account `https://weibo.com/u/7354109778`. Nieuwe posts worden opgehaald, vertaald (Chinees → Engels) en gepubliceerd. Foto's en video's lopen via de eigen media-proxy. Voor vertaling is `ANTHROPIC_API_KEY` nodig. Zonder sleutel komen posts binnen als *pending*.
- **Weidian**: voorraad en productinfo. Providers zijn `public-item`, `open-api`, `json-feed` en `mock`. De sync doet een dry-run en logt elke voorraadwijziging.
- **Wisselkoersen**: worden dagelijks bijgewerkt.

Technische details staan in [`docs/BACKEND.md`](docs/BACKEND.md), [`docs/API.md`](docs/API.md) en [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

---

## Huisstijl

- **Kleuren**: Cola `#130D0A`, Foam `#F3EEE6`, Bone `#DDD3C4`, Stone `#8F857A`, accent Syrup `#C07A42` (`public/assets/css/tokens.css`).
- **Typografie**: alleen Poppins; koppen mengen dun (200) en vet (700).
- **Knoppen met afgesneden hoeken**, als een uitgeknipt patroondeel. Labels hebben dezelfde snit.
- **Afwisselende achtergronden**: secties wisselen tussen vier materialen, met donkere banden ertussen. *Patroonpapier* (stipjes en kruisjes, zoals op de snijtafel), *gewoon wit* (voor de productgrids), *snijmat* (fijn ruitjespapier) en *visgraat* (tweed, voor de afsluitende stroken). Een sectie kies je met de classes `bg-paper`, `bg-white`, `bg-grid`, `bg-tweed` of `bg-foam` (`public/assets/css/components.css`). Productvlakken zijn "patroondelen" met een gestikte naadlijn, en de footer heeft een meetlint-rand.
- **Gravures** van kleermakersgereedschap in `public/assets/img/engravings/`: naaimachine (met COLA-decal en monogram-medaillon), klos garen, kleermakersschaar, vingerhoed, paspop en speldenkussen. Het zijn SVG-maskers die de kleur van hun omgeving aannemen (syrup op donker, cola op licht). Je zet ze in met `Cola.brand.engraving('machine')` of de class `engraving engraving--machine`. Opnieuw genereren of aanpassen kan met de Python-scripts in `tools/engravings/`.
- **Logo**: het monogram is als vector nagebouwd. Varianten: primair, reversed, syrup, lockups, zegel, constructietekening, patroon, app-icoon en favicon. Alles staat in `public/assets/brand/` en is te downloaden op `/brand`.

## Teksten aanpassen

Pagina's worden gegenereerd naar `public/*.html` en zijn daar direct te bewerken. FAQ-vragen staan in `public/assets/js/pages/faq.js`, lookbook-looks in `public/assets/js/pages/lookbook.js`. Na een wijziging krijgen CSS en JS automatisch een nieuwe cache-versie (op Railway én Vercel), dus bezoekers zien meteen de nieuwe versie.

## Projectstructuur

```
cola-studio/
├─ api/index.js            ← Vercel-functie (API, productpagina's, uploads, media, cron)
├─ vercel.json             ← Vercel-config: build, rewrites, cron, headers, regio
├─ scripts/
│  ├─ build-vercel.js      ← public/ → dist/ (statische pagina's voor Vercel's CDN)
│  └─ vercel-local.js      ← lokale Vercel-imitatie (npm run vercel:local)
├─ server.js               ← klassieke Node-server (VPS/Docker)
├─ server/                 ← routes, opslag, auth, Weibo, vertaling, Weidian, SEO
│  └─ vercel/              ← Upstash-client, Redis-opslag (met merge bij gelijktijdige wijzigingen)
├─ public/                 ← de website + beheerpaneel + demo-startdata
├─ test/                   ← tests (npm test)
└─ docs/                   ← VERCEL.md, BACKEND.md, API.md, DATA_MODEL.md
```

## Bekende beperkingen

- Weibo en het publieke Weidian-endpoint zijn ongedocumenteerde API's en kunnen veranderen. Controleer ze één keer met je echte account via *Fetch now* en *Test item* in het beheerpaneel.
- Prijzen worden in CNY opgeslagen; andere valuta zijn indicatief.
- Bestellingen worden afgerond in WhatsApp of bij de agent. De site verwerkt geen betalingen.
