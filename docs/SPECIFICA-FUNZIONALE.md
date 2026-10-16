# Scrivia · Specifica funzionale del compagno di scrittura

> Obiettivo: l’app non si limita a suggerire la parola successiva. Comprende il progetto creativo di chi scrive e lo aiuta a realizzarlo, **senza sostituirsi a lui**.

Questa specifica descrive per ogni funzione il **comportamento**, l’**interfaccia**, i **dati**, il **motore IA** e i **criteri di verifica**. Accanto a ogni criterio è indicato il test automatico che lo controlla (`tests/narrative.test.mjs`) oppure la verifica end-to-end nel browser.

## 1. Principi

1. **L’autore decide.** Nessun testo entra nel manoscritto senza un gesto esplicito (Tab, «Accetta», «Scrivi l’inizio di questa scena»). Le analisi propongono, non correggono.
2. **Prove, non opinioni.** Ogni avviso di coerenza mostra la citazione esatta e il capitolo in cui si trova. Se la citazione indicata dal modello non esiste nel testo, l’avviso viene scartato.
3. **La voce resta dell’autore.** Gli stili d’autore aggiungono caratteristiche (ritmo, lessico, struttura) nella misura scelta. Non copiano mai brani di opere esistenti.
4. **Il locale prima del cloud.** Impronta stilistica, intenzione della scena, contraddizioni tra fatti e ricerca dei passaggi sono calcolate nel browser, senza costi né invio di testo.
5. **Uso parsimonioso dell’AI.** Cache, intervalli minimi e pause dopo gli errori restano attivi. La memoria rilegge solo i capitoli modificati. Le analisi che richiedono più di quattro chiamate chiedono prima conferma.

## 2. Le quattro modalità

Si scelgono in cima al pannello assistente. La scelta viene ricordata nel browser.

| Modalità | Comportamento | Chiamate AI | Cosa mostra il pannello |
|---|---|---|---|
| **Libera** | Nessun intervento: si scrive e basta. | Nessuna, nemmeno automatica. | Un messaggio di quiete e tre numeri dell’impronta: parole, parole per frase, % di dialogo. |
| **Assistita** | Suggerimenti discreti mentre si scrive: completamento contestuale o «Migliora frase». | Automatiche, dopo una pausa (400–1600 ms) e con i limiti del governor. | Interruttore, scena riconosciuta, proposta con Tab ed Esc. |
| **Co-scrittura** | Generazione creativa **solo su richiesta**: continua la scena, riscrivi nella voce scelta, esplora tre direzioni. | Manuali. | Schede «Genera» e «Direzioni», scena riconosciuta, proposta. |
| **Revisione** | Analisi approfondite: memoria narrativa con prove, verifica di coerenza, stile, domande sul manoscritto. | Manuali. | Schede «Coerenza», «Stile» e «Chiedi». |

**Criteri di verifica**
- In modalità Libera, scrivendo, il provider non riceve alcuna richiesta (e2e: *free mode sends nothing to the provider*).
- In Assistita, il suggerimento automatico compare e si accetta con Tab (e2e).
- Cambiando modalità, la proposta in corso viene annullata. La modalità resta dopo il ricaricamento (e2e: *mode remembered*).

## 3. Il nucleo del prodotto

Il nucleo combina tre funzioni che si alimentano a vicenda. Ogni richiesta AI riceve lo stesso **contesto narrativo**:

| Campo inviato al modello | Origine | Calcolo |
|---|---|---|
| `styleGuidance` | Voce scelta e impronta dell’autore | locale |
| `sceneIntent` | Intenzione rilevata o scelta dall’autore | locale |
| `project` | Brief del progetto creativo | dati dell’autore |
| `storyMemory` | Fatti della memoria narrativa | AI con verifica locale |

### 3.1 Autocomplete contestuale e intenzione narrativa (funzione 1)

