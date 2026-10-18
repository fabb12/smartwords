// Narrative voices the writer can lean on. Each entry describes stylistic traits only:
// prompts ask the model to evoke them, never to copy or quote the author's works.
export type Voice = { id: string; name: string; tag: string; family: 'mia' | 'saggio' | 'narrativa' | 'internazionale'; traits: string };

export const VOICES: Voice[] = [
  { id: 'mine', name: 'La mia voce', tag: 'La tua impronta stilistica', family: 'mia',
    traits: 'La voce dell’autore stesso: segui fedelmente l’impronta stilistica misurata sul manoscritto.' },
  { id: 'mix', name: 'Mix di autori', tag: 'Unisci più voci e scegli i pesi', family: 'mia', traits: '' },
  { id: 'calvino', name: 'Italo Calvino', tag: 'Leggerezza, esattezza, immaginazione', family: 'narrativa',
    traits: 'Leggerezza ed esattezza; frasi limpide e calibrate; immagini nitide e precise; gusto per la struttura e la combinatoria; ironia lieve, tono di favola razionale; aggettivi scelti con parsimonia.' },
  { id: 'rovelli', name: 'Carlo Rovelli', tag: 'Divulgazione lirica e meraviglia', family: 'saggio',
    traits: 'Divulgazione scientifica dal tono lirico; paragrafi brevi; meraviglia e stupore; si rivolge direttamente al lettore; metafore tratte dall’esperienza quotidiana; richiami a poeti e filosofi; concetti difficili resi semplici senza banalizzarli.' },
  { id: 'boncinelli', name: 'Edoardo Boncinelli', tag: 'Saggio scientifico chiaro e razionale', family: 'saggio',
    traits: 'Saggistica scientifica chiara e didattica; argomentazione logica per passaggi; tono pacato, autorevole e talvolta ironico; domande filosofiche su mente, biologia ed evoluzione; esempi concreti; diffidenza verso la retorica.' },
  { id: 'carrere', name: 'Emmanuel Carrère', tag: 'Romanzo-verità in prima persona', family: 'internazionale',
    traits: 'Romanzo non-fiction in prima persona; l’autore si mette in scena con onestà spietata; mescola inchiesta, cronaca e confessione; frasi ampie e digressive; dubbi espliciti sul proprio punto di vista; dettagli concreti e verificabili.' },
  { id: 'ginzburg', name: 'Natalia Ginzburg', tag: 'Semplicità, lessico famigliare', family: 'narrativa',
    traits: 'Prosa piana e colloquiale; frasi brevi e coordinate; ripetizioni volute; ironia affettuosa e understatement; dialoghi famigliari; emozioni dette di sbieco, mai enfatizzate.' },
  { id: 'eco', name: 'Umberto Eco', tag: 'Erudizione, ironia, elenchi', family: 'narrativa',
    traits: 'Erudizione giocosa; elenchi e cataloghi; citazioni e rimandi colti; ironia intellettuale; digressioni argomentate; gusto per il mistero e per i segni da interpretare.' },
  { id: 'ferrante', name: 'Elena Ferrante', tag: 'Intensità, prima persona', family: 'narrativa',
    traits: 'Prima persona intensa e urgente; scavo psicologico senza filtri; relazioni ambivalenti; frasi dense e nervose; emozioni crude raccontate con lucidità; ambientazione concreta.' },
  { id: 'baricco', name: 'Alessandro Baricco', tag: 'Ritmo musicale, oralità', family: 'narrativa',
    traits: 'Ritmo musicale e teatrale; ripetizioni e anafore; frasi brevissime alternate a periodi lunghi; tono orale e fiabesco; a capo frequenti; personaggi eccentrici.' },
  { id: 'buzzati', name: 'Dino Buzzati', tag: 'Il fantastico nel quotidiano', family: 'narrativa',
    traits: 'Il fantastico e l’inquietante che irrompono nel quotidiano; tono sobrio quasi giornalistico; attesa e angoscia sottile; atmosfere sospese; finali che lasciano un brivido.' },
  { id: 'levi', name: 'Primo Levi', tag: 'Precisione, sobrietà, peso morale', family: 'narrativa',
    traits: 'Precisione quasi scientifica; sobrietà e misura; lessico esatto; riflessione morale trattenuta; testimonianza lucida, nessun compiacimento retorico.' },
  { id: 'pavese', name: 'Cesare Pavese', tag: 'Realismo lirico, malinconia', family: 'narrativa',
    traits: 'Realismo lirico; laconicità; ritmo del parlato; paesaggi come stati d’animo; malinconia e solitudine; dialoghi asciutti.' },
  { id: 'tabucchi', name: 'Antonio Tabucchi', tag: 'Sogno, nostalgia, inquietudine', family: 'narrativa',
    traits: 'Atmosfere sognanti e malinconiche; inquietudine esistenziale; narratore che riferisce e dubita; frasi scorrevoli; nostalgia e identità sfuggente.' },
  { id: 'morante', name: 'Elsa Morante', tag: 'Epica degli affetti', family: 'narrativa',
    traits: 'Respiro epico e visionario; frasi ampie e ricche; sguardo compassionevole sui personaggi; mondo dell’infanzia e del mito; aggettivazione intensa.' },
  { id: 'hemingway', name: 'Ernest Hemingway', tag: 'Teoria dell’iceberg', family: 'internazionale',
    traits: 'Frasi brevi e dichiarative; lessico semplice; molto dialogo; emozioni sottintese (teoria dell’iceberg); azioni concrete; niente spiegazioni psicologiche.' },
  { id: 'woolf', name: 'Virginia Woolf', tag: 'Flusso di coscienza', family: 'internazionale',
    traits: 'Flusso di coscienza; frasi lunghe e fluide con incisi; percezioni sensoriali; tempo interiore; passaggi morbidi tra punti di vista.' },
  { id: 'marquez', name: 'Gabriel García Márquez', tag: 'Realismo magico', family: 'internazionale',
    traits: 'Realismo magico raccontato con naturalezza; periodi lunghi e avvolgenti; iperboli; memoria familiare e destino; dettagli sensoriali vividi.' },
  { id: 'custom', name: 'Stile personalizzato', tag: 'Descrivilo tu', family: 'mia',
    traits: '' },
];

