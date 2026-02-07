# Admin pOsti - Riconciliazione Fatture

Web app per la gestione e riconciliazione fatture/transazioni di pOsti SRL.

## Setup Database

Prima di usare l'app, crea le tabelle su Supabase:

1. Vai su https://supabase.com/dashboard/project/pwhqkdivgumrsubpinrv/sql
2. Copia il contenuto di `supabase-schema.sql`
3. Incolla e clicca "Run"

## Funzionalità

- **Dashboard**: overview di entrate, uscite, da incassare, da pagare
- **Fatture**: lista fatture emesse/ricevute con filtri
- **Transazioni**: lista transazioni da tutti i conti
- **Riconciliazione**: match automatico fattura↔transazione
- **Import**: importa CSV da SDI e PayPal

## Import Supportati

### Fatture SDI
CSV dal cassetto fiscale con separatore `;`
- Fatture emesse
- Fatture ricevute (fornitori italiani)

### PayPal
CSV export con separatore `,`

### Coming Soon
- Estratti conto PDF (Qonto, Wise, Banca Sella)
- Fatture estere PDF (Amazon, Claude, Microsoft, ecc.)

## Sviluppo Locale

```bash
npm install
npm run dev
```

## Deploy

Deploy automatico su Vercel.