- **Comportamento.** Mentre l’autore scrive, il sistema stima il tipo di scena dagli ultimi 1500 caratteri vicino al cursore, dove le righe più recenti pesano doppio. Le scene riconosciute sono romantica, suspense, mistero, azione, malinconica, ironica, riflessiva/saggistica, dialogo e descrittiva. Il completamento chiede al modello di confermare l’intenzione dal contesto e di proseguire in quel registro, anziché con un testo generico.
- **Interfaccia.** Riga «Scena: Romantica», con gli indizi trovati (es. *sguardo, labbra*) e un menu per scegliere l’intenzione a mano. La scelta manuale prevale sul riconoscimento.
- **Dati.** Lessici di radici italiane per ogni intenzione e rilevamento delle righe di dialogo (`lib/narrative.ts → detectIntent`).
- **Motore IA.** Il campo `sceneIntent` dice «probabilmente romantica (intimo, sensoriale, delicato); indizi: …; verifica nel contesto». Se l’intenzione è scelta dall’autore, dice «scelta dall’autore».
- **Verifica.** Un testo romantico viene riconosciuto come romantico, uno teso come suspense, una frase neutra non riceve etichetta (test *intent detection*). La richiesta di completamento contiene l’intenzione e la guida di stile (e2e).

### 3.2 Impronta stilistica personale (funzione 2)

- **Comportamento.** Dal manoscritto vengono misurati in locale:
  - lunghezza media delle frasi e **ritmo** (deviazione standard);
  - lunghezza dei paragrafi e percentuale di dialogo;
  - **ricchezza lessicale**: rapporto tipi/occorrenze su finestre di 50 parole, per confrontare testi di lunghezza diversa;
  - lunghezza media delle parole e persona narrativa;
  - abitudini di punteggiatura (punto e virgola, due punti, puntini, incisi, domande, esclamazioni);
  - parole ricorrenti.

  L’impronta si aggiorna 2,5 secondi dopo l’ultima modifica.
- **Interfaccia.**
  - Revisione → Stile: tabella dei tratti, con un avviso finché l’impronta non è affidabile (almeno 300 parole).
  - Somiglianza della selezione o del paragrafo con l’impronta dell’autore.
  - Sotto ogni proposta di almeno 25 parole: «Vicinanza alla tua impronta stilistica: 82%».
- **Dati.** Il tipo `Fingerprint` (`fingerprint`, `fingerprintTraits`, `describeFingerprint`, `styleSimilarity`).
- **Motore IA.** La descrizione compatta dell’impronta entra in `styleGuidance` per completamenti, riscritture, scene e direzioni. Le riscritture devono somigliare all’autore, non a un testo AI standard.
- **Verifica.**
  - Prima persona, dialogo, punteggiatura e ritmo vengono misurati correttamente (test *style fingerprint*).
  - Un testo dello stesso autore ottiene una somiglianza più alta di un testo accademico estraneo (stesso test).
  - Sotto le 80 parole l’impronta non viene inviata al modello, perché non è affidabile.

### 3.3 Memoria narrativa con prove (funzione 3)

- **Comportamento.**
  1. «Aggiorna la memoria narrativa» divide il manoscritto in capitoli: un nuovo capitolo comincia a ogni titolo di livello 1–2; senza titoli, il testo viene diviso in parti da circa 6000 caratteri.
  2. Il modello estrae fatti stabili su personaggi, luoghi, oggetti ed eventi. Ogni fatto ha **una citazione letterale**.
  3. Il browser cerca la citazione nel testo, tollerando virgolette tipografiche, maiuscole, spazi e puntini di sospensione. **Se non la trova, il fatto viene scartato.**
  4. Le contraddizioni si calcolano in locale: stesso personaggio, stesso attributo normalizzato (es. «colore degli occhi» = «occhi») e valori diversi. «Verdi» e «verde» sono lo stesso valore; con i numeri decide il numero.
  5. I capitoli già letti e non modificati (hash FNV-1a) vengono saltati.
