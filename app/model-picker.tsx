'use client';
import { useEffect, useRef, useState } from 'react';
import { PROVIDER_MODELS } from '../lib/provider-models';
import { deviceModels, isDeviceProvider, DEVICE_CONNECTION_HELP, type AiProvider } from '../lib/device-models';

export function ModelPicker({provider,model,baseUrl,token,profileId,onChange}:{provider:AiProvider;model:string;baseUrl:string;token:string;profileId:string;onChange:(model:string)=>void}) {
  const [found,setFound]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const local=isDeviceProvider(provider),models=local?found:PROVIDER_MODELS[provider];
  async function discover(){request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setMessage('');
    try{const list=await deviceModels(baseUrl,token,controller.signal,profileId);if(controller.signal.aborted)return;setFound(list);setMessage(list.length?`${list.length} modelli disponibili.`:'Nessun modello disponibile: scarica o carica un modello nel server locale.');if(list.length&&!list.includes(model))onChange(list[0]);}
    catch(err){if(!controller.signal.aborted)setMessage((err as Error).message+' '+DEVICE_CONNECTION_HELP);}
    finally{if(!controller.signal.aborted)setBusy(false);}}
  return <><label>Modello<select value={models.includes(model)?model:'__custom__'} onChange={e=>onChange(e.target.value==='__custom__'?'':e.target.value)}>{models.map(id=><option key={id} value={id}>{id}</option>)}<option value="__custom__">Identificativo personalizzato…</option></select></label>
    {!models.includes(model)&&<label>Identificativo del modello<input required maxLength={150} placeholder={local?'Es. llama3.2:latest':'Identificativo API del modello'} value={model} onChange={e=>onChange(e.target.value)}/></label>}
    {local&&<div><button type="button" className="quiet" disabled={busy} onClick={()=>void discover()}>{busy?'Ricerca…':'Cerca modelli locali'}</button>{message&&<p role="status" className="form-note">{message}</p>}</div>}
  </>;
}
