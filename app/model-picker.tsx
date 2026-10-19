'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PROVIDER_MODELS } from '../lib/provider-models';
import { deviceModels, isDeviceProvider, type AiProvider } from '../lib/device-models';
import { LocalConnection } from './local-connection';

export function ModelPicker({provider,model,baseUrl,token,profileId,onChange}:{provider:AiProvider;model:string;baseUrl:string;token:string;profileId:string;onChange:(model:string)=>void}) {
  const [found,setFound]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(false),[custom,setCustom]=useState(false);
  const request=useRef<AbortController|null>(null),latest=useRef({model,onChange});latest.current={model,onChange};
  const local=isDeviceProvider(provider),models=local?found:PROVIDER_MODELS[provider];
  const discover=useCallback(async()=>{
    if(!isDeviceProvider(provider))return;
    request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setMessage('');setError(false);
    try{const list=await deviceModels(baseUrl,token,controller.signal,profileId,provider);if(controller.signal.aborted)return;setFound(list);
      setMessage(list.length?`Collegato · ${list.length} ${list.length===1?'modello installato':'modelli installati'}.`:'Server collegato, nessun modello trovato. Scarica un modello in Ollama o nella sezione Discover di LM Studio, poi verifica di nuovo.');
      if(list.length&&!latest.current.model)latest.current.onChange(list[0]);
    }catch(err){if(!controller.signal.aborted){setFound([]);setError(true);setMessage((err as Error).message);}}
    finally{if(!controller.signal.aborted)setBusy(false);}
  },[provider,baseUrl,token,profileId]);
  useEffect(()=>{if(!local)return;const timer=setTimeout(()=>void discover(),400);return()=>{clearTimeout(timer);request.current?.abort();};},[local,discover]);
  const showCustom=local?custom||!!model&&!busy&&found.length>0&&!found.includes(model):!models.includes(model);
  return <><label>{local?'Modello locale installato':'Modello'}<select required aria-label={local?'Modello locale installato':'Modello'} value={models.includes(model)?model:showCustom?'__custom__':''} onChange={e=>{const manual=e.target.value==='__custom__';setCustom(manual);onChange(manual?'':e.target.value);}}>
    {local&&<option value="" disabled>{busy?'Cerco i modelli…':found.length?'Scegli un modello':'Verifica il server per vedere i modelli'}</option>}
    {models.map(id=><option key={id} value={id}>{id}</option>)}<option value="__custom__">Identificativo personalizzato…</option></select></label>
    {showCustom&&<label>Identificativo del modello<input required maxLength={150} placeholder={local?'Es. llama3.2:latest':'Identificativo API del modello'} value={model} onChange={e=>onChange(e.target.value)}/></label>}
    {local&&<div className="local-model-discovery"><button type="button" className="quiet" disabled={busy} onClick={()=>void discover()}>{busy?'Verifica in corso…':'Verifica connessione'}</button>{message&&<p role={error?'alert':'status'} className={error?'warning':'form-note'}>{message}</p>}<LocalConnection provider={provider}/></div>}
  </>;
}
