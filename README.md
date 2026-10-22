# Smartwords · Scrivia AI

Editor web in italiano con suggerimenti AI mentre scrivi. Interfaccia a tre pannelli: documenti, pagina di scrittura e assistente. Progetto personale per fabb12.

## Scaricare il progetto

Se stai leggendo questo README sul repository e trovi soltanto l’archivio, scarica `smartwords-source.zip` ed estrailo. Il progetto completo è nella cartella `smartwords/`: apri lì il terminale per i comandi descritti sotto. L’archivio include i sorgenti, il lockfile delle dipendenze, le migrazioni e i test; esclude chiavi API, dati locali e dipendenze installate.

## Versione GitHub Pages

GitHub Pages pubblica solo file statici: non può eseguire il backend (Workers + D1). Per questo esiste una build statica dedicata (`site/`, `vite.pages.config.ts`) in cui:

- documenti, cronologia e profili API sono salvati nel `localStorage` del browser (nessun server, nessun account);
- i documenti possono anche essere salvati e caricati da un repository GitHub per trasferirli fra dispositivi, con i comandi descritti sotto;
- le richieste AI partono direttamente dal browser verso il provider scelto, con la tua chiave;
- il tema chiaro/scuro/di sistema si cambia con l’icona sole/luna/monitor in alto a destra.

Pubblicazione: in **Settings → Pages → Build and deployment → Source** scegli **GitHub Actions**. È importante: con «Deploy from a branch» GitHub pubblica a ogni push anche il repository grezzo, in gara con il workflow, e il sito può tornare a una versione vecchia o vuota. Il workflow ora aspetta quella pubblicazione e arriva sempre per ultimo, e mostra un avviso finché la sorgente non è «GitHub Actions». Ogni push su `main` esegue `.github/workflows/pages.yml`, che compila con `npm run build:pages` e pubblica la cartella `out-pages`. Il sito sarà su `https://<utente>.github.io/smartwords/`.

Prova in locale: `npm ci && npm run build:pages && npm run preview:pages`.

## App installabile (PWA)

Scrivia è una Progressive Web App: da Chrome, Edge o Android compare il pulsante **Installa** in alto (o «Installa app» nel menu del browser); su iPhone/iPad si usa **Condividi → Aggiungi alla schermata Home**. L’app si apre a tutto schermo, con la sua icona.

Su telefono il pulsante **Installa** è sempre in alto: dove il browser lo permette (Chrome, Edge, Samsung Internet su Android) apre direttamente l’installazione, altrimenti (Safari su iPhone/iPad, Firefox) mostra i passaggi illustrati. Il pulsante sparisce quando l’app è già aperta dall’icona.

### Modalità semplice per telefono

Sugli schermi fino a 720 px l’app passa da sola a una modalità semplificata, pensata per il tocco:

- in alto solo ☰ (documenti), il titolo, **Installa** e ⋯ (tutte le altre azioni: importa, trova, cronologia, provider, tema, esporta in Word/PDF/testo/backup);
- il foglio occupa tutto lo schermo, con testo più grande;
- in basso una barra con annulla, ripeti, grassetto, corsivo, titoletto, elenco e il pulsante **AI**, che resta sopra la tastiera;
- le proposte dell’AI compaiono sopra la barra con i pulsanti grandi **Accetta** e **Scarta** (sul telefono non c’è il tasto Tab);
- documenti e assistente si aprono come pannelli dal basso o dal lato, con controlli ingranditi.

### Dettatura vocale

Il pulsante con il microfono (nella barra di formattazione e, su telefono, nella barra in basso) scrive al cursore quello che dici, in italiano. Mentre ascolta compare una barra con la frase che sta riconoscendo e il pulsante **Ferma**; dopo una lunga pausa si ferma da sola.

- Punteggiatura a voce: «virgola», «punto», «punto e virgola», «due punti», «punto interrogativo», «punto esclamativo», «puntini», «apri/chiudi virgolette» («…»), «apri/chiudi parentesi»; «a capo» o «nuovo paragrafo» iniziano un nuovo paragrafo. Spazi e maiuscole a inizio frase sono automatici.
- Usa il riconoscimento vocale del browser (Chrome, Edge, Safari; non Firefox), che invia l’audio al servizio del browser e richiede la connessione. Al primo uso il browser chiede il permesso per il microfono.
- Nell’app desktop il pulsante non compare: Electron non include il servizio di riconoscimento.

Dal menu ⋯ si passa alla **vista completa** con tutti gli strumenti; il pulsante «Semplice» in alto riporta indietro. La scelta resta memorizzata sul dispositivo.

