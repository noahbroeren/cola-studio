# Installeren op Render

Deze handleiding zet colastudio.com live op **Render**. Reken op ongeveer 15 minuten. Je hoeft niets te programmeren en niets op je computer te installeren.

Het project bevat een **`render.yaml`** (een "Blueprint"). Daarin staat alles al ingesteld: de Docker-build, de regio Frankfurt, een vaste schijf en de variabelen. Jij vult alleen je admin-wachtwoord in en later je domein.

> De code is precies dezelfde als voor Railway (`docs/RAILWAY.md`). Je kunt later altijd verhuizen: download in de admin een volledige back-up en importeer die op de nieuwe host.

## Hoe het werkt

- Render bouwt de site met de meegeleverde **Dockerfile** en draait één Node-server. Die server levert de website, het beheerpaneel en de API.
- Alles wat je in het beheerpaneel wijzigt, staat op een **Disk**: een vaste schijf van 1 GB op `/app/data` die blijft bestaan bij elke nieuwe versie. Het gaat om producten, voorraad, instellingen, updates, berichten, bestellingen, geüploade foto's en back-ups.
- De server haalt zelf op de achtergrond nieuwe Weibo-posts op (elke 15 minuten), synchroniseert Weidian als je dat aanzet, en ververst de wisselkoersen. Je hoeft geen cronjobs in te stellen.
- Code-wijzigingen push je naar GitHub, waarna Render vanzelf een nieuwe versie bouwt. Producten, voorraad en links beheer je in `/admin`; daarvoor is geen nieuwe build nodig.

## Wat je nodig hebt

| | Kosten | Waarom |
|---|---|---|
| GitHub-account | gratis | Hier staat de code; Render bouwt vanaf hier |
| Render-server `0.5c-512mb` | ongeveer $7 per maand | De kleinste betaalde server. Het gratis abonnement kan geen schijf koppelen, dus dat valt af |
| Render Disk, 1 GB | $0,25 per GB per maand | Ruim genoeg voor deze site. Later vergroten kan, verkleinen niet |
| Vertaal-key (Claude, DeepL of Google) | betalen per gebruik (centen per maand) | Vertaling van Weibo-posts en Weidian-titels naar het Engels. Zonder key komen Weibo-posts binnen als *pending* |
| Je domein colastudio.com | — | Toegang tot de DNS-instellingen |

Prijzen kunnen veranderen; kijk op <https://render.com/pricing>.

---

## Stap 1 — Code op GitHub zetten

1. Ga naar <https://github.com/new>. Kies als naam `cola-studio`, zet de repo op **Private** en klik **Create repository**.
2. Pak `cola-studio.zip` uit.
3. Klik op de nieuwe repo op **uploading an existing file**. Sleep de **inhoud** van de map `cola-studio` erin (dus `Dockerfile`, `render.yaml`, `server.js`, `public`, `server`, …, niet de map zelf) en klik **Commit changes**.
   Liever met git:
   ```bash
   cd cola-studio
   git init && git add . && git commit -m "Cola Studio"
   git branch -M main
   git remote add origin https://github.com/<jouw-naam>/cola-studio.git
   git push -u origin main
   ```

> Controleer dat `Dockerfile`, `render.yaml` en `server.js` in de **hoofdmap** van de repo staan.

## Stap 2 — Blueprint deployen

1. Maak een account op <https://render.com> (inloggen met GitHub is het makkelijkst) en voeg een betaalmethode toe.
2. Klik **New → Blueprint**.
3. Klik bij de repo `cola-studio` op **Connect**. Zie je hem niet, geef Render dan eerst toegang tot die repo via *Configure GitHub*.
4. Geef de Blueprint een naam (bijvoorbeeld `cola-studio`) en laat de branch op `main` staan.
5. Render laat zien wat er wordt aangemaakt: één web service **cola-studio** in **Frankfurt**, met een disk **cola-data** van 1 GB. Vul bij **ADMIN_PASSWORD** een sterk wachtwoord in. Dat is het wachtwoord voor `/admin`.
6. Klik **Deploy Blueprint**. De eerste build duurt een paar minuten. Bij de eerste start vult de site de schijf met de demo-catalogus.

<details>
<summary>Liever met de hand, zonder Blueprint?</summary>

1. **New → Web Service**, kies de repo.
2. **Language:** Docker · **Region:** Frankfurt · **Instance type:** de kleinste betaalde (0.5 CPU, 512 MB).
3. **Advanced → Add Disk:** naam `cola-data`, mount path `/app/data`, grootte 1 GB.
4. **Advanced → Health Check Path:** `/api/health`.
5. **Environment variables:** `ADMIN_PASSWORD` (je wachtwoord), `DATA_DIR=/app/data`, `UPLOADS_DIR=/app/data/uploads`, `TRUST_PROXY=true`.
6. **Create Web Service**.
</details>

## Stap 3 — Controleren

