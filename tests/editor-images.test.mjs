import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { fitImage, prepareEditorImage } from '../lib/editor-images.ts';
import { exportDocx } from '../lib/docx.ts';

test('images fit both A4 margins without distortion or enlarging small originals', () => {
  for (const [width,height] of [[4000,2000],[1000,5000],[5000,5000],[120,80]]) {
    const fit=fitImage(width,height);
    assert.ok(fit.width<=642&&fit.height<=947);
    assert.ok(Math.abs(fit.width/fit.height-width/height)<.01);
    assert.ok(fit.width<=width&&fit.height<=height);
  }
  assert.throws(()=>fitImage(0,200),/non valide/);
});

test('unsupported clipboard/file content is rejected before decoding', async () => {
  await assert.rejects(prepareEditorImage(new Blob(['<svg/>'],{type:'image/svg+xml'})),/PNG, JPEG/);
});

test('Word images retain fitted proportions and centered alignment', async () => {
  const src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFcUAAAAASUVORK5CYII=';
  const file=await exportDocx({type:'doc',content:[{type:'image',attrs:{src,width:600,height:300,alt:'Panorama'}}]});
  const zip=await JSZip.loadAsync(await file.arrayBuffer()),xml=await zip.file('word/document.xml').async('string');
  assert.match(xml,/cx="5715000" cy="2857500"/);
  assert.match(xml,/w:jc w:val="center"/);
});
