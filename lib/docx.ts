import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, ExternalHyperlink, ImageRun, ShadingType, type ParagraphChild } from 'docx';
import type { JSONContent } from '@tiptap/core';
const NAMED:Record<string,string>={black:'000000',white:'FFFFFF',red:'FF0000',green:'008000',blue:'0000FF',yellow:'FFFF00',orange:'FFA500',purple:'800080',gray:'808080',grey:'808080'};
// Word accepts only 6-digit hex. Pasted text and the editor can carry rgb(), rgba(),
// #rgb or #rrggbbaa: translucent colors are blended onto the white page. Anything
// unrecognized is dropped, so one odd color never blocks the export.
export function wordColor(value:unknown):string|undefined{
  if(typeof value!=='string')return undefined;const v=value.trim().toLowerCase();
  let rgb:number[]|null=null,alpha=1;
  const hex=/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if(hex){const h=hex[1].length<=4?[...hex[1]].map(c=>c+c).join(''):hex[1];rgb=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));if(h.length===8)alpha=parseInt(h.slice(6,8),16)/255;}
  const fn=/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if(fn){const part=(x:string,max:number)=>x.endsWith('%')?parseFloat(x)/100*max:parseFloat(x);rgb=[1,2,3].map(i=>part(fn[i],255));if(fn[4]!==undefined)alpha=part(fn[4],1);}
  if(!rgb&&NAMED[v])return NAMED[v];
  if(!rgb||rgb.some(n=>!Number.isFinite(n)))return undefined;
  alpha=Math.max(0,Math.min(1,alpha));
  return rgb.map(n=>Math.round(Math.max(0,Math.min(255,n))*alpha+255*(1-alpha)).toString(16).padStart(2,'0')).join('').toUpperCase();
}
function runs(nodes:JSONContent[]=[]):ParagraphChild[]{return nodes.flatMap((n):ParagraphChild[]=>{
  if(n.type==='hardBreak')return [new TextRun({break:1})];
  if(n.type!=='text')return runs(n.content);
  const marks=n.marks||[],style=marks.find(m=>m.type==='textStyle')?.attrs||{},highlight=marks.find(m=>m.type==='highlight');
  const fill=highlight?wordColor(highlight.attrs?.color||'#ffc8004d'):undefined;
  const run=new TextRun({text:n.text||'',bold:marks.some(m=>m.type==='bold'),italics:marks.some(m=>m.type==='italic'),underline:marks.some(m=>m.type==='underline')?{}:undefined,strike:marks.some(m=>m.type==='strike'),font:style.fontFamily||'Arial',size:style.fontSize?Math.round(parseFloat(style.fontSize)*1.5):24,color:wordColor(style.color),shading:fill?{type:ShadingType.CLEAR,fill,color:'auto'}:undefined});
  const link=marks.find(m=>m.type==='link')?.attrs?.href;
  return link&&/^https?:\/\//.test(link)?[new ExternalHyperlink({link,children:[run]})]:[run];
});}
function blocks(nodes:JSONContent[]=[]):Array<Paragraph|Table>{return nodes.flatMap((n):Array<Paragraph|Table>=>{
  if(n.type==='table')return [new Table({rows:(n.content||[]).map(row=>new TableRow({children:(row.content||[]).map(cell=>new TableCell({children:blocks(cell.content)}))}))})];
  if(n.type==='bulletList'||n.type==='orderedList')return (n.content||[]).flatMap((item,i)=>{const list=blocks(item.content);const first=item.content?.[0];return [new Paragraph({children:[new TextRun(n.type==='bulletList'?'• ':`${i+1}. `),...runs(first?.content)],indent:{left:360}}),...list.slice(1)];});
  if(n.type==='image') { const src=n.attrs?.src as string;const m=src?.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);if(m&&m[1]!=='webp'){const rawWidth=Number(n.attrs?.width),rawHeight=Number(n.attrs?.height);const sourceWidth=Number.isFinite(rawWidth)&&rawWidth>0?rawWidth:450,sourceHeight=Number.isFinite(rawHeight)&&rawHeight>0?rawHeight:280;const scale=Math.min(1,600/sourceWidth,840/sourceHeight);return [new Paragraph({alignment:AlignmentType.CENTER,children:[new ImageRun({type:m[1]==='jpeg'?'jpg':'png',data:Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0)),transformation:{width:Math.max(1,Math.round(sourceWidth*scale)),height:Math.max(1,Math.round(sourceHeight*scale))},altText:{title:n.attrs?.alt||'Immagine',description:n.attrs?.alt||'Immagine',name:'Immagine'}})]})];}return [new Paragraph({text:'[Immagine: '+(n.attrs?.alt||'')+']'})]; }
  if(n.type==='blockquote')return blocks(n.content);
  return [new Paragraph({children:runs(n.content),heading:n.type==='heading'?(n.attrs?.level===1?HeadingLevel.HEADING_1:n.attrs?.level===3?HeadingLevel.HEADING_3:HeadingLevel.HEADING_2):undefined,alignment:n.attrs?.textAlign==='center'?AlignmentType.CENTER:n.attrs?.textAlign==='right'?AlignmentType.RIGHT:AlignmentType.LEFT,spacing:{after:180,line:300}})];
});}
export async function exportDocx(content:JSONContent){return Packer.toBlob(new Document({creator:'Scrivia AI',sections:[{properties:{},children:blocks(content.content)}]}));}
