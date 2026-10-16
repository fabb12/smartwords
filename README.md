# Smartwords · Scrivia AI

Editor web in italiano con suggerimenti AI mentre scrivi. Interfaccia a tre pannelli: documenti, pagina di scrittura e assistente. Progetto personale per fabb12.

## Scaricare il progetto

Se stai leggendo questo README sul repository e trovi soltanto l’archivio, scarica `smartwords-source.zip` ed estrailo. Il progetto completo è nella cartella `smartwords/`: apri lì il terminale per i comandi descritti sotto. L’archivio include i sorgenti, il lockfile delle dipendenze, le migrazioni e i test; esclude chiavi API, dati locali e dipendenze installate.

## Versione GitHub Pages

GitHub Pages pubblica solo file statici: non può eseguire il backend (Workers + D1). Per questo esiste una build statica dedicata (`site/`, `vite.pages.config.ts`) in cui:

- documenti, cronologia e profili API sono salvati nel `localStorage` del browser (nessun server, nessun account);
- le richieste AI partono direttamente dal browser verso il provider scelto, con la tua chiave;
- il tema chiaro/scuro/di sistema si cambia con l’icona sole/luna/monitor in alto a destra.

Pubblicazione: in **Settings → Pages → Build and deployment → Source** scegli **GitHub Actions**. Ogni push su `main` esegue `.github/workflows/pages.yml`, che compila con `npm run build:pages` e pubblica la cartella `out-pages`. Il sito sarà su `https://<utente>.github.io/smartwords/`.

Prova in locale: `npm ci && npm run build:pages && npm run preview:pages`.

Attenzione: nella versione statica le chiavi API restano in chiaro nel browser. Usala su un dispositivo personale, con chiavi dotate di limiti di spesa. Alcuni provider potrebbero rifiutare le chiamate dirette dal browser (CORS); OpenAI, Anthropic, Groq, Mistral e OpenRouter le consentono. Esporta regolarmente i documenti: cancellando i dati del sito vengono persi.

## Funzioni

- Completamento in streaming dopo una pausa configurabile di 400–1600 ms.
- Modalità «Migliora frase» automatica: propone una riscrittura del paragrafo fino al cursore.
- Tab accetta la proposta completa; Esc annulla. Le richieste obsolete vengono annullate se il testo o la selezione cambiano. Il testo non viene sostituito senza accettazione.
- Riscrittura, sintesi e tono professionale sul testo selezionato (o sul paragrafo fino al cursore).
- Sette provider: OpenAI, Anthropic, Google Gemini, Groq, Mistral, DeepSeek, OpenRouter. Più profili per provider, modelli modificabili e limite giornaliero di richieste.
- Chiavi cifrate AES-256-GCM sul server, associate all’utente. Solo le ultime quattro cifre vengono restituite al browser. Endpoint dei provider fissi, nessun proxy verso indirizzi arbitrari.
- Editor Tiptap: titoli, grassetto, corsivo, sottolineato, colori, evidenziazione, allineamento, font, elenchi, collegamenti, immagini, tabelle e annulla/ripeti.
- Salvataggio automatico in D1, isolamento per utente e controllo di versione per evitare sovrascritture tra schede.
- Cronologia fino a 30 versioni; conservazione esplicita della versione attuale prima del ripristino.
- Importazione DOCX, TXT e backup JSON Scrivia; esportazione DOCX, HTML, TXT, JSON e stampa/PDF del browser.
- Ricerca e sostituzione, conteggio parole e caratteri, modalità concentrazione.

## Avvio locale

Richiede Node.js 24 LTS (anche i test usano il supporto TypeScript integrato), npm e Git.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_sad_hex.sql
npm run dev
```

Apri l’indirizzo indicato, normalmente `http://127.0.0.1:5173`. L’accesso locale usa l’identità di sviluppo del template Sites e non è un sistema di autenticazione da esporre su Internet.

Per testare i profili API localmente, configura `VAULT_MASTER_KEY` in `.dev.vars` con un valore casuale di almeno 32 caratteri e riavvia il server. Il file è ignorato da Git. In produzione configura il valore come **segreto runtime di Sites**, mai nel codice o nel manifest. Non sostituire la chiave master senza un piano di migrazione: le chiavi già cifrate richiedono quella originale.

## Verifiche

```sh
npm run typecheck
npm test
# Con l’anteprima locale in esecuzione; usa solo il database locale:
node tests/api-smoke.mjs
npm run build
```

I test automatici coprono cifratura e isolamento del vault, parsing SSE frammentato, interruzioni, adapter provider e contenuto DOCX. Lo smoke test verifica autenticazione, origine delle scritture, persistenza, cronologia e conflitti di versione.

## Hosting

React 19 + Tiptap 3, Vinext/Vite, Cloudflare Workers, D1 e autenticazione gestita da Sites. L’integrazione `sites()` in `vite.config.ts` e il manifest `.openai/hosting.json` fanno parte del percorso di pubblicazione. Il repository GitHub conserva il sorgente; GitHub Pages non esegue questo backend. Un push GitHub da solo non aggiorna il sito: occorre una nuova pubblicazione Sites.

L’identità arriva dai soli header iniettati dal gateway Sites (`oai-authenticated-user-id`). Non pubblicare il Worker direttamente su un’origine che permetta ai visitatori di impostare tali header. Tutte le operazioni verificano proprietario e origine; il sito è configurato per accesso privato.

Il testo viene inviato al provider selezionato quando l’AI è attiva. Le richieste automatiche iniziano solo dopo avere configurato un profilo e modificato il testo. Le spese sono a carico dell’account del provider; il limite locale conta i tentativi (inclusi quelli annullati), si azzera a mezzanotte UTC e non equivale a un limite monetario. È presente anche un limite di 30 richieste al minuto per utente. Timeout upstream: 45 secondi. Nessun fallback automatico verso un altro account.

## Limiti della prima versione

Non è una replica completa di Microsoft Word: non include collaborazione simultanea, revisioni con accettazione/rifiuto, commenti condivisi, note a piè di pagina, sommario automatico, intestazioni o impaginazione tipografica avanzata. L’import/export DOCX conserva i contenuti comuni ma non garantisce fedeltà perfetta a documenti complessi. Le immagini esportate hanno dimensioni standard; WebP viene rappresentato con testo alternativo nel DOCX. Il controllo ortografico dipende dal browser. Ricerca limitata a sequenze dentro un singolo nodo di testo (può non trovare parole divise da cambi di formattazione).

Documenti fino a circa 2 MB per richiesta, immagini fino a 800 KB e testo AI fino a 10.000 caratteri per proposta. Non è prevista sincronizzazione offline: in caso di errore di salvataggio viene mostrato un avviso, ed è possibile esportare la copia in memoria. Non sono state eseguite chiamate a pagamento ai provider: la verifica live richiede una chiave valida, un modello disponibile e credito sul relativo account.

## Riferimenti tecnici

- [Tiptap React](https://tiptap.dev/docs/editor/getting-started/install/react)
- [Gemini: compatibilità OpenAI](https://ai.google.dev/gemini-api/docs/openai)
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages)
