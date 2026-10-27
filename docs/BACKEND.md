# Cola Studio — backend

> **Hosting op Vercel + Upstash?** Gebruik [`VERCEL.md`](VERCEL.md). Dit document beschrijft de backend en de klassieke Node-server (VPS/Docker); de Weibo-, vertaal- en Weidian-uitleg geldt voor beide.


Deze map bevat de server achter colastudio.com: hij serveert de website, levert
de JSON-API voor de site en het admin-paneel, haalt Weibo-posts op en vertaalt
ze, en synchroniseert voorraad met Weidian.

**Geen dependencies.** De server gebruikt alleen ingebouwde onderdelen van
Node.js. Er is geen `npm install` nodig: `node server.js` werkt meteen.

- Node.js **18.17 of nieuwer** (getest op Node 22)
- Data in JSON-bestanden in `data/` (geen database-server nodig)
- API-contract: [`docs/API.md`](API.md) · datamodel: [`docs/DATA_MODEL.md`](DATA_MODEL.md)

---

## 1. Lokaal draaien

```bash
cd cola-studio
node server.js            # of: npm start
# → http://localhost:3000   admin: http://localhost:3000/admin
```

Zonder `.env` start de server in ontwikkelmodus met het admin-wachtwoord
**`colastudio`** (er staat dan een duidelijke waarschuwing in het log).

Handige commando's:

| Commando | Wat het doet |
|---|---|
| `npm run dev` | herstart automatisch als je servercode aanpast (`node --watch`) |
| `npm test` | draait alle tests (`node --test`), zonder internet |
| `cp .env.example .env` | maakt je eigen configuratiebestand |

Bij de **eerste start** wordt `data/db.json` gevuld met de inhoud van
`public/data/*.json` (instellingen, categorieën, producten, updates,
voorraadhistorie). Daarna is `data/db.json` de bron van waarheid; wijzigingen
via het admin-paneel komen daar terecht. Wil je opnieuw beginnen vanaf de
seed-bestanden: stop de server en verwijder `data/db.json`.

### Wat staat er in `data/`?

| Bestand / map | Inhoud |
|---|---|
| `db.json` | alle content: settings, categories, products, updates, inventoryEvents, messages, orders, notify |
| `private.json` | geheimen en integratie-instellingen (Weibo, vertaling, Weidian). Alleen leesbaar voor de server (rechten 600), wordt **nooit** naar de browser gestuurd |
| `session-secret` | automatisch gegenereerde sleutel voor admin-sessies (als `SESSION_SECRET` niet gezet is) |
| `backups/` | dagelijkse snapshots van `db.json` (de nieuwste 10 blijven bewaard) |
| `cache/weibo/` | lokaal bewaarde Weibo-foto's en -video's |

Schrijven gebeurt atomair (eerst een tijdelijk bestand, dan hernoemen), dus een
crash of stroomstoring laat nooit een half bestand achter. Is `db.json` toch
onleesbaar, dan zet de server het opzij en herstelt hij automatisch de nieuwste
backup.

---

## 2. Omgevingsvariabelen

Zet ze in `.env` (naast `server.js`) of in je hostingpaneel. Echte
omgevingsvariabelen gaan altijd vóór `.env`. Integratie-instellingen kun je
ook in **Admin → Integrations** invullen; staat dezelfde instelling in een
omgevingsvariabele, dan wint de omgevingsvariabele (het admin-paneel laat zien
welke velden zo "vastgezet" zijn).

