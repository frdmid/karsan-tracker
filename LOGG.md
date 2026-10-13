# Logg

Nyeste øverst. Hver endring: dato, hva, hvorfor.

## 2026-10-13

* Nøkkeltallboksene: fjernet tekst om narrativet (retning og begrunnelse) fra boksene, ligger nå bare som tooltip og aria-label. Hele boksen har retningsfarge (grønn mot, rød bort, nøytral uendret). Ny list øverst i hver boks med én stripe per fase, fylt opp til gjeldende fase, pluss en fasenøkkel over boksene. Antall faser leses fra `regime` i config. Hvorfor: Frode ville se fasen i hver boks. Første forslag (fargefeltet delt i fire striper) svekket retningssignalet i tidlige faser, derfor valgte Frode alternativet med fasen som list øverst.

## 2026-10-12 (forts.)

* Søkte etter åpen kilde for S&P 500. Ingen funnet (se PROSJEKT.md avsnitt 6).
* Etter valg fra Frode: privat lokal visning. Nytt `scripts/lokal_visning.py` og `Karsan lokal.cmd`, ny mappe `private/` i `.gitignore`, siden leser `private/` når den finnes og viser banner. Testet: alle fem seriene hentet, fase 2 kan nå vurderes lokalt (Ikke nådd).
* `.gitattributes`: `.cmd` får CRLF.
* Nytt `scripts/md_til_pdf.py`: lager PDF av Markdown via Edge headless, uten eksterne pakker. Eksporterte PROSJEKT.md til PROSJEKT.pdf. PDF-filer committes ikke (`.gitignore`), lages på nytt ved behov.

## 2026-10-12

* Opprettet prosjektet i `C:\Users\FrodeMidjo\kode\karsan-tracker`.
* Verifiserte alle 24 FRED-serier via fredgraph.csv og FRED API-endepunktet (krever nøkkel). Verifiserte Treasury yield curve og real long term CSV med kolonnenavn.
* Sjekket lisens per FRED-serie. SP500, BAMLH0A0HYM2 og BAMLC0A0CM krever forhåndsgodkjenning og settes til `publish: false`. Yahoo-seriene (MOVE, gull) settes også til `publish: false`. Stooq forkastet: krever JavaScript-verifisering.
* Skrev hentescript, `build_status.py` med kryssjekk FRED mot Treasury, `calc.js` med 15 tester og fixture-filer, siden og workflows.
* Bygde historikk fra 2015 for Treasury. Alle kontrolltall for 9. oktober stemmer (se PROSJEKT.md avsnitt 12). Kryssjekk: 0 avvik.
* Etter ønske fra Frode: nøkkeltall øverst med grønn, rød eller grå boks etter retning siste 30 dager og minigraf.
* Etter ønske fra Frode: regimetracker med fem faser og implikasjoner per fase, merket som ikke investeringsråd.
* Etter ønske fra Frode: seksjoner for Karsan selv (podcaster og omtaler) og nyheter per tema. X ikke dekket (betalt API).
* Etter ønske fra Frode: nyheter vises som 2 til 3 linjers oppsummering med lenke. Oppsummering med Claude API er valgfri (secret `ANTHROPIC_API_KEY`), uten den vises utgiverens beskrivelse og de nyeste overskriftene.
* Testet siden lokalt med lisensbegrensede data for å verifisere S&P-graf, fall fra topp og signalstatus. Dataene ble slettet etterpå.
* Testene kjørt i nettleser med shim (node mangler lokalt): 15 av 15 bestått.
* Installerte Git 2.55.0 og GitHub CLI 2.102.0 med winget. Innlogget som frdmid, token med scope repo og workflow.
* Opprettet offentlig repo https://github.com/frdmid/karsan-tracker, aktiverte Pages med kilde GitHub Actions.
* Første manuelle kjøring av "Oppdater data": 27 serier ok, 5 ikke publisert (lisens), 15 av 15 tester bestått med node 22, data committet av github-actions[bot].
* "Publiser side" startet via workflow_run og publiserte https://frdmid.github.io/karsan-tracker/. Siden laster med alle grafer og tabeller.
* Publiserte et øyeblikksbilde som privat artifact i Claude: https://claude.ai/artifact/ABNKAktVN1XuxWQMmVB7Zj (oppdateres ikke automatisk).