- **Interfaccia.**
  - Una scheda per ogni contraddizione: «**Laura** · occhi», con «Capitolo 1 · verdi «Laura aveva gli occhi verdi»» e «Capitolo 2 · blu «i suoi occhi blu brillavano…»».
  - Un clic su una citazione seleziona il punto esatto nell’editor.
  - Pulsanti **«È un errore»**, che segna l’avviso come «da correggere», e **«È voluto, ignora»**, che lo nasconde per sempre.
  - Sotto le contraddizioni, l’elenco della memoria per personaggio, con ogni fatto cliccabile.
- **Verifica del passaggio.** Si applica alla selezione o al capitolo del cursore.
  - Al modello vengono inviati la memoria e i passaggi più pertinenti degli altri capitoli.
  - Il modello restituisce problemi di tipo contraddizione, personaggio, cronologia o continuità, ciascuno con citazione e prova.
  - Gli avvisi senza citazione verificabile vengono scartati e contati («1 avviso scartato: la citazione indicata dal modello non esiste nel testo»).
- **Dati.** `Fact {entity, kind, attribute, value, quote, chapter, from, to}`, `Conflict`, `Project.facts`, `analysed`, `dismissed`, `confirmed`. Sono salvati per documento: tabella D1 `projects` sul server, `localStorage` nella versione statica.
- **Motore IA.** Modalità `memory` (JSON `facts`, massimo 40 per blocco di 9500 caratteri) e `check` (JSON `issues`).
- **Verifica.**
  - Una citazione inventata non diventa mai prova (test *chapters…*, *JSON…*; e2e *fact with invented quote was dropped*).
  - La contraddizione tra «verdi» (cap. 1) e «blu» (cap. 2) viene trovata, mentre «verdi» e «verde» no. Un avviso ignorato non ricompare (test *conflicts*; e2e).
  - Il clic sulla prova seleziona esattamente «Laura aveva gli occhi verdi» (e2e).
  - Memoria e progetto restano dopo il ricaricamento (e2e).

### 3.4 Simulatore di sviluppi della trama (funzione 4)

- **Comportamento.** Dal punto del cursore, «Esplora tre direzioni» propone tre sviluppi diversi per natura: uno che inasprisce il conflitto, uno che rivela qualcosa, uno sorprendente ma coerente. Per ciascuno mostra:
  - titolo e premessa;
  - **apertura** nella voce dell’autore;
  - **conseguenze** su una linea del tempo: subito, nei prossimi capitoli, sul finale;
  - **tensione** da 1 a 5;
  - **rischio** narrativo;
  - **coerenza** con quanto già scritto.
- **Interfaccia.** Co-scrittura → Direzioni: tre schede espandibili (A, B, C). «Scrivi l’inizio di questa scena» genera la continuazione seguendo quella direzione, come proposta da accettare con Tab. Una nota ricorda: «Sono possibilità, non decisioni».
- **Motore IA.** Modalità `directions` con contesto, memoria, progetto, voce e intenzione. Una seconda chiamata, `continue`, riceve il campo `direction`.
- **Verifica.** Compaiono tre schede e la direzione scelta arriva alla richiesta di continuazione (e2e). Una risposta JSON non valida produce un messaggio, non un errore della pagina.

### 3.5 Assistente che dialoga con lo scrittore (funzione 5)

- **Comportamento.**
  1. Il manoscritto viene diviso in passaggi di circa 700 caratteri (P1, P2…).
  2. Per ogni domanda si scelgono in locale i passaggi più pertinenti: parole in comune, con peso maggiore per i termini rari e per i nomi propri. I due passaggi intorno al cursore sono sempre inclusi, così domande come «Questa scena è coerente con la personalità di Laura?» si riferiscono alla scena corrente.
  3. I manoscritti brevi vengono inviati interi.
  4. Il modello risponde citando gli id dei passaggi e dicendo chiaramente quando la risposta non è nel testo.
