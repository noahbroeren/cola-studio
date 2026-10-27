# Installeren op Railway

Deze handleiding zet colastudio.com live op **Railway**. Reken op ongeveer 15 minuten. Je hoeft niets te programmeren en niets op je computer te installeren.

> **Let op (oktober 2026):** na een beveiligingsincident op 20–21 oktober 2026 laat Railway tijdelijk geen nieuwe accounts toe. Kun je je niet aanmelden, gebruik dan [`RENDER.md`](RENDER.md). De code en de werkwijze zijn hetzelfde.

## Hoe het werkt

- Railway bouwt de site met de meegeleverde **Dockerfile** en draait één Node-server. Die server levert de website, het beheerpaneel en de API.
- Alles wat je in het beheerpaneel wijzigt, staat op een **Volume**: een vaste schijf van Railway die blijft bestaan bij elke nieuwe versie. Het gaat om producten, voorraad, instellingen, updates, berichten, bestellingen, geüploade foto's en back-ups.
- De server haalt zelf op de achtergrond nieuwe Weibo-posts op (elke 15 minuten), synchroniseert Weidian als je dat aanzet, en ververst de wisselkoersen. Je hoeft geen cronjobs in te stellen.
- Code-wijzigingen push je naar GitHub, waarna Railway vanzelf een nieuwe versie bouwt. Producten, voorraad en links beheer je in `/admin`; daarvoor is geen nieuwe build nodig.

## Wat je nodig hebt

| | Kosten | Waarom |
|---|---|---|
| GitHub-account | gratis | Hier staat de code; Railway bouwt vanaf hier |
| Railway **Hobby** | $5 per maand, inclusief $5 gebruik | Een kleine Node-site als deze blijft daar normaal binnen. Volumes kosten $0,15 per GB per maand (max. 5 GB op Hobby) |
| Anthropic API-sleutel | betalen per gebruik (centen per maand) | Vertaling van Weibo-posts naar Engels. Optioneel: zonder sleutel komen posts binnen als *pending* |
| Je domein colastudio.com | — | Toegang tot de DNS-instellingen |

---

## Stap 1 — Code op GitHub zetten

1. Ga naar <https://github.com/new>. Kies als naam `cola-studio`, zet de repo op **Private** en klik **Create repository**.
2. Pak `cola-studio.zip` uit.
3. Klik op de nieuwe repo op **uploading an existing file**. Sleep de **inhoud** van de map `cola-studio` erin (dus `Dockerfile`, `server.js`, `public`, `server`, …, niet de map zelf) en klik **Commit changes**.
   Liever met git:
   ```bash
   cd cola-studio
   git init && git add . && git commit -m "Cola Studio"
   git branch -M main
   git remote add origin https://github.com/<jouw-naam>/cola-studio.git
   git push -u origin main
   ```

> Controleer dat `Dockerfile` en `server.js` in de **hoofdmap** van de repo staan.

## Stap 2 — Project aanmaken op Railway

1. Log in op <https://railway.com> met je GitHub-account en neem het **Hobby**-plan.
2. Klik **New Project → Deploy from GitHub repo** en kies `cola-studio`. Geef Railway toegang tot die repo als dat gevraagd wordt.
3. Railway vindt de `Dockerfile` en start de eerste build. Die mag gewoon doorlopen.

## Stap 3 — Volume koppelen (belangrijk)

Zonder volume ben je bij elke nieuwe versie je wijzigingen kwijt.

1. Klik in het projectoverzicht met de rechtermuisknop op de service. Of gebruik `Ctrl/⌘ + K` en typ *volume*. Kies **Add Volume / Attach Volume**.
2. **Mount path:** `/app/data`
3. Railway start de service daarna opnieuw. Bij de eerste start vult de site het volume met de demo-catalogus.

De site gebruikt het volume automatisch voor alles: database, back-ups, uploads (`/app/data/uploads`) en de Weibo-mediacache.

> Laat **Replicas** op 1 staan. Een service met een volume draait altijd als één instantie, en de site is daarop gebouwd.

## Stap 4 — Regio en variabelen

1. **Settings → Region:** kies **EU West (Amsterdam)**. Dat is het dichtst bij jou en bij je klanten in Europa.
2. Ga naar **Variables** en voeg toe:

