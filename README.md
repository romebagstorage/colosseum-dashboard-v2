# Colosseum Holidays — Dashboard V2 (Guesty-native)

Copia della dashboard V1 che legge i dati **direttamente da Guesty Open API** invece che dai 5 fogli contabilità.
Solo KPI operativi (prenotazioni, notti, ricavi, netto OTA, tassa di soggiorno, occupazione, ADR, mix canali, ospiti, forward booking).
Costi e utile non sono in Guesty → restano nei fogli / dashboard V1. Storico dal 2025 (prima Guesty non ha dati completi).

## Come funziona
- `lib/guesty.js` — OAuth client_credentials + fetch paginato prenotazioni (filtro data di check-out locale) + formule monetarie identiche al Guesty Sync Apps Script (Lordi, Pagamento totale, Netto, Tassa soggiorno, canale).
  Dal 17/11/2026 legge `GET /reservations-reports/reservations/search` (la vecchia `GET /reservations` si spegne il 01/03/2027; `GUESTY_API=legacy` la riattiva fino a quella data). Ogni riga è riportata alla forma legacy da `toLegacyShape`.
  Unico campo che la nuova API non dà: `money.transientOccupancyTax` (tassa di soggiorno incassata da Airbnb). Per le prenotazioni concluse prima del 17/11/2026 vale il valore storico in `config/tassa-airbnb-storica.js`; per le altre la regola di Roma (6 € × ospiti × notti, max 10 notti).
  Confronto vecchia/nuova: `node scripts/confronta-api.mjs scarica` poi `confronta` (17/11/2026: 1509 prenotazioni, payload identico salvo 3 soggiorni Airbnb di dicembre 2026 con bambini esentati, +96 € di tassa, ricavi e netto invariati).
- `lib/kpi.js` — KPI mensili con prorata per notti di competenza (una prenotazione a cavallo di mese viene divisa fra i due mesi).
- `lib/payload.js` — costruisce il JSON nella stessa forma della V1 + cache server 10 minuti.
- `app/api/data/route.js` — endpoint (`?refresh=1` forza il refresh).
- Frontend: copia della V1 senza pannelli costi/utile.

