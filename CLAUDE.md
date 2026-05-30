# Stato del progetto admin-posti

Documento per riprendere il lavoro in una nuova sessione (Claude, Codex, o altro). Tieni questo file aggiornato.

## Cosa è

App Next.js 16 + Supabase per la riconciliazione contabile di **pOsti S.r.l.**: import di estratti conto e fatture, abbinamento automatico transazioni↔fatture, vista per soggetto, wizard guidato periodo per periodo.

Deploy: https://admin-posti.vercel.app (auto-deploy da `main` su Vercel).

## Stack

- Next.js 16 (App Router) + React 19, TypeScript strict, Tailwind 4
- Supabase (Postgres + auth + storage). Service role usato lato server.
- `pdf-parse@1.1.1` per estrarre testo dai PDF (v2 esplode su Vercel per via di `DOMMatrix`).
- Anthropic Claude Haiku 4.5 per le decisioni AI (disambigua match, classifica scoperte). Variabile env `ANTHROPIC_API_KEY` su Vercel.

## Struttura del repo

```
src/
  app/
    layout.tsx                       Nav + PeriodoPicker globale
    page.tsx                         Dashboard
    soggetti/page.tsx                Vista per soggetto (~2000 righe, drag&drop, KPI hero, accorpa, tralascia, deep search)
    fatture/page.tsx                 Lista fatture per soggetto
    transazioni/page.tsx             Lista trans per controparte
    fatture-estere/page.tsx          Lista fatture estere
    import/page.tsx                  Pagina import (dinamica da conti_config)
    import/tabelle/page.tsx          Tabelle navigabili import per fonte (filtri, sort, search, paginazione)
    wizard/page.tsx                  Wizard riconciliazione (Step 0-6, ~2500 righe)
    analisi-2025/page.tsx            Vista analisi anno 2025 (legacy)
    api/
      soggetti/route.ts              Lista soggetti + KPI (filtro periodo)
      soggetti/merge/route.ts        Accorpamento soggetti (popola soggetti_alias)
      fatture/route.ts               GET fatture period-aware
      transazioni/route.ts           GET/PATCH/DELETE trans
      transazioni/ignora/route.ts    POST/DELETE tralascia con motivo
      transazioni/assign-soggetto/   POST assegna soggetto a trans
      transazioni/enrich-paypal/     GET enrichment Vimeo via codice PayPal
      transazioni/dedup-paypal/      POST tralascia giroconti wallet PayPal
      riconcilia/route.ts            POST/DELETE singolo abbinamento (scrive soggetti_alias + match_history)
      riconcilia/auto/route.ts       POST auto-match con scoring 0-100 (period-aware)
      riconcilia/lista/route.ts      GET abbinamenti del periodo
      riconcilia/llm-disambiguate/   POST AI valuta suggerimenti incerti
      conti/route.ts                 CRUD conti_config (fonti import)
      import/tabelle/[fonte]/route.ts GET righe import per fonte con filtri/sort/paginazione e totali
      auto-tralascia/route.ts        CRUD regole "tralascia sempre"
      auto-tralascia/apply/route.ts  Applica regole al periodo
      wizard/periodo/route.ts        Stato avanzamento wizard (wizard_periodi)
      wizard/stats/route.ts          KPI periodo (per tile Step 1)
      wizard/crea-fattura-estera/    POST crea fattura estera collegata
      wizard/ai-classifica-scoperte/ POST AI propone categoria/motivo/azione
      import/fatture-sdi/route.ts    POST CSV cassetto fiscale (totale è GENERATED, non passarlo)
      import/paypal/route.ts         POST CSV PayPal (gestisce BOM)
      import/qonto/route.ts          POST PDF Qonto
      import/sella-conto/route.ts    POST PDF Sella conto
      import/sella-carta/route.ts    POST PDF Sella carta
      import/revolut/route.ts        POST PDF Revolut
  lib/
    supabase.ts                      createServerClient(), createBrowserClient()
    types.ts                         Fattura, Transazione, ...
    periodo.ts                       parsePeriodo(slug) → { from, to, label, ... }
    matching.ts                      Scoring 0-100: subject/reference/amount/date
    learning.ts                      Finestra date appresa da match_history
    llm.ts                           Client Anthropic via fetch (no SDK)
    normalize.ts                     normalizeSubject() per match nome
    parsers/
      qonto.ts                       Parser PDF Qonto (formato no-layout di pdf-parse v1)
      sella-conto.ts                 Parser PDF Sella conto corrente
      sella-carta.ts                 Parser PDF Sella carta di credito
      revolut.ts                     Parser PDF Revolut Business
      paypal-csv.ts                  Parser CSV PayPal (gestisce BOM, formato italiano)
      fatture-sdi.ts                 Parser CSV SDI (Windows \r\n, doppi apici)
      import-helpers.ts              extractPdfText() + insertTransazioni() + dedup PayPal auto
  components/
    PeriodoPicker.tsx                Selettore Tutto/Anno/Trimestre/Mese sticky (URL ?periodo=)
supabase-migrations/
  2026-05-29-wizard-periodi.sql      Tabella stato wizard
  2026-05-29-conti-config.sql        Tabella fonti import
  2026-05-29-match-intelligence.sql  soggetti_alias + match_history
  2026-05-29-auto-tralascia-rules.sql Regole "tralascia sempre"
  _all.sql                           Concatenazione di tutte (per setup nuovo DB)
```