- `public/manifest.webmanifest`: nome, colori e icone (in `public/icons`, rigenerabili con `node scripts/pwa-icons.mjs`).
- Versione: la barra in basso mostra numero, commit e data della build in uso (es. «v0.1.0 · ac7b467 · 16 ott 2026, 13:41»). La build pubblica anche `version.json`; l’app lo controlla all’avvio, ogni 5 minuti e quando torni sulla scheda, e se online c’è una versione più nuova mostra «Aggiorna ora» (salva il documento e ricarica).
- `public/sw.js`: service worker. Nella build GitHub Pages riceve l’elenco di tutti i file della versione (`vite.pages.config.ts`), quindi dopo la prima visita l’app si apre anche **offline**, con i documenti salvati nel browser. Pagine sempre aggiornate quando c’è rete (senza passare dalla cache HTTP); script, stili e immagini serviti dalla cache.
- Non vengono mai messi in cache le chiamate `/api`, le richieste ai provider AI e nulla che provenga da altri domini: senza rete i suggerimenti AI non sono disponibili.
- Nella versione con server il service worker si registra solo in produzione; offline si apre l’app, ma i documenti salvati nel cloud richiedono la connessione.

## App desktop (Electron)

Oltre alla PWA esiste un’app desktop per Windows, macOS e Linux (cartella `desktop/`). È la stessa build di GitHub Pages impacchettata con Electron, e rispetto al browser gestisce meglio le risorse online:

- **Provider AI senza blocchi CORS**: le chiamate partono dall’app come da un server, quindi funzionano anche i provider che rifiutano le richieste dal browser.
- **Chiavi API cifrate** con il portachiavi del sistema (Windows DPAPI, Portachiavi macOS, Secret Service su Linux) invece che in chiaro.
- **Offline per costruzione**: tutti i file sono nell’app, senza service worker né cache del browser che possano servire una versione vecchia; i documenti restano in un’origine fissa (`app://scrivia`) e sopravvivono agli aggiornamenti.
- **Aggiornamenti automatici** da GitHub Releases (Windows e AppImage Linux; su macOS serve un’app firmata, quindi si riscarica il `.dmg`).

Il pulsante **App desktop** in alto (visibile su computer, non su telefoni e tablet, e non dentro l’app stessa) scarica l’installer giusto per il sistema in uso, preso dall’ultima release del repository. Se non c’è ancora una release il pulsante non compare. I documenti del browser non vengono copiati nell’app: esportali con «Backup Scrivia» e reimportali.

Pubblicare una versione: aggiorna `version` in `package.json` e crea il tag, ad esempio `git tag v0.2.0 && git push origin v0.2.0`, oppure avvia a mano **Actions → App desktop → Run workflow**. Il workflow `.github/workflows/desktop.yml` compila `Scrivia-Setup.exe`, `Scrivia.dmg` e `Scrivia.AppImage` e li pubblica nella release `v<versione>`. Le app non sono firmate: Windows SmartScreen e macOS Gatekeeper mostrano un avviso al primo avvio (su macOS: clic destro → Apri).

Prova in locale: `npm run build:pages`, poi in `desktop/` `npm ci && npm start` (o `npm run dist` per creare l’installer del sistema in uso in `desktop/release/`).

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
- **Memoria della mia voce**: un profilo persistente raccoglie campioni dei testi che apri e salvi, riconosce ritmo ed espressioni ricorrenti e guida i completamenti anche in un documento nuovo. Dal menu «La mia voce» puoi includere i documenti già salvati, descrivere la personalità della voce, escludere testi, disattivare gli esempi o azzerare la memoria.
- **Knowledge base di stile e mentalità**: carica PDF, Word, ODT, EPUB, RTF, HTML, Markdown o testo, tuoi o di un autore. Scrivia ne estrae stile, mentalità e temi e le previsioni seguono quella voce; un indicatore compatto sopra il foglio mostra sempre quale fonte sta guidando l’AI e pulsa mentre prevede. Dettagli sotto.
- **Voci d’autore**: puoi ispirarti a Calvino, Rovelli, Boncinelli, Carrère, Ginzburg, Eco, Ferrante, Baricco, Buzzati, Levi, Pavese, Tabucchi, Morante, Hemingway, Woolf, García Márquez, oppure descrivere uno stile tuo. L’intensità è regolabile; vengono evocati solo i tratti di stile, senza copiare brani.
- **Mix di autori**: apri il chip «Voce» → **Mix di autori**, seleziona da due a quattro autori e regola i pesi. Le percentuali indicano il contributo relativo di ciascuno; l’intensità regola quanto il mix influenza la tua voce. Previsioni, riscritture e scene usano un’unica voce composta. Scelta e pesi restano nel progetto e nei documenti salvati su GitHub.
- **Progetto creativo**: genere, lettori, premessa e note per l’assistente, salvati con il documento.
- **Memoria narrativa con prove**: personaggi, luoghi, oggetti ed eventi, ciascuno con la citazione esatta.
  - Le contraddizioni («Capitolo 1: occhi verdi · Capitolo 2: occhi blu») portano al punto del testo con un clic.
  - Puoi confermarle o ignorarle.
  - Le citazioni che non esistono nel testo vengono scartate.
