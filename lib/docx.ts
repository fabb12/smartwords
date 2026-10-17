import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, ExternalHyperlink, ImageRun, type ParagraphChild } from 'docx';
import type { JSONContent } from '@tiptap/core';
function runs(nodes:JSONContent[]=[]):ParagraphChild[]{return nodes.flatMap((n):ParagraphChild[]=>{
  if(n.type==='hardBreak')return [new TextRun({break:1})];
  if(n.type!=='text')return runs(n.content);
  const marks=n.marks||[],style=marks.find(m=>m.type==='textStyle')?.attrs||{};
  const run=new TextRun({text:n.text||'',bold:marks.some(m=>m.type==='bold'),italics:marks.some(m=>m.type==='italic'),underline:marks.some(m=>m.type==='underline')?{}:undefined,strike:marks.some(m=>m.type==='strike'),font:style.fontFamily||'Arial',size:style.fontSize?Math.round(parseFloat(style.fontSize)*1.5):24,color:style.color?.replace('#','')});
  const link=marks.find(m=>m.type==='link')?.attrs?.href;
  return link&&/^https?:\/\//.test(link)?[new ExternalHyperlink({link,children:[run]})]:[run];
});}
function blocks(nodes:JSONContent[]=[]):Array<Paragraph|Table>{return nodes.flatMap((n):Array<Paragraph|Table>=>{
  if(n.type==='table')return [new Table({rows:(n.content||[]).map(row=>new TableRow({children:(row.content||[]).map(cell=>new TableCell({children:blocks(cell.content)}))}))})];
  if(n.type==='bulletList'||n.type==='orderedList')return (n.content||[]).flatMap((item,i)=>{const list=blocks(item.content);const first=item.content?.[0];return [new Paragraph({children:[new TextRun(n.type==='bulletList'?'• ':`${i+1}. `),...runs(first?.content)],indent:{left:360}}),...list.slice(1)];});
  if(n.type==='image') { const src=n.attrs?.src as string;const m=src?.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);if(m&&m[1]!=='webp'){return [new Paragraph({children:[new ImageRun({type:m[1]==='jpeg'?'jpg':'png',data:Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0)),transformation:{width:450,height:280},altText:{title:n.attrs?.alt||'Immagine',description:n.attrs?.alt||'Immagine',name:'Immagine'}})]})];}return [new Paragraph({text:'[Immagine: '+(n.attrs?.alt||'')+']'})]; }
  if(n.type==='blockquote')return blocks(n.content);
  return [new Paragraph({children:runs(n.content),heading:n.type==='heading'?(n.attrs?.level===1?HeadingLevel.HEADING_1:HeadingLevel.HEADING_2):undefined,alignment:n.attrs?.textAlign==='center'?AlignmentType.CENTER:n.attrs?.textAlign==='right'?AlignmentType.RIGHT:AlignmentType.LEFT,spacing:{after:180,line:300}})];
});}
export async function exportDocx(content:JSONContent){return Packer.toBlob(new Document({creator:'Scrivia AI',sections:[{properties:{},children:blocks(content.content)}]}));}
