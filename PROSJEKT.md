# Prosjektbeskrivelse: Karsan tracker

Dette dokumentet beskriver formål, krav, arkitektur og beslutninger. Sammen med `LOGG.md` og koden skal det være nok til å gjenskape hele prosjektet.

Eier: Frode (strategiplanlegger). Startet 12. oktober 2026.

## 1. Formål

Følge Cem Karsans makronarrativ mot faktiske markedsdata, slik at det er lett å se om utviklingen går i retning narrativet eller bort fra det, hvilken fase scenariet er i, og hva narrativet tilsier for aktivaklasser i hver fase.

## 2. Bakgrunn og tese

Kilde: Top Traders Unplugged, episode SI420 "The Market Might Be More Fragile Than It Looks ft. Cem Karsan", publisert 2. oktober 2026. Først antatt opptaksdato 25. september, korrigert 13. oktober til 29. september etter transkripsjonen (innspilt tirsdag, CTA-tall per 25. september omtales som forrige uke).

Kontroll mot transkripsjonen 13. oktober 2026: kravene 1 til 4 under stemmer. Presiseringer derfra: renten får en rask V-topp og faller trolig mot 4 % etterpå, aksjefallet skjer samtidig med rentetoppen, QE kommer senest juni 2027, to sifret inflasjon kommer først sent 2027 til 2028, og sterk dollar og svakt gull er målet med Fed-hevingen på kort sikt.

Tesen, slik den er gjengitt: Bessent og Warsh samkjører. Fed-hevingen 16. september 2026 til 3,75 til 4,00 % skulle gi bilde av en uavhengig Fed. Målet er å inflatere seg ut av statsgjelden, mens lange renter holdes nede ved å la aksjemarkedet falle.

Karsans signaler, gjengitt fra sekundærkilder og hukommelse, ikke verifisert mot opptaket:

1. 10-årsrenten til 5,5 til 6 % innen ca. 3 måneder fra opptaket
2. S&P 500 ned 25 til 40 % fra topp i H1 2027, muligens Q4 2026 hvis valget bestrides
3. QE innen ca. 6 måneder, statlig formuefond og oppkjøp av lange statsobligasjoner
4. To sifret inflasjon
5. Følges også: CDS i AI-komplekset, hyperscaler capex, andel S&P 500 med negativ beta, CTA-indeks, MOVE

Denne usikkerheten vises som synlig fotnote på siden og står i `config/signals.json` (`source_note`).

## 3. Absolutte regler

1. Ingen tilnærminger. Alle tall kommer fra navngitt kilde med serie-id og dato. Ingen hardkodede verdier i HTML eller JS, unntatt terskler fra `config/signals.json`.
2. Hvert endepunkt og hver serie-id er verifisert ved faktisk kall før bruk. Det som ikke finnes gratis merkes "Ikke dekket", uten tall.
3. Feiler én serie: forrige fil beholdes, serien merkes utdatert i `data/status.json`, resten går videre. Workflowen feiler bare hvis alle serier feiler.
4. Alle utregninger i `site/js/calc.js`, med enhetstester (node:test) mot fixture-filer. Testene kjøres i workflow før deploy.
5. Siste observasjonsdato vises alltid per serie, med "utdatert" når den er eldre enn forventet for publiseringsfrekvensen.
6. All tekst på norsk bokmål. Aldri tankestrek, bruk komma, punktum eller kolon. Ingen emojier, saklig tone.

## 4. Arkitektur

```
.github/workflows/update-data.yml   henting, status, tester, commit (hverdager 05:30 UTC + manuelt)
.github/workflows/pages.yml         tester og publisering til GitHub Pages
scripts/common.py                   felles: config, HTTP med gjentak, CSV, hentelogg
scripts/fetch_fred.py               FRED (API med nøkkel, ellers fredgraph.csv)
scripts/fetch_treasury.py           Treasury par yields og lang realrente
scripts/fetch_other.py              Yahoo (MOVE, gull), bare ved PUBLISH_RESTRICTED=true
scripts/fetch_news.py               Google News RSS og Apple Podcasts søk
scripts/summarize_news.py           norske oppsummeringer med Claude (valgfritt)
scripts/build_status.py             data/status.json og kryssjekk FRED mot Treasury
config/series.json                  alle serier: kilde, id, enhet, frekvens, maks alder, lisens
config/signals.json                 krav, terskler, nøkkeltall, regimefaser, implikasjoner
config/news.json                    nyhetstemaer og søk
config/news_labels.json             manuelle vurderinger av enkeltsaker
data/*.csv                          date,value, én fil per serie, stigende ISO-datoer
data/status.json                    status per serie og kryssjekk
data/news.json, news_summary.json   nyheter og oppsummeringer
site/index.html, css/, js/          statisk side uten byggesteg, d3 7.9.0 fra jsdelivr
tests/calc.test.js, tests/fixtures/ enhetstester
```

