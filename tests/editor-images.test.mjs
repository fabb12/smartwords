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

test('la copia salvata ha fino a 2,5 volte la risoluzione mostrata e non ingrandisce gli originali', async () => {
  const { storedImageSize, IMAGE_DENSITY } = await import('../lib/editor-images.ts');
  const shown = fitImage(4000, 3000);
  const stored = storedImageSize({ width: 4000, height: 3000 }, shown);
  assert.equal(IMAGE_DENSITY, 2.5);
  assert.ok(stored.width >= shown.width * 2.4 && stored.width <= shown.width * 2.5 + 1, 'foto grande: 2,5 volte la dimensione sulla pagina');
  assert.ok(Math.abs(stored.width / stored.height - 4000 / 3000) < .01);
  assert.deepEqual(storedImageSize({ width: 300, height: 200 }, fitImage(300, 200)), { width: 300, height: 200 });
});

test('grafici e schermate restano PNG; le foto troppo pesanti diventano JPEG di qualità e non si rimpiccioliscono per prime', async () => {
  const { imageEncodings } = await import('../lib/editor-images.ts');
  assert.deepEqual(imageEncodings('image/png', null, null), [{ mime: 'image/png' }], 'si prova sempre prima il PNG');
  assert.deepEqual(imageEncodings('image/png', true, null), [], 'PNG entro il limite: niente altro da fare');
  const photo = imageEncodings('image/png', false, true);
  assert.ok(photo.length >= 3 && photo.every(s => s.mime === 'image/jpeg') && photo[0].quality >= .9 && photo.at(-1).quality >= .8, 'JPEG ad alta qualità, mai sotto 0,8');
  assert.deepEqual(imageEncodings('image/png', false, false), [{ mime: 'image/png' }], 'con trasparenza si resta in PNG');
  assert.ok(imageEncodings('image/jpeg', null, true).every(s => s.mime === 'image/jpeg'));
});