## Scheda «Canali» (19/11/2026)
Misura, simulatore «Parità OTA» e avvisi per Airbnb, Booking e diretto.
- `lib/canali.js` — misura dalle prenotazioni di `/api/data`: per casa, portale e mese, notti, «paga l'ospite» (Pagamento totale − tassa = Ricavi), «ti arriva» (Netto) e quota netto/pagato. Le notti a cavallo di due mesi si dividono come in `lib/kpi.js`, quindi i totali coincidono con la Panoramica (la scheda lo controlla e lo scrive). Gruppi: Airbnb, Booking, «Diretto, a mano e partner» (Diretto + OFFLINE + Partner), altri portali.
- `lib/parita.js` + `config/parita.js` — il simulatore, porting dell'artifact «Parità OTA Colosseum» (https://claude.ai/artifact/1RVYJMk92HFC9LJ98HaH5j). Stessi dati di partenza (letti il 19/11/2026) e stesse formule: confrontate su 301 scenari, scarto zero; i 4 controlli sulle prenotazioni vere tornano entro 1 centesimo. Se cambia una formula, va cambiata in tutti e due. Se cambia un dato vero (un ricarico in Guesty), si cambia in `config/parita.js`.
- `app/api/canali/config` — le configurazioni del simulatore stanno sul server, nello stesso Edge Config del gettone Guesty (`lib/store.js`), chiave `parita_canali`, in forma compatta (circa 0,7 KB l'una; tetto 6 KB, al massimo 3 salvate con nome). Si scrive solo premendo «Salva». Senza Edge Config la scheda funziona lo stesso ma non salva (lo dice).
- Avvisi: un portale più lontano di 3 punti dall'obiettivo nel simulatore (il diretto solo se scende sotto); la quota netto/pagato di Airbnb o del diretto che nell'ultimo mese chiuso si sposta di più di 3 punti rispetto ai tre mesi prima (almeno 10 notti). Soglie in `config/parita.js` (`PARITA_SOGLIE`). Il numero degli avvisi sulle prenotazioni vere compare accanto al nome della scheda.
- **Limiti noti**: il netto Booking è calcolato con la commissione misurata per casa (`bookingCommission` in `config/houses.js`, dal 19/11/2026: 24,5% Poliziano, Bilocale, Trilocale; 19,5% Marco Aurelio, Prestige; prima era il 23,79% per tutte, come nel foglio C.ECONOMICO). Vale per tutto lo storico: da quel giorno il netto Booking della V2 non coincide più con il C.ECONOMICO, che usa ancora il 23,79%. Trip.com e Agoda escono al 100% di quota: versano già il netto (Alberto, 19/11/2026), quindi «pagato» è quello che si riceve. Quanto arriva su 100 € di PriceLabs, misurato, richiederebbe i prezzi PriceLabs del giorno della prenotazione, che fino al 19/11/2026 non si conservavano (vedi sotto).

## Prezzi PriceLabs ogni giorno (dal 19/11/2026)
PriceLabs mostra solo i prezzi di oggi. Ogni mattina alle 5:00 UTC (6:00 d'inverno, 7:00 d'estate a Roma) il cron di Vercel (`vercel.json`) chiama `GET /api/pricelabs/salva`, che:
- legge da PriceLabs Customer API `/v1/listings` (minimo, base, massimo, ultima sincronizzazione) e `/v1/listing_prices` (prezzi dei prossimi 365 giorni) delle 5 case: 2 richieste al giorno, nessuna scrittura su PriceLabs;
- salva il file `prezzi-pricelabs/AAAA-MM-GG.json` nello spazio **Vercel Blob privato** `prezzi-pricelabs` (circa 120 KB al giorno, 44 MB l'anno). Se si rilancia nello stesso giorno, il file viene riscritto.
- Il file sta in colonne: `colonne` = `date, price, user_price, booked_price, uncustomized_price, min_stay, booking_status, unbookable, check_in, check_out, demand_desc`; `case.MA.giorni` = una riga per data. `price` è il consiglio di PriceLabs, `user_price` l'ultimo prezzo visto su Guesty (−1 = data non disponibile), prima del ricarico dei portali.
- Le case si riconoscono come le prenotazioni (`houseIdForReservation`: id Guesty per Bilocale e Trilocale, nome per le altre). In `avvisi` finiscono annunci non riconosciuti, case senza prezzi e gli errori di PriceLabs (es. `LISTING_TOGGLE_OFF`).
- Il registro di Vercel scrive `[pricelabs] salvata …` o `[pricelabs] errore …`.
- Chi la chiama: il cron, con `Authorization: Bearer <CRON_SECRET>`, oppure chiunque abbia fatto il login (aprendo l'indirizzo nel browser). `middleware.js` la lascia passare senza login apposta: il controllo è nella rotta.
- Prova in locale senza chiave vera né Blob: `PRICELABS_BASE_URL` (un PriceLabs finto) e `PREZZI_DIR` (una cartella) valgono solo fuori da Vercel.
- Per ora nessuna scheda li mostra: servono a misurare, più avanti, quanto arriva su 100 € di PriceLabs e come si muovono i prezzi avvicinandosi alla data.

## Chekin, controllo degli arrivi (dal 20/11/2026)
`GET /api/chekin/arrivi` (da loggati) è il controllo dell'agente 8 «Arrivi e conformità» del giro del mattino (`lib/chekin.js`, `controllaArrivi`). Legge da Chekin tutte le prenotazioni di ogni casa, pagina per pagina, perché il filtro per data di Chekin non viene applicato. Le incrocia con Guesty (`getPayload`: confermate per codice o per casa e date, cancellate per casa e date) e restituisce:
- `arrivi`: arrivi da oggi a fra 7 giorni con ospiti attesi e registrati, registrazione, Questura (Alloggiati Web), ISTAT e tassa di soggiorno;
- `arretrati`: arrivi degli ultimi 30 giorni con Questura, ISTAT o tassa non a posto;
- `allarmi`: Questura non inviata dopo l'arrivo, o in errore;
- `da_guardare`: ospiti non registrati con arrivo oggi o domani, ISTAT o tassa in sospeso dopo l'arrivo, prenotazioni presenti solo in Chekin o solo in Guesty.

Sono a posto i valori `COMPLETE`, `NOT_USED` ed `EXCLUDED`. Le prenotazioni cancellate in Guesty non contano. Niente nomi, email, telefoni o documenti: solo sigla della casa, codice, date, conteggi e stati. Nel registro di Vercel resta una riga di conteggi con «[chekin-arrivi]».

## Chekin, prova (dal 20/11/2026)
`GET /api/chekin/prova` (da loggati) entra in Chekin con `CHEKIN_API_KEY` e dice com'è fatta l'API, senza dati personali. Usa l'API pubblica documentata su https://chekin.gitbook.io/chekin-public-api: base `https://a.chekin.io/public/api/v1`, la chiave si scambia con `POST /auth/api-key/` (token di 1 ora, intestazione `JWT <token>`). Restituisce le case con il loro id, le prenotazioni con arrivo nei prossimi 7 giorni (solo casa, date, origine e stati), una prenotazione singola e gli ospiti di un gruppo, di cui mostra solo i nomi dei campi e i valori di stati, date, conteggi e identificativi (`lib/chekin.js`, funzione `forma`). Nomi, email, telefoni, documenti, link e date di nascita restano `‹string›`. Lo stesso JSON va nel registro di Vercel a pezzi da 3.000 caratteri, con «[chekin-prova]». Serve per scrivere il controllo degli arrivi del Guardiano. Non cambia niente su Chekin. In locale `CHEKIN_BASE_URL` punta a un Chekin finto (solo fuori da Vercel). Nota: la prima versione provava `https://a.chekin.io/api/v3`, dove `/token/` vuole email e password e non la chiave (prova del 20/11/2026).

## Configurazione (per replicare su un altro account)
- `config/houses.js` — elenco strutture (id, nome, colore, regola di matching listingId/titolo) + `START_YEAR`.
- `config/brand.js` — nome, colori, font, loghi (file in `public/brand/`).
- Formule per canale: `lib/guesty.js` (`calcPagamentoTotale`, `calcNetto`, `CANALE_MAP`).
- Brand attuale: token CSS di colosseumholidays.com (green-700 #556b58, brass-600 #b39e73, cream-50 #faf6ee; Playfair Display + Roboto).

## Versione di Next.js
Dal 20/11/2026 **Next.js 15.5.29 e React 19.2.9** (prima Next 14.2.35 e React 18.3.1). `npm audit`: 0 avvisi (con la 14 erano 8, uno critico).
- `react-chartjs-2` 5.3.1 (la 5.2.0 non dichiarava React 19); `chart.js` resta 4.4.4, quindi i grafici sono gli stessi.
- `overrides` nel `package.json`: `postcss` 8.5.32 (anche la copia interna di Next, che era la 8.4.31), `postcss-selector-parser` 6.1.5, `source-map-js` 1.2.2, `zod` 4.6.7 (dentro `@vercel/blob` → `@vercel/oidc`). Servono solo a chiudere avvisi di npm su librerie di terzi; quando quelle librerie si aggiornano da sole si possono togliere (e `npm audit` dice se tornano).
- `next.config.js`: `outputFileTracingIncludes` è uscito da `experimental` (Next 15).
- Il codice dell'app non è cambiato. Le rotte leggono cookie e intestazioni da `request` (non da `cookies()`/`headers()` di `next/headers`, che in Next 15 diventano asincroni), e così `middleware.js`. Le rotte GET hanno già `dynamic = 'force-dynamic'` e ogni `fetch` verso Guesty, Edge Config e PriceLabs ha `cache: 'no-store'`, quindi il cambio dei default di cache della 15 non le tocca. `unstable_cache` (payload 10 minuti, gettone Guesty 23 ore) funziona come prima.
- Provata il 20/11/2026 in una copia con server in UTC e dati finti (`scripts/prova-finta`): build senza avvisi; le 7 schede senza errori in console, nessun errore di idratazione (418/423/425) con il browser in ora italiana; login, password errata, «Esci»; «Ricarica dati»; salvataggio del simulatore «Canali»; cache del payload (la seconda richiesta non chiama Guesty, `?refresh=1` sì); `/api/pricelabs/salva` risponde 401 senza login o con un segreto sbagliato, salva col cron e col login, e con PriceLabs spento dà errore invece di una risposta vecchia.
- Next 16 esiste già ma chiede altri cambi: non serve finché la 15.5 riceve correzioni di sicurezza (`npm audit` lo dice).

## Prove in locale con dati finti
`npx next build`, poi `bash scripts/prova-finta/avvia.sh` → http://localhost:3311 (stampa la password di prova e il comando del cron). Server in UTC come su Vercel; Guesty (618 prenotazioni inventate), Edge Config e PriceLabs sono finti, nessuna chiave vera e nessun gettone Guesty; i prezzi vanno in una cartella temporanea. `scripts/` non va su Vercel (`.vercelignore`).

## Env var (Vercel)
`GUESTY_CLIENT_ID`, `GUESTY_CLIENT_SECRET`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`
Per i prezzi PriceLabs (solo Production): `PRICELABS_API_KEY` (PriceLabs → Account Settings → API Details), `CRON_SECRET` (almeno 16 caratteri a caso) e lo spazio Blob `prezzi-pricelabs` collegato al progetto (Vercel aggiunge da solo le sue variabili).
Per Chekin (solo Production): `CHEKIN_API_KEY` (aggiunta da Alberto il 20/11/2026).

## Validazione
`npm run validate` (con le env Guesty) confronta Marco Aurelio 2026 con il C.ECONOMICO: TOT/Ricavi/Netto/Pren identici gen–ago (differenze ±1-2 € da prorata).

## Deploy
Progetto Vercel `colosseum-dashboard-v2` (prj_RG5QdaDniWszevQRxsiCPqiaG0jL) → https://v2.dashboard.colosseumholidays.com (CNAME Bluehost `v2.dashboard` → cname.vercel-dns.com; alias tecnico https://colosseum-dashboard-v2.vercel.app). Switch V1/V2 nell'header di entrambe (`VersionTabs` in components/Dashboard.js).
Da questa cartella: `vercel deploy --prod --token <token>` (token Vercel scope Full Account).

## Robustezza (audit 2026-09-30)
- Token Guesty: memoria istanza → store condiviso Vercel Edge Config (`lib/store.js`, env `EDGE_CONFIG`, `EDGE_CONFIG_ID`, `VERCEL_API_TOKEN`) → Data Cache → richiesta a Guesty. Budget interno 3 token/giorno (`MAX_TOKEN_REQUESTS_PER_DAY`), blocco condiviso su 429 (`guesty_token_blocked_until`) così nessuna istanza insiste.
- Paginazione verificata contro `count` di Guesty (errore se incompleta) → in quel caso si serve l'ultimo payload valido (`_cache: 'stale'`, banner in UI).
- `warnings` nel payload (canali senza regola di netto, prenotazioni non attribuite) mostrati in UI.
- Lead time: `createdAt` non affidabile per prenotazioni importate in blocco (≥10 create lo stesso giorno) o create dopo il check-in → escluse dal lead time.
- Lordi = max(totalPaid, hostPayout) (vedi nota in `lib/guesty.js`). Sanity check tassa di soggiorno.
- Date/mese corrente in Europe/Rome.

## Attenzione: limite token Guesty
Guesty concede **5 richieste di token OAuth al giorno** per client. La V2 ne usa 1 al giorno (token nella Vercel Data Cache per 23h),
ma gli Apps Script (Guesty Sync, Contabilità, Reminder scontrino) ne consumano altri a ogni esecuzione: non aggiungere altri processi
che chiedono token, o consolidare i token in cache su PropertiesService lato Apps Script.