| Variabele | Standaard | Uitleg |
|---|---|---|
| `NODE_ENV` | – | `production` op je server. Dan is `ADMIN_PASSWORD` verplicht (anders is het admin-paneel uitgeschakeld) |
| `PORT` | `3000` | poort waarop de server luistert |
| `HOST` | `0.0.0.0` | netwerkinterface (`127.0.0.1` = alleen lokaal, bv. achter nginx) |
| `SITE_URL` | `https://colastudio.com` | gebruikt voor canonical-links, Open Graph, sitemap |
| `ADMIN_PASSWORD` | dev: `colastudio` | wachtwoord voor `/admin`. **Kies een lang, uniek wachtwoord** |
| `SESSION_SECRET` | automatisch | sleutel voor admin-tokens; leeg = gegenereerd in `data/session-secret` |
| `SESSION_TTL_DAYS` | `7` | hoe lang een admin-login geldig blijft |
| `DATA_DIR` | `./data` | map voor database, backups, cache |
| `PUBLIC_DIR` | `./public` | map met de website |
| `UPLOADS_DIR` | `public/uploads` | map voor admin-uploads (geserveerd op `/uploads/…`) |
| `TRUST_PROXY` | `auto` | `auto` vertrouwt `X-Forwarded-For`/`X-Real-IP` alleen van een lokale proxy (nginx, Docker). `false` als de server direct aan internet hangt |
| `ALLOWED_ORIGINS` | – | extra domeinen die POST/PUT mogen doen (komma-gescheiden), bv. `https://www.colastudio.com` |
| `ASSET_MAX_AGE` | `604800` | browsercache voor `/assets/*` in seconden (met `?v=…` in de URL: 1 jaar) |
| `CSP` | ingebouwd | Content-Security-Policy op HTML-pagina's; `off` = uit, of een eigen policy (nodig als je ooit scripts van een extern domein laadt) |
| `LOG_REQUESTS` | `0` | `1` = elk request loggen |
| `DISABLE_SCHEDULERS` | `0` | `1` = geen automatische Weibo/Weidian/wisselkoers-taken |
| `WEIBO_ENABLED`, `WEIBO_UID`, `WEIBO_COOKIE`, `WEIBO_INTERVAL_MINUTES`, `WEIBO_AUTO_PUBLISH`, `WEIBO_BACKFILL` | – | zie §4 |
| `WEIBO_VIDEO_MAX_MB` | `60` | grotere video's worden niet lokaal bewaard |
| `TRANSLATION_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DEEPL_API_KEY`, `GOOGLE_TRANSLATE_API_KEY`, `LIBRETRANSLATE_URL`, `LIBRETRANSLATE_API_KEY` | – | zie §5 |
| `WEIDIAN_ENABLED`, `WEIDIAN_PROVIDER`, `WEIDIAN_INTERVAL_MINUTES`, `WEIDIAN_APP_KEY`, `WEIDIAN_APP_SECRET`, `WEIDIAN_ACCESS_TOKEN`, `WEIDIAN_FEED_URL`, `WEIDIAN_FETCH_VIA` | – | zie §6 |

### Beveiliging in het kort

- Admin-login met `ADMIN_PASSWORD` (constant-time vergelijking), daarna een
  ondertekend token dat 7 dagen geldig is. Wachtwoord wijzigen = alle bestaande
  logins worden ongeldig.
- Maximaal 10 inlogpogingen per 15 minuten per IP; formulieren (contact,
  bestellingen, voorraadalerts) maximaal 20 per 10 minuten per IP.
- POST/PUT/DELETE vanaf een ander domein worden geweigerd (CSRF-bescherming).
- API-sleutels en de Weibo-cookie staan alleen in `data/private.json` of in
  omgevingsvariabelen. In het admin-paneel zie je ze gemaskeerd (`••••abcd`);
  laat je zo'n gemaskeerde waarde staan, dan blijft de oude sleutel bewaard.
- Uploads: alleen jpg/png/webp/gif/avif/svg, maximaal 8 MB. Het echte type wordt
  aan de bytes herkend (niet aan de bestandsnaam); SVG's met scripts of
  event-handlers worden geweigerd.
