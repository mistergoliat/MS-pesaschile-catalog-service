// Independent read-only QA1: output is restricted to a new audit directory.
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { canonicalJson, bundleId, validateBundle, validateBundleForPublication } from '../../../src/domain/catalog/projection-bundle.ts';
import { canonicalContent, validateManifest, recordCounts } from '../../../src/domain/catalog/projection-input/canonical.ts';
import { getCommercialProductOntologyRegistryV3, computeCommercialProductOntologyRegistryHash } from '../../../src/domain/commercial-product-ontology/index.ts';
import { getTrainingSemanticRegistry } from '../../../src/domain/training-semantics/index.ts';
import { getTrainingSemanticRegistryV2 } from '../../../src/domain/training-semantics-v2/index.ts';
import * as admission from '../../../src/domain/catalog-admission/index.ts';
import { parseCsvRecords } from '../../product-semantic-classification/lib/csv.ts';

export const out = 'artifacts/catalog-v2/qa1/run-20261008-bddf7f';
const candidateDir = 'artifacts/catalog-v2/p2-3c-prb/candidate-1/bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f';
const sourceDir = 'C:/Users/dell/AppData/Local/Temp/p23c-rollout-Vs7KXj/production-baseline/2a5521b77e5b26e2d56104ab2ad29d85aaff82c2f06d522d7aa141f1e062bb26';
const productionDir = 'C:/Users/dell/AppData/Local/Temp/p23c-rollout-Vs7KXj/production-baseline/84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8';
const hash = x => 'sha256:' + createHash('sha256').update(x).digest('hex');
const json = async f => JSON.parse(await readFile(f, 'utf8'));
const save = async (f,x) => writeFile(`${out}/${f}`, JSON.stringify(x,null,2)+'\n');
const byId = rows => new Map(rows.map(r=>[Number(r.productId),r]));
const count = (rows,fn) => rows.reduce((a,r)=>{const k=fn(r);a[k]=(a[k]??0)+1;return a;},{});
const unique = a => [...new Set(a)].sort();
const ids = rows => rows.map(r=>r.productId).sort((a,b)=>a-b);
async function readBundle(dir) {
  const raw=await readFile(`${dir}/manifest.json`,'utf8'),manifest=JSON.parse(raw),files={},projections={};
  assert.equal(bundleId(manifest),manifest.projectionBundleId);
  for(const [k,p] of Object.entries(manifest.projections)) if(p.status==='present') {
    files[p.artifact]=await readFile(`${dir}/${p.artifact}`,'utf8');
    assert.equal(hash(files[p.artifact]),p.contentHash);projections[k]=JSON.parse(files[p.artifact]);
  }
  return {raw,manifest,files,projections};
}
async function verifySource(dir) {
  const names={canonicalInput:'canonical_input.json',compatibilityCsv:'product_catalog_exploration.csv',categoryTrustMap:'category_trust_map.csv',featureTrustMap:'feature_trust_map.csv'},hashes={};
  for(const [k,f] of Object.entries(names))hashes[k]=hash(await readFile(`${dir}/${f}`));
  const raw=await readFile(`${dir}/projection_input_manifest.json`,'utf8'),manifest=validateManifest(JSON.parse(raw),hashes),source=await json(`${dir}/canonical_input.json`);
  assert.equal(await readFile(`${dir}/canonical_input.json`,'utf8'),canonicalContent(source));assert.deepEqual(recordCounts(source),manifest.recordCounts);
  return {source,manifest,hashes,manifestHash:hash(raw)};
}
async function csv(file, rows, columns = Object.keys(rows[0]??{})) {
  const cell = x => '"'+String(x===undefined?'UNAVAILABLE':x===null?'UNKNOWN':typeof x==='object'?JSON.stringify(x):x).replaceAll('"','""')+'"';
  await writeFile(`${out}/${file}`, '\ufeff'+[columns.map(cell).join(','), ...rows.map(r=>columns.map(k=>cell(r[k])).join(','))].join('\r\n')+'\r\n');
}
async function walk(dir) {
  try { return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]))).flat(); }
  catch(e) { if(e.code==='ENOENT')return []; throw e; }
}
async function fingerprints(files) {
  const result={};
  for(const f of files) result[f]=hash(await readFile(f));
  return result;
}
async function authority() {
  const C=await readBundle(candidateDir), A=await readBundle(productionDir), S=await verifySource(sourceDir);
  assert.equal(C.manifest.projectionBundleId,'sha256:bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f');
  assert.equal(A.manifest.projectionBundleId,'sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8');
  assert.equal(S.manifest.sourceExtractionId,'sha256:f505ea3f20740c6b5a64645a369d8c43953086ec7fa1aefd23daa2ccb98db4a9');
  assert.equal(hash(C.raw),'sha256:6b5fc8aec02583c46f24e84921917ff1d878e83978459e0dc6b8fe5c243cf850');
  assert.equal(hash(A.raw),'sha256:c1605f9e311fe0ee79164d1c849a93dd1f64e3a5eca172098d4d4015667bd8b6');
  const validations={candidate:validateBundleForPublication(C.manifest,C.files,S.source),baseline:validateBundle(A.manifest,A.files,S.source)};
  const protectedEquality=Object.fromEntries(['productSemantics','trainingSemantics','specs','trustMaps'].map(k=>{
    assert.equal(C.files[C.manifest.projections[k].artifact],A.files[A.manifest.projections[k].artifact]);return [k,C.manifest.projections[k].contentHash];
  }));
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),'3c1e9c4a17469e9beac4c8cb242aac820635d817');
  return {C,A,S,validations,protectedEquality};
}
if(process.argv[2]==='preflight') {
  try { await access(out); throw new Error('Audit directory already exists; never overwrite a previous run.'); } catch(e) { if(e.code!=='ENOENT')throw e; }
  await mkdir(out,{recursive:true});
  const roots=['artifacts','data','src','scripts','tests','docs','cross-projection-audit',path.dirname(sourceDir)];
  const files=unique((await Promise.all(roots.map(walk))).flat().map(f=>f.replaceAll('\\','/')).filter(f=>!f.startsWith(out+'/')&&!f.startsWith('scripts/audits/qa1/')&&f!=='cross-projection-audit/qa1-inspect.mjs'));
  files.push('package.json','package-lock.json','tsconfig.json','.gitignore');
  await save('protected_before.json',await fingerprints(unique(files)));
  const {C,A,S,validations,protectedEquality}=await authority();
  await save('authority.json',{candidateDirectory:candidateDir,baselineDirectory:productionDir,sourceDirectory:sourceDir,candidateManifest:C.manifest,baselineManifest:A.manifest,sourceManifest:S.manifest,sourceHashes:S.hashes,sourceManifestHash:S.manifestHash,validations,protectedEquality,protectedFileCount:unique(files).length});
  console.log(JSON.stringify({phase:'preflight',protectedFiles:unique(files).length,validations}));
}
if(process.argv[2]==='finalize') {
  const before=await json(`${out}/protected_before.json`),after=await fingerprints(Object.keys(before));
  await save('protected_after.json',after);
  assert.deepEqual(after,before,'Protected file mutation detected');
  await authority();
  const evidence=await fingerprints((await walk(out)).filter(f=>!f.endsWith('evidence_checksums.json')));
  await save('evidence_checksums.json',evidence);
  const summary=await json(`${out}/audit_summary.json`);
  const historicalBefore=await json('artifacts/catalog-v2/p2-3c-prb/protected-after.json');
  const historicalAfter=await fingerprints(Object.keys(historicalBefore));
  assert.deepEqual(historicalAfter,historicalBefore,'Prior historical protected corpus changed');
  await save('historical_corpus_integrity.json',{files:Object.keys(historicalBefore).length,status:'PASS',qualification:'This prior historical corpus does not include the two rewritten PRB evidence files; process_incident.json remains authoritative for that violation.'});
  summary.integrity={status:'PASS_SINCE_QA1_PREFLIGHT',protectedFileCount:Object.keys(before).length,beforeAfterIdentical:true,historicalPriorCorpusFiles:Object.keys(historicalBefore).length,wholeTurnHistoricalEvidenceImmutable:false,qualification:'The first import rewrote two historical PRB evidence files before the QA1 fingerprint capture. No assertion of full-turn read-only compliance.'};
  await save('audit_summary.json',summary);
  await save('evidence_checksums.json',await fingerprints((await walk(out)).filter(f=>!f.endsWith('evidence_checksums.json'))));
  console.log(JSON.stringify({phase:'finalize',integrity:summary.integrity}));
}
if(process.argv[2]==='analyze') {
  const {C,A,S}=await authority(), source=S.source;
  const ontology=getCommercialProductOntologyRegistryV3(),v1=getTrainingSemanticRegistry(),v2=getTrainingSemanticRegistryV2(),contract=admission.semanticObligationContractV2;
  assert.equal(computeCommercialProductOntologyRegistryHash(ontology),C.projections.productSemantics.snapshot.ontologyHash);
  assert.equal(v2.registryHash,C.projections.trainingSemanticsV2.snapshot.registryHash);
  const categories=parseCsvRecords(await readFile(`${sourceDir}/category_trust_map.csv`,'utf8'));
  const features=parseCsvRecords(await readFile(`${sourceDir}/feature_trust_map.csv`,'utf8'));
  const trust={categories:categories.map(r=>({categoryId:Number(r.categoryId),trustClass:r.trustClass})),features:features.map(r=>({featureId:Number(r.featureId),trustClass:r.trustClass})),sourceHashesVerified:true,consumedByCategorySelection:false};
  const products=byId(C.projections.productSemantics.snapshot.records),t1=byId(C.projections.trainingSemantics.snapshot.records),t2=byId(C.projections.trainingSemanticsV2.snapshot.records),old=byId(A.projections.trainingSemanticsV2.snapshot.records);
  const specGroups=Map.groupBy(C.projections.specs.records,r=>Number(r.productKey.slice(1)));
  const archived=await json('artifacts/catalog-v2/p2-3c-prb/admission-rows.json');
  const archivedNegative=byId((await json('artifacts/catalog-v2/p2-3c-prb/negative-evidence.json')).products);
  const priorDelta=byId((await json('artifacts/catalog-v2/p2-3c-prb/training-deltas.json'))['A-C']);
  const records=[],evidence=[],baselineComparison=[],diagnostics=[],conflicts=[];
  const semantic=r=>({resolutionState:r.resolutionState,resolved:r.resolved,coverageStatus:r.coverageStatus,exerciseCapabilities:r.exerciseCapabilities.map(({evidence,provenance,...x})=>x),trainingFunctions:r.trainingFunctions.map(({evidence,provenance,...x})=>x)});
  function diagnostic(dim,r,p) {
    if(r.effectiveRequirement==='NOT_REQUIRED')return 'MODELED_BUT_NOT_APPLICABLE';
    if(p.catalogPresence!=='current_catalog')return 'SOURCE_DATA_INSUFFICIENT';
    if(['DATA_GAP','UNAVAILABLE_PROJECTION'].includes(r.resolution.state))return 'SOURCE_DATA_INSUFFICIENT';
    if(['AMBIGUOUS','PARTIAL','SOURCE_CONFLICT','INVALID_STATE'].includes(r.resolution.state))return 'CLASSIFICATION_UNCERTAIN';
    if(r.effectiveRequirement==='UNKNOWN')return 'NOT_EVALUABLE';
    if(r.resolution.state==='ONTOLOGY_GAP')return 'POTENTIALLY_UNMODELED';
    if(r.terminalValid&&r.evidenceCertified)return 'MODELED_AND_APPLICABLE';
    return 'CLASSIFICATION_UNCERTAIN';
  }
  for(const p of source.products.toSorted((a,b)=>a.productId-b.productId)) {
    const ps=products.get(p.productId),tv1=t1.get(p.productId),tv2=t2.get(p.productId),specs=specGroups.get(p.productId)??[];
    assert(ps&&tv1&&tv2);
    const ctx={canonical:p,productSemantics:ps,training:tv2,specs,trust,lineage:{productVerified:true,trainingVerified:true,specsVerified:true}};
    const evaluated=admission.evaluateAdmissionSnapshot(ctx,contract),dims=evaluated.consolidation.evaluatedDimensions;
    const functionDiscovery=admission.evaluateProductAdmission({...ctx,trainingDiscoveryDimension:'TRAINING_FUNCTION'},'TRAINING_DISCOVERY',contract);
    const archivedRow=archived.C.find(r=>r.productId===p.productId);
    assert.deepEqual(evaluated.admission,archivedRow.admission);
    assert.deepEqual(functionDiscovery,archivedRow.functionDiscovery);
    const pd=dims.find(d=>d.dimension==='PRODUCT_SEMANTICS'),ex=dims.find(d=>d.dimension==='TRAINING_EXERCISE'),fn=dims.find(d=>d.dimension==='TRAINING_FUNCTION'),sp=dims.find(d=>d.dimension==='SPECS'),tr=dims.find(d=>d.dimension==='TRUST');
    const negative=tv2.resolutionState==='VERIFIED_NO_APPLICABLE_CAPABILITY'?ex.resolution.negativeEvidenceState:'NOT_APPLICABLE';
    if(archivedNegative.has(p.productId))assert.equal('NEGATIVE_EVIDENCE_'+negative,archivedNegative.get(p.productId).negativeEvidenceState);
    const specFilteringByKey=Object.fromEntries(admission.supportedSpecKeys.map(key=>[key,admission.evaluateProductAdmission({...ctx,specFilteringKeys:[key]},'SPEC_FILTERING',contract)]));
    assert.deepEqual(specFilteringByKey,archivedRow.specFilteringByKey);
    const family=ps.primaryProductFamily?.code??'UNAVAILABLE';
    const row={productId:p.productId,sourceIdentity:source.source.identity,sourceExtractionId:S.manifest.sourceExtractionId,productName:p.name,sourceCategories:p.categoryIds??'UNAVAILABLE',sourceFeatures:p.features??'UNAVAILABLE',catalogPresence:p.catalogPresence,activeStatus:p.active===null?'UNKNOWN':p.active?'ACTIVE':'INACTIVE',productFamily:family,secondaryFamilies:ps.secondaryProductFamilies,classificationStatus:ps.classificationStatus,disciplines:ps.disciplines,useContexts:ps.useContexts,semanticTags:[...(ps.primaryProductFamily?[ps.primaryProductFamily]:[]),...ps.secondaryProductFamilies,...ps.disciplines,...ps.useContexts],productEvidence:ps.provenance,productEvidenceCertified:pd.evidenceCertified,productResolution:pd.resolution.state,trainingV1Assignments:tv1.assignments,trainingV1CoverageStatus:tv1.coverageStatus,trainingV2ExerciseCapabilities:tv2.exerciseCapabilities,trainingV2Functions:tv2.trainingFunctions,trainingV2ResolutionState:tv2.resolutionState,trainingEvidenceStatus:{exercise:ex.resolution.evidenceFacts.length?'PRESENT':'ABSENT',function:fn.resolution.evidenceFacts.length?'PRESENT':'ABSENT',negative},trainingNegativeEvidenceStatus:negative,trainingExerciseEvidenceCertified:ex.evidenceCertified,trainingFunctionEvidenceCertified:fn.evidenceCertified,specsNormalizedCount:specs.filter(s=>s.status==='parsed').length,specsAmbiguousCount:specs.filter(s=>s.status==='ambiguous').length,specsUnsupportedCount:specs.filter(s=>s.status==='unsupported').length,specsConflictStatus:sp.resolution.state==='SOURCE_CONFLICT'?'SOURCE_CONFLICT':'NONE_DETECTED',trustMappingStatus:p.categoryIds===null?'UNAVAILABLE':tr.resolution.state,missingTrustCategories:(p.categoryIds??[]).filter(c=>!trust.categories.some(t=>t.categoryId===c.categoryId)),missingTrustFeatures:(p.features??[]).filter(f=>!trust.features.some(t=>t.featureId===f.featureId)),applicableSemanticObligations:dims.map(d=>({dimension:d.dimension,effectiveRequirement:d.effectiveRequirement,conditionResult:d.conditionResult,specRequirements:d.specRequirements})),admissionStatus:evaluated.admission.UNIFIED_RETRIEVAL.decision,discoveryEligibility:{product:evaluated.admission.PRODUCT_SEMANTIC_DISCOVERY.decision,exercise:evaluated.admission.TRAINING_DISCOVERY.decision,function:functionDiscovery.decision,specs:evaluated.admission.SPEC_FILTERING.decision},specFilteringByKey:Object.fromEntries(Object.entries(specFilteringByKey).map(([k,v])=>[k,v.decision])),consolidationStatus:evaluated.consolidation.state,relationships:'UNAVAILABLE',capabilitiesProjection:'UNAVAILABLE',snapshotReferences:{source:`${sourceDir}/canonical_input.json#/products/${source.products.indexOf(p)}`,product:`${candidateDir}/productSemantics.json#/snapshot/records/${C.projections.productSemantics.snapshot.records.indexOf(ps)}`,trainingV1:`${candidateDir}/trainingSemantics.json#/snapshot/records/${C.projections.trainingSemantics.snapshot.records.indexOf(tv1)}`,trainingV2:`${candidateDir}/trainingSemanticsV2.json#/snapshot/records/${C.projections.trainingSemanticsV2.snapshot.records.indexOf(tv2)}`,specs:specs.map(s=>`${candidateDir}/specs.json#/records/${C.projections.specs.records.indexOf(s)}`)},sourceSnapshotIdentities:{product:C.projections.productSemantics.snapshot.snapshotId,trainingV1:C.projections.trainingSemantics.snapshot.snapshotId,trainingV2:C.projections.trainingSemanticsV2.snapshot.snapshotId,specs:C.manifest.projections.specs.snapshotId},diagnostics:Object.fromEntries(dims.map(d=>[d.dimension,diagnostic(d.dimension,d,p)]))};
    records.push(row);evidence.push({productId:p.productId,source:p,product:ps,trainingV1:tv1,trainingV2:tv2,specs,evaluation:evaluated,functionDiscovery,specFilteringByKey});
    for(const d of dims)diagnostics.push({productId:p.productId,family,active:p.active===true,dimension:d.dimension,category:row.diagnostics[d.dimension],effectiveRequirement:d.effectiveRequirement,resolution:d.resolution.state,evidenceCertified:d.evidenceCertified,basis:'INFERRED',sourceReference:row.snapshotReferences,reason:d.reasons});
    const before=old.get(p.productId),semanticChanged=canonicalJson(semantic(before))!==canonicalJson(semantic(tv2));
    const physicalChanged=canonicalJson(before)!==canonicalJson(tv2),warningsOnly=physicalChanged&&canonicalJson({...before,warnings:[]})===canonicalJson({...tv2,warnings:[]});
    const deltaType=semanticChanged?'SEMANTIC':!physicalChanged?'UNCHANGED':warningsOnly?'METADATA':'EVIDENCE';
    if(priorDelta.has(p.productId)) assert.equal(semanticChanged,priorDelta.get(p.productId).semanticChanged);
    baselineComparison.push({productId:p.productId,family,active:p.active===true,deltaType,beforeState:before.resolutionState,afterState:tv2.resolutionState,beforeCapabilities:before.exerciseCapabilities,beforeFunctions:before.trainingFunctions,afterCapabilities:tv2.exerciseCapabilities,afterFunctions:tv2.trainingFunctions,preexistingProductSpecsTrust:true,basis:'MEASURED'});
    for(const d of dims)if(['SOURCE_CONFLICT','INVALID_STATE'].includes(d.resolution.state))conflicts.push({productId:p.productId,family,active:p.active===true,dimensions:d.dimension,kind:d.resolution.state,cause:d.dimension==='SPECS'?'SOURCE_CONFLICT_OR_NORMALIZATION':d.dimension==='PRODUCT_SEMANTICS'?'RULE_OR_PROVENANCE':'CONTRACT_OR_PROVENANCE',evidence:d.resolution.reasons,certainty:'MEASURED',requiresHumanAdjudication:true,sourceReference:row.snapshotReferences});
    const body={name:p.name,features:p.features??[]};
    for(const a of [...tv2.exerciseCapabilities,...tv2.trainingFunctions]) {
      const code=a.capabilityCode??a.functionCode;
      if(['DEADLIFT','CABLE_RESISTANCE','BARBELL_SUPPORT'].includes(code)&&/\b(jack|repuesto|accesorio)\b/iu.test(p.name)) conflicts.push({productId:p.productId,family,active:p.active===true,dimensions:'PRODUCT_FAMILY/TRAINING',kind:'NAME_ROLE_TENSION',cause:'CLASSIFICATION_UNCERTAIN',evidence:{assignment:a,source:body},certainty:'HYPOTHESIS',requiresHumanAdjudication:true,sourceReference:row.snapshotReferences});
    }
  }
  assert.equal(records.length,2048);assert.equal(new Set(ids(records)).size,2048);
  const current=records.filter(r=>r.catalogPresence==='current_catalog'),active=current.filter(r=>r.activeStatus==='ACTIVE'),historical=records.filter(r=>r.catalogPresence!=='current_catalog');
  assert.equal(current.length,1565);assert.equal(active.length,886);assert.equal(historical.length,483);assert.equal(current.filter(r=>r.activeStatus==='INACTIVE').length,679);
  assert.equal(records.filter(r=>r.classificationStatus==='PARTIALLY_CLASSIFIED').length,419);assert.equal(records.filter(r=>r.classificationStatus==='OTHER').length,321);
  for(const [state,n] of Object.entries({ONTOLOGY_GAP:735,DATA_GAP:45,AMBIGUOUS:5}))assert.equal(records.filter(r=>r.trainingV2ResolutionState===state).length,n);
  assert.equal(records.filter(r=>r.trainingNegativeEvidenceStatus==='ABSENT').length,50);
  assert.equal(C.projections.specs.records.filter(s=>s.status==='ambiguous').length,512);assert.equal(C.projections.specs.records.filter(s=>s.status==='unsupported').length,52);
  assert.equal(records.filter(r=>r.specsConflictStatus==='SOURCE_CONFLICT').length,82);
  assert.deepEqual(count(baselineComparison,r=>r.deltaType),{UNCHANGED:798,EVIDENCE:1093,SEMANTIC:156,METADATA:1});
  await csv('product_semantic_matrix.csv',records);await save('product_evidence.json',evidence);
  await csv('dimension_diagnostics.csv',diagnostics);await csv('cross_dimension_conflicts.csv',conflicts,['productId','family','active','dimensions','kind','cause','evidence','certainty','requiresHumanAdjudication','sourceReference']);
  await csv('baseline_training_comparison.csv',baselineComparison);
  const inventory={basis:'MEASURED',ontology,trainingV1:v1,trainingV2:v2,admission:contract,specs:{keys:admission.supportedSpecKeys,sources:admission.supportedSpecSources,units:['kg','cm'],states:['parsed','ambiguous','unsupported'],reference:'src/domain/catalog/projection-bundle.ts:75-116'},trust:{categoryRows:categories,featureRows:features,categoryClassCounts:count(categories,r=>r.trustClass),featureClassCounts:count(features,r=>r.trustClass),snapshot:C.projections.trustMaps,consumers:{productClassifier:'scripts/product-semantic-classification/lib/load-input.ts',trainingClassifier:'scripts/training-semantic-classification/lib/load-input.ts',admission:'src/domain/catalog-admission/applicability-v2.ts',commercialSelection:'src/domain/catalog/v2/meaningfulCategory.ts',commercialAuthority:'STATIC_MAP_SEPARATE'},sourceCoverage:{current:current.length,categoryMissingProducts:current.filter(r=>r.missingTrustCategories.length).length,featureMissingProducts:current.filter(r=>r.missingTrustFeatures.length).length}},relationships:{taxonomicParentChild:'UNAVAILABLE: flat axis/code registry; no parent edges',functional:v2.familyTrainingFunctionDerivations,physicalCompatibility:C.manifest.projections.relationships,technicalDependencies:C.manifest.projections.relationships,commercialComplementarity:C.manifest.projections.relationships,capabilitiesProjection:C.manifest.projections.capabilities},hierarchyCheck:{parentEdgesDefined:0,cycleEvaluation:'NOT_APPLICABLE',crossAxisInferencePolicy:ontology.globalRules},sourceLineage:S.manifest,exceptions:ontology.globalRules.nonProductExclusionPolicy??ontology.globalRules.nonProductExclusion};
  await save('ontology_inventory.json',inventory);
  const familyCodes=unique([...ontology.axes.find(a=>a.axis==='PRODUCT_FAMILY').tags.map(t=>t.code),...records.map(r=>r.productFamily)]);
  const coverage=familyCodes.map(family=>{
    const all=records.filter(r=>r.productFamily===family),cur=all.filter(r=>r.catalogPresence==='current_catalog'),act=cur.filter(r=>r.activeStatus==='ACTIVE');
    const exercised=all.filter(r=>r.applicableSemanticObligations.some(d=>d.dimension==='TRAINING_EXERCISE'&&d.effectiveRequirement==='REQUIRED')),functioned=all.filter(r=>r.applicableSemanticObligations.some(d=>d.dimension==='TRAINING_FUNCTION'&&d.effectiveRequirement==='REQUIRED'));
    const d=diagnostics.filter(r=>r.family===family);
    return {family,canonical:all.length,current:cur.length,active:act.length,historical:all.length-cur.length,classified:all.filter(r=>r.classificationStatus==='CLASSIFIED').length,partial:all.filter(r=>r.classificationStatus==='PARTIALLY_CLASSIFIED').length,other:all.filter(r=>r.classificationStatus==='OTHER').length,needsReview:all.filter(r=>r.classificationStatus==='NEEDS_REVIEW').length,productEvidenceInsufficient:all.filter(r=>!r.productEvidenceCertified).length,classifiedPctCanonical:all.length?100*all.filter(r=>r.classificationStatus==='CLASSIFIED').length/all.length:'NOT_APPLICABLE',exerciseApplicableDenominator:exercised.length,exerciseEvidenceCertifiedApplicable:exercised.filter(r=>r.trainingExerciseEvidenceCertified).length,functionApplicableDenominator:functioned.length,functionEvidenceCertifiedApplicable:functioned.filter(r=>r.trainingFunctionEvidenceCertified).length,exerciseCodes:unique(all.flatMap(r=>r.trainingV2ExerciseCapabilities.map(a=>a.capabilityCode))),functionCodes:unique(all.flatMap(r=>r.trainingV2Functions.map(a=>a.functionCode))),specKeys:unique(all.flatMap(r=>(specGroups.get(r.productId)??[]).map(s=>s.key))),specParsedRecords:all.reduce((a,r)=>a+r.specsNormalizedCount,0),specAmbiguousRecords:all.reduce((a,r)=>a+r.specsAmbiguousCount,0),specUnsupportedRecords:all.reduce((a,r)=>a+r.specsUnsupportedCount,0),specConflictProducts:all.filter(r=>r.specsConflictStatus==='SOURCE_CONFLICT').length,trainingStates:count(all,r=>r.trainingV2ResolutionState),diagnosticsByDimension:Object.fromEntries(['PRODUCT_SEMANTICS','TRAINING_EXERCISE','TRAINING_FUNCTION','SPECS','TRUST'].map(dim=>[dim,count(d.filter(r=>r.dimension===dim),r=>r.category)])),activeAdmission:Object.fromEntries(['product','exercise','function','specs'].map(k=>[k,act.filter(r=>r.discoveryEligibility[k]==='ADMITTED').length])),currentAdmission:Object.fromEntries(['product','exercise','function','specs'].map(k=>[k,cur.filter(r=>r.discoveryEligibility[k]==='ADMITTED').length])),activeAdmittedUnified:act.filter(r=>r.admissionStatus==='ADMITTED').length,potentiallyUnmodeledProducts:unique(d.filter(r=>r.category==='POTENTIALLY_UNMODELED').map(r=>r.productId)).length,basis:'MEASURED counts; diagnostic assignments INFERRED'};
  });
  await csv('coverage_by_family.csv',coverage);
  const groups={PARTIALLY_CLASSIFIED:records.filter(r=>r.classificationStatus==='PARTIALLY_CLASSIFIED'),OTHER:records.filter(r=>r.classificationStatus==='OTHER'),ONTOLOGY_GAP:records.filter(r=>r.trainingV2ResolutionState==='ONTOLOGY_GAP'),DATA_GAP:records.filter(r=>r.trainingV2ResolutionState==='DATA_GAP'),AMBIGUOUS:records.filter(r=>r.trainingV2ResolutionState==='AMBIGUOUS'),NEGATIVE_ABSENT:records.filter(r=>r.trainingNegativeEvidenceStatus==='ABSENT'),SPECS_AMBIGUOUS:records.filter(r=>r.specsAmbiguousCount),SPECS_UNSUPPORTED:records.filter(r=>r.specsUnsupportedCount),SPECS_SOURCE_CONFLICT:records.filter(r=>r.specsConflictStatus==='SOURCE_CONFLICT')};
  const groupSummary=Object.fromEntries(Object.entries(groups).map(([k,rows])=>[k,{products:rows.length,current:rows.filter(r=>r.catalogPresence==='current_catalog').length,active:rows.filter(r=>r.activeStatus==='ACTIVE').length,byFamily:count(rows,r=>r.productFamily),productIds:ids(rows),unit:k.startsWith('SPECS_')?'unique products; record counts reported separately':'products',sourceReferences:rows.map(r=>({productId:r.productId,references:r.snapshotReferences})),basis:'MEASURED'}]));
  await save('known_gap_cohorts.json',groupSummary);
  const gapRows=Object.entries(groups).flatMap(([cohort,rows])=>rows.map(r=>({productId:r.productId,family:r.productFamily,active:r.activeStatus==='ACTIVE',cohort,ontologyDefectProven:false,cause:cohort==='ONTOLOGY_GAP'?'POLICY_SCOPE_OR_POTENTIAL_ONTOLOGY':cohort==='NEGATIVE_ABSENT'?'PROVENANCE_EVIDENCE':cohort==='DATA_GAP'?'SOURCE_DATA':cohort==='SPECS_SOURCE_CONFLICT'?'SOURCE_CONFLICT':cohort.startsWith('SPECS_')?'NORMALIZATION_OR_SOURCE_DATA':'CLASSIFICATION_OR_POTENTIAL_ONTOLOGY',diagnostics:r.diagnostics,trainingState:r.trainingV2ResolutionState,evidence:r.snapshotReferences,certainty:'INFERRED',requiresHumanAdjudication:true})));
  await csv('ontology_gaps.csv',gapRows);
  const usedProducts=new Map();for(const r of records)for(const t of r.semanticTags){const k=t.axis+'/'+t.code;if(!usedProducts.has(k))usedProducts.set(k,[]);usedProducts.get(k).push(r.productId);}
  const orphans=[];
  for(const t of ontology.tags){const used=unique(usedProducts.get(t.axis+'/'+t.code)??[]);orphans.push({dimension:t.axis,code:t.code,defined:true,productCount:used.length,productIds:used,orphan:!used.length,utility:t.definition,basis:'MEASURED'});}
  for(const [dim,defs,key,field] of [['EXERCISE',v2.exerciseCapabilities,'capabilityCode','trainingV2ExerciseCapabilities'],['FUNCTION',v2.trainingFunctions,'functionCode','trainingV2Functions']])for(const t of defs){const used=records.filter(r=>r[field].some(a=>a[key]===t.code));orphans.push({dimension:dim,code:t.code,defined:true,productCount:used.length,productIds:ids(used),orphan:!used.length,utility:t.description,basis:'MEASURED'});}
  await csv('orphan_concepts.csv',orphans);
  const featureCoverage=features.map(f=>{
    const used=current.filter(r=>r.sourceFeatures.some(x=>x.featureId===Number(f.featureId))),normalized=unique(used.flatMap(r=>(specGroups.get(r.productId)??[]).filter(s=>s.sourceFeature.featureId===Number(f.featureId)).map(s=>s.key)));
    const trainingUse=current.filter(r=>[...r.trainingV2ExerciseCapabilities,...r.trainingV2Functions].some(a=>a.evidence.some(e=>e.kind==='STRUCTURED_FEATURE'&&e.sourceId===String(f.featureId))));
    const productUse=current.filter(r=>r.productEvidence.evidence.some(e=>e.sourceType==='STRUCTURED_FEATURE'&&e.sourceId===String(f.featureId)));
    return {featureId:Number(f.featureId),name:f.featureName??f.name??'UNAVAILABLE',trustClass:f.trustClass,productCount:used.length,activeCount:used.filter(r=>r.activeStatus==='ACTIVE').length,normalizedKeys:normalized,trainingAssignmentConsumerProducts:ids(trainingUse),productAssignmentConsumerProducts:ids(productUse),noObservedProjectionConsumer:!normalized.length&&!trainingUse.length&&!productUse.length,consumerSearchLimit:'Assignment usage only; source rules may inspect and reject; commercial fields are outside this audit.',productIds:ids(used),sampleValues:unique(used.flatMap(r=>r.sourceFeatures.filter(x=>x.featureId===Number(f.featureId)).map(x=>x.value))).slice(0,6),basis:'MEASURED'};
  });
  await csv('feature_consumer_coverage.csv',featureCoverage);
  const categoryCoverage=categories.map(c=>{const used=current.filter(r=>r.sourceCategories.some(x=>x.categoryId===Number(c.categoryId)));return {categoryId:Number(c.categoryId),name:c.categoryName,trustClass:c.trustClass,products:used.length,active:used.filter(r=>r.activeStatus==='ACTIVE').length,productEvidenceConsumers:ids(used.filter(r=>r.productEvidence.evidence.some(e=>e.sourceType==='TRUSTED_CATEGORY'&&e.sourceId===String(c.categoryId)))),trainingEvidenceConsumers:ids(used.filter(r=>[...r.trainingV2ExerciseCapabilities,...r.trainingV2Functions].some(a=>a.evidence.some(e=>e.kind==='TRUSTED_CATEGORY'&&e.sourceId===String(c.categoryId))))),productIds:ids(used),basis:'MEASURED; no observed assignment consumer does not mean unused by source rules'};});
  await csv('category_consumer_coverage.csv',categoryCoverage);
  const queryDefinitions=[
    ['NAME_TYPE','SUPPORTED','SUPPORTED','PARTIAL','PARTIAL','SUPPORTED','Name exists for every canonical record; family admission is narrower; lexical retrieval is not tested.','product'],
    ['DISCIPLINE','SUPPORTED','PARTIAL','PARTIAL','PARTIAL','PARTIAL','Only declared discipline codes; empty axis is unknown, not negative.','discipline'],
    ['EXERCISE','PARTIAL','PARTIAL','PARTIAL','PARTIAL','SUPPORTED','Dedicated registry exercise vocabulary only; generic equipment is not a universal exercise claim.','exercise'],
    ['FUNCTION','PARTIAL','PARTIAL','PARTIAL','PARTIAL','SUPPORTED','Five modeled functions; DIRECT/SUPPORTED/FAMILY_DERIVED are distinct.','function'],
    ['SPECS','PARTIAL','PARTIAL','PARTIAL','PARTIAL','SUPPORTED','Six keys; kg/cm; source conflicts and ambiguous records; no universal technical minima.','specs'],
    ['USE_CONTEXT','SUPPORTED','PARTIAL','PARTIAL','PARTIAL','PARTIAL','Only implemented use contexts; empty does not prove absence.','context'],
    ['ACCESSORIES','PARTIAL','PARTIAL','PARTIAL','PARTIAL','PARTIAL','MACHINE_ATTACHMENT identifies a role but does not identify which machine it fits.','accessory'],
    ['COMPATIBILITY','UNAVAILABLE','PARTIAL','UNAVAILABLE','UNAVAILABLE','UNAVAILABLE','No verified physical compatibility edges; category/family/function cannot replace them.','none'],
    ['MULTIPLE_CONSTRAINTS','PARTIAL','PARTIAL','PARTIAL','PARTIAL','PARTIAL','Only intersections of published admitted facts; unknown requirements remain unresolved.','intersection'],
    ['ALTERNATIVES','PARTIAL','PARTIAL','UNKNOWN','UNKNOWN','UNKNOWN','Same family is not equivalent mechanics/load/fit; no substitution relation or surface.','none']
  ];
  const queryRows=queryDefinitions.map(([queryType,ONTOLOGY_SUPPORT,SOURCE_DATA_SUPPORT,CLASSIFICATION_SUPPORT,EVIDENCE_SUPPORT,CONTRACTUAL_ADMISSION,KNOWN_LIMITATIONS,kind])=>{
    const eligible=rows=>rows.filter(r=>kind==='none'?false:kind==='discipline'?r.disciplines.length&&r.discoveryEligibility.product==='ADMITTED':kind==='context'?r.useContexts.length&&r.discoveryEligibility.product==='ADMITTED':kind==='accessory'?r.productFamily==='MACHINE_ATTACHMENT'&&r.discoveryEligibility.product==='ADMITTED':kind==='intersection'?['product','exercise','function','specs'].every(k=>r.discoveryEligibility[k]==='ADMITTED'):r.discoveryEligibility[kind]==='ADMITTED');
    const ca=eligible(current),ac=eligible(active);
    return {queryType,ONTOLOGY_SUPPORT,SOURCE_DATA_SUPPORT,CLASSIFICATION_SUPPORT,EVIDENCE_SUPPORT,CONTRACTUAL_ADMISSION,KNOWN_LIMITATIONS,currentSupportedFactProducts:kind==='none'?'NOT_MEASURABLE':ca.length,currentDenominator:1565,activeSupportedFactProducts:kind==='none'?'NOT_MEASURABLE':ac.length,activeDenominator:886,activeSupportPct:kind==='none'?'NOT_MEASURABLE':100*ac.length/886,currentProductIds:ids(ca),activeProductIds:ids(ac),metricMeaning:'Existing admitted fact availability, not recall/precision, query fulfillment or catalog.discover readiness',basis:'MEASURED counts; support judgments INFERRED'};
  });
  await csv('discovery_capability_matrix.csv',queryRows);
  const clusters=[
    {id:'RELATION_COMPATIBILITY',priority:'P1',cause:'ONTOLOGY_RELATION_UNAVAILABLE',match:r=>r.productFamily==='MACHINE_ATTACHMENT'||/\b(repuesto|repuestos|adaptador|adapter|acople)\b/iu.test(r.productName),concept:'Physical fit / attachment target / replacement dependency',impact:'Cannot promise accessory fit or replacement compatibility.',certainty:'MEASURED structural limitation; affected roles INFERRED'},
    {id:'SPECS_COMMERCIAL_KEYS',priority:'P1',cause:'NORMALIZATION_SCOPE',match:r=>Array.isArray(r.sourceFeatures)&&r.sourceFeatures.some(f=>[8,14,42,43,44,51,65].includes(f.featureId)),concept:'Thickness, band resistance, total length, width, circumference, material, cable ratio',impact:'Useful source attributes have no supported spec key; do not infer dimensions or compatibility.',certainty:'MEASURED absent keys; commercial impact INFERRED'},
    {id:'NEGATIVE_EVIDENCE_ABSENT',priority:'P1',cause:'PROVENANCE',match:r=>r.trainingNegativeEvidenceStatus==='ABSENT',concept:'Source-bound negative evidence',impact:'Declared negative cannot be certified as a universal equipment limitation.',certainty:'MEASURED'},
    {id:'SPECS_SOURCE_CONFLICT',priority:'P1',cause:'SOURCE_CONFLICT',match:r=>r.specsConflictStatus==='SOURCE_CONFLICT',concept:'Single authoritative numeric value per product/key',impact:'Load or dimensional claims require authority adjudication; no P0 false statement demonstrated.',certainty:'MEASURED'},
    {id:'OTHER_PRODUCT_ROLE',priority:'P1',cause:'CLASSIFICATION_OR_ONTOLOGY',match:r=>r.classificationStatus==='OTHER'&&r.catalogPresence==='current_catalog',concept:'Residual current commercial product roles',impact:'Type retrieval lacks a certified family; root cause requires human reference.',certainty:'HYPOTHESIS ontology; MEASURED residual'},
    {id:'TRAINING_UNKNOWN_SCOPE',priority:'P1',cause:'CONTRACTUAL_APPLICABILITY',match:r=>r.catalogPresence==='current_catalog'&&r.applicableSemanticObligations.some(d=>d.dimension.startsWith('TRAINING_')&&d.effectiveRequirement==='UNKNOWN'),concept:'Family training applicability beyond narrow registry minimum',impact:'Exclude generic and unresolved functions/exercises from global quality claims.',certainty:'MEASURED unknown obligations'},
    {id:'TRAINING_DATA_GAP',priority:'P2',cause:'SOURCE_DATA_OR_RULE_EVIDENCE',match:r=>r.trainingV2ResolutionState==='DATA_GAP',concept:'Missing accepted structured evidence',impact:'Cannot certify training facts without independent Product Truth.',certainty:'MEASURED state; cause INFERRED'},
    {id:'TRAINING_AMBIGUOUS',priority:'P2',cause:'CLASSIFICATION_UNCERTAIN',match:r=>r.trainingV2ResolutionState==='AMBIGUOUS',concept:'Ambiguous positive training evidence',impact:'Hold back disputed training assignment pending adjudication.',certainty:'MEASURED'},
    {id:'SPECS_PARSE_LIMIT',priority:'P2',cause:'NORMALIZATION_OR_SOURCE_DATA',match:r=>r.specsAmbiguousCount+r.specsUnsupportedCount>0,concept:'Numeric/unit/compound text normalization',impact:'Selected key filters cannot consume ambiguous/unsupported values.',certainty:'MEASURED'},
    {id:'PRODUCT_PARTIAL',priority:'P2',cause:'CLASSIFICATION_OR_EVIDENCE',match:r=>r.classificationStatus==='PARTIALLY_CLASSIFIED',concept:'Partial family/evidence assignment',impact:'Partial identity is not a certified typed product.',certainty:'MEASURED state; cause requires adjudication'},
    {id:'TRUST_SELECTION_SEPARATE',priority:'P2',cause:'AUTHORITY_CONSUMPTION',match:r=>r.catalogPresence==='current_catalog',concept:'Trust source versus commercial category selector',impact:'Bundle Trust hashes do not certify static runtime selector authority.',certainty:'MEASURED code path'},
    {id:'HISTORICAL_SOURCE',priority:'P3',cause:'SOURCE_DATA_INSUFFICIENT',match:r=>r.catalogPresence!=='current_catalog',concept:'Historical identity without current source categories/features',impact:'Separate historical coverage from active discovery quality.',certainty:'MEASURED'}
  ];
  const backlog=clusters.map(c=>{const affected=records.filter(c.match);return {issueId:c.id,priority:c.priority,severity:c.priority==='P1'?'HIGH':c.priority==='P2'?'MEDIUM':'LOW',productCount:affected.length,currentCount:affected.filter(r=>r.catalogPresence==='current_catalog').length,activeExposure:affected.filter(r=>r.activeStatus==='ACTIVE').length,productIds:ids(affected),activeProductIds:ids(affected.filter(r=>r.activeStatus==='ACTIVE')),concept:c.concept,rootCause:c.cause,retrievalImpact:c.impact,recommendationRisk:['RELATION_COMPATIBILITY','SPECS_SOURCE_CONFLICT','NEGATIVE_EVIDENCE_ABSENT'].includes(c.id)?'Potential incorrect technical claim if uncertainty bypassed':'Incomplete retrieval or unsupported semantic inference',evidence:affected.map(r=>({productId:r.productId,reference:r.snapshotReferences})),evidenceAvailable:c.certainty,dependencies:c.id==='RELATION_COMPATIBILITY'?'Curated source-bound relationship contract and physical fit evidence':c.id==='TRUST_SELECTION_SEPARATE'?'Separate authority decision for runtime selector':'Independent Product Truth adjudication; separate approved remediation',nextAction:c.id==='SPECS_COMMERCIAL_KEYS'?'Prioritize individual source feature/key proposals with units and family applicability; no implementation in QA1':c.id==='RELATION_COMPATIBILITY'?'Define required fit/dependency evidence before admitting compatibility or substitution claims':'Review exact IDs and sources; distinguish modeled policy scope from true missing concept',certainty:c.certainty,implemented:false};});
  await csv('prioritized_remediation_backlog.csv',backlog);
  // SHA-256 rank is a deterministic pseudo-random permutation; no mutable RNG state.
  const seed='P2.3-QA1-20261008-bddf7f-v1',rank=r=>hash(`${seed}:${r.productId}`);
  const order=rows=>rows.toSorted((a,b)=>rank(a).localeCompare(rank(b))||a.productId-b.productId);
  const strata=Map.groupBy(records,r=>`${r.catalogPresence}|${r.activeStatus}|${r.productFamily}`);
  const quotas=[...strata].map(([stratum,rows])=>({stratum,rows,exact:160*rows.length/2048,n:Math.floor(160*rows.length/2048)}));
  let remainder=160-quotas.reduce((a,q)=>a+q.n,0);
  for(const q of quotas.toSorted((a,b)=>(b.exact-b.n)-(a.exact-a.n)||a.stratum.localeCompare(b.stratum)))if(remainder-->0)q.n++;
  const selected=new Map();for(const q of quotas)for(const r of order(q.rows).slice(0,q.n))selected.set(r.productId,{r,subset:'STRATIFIED_RANDOM',reasons:[q.stratum],stratum:q.stratum,inclusionProbability:q.n/q.rows.length});
  const targets=[1020,1856,247,897,1624,1124,1812,1999,2008,1543,435,930,1354,899,1365];
  const lanes=[['FIX2_TARGET',records.filter(r=>targets.includes(r.productId)),15],['AMBIGUOUS',groups.AMBIGUOUS,5],['DATA_GAP',groups.DATA_GAP,12],['NEGATIVE_ABSENT',groups.NEGATIVE_ABSENT,10],['SPEC_CONFLICT',groups.SPECS_SOURCE_CONFLICT,12],['SPECS_AMBIGUOUS',groups.SPECS_AMBIGUOUS,12],['OTHER',groups.OTHER.filter(r=>r.activeStatus==='ACTIVE'),12],['PARTIAL',groups.PARTIALLY_CLASSIFIED.filter(r=>r.activeStatus==='ACTIVE'),12],['ONTOLOGY_GAP',groups.ONTOLOGY_GAP.filter(r=>r.activeStatus==='ACTIVE'),12],['MULTIFUNCTION',records.filter(r=>r.trainingV2ExerciseCapabilities.length+r.trainingV2Functions.length>=3),10],['ACCESSORY',records.filter(clusters[0].match),10],['SPECS_UNSUPPORTED',groups.SPECS_UNSUPPORTED,6],['FIX2_CHANGED',records.filter(r=>baselineComparison.find(b=>b.productId===r.productId).deltaType==='SEMANTIC'),12]];
  const add=(r,lane)=>{if(selected.has(r.productId)){selected.get(r.productId).reasons.push(lane);return false;}selected.set(r.productId,{r,subset:'PURPOSIVE_DIFFICULT',reasons:[lane],stratum:'NOT_APPLICABLE',inclusionProbability:'NOT_APPLICABLE'});return true;};
  for(const [lane,rows,quota] of lanes){let added=0;for(const r of order(rows)){if(selected.size>=280)break;if(add(r,lane))added++;if(added>=quota)break;}}
  for(const family of familyCodes){if(selected.size>=280)break;if(![...selected.values()].some(x=>x.r.productFamily===family)){const r=order(records.filter(r=>r.productFamily===family))[0];if(r)add(r,'FAMILY_COVERAGE');}}
  for(const r of order(active)) {if(selected.size>=280)break;add(r,'ACTIVE_COMPLETION');}
  assert.equal(selected.size,280);assert.equal([...selected.values()].filter(s=>s.subset==='STRATIFIED_RANDOM').length,160);
  const sample=[...selected.values()].toSorted((a,b)=>a.r.productId-b.r.productId).map(s=>{const r=s.r;return {productId:r.productId,name:r.productName,observedFamily:r.productFamily,currentClassification:r.classificationStatus,activeStatus:r.activeStatus,subset:s.subset,selectionReasons:unique(s.reasons),stratum:s.stratum,inclusionProbability:s.inclusionProbability,evidenceProvenance:r.snapshotReferences,usedConcepts:{tags:r.semanticTags,exercises:r.trainingV2ExerciseCapabilities.map(a=>a.capabilityCode),functions:r.trainingV2Functions.map(a=>a.functionCode),specs:(specGroups.get(r.productId)??[]).map(s=>s.key)},possiblyAbsentConcepts:backlog.filter(b=>b.productIds.includes(r.productId)&&['RELATION_COMPATIBILITY','SPECS_COMMERCIAL_KEYS','OTHER_PRODUCT_ROLE'].includes(b.issueId)).map(b=>({issueId:b.issueId,concept:b.concept,certainty:b.evidenceAvailable})),detectedContradictions:conflicts.filter(c=>c.productId===r.productId),preliminaryDiagnosis:r.diagnostics,knownGapCohorts:Object.entries(groups).filter(([,rows])=>rows.some(g=>g.productId===r.productId)).map(([k])=>k),certainty:'MEASURED assignments; INFERRED diagnostics; semantic correctness NOT_MEASURABLE in QA1',requiresHumanAdjudication:true,humanReference:'UNAVAILABLE',adjudicationStatus:'NOT_STARTED'};});
  await csv('qa2_review_sample.csv',sample);await save('qa2_sample_cases.json',sample);
  await save('sampling_plan.json',{seed,ranking:'SHA256(seed + colon + numeric productId), lexical digest ascending; productId tie-break',population:2048,strata:'catalogPresence x activeStatus x primary family',representativeSubset:{n:160,method:'Proportional allocation; floor then largest fractional remainder; lexical stratum tie-break; select by fixed hash rank',quotas:quotas.map(({rows,...q})=>({...q,population:rows.length,selectedIds:ids(order(rows).slice(0,q.n))})),interpretation:'Stratified pseudo-random catalogue sample, not active-only. Zero-allocation tiny strata are disclosed; use inclusion probabilities, no unweighted precision claim.'},purposiveSubset:{n:120,method:'Ordered lanes; deterministic hash rank; deduplicate; fixed quota of new IDs then active completion',lanes:lanes.map(([lane,rows,quota])=>({lane,population:rows.length,quota})),representative:false},coverage:{byFamily:count(sample,s=>s.observedFamily),byClassification:count(sample,s=>s.currentClassification),bySubset:count(sample,s=>s.subset),active:sample.filter(s=>s.activeStatus==='ACTIVE').length,knownGapCohorts:Object.fromEntries(Object.keys(groups).map(k=>[k,sample.filter(s=>s.knownGapCohorts.includes(k)).length]))},humanReview:'All cases require independent source/reference review. No gold label created, no QA2 executed.'});
  const summary={date:'2026-10-08',timezone:'America/Santiago',candidate:C.manifest.projectionBundleId,sourceExtractionId:S.manifest.sourceExtractionId,baseline:A.manifest.projectionBundleId,universe:{canonical:2048,current:1565,historical:483,active:886,inactiveCurrent:679},classification:count(records,r=>r.classificationStatus),activeClassification:count(active,r=>r.classificationStatus),trainingV1:count(records,r=>r.trainingV1CoverageStatus),trainingV2:count(records,r=>r.trainingV2ResolutionState),activeTrainingV2:count(active,r=>r.trainingV2ResolutionState),negativeEvidence:count(records.filter(r=>r.trainingV2ResolutionState==='VERIFIED_NO_APPLICABLE_CAPABILITY'),r=>r.trainingNegativeEvidenceStatus),specs:{records:C.projections.specs.records.length,byStatus:count(C.projections.specs.records,r=>r.status),products:specGroups.size,ambiguousProducts:groups.SPECS_AMBIGUOUS.length,unsupportedProducts:groups.SPECS_UNSUPPORTED.length,conflictProducts:82},families:coverage,diagnosticsByDimension:Object.fromEntries(['PRODUCT_SEMANTICS','TRAINING_EXERCISE','TRAINING_FUNCTION','SPECS','TRUST'].map(dim=>[dim,count(diagnostics.filter(r=>r.dimension===dim),r=>r.category)])),queryCoverage:queryRows,baselineDelta:count(baselineComparison,r=>r.deltaType),backlog:backlog.map(({evidence,...b})=>b),orphanConcepts:orphans.filter(o=>o.orphan),sample:{size:280,representative:160,purposive:120},certaintyPolicy:{counts:'MEASURED',diagnostics:'INFERRED',missingConceptCandidates:'HYPOTHESIS',realAccuracy:'NOT_MEASURABLE'},disposition:'QA2_WITH_SCOPE_RESTRICTIONS',flags:{QA1_COMPLETED:'YES',ONTOLOGY_INVENTORY_COMPLETE:'YES',PRODUCT_MATRIX_COMPLETE:'YES',FAMILY_COVERAGE_MEASURED:'YES',DISCOVERY_READINESS_ASSESSED:'YES',QA2_SAMPLE_READY:'YES',PRODUCTION_ROLLOUT_RECOMMENDATION:'DEFER'},limitations:['No independent reference labels or precision/recall measurement; no claim of 95%.','Compatibility/alternatives/technical dependencies remain unavailable.','Historical PRB evidence side effect disclosed in process_incident.json; protected candidate/source bytes validated.']};
  await save('audit_summary.json',summary);
  await save('process_incident.json',{severity:'AUDIT_PROCESS_NONCONFORMANCE',event:'Initial helper import evaluated its preflight CLI block because process.argv[2] was shared.',modifiedHistoricalFiles:['artifacts/catalog-v2/p2-3c-prb/preflight.json','artifacts/catalog-v2/p2-3c-prb/protected-before.json'],originalBytesAvailable:false,recovery:'Original records were not fabricated or reconstructed. Historical protected-after.json and LR reference.json remain available and untouched; initial before-state of these two files is not certified.',correction:'Removed executable auditor import; pure readers/validators only in the standalone QA1 script.',candidateSnapshotsSourcesChanged:false,productionAccessed:false,integrityQualification:'QA1 fingerprints were captured after this incident. Their equality verifies subsequent read-only analysis only; it does not certify full historical-evidence immutability for the whole turn.'});
  console.log(JSON.stringify({phase:'analyze',universe:summary.universe,classification:summary.classification,training:summary.trainingV2,specs:summary.specs,sample:summary.sample,disposition:summary.disposition}));
}