Hentescriptene skriver resultat per serie til `build/fetch_log.json` (ikke committet). `build_status.py` slår sammen loggen, CSV-filene og forrige `status.json`. Siden finner `config/` og `data/` enten ved siden av seg (Pages) eller ett nivå opp (lokalt fra reporoten).

## 5. Datakilder og verifisering (12. oktober 2026)

| Kilde | Endepunkt | Resultat |
|---|---|---|
| FRED API | api.stlouisfed.org/fred/series/observations | Finnes, krever api_key (400 uten) |
| FRED CSV | fred.stlouisfed.org/graph/fredgraph.csv?id=ID&cosd=2015-01-01 | Alle 24 serier svarer |
| Treasury | home.treasury.gov/.../daily-treasury-rates.csv/{ÅR}/all?type=daily_treasury_yield_curve&field_tdr_date_value={ÅR}&page&_format=csv | Kolonner "Date", "2 Yr", "5 Yr", "10 Yr", "20 Yr", "30 Yr"; dato MM/DD/YYYY |
| Treasury | samme med type=daily_treasury_real_long_term | Kolonne "LT Real Average (10> Yrs)" |
| Stooq | stooq.com/q/d/l/?s=xauusd&i=d | Virker ikke: krever JavaScript-verifisering |
| Yahoo | query1.finance.yahoo.com/v8/finance/chart/%5EMOVE og GC%3DF | Svarer lokalt, uoffisiell |
| Google News | news.google.com/rss/search?q=... | Svarer, gir tittel, kilde, dato, lenke |
| Apple | itunes.apple.com/search?term=Cem+Karsan&entity=podcastEpisode | Svarer, gir episoder med beskrivelse |
| X | api.x.com/2/... | 401 uten betalt nøkkel |

FRED-serier: DGS2, DGS5, DGS10, DGS20, DGS30, DFII5, DFII10, DFII20, DFII30, T10YIE, DFEDTARU, DFEDTARL, WALCL, WSHOTSL, WRESBAL, WTREGEN, SP500, VIXCLS, BAMLH0A0HYM2, BAMLC0A0CM, CPIAUCSL, CPILFESL, DEXNOUS, DTWEXBGS. FRED bruker "." for manglende verdier: slike rader droppes.

## 6. Lisensbeslutning

FREDs seriesider oppgir lisenskategori. Resultat:

* Offentlig: renter, TIPS, Fed-mål, H.4.1, KPI, valuta.
* Krever kildehenvisning: T10YIE, VIXCLS. Publiseres med kilde.
* Krever forhåndsgodkjenning: SP500 (S&P Dow Jones Indices: "Reproduction of S&P 500 in any form is prohibited except with the prior written permission"), BAMLH0A0HYM2 og BAMLC0A0CM (ICE Data Indices).
* Yahoo (MOVE, gull): uoffisiell kilde, vilkårene tillater ikke videredistribusjon.

Beslutning: disse fem har `publish: false` og hentes ikke i et offentlig repo. Siden viser dem som "Ikke publisert (lisens)". Repo-variabelen `PUBLISH_RESTRICTED=true` slår dem på hvis tillatelse foreligger. Logikken er testet lokalt med dataene, som deretter ble slettet.

Søk etter åpen S&P-kilde (12. oktober 2026): FREDs Nasdaq Composite, Nasdaq 100 og Dow Jones krever også forhåndsgodkjenning, Wilshire 5000 finnes ikke lenger hos FRED, Stooq er blokkert, Yahoo og Nasdaqs nettsted (SPY) er uoffisielle med vilkår mot videredistribusjon. Ingen helt åpen kilde finnes. Frode valgte privat lokal visning: `scripts/lokal_visning.py` (eller `Karsan lokal.cmd`) henter de fem seriene til `private/` (aldri committet), og siden leser `private/` bare når mappen finnes, med et banner om at visningen er privat. Forkastede alternativer: publisere bare utledet fall fra topp, bruke SPY fra Nasdaqs uoffisielle API, publisere alt.