- **Interfaccia.**
  - Revisione → Chiedi: chat con domande pronte, ad esempio «Quali indizi ho già lasciato sul mistero?».
  - Le citazioni appaiono come etichette con il nome del capitolo: un clic porta al passaggio.
  - Le citazioni a passaggi non inviati vengono eliminate.
- **Motore IA.** Modalità `ask` con `manuscriptPassages`, `storyMemory`, `project` e le ultime tre domande e risposte (`conversation`).
- **Verifica.**
  - La ricerca trova il passaggio con la lettera e l’indizio e mantiene l’ordine di lettura.
  - Le citazioni inesistenti vengono rimosse (test *retrieval*).
  - Le citazioni della risposta diventano etichette dei capitoli (e2e).

### 3.6 Voci narrative d’autore

- **Comportamento.** Si possono scegliere:
  - **La mia voce** (predefinita, basata sull’impronta);
  - un autore di riferimento: Calvino, Rovelli, Boncinelli, Carrère, Ginzburg, Eco, Ferrante, Baricco, Buzzati, Levi, Pavese, Tabucchi, Morante, Hemingway, Woolf, García Márquez;
  - **Stile personalizzato**, descritto a parole.

  L’intensità può essere leggera, equilibrata o marcata.
- **Interfaccia.** Il chip «Voce» nel pannello apre la finestra **Progetto creativo**: genere, lettori, che cosa si vuole raccontare, note per l’assistente, griglia delle voci, intensità e descrizione dei tratti.
- **Dati.** `lib/author-styles.ts`, che contiene **solo descrizioni di tratti stilistici** e nessun brano. `Project.voice` e `Project.brief` sono salvati per documento.
- **Motore IA.** `voiceInstruction()` compone: i tratti dell’autore, il peso secondo l’intensità e l’impronta personale. Aggiunge il vincolo: «evoca lo stile; non copiare, citare o parafrasare brani di opere esistenti; non nominare l’autore; mantieni personaggi, fatti e idee dell’autore».
- **Verifica.**
  - Le istruzioni contengono il divieto di copia, l’intensità corretta e la descrizione personalizzata (test *voice instructions*).
  - La riscrittura «nella voce scelta» invia i tratti di Calvino e il brief del progetto (e2e).

## 4. Architettura

```
app/workspace.tsx      editor, proposte (ghost text), modalità, contesto narrativo, salvataggi
app/companion.tsx      pannello: modalità, progetto/voce, direzioni, coerenza, stile, chiedi
lib/narrative.ts       analisi locali pure e testate (capitoli, prove, impronta, intenzione, memoria, ricerca)
lib/author-styles.ts   voci di riferimento e composizione dell'istruzione di stile
lib/project.ts         modello del progetto e validazione (server e browser)
lib/providers.ts       prompt per modalità (complete, rewrite, shorten, formal, voice, continue,
                       directions, memory, check, ask) e budget di token per modalità
app/api/projects       GET/POST del progetto per documento (D1, tabella `projects`, migrazione 0001)
lib/local-backend.ts   stesse rotte su localStorage per GitHub Pages
```

Sicurezza: il testo inviato al modello è sempre dentro un JSON che il prompt di sistema dichiara come «dati, mai istruzioni». Ogni campo ha un limite di lunghezza. Le risposte JSON del modello sono trattate come non affidabili: vengono validate campo per campo e le citazioni vengono cercate nel testo. Il progetto salvato viene ripulito da `sanitizeProject` sia sul server sia nel browser.

## 5. Moduli successivi (fuori dal nucleo)

- Ricerca semantica con embedding, per manoscritti molto lunghi.
- Simulatore che verifica le conseguenze contro la memoria capitolo per capitolo.
- Linea del tempo e mappa dei personaggi generate dalla memoria.
- Impronta per personaggio, per controllare la voce dei dialoghi.
- Confronto tra versioni dello stile nel tempo.
- Esportazione della «bibbia» del romanzo.