- Standaard security-headers (nosniff, frame-opties, referrer-policy, CSP op
  HTML-pagina's, HSTS achter HTTPS in productie).

---

## 3. Deployen

Je hebt drie gangbare opties. In alle gevallen moeten **`data/`** en
**`public/uploads/`** (of `UPLOADS_DIR`) bewaard blijven tussen updates en
herstarts — daar staan je producten, posts, backups en geüploade foto's.

### A. Eigen VPS (aanrader) — PM2 of systemd + nginx

Een VPS heeft een vast IP en is ook voor Weibo de beste plek (zie §8).

```bash
# op de server (Ubuntu/Debian), als gewone gebruiker
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
git clone <jouw-repo> /opt/cola-studio && cd /opt/cola-studio
cp .env.example .env && nano .env        # ADMIN_PASSWORD, SITE_URL, API-sleutels …
node server.js                           # even testen, dan Ctrl+C
```

**Met PM2:**

```bash
sudo npm install -g pm2
pm2 start server.js --name cola-studio --time
pm2 save
pm2 startup        # voer het commando uit dat PM2 toont → start na reboot
pm2 logs cola-studio
```

**Of met systemd** — `/etc/systemd/system/cola-studio.service`:

```ini
[Unit]
Description=Cola Studio website
After=network-online.target

[Service]
Type=simple
User=cola
WorkingDirectory=/opt/cola-studio
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cola-studio
journalctl -u cola-studio -f
```

(De server leest `.env` zelf in; een `EnvironmentFile=` is niet nodig.)

**nginx als reverse proxy** — `/etc/nginx/sites-available/colastudio.com`:

```nginx
server {
    listen 80;
    server_name colastudio.com www.colastudio.com;
    return 301 https://colastudio.com$request_uri;
}

server {
    listen 443 ssl http2;
    server_name colastudio.com;

    ssl_certificate     /etc/letsencrypt/live/colastudio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/colastudio.com/privkey.pem;

    # uploads (8 MB, base64 maakt het ~1/3 groter) en backup-imports
    client_max_body_size 64m;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/colastudio.com /etc/nginx/sites-enabled/
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d colastudio.com -d www.colastudio.com
sudo nginx -t && sudo systemctl reload nginx
```

Zet in `.env` dan `HOST=127.0.0.1`, zodat poort 3000 niet direct van buiten
bereikbaar is. De server comprimeert (gzip) en cachet zelf; nginx hoeft
daarvoor niets te doen.

**Updaten:** `git pull` en daarna `pm2 restart cola-studio` (of
`sudo systemctl restart cola-studio`). `data/` blijft staan.

### B. Docker

```bash
cp .env.example .env && nano .env
docker compose up -d --build
docker compose logs -f
```

- De container draait als niet-root gebruiker (`node`, uid 1000) op Node 22 Alpine.
- `data/` en `public/uploads/` staan in Docker-volumes (`cola-data`,
  `cola-uploads`) en overleven `docker compose up --build`.
- In `docker-compose.yml` luistert de container alleen op `127.0.0.1:3000`;
  zet nginx/Caddy ervoor voor HTTPS (zie A), of verander het naar `"3000:3000"`.
- Gebruik je bind mounts in plaats van volumes, zorg dan dat uid 1000 in die
  mappen mag schrijven.
- Backup van een volume: `docker run --rm -v cola-data:/d -v "$PWD":/b alpine tar czf /b/cola-data.tgz -C /d .`

### C. Railway, Render, Fly.io en vergelijkbaar

Stap-voor-stap: [`RENDER.md`](RENDER.md) (met `render.yaml`) en [`RAILWAY.md`](RAILWAY.md).

- Bouw met de `Dockerfile` (startcommando `node server.js`, geen build-stap). De host zet zelf `PORT`.
- Zet `ADMIN_PASSWORD`, `SITE_URL` en je API-sleutels als variabelen in het dashboard.
- **Koppel een persistente schijf** (Render "Disk", Railway "Volume", Fly
  "Volume") op `/app/data` en zet `DATA_DIR=/app/data` en
  `UPLOADS_DIR=/app/data/uploads`. Op Railway en Render herkent de server de
  host en doet hij dit grotendeels zelf. Zonder schijf ben je bij elke deploy
  alle wijzigingen kwijt.
- Draai **één** instantie (geen autoscaling): de database is een bestand en
  rate limits staan in het geheugen.
- Let op: Weibo blokkeert vaak IP-adressen van cloudproviders. Werkt het
  ophalen niet, gebruik dan de cookie (§4) of een VPS.

---

## 4. Weibo instellen

De server haalt periodiek nieuwe posts op van het Weibo-account van de studio,
laat ze vertalen en zet ze als **Studio Update** op de site.

1. **Zoek het uid.** Open het profiel op `https://m.weibo.cn` — de URL is
   `https://m.weibo.cn/u/1234567890` (of `/profile/1234567890`); dat getal is
   het uid.
2. Ga naar **Admin → Integrations → Weibo** en vul in:
   - **uid**
   - **intervalMinutes** (standaard 15, minimaal 5)
   - **autoPublish**: aan = vertaalde posts komen direct online; uit = ze
     wachten als `pending` tot jij ze publiceert
   - **backfill**: hoeveel posts de allereerste keer geïmporteerd worden
     (standaard 6), zodat de updatespagina niet leeg begint
   - zet **enabled** aan
3. Klik op **Fetch now** (of wacht op de planner) en bekijk het log dat
   terugkomt.

Hoe het werkt (zelfde aanpak als de Weibo→Discord-bot):
eerst een "warm-up" naar het profiel om bezoekerscookies te krijgen, dan de
feed via `m.weibo.cn/api/container/getIndex`, lange posts volledig via
`/statuses/extend`. Emoticons, "网页链接"-links en "全文"-restjes worden
weggehaald. Bij reposts wordt alleen de eigen tekst van de studio gebruikt
(`retweeted: true`); een kale "转发微博" zonder eigen tekst wordt overgeslagen.

Daarna worden alleen posts opgehaald die nieuwer zijn dan de laatst verwerkte
(`lastId`). Een post die je in het admin-paneel verwijdert, komt niet vanzelf
terug. Wil je opnieuw beginnen: zet `lastId` leeg in Integrations, of gebruik
"Fetch now" met `force` = aantal posts.

**Foto's** worden via de server opgehaald (met Weibo als referer, anders
blokkeert Weibo ze) en lokaal bewaard in `data/cache/weibo/`. Op de site staan
ze als `/media/weibo?u=…`, in een lichter formaat (`mw1024`). Lukt een foto
niet, dan probeert de server andere formaten en Weibo-servers (`wx1`/`wx3`/`wx4`).
Na elke import wordt elke foto gecontroleerd: foto's die niet te laden zijn
gaan uit de post, en een post zonder werkende foto's wordt verborgen. Op de
site verdwijnt een foto die toch niet laadt, in plaats van een kapot plaatje.

