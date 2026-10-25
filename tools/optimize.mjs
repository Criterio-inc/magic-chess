// Komprimerar Blender-exporterna: tar bort dummybilder men behåller UV:er, kvantiserar, meshopt.
// node tools/optimize.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, meshopt, weld, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

// node tools/optimize.mjs in.glb out.glb [--lod ratio]  (--lod förenklar meshen, för mobilversionen)
const [src, dst] = process.argv.slice(2);
const lodIdx = process.argv.indexOf('--lod');
const lod = lodIdx > 0 ? parseFloat(process.argv[lodIdx + 1]) : 0;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
for (const tex of doc.getRoot().listTextures()) tex.dispose();
// Riggade pjäser behåller POSITION i meter: triplanarshadern läser vilopositionen direkt.
const skinned = doc.getRoot().listSkins().length > 0;
// keepUniqueNames: material med samma egenskaper men olika namn får inte slås ihop (spelet byter material på namn)
await doc.transform(dedup({ keepUniqueNames: true }), prune({ keepAttributes: true, keepLeaves: true }));
if (lod > 0) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: lod, error: 0.004, lockBorder: false }));
if (skinned) {
  // meshopt() kvantiserar alltid POSITION; gör stegen för hand och hoppa över den
  await doc.transform(
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ quantizeNormal: 10, pattern: /^(NORMAL|TEXCOORD_\d+|JOINTS_\d+|WEIGHTS_\d+)$/ }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
} else {
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizeNormal: 10, quantizeTexcoord: 14 }));
}
await io.write(dst, doc);