- **Verifica del passaggio** rispetto al resto del libro: personalità, cronologia, continuità.
- **Simulatore della trama**: tre direzioni con apertura, conseguenze nei capitoli successivi, tensione, rischi e coerenza. Puoi scrivere l’inizio della direzione scelta.
- **Chiedi al manoscritto**: domande come «Quali indizi ho già lasciato sul mistero?». Le risposte citano i passaggi e un clic ti porta lì.

### Editor e AI

- **Comandi a icone**: salvataggio, caricamento, ricerca, voce, knowledge base, caratteri, allineamento, elenchi e inserimento sono visibili sulla barra, con nome e descrizione al passaggio del mouse o al focus da tastiera. **Visualizza** (icona occhio) permette di mostrare/nascondere i gruppi, i pannelli e le informazioni del documento; «Mostra tutti gli strumenti» li riattiva insieme. Entrando a schermo intero restano salvataggio, AI, annulla/ripeti, dettatura, grassetto/corsivo, zoom, Visualizza e uscita; gli altri si possono sempre riattivare. Uscendo torna la configurazione normale. Le scelte di visibilità valgono per la sessione.
- **Barre spostabili**: i comandi condividono una sola riga quando c’è spazio e vanno a capo insieme quando la finestra si restringe. Trascina la maniglia puntinata di un gruppo per riordinarlo, agganciarlo in alto/in basso/a sinistra/a destra o lasciarlo flottante sul documento. Un clic sulla maniglia offre le stesse posizioni e «Sposta prima/dopo»; da tastiera usa Spazio e frecce, Esc per annullare, oppure Freccia giù per il menu. **Visualizza → Ripristina posizione strumenti** riporta tutti i gruppi in alto. Le posizioni sono ricordate per utente su questo dispositivo, con disposizioni separate per vista normale e schermo intero. La modalità semplice del telefono mantiene i propri comandi. [Librerie valutate e dettagli](docs/TOOLBAR-LAYOUT.md).
- **Preset dell’area di lavoro** (icona riquadri): Scrittura, Revisione, Impaginazione e Completo configurano pannelli, strumenti, vista e zoom. Puoi salvare fino a 20 disposizioni personalizzate, compresi i gruppi trascinati e le palette flottanti. I preset e l’ultima disposizione restano sul dispositivo per utente; vista normale e schermo intero mantengono configurazioni separate. I preset cambiano l’interfaccia, senza modificare il manoscritto.
- **Navigazione documento** (icona struttura): il pannello ha le schede Struttura, Pagine e Risultati. Assegna al paragrafo corrente il ruolo di Capitolo (Titolo 1), Sezione (Titolo 2), Sottosezione (Titolo 3) o Corpo del testo; la struttura si aggiorna durante la scrittura. Espandi/comprimi i capitoli e premi una voce per raggiungerla. Puoi mostrare anche i paragrafi. La ricerca trova frasi attraverso grassetti e corsivi; i risultati selezionano il passaggio nell’editor. Le schede delle pagine A4 portano all’inizio della pagina; nella vista continua puoi attivare l’A4 dal pannello. Sul telefono trovi Navigazione e Preset nel menu ⋯.
- **Zoom pagina**: usa − / + o scegli una percentuale fino al 250%, «Pagina intera» o «Larghezza pagina». La scelta resta sul dispositivo e vale per le viste A4, comprese quelle affiancate. Lo zoom ingrandisce la visualizzazione senza modificare font, contenuto o numero di pagine; le pagine grandi scorrono dentro l’area di scrittura.
- **Brani lunghi**: puoi correggere fino a 10.000 caratteri per richiesta. Oltre il limite compare un avviso sopra il documento e il testo resta intatto. Il budget di risposta cresce con il brano; per testi lunghi l’attesa massima dei provider cloud è di 120 secondi. Lo stato e «Annulla» restano visibili; risposte interrotte o troncate non si possono accettare. Le anteprime lunghe restano nel pannello, evitando di duplicarle dentro il manoscritto durante lo streaming.
- Salvataggio automatico dopo le modifiche, più un controllo di salvataggio di documento e progetto ogni **5 minuti**, anche durante la scrittura continua. I salvataggi usano il browser nella versione statica/desktop e il cloud nella versione con account.
- **Pagine A4 automatiche**: la vista «1 pagina» adatta un foglio A4 intero alla finestra, con bordi, margini, ombra e numero di pagina. I fogli successivi sono separati e disposti in verticale. Quando il testo raggiunge il margine inferiore, prosegue sul foglio successivo, anche dentro un paragrafo lungo; cancellando testo le pagine superflue scompaiono. La capienza dipende da font e dimensione del testo, come in Word. È la vista iniziale sul desktop; restano disponibili la vista continua e le viste affiancate. Cornici, numeri e interruzioni visive non vengono salvati nel testo né esportati come righe vuote. Su telefono la modalità semplice conserva la vista continua.
- Avvio AI a scelta: dopo una pausa configurabile di 400–1600 ms oppure **solo quando premi Tab**, dal pannello Assistita o da Impostazioni → Aspetto ed editor. In modalità Tab, il primo Tab richiede la proposta, il successivo la accetta quando è pronta; durante l’attesa non partono richieste duplicate. Su telefono usa **Chiedi ora**. Shift+Tab e la navigazione nelle tabelle restano disponibili.
- In «Completa», la continuazione include anche le correzioni di refusi, errori ortografici e ripetizioni accidentali nella frase corrente. Le modifiche sono mostrate nella proposta e applicate insieme alla continuazione solo con Tab o «Accetta»; significato, voce e ripetizioni intenzionali vanno preservati.
- Modalità «Migliora frase» automatica: propone una riscrittura della frase che stai scrivendo; le frasi già accettate non vengono riproposte e le proposte senza modifiche non compaiono.
- **Sistema formattazione** (icona pennello): scegli **Testo selezionato**, **Pagina corrente** nelle viste A4, oppure **Documento intero**. L’AI ricostruisce la scaletta del testo: riconosce titolo, sottotitoli e titoli minori (anche quando il testo non ha formattazione), divide i paragrafi a ogni cambio di argomento e mette in risalto i concetti in base all’importanza (**grassetto** per i concetti chiave, *corsivo* per l’enfasi secondaria, evidenziazione per l’idea principale di ogni sezione), senza correggere né riscrivere le parole. Il riconoscimento funziona anche su selezioni brevi o su un titolo isolato: l’AI distingue le etichette di argomento dalle normali frasi di prosa. Dove una sezione non ha titolo, l’AI può **proporne** uno breve: nell’anteprima è segnato «proposto» e puoi includerlo o escluderlo con una casella prima di accettare. Le maiuscole dei titoli seguono l’importanza: titolo principale in MAIUSCOLO, sottotitoli e titoli minori con l’iniziale maiuscola. L’evidenziazione usa un ambra trasparente, leggibile sia sul foglio chiaro sia su quello scuro. Sistema anche la tipografia: titoli più grandi, testo corrente leggibile e, quando utile, un carattere o un colore coerente. Il pannello a destra mostra un riepilogo compatto: conteggi, struttura dei titoli e concetti in evidenza; l’anteprima del testo è richiudibile e scorre per passaggi. Il documento intero viene diviso in passaggi, ognuno con la scaletta dei precedenti per mantenere coerenti i livelli dei titoli; accetti tutto con un gesto, annullabile con Annulla. L’AI restituisce un piano con i riferimenti alle parole originali: struttura, enfasi e tipografia vengono applicate dall’app senza far riscrivere il brano al modello. Un piano incompleto non viene applicato. Immagini e collegamenti vengono conservati; il carattere esistente resta disponibile se l’AI non ne sceglie uno diverso; codice e paragrafi con elementi incorporati non vengono sostituiti. Il comando usa il provider selezionato e mostra l’avanzamento e Annulla durante l’attesa.
- **Immagini da file e appunti**: usa le icone immagine e appunti, oppure Incolla nell’editor (Ctrl+V/⌘V). Sono accettati PNG, JPEG, WebP e AVIF fino a 12 MB e 40 megapixel; l’immagine viene ottimizzata sul dispositivo, centrata e dimensionata per i margini A4, senza deformazioni. Le dimensioni vengono salvate con il documento e rispettate nell’esportazione Word. Sul telefono i comandi sono anche nel menu ⋯; se l’accesso diretto agli appunti è negato restano Incolla e il selettore file.
- **Migliora selezione con AI**: seleziona anche un brano precedente e premi il pulsante sopra il documento. In Assistita con avvio su Tab puoi premere direttamente Tab sulla selezione. La proposta sostituisce soltanto l’intervallo selezionato, dopo accettazione; il testo circostante resta al suo posto. Il pulsante è disponibile anche in Libera e Revisione, sempre su richiesta esplicita.
- **Sistema anche la formattazione**, attivo inizialmente nelle impostazioni dell’editor: in Completa e Migliora frase l’AI può organizzare paragrafi, titoli, elenchi, **grassetti** e *corsivi* secondo significato, gerarchia e importanza. La proposta mostra la formattazione prima di applicarla con Accetta o Tab; non si inseriscono marcatori Markdown nel documento. In Completa può rivedere il paragrafo prima del cursore; il testo successivo viene conservato. Puoi disattivare l’opzione per le proposte di solo testo. Le preferenze restano su questo dispositivo, separate per utente.
- Se l’AI trova un problema (contraddizione con il contesto o la memoria, testo poco chiaro…) lo mostra come avviso separato, nella lingua del testo, e non dentro la proposta.
- Proposte ben visibili: con la formattazione attiva, Completa e Migliora frase mostrano l’anteprima impaginata da accettare; anche una risposta senza enfasi può eliminare grassetti o titoli inappropriati. Sono riconosciuti grassetto/corsivo con asterischi o trattini bassi. La previsione breve appare di nuovo nel documento anche con la formattazione attiva: il testo è un’anticipazione da accettare con Tab o Accetta. Se il pannello AI è nascosto, una proposta compatta resta visibile in basso. Le riscritture di solo testo mostrano anche la differenza parola per parola.
- Chiamate AI parsimoniose: le risposte vengono riusate dalla cache (nessuna nuova chiamata per lo stesso testo), continuare a digitare la proposta la accorcia senza richiederne un’altra, le richieste automatiche sono distanziate (almeno 2,5 s, massimo 12 al minuto), «Migliora frase» parte solo a frase conclusa o dopo qualche parola nuova e, dopo errori o limiti del provider (429), le richieste automatiche si fermano con attesa crescente (da 5–20 s fino a 2 minuti).
- Tab accetta la proposta completa; Esc annulla. Le richieste obsolete vengono annullate se il testo o la selezione cambiano. Il testo non viene sostituito senza accettazione.
- Riscrittura, sintesi e tono professionale sul testo selezionato (o sul paragrafo fino al cursore).
- Sette provider: OpenAI, Anthropic, Google Gemini, Groq, Mistral, DeepSeek, OpenRouter. Più profili per provider, modelli modificabili e limite giornaliero di richieste.
- Selezione del modello da un elenco per provider, comprese diverse versioni di Claude Sonnet, Haiku e Opus; resta disponibile l’identificativo personalizzato. L’accesso a ciascun modello dipende dal provider e dal proprio account; i modelli meno recenti possono essere ritirati.
- **Consumo token nelle impostazioni**: ingresso, uscita, totale e richieste, con dettaglio per provider e modello e filtri per oggi (UTC), 7, 30 o 90 giorni. Usa i conteggi dichiarati dal provider, compresi i token letti dalla cache (già inclusi nell’ingresso). Dove mancano, mostra esplicitamente le stime basate sui caratteri del prompt completo e della risposta ricevuta; registra anche le risposte interrotte. Le risposte riutilizzate dalla cache di Scrivia non aggiungono consumi. Lo storico inizia con questa funzione, resta su questo dispositivo per 90 giorni ed è separato per utente; non è sincronizzato né inserito nei documenti GitHub. Le richieste interrotte prima di ricevere una risposta possono non essere registrate. Per gli addebiti fa fede il provider.
- **Ollama e LM Studio sul dispositivo**: in «Impostazioni → Provider AI» scegli il servizio locale; i modelli installati vengono cercati automaticamente. Se necessario indica l’indirizzo e premi «Verifica connessione», poi scegli il modello dall’elenco e salva. Il profilo viene verificato prima del salvataggio. Il collegamento parte dal dispositivo anche nella versione con documenti cloud; profilo e token locale facoltativo restano su quel dispositivo. Non servono credenziali Cloudflare o una chiave di un provider cloud.
- Chiavi cifrate AES-256-GCM sul server, associate all’utente. Solo le ultime quattro cifre vengono restituite al browser. Endpoint dei provider fissi, nessun proxy verso indirizzi arbitrari.
- Editor Tiptap: titoli, grassetto, corsivo, sottolineato, colori, evidenziazione, allineamento, font, elenchi, collegamenti, immagini, tabelle e annulla/ripeti.
- Salvataggio automatico in D1, isolamento per utente e controllo di versione per evitare sovrascritture tra schede.
- Cronologia fino a 30 versioni; conservazione esplicita della versione attuale prima del ripristino.
- Importazione DOCX, TXT e backup JSON Scrivia; esportazione DOCX, HTML, TXT, JSON e stampa/PDF del browser.
- Ricerca e sostituzione, conteggio parole e caratteri, modalità concentrazione e schermo intero (icona in alto a destra; Esc per uscire).
- Vista a pagine: dal menu accanto a «Trova e sostituisci» scegli la vista continua oppure il testo diviso in pagine A4, con 1, 2, 3, 4 o 6 pagine visibili insieme. Con più pagine i fogli formano una griglia: al massimo due colonne, poi nuove righe (pagine 1-2 nella prima riga, 3-4 nella seconda…); la pagina si rimpicciolisce per far stare le righe scelte nella finestra e le altre si raggiungono scorrendo in verticale. La griglia richiede un browser con `column-wrap` (Chrome/Edge 145+ e l’app desktop); altrove le pagine restano affiancate in orizzontale. La scelta resta memorizzata nel browser.
- Ogni comando mostra un suggerimento (tooltip) che spiega a cosa serve, al passaggio del mouse o con la tastiera.
- I nuovi documenti partono da un foglio vuoto, senza testo preimpostato.