## 7. Regler for signaler (config/signals.json)

* `level_reach`: Oppfylt hvis høyeste observasjon fra opptaksdato til frist er minst terskel. Ikke oppfylt etter frist. Ellers Overvåkes.
* `drawdown_reach`: fall fra løpende topp i prosent, samme logikk. Oppfylt-dato er første dato over terskel.
* `yoy_reach`: år over år for månedsindeks, krever observasjon nøyaktig ett år før.
* `change_reach`: prosentvis endring fra baseline (siste observasjon på eller før opptaksdato).
* `final_deadline` (valgfri): ytre frist. Etter `deadline` men før ytre frist vises signalet som forsinket, først etter ytre frist blir det Ikke oppfylt. Brukes for QE (6 måneder, senest juni 2027).
* `monitor`: ingen terskel. `not_covered`: ingen kilde.
* Avstand = terskel minus faktisk verdi.
* 10-årsrenten bruker den ferskeste av UST_10Y og DGS10 (samme mål).
* QE-signalet bruker en operasjonell definisjon valgt for siden: WSHOTSL opp minst 5 % fra opptak. Står på siden.

## 8. Nøkkeltall øverst

Hvert nøkkeltall har en retning per fase (opp, ned eller ingen) som er sidens tolkning av tesen: `direction` gjelder alle faser, `phase_directions` overstyrer enkeltfaser. For eksempel skal 10-årsrenten opp i fase 1 og ned i fase 2 og 3. Endring siste 30 dager vurdert mot retningen for gjeldende fase: hele boksen grønn i retning narrativet, rød bort fra, nøytral hvis mindre enn minste bevegelse eller uten retning.

En list øverst i hver boks har én stripe per fase og fungerer som logg. Stripens fargestyrke viser fremdrift mot et mål for fasen (`phase_targets`: nivå eller endring fra fasestart), regnet fra verdien da fasen startet: mørk grønn nådd, middels grønn minst halvveis, lys grønn på vei, grå stillestående, lys rød litt bort, mørk rød langt bort, hvit ingen mål i fasen. Ikke alle nøkkeltall har mål: 29 mål totalt, svakt begrunnede mål er fjernet (30-årsrente i fase 1, gull, dollar, KPI i fase 1 til 3). Bare tre mål er Karsans tall (10-årsrente 5,5 % i fase 1, S&P 500 fall 25 % i fase 2, KPI 10 % i fase 4), resten er sidens operasjonalisering. Boksen og stripen måler altså ulike ting: boksen viser retning siste 30 dager, stripen viser fremdrift mot fasemålet. Stripen for en passert fase fryses på datoen regimet første gang gikk forbi fasen, med bare data kjent den dagen. Senere faser er tomme. Regimehistorikken regnes i `calc.js` (`regimeHistory`) ved å evaluere regimet dag for dag fra opptaksdatoen med data avkortet til hver dag, så loggen er reproduserbar fra CSV-filene. Revisjoner i data kan i sjeldne tilfeller endre en frosset farge litt. En fasenøkkel over boksene viser hvilke stripene er. Boksene har ingen tekst om narrativet, retning og begrunnelse ligger som tooltip og aria-label. Minigraf viser 120 dager med stiplet strek der endringen måles fra. Alt i `overview` i `config/signals.json`.

## 9. Regimetracker

Fem faser, operasjonalisert for denne siden (ikke Karsans definisjoner):

0. Før scenariet
1. Rentesjokk (alle): Fed øvre mål minst 4,00 %, 10-årsrente minst 5,00 %, 10-årsrenten steget siste 90 dager
2. Aksjefall (minst ett): S&P 500 minst 10 % under topp, VIX minst 25, HY OAS minst 5 %
3. Politikkskifte og QE (minst ett): WSHOTSL opp minst 5 % siden opptak, Fed øvre mål kuttet siden opptak
4. Inflasjon (alle): KPI år/år minst 6 %, breakeven 10 år minst 3,00 %

Gjeldende fase er den høyeste som er nådd. Vilkår uten data telles ikke og vises som Ikke dekket. Hver fase har implikasjoner (hva narrativet favoriserer og taler mot), utledet av tesen. De er merket som ikke investeringsråd og ikke Karsans anbefalinger.

## 10. Nyheter

