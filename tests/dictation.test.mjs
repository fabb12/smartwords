import test from 'node:test';
import assert from 'node:assert/strict';
import {dictationText,dictationSupported} from '../lib/dictation.ts';

test('spoken punctuation becomes symbols, with spacing and capitals',()=>{
 assert.equal(dictationText('ciao virgola come stai punto interrogativo',''),'Ciao, come stai?');
 assert.equal(dictationText('era tardi punto la luna splendeva','Il treno partì.'),' Era tardi. La luna splendeva');
 assert.equal(dictationText('e poi andò via','Lei rise')," e poi andò via");
 assert.equal(dictationText('punto e virgola poi due punti tre','Basta'),'; poi: tre');
 assert.equal(dictationText('apri virgolette vieni chiudi virgolette disse','Lui:'),' «vieni» disse');
 assert.equal(dictationText('costa 3,5 euro',''),'Costa 3,5 euro');
});
test('«a capo» starts a new paragraph that begins with a capital',()=>{
 assert.equal(dictationText('fine punto a capo il giorno dopo','Era la'),' fine.\nIl giorno dopo');
 assert.equal(dictationText('nuovo paragrafo','Fine.'),'\n');
});
test('after a space or at the start no extra space is added',()=>{
 assert.equal(dictationText('parola','Una '),'parola');
 assert.equal(dictationText('   ',''),'');
});
test('without a browser dictation is not available',()=>{assert.equal(dictationSupported(),false);});