### Scorciatoie da tastiera

Con il cursore nel documento (su Mac usa ⌘ al posto di Ctrl). Il riepilogo è disponibile da **Visualizza → Scorciatoie da tastiera** o **F1**, e nelle altre azioni della vista semplice.

| Scorciatoia | Azione |
| --- | --- |
| Maiusc + Tab | Formatta la selezione, oppure tutto il documento |
| Ctrl + Maiusc + F | Formatta il documento intero |
| Ctrl + Alt + P | Formatta la pagina A4 corrente |
| Ctrl + Invio | Chiedi una continuazione AI |
| Ctrl + Maiusc + Invio | Migliora la selezione o la frase |
| Tab / Esc | Accetta / scarta la proposta (Tab può anche attivare l’AI, secondo le impostazioni) |
| Ctrl + S / Ctrl + F | Salva / trova e sostituisci |
| Ctrl + B / I / U | Grassetto / corsivo / sottolineato |
| Ctrl + Alt + 1 / 2 / 3 / 0 | Titolo / sottotitolo / titolo minore / paragrafo |
| Ctrl + Z / Ctrl + Maiusc + Z | Annulla / ripeti |

La formattazione mostra sempre un’anteprima da accettare. Nelle tabelle Maiusc+Tab conserva la navigazione alla cella precedente; fuori dal documento mantiene la normale navigazione tra i controlli. Ogni proposta AI accettata si annulla separatamente dal testo scritto prima.

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