**Video's worden niet geïmporteerd** (ze laadden traag en Weibo-links verlopen).
Een post met alleen een video wordt overgeslagen; bij de eerste start na deze
update krijgen bestaande posts hun video eruit en worden posts met alleen een
video verborgen. (Wie video's toch wil: `importVideos: true` in de Weibo-config.)

### Oudere posts importeren

De gewone fetch haalt alleen nieuwe posts op. **Admin → Integrations → Weibo →
Import older posts** gaat terug in de tijd (nieuwste eerst) en zet oudere posts
als Studio Updates op de site. Kies een aantal (standaard **100**; het telt
alleen *nieuwe* posts, posts die er al staan worden overgeslagen) en druk op
*Import*. Het draait op de achtergrond — je kunt de pagina sluiten.

- Eerst worden alle posts met hun Chinese tekst opgehaald (± 3 s per pagina van
  10 posts), daarna vertaald (3 tegelijk) en — als *Publish automatically* aan
  staat — gepubliceerd.
- Zonder vertaal-key komen ze binnen als *pending*; later vertaal je ze met
  **Translate waiting posts**, of vink *Publish them straight away, in Chinese* aan.
- De positie wordt bewaard (`db.meta.weiboHistory`): **Import the next 100
  older posts** gaat verder waar de vorige stopte.
- Weibo geeft zonder cookie soms maar een paar pagina's terug; met de cookie
  (hieronder) kom je verder terug.
- Draait alleen op een vaste server (Render, Railway, VPS), niet serverless.

In **Studio updates** staan nieuwe pending posts in het tabblad *Pending*, met
de knop **Publish all**; de lijst laadt per 50. Met de vakjes voor elke post
(of *Select all*) publiceer, verberg of verwijder je er meerdere tegelijk.
Verwijderde Weibo-posts worden onthouden, zodat een gewone fetch ze niet terugzet.

**Alleen posts met foto's.** Standaard (*Only posts with photos*) slaat de
import posts zonder foto over — zowel de gewone fetch als *Import older posts*.

**Opnieuw beginnen (testen).** *Integrations → Weibo → Start over…* vergeet
alles wat al geïmporteerd is (laatste post, positie van *Import older posts*,
lijst met verwijderde posts) en verwijdert desgewenst alle Weibo-posts. Eerst
wordt een snapshot gemaakt. Je eigen studio-posts blijven staan.

### Als Weibo blokkeert (cookie instellen)

Zie je in het log `Could not get valid JSON from Weibo` of
`Weibo returned ok=0`, dan stuurde Weibo een blokkade- of loginpagina in plaats
van data. Het log laat zien wat er precies terugkwam (regels die beginnen met
`attempt 1/3`). Meest voorkomende oorzaak: Weibo blokkeert het IP-adres van een
datacenter. Oplossing: geef de server een ingelogde sessie mee.

1. Log op je eigen computer in op **m.weibo.cn** in de browser.
2. Open de ontwikkelaarstools (**F12**) → tabblad **Network**.
3. Ververs de pagina en klik op het eerste verzoek naar `m.weibo.cn`.
4. Zoek bij **Request Headers** de regel `Cookie:` en kopieer de hele waarde
   erachter (een lange tekst met `SUB=…`, `SUBP=…` erin).
5. Plak die in **Admin → Integrations → Weibo → cookie** (of zet hem als
   `WEIBO_COOKIE`).

Zo'n cookie verloopt na verloop van tijd (meestal weken tot maanden). Stopt het
ophalen ooit opnieuw, dan is dit het eerste om te vernieuwen. Behandel de
cookie als een wachtwoord: hij geeft toegang tot het Weibo-account. Hij staat
alleen in `data/private.json` en wordt nooit naar de browser gestuurd.

Werkt ook dat niet, dan blokkeert Weibo het IP hardnekkig; een VPS bij een
kleinere provider of een machine met een gewoon (consumenten-)IP werkt dan
beter.

---

## 5. Vertaling

Elke nieuwe post wordt naar het Engels vertaald, krijgt een titel in de vorm
`Production update | Heavyweight Hoodie` en een categorie (`production`,
`drop`, `restock`, `studio`, `notice`). Instellen in **Admin → Integrations →
Translation**; met **Test translation** kun je een stukje Chinese tekst
proberen.

| Provider | Wat je nodig hebt | Opmerking |
|---|---|---|
| `anthropic` (standaard) | `ANTHROPIC_API_KEY` (console.anthropic.com) | Beste kwaliteit: vertaling, titel, categorie en gekoppelde producten in één keer. Model instelbaar (standaard `claude-sonnet-5-5`) |
| `deepl` | `DEEPL_API_KEY` | Gratis sleutels eindigen op `:fx` (api-free.deepl.com), betaalde gaan naar api.deepl.com. Vertaalt naar Brits Engels |
| `google` | `GOOGLE_TRANSLATE_API_KEY` | Google Cloud Translation v2 |
| `libre` | `LIBRETRANSLATE_URL` (+ evt. sleutel) | Eigen of publieke LibreTranslate-server |
| `none` | – | Geen vertaling; posts blijven `pending` met de Chinese tekst |

Bij DeepL/Google/Libre maakt de server zelf een titel (eerste zin) en kiest hij
de categorie op trefwoorden (补货 → restock, 上新/预售 → drop,
打样/生产/工厂/面料 → production, 通知/放假 → notice).

Claude krijgt de instructie om rustig en premium te formuleren, trouw te
blijven aan het origineel, niets te verzinnen, alle emoji, @vermeldingen en
hashtag-spam weg te laten, en in titels **alleen** namen uit de eigen Cola
Studio-catalogus of een algemeen producttype te gebruiken — nooit merken van
derden. Emoji worden daarna voor de zekerheid ook nog in code verwijderd.

**Woordenlijst (glossary).** Eén regel per term, `中文=English`:

```
重磅卫衣=Heavyweight Hoodie
毛圈=loopback cotton
大货=bulk production
```

Chinese termen worden vóór het vertalen vervangen (en Claude krijgt de lijst
mee); daarna worden eventuele restanten in de vertaling nog vervangen. Engelse
links-termen (bv. `hoodie=hooded sweatshirt`) worden als hele woorden in de
vertaling vervangen.

**Als vertalen mislukt** (sleutel ontbreekt, API onbereikbaar, onleesbaar
antwoord) wordt de post tóch opgeslagen, met de Chinese tekst, provider
`none` en status `pending`. Los het op en klik in het admin-paneel op
**Retranslate**; lukt dat, dan wordt de post alsnog gepubliceerd (als
autoPublish aan staat).

---

## 6. Weidian (productinfo en voorraad)

De voorraad op de site kan automatisch worden bijgewerkt vanuit Weidian.
Instellen in **Admin → Integrations → Weidian**: kies een **provider**, zet
**enabled** aan en kies een **intervalMinutes** (standaard 10). Per product zet
je in de producteditor `weidian.itemId` (het nummer uit
`weidian.com/item.html?itemID=…`) en **syncEnabled**.

Gebruik altijd eerst:

- **Test** (`itemId` invullen) — laat zien wat Weidian terugstuurt en welke
  SKU's aan welke varianten gekoppeld worden.
- **Sync (dry run)** — laat alle wijzigingen zien zónder iets op te slaan.

**Producten importeren.** *Products → Import / export → Import from Weidian*
maakt van Weidian-links concept-producten (`POST /api/admin/weidian/import`,
10 per verzoek; de admin verdeelt grotere lijsten zelf). Kleur en maat komen
uit de SKU-titels (`黑色;M`, `颜色:黑色;尺码:均码`, `Washed Black / XL`), met
dezelfde aliassen als de sync; titels en Chinese kleurnamen worden vertaald als
er een vertaalprovider is ingesteld. Elke variant krijgt meteen zijn
`weidianSkuId`, dus de sync koppelt daarna zonder giswerk. Foto's lopen via
`/media/img` (cache op het volume). Een bladwijzer-knop in dat venster kopieert
alle productlinks van je eigen winkelpagina. Het voorbeeld wordt pas na
bevestigen opgeslagen, via `POST /api/admin/products/bulk` (met snapshot).

**Weidian-knoppen op de site.** Elk gekoppeld product krijgt op de productpagina
de knop *View on Weidian*. De winkellink voor de blokken op de homepage en de
contactpagina staat in *Settings → Social links → Weidian store* (wordt na een
winkelimport automatisch ingevuld als hij nog leeg is).

**Hele winkel.** Plak je winkellink (`https://shop123.v.weidian.com/?userid=123`):
de server leest alle producten van de winkel (`decorate/shopDetail.tab.getItemList`)
en je vinkt aan welke je wilt. Toeslag-links, regels en producten "in
ontwikkeling" (prijs ≥ ¥50.000) staan standaard uit. Deellinks
(`k.youshop10.com/…`) worden gevolgd naar het product. Producten zonder kleur-
of maatkeuze komen binnen als één variant (OS); de kleur wordt dan uit de titel
gehaald als dat kan. "Onbeperkte" voorraad (999999999) wordt 999.

**Wat de import overneemt.** Per product haalt de server drie bronnen op
(`server/services/weidian-scrape.js`):

1. `getItemSkuInfo` — kleuren, maten, voorraad, prijs, hoofdfoto en kleurfoto's (verplicht);
2. `getDetailDesc` — de beschrijving van de verkoper: tekst en detailfoto's;
3. de productpagina (`weidian.com/item.html`) — de fotogalerij en titel.

Bron 2 en 3 zijn optioneel; lukt er één niet, dan gaat de import gewoon door
(het voorbeeld meldt het). Kleurbolletjes worden uit de kleurnaam afgeleid
(Engels en Chinees, ook samengesteld: "Brick Red", "Haze Blue", "黑白" wordt
tweekleurig); een kleur die je zelf kiest blijft staan. Varianten die geen kleur
zijn ("Default", "Original length") worden op de site als tekstknoppen getoond.
Kleurfoto's krijgen de kleurnaam mee, zodat de site
van foto wisselt als je een kleur kiest. De detailfoto's komen als vierkante
miniaturen onder *Detail photos* op de productpagina (de eerste 12, de rest via
"+N"; klikken vergroot). SKU's die eigenlijk contactgegevens zijn (`微信：…`,
QQ, WhatsApp) worden genegeerd; oudere imports worden bij het opstarten
opgeschoond.

