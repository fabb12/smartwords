add_cus_dep('idx', 'ind', 0, 'run_texindy');

sub run_texindy {
    # Controlla se il file .idx esiste e non è vuoto
    if ( -s "$_[0].idx" ) {
        # Esegue texindy con le opzioni per l'italiano e UTF-8
        # L'output viene reindirizzato per non "sporcare" il log principale
        my $return_code = system("texindy -L italian -C utf8 -I latex \"$_[0].idx\"");
        
        # Controlla se texindy ha prodotto un errore
        if ($return_code) {
            # Legge il file di log dell'indice (.ilg) e lo stampa nel log principale
            # Così possiamo vedere l'errore!
            if (open(my $log_file, "<", "$_[0].ilg")) {
                print "--- Inizio Log Indice '$_[0].ilg' ---\n";
                while (my $line = <$log_file>) {
                    print $line;
                }
                close $log_file;
                print "--- Fine Log Indice '$_[0].ilg' ---\n";
            }
        }
        return $return_code;
    }
    return 0;
}