### La mia voce: memoria personale di scrittura

Apri **La mia voce** dal menu di scrittura, dall’assistente o, sul telefono, dal menu ⋯. L’apprendimento è attivo inizialmente: analizza in locale campioni dei documenti aperti e salvati, senza effettuare chiamate AI. Per includere i testi già presenti nella libreria, premi **Impara dai documenti salvati**: legge fino a 40 documenti recenti, rispettando le esclusioni.

Il profilo ricorda lunghezza e variazione delle frasi, paragrafi, lessico, dialogo, persona narrativa, punteggiatura ed espressioni ricorrenti. In **Personalità della voce** puoi aggiungere o correggere le tue preferenze, per esempio «diretto e curioso, ironia leggera, immagini concrete». La memoria usa campioni limitati, aggiorna il testo quando lo modifichi e non conta due volte le copie identiche. Da 80 parole campionate inizia a guidare i suggerimenti; sotto 300 parole l’impronta resta provvisoria. Le preferenze espresse da te funzionano anche senza campioni.

Nei completamenti, riscritture, scene e direzioni, l’AI riceve la descrizione della voce ed eventualmente fino a tre brevi esempi dei testi inclusi. La scena corrente, i fatti e la voce narrativa scelta per il progetto hanno la precedenza. Gli esempi guidano l’espressione, senza trasferire personaggi o fatti da un altro documento. Il profilo aiuta a mantenere la tua voce: non garantisce di prevedere esattamente la frase che avevi in mente. Il testo viene applicato solo quando accetti la proposta.