**Beschrijvingen.** Met een Anthropic-key schrijft Claude elke beschrijving in
dezelfde opbouw, uit de tekst van de verkoper:

```
Eén of twee zinnen over wat het is en wat het goed maakt.

**Fabric:** 480 g loopback cotton
**Fit:** Relaxed, dropped shoulders
**Details:** Ribbed cuffs, kangaroo pocket
```

Alleen feiten uit de tekst (geen prijzen, verzending, winkelregels of
"zoals het origineel"), maximaal ± 90 woorden. De originele tekst wordt
bewaard (`descriptionOriginal`), zodat je later opnieuw kunt laten schrijven:
in *Products* producten aanvinken → **Rewrite descriptions**, of in de editor
**Rewrite with Claude** (eerst als voorbeeld). Op de site wordt `**vet**`
vet, een regel die met `- ` begint een opsomming, en de `**Label:**`-regels
een nette lijst. Zonder key worden de regels één voor één vertaald.
De productnaam wordt nooit (deels) vet getoond.

**Maattabel.** Staat er een Anthropic-key (Integrations → Translation, of
`ANTHROPIC_API_KEY`), dan zoekt Claude de maattabel tussen de detailfoto's,
leest hem uit en vult de maattabel van het product (kolommen in het Engels,
maten zoals de site ze gebruikt). Staat de tabel er, dan wordt de foto niet
meer op de site getoond; alleen zonder tabel staat de foto bij *Size & fit*.
Kosten: ongeveer 1–3 cent per product. Zonder key markeer je de
maattabel zelf in de editor (*Images → Detail photos → Size chart?*).

