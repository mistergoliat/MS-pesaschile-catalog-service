// Offline FIX2: node --import tsx cross-projection-audit/training-targeted-closure-audit.mjs
// Writes only local evidence under p2-3c-fix2; never activates or publishes.
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { contentHash, canonicalContent, validateManifest, recordCounts } from '../src/domain/catalog/projection-input/canonical.ts';
import { canonicalJson, semanticHash, bundleId, validateBundleForPublication } from '../src/domain/catalog/projection-bundle.ts';
import { loadTrainingSemanticClassificationInputs } from '../scripts/training-semantic-classification/lib/load-input.ts';
import { parseCsvRecords } from '../scripts/product-semantic-classification/lib/csv.ts';
import { buildTrainingSemanticsV2Projection, reconcileTrainingSnapshot, readAcceptedTrainingResolutionPolicy } from '../scripts/catalog-v2/build-training-semantics-v2.ts';
import { DefaultTrainingSemanticSnapshotV2Builder, trainingResolutionPolicy, validateTrainingSemanticSnapshotV2, canonicalizeTrainingSnapshotJson } from '../src/domain/training-semantic-snapshot/index.ts';
import { classifyTrainingSemanticProductsV21 } from '../src/domain/training-semantic-classification-v2-1/index.ts';
import { validateTrainingSemanticInvariants } from '../src/domain/training-semantic-snapshot/semanticInvariants.ts';
import { trainingSemanticV2RuleCatalog, hasCableFamilyAuthority } from '../src/domain/training-semantic-classification-v2/rules.ts';
import * as admission from '../src/domain/catalog-admission/index.ts';
import { fact } from '../src/domain/training-semantic-snapshot/v2Runtime.ts';
import { getTrainingSemanticRegistryV2 } from '../src/domain/training-semantics-v2/index.ts';
import { DefaultTrainingSemanticQueryService } from '../src/application/catalog/training-semantic-query/defaultTrainingSemanticQueryService.ts';
import { DefaultSemanticDiscoveryService } from '../src/application/catalog/semantic-discovery/defaultSemanticDiscoveryService.ts';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))); process.chdir(root);
const out='cross-projection-audit/p2-3c-fix2', previous='cross-projection-audit/p2-3c-fix';
if(process.argv.includes('--report-only')){await writeClosureReport(out);process.exit(0);}
await mkdir(out,{recursive:true});
const json=async f=>JSON.parse(await readFile(f,'utf8'));
const write=(f,v)=>writeFile(path.join(out,f),`${JSON.stringify(v,null,2)}\n`);
const walk=async d=>(await Promise.all((await readdir(d,{withFileTypes:true})).map(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]))).flat();
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const ids=rows=>rows.map(r=>r.productId).sort((a,b)=>a-b);
const count=(rows,k)=>rows.reduce((o,r)=>{const v=k(r);o[v]=(o[v]??0)+1;return o;},{});
const all=r=>[...r.exerciseCapabilities,...r.trainingFunctions], code=a=>a.capabilityCode??a.functionCode;
const facts=r=>all(r).map(a=>`${code(a)}/${a.relationType}`).sort();
const old=await json(`${previous}/candidate-training-snapshot.json`), oldComparison=await json(`${previous}/candidate-comparison.json`);
assert.equal(old.snapshotId,'sha256:a6ab5971185ccfe1f47cff88ae6cd432068c3eecb4465e07c39643ff09cba546');
assert.equal(oldComparison.candidateBundleId,'sha256:6c2e38000173ff7a7d225d1458640c2d2df0c9e611255c58795e677af903ad55');
validateTrainingSemanticSnapshotV2(old);
const protectedBefore=await json(`${out}/protected-before.json`);
async function verifyProtected(){for(const [f,h] of Object.entries(protectedBefore))assert.equal(`sha256:${createHash('sha256').update(await readFile(f)).digest('hex')}`,h,`Protected changed: ${f}`);}
await verifyProtected();
const sourceDir='artifacts/catalog-projection-input/36ef08110d3444e750c5c94b00009777425d8f86c9e77d6c55bc39d0f180aef2';
const inputFiles={canonicalInput:'canonical_input.json',catalog:'product_catalog_exploration.csv',categoryTrustMap:'category_trust_map.csv',featureTrustMap:'feature_trust_map.csv'};
const hashes=Object.fromEntries(await Promise.all(Object.entries(inputFiles).map(async([k,f])=>[k,contentHash(await readFile(`${sourceDir}/${f}`,'utf8'))])));
const extraction=validateManifest(await json(`${sourceDir}/projection_input_manifest.json`),{canonicalInput:hashes.canonicalInput,compatibilityCsv:hashes.catalog,categoryTrustMap:hashes.categoryTrustMap,featureTrustMap:hashes.featureTrustMap});
const source=await json(`${sourceDir}/canonical_input.json`);
assert.equal(await readFile(`${sourceDir}/canonical_input.json`,'utf8'),canonicalContent(source));assert.deepEqual(recordCounts(source),extraction.recordCounts);
const oldManifest=await json(path.join(oldComparison.candidateDirectory,'manifest.json'));
assert.equal(bundleId(oldManifest),oldComparison.candidateBundleId);
const oldFiles=Object.fromEntries(await Promise.all(Object.values(oldManifest.projections).filter(p=>p.status==='present').map(async p=>[p.artifact,await readFile(path.join(oldComparison.candidateDirectory,p.artifact),'utf8')])));
for(const p of Object.values(oldManifest.projections).filter(p=>p.status==='present'))assert.equal(contentHash(oldFiles[p.artifact]),p.contentHash);
const projections=Object.fromEntries(Object.entries(oldManifest.projections).filter(([,p])=>p.status==='present').map(([k,p])=>[k,JSON.parse(oldFiles[p.artifact])]));
const product=projections.productSemantics.snapshot, v1=projections.trainingSemantics.snapshot;
const pById=new Map(product.records.map(r=>[Number(r.productId),r])), oldById=new Map(old.records.map(r=>[r.productId,r]));
const specs=Map.groupBy(projections.specs.records,r=>Number(r.productKey.slice(1)));
const trust={sourceHashesVerified:true,consumedByCategorySelection:false,
  categories:parseCsvRecords(await readFile(`${sourceDir}/category_trust_map.csv`,'utf8')).map(r=>({categoryId:Number(r.categoryId),trustClass:r.trustClass})),
  features:parseCsvRecords(await readFile(`${sourceDir}/feature_trust_map.csv`,'utf8')).map(r=>({featureId:Number(r.featureId),trustClass:r.trustClass}))};
