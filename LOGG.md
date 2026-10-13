# Logg

Nyeste øverst. Hver endring: dato, hva, hvorfor.

## 2026-10-13

* Podcastagent etter ønske fra Frode: `scripts/podcast_agent.py`, nytt steg i "Oppdater data", ny seksjon under Karsan selv. Verifisert: Top Traders Unplugged har transkripsjon i feeden, Karsans egen serie U Got Options (UGO01 til UGO12) ligger der. "You've Got Options" fantes ikke under det navnet, riktig navn er U Got Options. Kai Media på YouTube lagt til som lenker via åpen RSS. Andre podkaster (Brunell, Taggart, David Lin, Forward Guidance) har ikke transkripsjon i feeden, lydtranskribering kan slås på med `TRANSCRIBE_AUDIO=true`. Analyse krever `ANTHROPIC_API_KEY`.
* SI420 analysert manuelt i Claude Code mot transkripsjonen: 10-årsrente 5,5 til 6 % innen tre måneder, S&P 25 til 40 % i H1 2027 (mulig Q4 ved bestridt valg), QE innen seks måneder og senest juni 2027, formuefond og to sifret inflasjon bekreftet. Nytt: inflasjonen først sent 2027 og 2028, rentetopp og aksjefall samtidig, 10-årsrenten trolig til 4 % etterpå, sterk dollar og svakt gull er målet på kort sikt, opptaket var trolig 29. september. Seks forslag lagt inn i analysen, ikke i config.

* Fjernet de svakest begrunnede målene etter ønske fra Frode: 30-årsrente +0,4 pp i fase 1, gull +10 % i alle faser, dollar −5 % i alle faser, KPI 10 % i fase 1 til 3 (beholdt i fase 4). 40 til 29 mål. Fase uten mål vises som hvit stripe med tynn kant, ny forklaring for "ingen mål i fasen" og "fase ikke nådd".

* Lokal visning sender nå `Cache-Control: no-store`, så nettleseren ikke viser gamle filer (Frode så ikke fasestripene lokalt). Artifact oppdatert til versjon 2 med versjonsstempel og offentlige data per 13. okt, uten private data. Artifact bygges i `build/artifact` (ikke committet).

* Gradert farge i fasestripene, etter valg fra Frode: styrken viser fremdrift mot et mål for fasen siden fasestart (seks trinn fra mørk grønn til mørk rød), bare i stripene. Boksen beholder 30-dagers retning. Nye `phase_targets` for alle tolv nøkkeltall (40 mål), tre er Karsans tall, resten sidens operasjonalisering. Nye funksjoner i `calc.js`: `phaseStartDate`, `targetProgress`, `progressGrade`. 18 av 18 tester bestått. Fargeforklaring under fasenøkkelen, stripelista har egen nøytral bakgrunn for kontrast. Status nå (fase 1): 10-årsrente 21 % av veien mot 5,5 %, gull 26 % bort fra målet.

* Fasestriper som logg, etter ønske fra Frode: stripen for en passert fase fryses på datoen regimet gikk videre og viser om tallet da var i retning den fasen (grønn, rød eller grå). Boksen og stripen for gjeldende fase vurderes mot retningen i gjeldende fase.
* Ny `phase_directions` per nøkkeltall i `config/signals.json`. Fase 1 er uendret, fase 2 til 4 lagt inn etter tesen (se `why` per nøkkeltall).
* Nye funksjoner i `calc.js`: `truncate`, `regimeHistory`, `phaseExitDate`, `directionFor`, `stripeStates`. To nye tester, 17 av 17 bestått.
* Testet visuelt ved å senke VIX-terskelen for fase 2 midlertidig til 15,3: fase 2 inntraff 28. sep., 10-årsrentens fase 1-stripe ble frosset grønn mens boksen ble rød. Terskelen satt tilbake til 25.
* Versjonsstempel på filene ved publisering (`__VERSION__` byttes med commit-id i `pages.yml`), så nettleseren ikke blander gammel `calc.js` med ny `app.js`.

* Fylte fasestriper får nå den sterke varianten av boksens retningsfarge (grønn, rød eller grå) i stedet for nøytral grå. Etter ønske fra Frode.

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