**Als Weidian de server blokkeert** (HTTP 403/429, captcha): elke aanvraag
probeert eerst direct, dan via de *Scraping service* (`fetchVia`, env
`WEIDIAN_FETCH_VIA`, bv. `https://api.scraperapi.com/?api_key=KEY&url={url}`)
en daarna — alleen bij importeren, nooit bij de voorraad-sync — via Claude's
*web fetch* met je eigen Anthropic-key (`claudeFetch`, standaard aan). Dan doet
Anthropic het verzoek, dus een geblokkeerd server-IP maakt niet uit. **Test
item** (links of item-ID) laat per bron zien wat er binnenkwam en via welke weg.

Pas als dat klopt, laat je de echte sync (of de planner) zijn werk doen. Elke
wijziging komt als `inventoryEvent` (bron `weidian`) in de live-stock-ticker.
Bezoekers zien alleen de status (*In stock*, *Low stock*, *Sold out*, *Pre-order*),
nooit aantallen; de aantallen staan alleen in de admin.
Bij herhaalde fouten wacht de planner steeds langer (exponentiële backoff), en
tussen artikelen zit een pauze (`delayMs`, standaard 1,5 s) om Weidian niet te
belasten.

### Providers

| Provider | Uitleg |
|---|---|
| `public-item` (standaard) | Leest de openbare artikelpagina-data van Weidian (`thor.weidian.com/detail/getItemSkuInfo`). **Onofficieel**: het formaat is niet gegarandeerd. De server zoekt daarom flexibel naar SKU-lijsten (velden als id/skuId, title, stock/quantity, price in fen of yuan). Controleer met **Test** of het bij jouw artikelen klopt. De URL is aanpasbaar (`itemUrlTemplate`, met `{param}` of `{itemId}`) |
| `open-api` | Officieel Weidian Open Platform. Je hebt een ontwikkelaarsaccount nodig met `appKey` + `appSecret` (of een vaste `accessToken`). De server haalt zelf een token op en bewaart het tot het verloopt. **Controleer in je Weidian-ontwikkelaarsconsole** welke methode en versie voor artikelinformatie gelden; standaard `vdian.item.get` versie `1.0` via `https://api.vdian.com/api` — alle drie aanpasbaar (`apiMethod`, `apiVersion`, `apiUrl`, `tokenUrl`) |
| `json-feed` | Je eigen bron: een URL (`feedUrl`) die JSON of CSV teruggeeft. Ideaal met een Google Sheet (Bestand → Delen → Publiceren op internet → CSV) of een eigen script |
| `mock` | Nep-voorraad die voorspelbaar op en neer gaat — om de live-stock-pagina te demonstreren |

