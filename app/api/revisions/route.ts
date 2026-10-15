import {context,jsonBody,answer,fail,HttpError,validText} from '../../../lib/server';
export async function POST(request:Request) { try {
  const {db,owner}=context(request);const b=await jsonBody(request);
  if(!validText(b.title,150)||b.content?.type!=='doc')throw new HttpError(400,'Versione non valida.');
  const doc=await db.prepare('SELECT id FROM documents WHERE id=? AND owner=?').bind(b.document,owner).first();if(!doc)throw new HttpError(404,'Documento non trovato.');
  await db.prepare('INSERT INTO revisions (id,document,owner,title,content,created) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),b.document,owner,b.title,JSON.stringify(b.content),Date.now()).run();
  return answer({ok:true});
}catch(e){return fail(e);} }