Google News RSS per tema (siste 14 dager per kjøring, beholdes 120 dager) og Apple Podcasts søk på Karsan (beholdes 365 dager). Bare tittel, kilde, dato, lenke og inntil 600 tegn av utgiverens episodebeskrivelse lagres. Hvis `ANTHROPIC_API_KEY` er satt, lager `summarize_news.py` med modellen claude-opus-5-5 (lav effort, strukturert JSON, server-side fallback) 2 til 3 setninger per tema ut fra overskriftene, med automatisk retning (bekrefter, avkrefter, blandet, uklart), og 2 til 3 setninger per podcast ut fra beskrivelsen. Oppsummeringer lages bare på nytt når grunnlaget endres. Manuelle vurderinger kan legges i `config/news_labels.json`. Sosiale medier er ikke dekket (X krever betalt API).

## 10b. Podcastagent

`scripts/podcast_agent.py` kjører daglig i "Oppdater data". Den finner episoder med Karsan via Apple-søk og feedene i `config/news.json` (`karsan.feeds`, i dag Top Traders Unplugged med tittelmatch `UGO\d|Karsan`, som fanger hans egen serie U Got Options). Transkripsjon hentes fra `<podcast:transcript>` i feeden (TTU har JSON med ord og tid for 773 av 973 episoder). Andre podkaster kan transkriberes med faster-whisper når repo-variabelen `TRANSCRIBE_AUDIO=true`. Med `ANTHROPIC_API_KEY` analyserer Claude (claude-opus-5-5, middels effort, strukturert JSON, server-side fallback) inntil tre nye episoder per kjøring fra og med `analyze_since` (2026-09-01): sammendrag, påstander med tall, tidshorisont, kort sitat (maks 15 ord) og forhold til kravene (bekrefter, endrer, nytt, motsier), pluss forslag til endringer. Forslag legges aldri inn automatisk. Transkripsjoner lagres aldri i repoet (opphavsrett), bare i `build/transcripts/`. Resultat i `data/karsan_episodes.json`, vist under Karsan selv. Karsans YouTube-kanal Kai Media (åpen RSS) vises som lenker.

SI420 (opptaket tesen bygger på) ble analysert manuelt i Claude Code 13. oktober 2026 og er merket slik. Hovedkravene stemmer med transkripsjonen.

## 11. Siden

Rekkefølge: overskrift og generert oppsummering, regimetracker med implikasjoner, nøkkeltall, signaltabell, Karsan selv, nyheter, grafer (a til g), tid siden opptak, kilder og friskhet, fotnote.

Grafer med d3: rette linjestykker, 2 px strek, krysshår og tooltip som holdes innenfor vinduet, direkte merking av siste verdi, stiplede tersklene fra config, tidsrom Siden opptak, 6 mnd, 1 år, 3 år, Alt. Fargepalett fra dataviz-skillens validerte referansepalett, egne verdier for mørk modus. Responsiv ned til 400 px, mørk og lys modus via prefers-color-scheme, tabulære tall.

## 12. Kontrolltall (9. oktober 2026)

| Mål | Kontroll | Hentet | Kilde |
|---|---|---|---|
| 10Y par yield | 5,24 | 5,24 | Treasury 10 Yr |
| 2Y | 4,80 | 4,80 | Treasury 2 Yr |
| 5Y | 5,02 | 5,02 | Treasury 5 Yr |
| 20Y | 5,65 | 5,65 | Treasury 20 Yr |
| 30Y | 5,60 | 5,60 | Treasury 30 Yr |
| Lang realrente snitt | 3,32 | 3,32 | Treasury LT Real Average |
| S&P 500 slutt | 7811,54 | 7811,54 | FRED SP500 (ikke publisert) |
| S&P 500 topp | 7818,93 (6. okt) | 7818,93 (6. okt) | FRED SP500 |
| Fed totale eiendeler | 6 747 560 | 6 747 560 (7. okt) | FRED WALCL |

Kryssjekk FRED mot Treasury: 60 felles datoer per løpetid, 0 avvik over 0,01 prosentpoeng.

## 13. Kjente begrensninger

* FRED H.15 kommer én dag etter Treasury, derfor brukes Treasury der begge finnes.
* DEXNOUS og DTWEXBGS publiseres ukentlig med etterslep, maks alder 13 dager.
* Yahoo kan blokkere skyservere. Er serien slått på og feiler, merkes den utdatert.
* Node finnes ikke på utviklingsmaskinen. Testene ble kjørt i nettleser med en shim som laster `tests/calc.test.js` uendret, og kjøres med ekte node i GitHub Actions.