**Feed-formaat** (`json-feed`). Elke rij verwijst naar een product via
`productId` (bv. `cs-001`), `slug` of Weidian `itemId`, en naar een variant via
`sku`, `weidianSkuId`, of `color` + `size`:

```csv
productId,sku,stock
cs-001,CS001-CLAY-M,4
cs-001,CS001-CLAY-L,0
```

```json
[
  { "slug": "heavyweight-hoodie", "color": "Washed Black", "size": "L", "stock": 3 },
  { "itemId": "7781234567", "weidianSkuId": "90001", "stock": 7 }
]
```

(Scheidingsteken `,` `;` of tab; Nederlandse kolomnamen `kleur`, `maat`,
`voorraad` werken ook. De feed geldt voor alle producten die erin genoemd
worden, ook zonder syncEnabled.)

### Hoe SKU's aan varianten gekoppeld worden

Per Weidian-SKU, in deze volgorde:

1. **`weidianSkuId`** van de variant is gelijk aan het SKU-id van Weidian;
2. **exacte SKU** (bv. de merchant code `CS001-CLAY-M`);
3. **kleur en maat uit de SKU-titel**: `黑色;M`, `Washed Black / XL`,
   `Off-White-L`, `颜色:黑色;尺码:均码` … De server probeert de mogelijke
   splitsingen en kiest alleen een variant als die eenduidig is. Heeft een
   product maar één kleur (of één maat), dan is de maat (of kleur) genoeg.

Met **aliassen** vertaal je Weidian-benamingen naar die van de site:

```json
"sizeAliases":  { "均码": "OS", "2XL": "XXL", "加大": "XL" },
"colorAliases": { "黑色": "Washed Black", "陶土色": "Clay" }
```

Een aantal gangbare aliassen (均码 → OS, 2XL → XXL, 黑色 → Black …) zit er
standaard in. Wordt een variant via de titel gevonden, dan onthoudt de server
het Weidian-SKU-id in `weidianSkuId`, zodat de koppeling daarna direct is.
SKU's die nergens bij passen staan in `unmatched` in het sync-resultaat.

**Productinfo.** Standaard wordt alleen de voorraad gesynchroniseerd. Zet je
`weidian.syncInfo: true` op een product, dan neemt de sync ook de prijs (CNY)
over, de Weidian-titel (als referentie in `weidian.title`) en foto's (alleen
als het product nog geen foto's heeft). Prijzen van `public-item` zijn meestal
in fen (centen); `priceUnit` (`auto`/`cent`/`yuan`) stuurt dat bij.

---

## 7. Vindbaarheid (SEO)

De server schrijft voor elke pagina de zoekmachine-gegevens zelf
(`server/lib/seo.js`):

- titel, beschrijving, `robots`, canonieke URL (vanaf `SITE_URL`), Open Graph
  en Twitter-kaart (met productfoto of postfoto waar dat kan);
- één JSON-LD-graaf: Organization (met je socials, e-mail en WhatsApp),
  WebSite (met zoekfunctie), WebPage + BreadcrumbList, en per pagina Product,
  ItemList (shop en categorieën), FAQPage, Blog en BlogPosting;
- echte inhoud in de HTML (`<!--ssr:…-->`-blokken): de productlijst met links,
  productnaam, prijs en beschrijving, de laatste updates, de FAQ en de
  verzendtabel — zoekmachines en linkvoorbeelden zien dat zonder JavaScript;
- elke Studio Update heeft een eigen pagina: `/updates/<id>`, plus RSS op
  `/updates/feed.xml`;
- `sitemap.xml` met pagina's, categorieën, producten (met foto's) en updates;
  `robots.txt` laat `/api` crawlbaar (Google heeft het nodig om de pagina's te
  renderen) en sluit alleen `/admin`, `/api/admin` en `/order` uit;
- `products.html`, `about.html` … sturen met een 301 door naar `/products`,
  `/about` …, zodat elke pagina één adres heeft;
- demoproducten en demoposts krijgen `noindex` en staan niet in de sitemap.

Teksten aanpassen: **Settings → SEO** (homepage, elke pagina apart, deelfoto,
Google Search Console- en Bing-code) en per product in de editor (*Story &
details → Search engines*). Leeg = de ingebouwde tekst. De paginafragmenten
staan in `tools/pages/`; na een wijziging `npm run build:pages`.

