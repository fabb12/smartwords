# Barre degli strumenti

I gruppi di comandi condividono una barra con ritorno a capo automatico. Con spazio sufficiente, anche i comandi essenziali a schermo intero stanno su una sola riga.

## Personalizzazione

- Trascinare la maniglia puntinata per riordinare un gruppo nella barra.
- Trascinare verso uno dei quattro bordi per agganciarlo: durante lo spostamento compaiono le zone di aggancio.
- Rilasciare nell’area di scrittura per ottenere una palette flottante; la stessa maniglia permette di spostarla ancora.
- Fare clic sulla maniglia per scegliere una posizione o spostare il gruppo prima/dopo il vicino.
- Da tastiera: Spazio prende il gruppo, le frecce lo spostano, Spazio lo rilascia, Esc annulla. Freccia giù sulla maniglia non attiva apre il menu di posizionamento.
- **Visualizza → Ripristina posizione strumenti** riporta i gruppi nella barra superiore nell’ordine iniziale.

Ordine, bordi e coordinate delle palette si conservano in localStorage per utente, separando vista normale e schermo intero. Le coordinate sono relative all’area disponibile e limitate alla finestra quando questa si restringe. Nascondere un gruppo non cancella la sua posizione. L’interfaccia semplice del telefono nasconde questi gruppi e mantiene la propria barra; la stampa esclude maniglie e palette.

Lo spostamento non modifica il manoscritto o la cronologia. I comandi di formattazione continuano a usare la selezione dell’editor.

## Librerie valutate

Versioni e licenze verificate nel registro npm durante l’implementazione.

| Libreria | Versione | Licenza | Funzionalità |
| --- | --- | --- | --- |
| [dnd-kit/core](https://www.npmjs.com/package/@dnd-kit/core) e [sortable](https://www.npmjs.com/package/@dnd-kit/sortable) | 6.3.1 / 10.0.0 | MIT | Sensori puntatore/tastiera, maniglie, ordinamento e annunci accessibili. |
| [Dockview React](https://dockview.dev/) | 8.6.1 | MIT | Gestore completo con pannelli, schede, gruppi, griglie e finestre flottanti. |
| [FlexLayout React](https://github.com/caplin/FlexLayout) | 0.11.1 | MIT | Gestore di layout con schede e pannelli agganciabili. |

È stato scelto dnd-kit per gestire i gruppi di comandi nell’interfaccia React esistente. L’applicazione definisce i quattro bordi, le palette e la persistenza; dnd-kit gestisce trascinamento, ordinamento e accessibilità. Sono usati core e sortable, senza aggiungere un tema grafico esterno.

## Verifica

I test del modello controllano dati salvati non validi, gruppi duplicati o sconosciuti, spostamenti senza perdita di gruppi nascosti e separazione per utente/fullscreen. Le prove nel browser coprono riordino reale con il mouse, aggancio, movimento delle palette, uso da tastiera, selezione e comandi dell’editor, persistenza, ripristino, layout stretto e interfaccia semplice.
