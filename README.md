# ✈️ Monitor Zboruri

Aplicație personală, **100% gratuită**, care urmărește zilnic prețurile biletelor de avion dus-întors
și îți trimite o notificare pe telefon când prețul scade sub pragul tău.

- **GitHub Actions** caută prețurile în fiecare dimineață (fără server propriu).
- **GitHub Pages** găzduiește aplicația, pe care o instalezi pe telefon ca pe o aplicație normală.
- **SerpApi (Google Flights)** furnizează prețurile. Planul gratuit are 250 de căutări pe lună.
- **Notificări** prin Web Push (în aplicație) și, ca rezervă, prin **ntfy.sh**.

---

## Cuprins

1. [Cum funcționează](#1-cum-funcționează)
2. [Instalare pas cu pas](#2-instalare-pas-cu-pas)
3. [Bugetul de căutări](#3-bugetul-de-căutări)
   - [Căutare rapidă (o singură dată, cu parolă)](#căutare-rapidă-o-singură-dată-cu-parolă)
4. [Test local fără credite (`--dry-run`)](#4-test-local-fără-credite---dry-run)
5. [Editarea manuală a alertelor](#5-editarea-manuală-a-alertelor)
6. [Personalizare (aeroporturi, destinații, companii)](#6-personalizare)
7. [Securitate și riscuri](#7-securitate-și-riscuri)
8. [Probleme frecvente](#8-probleme-frecvente)
9. [Structura fișierelor](#9-structura-fișierelor)

---

## 1. Cum funcționează

```
 Telefon (aplicația)                GitHub (repository-ul tău)                  Internet
 ───────────────────                ──────────────────────────                  ────────
 Creezi o alertă  ──(token)──►  data/alerts.json se modifică
                                        │
                                        ▼
                              GitHub Actions pornește scriptul  ──►  SerpApi / Google Flights
                              Python (zilnic + la fiecare                (1 căutare / combinație)
                              modificare a alertelor)
                                        │
                                        ▼
                              Salvează data/results/*.json
                              și data/history/*.json (commit)
                                        │
 Vezi prețuri, grafice  ◄──  GitHub Pages publică datele
 Primești notificare    ◄──  Web Push / ntfy (dacă prețul ≤ prag)
```

**O „combinație”** înseamnă o zi de plecare + un număr de nopți. Exemplu: plecare pe 12 noiembrie
cu 4 sau 5 nopți, plus plecare pe 13 noiembrie cu 3 nopți, înseamnă **3 combinații**, deci **3 căutări pe zi**.
Fiecare căutare verifică toate aeroporturile de plecare alese deodată.

**Notificările:**
- Când cel mai mic preț dintr-o combinație este ≤ prețul maxim, primești o notificare cu combinația,
  prețul, compania, orele și linkul Google Flights.
- Cât timp prețul rămâne sub prag, primești **în fiecare zi** un rezumat actualizat.
- Pentru cea mai ieftină cursă sub prag, scriptul face **o căutare în plus** ca să afle și zborul de
  întoarcere (companie, oră). Google Flights cere o căutare separată pentru întoarcere.

---

## 2. Instalare pas cu pas

Ai nevoie de: un cont GitHub (gratuit), un cont SerpApi (gratuit), un telefon și aproximativ 30 de minute.

### Pasul 1 – Creează repository-ul

1. Intră pe <https://github.com/new>.
2. **Repository name**: de exemplu `zboruri`.
3. Alege **Public**. Pe planul gratuit, GitHub Pages funcționează doar cu repository-uri publice.
   Nicio cheie secretă nu stă în cod: toate stau în *Secrets*, care nu sunt publice.
4. Apasă **Create repository**.
5. Urcă fișierele proiectului. Cea mai simplă variantă, din terminal, în folderul proiectului:
   ```bash
   git remote add origin https://github.com/NUMELE-TAU/zboruri.git
   git add .
   git commit -m "Prima versiune"
   git push -u origin main
   ```
   Alternativ, folosește [GitHub Desktop](https://desktop.github.com/) sau butonul
   **Add file → Upload files** de pe pagina repository-ului. Verifică să urce și folderele
   `.github` și `data`, plus fișierul `.nojekyll`.

### Pasul 2 – Verifică GitHub Actions

1. În repository: **Settings → Actions → General**.
2. La **Actions permissions**: „Allow all actions and reusable workflows”.
3. La **Workflow permissions**: alege **Read and write permissions** și apasă **Save**.
   Robotul are nevoie de ele ca să salveze rezultatele.

### Pasul 3 – Activează GitHub Pages

1. **Settings → Pages**.
2. **Source**: „Deploy from a branch”.
3. **Branch**: `main`, folder `/ (root)`, apoi **Save**.
4. După 1–2 minute, aplicația este la adresa `https://NUMELE-TAU.github.io/zboruri/`
   (o vezi sus, pe pagina Pages).

### Pasul 4 – Obține cheia SerpApi

1. Creează un cont pe <https://serpapi.com/users/sign_up> și alege planul **Free** (250 căutări/lună).
2. Cheia o găsești la <https://serpapi.com/manage-api-key>. Copiaz-o, îți trebuie la pasul 6.

> Verificarea creditelor rămase (SerpApi *Account API*) este gratuită și nu consumă din cele 250 de căutări.
> Scriptul o face înainte de fiecare rulare.

### Pasul 5 – Generează cheile VAPID (pentru notificări)

Cheile VAPID „semnează” notificările, ca telefonul să știe că vin de la tine. Le generezi o singură dată.

**Varianta A, din aplicație (cea mai simplă):**
1. Deschide aplicația (adresa de la pasul 3) → **Setări** → secțiunea **3. Chei VAPID** → „Generează chei noi”.
2. Copiază **cheia publică** și **cheia privată**.

**Varianta B, din terminal:**
```bash
pip install cryptography
python tools/genereaza_chei_vapid.py
```

Apoi:
- Pune **cheia publică** în fișierul `config/settings.json`, la `"vapid_public_key"`. Editezi fișierul
  direct pe GitHub (creionul ✏️ → *Commit changes*). Cheia publică nu e secretă, aplicația are nevoie de ea.
  Dacă ai adăugat deja tokenul (pasul 7), butonul „Salvează în config/settings.json” din aplicație face asta automat.
- **Cheia privată** merge **doar** în GitHub Secrets (pasul 6). Nu o pune nicăieri altundeva.
- Opțional, în `config/settings.json` schimbă `"vapid_subject"` într-o adresă de email de contact
  (`mailto:...`). Atenție: fișierul e public.

### Pasul 6 – Adaugă secretele (GitHub Secrets)

În repository: **Settings → Secrets and variables → Actions → New repository secret**. Adaugă, pe rând:

| Nume secret          | Ce pui în el                                                   | Obligatoriu? |
|----------------------|----------------------------------------------------------------|--------------|
| `SERPAPI_KEY`        | cheia SerpApi (pasul 4)                                        | **Da**       |
| `VAPID_PRIVATE_KEY`  | cheia VAPID privată (pasul 5)                                  | pentru Web Push |
| `VAPID_PUBLIC_KEY`   | cheia VAPID publică (pasul 5), folosită pentru verificare      | recomandat   |
| `PUSH_SUBSCRIPTION`  | abonamentul telefonului (pasul 9)                              | pentru Web Push |
| `NTFY_TOPIC`         | numele topicului ntfy (pasul 10)                               | opțional     |
| `SEARCH_PASSWORD`    | parola pentru căutarea rapidă (12+ caractere, inventată de tine) | pentru căutare rapidă |

### Pasul 7 – Creează tokenul GitHub (ca să salvezi alerte din aplicație)

Tokenul permite aplicației de pe telefon să modifice fișierul cu alerte. Îl faci **cât mai restrâns**:

1. Intră pe <https://github.com/settings/personal-access-tokens/new> (token *fine-grained*).
2. **Token name**: `zboruri-telefon`.
3. **Expiration**: de exemplu 90 de zile. Când expiră, faci altul.
4. **Repository access**: „Only select repositories” și alegi **doar** repository-ul `zboruri`.
5. **Permissions → Repository permissions → Contents**: **Read and write**. Nu bifa nimic altceva
   („Metadata: Read” se adaugă automat).
6. **Generate token**, apoi copiază tokenul (începe cu `github_pat_`).
7. În aplicație: **Setări → 1. Repository GitHub**. Completează `NUMELE-TAU/zboruri` și tokenul, apoi
   apasă **Salvează și testează**. Trebuie să apară „✓ Conectat”.

**Riscuri:** tokenul este păstrat doar în memoria aplicației de pe acest telefon. Cine are acces la telefonul
tău deblocat îl poate folosi, dar doar pentru a modifica fișierele *acestui* repository. Dacă pierzi telefonul,
revocă tokenul din <https://github.com/settings/personal-access-tokens>.

Nu vrei token? Poți edita alertele direct pe GitHub (secțiunea [5](#5-editarea-manuală-a-alertelor)).
Aplicația îți pregătește textul de copiat.

### Pasul 8 – Instalează aplicația pe telefon

**Android (Chrome):**
1. Deschide adresa aplicației în Chrome.
2. Meniul **⋮** → **Instalează aplicația** (sau „Adaugă pe ecranul de pornire”).

**iPhone (Safari, iOS 16.4 sau mai nou):**
1. Deschide adresa aplicației în **Safari** (nu în Chrome, pe iPhone contează).
2. Butonul **Share** (pătratul cu săgeată) → **Adaugă pe ecranul principal**.
3. Deschide aplicația **de pe ecranul principal**. Doar așa funcționează notificările pe iPhone.

### Pasul 9 – Activează notificările Web Push

1. În aplicația instalată: **Setări → 2. Notificări** → **Activează notificările** → permite.
2. Apare un text (JSON) care începe cu `{"endpoint":...`. Apasă **Copiază abonamentul**.
3. Pe GitHub: **Settings → Secrets and variables → Actions** → secretul `PUSH_SUBSCRIPTION` → lipește textul.
4. Pentru **mai multe telefoane**, pune abonamentele într-o listă: `[ {...primul...}, {...al doilea...} ]`.

> Abonamentul se schimbă dacă reinstalezi aplicația, ștergi datele browserului sau schimbi cheile VAPID.
> Atunci îl copiezi din nou. Dacă un abonament expiră, vei vedea un avertisment pe ecranul principal al aplicației.

### Pasul 10 – (Recomandat pe iPhone) ntfy.sh ca rezervă

Notificările web pe iPhone pot fi uneori instabile. **ntfy** este o aplicație gratuită de notificări:

1. Instalează **ntfy** din App Store / Google Play.
2. Alege un nume de topic **greu de ghicit**, de exemplu `zboruri-ion-7f3k9x2q`.
   Oricine știe numele poate citi notificările, deci tratează-l ca pe o parolă.
3. În aplicația ntfy: **+** → scrie topicul → Subscribe.
4. Pe GitHub, adaugă secretul `NTFY_TOPIC` cu acel nume.

Poți opri oricare canal din `config/settings.json`: `"web_push": false` sau `"ntfy": false`.

### Pasul 11 – Creează prima alertă

În aplicație: **➕ Alertă nouă**.
1. Numele alertei (ex. „Roma în noiembrie”).
2. Aeroporturile de plecare (poți alege mai multe).
3. Destinația: caută după oraș, țară sau cod. Dacă nu o găsești, o adaugi după codul IATA.
4. **Dus-întors** sau **Doar dus**, apoi zilele de plecare. La dus-întors scrii pentru fiecare zi și numărul de nopți
   (ex. „4, 5”). La doar dus nu e nevoie de nopți: fiecare zi de plecare înseamnă o căutare.
5. Perioada de monitorizare (dacă lași „până la” gol, se oprește la ultima zi de plecare) și **de câte ori pe zi**
   se caută (1–4), cu **ora** fiecărei căutări (ora României). Implicit: o dată, la 08:00.
6. Companiile aeriene (sau „Oricare companie”).
7. Prețul maxim **total pentru toți pasagerii** (dus-întors sau doar dus, după caz) și moneda (EUR sau RON).
8. Adulți, bagaje de mână și **numărul maxim de escale** (oricâte / direct / max. 1 / max. 2).

Jos vezi **câte căutări consumă** alerta. Apasă **Salvează alerta**. Căutarea pornește automat în 1–2 minute.

### Pasul 12 – Rulare manuală și test

- **Căutare manuală:** GitHub → tab-ul **Actions** → „Căutare zboruri” → **Run workflow** → Run.
  Nu consumă credite pentru combinațiile deja căutate azi. Bifează „Caută din nou…” dacă vrei totuși o căutare nouă.
- **Test notificări (fără credite):** același buton, dar bifează **„Doar trimite o notificare de TEST”**.
  Dacă totul e configurat corect, primești „🧪 Test notificare zboruri” pe telefon.
- **Unde vezi ce s-a întâmplat:** în Actions, click pe rulare → „cauta” → pașii au mesaje în română.

**Când rulează automat:**
- **în fiecare oră** (la minutul 17). Scriptul caută doar alertele care au o oră programată la care nu s-au căutat încă;
  rulările fără nimic programat se opresc în câteva secunde, fără credite și fără commit. GitHub poate întârzia uneori
  rularea cu 5–20 de minute; dacă o rulare e sărită, următoarea o recuperează;
- la fiecare modificare a `data/alerts.json`. Atunci caută **doar combinațiile noi sau modificate**:
  ce s-a căutat deja azi cu aceiași parametri nu se mai caută;
- la fiecare căutare rapidă pornită din aplicație (fișier nou în `data/searches/`).

---

## 3. Bugetul de căutări

- 1 combinație activă = **1 căutare pe zi** pentru fiecare oră programată (ex. 3 combinații căutate la 08:00 și 20:00 = 6 căutări/zi).
- 1 căutare în plus pentru detaliile zborului de întoarcere, **doar** în zilele în care combinația e sub prag.
- Plan gratuit: **250 căutări/lună**, adică aproximativ **8 pe zi** în medie.

**Exemplu:** 2 zile de plecare × 2 variante de nopți = 4 combinații = 4 căutări/zi = ~120 pe lună.
La **doar dus**, aceleași 2 zile = 2 căutări/zi = ~60 pe lună (și nu există căutări pentru întoarcere).

Aplicația îți arată estimarea la crearea alertei și pe ecranul principal și te avertizează dacă depășești 250/lună.
Estimarea ține cont că plecările trecute nu se mai caută și că alertele expiră.

**Protecție automată:** înainte de fiecare rulare, scriptul verifică gratuit creditele rămase. Dacă nu ajung
pentru toate căutările, **nu caută nimic** și îți trimite o notificare de avertizare, fără să dea eroare.
Detaliile de întoarcere se caută doar dacă rămân peste 5 credite de rezervă (setarea `search_reserve`).

**Sfaturi pentru a economisi:** oprește alertele de care nu mai ai nevoie (butonul „Oprește”), folosește mai puține
variante de nopți și scurtează perioada de monitorizare.

### Căutare rapidă (o singură dată, cu parolă)

Butonul central **„Caută”** face o căutare imediată, fără să creeze o alertă: alegi ruta, datele, nopțile,
companiile și escalele, iar în 1–2 minute vezi toate prețurile. Primești și o notificare.

- **Cost:** 1 credit pe combinație, plus 1 pe combinație dacă ceri detaliile zborului de întoarcere. Aplicația îți arată
  costul înainte să apeși „Caută acum”. Maximum 20 de combinații pe căutare (`one_time_max_searches` în `config/settings.json`).
- **Parola:** o inventezi tu și o pui în secretul `SEARCH_PASSWORD`. Aplicația ți-o cere la fiecare căutare
  (sau o ține minte până închizi aplicația, dacă bifezi).
- **De ce e sigur:** parola nu pleacă de pe telefon și nu ajunge în repository-ul public. Aplicația trimite doar o
  *semnătură* calculată din parolă, iar robotul din GitHub o verifică **înainte** de orice căutare. Dacă parola e greșită,
  căutarea e refuzată fără să consume credite. O cerere veche nu poate fi refolosită.
  Folosește totuși o parolă lungă (12+ caractere), pentru că semnătura e publică.
- **Istoric:** se păstrează ultimele 30 de căutări (în `data/searches/`). Din ecranul unei căutări o poți **repeta**
  cu aceiași parametri sau o poți **șterge**.
- Ai nevoie și de tokenul GitHub pe telefon (pasul 7), la fel ca pentru alerte.

### Ce găsești în aplicație

- **Verdict „Cumpără acum / Mai așteaptă”** pentru fiecare alertă, calculat din istoricul prețurilor tale și din datele
  Google (minim istoric, câte zile la rând scade/crește prețul, comparația cu media, nivelul Google). E orientativ.
- **Calendar de prețuri**: zilele de plecare × numărul de nopți, colorate după preț (mai intens = mai ieftin, ★ = cel mai
  ieftin, ✓ = sub prag). Atingi un pătrat și se deschide combinația respectivă.
- **Partajare**: butonul de lângă „Google Flights” trimite oferta (rută, preț, zboruri, link) pe WhatsApp, Mesaje etc.
- **Gesturi**: trage o alertă spre stânga ca s-o oprești sau s-o ștergi; trage lista în jos ca s-o reîmprospătezi.
- **Primii pași**: pe ecranul principal, o listă cu bife te ghidează prin configurare (dispare când e totul gata).
- **Poze cu destinația** (de pe Wikipedia, cu mențiunea sursei) în cardul principal și ca miniaturi în listă.
- **Călătoria**: hartă cu traseul real, distanța, cel mai scurt zbor găsit și **vremea** la destinație pentru datele
  tale (prognoză dacă pleci în următoarele ~15 zile, altfel media din ultimii 3 ani).
- **EUR ⇄ RON**: comuți moneda afișată din cardul principal sau din Setări (cursul BCE, actualizat zilnic).
  Pragurile și notificările rămân în moneda alertei.
- **Cerul după ora din zi** pe ecranul principal (răsărit, zi, apus, noapte cu stele) și un **ecran de pornire** animat.

---

## 4. Test local fără credite (`--dry-run`)

Poți testa totul pe calculator, **fără să consumi căutări**. Scriptul folosește răspunsuri SerpApi salvate
în `scraper/fixtures/` și variază prețurile ușor, ca să vezi grafice și notificări realiste.

```bash
python3 -m venv .venv
source .venv/bin/activate          # pe Windows: .venv\Scripts\activate
pip install -r requirements.txt

python -m scraper.main --dry-run --alerts scraper/fixtures/alerts_example.json
```

- Rezultatele de test se scriu în `dry-run-output/`, nu în `data/`, deci nu strică datele reale.
- Notificările sunt doar afișate în terminal. Adaugă `--send-notifications` ca să le trimiți pe bune
  (ai nevoie de variabilele de mediu `VAPID_PRIVATE_KEY`, `PUSH_SUBSCRIPTION`, `NTFY_TOPIC`).
- `--today 2026-10-15` simulează altă zi. Util ca să construiești un istoric pentru grafic.
- `--save-responses` (la o rulare **reală**, cu `SERPAPI_KEY`) salvează răspunsurile în
  `scraper/fixtures/recorded/`. Rulările `--dry-run` ulterioare le folosesc pe acelea.

Ca să vezi aplicația local:
```bash
python3 -m http.server 8000
```
și deschide <http://localhost:8000>.

---

## 5. Editarea manuală a alertelor

Fișierul `data/alerts.json` se poate edita direct pe GitHub (creionul ✏️). Format:

```json
{
  "alerts": [
    {
      "id": "roma-noiembrie",
      "name": "Roma în noiembrie",
      "active": true,
      "monitor_start": "2026-09-27",
      "monitor_end": "2026-11-12",
      "departure_airports": ["OTP", "CLJ"],
      "destination": {"id": "ROM-ALL", "name": "Roma (toate aeroporturile)", "codes": ["FCO", "CIA"]},
      "trip_type": "round_trip",
      "search_hours": [8, 20],
      "departures": [
        {"date": "2026-11-12", "nights": [4, 5]},
        {"date": "2026-11-13", "nights": [3]}
      ],
      "airlines": ["W6", "W4", "W9", "5W", "FR", "RK", "AL", "RR"],
      "max_price": 250,
      "currency": "EUR",
      "adults": 1,
      "bags": 0,
      "max_stops": null
    }
  ]
}
```

- `id`: unic, doar litere mici, cifre și cratime (e și numele fișierului de rezultate).
- `airlines: []` înseamnă **oricare companie**.
- `search_hours`: orele (ora României, 0–23) la care se caută, 1–4 valori diferite. Implicit `[8]`.
- `trip_type`: `"round_trip"` (dus-întors, implicit) sau `"one_way"` (doar dus; atunci `nights` poate lipsi).
- `max_stops`: `null` = oricâte escale, `0` = doar directe, `1` = maxim o escală, `2` = maxim două.
- Datele se scriu `AAAA-LL-ZZ`.

---

## 6. Personalizare

Toate listele sunt fișiere JSON în `config/`, pe care le poți edita:

| Fișier | Ce conține |
|---|---|
| `config/airports.json` | aeroporturile de **plecare** din formular |
| `config/destinations.json` | destinațiile (Europa, Turcia, Asia, Africa). O destinație poate avea mai multe coduri, ex. „Londra (toate)” = LHR, LGW, STN, LTN, LCY, SEN |
| `config/destinations_custom.json` | destinațiile adăugate de tine din aplicație |
| `config/airlines.json` | companiile aeriene cu codurile IATA |
| `config/settings.json` | cheia publică VAPID, canale de notificare, limita lunară, rezerva de credite |

**Companiile cu mai multe coduri:** Wizz Air zboară ca W6 (Ungaria), W4 (Malta), W9 (UK) și 5W (Abu Dhabi).
Ryanair zboară ca FR, RK (UK), AL (Malta Air) și RR (Buzz). În aplicație alegi „Wizz Air” și se trimit toate codurile.

**Din listă lipsesc** Rusia, Belarus și Ucraina (nu există zboruri din România) și statele fără aeroport
(Andorra, Monaco, San Marino, Liechtenstein, Vatican).

---

## 7. Securitate și riscuri

- **Repository-ul este public.** Oricine poate vedea codul, alertele (destinații, date, prețuri) și rezultatele.
  Nu pune date personale în numele alertelor.
- **Secretele** (`SERPAPI_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_SUBSCRIPTION`, `NTFY_TOPIC`) nu sunt vizibile nimănui,
  nici în log-urile publice ale Actions (GitHub le ascunde automat, iar scriptul șterge cheia din mesajele de eroare).
- **Tokenul GitHub** stă doar pe telefon și are acces doar la acest repository, doar la conținut. Pune-i dată de expirare.
- **Topicul ntfy** funcționează ca o parolă: alege un nume lung și aleatoriu.
- Pentru poze, hartă, vreme și curs, aplicația folosește servicii gratuite, fără cont: Wikipedia/Wikimedia,
  Open-Meteo, frankfurter.dev (cursul BCE) și jsDelivr (bibliotecile hărții). Ele primesc doar numele orașului,
  coordonatele sau moneda. Dacă un serviciu nu răspunde, partea respectivă pur și simplu nu apare.
- Fonturile aplicației (Inter și Plus Jakarta Sans) se încarcă de la Google Fonts. Fără internet, aplicația
  folosește fontul telefonului.
- Nu comite niciodată fișiere `.env` sau `.pem`. Ele sunt deja în `.gitignore`.

---

## 8. Probleme frecvente

**Nu primesc notificări pe iPhone.**
Aplicația trebuie deschisă de pe ecranul principal (nu din Safari), cu iOS 16.4+. Verifică în *Setări iPhone →
Notificări → Zboruri*. Folosește și ntfy ca rezervă.

**În log apare „abonamentul a expirat (410)”.**
Deschide aplicația → Setări → Activează notificările → copiază din nou abonamentul în `PUSH_SUBSCRIPTION`.

**„cheile VAPID nu se potrivesc (403)”.**
Cheia publică din `config/settings.json` trebuie să fie pereche cu `VAPID_PRIVATE_KEY`. După ce schimbi cheile,
reactivează notificările pe telefon și copiază abonamentul nou.

**Aplicația arată date vechi.**
Fără token, datele vin prin GitHub Pages, care se actualizează în 1–2 minute după fiecare rulare (uneori până la 10 minute din cauza cache-ului).
Cu token, datele se citesc direct și sunt mereu la zi.

**„Nu am putut salva” / eroare 403 la salvare.**
Tokenul nu are „Contents: Read and write” sau nu are acces la repository-ul corect. Fă altul (pasul 7).

**Nu se găsește niciun zbor.**
Verifică codurile aeroporturilor și companiilor. Unele companii nu zboară pe ruta aleasă, iar filtrul „doar directe” reduce mult rezultatele.

**Rularea zilnică nu mai pornește.**
GitHub oprește rulările programate în repository-urile publice fără activitate timp de 60 de zile. Primești un
email. Intră în Actions și apasă „Enable workflow”.

**Prețul pentru mai mulți adulți.**
Google Flights afișează prețul total pentru toți pasagerii, iar pragul se compară cu acest total. La prima rulare reală,
compară prețul din aplicație cu cel de pe linkul Google Flights ca să confirmi.

---

## 9. Structura fișierelor

```
index.html, css/, js/          aplicația (PWA)
  js/app.js                    navigarea între ecrane
  js/screens/                  ecranele: listă, formular, detaliu, căutare rapidă, setări
  js/results-view.js           afișarea rezultatelor (bilete, combinații, filtre, partajare)
  js/insights.js               verdictul „Cumpără acum / Mai așteaptă”
  js/heatmap.js                calendarul de prețuri
  js/motion.js, gestures.js    animații, ruta animată, glisare, tragere pentru reîmprospătare
  js/flags.js, onboarding.js   steaguri pe destinații, ghidul „Primii pași”
  js/geo.js, media.js          coordonatele orașelor (Open-Meteo) și pozele (Wikipedia)
  js/map.js, trip.js, weather.js  harta traseului, secțiunea „Călătoria”, vremea
  js/currency.js               afișarea în EUR/RON
  js/budget.js                 calculul combinațiilor și al bugetului (la fel ca scraper/alerts.py)
  js/data.js                   citirea datelor și salvarea prin GitHub API
  js/push.js                   notificări push + generator chei VAPID
  js/chart.js                  graficul de preț
  js/ui.js, js/icons.js        elemente comune de interfață (bara de sus, iconițe, mini-grafice)
manifest.json, sw.js, icons/   instalarea pe telefon și notificările
config/                        liste și setări (editabile)
data/alerts.json               alertele
data/results/<id>.json         ultimele rezultate ale fiecărei alerte
data/history/<id>.json         prețul minim pe zi (pentru grafic)
data/status.json               rezumatul ultimei rulări
data/state.json                ce notificări s-au trimis (ca să nu se repete)
data/searches/<id>.json        căutările rapide (cerere semnată + rezultate); index.json = lista lor
scraper/                       scriptul Python
  main.py                      pornirea și logica principală
  alerts.py                    alerte active, combinații, parametrii SerpApi, buget
  serpapi_client.py            căutări + verificarea creditelor + mod de test
  search.py                    căutarea unei combinații (comună pentru alerte și căutări rapide)
  one_time.py                  căutările rapide: verificarea parolei, căutare, istoric
  notify.py                    Web Push și ntfy
  storage.py                   scrierea fișierelor JSON
  fixtures/                    răspunsuri salvate pentru --dry-run
tools/genereaza_chei_vapid.py  generator de chei VAPID
tools/genereaza_splash.py      generează imaginile de pornire pentru iPhone (icons/splash/)
.github/workflows/cautare-zboruri.yml   programarea în GitHub Actions
```