1. Je service staat op een adres als `https://cola-studio.onrender.com` (bovenaan de servicepagina). Open `…/api/health`; je hoort `{"ok":true,…}` te zien.
2. Open de site; die laadt met de demo-catalogus.
3. Open `/admin` en log in met je `ADMIN_PASSWORD`.
4. Controleer op de **Disk**-pagina van je service dat de schijf op `/app/data` staat. Dan blijven je wijzigingen bewaard bij elke nieuwe versie.

## Stap 4 — Variabelen aanvullen

Ga in Render naar je service → **Environment** en voeg toe wat je nodig hebt. Na **Save** start Render de site opnieuw.

| Naam | Waarde | |
|---|---|---|
| `ANTHROPIC_API_KEY` | Je sleutel van <https://console.anthropic.com> | voor de vertaling (of zet DeepL/Google in **Admin → Integrations → Translation**) |
| `SITE_URL` | `https://colastudio.com` | pas nadat je domein werkt (stap 5). Tot die tijd gebruikt de site vanzelf het onrender.com-adres |
| `WEIBO_COOKIE` | Cookie-string uit je browser | alleen als Weibo de server blokkeert (zie [Problemen](#problemen-oplossen)) |
| `WEIDIAN_FETCH_VIA` | URL van een scraping-dienst met je key, met `{url}` erin | alleen als Weidian de server blokkeert |

`ADMIN_PASSWORD`, `DATA_DIR`, `UPLOADS_DIR`, `TRUST_PROXY` en `SESSION_SECRET` staan er al door de Blueprint. Laat die staan.

Weibo staat al standaard aan met het account `7354109778` (<https://weibo.com/u/7354109778>). Alle Weibo-, vertaal- en Weidian-instellingen kun je ook in **Admin → Integrations** zetten. Een variabele in Render wint altijd van de admin-instelling.

## Stap 5 — Je domein koppelen

1. Ga in Render naar je service → **Settings → Custom Domains → + Add Custom Domain** en vul `colastudio.com` in. Render voegt `www.colastudio.com` er zelf bij en stuurt die door naar het hoofddomein.
2. Zet bij je DNS-provider:
   - **`www`:** een **CNAME** naar `cola-studio.onrender.com` (jouw onrender.com-adres, zonder `https://`).
   - **Hoofddomein (`colastudio.com`):** een **ALIAS** of **ANAME** naar `cola-studio.onrender.com` als je provider dat kent (bij Cloudflare: een CNAME op `@`, die wordt automatisch "geflattend"). Kent je provider dat niet, zet dan een **A-record** naar `216.24.57.1`.
3. Verwijder **AAAA-records** (IPv6) voor deze namen; Render gebruikt IPv4. Verwijder ook oude A- of CNAME-records voor dezelfde namen. Laat MX-records (e-mail) staan.
4. Klik in Render op **Verify**. Lukt dat niet meteen, wacht een paar minuten. Render regelt zelf het HTTPS-certificaat en stuurt http door naar https.
5. Zet daarna `SITE_URL=https://colastudio.com` bij **Environment** (stap 4). Dan kloppen sitemap, SEO-tags en links.

## Stap 6 — Eerste keer inrichten in het beheerpaneel

1. **Settings → WhatsApp ordering:** vul je nummer in, internationaal en zonder `+`, bijvoorbeeld `31612345678`.
2. **Settings → Agents & Weidian:** vul per agent een naam en een URL-sjabloon in, bijvoorbeeld `https://agent.example/item?url={weidianUrl}`. Zonder sjabloon toont de knop "Link soon".
3. **Settings → Brand** en **Social links:** controleer e-mail en socials. Weibo staat al ingevuld.
4. **Integrations → Translation:** vul een vertaal-key in, of gebruik `ANTHROPIC_API_KEY` uit stap 4. Zonder key komen Weibo-posts binnen als *pending*: je ziet ze in **Studio updates** en kunt ze daar zelf publiceren.
5. **Producten uit je Weidian-winkel:** **Products → Import / export → Import from Weidian**. Plak de productlinks (of gebruik de bladwijzer-knop in dat venster om alle links uit je winkel te kopiëren), bekijk het voorbeeld en bevestig. Ze komen binnen als *draft*, met voorraad-sync aan. Loop ze na en publiceer ze (selecteren → *Publish*).
6. **Integrations → Weidian:** provider *Public item page*, **Enabled** aan, interval bijvoorbeeld 10 minuten. Doe eerst één keer **Dry run**. Vanaf dan loopt de voorraad automatisch mee.
7. **Of via een spreadsheet:** **Products → Import / export → Download empty template**, invullen in Excel of Google Sheets, en weer importeren.
8. **Backup & logs → Remove all demo content:** haalt alle demoproducten, demoposts en het demolabel weg. Er wordt eerst een snapshot gemaakt.

---

## Dagelijks gebruik

- **Producten, voorraad en teksten** wijzig je in `/admin`; wijzigingen staan meteen online.
- **Nieuwe versie van de code:** push naar GitHub en Render bouwt vanzelf. Omdat er een schijf aan de service hangt, is de site tijdens het wisselen een paar seconden offline. Je data blijft staan.
- **Back-ups:** de site maakt elke dag zelf een snapshot op de schijf (de laatste 10 blijven bewaard), en Render maakt dagelijkse snapshots van de schijf die 7 dagen bewaard blijven (op de **Disk**-pagina van je service). Download af en toe een volledige export via **Backup & logs → Download full backup**, voor een kopie buiten Render.
- **Schijf vol?** Vergroot hem op de **Disk**-pagina. Verkleinen kan niet.

## Verhuizen (van of naar Railway, of een eigen server)

1. Oude site: **Admin → Backup & logs → Download full backup**.
2. Nieuwe site: **Admin → Backup & logs → Import** en kies dat bestand. Er wordt eerst een snapshot gemaakt.
3. Geüploade foto's staan niet in de back-up-JSON. Upload ze opnieuw, of kopieer de map `uploads` van de oude schijf als je die kunt bereiken.
4. Zet daarna je DNS-records om naar de nieuwe host.

## Lokaal testen

```bash
node server.js
```

Daarna staat de site op <http://localhost:3000> en het beheerpaneel op `/admin`, met het lokale wachtwoord `colastudio`. Er is geen `npm install` nodig, alleen Node 18 of nieuwer.

## Problemen oplossen

| Melding / symptoom | Oplossing |
|---|---|
| Na een nieuwe versie zijn mijn wijzigingen weg | Er hangt geen schijf aan de service, of het mount path is niet `/app/data`. Controleer de **Disk**-pagina en de variabele `DATA_DIR=/app/data` |
| Admin zegt dat inloggen uitgeschakeld is | `ADMIN_PASSWORD` ontbreekt. Zet hem bij **Environment** en sla op |
| "Too many login attempts" terwijl je net begint | `TRUST_PROXY=true` ontbreekt; zonder die variabele lijken alle bezoekers één adres. Zet hem bij **Environment** |
| "No open ports detected" of de deploy blijft hangen | Render geeft de server zelf `PORT=10000` mee en de server luistert daarop. Heb je zelf een `PORT`-variabele gezet, haal die dan weg |
| Domein blijft op "Verification failed" | Controleer de CNAME/ALIAS of het A-record `216.24.57.1`, verwijder AAAA-records en probeer na een paar minuten opnieuw **Verify** |
| Weibo: foutmelding of 0 posts | Kijk in **Backup & logs**. Weibo blokkeert soms datacenters. Log in op weibo.com in je browser, kopieer de `Cookie`-header van een verzoek naar `m.weibo.cn` (DevTools → Network) en zet die in `WEIBO_COOKIE` of in *Integrations → Weibo → Cookie* |
| Posts blijven op *pending* | Er is geen werkende vertaal-key. Controleer de key en kies *Re-translate* bij de post (Admin → Studio updates) |
| Import from Weidian / Weidian-sync: "Weidian refused the request" of HTTP 403/429 | Weidian blokkeert het serveradres. Probeer het later opnieuw, of vul bij *Integrations → Weidian → Scraping service* de URL van een scraping-dienst met je API-key in (bijv. `https://api.scraperapi.com/?api_key=JOUW_KEY&url={url}`) |
| Build mislukt | Klik bij **Events** op de mislukte deploy voor de build-log. Staan `Dockerfile`, `server.js`, `server/` en `public/` in de hoofdmap van de repo? |

## Technische referentie

- **Blueprint:** `render.yaml` in de hoofdmap. Eén `web`-service, `runtime: docker`, regio `frankfurt`, plan `0.5c-512mb`, `healthCheckPath: /api/health`, `autoDeployTrigger: commit`, disk `cola-data` op `/app/data` (1 GB). Een Blueprint verwijdert nooit iets: haal je iets uit het bestand, verwijder het dan zelf in het dashboard.
- **Build en start:** de `Dockerfile` (Node 22, geen dependencies) en `node server.js`. De server luistert op `PORT` (Render zet `10000`).
- **Data:** `DATA_DIR=/app/data`, uploads in `/app/data/uploads`. Eén instantie: een service met een schijf kan niet schalen, en de site is daarop gebouwd.
- **Automatische instellingen op Render:** de server herkent Render aan `RENDER=true`. Dan vertrouwt hij de `X-Forwarded-For`-header van Render's proxy, gebruikt hij `RENDER_EXTERNAL_URL` als adres zolang `SITE_URL` niet gezet is, en zet hij uploads in de datamap als `DATA_DIR` gezet is. De Blueprint zet die waarden ook expliciet.
- **Meer details** over de backend, Weibo, vertaling en Weidian staan in [`BACKEND.md`](BACKEND.md).