export const INTENSITIES = [
  { id: 'light', name: 'Leggera', hint: 'Qualche sfumatura: resta soprattutto la tua voce.' },
  { id: 'medium', name: 'Equilibrata', hint: 'Tua voce e modello di riferimento in equilibrio.' },
  { id: 'strong', name: 'Marcata', hint: 'Il modello si sente chiaramente, i contenuti restano tuoi.' },
] as const;
export type Intensity = typeof INTENSITIES[number]['id'];

export function voiceById(id: string | undefined): Voice { return VOICES.find(v => v.id === id) || VOICES[0]; }

export type VoiceBlend = { id: string; weight: number };
export const MIX_AUTHORS = VOICES.filter(v => v.family !== 'mia');
export const MAX_MIX_AUTHORS = 4;
export function sanitizeBlend(raw: unknown): VoiceBlend[] {
  if (!Array.isArray(raw)) return [];
  const result: VoiceBlend[] = [];
  for (const item of raw) {
    if (!item || !MIX_AUTHORS.some(v => v.id === item.id) || result.some(v => v.id === item.id)
      || typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight <= 0) continue;
    result.push({ id: item.id, weight: Math.max(1, Math.min(100, Math.round(item.weight))) });
    if (result.length === MAX_MIX_AUTHORS) break;
  }
  return result;
}
export function blendShares(raw: unknown) {
  const blend = sanitizeBlend(raw), total = blend.reduce((n, v) => n + v.weight, 0);
  return blend.map(v => ({ ...v, percent: Math.round(v.weight / total * 1000) / 10 }));
}
export function voiceName(id: string, blend?: VoiceBlend[]): string {
  const names = sanitizeBlend(blend).map(v => voiceById(v.id).name);
  return id === 'mix' && names.length ? `Mix: ${names.join(' + ')}` : voiceById(id).name;
}

// Text for the model: the chosen voice, how strongly to apply it, and the writer's own fingerprint.
export function voiceInstruction(id: string, intensity: string, custom: string, fingerprint: string, blend?: VoiceBlend[]): string {
  const v = voiceById(id);
  const own = fingerprint ? `Author's measured style fingerprint: ${fingerprint.slice(0, 400)}.` : '';
  if (v.id === 'mine') return `Write in the author's own voice, matching sentence length, rhythm, vocabulary and narrative habits. ${own}`.trim();
  const shares = v.id === 'mix' ? blendShares(blend) : [];
  const traits = v.id === 'mix' ? (shares.length >= 2 ? shares.map(s => `${voiceById(s.id).name} (${s.percent}%): ${voiceById(s.id).traits.slice(0, 280)}`).join(' | ') : '') : v.id === 'custom' ? custom.slice(0, 600) : v.traits;
  if (!traits.trim()) return `Write in the author's own voice. ${own}`.trim();
  const weight = intensity === 'strong' ? 'clearly evident' : intensity === 'light' ? 'only a subtle nuance over the author\'s own voice' : 'balanced with the author\'s own voice';
  return `Stylistic inspiration (${v.id === 'custom' ? 'described by the author' : v.name}): ${traits} ${v.id === 'mix' ? 'Blend these traits into one coherent narrative voice using the relative percentages, rather than alternating authors or writing separate versions.' : ''} Apply it as ${weight}. Evoke the style only: never copy, quote or paraphrase passages of existing works and never name the reference author in the text. Keep the author's characters, facts and ideas. ${own}`.trim();
}
