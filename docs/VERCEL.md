# Installeren op Vercel + Upstash

Deze handleiding zet colastudio.com live op **Vercel** (hosting) met **Upstash Redis** (database). Reken op ongeveer 20 minuten. Je hoeft niets te programmeren en niets op je computer te installeren.

## Hoe het werkt

- **Vercel** serveert de pagina's via zijn wereldwijde CDN. Eén serverless functie (`api/index.js`) doet de rest:
  - de API en het beheerpaneel
  - productpagina's met SEO
  - uploads en de Weibo-mediaproxy
  - de cronjobs
- **Upstash Redis** bewaart alles wat je in het beheerpaneel wijzigt: producten, voorraad, instellingen, updates, berichten, bestellingen en uploads. Bij de allereerste start vult de site zichzelf met de demodata.
- **Vercel Cron** roept elke 5 minuten `/api/cron/tick` aan. Die checkt wat er moet gebeuren:
  - Weibo ophalen: standaard elke 15 minuten
  - Weidian syncen: als dat aanstaat
  - wisselkoersen bijwerken: dagelijks
  - een dagelijkse back-up

Code-wijzigingen push je naar GitHub en Vercel deployt ze automatisch. Producten, voorraad en links beheer je in het beheerpaneel; daarvoor is geen deploy nodig.

---

## Wat je nodig hebt

