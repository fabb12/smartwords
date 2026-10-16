# Smartwords · Scrivia AI

Editor web in italiano con suggerimenti AI mentre scrivi. Interfaccia a tre pannelli: documenti, pagina di scrittura e assistente. Progetto personale per fabb12.

## Scaricare il progetto

Se stai leggendo questo README sul repository e trovi soltanto l’archivio, scarica `smartwords-source.zip` ed estrailo. Il progetto completo è nella cartella `smartwords/`: apri lì il terminale per i comandi descritti sotto. L’archivio include i sorgenti, il lockfile delle dipendenze, le migrazioni e i test; esclude chiavi API, dati locali e dipendenze installate.

## Versione GitHub Pages

GitHub Pages pubblica solo file statici: non può eseguire il backend (Workers + D1). Per questo esiste una build statica dedicata (`site/`, `vite.pages.config.ts`) in cui:

- documenti, cronologia e profili API sono salvati nel `localStorage` del browser (nessun server, nessun account);
- le richieste AI partono direttamente dal browser verso il provider scelto, con la tua chiave;
- il tema chiaro/scuro/di sistema si cambia con l’icona sole/luna/monitor in alto a destra.

Pubblicazione: in **Settings → Pages → Build and deployment → Source** scegli **GitHub Actions**. È importante: con «Deploy from a branch» GitHub pubblica a ogni push anche il repository grezzo, in gara con il workflow, e il sito può tornare a una versione vecchia o vuota. Il workflow ora aspetta quella pubblicazione e arriva sempre per ultimo, e mostra un avviso finché la sorgente non è «GitHub Actions». Ogni push su `main` esegue `.github/workflows/pages.yml`, che compila con `npm run build:pages` e pubblica la cartella `out-pages`. Il sito sarà su `https://<utente>.github.io/smartwords/`.

Prova in locale: `npm ci && npm run build:pages && npm run preview:pages`.

## App installabile (PWA)

Scrivia è una Progressive Web App: da Chrome, Edge o Android compare il pulsante **Installa** in alto (o «Installa app» nel menu del browser); su iPhone/iPad si usa **Condividi → Aggiungi alla schermata Home**. L’app si apre a tutto schermo, con la sua icona.

- `public/manifest.webmanifest`: nome, colori e icone (in `public/icons`, rigenerabili con `node scripts/pwa-icons.mjs`).
- Versione: la barra in basso mostra numero, commit e data della build in uso (es. «v0.1.0 · ac7b467 · 16 ott 2026, 13:41»). La build pubblica anche `version.json`; l’app lo controlla all’avvio, ogni 5 minuti e quando torni sulla scheda, e se online c’è una versione più nuova mostra «Aggiorna ora» (salva il documento e ricarica).
- `public/sw.js`: service worker. Nella build GitHub Pages riceve l’elenco di tutti i file della versione (`vite.pages.config.ts`), quindi dopo la prima visita l’app si apre anche **offline**, con i documenti salvati nel browser. Pagine sempre aggiornate quando c’è rete (senza passare dalla cache HTTP); script, stili e immagini serviti dalla cache.
- Non vengono mai messi in cache le chiamate `/api`, le richieste ai provider AI e nulla che provenga da altri domini: senza rete i suggerimenti AI non sono disponibili.
- Nella versione con server il service worker si registra solo in produzione; offline si apre l’app, ma i documenti salvati nel cloud richiedono la connessione.

Attenzione: nella versione statica le chiavi API restano in chiaro nel browser. Usala su un dispositivo personale, con chiavi dotate di limiti di spesa. Alcuni provider potrebbero rifiutare le chiamate dirette dal browser (CORS); OpenAI, Anthropic, Groq, Mistral e OpenRouter le consentono. Esporta regolarmente i documenti: cancellando i dati del sito vengono persi.

## Funzioni

### Compagno di scrittura

L’app comprende il progetto creativo e aiuta a realizzarlo senza sostituirsi all’autore. La specifica completa, con comportamento, interfaccia, dati, motore IA e criteri di verifica di ogni funzione, è in [`docs/SPECIFICA-FUNZIONALE.md`](docs/SPECIFICA-FUNZIONALE.md).

- **Quattro modalità**, da scegliere in cima al pannello:
  - **Libera**: nessun intervento e nessuna chiamata AI;
  - **Assistita**: suggerimenti discreti mentre scrivi;
  - **Co-scrittura**: generazione solo su richiesta;
  - **Revisione**: analisi approfondite.