| Naam | Waarde | |
|---|---|---|
| `ADMIN_PASSWORD` | Een sterk wachtwoord voor `/admin` | **verplicht** (zonder dit staat het beheerpaneel uit) |
| `SITE_URL` | `https://colastudio.com` | aanbevolen. Voor sitemap, SEO en links. Zonder dit gebruikt de site het Railway-adres |
| `ANTHROPIC_API_KEY` | Je sleutel van <https://console.anthropic.com> | voor de vertaling van Weibo-posts |
| `SESSION_SECRET` | Een willekeurige reeks van 48+ tekens | optioneel. Zonder dit wordt er één gemaakt en op het volume bewaard |
| `WEIBO_COOKIE` | Cookie-string uit je browser | alleen nodig als Weibo de server blokkeert (zie [Problemen](#problemen-oplossen)) |

Weibo staat al standaard aan met het account `7354109778` (<https://weibo.com/u/7354109778>). Alle Weibo-, vertaal- en Weidian-instellingen kun je ook later in **Admin → Integrations** zetten. Een variabele hier wint altijd van de admin-instelling.

3. Klik **Deploy** (of *Apply changes*). Railway bouwt opnieuw met de nieuwe variabelen.

## Stap 5 — Adres en healthcheck

1. **Settings → Networking → Generate Domain.** Je krijgt een adres als `cola-studio-production.up.railway.app`. Vraagt Railway om een poort, kies dan `3000`.
2. **Settings → Deploy → Healthcheck Path:** `/api/health`. Dan zet Railway een nieuwe versie pas live als die echt werkt.

## Stap 6 — Controleren

1. Open `https://<jouw-adres>.up.railway.app/api/health`. Je hoort `{"ok":true,…}` te zien.
2. Open de site; die laadt met de demo-catalogus.
3. Open `/admin` en log in met je `ADMIN_PASSWORD`.
4. In **Admin → Integrations**:
   - Klik bij Weibo op **Fetch now**. De eerste run haalt de laatste 6 posts op en vertaalt ze.
   - Plak bij *Test translation* een Chinese zin en klik **Translate** om de vertaling te controleren.

## Stap 7 — Je domein koppelen

1. Klik in Railway op **Settings → Networking → + Custom Domain** en vul `colastudio.com` in. Herhaal dit voor `www.colastudio.com`.
2. Railway toont per domein **twee records**: een **CNAME** en een **TXT**. Zet ze allebei bij je DNS-provider; met alleen de CNAME werkt het niet.
3. **Hoofddomein (`colastudio.com`):** een CNAME op het hoofddomein kan alleen als je DNS-provider *CNAME flattening* of een *ALIAS*-record ondersteunt. Cloudflare, Namecheap en DNSimple kunnen dat; GoDaddy, Hostinger en AWS Route 53 niet. Werkt het bij jouw provider niet, zet dan de nameservers van je domein over naar Cloudflare (gratis) en voeg de records daar toe.
4. Verwijder oude A-, AAAA- of CNAME-records voor dezelfde namen. Laat MX-records (e-mail) staan.
5. Na verificatie verschijnt er een groen vinkje en regelt Railway zelf het HTTPS-certificaat. DNS kan tot 72 uur nodig hebben, maar meestal gaat het binnen een uur.

## Stap 8 — Eerste keer inrichten in het beheerpaneel

1. **Settings → WhatsApp ordering:** vul je nummer in, internationaal en zonder `+`, bijvoorbeeld `31612345678`.
2. **Settings → Agents & Weidian:** vul per agent een naam en een URL-sjabloon in, bijvoorbeeld `https://agent.example/item?url={weidianUrl}`. Zonder sjabloon toont de knop "Link soon".
3. **Settings → Brand** en **Social links:** controleer e-mail en socials. Weibo staat al ingevuld.
4. **Integrations → Translation:** vul een vertaal-key in (Claude, DeepL of Google). Die is nodig om Weibo-posts en Weidian-titels naar het Engels te vertalen. Zonder key komen Weibo-posts binnen als *pending*: je ziet ze in **Studio updates** en kunt ze daar zelf publiceren.
5. **Producten uit je Weidian-winkel:** **Products → Import / export → Import from Weidian**. Plak de productlinks (of gebruik de bladwijzer-knop in dat venster om alle links uit je winkel te kopiëren), bekijk het voorbeeld en bevestig. Ze komen binnen als *draft* met titel, prijs, kleuren, maten, voorraad, foto's en voorraad-sync aan. Loop ze na en publiceer ze (selecteren → *Publish*).
6. **Integrations → Weidian:** provider *Public item page*, **Enabled** aan, interval bijvoorbeeld 10 minuten. Doe eerst één keer **Dry run**. Vanaf dan loopt de voorraad automatisch mee.
7. **Of via een spreadsheet:** **Products → Import / export → Download empty template**, invullen in Excel of Google Sheets, en weer importeren. Je krijgt eerst een voorbeeld van wat er verandert.
8. **Backup & logs → Remove all demo content:** dit haalt alle demoproducten, demoposts en het demolabel weg. Er wordt eerst een snapshot gemaakt. (Bij een spreadsheet-import kun je ook "delete the products that are not in this file" aanvinken.)

---

## Dagelijks gebruik

- **Producten, voorraad en teksten** wijzig je in `/admin`; wijzigingen staan meteen online.
- **Bestellingen:** klanten vullen naam en land in (verplicht) en optioneel e-mail, telefoon, adres, postcode en stad. Alles komt in het WhatsApp-bericht en in **Admin → Orders**.
- **Weibo:** nieuwe posts komen vanzelf binnen, standaard elke 15 minuten (instelbaar in *Integrations*). Met **Fetch now** haal je direct op.
- **Foto's** upload je in het beheerpaneel (tot 8 MB; grote foto's worden automatisch verkleind). Ze staan op het volume.
- **Back-ups:** elke dag wordt er automatisch een snapshot gemaakt op het volume; de laatste 10 blijven bewaard. Een volledige export download je via **Backup & logs → Download full backup**. Doe dat af en toe, voor een kopie buiten Railway.
- **Code aanpassen:** pas aan, commit en push naar GitHub. Railway bouwt vanzelf en je data op het volume blijft staan.

## Lokaal testen

```bash
node server.js
```

Daarna staat de site op <http://localhost:3000> en het beheerpaneel op `/admin`, met het lokale wachtwoord `colastudio`. Er is geen `npm install` nodig, alleen Node 18 of nieuwer.

## Problemen oplossen

| Melding / symptoom | Oplossing |
|---|---|
| Na een nieuwe versie zijn mijn wijzigingen weg | Er is geen volume gekoppeld, of het mount path is niet `/app/data` (stap 3) |
| Admin zegt dat inloggen uitgeschakeld is | `ADMIN_PASSWORD` ontbreekt. Zet hem bij *Variables* en deploy opnieuw |
| Domein geeft 404 terwijl de CNAME klopt | Het TXT-record ontbreekt (stap 7) |
| Weibo: foutmelding of 0 posts | Kijk in **Backup & logs**. Weibo blokkeert soms datacenters. Log in op weibo.com in je browser, kopieer de `Cookie`-header van een verzoek naar `m.weibo.cn` (DevTools → Network) en zet die in `WEIBO_COOKIE` of in *Integrations → Weibo → Cookie* |
| Posts blijven op *pending* | De vertaling mislukt. Controleer `ANTHROPIC_API_KEY` en kies *Re-translate* bij de post (Admin → Studio updates) |
| Import from Weidian / Weidian-sync: "Weidian refused the request" of HTTP 403/429 | Weidian blokkeert het serveradres. Wacht even en probeer opnieuw, of vul bij *Integrations → Weidian → Scraping service* de URL van een scraping-dienst met je API-key in (bijv. `https://api.scraperapi.com/?api_key=JOUW_KEY&url={url}`), of zet `WEIDIAN_FETCH_VIA` als variabele |
| Weidian-titels blijven Chinees | Geen vertaal-key ingesteld (*Integrations → Translation*). Hernoem ze in de producteditor en klik bij URL slug op *From name* |
| Build mislukt | Kijk in Railway bij **Deployments → Build Logs**. Staan `Dockerfile`, `server.js`, `server/` en `public/` in de hoofdmap van de repo? |

## Technische referentie

- **Build:** de `Dockerfile` (Node 22, geen dependencies). Railway gebruikt die automatisch.
- **Start:** `node server.js`. De server luistert op `PORT` (standaard 3000).
- **Data:** `RAILWAY_VOLUME_MOUNT_PATH` (of `DATA_DIR`) bepaalt de datamap; uploads komen in `<datamap>/uploads`.
- **Automatische instellingen:**
  - Op Railway vertrouwt de server de `X-Forwarded-For`-header van Railway's proxy (`TRUST_PROXY`).
  - `SITE_URL` valt terug op `RAILWAY_PUBLIC_DOMAIN`.
- **Meer details** over de backend, Weibo, vertaling en Weidian staan in [`BACKEND.md`](BACKEND.md).