## Schema dati Supabase

Tabelle principali (non gestite via migration, esistenti dal day-1):
- `fatture` — id, numero, tipo (emessa/ricevuta), tipo_documento (fattura/nota_credito), totale (**GENERATED ALWAYS AS imponibile + imposta**, NON inserirla esplicitamente), imponibile, imposta, data_emissione, denominazione_cliente, denominazione_fornitore, transazione_id, fonte (sdi/estero), stato_riconciliazione (riconciliata/da_riconciliare/non_trovata/parziale), note, ...
- `transazioni` — id, importo, tipo (entrata/uscita), data, conto, controparte, descrizione, riferimento, note, stato_riconciliazione, ...
- `riconciliazioni` — fattura_id, transazione_id (N:1 supportato)
- `soggetti_cluster` — nome_normalizzato (unique), varianti (TEXT[])

Tabelle aggiunte via migration (da rilanciare se DB nuovo):
- `wizard_periodi` — id, tipo (annuale/trimestrale/mensile), anno, trimestre, mese, step_corrente, completato, trans_estere_queue (UUID[]), updated_at
- `conti_config` — key (PK), label, has_parser, ordine
- `soggetti_alias` — variant_normalizzata, soggetto_canonico, source (manual/auto_match/merge/rename/llm), UNIQUE(variant, canonico)
- `match_history` — fattura_id, transazione_id, soggetto_canonico, giorni_diff, importo_diff, score, source (manual/auto/wizard/llm/unmatch)
- `auto_tralascia_rules` — controparte_normalizzata (PK), controparte_display, motivo, applicazioni, last_applied_at

## Variabili d'ambiente Vercel

- `NEXT_PUBLIC_SUPABASE_URL` — URL del progetto Supabase
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (usata server-side)
- `ANTHROPIC_API_KEY` — per LLM (Disambigua AI, Analizza scoperte)
- `ANTHROPIC_MODEL` (opzionale, default `claude-haiku-4-5-20251001`)

## Convenzioni

- **Italian-first UI** ovunque (labels, motivi tralascia, messaggi feedback).
- **Periodo nell'URL**: `?periodo=tutto` | `2026` | `2026-Q1` | `2026-04`. Tutte le viste leggono questo.
- **Dedup negli import**: chiave `(conto, data, importo, controparte)` per trans, `(tipo, numero, data_emissione)` per fatture. Niente upsert su unique constraint che non esistono.
- **`stato_riconciliazione`**: `da_riconciliare` | `riconciliata` | `parziale` | `non_trovata` (= tralasciato, motivo nel campo `note` come `[Tralasciata: motivo]\n...`).
- **Supabase 1000-row limit**: per query che possono superarle usa `fetchAllPaginated` (in `/api/soggetti` e `riconcilia/auto`). Errore silenzioso se dimenticato.
- **TS strict**: niente `any` non necessari. Per chiamate LLM o callback supabase con tipi opachi, eslint-disable inline.
- **Test build**: `npx tsc --noEmit` prima di ogni push. Build Vercel si rompe spesso su `useSearchParams` senza Suspense.