- **Intenzione della scena**: il tipo di scena (romantica, suspense, mistero, dialogo…) viene riconosciuto in locale e guida i completamenti. Puoi anche sceglierlo tu.
- **Impronta stilistica**: frasi, ritmo, lessico, dialogo, persona e punteggiatura vengono misurati sul manoscritto. Proposte e riscritture la seguono e mostrano quanto ci somigliano.
- **Voci d’autore**: puoi ispirarti a Calvino, Rovelli, Boncinelli, Carrère, Ginzburg, Eco, Ferrante, Baricco, Buzzati, Levi, Pavese, Tabucchi, Morante, Hemingway, Woolf, García Márquez, oppure descrivere uno stile tuo. L’intensità è regolabile; vengono evocati solo i tratti di stile, senza copiare brani.
- **Progetto creativo**: genere, lettori, premessa e note per l’assistente, salvati con il documento.
- **Memoria narrativa con prove**: personaggi, luoghi, oggetti ed eventi, ciascuno con la citazione esatta.
  - Le contraddizioni («Capitolo 1: occhi verdi · Capitolo 2: occhi blu») portano al punto del testo con un clic.
  - Puoi confermarle o ignorarle.
  - Le citazioni che non esistono nel testo vengono scartate.
- **Verifica del passaggio** rispetto al resto del libro: personalità, cronologia, continuità.
- **Simulatore della trama**: tre direzioni con apertura, conseguenze nei capitoli successivi, tensione, rischi e coerenza. Puoi scrivere l’inizio della direzione scelta.
- **Chiedi al manoscritto**: domande come «Quali indizi ho già lasciato sul mistero?». Le risposte citano i passaggi e un clic ti porta lì.

### Editor e AI

- Completamento in streaming dopo una pausa configurabile di 400–1600 ms.
- Modalità «Migliora frase» automatica: propone una riscrittura della frase che stai scrivendo; le frasi già accettate non vengono riproposte e le proposte senza modifiche non compaiono.
- Se l’AI trova un problema (contraddizione con il contesto o la memoria, testo poco chiaro…) lo mostra come avviso separato, nella lingua del testo, e non dentro la proposta.
- Proposte ben visibili: il completamento appare evidenziato nel testo con il tasto «Tab»; nelle correzioni il testo originale è barrato in rosso e la proposta evidenziata in verde, mentre il pannello assistente (fisso in basso) mostra la differenza parola per parola.
- Chiamate AI parsimoniose: le risposte vengono riusate dalla cache (nessuna nuova chiamata per lo stesso testo), continuare a digitare la proposta la accorcia senza richiederne un’altra, le richieste automatiche sono distanziate (almeno 2,5 s, massimo 12 al minuto), «Migliora frase» parte solo a frase conclusa o dopo qualche parola nuova e, dopo errori o limiti del provider (429), le richieste automatiche si fermano con attesa crescente (da 5–20 s fino a 2 minuti).
- Tab accetta la proposta completa; Esc annulla. Le richieste obsolete vengono annullate se il testo o la selezione cambiano. Il testo non viene sostituito senza accettazione.
- Riscrittura, sintesi e tono professionale sul testo selezionato (o sul paragrafo fino al cursore).
- Sette provider: OpenAI, Anthropic, Google Gemini, Groq, Mistral, DeepSeek, OpenRouter. Più profili per provider, modelli modificabili e limite giornaliero di richieste.
- Chiavi cifrate AES-256-GCM sul server, associate all’utente. Solo le ultime quattro cifre vengono restituite al browser. Endpoint dei provider fissi, nessun proxy verso indirizzi arbitrari.
- Editor Tiptap: titoli, grassetto, corsivo, sottolineato, colori, evidenziazione, allineamento, font, elenchi, collegamenti, immagini, tabelle e annulla/ripeti.
- Salvataggio automatico in D1, isolamento per utente e controllo di versione per evitare sovrascritture tra schede.
- Cronologia fino a 30 versioni; conservazione esplicita della versione attuale prima del ripristino.
- Importazione DOCX, TXT e backup JSON Scrivia; esportazione DOCX, HTML, TXT, JSON e stampa/PDF del browser.
- Ricerca e sostituzione, conteggio parole e caratteri, modalità concentrazione e schermo intero (icona in alto a destra; Esc per uscire).
- Vista a pagine: dal menu accanto a «Trova e sostituisci» scegli la vista continua oppure il testo diviso in pagine A4 affiancate, con 1, 2, 3 o 4 pagine visibili insieme (la pagina si rimpicciolisce per farle stare nella finestra; le altre si raggiungono scorrendo in orizzontale). La scelta resta memorizzata nel browser.
- Ogni comando mostra un suggerimento (tooltip) che spiega a cosa serve, al passaggio del mouse o con la tastiera.
- I nuovi documenti partono da un foglio vuoto, senza testo preimpostato.

## Avvio locale

Richiede Node.js 24 LTS (anche i test usano il supporto TypeScript integrato), npm e Git.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_sad_hex.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_story_projects.sql
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

I test automatici coprono le analisi narrative locali (capitoli, prove con posizione esatta, impronta, intenzione, contraddizioni, ricerca e citazioni, voci), cifratura e isolamento del vault, parsing SSE frammentato, interruzioni, adapter provider e contenuto DOCX. Lo smoke test verifica autenticazione, origine delle scritture, persistenza, cronologia e conflitti di versione.

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