Puoi escludere il documento aperto o rimuovere singoli testi dall’apprendimento, usare soltanto i tratti senza inviare esempi, disattivare l’intera memoria e cancellarla. **Azzera memoria** elimina campioni e preferenze e disattiva l’apprendimento, conservando i documenti nell’app.

La memoria resta nel browser o nell’app desktop dopo la riapertura; nella versione con server è separata per utente sul dispositivo. Per trasferirla, usa **Esporta profilo** e **Importa profilo** su un altro dispositivo: il file include preferenze e campioni dei testi selezionati. Il profilo non viene inserito automaticamente nei documenti GitHub e non viene sincronizzato dal backend. Cancellare i dati del browser elimina anche la memoria locale; conserva un’esportazione se vuoi recuperarla.

### Knowledge base di stile e mentalità

Apri **Knowledge base** (icona libro nella barra), dal pannello assistente o, sul telefono, dal menu ⋯.

1. Crea una knowledge base **personale** (i tuoi testi) o **d’autore** (testi di un altro autore) e indica nome e autore.
   Per crearla subito dagli appunti, compila **Testo da incollare** oppure premi **Incolla dagli appunti**, poi **Crea knowledge base dal testo**. Se l’accesso agli appunti è negato, usa Ctrl+V, ⌘V o il comando Incolla del dispositivo. Servono almeno 20 parole; il testo non viene salvato se supera 2.500.000 caratteri o la capacità della KB. I duplicati vengono rifiutati. Puoi aggiungere altri testi anche a una KB esistente tramite **Incolla un testo in questa knowledge base**, con titolo facoltativo. File e testi compaiono insieme nelle **Fonti** e vengono conservati sul dispositivo, esportati e rimossi nello stesso modo.