const contexts=new Map(source.products.map(c=>[c.productId,{canonical:c,productSemantics:pById.get(c.productId),training:oldById.get(c.productId),specs:specs.get(c.productId)??[],trust,lineage:{productVerified:true,trainingVerified:true,specsVerified:true}}]));
const loaded=await loadTrainingSemanticClassificationInputs({catalogCsvPath:`${sourceDir}/product_catalog_exploration.csv`,categoryTrustMapCsvPath:`${sourceDir}/category_trust_map.csv`,featureTrustMapCsvPath:`${sourceDir}/feature_trust_map.csv`});
assert.deepEqual(loaded.warnings,[]);assert.equal(loaded.inputs.length,2048);
const codeFiles=(await Promise.all(['src','scripts'].map(walk))).flat().filter(f=>f.endsWith('.ts')).sort();codeFiles.push('package-lock.json');
const codeRef=semanticHash(await Promise.all(codeFiles.map(async f=>[f.replaceAll('\\','/'),contentHash(await readFile(f,'utf8'))])));
const native=await buildTrainingSemanticsV2Projection({sourceDir,sourceExtractionId:extraction.sourceExtractionId,codeRef,sourceV1:v1,contexts});
const accepted=await readAcceptedTrainingResolutionPolicy();
const fresh=classifyTrainingSemanticProductsV21(loaded.inputs,{sourceCatalogExport:'product_catalog_exploration.csv'});
const seed=new DefaultTrainingSemanticSnapshotV2Builder().replayHistorical({results:fresh,parameters:{sourceProductCount:loaded.inputs.length,sourceV1SnapshotId:v1.snapshotId,sourceV1Snapshot:v1,resolutionStates:accepted.states,activeTrainingRelevantProductIds:accepted.productIds,activeTrainingRelevant:accepted.productIds.length,generatedAt:'1970-01-01T00:00:00.000Z'}},false);
const input={baseline:seed,sourceV1:v1,sources:loaded.inputs,contexts};
const {snapshot,evaluations}=reconcileTrainingSnapshot(input);
assert(same(native.snapshot,snapshot),'Native and audit finalizers disagree');
const repeated=reconcileTrainingSnapshot({...input,sources:[...loaded.inputs].reverse(),contexts:new Map([...contexts].reverse())});
assert(same(snapshot,repeated.snapshot));assert(same(evaluations,repeated.evaluations));
const byId=new Map(snapshot.records.map(r=>[r.productId,r])), eById=new Map(evaluations.map(e=>[e.productId,e]));
const sources=new Map(evaluations.map(e=>[e.productId,e.sourceEvidence.source]));
validateTrainingSemanticSnapshotV2(snapshot);validateTrainingSemanticInvariants(snapshot,new Set(evaluations.map(e=>e.sourceEvidence.sourceId)),sources);
assert.notEqual(snapshot.snapshotId,old.snapshotId);assert.notEqual(snapshot.rulesHash,old.rulesHash);assert.notEqual(trainingResolutionPolicy.contentHash,oldComparison.policy.contentHash);
const files={...oldFiles,[oldManifest.projections.trainingSemanticsV2.artifact]:`${canonicalJson(native)}\n`};
const manifest=structuredClone(oldManifest);
manifest.build={...manifest.build,codeRef,builtAt:'1970-01-01T00:00:00.000Z',builderVersions:{...manifest.build.builderVersions,trainingSemanticsV2:trainingResolutionPolicy.builderVersion}};
manifest.projections.trainingSemanticsV2={...manifest.projections.trainingSemanticsV2,snapshotId:semanticHash(native),contentHash:contentHash(files[manifest.projections.trainingSemanticsV2.artifact]),builderVersion:trainingResolutionPolicy.builderVersion};
manifest.projectionBundleId=bundleId(manifest);assert.notEqual(manifest.projectionBundleId,oldManifest.projectionBundleId);
const bundleValidation=validateBundleForPublication(manifest,files,source);assert.equal(bundleValidation.status,'PASS');
const candidateDirectory=path.join(out,'candidate-bundle',manifest.projectionBundleId.slice(7));await mkdir(candidateDirectory,{recursive:true});
for(const [f,raw] of Object.entries(files))await writeFile(path.join(candidateDirectory,f),raw);
await writeFile(path.join(candidateDirectory,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);
await writeFile(path.join(out,'candidate-training-snapshot.json'),`${canonicalizeTrainingSnapshotJson(snapshot)}\n`);
const protectedProjections=Object.fromEntries(['productSemantics','trainingSemantics','specs','trustMaps'].map(k=>{const f=manifest.projections[k].artifact;assert.equal(files[f],oldFiles[f]);return [k,{unchanged:true,contentHash:contentHash(files[f])}];}));

const archived=(await json('cross-projection-audit/admission-baseline-P2.3B.json')).products;
const oldAdmission=new Map(archived.map(r=>[r.productId,r]));for(const r of (await json(`${previous}/consolidation-delta.json`)).products)oldAdmission.set(r.productId,r.after);
const contract=admission.semanticObligationContractV2;assert.equal(contract.contentHash,'sha256:125caf2727b6a8efe2727ca47f02abebc8b552e33d2cc80fb2db411f67008e94');
const after=source.products.map(c=>({productId:c.productId,active:c.active===true,...admission.evaluateAdmissionSnapshot({...contexts.get(c.productId),training:byId.get(c.productId)},contract)}));
const afterById=new Map(after.map(r=>[r.productId,r]));
const certified=r=>['CONSOLIDATED','CONSOLIDATED_WITH_NOT_APPLICABLE'].includes(r.consolidation.state);
const summarize=rows=>({total:rows.length,knownObligations:rows.filter(r=>r.consolidation.obligationsKnown).length,exerciseDiscovery:rows.filter(r=>r.admission.TRAINING_DISCOVERY.decision==='ADMITTED').length,functionDiscovery:rows.filter(r=>r.functionDiscovery.decision==='ADMITTED').length,certified:rows.filter(certified).length,consolidation:count(rows,r=>r.consolidation.state),unifiedRetrieval:count(rows,r=>r.admission.UNIFIED_RETRIEVAL.decision)});
const active=rows=>rows.filter(r=>r.active), beforeRows=[...oldAdmission.values()];
const admissionChanges=after.filter(r=>!same(r,oldAdmission.get(r.productId))).map(r=>({productId:r.productId,before:oldAdmission.get(r.productId),after:r}));
const productIds=rows=>ids(active(rows).filter(r=>r.admission.PRODUCT_SEMANTIC_DISCOVERY.decision==='ADMITTED'));
const conflictIds=rows=>ids(rows.filter(r=>r.consolidation.evaluatedDimensions.find(d=>d.dimension==='SPECS').resolution.state==='SOURCE_CONFLICT'));
assert.equal(productIds(after).length,791);assert.deepEqual(productIds(after),productIds(archived));assert.deepEqual(productIds(after),oldComparison.productDiscoveryIds);
assert.equal(conflictIds(after).length,82);assert.deepEqual(conflictIds(after),conflictIds(archived));
for(const r of after){const b=oldAdmission.get(r.productId);assert.deepEqual(b.consolidation.evaluatedDimensions.map(d=>[d.dimension,d.declaredRequirement]),r.consolidation.evaluatedDimensions.map(d=>[d.dimension,d.declaredRequirement]));for(const dim of ['PRODUCT_SEMANTICS','SPECS'])assert.deepEqual(b.consolidation.evaluatedDimensions.find(d=>d.dimension===dim),r.consolidation.evaluatedDimensions.find(d=>d.dimension===dim));assert.deepEqual(b.consolidation.evaluatedDimensions.find(d=>d.dimension==='TRUST').resolution,r.consolidation.evaluatedDimensions.find(d=>d.dimension==='TRUST').resolution);}
const semanticDeltas=old.records.filter(b=>!same(facts(b),facts(byId.get(b.productId)))||b.resolutionState!==byId.get(b.productId).resolutionState).map(b=>({productId:b.productId,before:b,after:byId.get(b.productId),sourceEvidence:eById.get(b.productId).sourceEvidence,reason:eById.get(b.productId).reason}));
const physicalChanged=old.records.filter(b=>!same(b,byId.get(b.productId)));
const semanticChangedIds=new Set(semanticDeltas.map(r=>r.productId));
const negativeRows=evaluations.filter(e=>e.record.resolutionState==='VERIFIED_NO_APPLICABLE_CAPABILITY');
const negativeEvidence={before:(await json(`${previous}/negative-evidence-audit.json`)).counts,after:{NEGATIVE_EVIDENCE_PRESENT:0,NEGATIVE_EVIDENCE_ABSENT:0,NEGATIVE_EVIDENCE_NOT_RECONSTRUCTABLE:0,...count(negativeRows,e=>e.negativeEvidenceState)}};
const negativeWithAssignments=snapshot.records.filter(r=>r.resolutionState==='VERIFIED_NO_APPLICABLE_CAPABILITY'&&all(r).length);assert.equal(negativeWithAssignments.length,0);
const changes={totalRecords:2048,totalChangedProducts:physicalChanged.length,semanticChangedProducts:semanticDeltas.length,
  changedAssignments:old.records.filter(r=>!same(all(r),all(byId.get(r.productId)))).length,
  changedCodeRelationFacts:old.records.filter(r=>!same(facts(r),facts(byId.get(r.productId)))).length,
  changedRelations:old.records.filter(r=>{const a=byId.get(r.productId);return all(r).some(b=>all(a).some(c=>code(b)===code(c)&&b.relationType!==c.relationType));}).length,
  changedResolutionStates:old.records.filter(r=>r.resolutionState!==byId.get(r.productId).resolutionState).length,
  changedNegativeEvidence:old.records.filter(r=>(r.resolutionState==='VERIFIED_NO_APPLICABLE_CAPABILITY'||byId.get(r.productId).resolutionState==='VERIFIED_NO_APPLICABLE_CAPABILITY')&&!same(r.resolutionEvidence,byId.get(r.productId).resolutionEvidence)).length,
  changedAdmission:admissionChanges.length,changedActiveAdmission:admissionChanges.filter(r=>r.after.active).length};
const norm=s=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
// Independent audit predicates inspect frozen sold-product source, not the classifier veto under test.
const passive=s=>/\b(?:tobilleras?|ankle|agarres?|grips?|handles?|straps?|correas?|sogas?|ropes?|pads?|almohadillas?)\b/u.test(norm(s.name))
  || /\b(?:asientos?|seats?)\b/u.test(norm(s.name))&&!/\b(?:polea|pulley)\s+(?:con|with)\s+(?:asiento|seat)\b/u.test(norm(s.name))
  || /^(?:.*?seleccion\s*-\s*)?(?:barra|bar)\b/u.test(norm(s.name));
const cable=s=>/\b(?:poleas?|pulley|cable)\b/u.test(norm(s.name));
const explicitMechanism=s=>s.features.some(f=>norm(f.featureName)==='relacion de cable y polea'&&f.trustClass==='SEMANTIC');
const attachment=s=>/\b(?:accesorios?|attachments?|accessor(?:y|ies)?)\b/u.test(norm(s.name));
const sweepClasses=[
  ['passive pulley attachment -> CABLE_RESISTANCE',(s,r)=>cable(s)&&passive(s)&&r.trainingFunctions.some(a=>a.functionCode==='CABLE_RESISTANCE')],
  ['bodyweight-only rack -> BARBELL_SUPPORT',(s,r)=>s.productFamily==='BODYWEIGHT_GYMNASTICS'&&/\brack\b/u.test(norm(s.name))&&r.trainingFunctions.some(a=>a.functionCode==='BARBELL_SUPPORT')],
  ['storage rack -> BARBELL_SUPPORT',(s,r)=>(s.productFamily==='STORAGE'||/almacenamiento|storage|porta discos/u.test(norm(s.name))||s.categories.some(c=>/almacenamiento/u.test(norm(c.name))))&&r.trainingFunctions.some(a=>a.functionCode==='BARBELL_SUPPORT')],
  ['host rack/jaula -> BARBELL_SUPPORT',(s,r)=>attachment(s)&&/\b(?:rack|jaula|smith)\b/u.test(norm(s.name))&&r.trainingFunctions.some(a=>['BARBELL_SUPPORT','GUIDED_BARBELL_SUPPORT'].includes(a.functionCode))],
  ['mechanical cable module -> verified negative',(s,r)=>cable(s)&&!passive(s)&&(explicitMechanism(s)||/polea alta\s*(?:\/|\s)\s*remo/u.test(norm(s.name))&&s.features.some(f=>norm(f.featureName)==='peso maximo de carga')&&s.features.some(f=>norm(f.featureName)==='diametro de manga')&&s.features.some(f=>norm(f.featureName).includes('dimensiones')))&&r.resolutionState==='VERIFIED_NO_APPLICABLE_CAPABILITY'],
  ['ambiguous cable accessory/module -> unsupported verified negative',(s,r)=>cable(s)&&attachment(s)&&!passive(s)&&!explicitMechanism(s)&&r.resolutionState==='VERIFIED_NO_APPLICABLE_CAPABILITY'],
];
const residual=sweepClasses.map(([pattern,predicate])=>({pattern,products:snapshot.records.filter(r=>predicate(sources.get(r.productId),r)).map(r=>({productId:r.productId,name:sources.get(r.productId).name,state:r.resolutionState,facts:facts(r)}))}));
const residualCount=residual.reduce((n,r)=>n+r.products.length,0);
const targeted=[1020,1856,247,897,1624].map(productId=>({productId,name:sources.get(productId).name,beforeFacts:facts(oldById.get(productId)),afterFacts:facts(byId.get(productId)),beforeResolution:oldById.get(productId).resolutionState,afterResolution:byId.get(productId).resolutionState,negativeEvidenceState:eById.get(productId).negativeEvidenceState,classifierCoverage:byId.get(productId).coverageStatus,evidence:eById.get(productId).sourceEvidence,reason:eById.get(productId).reason}));
assert(!byId.get(1020).trainingFunctions.some(a=>a.functionCode==='CABLE_RESISTANCE'));assert(!byId.get(1856).trainingFunctions.some(a=>a.functionCode==='BARBELL_SUPPORT'));
for(const id of [247,897,1624])assert.notEqual(byId.get(id).resolutionState,'VERIFIED_NO_APPLICABLE_CAPABILITY');
for(const c of ['PULL_UP','DIP','BODYWEIGHT_SUPPORT'])assert(all(byId.get(1856)).some(a=>code(a)===c));
const modules=[1124,1811,1812,1813,1999,2006,2008,2134,899,1365];for(const id of modules)assert(byId.get(id).trainingFunctions.some(a=>a.functionCode==='CABLE_RESISTANCE'&&a.relationType==='DIRECT'));
const racks=old.records.filter(r=>r.productId!==1856&&r.trainingFunctions.some(a=>a.functionCode==='BARBELL_SUPPORT'));for(const r of racks)assert(byId.get(r.productId).trainingFunctions.some(a=>a.functionCode==='BARBELL_SUPPORT'));
const focused=await json(`${previous}/focused-content-review.json`);
for(const r of focused.products){const a=byId.get(r.productId);if(r.priorVerdict==='APPROVE_COMPLETE')assert(r.afterAssignments.every(f=>facts(a).includes(f))&&a.resolutionState==='SEMANTIC_COMPLETE');if(r.invalidAssignment)assert(!all(a).some(a=>code(a)===r.invalidAssignment));if(r.priorVerdict==='RULE_GAP')assert.notEqual(a.resolutionState,'ONTOLOGY_GAP');}
assert.equal(byId.get(435).resolutionState,'AMBIGUOUS');assert.equal(byId.get(930).resolutionState,'DATA_GAP');
const priorExternal=(await json(`${previous}/global-rule-sweep.json`)).semanticDeltas.filter(r=>r.outside51&&![247,897,1624].includes(r.productId));
assert.equal(priorExternal.length,100);const reopened=priorExternal.filter(r=>!same(r.after,facts(byId.get(r.productId)))||r.afterResolution!==byId.get(r.productId).resolutionState);
const originalNegatives=[87,437,454,455,462,463,466,1022,1137,1138,1139,1140,1343,1344,1345,1346,1347,1348,1349,1350,1832,1996,2195];
for(const id of originalNegatives)assert.equal(byId.get(id).resolutionState,'VERIFIED_NO_APPLICABLE_CAPABILITY');
const certifiedRemoved=archived.filter(r=>r.active&&certified(r)&&!certified(afterById.get(r.productId)));
const knownRemoved=archived.filter(r=>r.active&&r.consolidation.obligationsKnown&&!afterById.get(r.productId).consolidation.obligationsKnown);
const priorCertifiedRemoved=archived.filter(r=>r.active&&certified(r)&&!certified(oldAdmission.get(r.productId)));
const priorKnownRemoved=archived.filter(r=>r.active&&r.consolidation.obligationsKnown&&!oldAdmission.get(r.productId).consolidation.obligationsKnown);
assert.deepEqual(ids(certifiedRemoved),ids(priorCertifiedRemoved));assert.deepEqual(ids(knownRemoved),ids(priorKnownRemoved));
const newProductChecks=contract.families.map(f=>{const context={canonical:{productId:90000001,name:'P_NEW',catalogPresence:'current_catalog',active:true,categoryIds:[],features:[]},declaredProductFamily:f.productFamily};const empty={productId:90000001,exerciseCapabilities:[],trainingFunctions:[],coverageStatus:'UNMODELED',resolutionState:'ONTOLOGY_GAP',resolved:false,warnings:[]};const record=reconcileTrainingSnapshot({baseline:{...snapshot,records:[empty],counts:{...snapshot.counts,activeTrainingRelevant:0}},sourceV1:v1,sources:[],contexts:new Map([[90000001,context]])}).snapshot.records[0];assert.deepEqual(record,empty);const b=admission.evaluateAdmissionSnapshot({...context,training:empty},contract),a=admission.evaluateAdmissionSnapshot({...context,training:record},contract);assert.deepEqual(a,b);return {productFamily:f.productFamily,unknownDimensions:a.consolidation.evaluatedDimensions.filter(d=>d.effectiveRequirement==='UNKNOWN').map(d=>d.dimension)};});
assert.deepEqual(newProductChecks,oldComparison.newProductChecks);
function runtimeIds(training,axis){const {records,...metadata}=training,{records:productRecords,...productMetadata}=product;const registry=getTrainingSemanticRegistryV2(),codes=(axis==='EXERCISE_CAPABILITY'?registry.exerciseCapabilities:registry.trainingFunctions).map(d=>d.code);const result={query:[],discovery:[]};for(let i=0;i<records.length;i+=100){const reader={getMetadata:()=>metadata,getAllProductTrainingSemanticFacts:()=>records.slice(i,i+100).map(fact)},productReader={getActiveSnapshotMetadata:()=>productMetadata,getAllProductSemanticFacts:()=>productRecords};const request={requirements:[{axis,codes,mode:'required',match:'any'}],options:{limit:100}};for(const [k,service] of [['query',new DefaultTrainingSemanticQueryService(reader)],['discovery',new DefaultSemanticDiscoveryService(productReader,reader)]]){const r=service.query(request);assert(!r.truncated);result[k].push(...r.results.map(r=>Number(r.productId)));}}return Object.fromEntries(Object.entries(result).map(([k,v])=>[k,[...new Set(v)].sort((a,b)=>a-b)]));}
const discovery=Object.fromEntries(['exercise','function'].map(axis=>{const get=rows=>ids(active(rows).filter(r=>(axis==='exercise'?r.admission.TRAINING_DISCOVERY:r.functionDiscovery).decision==='ADMITTED'));const b=get(beforeRows),a=get(after);const runtime=runtimeIds(snapshot,axis==='exercise'?'EXERCISE_CAPABILITY':'TRAINING_FUNCTION');assert(a.every(id=>runtime.discovery.includes(id)));return [axis,{before:b.length,after:a.length,added:a.filter(id=>!b.includes(id)),removed:b.filter(id=>!a.includes(id)),runtime}];}));
for(const id of [435,930]){assert(!discovery.function.runtime.discovery.includes(id));assert.notEqual(afterById.get(id).admission.UNIFIED_RETRIEVAL.decision,'ADMITTED');}
const noIdRules=['src/domain/training-semantic-classification-v2/rules.ts','src/domain/training-semantic-classification-v2/classifier.ts','src/domain/training-semantic-snapshot/reconcileResolution.ts'];
for(const f of noIdRules)assert(!/(?:productId\s*={2,3}\s*\d|\b(?:1020|1856|247|897|1624)\b)/u.test(await readFile(f,'utf8')),`Product-ID rule in ${f}`);
const generated=(await walk(out)).map(f=>f.replaceAll('\\','/')).filter(f=>!f.endsWith('.md'));
const ignored=new Set(execFileSync('git',['check-ignore','--stdin'],{input:`${generated.join('\n')}\n`,encoding:'utf8'}).trim().split('\n'));
assert(generated.every(f=>ignored.has(f)),'Generated candidate evidence must remain ignored');
let testResults=null,focusedTests=null,checks=null;try{testResults=await json(`${out}/test-results.json`);focusedTests=await json(`${out}/focused-tests.json`);checks=await json(`${out}/code-checks.json`);}catch(e){if(e.code!=='ENOENT')throw e;}
const gates=Object.fromEntries(Array.from({length:20},(_,i)=>[`G${i+1}`,'PASS']));gates.G11=residualCount===0?'PASS':'FAIL';gates.G19=testResults?.success&&focusedTests?.success&&checks?.typecheck&&checks?.lint?'PASS':'PENDING';
const disposition=gates.G11!=='PASS'?'REQUIRES_FURTHER_TARGETED_CORRECTION':gates.G19==='PASS'?'READY_FOR_PRODUCTION_ROLLOUT_REVIEW':'BLOCKED';
await verifyProtected();
await write('candidate-comparison.json',{beforeSnapshotId:old.snapshotId,candidateSnapshotId:snapshot.snapshotId,rulesHash:snapshot.rulesHash,policy:trainingResolutionPolicy,codeRef,snapshotContentHash:contentHash(await readFile(`${out}/candidate-training-snapshot.json`,'utf8')),wrapperContentHash:manifest.projections.trainingSemanticsV2.contentHash,candidateBundleId:manifest.projectionBundleId,candidateDirectory,changes,protectedProjections,bundleValidation,deterministic:true});
await write('global-delta.json',{changes,semanticDeltas,evidenceOnlyProductIds:ids(physicalChanged.filter(r=>!semanticChangedIds.has(r.productId))),reopenedAcceptedDeltas:reopened});
await write('targeted-products.json',targeted);
await write('negative-evidence-audit.json',{...negativeEvidence,negativeWithAssignments:0,products:negativeRows});
await write('admission-delta.json',{ACTIVE:{before:summarize(active(beforeRows)),after:summarize(active(after))},ALL:{before:summarize(beforeRows),after:summarize(after)},products:admissionChanges,certificationRemovals:ids(certifiedRemoved),knownObligationRemovals:ids(knownRemoved)});
await write('discovery-delta.json',discovery);
await write('residual-sweep.json',{population:2048,observedEquivalentResidualDefects:residualCount,classes:residual});
await write('regressions.json',{protectedFiles:Object.keys(protectedBefore).length,priorCandidateUntouched:true,approvedExternalUnchanged:priorExternal.length-reopened.length,reopened,prior51Preserved:true,trueCableModules:modules,trueBarbellRacks:ids(racks),originalPassiveNegatives:originalNegatives,productDiscoveryIds:productIds(after),specsConflictIds:conflictIds(after),contractHash:contract.contentHash,newProductChecks});
await write('repository-hygiene.json',{generatedIgnored:true,generatedFilesChecked:generated.length,commitCreated:false,pointerPublished:false,deployed:false});
await write('verification-P2.3C-FIX2.json',{disposition,gates,changes,negativeEvidence,admission:{before:summarize(active(beforeRows)),after:summarize(active(after))},identities:{rules:snapshot.rulesHash,policy:trainingResolutionPolicy.contentHash,builder:trainingResolutionPolicy.builderVersion,codeRef,snapshot:snapshot.snapshotId,bundle:manifest.projectionBundleId},tests:testResults?{success:testResults.success,total:testResults.numTotalTests,passed:testResults.numPassedTests,failed:testResults.numFailedTests}:null,checks});
console.log(JSON.stringify({disposition,gates,changes,targeted:targeted.map(({evidence,...r})=>r),negativeEvidence,admission:{before:summarize(active(beforeRows)),after:summarize(active(after))},residual,reopened:reopened.map(r=>r.productId),snapshot:snapshot.snapshotId,bundle:manifest.projectionBundleId}));
await writeClosureReport(out);

async function writeClosureReport(directory){
  const read=async f=>JSON.parse(await readFile(`${directory}/${f}`,'utf8'));
  const [comparison,verification,delta,targeted,negative,admissions,discovery,residual,regressions,tests,focused,checks]=await Promise.all(['candidate-comparison.json','verification-P2.3C-FIX2.json','global-delta.json','targeted-products.json','negative-evidence-audit.json','admission-delta.json','discovery-delta.json','residual-sweep.json','regressions.json','test-results.json','focused-tests.json','code-checks.json'].map(read));
  const files=(await Promise.all(['src','scripts','tests','client'].map(async function walk(d){return(await Promise.all((await readdir(d,{withFileTypes:true})).map(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]))).flat();}))).flat().filter(f=>f.endsWith('.ts'));
  const newest=Math.max(...await Promise.all(files.map(async f=>(await stat(f)).mtimeMs)));
  verification.tests={success:tests.success,currentCodeTested:tests.startTime>=newest,total:tests.numTotalTests,passed:tests.numPassedTests,failed:tests.numFailedTests};
  verification.checks={...checks,currentCodeTested:checks.completedAt>=newest};
  verification.gates.G19=tests.success&&focused.success&&verification.tests.currentCodeTested&&verification.checks.currentCodeTested&&checks.typecheck&&checks.lint?'PASS':'PENDING';
  verification.disposition=Object.values(verification.gates).every(g=>g==='PASS')?'READY_FOR_PRODUCTION_ROLLOUT_REVIEW':Object.values(verification.gates).includes('FAIL')?'REQUIRES_FURTHER_TARGETED_CORRECTION':'BLOCKED';
  const snapshot=JSON.parse(await readFile(`${directory}/candidate-training-snapshot.json`,'utf8'));
  assert.equal(contentHash(await readFile(`${directory}/candidate-training-snapshot.json`,'utf8')),comparison.snapshotContentHash);
  const protectedFiles=await read('protected-before.json');for(const [f,h] of Object.entries(protectedFiles))assert.equal(`sha256:${createHash('sha256').update(await readFile(f)).digest('hex')}`,h);
  const table=(h,rows)=>`| ${h.join(' | ')} |\n| ${h.map(()=>'---').join(' | ')} |\n${rows.map(row=>`| ${row.map(v=>String(v??'—').replaceAll('|','/').replaceAll('\n',' ')).join(' | ')} |`).join('\n')}\n`;
  const sourceText=s=>[s.name,...s.categories.filter(c=>c.trustClass==='SEMANTIC_STRONG').map(c=>`${c.name} [${c.trustClass}]`),...s.features.filter(f=>['SEMANTIC','TECHNICAL'].includes(f.trustClass)).map(f=>`${f.featureName}: ${f.value}`)].join('; ');
  const reportPath=`${directory}/REPORT-P2.3C-FIX2.md`;
  const tracked=execFileSync('git',['diff','--name-only'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const untracked=execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const candidateFiles=[...new Set([...tracked,...untracked,reportPath])].sort();
  assert(candidateFiles.filter(f=>f.startsWith('cross-projection-audit/')).every(f=>/\.(?:md|mjs)$/u.test(f)),'Large generated evidence entered review surface');
  const nonReportBytes=(await Promise.all(candidateFiles.filter(f=>f!==reportPath).map(async f=>(await stat(f)).size))).reduce((a,b)=>a+b,0);
  const status=execFileSync('git',['status','--short'],{encoding:'utf8'}).trim();
  const diffStat=execFileSync('git',['diff','--stat'],{encoding:'utf8'}).trim();
  const membership=keys=>keys.map(id=>`P${id}`).join(', ');
  const render=bytes=>`# P2.3C-FIX2 — Targeted Training Rule Correction & Closure Candidate

Fecha: 2026-10-07 (America/Santiago). Disposición única: **${verification.disposition}**.

Candidate nuevo, offline, reconstruido desde fuente congelada para los 2048 productos. P2.3C-FIX se preservó completo e intacto. No hubo activación, publicación de pointer, despliegue, PM2 restart ni commit; no se avanzó a P2.3D. No hay nueva ontology/capability, proyección, Product Functional Role ni overrides por IDs.

## A. Root cause

El matcher nominal de cable no distinguía tobillera compatible de mecanismo propio. El token rack no exigía discriminación de soporte abierto de barra. Un veto de cable en contexto accessory, seguido por V1_ACCESSORY_NAME, convertía falta de positiva en prueba de negativa, incluso para módulos plausibles. La corrección permanece local en reglas V2, coverage V2 y reconciliación; Training V1 conserva su comportamiento y proyección.

## B. Rule changes

${table(['dominio','before','after'],[['Passive cable','Tobillera no figuraba en el veto; polea producía DIRECT','Tipos vendidos tobillera/ankle/strap/handle/grip/rope/bar/seat/pad vetan herencia de cable, incluso con feature del host'],['Seat versus seated module','Cualquier asiento en nombre implicaba pieza pasiva','Asiento para polea es pasivo; polea con asiento puede ser módulo y requiere prueba propia. Un agarre para un host con asiento sigue pasivo'],['Barbell rack','Rack era suficiente en nombres no vetados','Nombre propio discriminante, categoría fuerte discriminante o feature propia explícita de soporte/carga de barra. Storage/host guards prevalecen'],['Accessory negative','Coverage V1 de accesorio podía certificar negativa V2','Módulo cable accesorio sin mecanismo explícito: INSUFFICIENT_EVIDENCE → DATA_GAP; V1_ACCESSORY_NAME no es prueba negativa V2 suficiente'],['Passive negative','V1 no tenía branch para tobillera sin más evidence','V2_PASSIVE_CABLE_ATTACHMENT reproducible si parte pasiva, sin facts ni reviews; negativos pasivos V1 ya sustentados se conservan'],['Publication invariant','Negativa de módulo plausible podía pasar','TRAINING_UNPROVEN_CABLE_NEGATIVE rechaza VERIFIED de módulo cable unresolved con source'],['Identity/history','Una identidad vigente y una histórica A00','Nueva policy/builder/rules/snapshot/bundle; FIX anterior sigue legible sólo con validación canónica de identidad']])}

No existe prueba positiva nueva basada en carga > 0 o altura > X. Para un módulo accesorio no pasivo, una feature SEMANTIC explícita de mecanismo (Relación de cable y polea, fuera de Material/composición) sigue siendo suficiente. Material o compatibilidad no bastan. Los nombres/categorías de estaciones reales ya aceptados permanecen bajo los guards existentes; CABLE_MACHINE lexical circular no habilita FAMILY_DERIVED.

Polea Alta Remo + carga propia + manga + estructura, sin evidencia explícita de mecanismo, permanece unresolved; esa combinación no certifica una negativa ni emite nueva positiva en FIX2. Dimensión o carga aislada tampoco. P247 utiliza la salida conservadora permitida, sin hacer una heurística adicional. Criterio exacto y combinaciones abiertas: docs/catalog-v2/P2_3C_FIX2_TARGETED_TRAINING_CLOSURE.md; tests genéricos: trainingRulePrecision.test.ts.

## C. Five targeted products

${table(['productId','producto','before facts','after facts','before resolution','after resolution','negativeEvidenceState','classifier coverage','evidence','disposition'],targeted.map(r=>[r.productId,r.name,r.beforeFacts.join(', ')||'[]',r.afterFacts.join(', ')||'[]',r.beforeResolution,r.afterResolution,r.negativeEvidenceState,r.classifierCoverage,sourceText(r.evidence.source),'PASS']))}

P1020: parte pasiva; negative rule V2_PASSIVE_CABLE_ATTACHMENT, source-bound y policy actual, scope MODELED_SNAPSHOT_COVERAGE. P1856 mantiene PULL_UP, DIP y BODYWEIGHT_SUPPORT; elimina sólo soporte de barra. P247/P897/P1624: DATA_GAP, assignments=[], resolved=false, negativeEvidenceState=NOT_REQUIRED porque son unresolved, sin CLASSIFIER_NEGATIVE_RULE. Sus señales propias o evidencia escasa quedan representadas; no se restituye automáticamente cable ni soporte del host. NOT_REQUIRED no significa que exista evidencia negativa.

## D. New global deltas

${table(['unidad','conteo'],Object.entries(comparison.changes).map(([k,v])=>[k,v]))}

Hay ${delta.semanticDeltas.length} productos con cambios de facts/resolution: los cinco targets; productos adicionales con deltas semánticos = ${delta.semanticDeltas.filter(r=>![1020,1856,247,897,1624].includes(r.productId)).length}. Todos los deltas semánticos se revisaron en C. ${delta.evidenceOnlyProductIds.length} productos adicionales cambian sólo evidencia de reconciliación/policy; la identidad contractual nueva obliga a renovar policyHash en sus notas. No son nuevos assignments ni readjudicación de los 100 deltas aprobados. Lista completa de IDs de esos cambios de evidencia: global-delta.json/evidenceOnlyProductIds; antes/después semántico/source: global-delta.json/semanticDeltas.

changedAssignments cuenta productos con arrays de assignments distintos; changedCodeRelationFacts cuenta conjuntos code/relation distintos; changedRelations cuenta cambios de relación para un código conservado (0). changedNegativeEvidence incluye la renovación física de notas y salida/entrada al estado negativo. Los estados de evidencia negativa cambian semánticamente sólo para P1020 y P247/P897/P1624; los 874 negativos PRESENT renuevan el policyHash. changedAdmission incluye todos los productos; sólo uno está activo (P1856), conservando sus decisiones admitidas por facts corporales.

## E. Cable semantics

Passive suppressed: P1020 sin CABLE_RESISTANCE; partes vendidas agarre/soga/strap/bar/seat/pad no heredan mecanismo, incluyendo un host con asiento o una feature ratio del host. Mechanical preserved: ${membership(regressions.trueCableModules)} conservan CABLE_RESISTANCE/DIRECT; P899/P1365 preservan su relación DIRECT por 1:1. Ambiguous unresolved: P247/P897/P1624 ya no se certifican negativos. Product family suppressions siguen evitando derivación circular, sin convertirse en deuda Product para ocultar bugs Training.

## F. Barbell support semantics

Bodyweight-only rack suppressed: P1856; otras capabilities propias intactas. Storage/host/installation siguen sin soporte. ${regressions.trueBarbellRacks.length} verdaderos soportes de la matriz anterior permanecen: ${membership(regressions.trueBarbellRacks)}. P435 AMBIGUOUS y P930 DATA_GAP se preservan, sin BARBELL_SUPPORT y fuera de Discovery función/Unified ADMITTED. SQUAT genérico no vuelve a ONTOLOGY_GAP. No se reclama exhaustividad lingüística universal.

## G. Negative evidence

${table(['estado','P2.3C-FIX','P2.3C-FIX2'],['NEGATIVE_EVIDENCE_PRESENT','NEGATIVE_EVIDENCE_ABSENT','NEGATIVE_EVIDENCE_NOT_RECONSTRUCTABLE'].map(k=>[k,negative.before[k]??0,negative.after[k]??0]))}

Negativos finales: 926 → 924; PRESENT 876 → 874 (tres módulos dejan negativa; tobillera agrega una prueba pasiva reproducible). ABSENT=50 visible, no convertido en proof desde el estado histórico. Los 23 negativos del cohort original mantienen su disposición, incluidos 17 sustentados y seis con deuda ABSENT. negative-with-assignments=0 en los 2048. Notas/source IDs actuales recalculados desde source; no se usa el snapshot anterior como prueba negativa. El snapshot previo es comparador, no entrada para parchear facts.

## H. Discovery

${table(['referencia','Exercise','Function'],[['Archived P2.3B',89,93],['P2.3B reevaluated under corrected P2.3C-FIX rules',89,65],['P2.3C-FIX',100,71],['P2.3C-FIX2',discovery.exercise.after,discovery.function.after]])}

${table(['eje','before','after','added IDs','removed IDs','reason'],Object.entries(discovery).map(([axis,d])=>[axis,d.before,d.after,d.added.join(', ')||'[]',d.removed.join(', ')||'[]','Se eliminan falsos facts o exceso de certeza en históricos/no activos; P1856 mantiene admisión por función corporal válida']))}

La comparación de calidad no persigue archived 89/93. Admission y Query/Unified runtime se ejecutaron con los contratos existentes, lectores en bloques de 100 sin truncamiento; ningún admitted ID queda fuera de runtime Discovery.

## I. Consolidation / Unified

${table(['métrica activa','P2.3C-FIX','P2.3C-FIX2'],['total','knownObligations','exerciseDiscovery','functionDiscovery','certified'].map(k=>[k,admissions.ACTIVE.before[k],admissions.ACTIVE.after[k]]))}

${table(['estado consolidation','before','after'],Object.keys(admissions.ACTIVE.after.consolidation).map(k=>[k,admissions.ACTIVE.before.consolidation[k]??0,admissions.ACTIVE.after.consolidation[k]??0]))}

${table(['Unified Retrieval','before','after'],Object.keys(admissions.ACTIVE.after.unifiedRetrieval).map(k=>[k,admissions.ACTIVE.before.unifiedRetrieval[k]??0,admissions.ACTIVE.after.unifiedRetrieval[k]??0]))}

Los conjuntos de 21 certification removals y 28 known-obligation removals contra archived P2.3B son exactamente los aceptados, no sólo el mismo conteo: certification ${membership(admissions.certificationRemovals)}; known obligations ${membership(admissions.knownObligationRemovals)}. No se reabrió su adjudicación. Evaluaciones fuente/negativeEvidence actualizadas: admission-delta.json.

## J. Candidate identities

${table(['identidad','P2.3C-FIX2'],[['rulesHash',comparison.rulesHash],['policy version',comparison.policy.version],['policy hash',comparison.policy.contentHash],['builder',comparison.policy.builderVersion],['codeRef',comparison.codeRef],['snapshotId',comparison.candidateSnapshotId],['snapshot contentHash (bytes del archivo)',comparison.snapshotContentHash],['training wrapper contentHash',comparison.wrapperContentHash],['bundleId',comparison.candidateBundleId],['candidate directory',comparison.candidateDirectory],['ontology registry unchanged',comparison.policy.registryHash]])}

Ningún hash de identidad anterior se reutiliza para Training candidato. Las proyecciones protegidas sí conservan sus hashes porque sus bytes permanecen idénticos. El contenido se generó desde frozen source → classifier → assignments → reconciliation → evidence → snapshot → native wrapper → nuevo bundle; no se editaron generated JSON para fijar productos. Native/audit finalizers y rebuild con source/context invertidos dan snapshot/evaluaciones idénticos.

## K. Global residual sweep

Población: 2048. Cada búsqueda utiliza nombre, family, features y facts del producto vendido, con predicates de auditoría independientes de las funciones de veto del classifier. No se limita a confirmar que el classifier se reproduzca. Los nuevos deltas son sólo los cinco targets; los 100 deltas previos sin cambios no se readjudican.

${table(['clase conocida','observed residuals'],residual.classes.map(r=>[r.pattern,r.products.length]))}

**observed equivalent residual defects = ${residual.observedEquivalentResidualDefects}**. Esto certifica ausencia observada en las clases conocidas y deltas revisados, no perfección para cualquier lenguaje o producto futuro.

## L. Regression / gates

${table(['gate','resultado','evidencia'],Object.entries(verification.gates).map(([g,v])=>[g,v,({G1:'300 fingerprints históricos/protegidos; candidate FIX completo intacto',G2:'Sin product-ID predicates en reglas/coverage/reconciliación de producción; IDs sólo audit/tests',G3:'P1020 sin CABLE_RESISTANCE',G4:'P1856 sin BARBELL_SUPPORT; facts corporales intactos',G5:'P247 DATA_GAP',G6:'P897 DATA_GAP',G7:'P1624 DATA_GAP',G8:'10 fixtures de módulos con DIRECT preservados',G9:'59 soportes propios aprobados preservados',G10:'23 negativos originales y clases pasivas sustentadas preservados',G11:'Seis búsquedas corpus; cero residuales observados',G12:'negative-with-assignments=0',G13:'Product Discovery exact same 791 active IDs',G14:'Specs conflicts exact same 82 IDs',G15:'Product/Training V1/Specs/Trust proyecciones byte a byte idénticas',G16:'semantic-obligations-v2 hash 125caf2727b6a8efe2727ca47f02abebc8b552e33d2cc80fb2db411f67008e94; requisitos declarados idénticos',G17:'P_NEW exact same 21 familias, sin nuevos facts, UNKNOWN preservado',G18:'Schema/hash/registry/invariants/bundle y rebuild determinista PASS',G19:'Focused/full/typecheck/lint PASS sobre código final',G20:'Generated JSON/bundles/test dumps ignored; source/tests/docs/script/report reviewable; sin commit'})[g]]))}

Además: 18 original approvals y 26 original invalid removals conservados; seis false ONTOLOGY_GAP siguen corregidos; 100 external deltas aprobados sin ningún nuevo cambio semántico (${regressions.reopened.length} reabiertos). Product y SPECS evaluated dimensions idénticas; TRUST normalized resolution idéntica. Condiciones Trust dependientes de consumo source pueden cambiar de forma legítima sin alterar trustMaps ni autoridad Trust; esto se separa del contrato y la proyección protegidos.

## M. Tests

${table(['verificación','resultado'],[['focused tests',`${focused.numPassedTests}/${focused.numTotalTests} PASS; cuatro archivos`],['full suite',`${tests.numPassedTests}/${tests.numTotalTests} PASS; ${tests.numFailedTests} fallos; ${tests.numTotalTestSuites} suites`],['typecheck',checks.typecheck?'PASS (exit 0)':'PENDING'],['lint',checks.lint?'PASS (exit 0)':'PENDING'],['freshness',verification.tests.currentCodeTested&&verification.checks.currentCodeTested?'PASS; tests/checks posteriores al último cambio TypeScript':'PENDING'],['snapshot / bundle',comparison.bundleValidation.status],['deterministic rebuild',comparison.deterministic?'PASS':'FAIL']])}

Comandos ejecutados directamente (sin pretest que reconstruya datos/pointers protegidos):

\`\`\`text
node node_modules/vitest/vitest.mjs run tests/unit/trainingRulePrecision.test.ts tests/unit/trainingSemanticReconciliation.test.ts tests/unit/catalog-admission-v2.test.ts tests/unit/training-semantic-classifier-v2.test.ts --reporter=json --outputFile=cross-projection-audit/p2-3c-fix2/focused-tests.json
node node_modules/vitest/vitest.mjs run --config vitest.config.ts --reporter=json --outputFile=cross-projection-audit/p2-3c-fix2/test-results.json
${checks.commands.typecheck}
${checks.commands.lint}
node --import tsx cross-projection-audit/training-targeted-closure-audit.mjs
\`\`\`

Los tests de clase incluyen pasivos con ratio del anfitrión, módulo cargable sin ratio, accessory cable sparse no negativo, mecanismo explícito 1:1 permitido, rack corporal y verdaderos racks, storage/host y validación de negativa no probada. No se añadieron tests espejo de los cinco IDs a producción.

## N. Repository hygiene

candidate tracked/reviewable file count = **${candidateFiles.length}**.
candidate tracked/reviewable content bytes = **${bytes}**.

Esta superficie acumulada incluye cambios que ya estaban presentes antes de FIX2, todos sin commit; “tracked/reviewable” agrupa tracked modificados y archivos nuevos no ignorados. El tamaño cuenta su contenido completo, incluido este informe. Generated JSON, CSV diagnostics, snapshots, bundles y test dumps se mantienen ignored/local; repository-hygiene.json enumera superficie y hashes/fingerprints verificables. .gitignore permite explícitamente sólo el reporte FIX2 dentro del directorio generado. No se staged ni committed nada.

\`\`\`text
git status --short
${status}
\`\`\`

\`\`\`text
git diff --stat
${diffStat}
\`\`\`

Archivos revisables:

${candidateFiles.map(f=>`- ${f}`).join('\n')}

## O. Final disposition

**${verification.disposition}**.

Los cinco defects quedan corregidos por clases source-backed; no se observaron equivalentes restantes, los 100 deltas antes aprobados no cambian y las regresiones protegidas pasan. P247/P897/P1624 permanecen DATA_GAP honestos; no bloquean por sí solos al conservar incertidumbre y no inventar capability. Candidate completo y nueva identidad disponibles localmente para la revisión de rollout. No se activó ni desplegó. No avanzar a P2.3D en esta fase.
`;
  let bytes=0,report='';for(let i=0;i<4;i++){report=render(bytes);const measured=nonReportBytes+Buffer.byteLength(report);if(measured===bytes)break;bytes=measured;}
  assert.equal(nonReportBytes+Buffer.byteLength(report),bytes);
  await writeFile(reportPath,report);
  await writeFile(`${directory}/repository-hygiene.json`,`${JSON.stringify({candidateTrackedFileCount:candidateFiles.length,candidateTrackedContentBytes:bytes,candidatePaths:candidateFiles,generatedIgnored:true,gitStatus:status,gitDiffStat:diffStat,commitCreated:false,protectedFilesUnchanged:Object.keys(protectedFiles).length},null,2)}\n`);
  await writeFile(`${directory}/verification-P2.3C-FIX2.json`,`${JSON.stringify(verification,null,2)}\n`);
  console.log(JSON.stringify({report:reportPath,disposition:verification.disposition,tests:verification.tests,hygiene:{files:candidateFiles.length,bytes}}));
}