## Workflow consigliato

### Per una nuova sessione Claude
1. La sessione lavora in una worktree del repo (es. `/Users/vmaretto/.../outputs/admin-posti`).
2. Prima cosa: `git pull origin main` (oppure clone fresco).
3. Legge questo file CLAUDE.md.
4. Lavora normalmente. Commit con messaggio descrittivo, push su main subito (Vercel deploya).

### Per usare Codex (CLI ChatGPT / Claude Code da terminale)
1. Clona il repo (`git clone https://github.com/vmaretto/admin-posti.git`).
2. `cd admin-posti && npm install`.
3. `cp .env.example .env.local`, riempi con le variabili reali.
4. Lavora su un branch per evitare conflitti con sessioni Claude in corso: `git checkout -b feature/<nome>`. Push del branch, apri PR su GitHub, merge.
5. Quando merge → `git checkout main && git pull` per allineare.

### Per evitare conflitti tra sessioni
- Un solo committer su `main` alla volta (pull → push veloce).
- Se due sessioni lavorano in parallelo, una su un branch.
- Le migration SQL sono additive: due sessioni che ne creano due diverse non si pestano i piedi, basta lanciare entrambe su Supabase.

## Setup database da zero (nuovo Supabase)

Lancia in ordine i file in `supabase-migrations/` (o usa `_all.sql` aggregato). Lo schema delle tabelle base (`fatture`, `transazioni`, `riconciliazioni`, `soggetti_cluster`) **NON** è versionato in questo repo — è quello già esistente sul Supabase di pOsti. Se serve ricostruirlo da zero, esporta lo schema con `pg_dump --schema-only`.

## Punti aperti / TODO conosciuti

- [ ] Parser Wise (al momento non richiesto, ma `conti_config` lo accetta come fonte custom).
- [ ] Audit ricavi/costi cross-periodo per cogliere fatture spostate di mese.

## Storico decisioni rilevanti

- **`pdf-parse` v1, non v2** (DOMMatrix mancante in Node serverless).
- **`totale` su `fatture` è GENERATED**: mai inserirlo nei payload.
- **PayPal CSV ha BOM UTF-8**, va rimosso prima del parse.
- **SDI CSV usa `\r\n` + apici doppi+singoli** (`"'F-2026-20'"`), va deserializzato attentamente.
- **Auto-match score**: subject 40 + reference 30 + amount 20 + date 10. Soglia auto 80, suggest 50-79.
- **Tolleranza importo adattiva**: `max(2€, 0.5% del totale fattura)`. Tolleranza data appresa da `match_history` quando ≥3 sample per soggetto.
- **Dedup PayPal a monte**: trans bancarie "PayPal Europe..." con codice transazione che matcha una trans PayPal vengono tralasciate come "Spostamento tra conti" (è il giroconto al wallet, non il pagamento al fornitore vero).

## Comandi utili

```bash
# Setup locale
git clone https://github.com/vmaretto/admin-posti.git
cd admin-posti
npm install
cp .env.example .env.local  # popola
npm run dev                 # http://localhost:3000

# Test type-check (obbligatorio prima di push)
npx tsc --noEmit

# Lint
npx eslint .

# Build locale (per verificare che Vercel non si rompa)
npm run build

# Migration su Supabase: SQL Editor → incolla file da supabase-migrations/
```

## Token / segreti

I segreti (Supabase, Anthropic, GitHub PAT) **NON** vanno in repo. Sono su Vercel Settings → Environment Variables. Per dev locale: `.env.local` (gitignored).

---
Ultimo aggiornamento: chiusura sessione del 29 maggio 2026, commit `c46c7cc`.