**Deelafbeeldingen.** Elke pagina heeft een eigen Open Graph-afbeelding
(`public/assets/brand/og/<pagina>.png`, 1200×630, in de huisstijl). Product-
en Studio-updatepagina's gebruiken hun eigen foto. De deelfoto uit
*Settings → SEO* vervangt die van de homepage. Teksten van de afbeeldingen
aanpassen: `tools/build-og.js`, daarna `node tools/build-og.js` (heeft
Playwright nodig).

---

## 8. Overig

**Wisselkoersen.** Als `settings.currency.autoUpdate` aan staat, haalt de
server één keer per dag de koersen op bij open.er-api.com (basis CNY), alleen
voor de valuta in `settings.currency.available`. Mislukt dat, dan blijven de
laatste koersen gewoon staan.

**Backups.**

- Automatisch: elke dag een kopie van `db.json` in `data/backups/`; de
  nieuwste 10 blijven bewaard. Vóór elke import wordt ook een snapshot gemaakt.
- Handmatig: **Admin → Export** downloadt een volledige backup (zonder
  geheimen). **Import** zet zo'n bestand terug.
- Volledige verhuizing naar een andere server: kopieer de hele map `data/`
  (inclusief `private.json`) en `public/uploads/`.
- Terugzetten van een automatische backup: stop de server, kopieer
  `data/backups/db-JJJJ-MM-DD.json` naar `data/db.json`, start de server.

**Logs.** De laatste 300 regels staan in **Admin → Logs**
(`/api/admin/logs`); alles gaat ook naar de console (PM2/journalctl/docker logs).

**SEO.** De server zet op elke productpagina de juiste `<title>`,
beschrijving, Open Graph-tags, canonical-link en gestructureerde data
(Product-schema met prijs in CNY en beschikbaarheid). `/sitemap.xml` en
`/robots.txt` worden automatisch gemaakt (admin en API zijn uitgesloten).

---

## 9. Bekende beperkingen

- **Weibo heeft geen officiële publieke API.** `m.weibo.cn` kan zijn
  structuur veranderen of IP-adressen van datacenters (AWS, Google Cloud,
  DigitalOcean, Hetzner, Railway, Render …) blokkeren. Dan helpt de cookie
  (§4) of een server met een ander IP.
- Per keer wordt de eerste pagina van de feed gelezen (± 10 posts). Plaatst de
  studio er meer tussen twee controles, dan kunnen de oudste ontbreken — met
  een interval van 15 minuten is dat in de praktijk geen probleem.
- Weibo-video's worden niet geïmporteerd (zie §4).
- **Het Weidian `public-item`-endpoint is onofficieel** en kan veranderen of
  extra beveiliging krijgen. Controleer het met **Test**; werkt het niet meer,
  stap dan over op `open-api` of `json-feed`. Methodenamen van de Open API
  moeten in je eigen ontwikkelaarsconsole gecontroleerd worden.
- Eén serverproces: de JSON-database is bedoeld voor een catalogus van
  honderden producten en duizenden voorraadgebeurtenissen, niet voor meerdere
  servers tegelijk.
- Geüploade foto's worden niet verkleind (geen beeldbibliotheken). Upload
  web-formaat (bv. max. 2000 px, webp of jpg).
- Bestellingen zijn "order intents" voor het dashboard; de klant rondt af via
  WhatsApp of een agent. Er is geen betaling of automatische voorraadafboeking.

---

## 10. Problemen oplossen

| Symptoom | Oplossing |
|---|---|
| Admin-login geeft "ADMIN_PASSWORD is not configured" | `NODE_ENV=production` zonder wachtwoord: zet `ADMIN_PASSWORD` en herstart |
| Ingelogd, maar ineens "Unauthorized" | token verlopen (7 dagen) of wachtwoord/`SESSION_SECRET` gewijzigd: opnieuw inloggen |
| `Too many login attempts` | 10 foute pogingen in 15 minuten; even wachten (of server herstarten) |
| Weibo: `Could not get valid JSON` | IP geblokkeerd of login vereist → cookie instellen (§4) |
| Weibo: posts blijven `pending` | vertaling mislukt (sleutel?) of autoPublish uit → **Retranslate** of handmatig publiceren |
| Weidian: alles `unmatched` | kleur-/maatnamen verschillen → aliassen toevoegen of `weidianSkuId` per variant invullen |
| Upload "File too large" via nginx (413) | `client_max_body_size 64m;` in nginx |
| Alle bezoekers delen één rate limit | proxy-IP wordt niet doorgegeven: `proxy_set_header X-Real-IP $remote_addr;` in nginx, of `TRUST_PROXY=true` |
| Wijzigingen in CSS/JS niet zichtbaar | browsercache (7 dagen voor `/assets`): voeg `?v=2` toe aan de link of verlaag `ASSET_MAX_AGE` |
