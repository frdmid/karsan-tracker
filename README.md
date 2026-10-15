# Karsan tracker

Følger Cem Karsans makronarrativ (Top Traders Unplugged, opptak ca. 25. september 2026) mot faktiske markedsdata. Data hentes automatisk hver hverdag av en GitHub Action, lagres som CSV i `data/` og vises på en statisk GitHub Pages side som leser CSV direkte.

Karsans krav er gjengitt fra sekundære kilder og kan være unøyaktig gjengitt. Se `config/signals.json`.

## Slik fungerer det

1. `.github/workflows/update-data.yml` kjører hverdager 05:30 og 14:00 UTC (og manuelt). GitHub kan forsinke planlagte kjøringer med flere timer:
   * `scripts/fetch_treasury.py` henter par yields og lang realrente fra home.treasury.gov
   * `scripts/fetch_fred.py` henter FRED serier (API med `FRED_API_KEY`, ellers FREDs åpne CSV)
   * `scripts/fetch_other.py` henter uoffisielle kilder (Yahoo), bare når publisering er tillatt
   * `scripts/fetch_news.py` henter nyhetstitler (Google News RSS) og Karsans podcastepisoder (Apple)
   * `scripts/summarize_news.py` lager norske oppsummeringer med Claude, bare hvis `ANTHROPIC_API_KEY` finnes
   * `scripts/build_status.py` lager `data/status.json` og kryssjekker FRED mot Treasury
   * enhetstestene i `tests/` kjøres, og `data/` committes hvis noe er endret
2. `.github/workflows/pages.yml` kjører testene på nytt, kopierer `site/`, `data/` og `config/` sammen og publiserer til GitHub Pages.

Feiler én serie, beholdes forrige fil og serien merkes utdatert. Workflowen feiler bare hvis alle serier feiler.

Alle utregninger ligger i `site/js/calc.js` og testes med `node --test tests/calc.test.js` mot små fixture-filer i `tests/fixtures/`.

## Secrets og variabler

Settes under Settings, Secrets and variables, Actions i GitHub.

| Navn | Type | Påkrevd | Effekt |
|---|---|---|---|
| `FRED_API_KEY` | Secret | Nei | Bruker FRED API i stedet for åpen CSV. Gratis nøkkel på fred.stlouisfed.org/docs/api/api_key.html |
| `ANTHROPIC_API_KEY` | Secret | Nei | Slår på automatiske nyhetsoppsummeringer (koster litt per kjøring) |
| `PUBLISH_RESTRICTED` | Variable | Nei | `true` henter og publiserer lisensbegrensede serier. Bruk bare med tillatelse fra rettighetshaver |

## Legge til en serie

1. Kall endepunktet og bekreft at serie-id finnes og gir data.
2. Legg en linje i `config/series.json` med `id`, `source` (`fred`, `treasury` eller `yahoo`), `source_id`, `title`, `unit`, `frequency`, `max_age_days`, `license`, `publish`, `change_mode` (`pp` eller `pct`) og `decimals`. Treasury trenger også `column`.
3. Sjekk lisensen. Er gjengivelse ikke tillatt, sett `publish: false`.
4. Bruk serien i `config/signals.json` (signal, nøkkeltall, regimevilkår eller `since_recording`) eller i `chartDefs` i `site/js/app.js`.
5. Kjør hentescriptet og `build_status.py` lokalt, og sjekk siden.

## Kjøre lokalt

```bash
python scripts/fetch_treasury.py --from-year 2015
```

```bash
python scripts/fetch_fred.py
```

```bash
python scripts/build_status.py
```

```bash
python -m http.server 8765
```

Åpne http://127.0.0.1:8765/site/.

## Privat lokal visning med S&P 500

S&P 500, ICE OAS, MOVE og gull kan ikke publiseres (lisens). For å se dem selv: dobbeltklikk `Karsan lokal.cmd`, eller kjør

```bash
python scripts/lokal_visning.py
```

Scriptet henter siste offentlige data med `git pull`, henter de lisensbegrensede seriene til `private/` (står i `.gitignore`, committes aldri), starter en lokal server og åpner siden. Et banner øverst viser at visningen er privat. Pages-siden har aldri `private/` og viser seriene som ikke publisert.

## Analyse av nye Karsan-episoder

Podcastagenten (`scripts/podcast_agent.py`) kjører hver morgen og finner nye episoder med Karsan og transkripsjonen deres. Analysen gjøres manuelt i Claude Code, uten API-nøkkel. Be Claude om å "analysere nye Karsan-episoder" i prosjektmappen. Claude gjør da dette:

1. `git pull`, deretter `python scripts/podcast_agent.py --list` for å se hva som venter og hente transkripsjonene til `build/transcripts/` (lagres aldri i repoet).
2. Leser transkripsjonen og skriver analysen som JSON med feltene `karsan_deltar`, `oppsummering`, `pastander` (tema, pastand, tall, tidshorisont, sitat maks 15 ord på originalspråket, tid_sek, forhold: bekrefter, endrer, nytt eller motsier, gjelder_krav) og `forslag` (hva, begrunnelse). Sammenligner med kravene i `config/signals.json`.
3. `python scripts/lagre_analyse.py <id> <analyse.json>`, commit og push. Siden viser analysen under Karsan selv.
4. Forslag til endringer i dashbordet legges bare inn etter godkjenning.

Settes `ANTHROPIC_API_KEY` som secret, gjør agenten analysen automatisk i stedet.

## Mer

Prosjektbeskrivelse og beslutninger: `PROSJEKT.md`. Endringslogg: `LOGG.md`.
