import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseCsvRecords} from '../../product-semantic-classification/lib/csv.ts';
const out='artifacts/catalog-v2/qa1/run-20261008-bddf7f';
const rows=async f=>parseCsvRecords((await readFile(`${out}/${f}`,'utf8')).replace(/^\ufeff/u,''));
const matrix=await rows('product_semantic_matrix.csv'),family=await rows('coverage_by_family.csv'),diagnostics=await rows('dimension_diagnostics.csv'),sample=await rows('qa2_review_sample.csv'),conflicts=await rows('cross_dimension_conflicts.csv'),backlog=await rows('prioritized_remediation_backlog.csv');
assert.equal(matrix.length,2048);assert.equal(diagnostics.length,2048*5);assert.equal(sample.length,280);
assert.equal(family.reduce((a,r)=>a+Number(r.canonical),0),2048);assert.equal(family.reduce((a,r)=>a+Number(r.active),0),886);assert.equal(family.reduce((a,r)=>a+Number(r.current),0),1565);
const byId=new Map(matrix.map(r=>[Number(r.productId),r]));assert.equal(byId.size,2048);
for(const r of matrix) {
  const refs=JSON.parse(r.snapshotReferences);assert(refs.source.includes('#/products/'));assert(refs.product.includes('#/snapshot/records/'));
  assert(refs.trainingV2.includes('bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f'));
  if(r.catalogPresence!=='current_catalog'){assert.equal(r.activeStatus,'UNKNOWN');assert.equal(r.sourceCategories,'UNAVAILABLE');assert.equal(r.sourceFeatures,'UNAVAILABLE');}
}
for(const r of family) {
  const members=matrix.filter(m=>m.productFamily===r.family);assert.equal(members.length,Number(r.canonical));
  assert.equal(members.filter(m=>m.classificationStatus==='PARTIALLY_CLASSIFIED').length,Number(r.partial));
  assert.equal(members.filter(m=>m.specsConflictStatus==='SOURCE_CONFLICT').length,Number(r.specConflictProducts));
}
for(const r of backlog) {
  const affected=JSON.parse(r.productIds),act=JSON.parse(r.activeProductIds);assert.equal(affected.length,Number(r.productCount));assert.equal(act.length,Number(r.activeExposure));
  assert.equal(new Set(affected).size,affected.length);assert(affected.every(id=>byId.has(id)));assert(act.every(id=>affected.includes(id)&&byId.get(id).activeStatus==='ACTIVE'));
}
assert.equal(conflicts.filter(r=>r.kind==='CABLE_ROLE_OBLIGATION_TENSION').length,20);assert.equal(conflicts.filter(r=>r.dimensions==='PRODUCT_SEMANTICS').length,45);
assert.equal(conflicts.filter(r=>r.dimensions==='SPECS').length,82);
assert.equal(sample.filter(r=>r.subset==='STRATIFIED_RANDOM').length,160);assert.equal(sample.filter(r=>r.subset==='PURPOSIVE_DIFFICULT').length,120);
assert(sample.every(r=>byId.has(Number(r.productId))&&r.requiresHumanAdjudication==='true'&&r.adjudicationStatus==='NOT_STARTED'));
assert.equal(new Set(sample.map(r=>r.productId)).size,280);
const report=await readFile('docs/catalog-v2/P2_3_QA1_ONTOLOGY_SEMANTIC_COVERAGE_AUDIT.md','utf8');
for(const letter of 'ABCDEFGHIJKLMNOPQ')assert(report.includes(`## ${letter}. `));
assert(report.includes('QA2_WITH_SCOPE_RESTRICTIONS'));assert(report.includes('PRODUCTION_ROLLOUT_RECOMMENDATION=DEFER'));assert(report.includes('No conformidad de procedimiento'));
const result={status:'PASS',matrix:2048,dimensionPairs:10240,sample:280,familySum:2048,exactBacklogMembership:true,cableTensions:20,historicalPolicyConflicts:45,specSourceConflicts:82,reportSections:17};
await writeFile(`${out}/audit_self_checks.json`,JSON.stringify(result,null,2)+'\n');
const implementation={};
for(const f of ['scripts/audits/qa1/ontology-audit.mjs','scripts/audits/qa1/qualitative-review.mjs','scripts/audits/qa1/verify-evidence.mjs','scripts/audits/qa1/write-report.mjs','docs/catalog-v2/P2_3_QA1_ONTOLOGY_SEMANTIC_COVERAGE_AUDIT.md'])implementation[f]='sha256:'+createHash('sha256').update(await readFile(f)).digest('hex');
await writeFile(`${out}/audit_implementation_hashes.json`,JSON.stringify(implementation,null,2)+'\n');
console.log(JSON.stringify(result));