| | Kosten | Waarom |
|---|---|---|
| GitHub-account | gratis | Hier staat de code; Vercel deployt vanaf hier |
| Vercel **Pro** | $20 per maand | Hobby is alleen voor niet-commercieel gebruik. Op Hobby mogen cronjobs ook maar 1× per dag draaien, en de standaard-cron (elke 5 min) laat de deploy dan mislukken (zie [Hobby](#alleen-testen-op-hobby)) |
| Upstash Redis | gratis tier | 256 MB data, 500.000 commando's en 10 GB verkeer per maand. Ruim genoeg voor deze site |
| Anthropic API-sleutel | betalen per gebruik (centen per maand) | Vertaling van Weibo-posts naar Engels. Optioneel: zonder sleutel komen posts binnen als *pending* |
| Je domein colastudio.com | — | Toegang tot de DNS-instellingen bij je registrar |

---

## Stap 1 — Code op GitHub zetten

1. Ga naar <https://github.com/new>.
2. Kies als naam `cola-studio` en zet de repository op **Private**. Klik **Create repository**.
3. Pak `cola-studio.zip` uit op je computer.
4. Upload de bestanden. Kies één van twee manieren:
   - **Via de website:** klik op de nieuwe repo op **uploading an existing file**. Sleep de **inhoud** van de map `cola-studio` erin (dus `api`, `public`, `server`, `vercel.json` enzovoort, niet de map zelf) en klik **Commit changes**.
   - **Met git:**
     ```bash
     cd cola-studio
     git init && git add . && git commit -m "Cola Studio"
     git branch -M main
     git remote add origin https://github.com/<jouw-naam>/cola-studio.git
     git push -u origin main
     ```

> Controleer dat `vercel.json` en de map `api` in de **hoofdmap** van de repo staan.

## Stap 2 — Project aanmaken op Vercel

1. Log in op <https://vercel.com> met je GitHub-account. Kies het **Pro**-plan (of upgrade je team naar Pro).
2. Klik **Add New… → Project** en importeer de repo `cola-studio`. Geef Vercel toegang tot die repo als dat gevraagd wordt.
3. Laat de instellingen zoals ze zijn. `vercel.json` regelt build, output, rewrites, cron en regio. *Framework Preset* mag op **Other** blijven.
4. Klik **Deploy**. De eerste deploy werkt, maar de site meldt nog *"Storage is not configured"*. Dat los je in stap 3 op.

## Stap 3 — Upstash Redis koppelen

1. Open je project in Vercel en ga naar **Storage → Create Database**. Kies **Upstash → Upstash for Redis**. Dit loopt via de Vercel Marketplace en een Upstash-account wordt automatisch aangemaakt.
2. Stel de database in:
   - **Primary region:** **Frankfurt (eu-central-1)**. Die hoort bij de functieregio `fra1` in `vercel.json`, zodat elke databasevraag maar een paar milliseconden duurt.
   - **Plan:** **Free**.
3. Koppel de database aan het project `cola-studio`, voor alle omgevingen: Production, Preview en Development.
4. Vercel voegt nu zelf de variabelen `KV_REST_API_URL` en `KV_REST_API_TOKEN` toe. De site herkent die automatisch. `UPSTASH_REDIS_REST_URL`/`_TOKEN` werken ook.

> Kies je toch een andere Upstash-regio? Zet dan in `vercel.json` bij `"regions"` de dichtstbijzijnde Vercel-regio, bijvoorbeeld `"sin1"` voor Singapore of `"iad1"` voor Washington.

## Stap 4 — Omgevingsvariabelen instellen

Ga naar **Settings → Environment Variables** en voeg deze toe voor **Production** (en eventueel Preview):

| Naam | Waarde | |
|---|---|---|
| `ADMIN_PASSWORD` | Een sterk wachtwoord voor `/admin` | **verplicht** |
| `CRON_SECRET` | Een willekeurige reeks van 32+ tekens | **verplicht**. Vercel stuurt hem mee met elke cron-aanroep |
| `SESSION_SECRET` | Een willekeurige reeks van 48+ tekens | aanbevolen. Ondertekent admin-logins |
| `SITE_URL` | `https://colastudio.com` | aanbevolen. Voor sitemap, SEO en links |
| `ANTHROPIC_API_KEY` | Je sleutel van <https://console.anthropic.com> | voor vertaling van Weibo-posts |
| `WEIBO_UID` | `7354109778` | optioneel; staat al standaard ingesteld |
| `WEIBO_ENABLED` | `true` | optioneel; staat standaard aan |
| `WEIBO_COOKIE` | Cookie-string uit je browser | alleen als Weibo de server blokkeert (zie [Problemen](#problemen-oplossen)) |

**Willekeurige reeksen maken:** gebruik een wachtwoordgenerator (64 tekens, letters en cijfers), of draai in een terminal `openssl rand -base64 48`.

Alle Weibo-, vertaal- en Weidian-instellingen kun je ook later in **Admin → Integrations** zetten. Een omgevingsvariabele wint altijd van de admin-instelling.

## Stap 5 — Opnieuw deployen

Ga naar **Deployments**, klik bij de bovenste op **⋯** en kies **Redeploy**. Variabelen worden alleen bij een nieuwe deploy ingelezen.

## Stap 6 — Controleren

1. Open `https://<project>.vercel.app/api/health`. Je hoort `{"ok":true,…}` te zien.
2. Open `https://<project>.vercel.app`. De site laadt met de demo-catalogus.
3. Open `https://<project>.vercel.app/admin` en log in met je `ADMIN_PASSWORD`.
4. In **Admin → Integrations**:
   - Klik bij Weibo op **Fetch now**. De eerste run haalt de laatste 6 posts op en vertaalt ze.
   - Plak bij *Test translation* een Chinese zin en klik **Translate** om de vertaling te controleren.
5. Controleer onder **Settings → Cron Jobs** in Vercel dat `/api/cron/tick` (elke 5 min) erbij staat.

## Stap 7 — Je domein koppelen

1. Ga in Vercel naar **Settings → Domains** en voeg `colastudio.com` toe. Vercel stelt voor om `www.colastudio.com` ook toe te voegen, met een redirect naar één van beide. Neem dat over.
2. Vercel toont nu de DNS-records voor jouw project. Zet die bij je domeinregistrar:
   - **Apex** (`colastudio.com`): een **A**-record. Meestal `76.76.21.21`, maar neem de waarde over die Vercel toont.
   - **www**: een **CNAME** naar de projectspecifieke waarde die Vercel toont.
   - Verwijder oude A-, AAAA- of CNAME-records voor dezelfde namen. Laat MX-records (e-mail) staan.
3. Na de DNS-propagatie (minuten tot een paar uur) staat er *Valid Configuration* en regelt Vercel zelf het HTTPS-certificaat.

## Stap 8 — Eerste keer inrichten in het beheerpaneel

1. **Settings → WhatsApp ordering**: vul je nummer in, internationaal en zonder `+`, bijvoorbeeld `31612345678`.
2. **Settings → Agents & Weidian**: vul per agent een naam en een URL-sjabloon in, bijvoorbeeld `https://agent.example/item?url={weidianUrl}`. Zonder sjabloon toont de knop "Link soon".
3. **Settings → Brand** en **Social links**: controleer e-mail en socials. Weibo staat al op `https://weibo.com/u/7354109778`.
4. **Products**: voeg je eigen producten toe, met foto's, kleuren, maten, voorraad en het Weidian item-ID.
5. **Backup & logs → Remove all demo content**: dit haalt alle demoproducten, demoposts en het demolabel weg. Er wordt eerst een snapshot gemaakt.

---

## Dagelijks gebruik

- **Producten, voorraad en teksten** wijzig je in `/admin`. Wijzigingen staan meteen online. De publieke API wordt maximaal ±15 seconden gecachet, de SEO-versie van productpagina's ±1 minuut.
- **Weibo**: nieuwe posts komen vanzelf binnen, standaard elke 15 minuten (instelbaar in *Integrations*). Met **Fetch now** haal je direct op.
- **Foto's** upload je in het beheerpaneel. Ze worden verkleind tot max. ±2400 px en in Upstash bewaard. Met de gratis Upstash-tier passen er ruim 300 productfoto's in. Heb je er veel meer, gebruik dan een externe afbeeldings-URL (bijvoorbeeld Cloudinary) of een betaald Upstash-plan (pay-as-you-go: $0,25/GB).
- **Back-ups**: er wordt dagelijks automatisch een snapshot gemaakt (de laatste 7 blijven bewaard). Een volledige export download je via **Backup & logs → Download full backup**.
- **Code aanpassen**: pas aan, commit en push naar GitHub. Vercel deployt vanzelf en CSS/JS krijgen automatisch een nieuwe cache-versie.

## Lokaal testen

```bash
npm run vercel:local
```

Dit start een imitatie van de Vercel-omgeving op <http://localhost:3001>. Zonder Upstash-gegevens gebruikt hij een tijdelijke geheugen-database. Zet je `KV_REST_API_URL` en `KV_REST_API_TOKEN` in een `.env`-bestand, dan werkt hij met je echte database. Gebruik in dat geval liever een aparte test-database.

## Alleen testen op Hobby

Hobby staat cronjobs maar 1× per dag toe. Een deploy met `*/5 * * * *` **mislukt** daar. Wil je eerst gratis testen? Zet dan in `vercel.json` bij `"crons"` het schema op `"0 6 * * *"`. Weibo wordt dan 1× per dag opgehaald, en met *Fetch now* in de admin kan het altijd direct. Zet het schema terug zodra je op Pro zit.

## Problemen oplossen

| Melding / symptoom | Oplossing |
|---|---|
| `Storage is not configured` (503) | De Upstash-database is niet gekoppeld, of je hebt daarna niet opnieuw gedeployd (stap 3 en 5) |
| Admin zegt dat inloggen uitgeschakeld is | `ADMIN_PASSWORD` ontbreekt. Zet hem en redeploy |
| Cron draait niet of geeft 401 in de logs | `CRON_SECRET` ontbreekt. Zet hem en redeploy |
| Weibo: foutmelding of 0 posts | Kijk in **Backup & logs**. Weibo blokkeert soms datacenters. Log in op weibo.com in je browser, kopieer de `Cookie`-header van een verzoek naar `m.weibo.cn` (DevTools → Network) en zet die in `WEIBO_COOKIE` of in *Integrations → Weibo → Cookie* |
| Posts blijven op *pending* | Vertaling mislukt. Controleer `ANTHROPIC_API_KEY` en kies *Re-translate* bij de post (Admin → Studio updates) |
| Wijziging is niet meteen zichtbaar | Publieke data wordt kort gecachet (±15 s, productpagina's ±1 min). Ververs even later |
| Upload mislukt (te groot) | Vercel accepteert verzoeken tot ±4,5 MB. Foto's worden automatisch verkleind, maar GIF's en SVG's niet: houd die onder 3 MB |
| Import van een back-up mislukt | Hetzelfde limiet van ±4,5 MB per verzoek. Importeer per onderdeel, of exporteer zonder oude berichten en bestellingen |

## Technische referentie

- `vercel.json`:
  - build `node scripts/build-vercel.js`, output `dist/`, `cleanUrls`
  - rewrites voor `/api/*`, `/products/:slug`, `/uploads/*`, `/media/weibo`, `/sitemap.xml` en `/robots.txt`
  - cron `/api/cron/tick`, regio `fra1`, `maxDuration` 300 s
- Cron-endpoints: `/api/cron/tick`, `/api/cron/weibo`, `/api/cron/weidian`, `/api/cron/currency` en `/api/cron/backup`. Je roept ze aan met `Authorization: Bearer <CRON_SECRET>` of `?key=<CRON_SECRET>`, bijvoorbeeld vanuit een externe cronservice.
- Redis-sleutels:
  - `cola:c:<collectie>` met revisieteller `cola:r:<collectie>`
  - `cola:up:*` voor uploads
  - `cola:backup:*` voor snapshots
  - `cola:logs`
- Gelijktijdige wijzigingen (bijvoorbeeld een Weidian-sync terwijl jij een product bewerkt) worden per collectie met compare-and-set opgeslagen en zo nodig automatisch samengevoegd.