2. Aggiungi i file, anche più insieme: PDF con testo selezionabile, DOCX, ODT, EPUB, RTF, HTML, Markdown, TXT, CSV o documenti Scrivia `.json`, fino a 100 MB ciascuno. L’estrazione avviene nel browser.
3. Scrivia misura subito, senza AI, **stile** (frasi, ritmo, lessico, narratore), **mentalità** (dubitativa o assertiva, argomentativa, dialettica, interrogativa, concreta o concettuale, registro emotivo), **temi** ed **espressioni ricorrenti**.
4. Facoltativo: **Distilla con l’AI** fa una sola chiamata su un campione rappresentativo e produce un profilo di personalità (mentalità, valori, registro emotivo, modo di ragionare, temi, voce, lessico, cosa evita), che puoi correggere.
5. Scegli **Usa per le previsioni**. La scelta resta memorizzata sul dispositivo; «Nessuna» torna a «La mia voce» o alla voce d’autore del progetto.

**Quale fonte sta usando l’AI.** Sopra il foglio (su telefono in alto a destra) un piccolo indicatore mostra la fonte attiva: **KB personale** in verde, **KB autore** o voce d’autore famoso in viola, **La mia voce** in blu, solo il documento in grigio. Mentre l’AI prevede o corregge, l’indicatore pulsa e compare anche nell’intestazione della proposta. Un clic apre la gestione.

**Token.** Lo schema è quello di LangChain (suddividi → indicizza → recupera), eseguito sul dispositivo senza librerie pesanti: i testi sono divisi in blocchi da circa 900 caratteri; a ogni richiesta partono solo il profilo compatto e i 2–3 passaggi più pertinenti al testo che stai scrivendo, scelti con BM25 (circa 300–1100 token invece dell’intero corpus). La finestra mostra la stima. Quando una knowledge base è attiva, «La mia voce» non viene inviata, per non duplicare.

Testi e indice restano nel dispositivo (IndexedDB); per trasferirli usa **Esporta** e **Importa**. Per le knowledge base d’autore usa testi che possiedi o di libero uso: le proposte evocano stile e mentalità senza copiare frasi. Il profilo descrive l’autore come appare nei testi, senza giudizi clinici. Limiti: 12 knowledge base, circa 1,4 milioni di caratteri ciascuna; i PDF scansionati senza testo non sono leggibili.

### Documenti su GitHub, da più dispositivi

«Salva su GitHub» e «Carica da GitHub» sono le icone salva e cartella nella barra e, sul telefono, nel menu ⋯. Il salvataggio automatico nell’app continua normalmente; GitHub viene aggiornato solo quando premi il comando esplicito, con un commit per salvataggio.

1. Apri uno dei due comandi e indica il repository (`proprietario/nome`) e il ramo. I valori iniziali sono `fabb12/smartwords` e `documenti-scrivia`; puoi scegliere un repository diverso, preferibilmente privato per i tuoi manoscritti. Su un repository pubblico anche i documenti saranno pubblici.
2. Crea nelle impostazioni GitHub un **fine-grained personal access token** limitato a quel repository, con **Contents: Read and write**, e inseriscilo nella finestra dell’app. Il repository deve avere almeno un commit iniziale (per esempio un README). Il ramo dei documenti viene creato al primo salvataggio, se manca.
3. Premi «Collega GitHub», poi «Salva su GitHub». Il file in `scrivia-documents/<id>.json` contiene testo, formattazione, titolo e progetto creativo, senza profili o chiavi AI.
4. Sull’altro dispositivo collega lo stesso repository e ramo, poi scegli «Carica» dall’elenco. Per vedere le modifiche successive, aggiorna l’elenco e carica di nuovo il documento. Non è un editor collaborativo in tempo reale.

I controlli di versione impediscono che un dispositivo sovrascriva una versione GitHub più recente, anche se cambia durante il salvataggio. Puoi caricare la versione aggiornata oppure usare «Salva una copia». Se sul dispositivo ci sono modifiche non ancora inviate, caricare da GitHub le conserva in un documento separato nell’app; se la copia locale non era cambiata, il documento viene aggiornato mantenendo la versione precedente nella cronologia.

Il token parte direttamente dal browser o dall’app desktop verso `api.github.com`, senza passare dal backend di Scrivia. Per impostazione predefinita dura fino alla chiusura o al ricaricamento della pagina; con «Ricorda il token» resta nel browser, oppure cifrato con il portachiavi nell’app desktop. «Scollega» rimuove il token dal dispositivo senza cancellare i documenti su GitHub. Servono connessione e un token valido su ogni dispositivo; gli errori di rete o autorizzazione conservano la copia nell’app. Limiti dell’archivio: 2 MB per documento completo e meno di 1000 file nella cartella. La funzione è verificata con API GitHub simulate, senza pubblicare documenti reali durante i test.

### Modelli locali: Ollama e LM Studio

- **Ollama**: scarica un modello (ad esempio `ollama pull llama3.2`), avvia il servizio locale sulla porta predefinita 11434 e usa `http://127.0.0.1:11434` nel profilo. Per la versione browser, configura `OLLAMA_ORIGINS` con l’origine esatta da cui apri Scrivia e riavvia Ollama. In sviluppo è normalmente `http://127.0.0.1:5173`; su GitHub Pages è `https://<utente>.github.io` (senza `/smartwords/`).
- **LM Studio**: scarica un modello, apri **Developer → Start Server** (porta predefinita 1234) e indica `http://127.0.0.1:1234`. Abilita **Just-In-Time** per caricare automaticamente il modello scelto, oppure caricalo manualmente. Abilita **Enable CORS** se usi il browser. Se hai attivato l’autenticazione del server, inserisci il suo token nel profilo.

Ollama elenca i modelli installati tramite `/api/tags`; LM Studio usa `/api/v0/models`, includendo anche quelli non ancora caricati ed escludendo i modelli solo embedding. I server meno recenti possono usare il fallback `/v1/models`. La generazione usa `/v1/chat/completions`. Nell’app desktop aggiornata queste richieste passano tramite un trasporto nativo in streaming e non richiedono CORS; per distribuire questa correzione occorre ricompilare e pubblicare gli installer, non solo aggiornare il sito.

Nel browser apri **Come collegare il server**: trovi i passi per LM Studio e i comandi Ollama per Windows, macOS e Linux, con l’origine esatta della pagina già inserita (mai `*`). Se richiesto, concedi al sito l’accesso alla rete locale. Il sito non può aggirare questi controlli del browser: l’app desktop è l’alternativa senza configurazione CORS. I modelli devono essere sullo stesso dispositivo; `127.0.0.1` sul telefono non raggiunge il computer.

Sono ammessi solo indirizzi loopback (`127.0.0.1`, `localhost`, `::1`) e porte personalizzate. Il modello deve supportare chat e messaggi di sistema; velocità e qualità dipendono dal modello e dall’hardware. Un errore di configurazione locale sospende i tentativi automatici per quel profilo senza aumentare l’attesa fino a 80 secondi: dopo la correzione puoi salvare il profilo o riprovare manualmente subito. Le verifiche automatiche usano server locali simulati, senza scaricare pesi né effettuare chiamate a pagamento.

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

Non è una replica completa di Microsoft Word: non include collaborazione simultanea, revisioni con accettazione/rifiuto, commenti condivisi, note a piè di pagina, sommario automatico, intestazioni o impaginazione tipografica avanzata. L’import/export DOCX conserva i contenuti comuni ma non garantisce fedeltà perfetta a documenti complessi. Le nuove immagini esportate conservano proporzioni e dimensioni adattate; WebP viene rappresentato con testo alternativo nel DOCX. Il controllo ortografico dipende dal browser. Ricerca limitata a sequenze dentro un singolo nodo di testo (può non trovare parole divise da cambi di formattazione).

Documenti fino a circa 2 MB per richiesta, immagini sorgenti fino a 12 MB, ottimizzate prima del salvataggio e testo AI fino a 10.000 caratteri per proposta. Non è prevista sincronizzazione offline: in caso di errore di salvataggio viene mostrato un avviso, ed è possibile esportare la copia in memoria. Non sono state eseguite chiamate a pagamento ai provider: la verifica live richiede una chiave valida, un modello disponibile e credito sul relativo account.

## Riferimenti tecnici

- [Tiptap React](https://tiptap.dev/docs/editor/getting-started/install/react)
- [Gemini: compatibilità OpenAI](https://ai.google.dev/gemini-api/docs/openai)
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages)
