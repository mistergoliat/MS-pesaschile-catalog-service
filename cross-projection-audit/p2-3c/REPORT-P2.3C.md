# P2.3C — Training Semantic Reconciliation & Evidence Integrity

Disposición: **NEEDS_CONTENT_REVIEW**. Candidato local; producción/pointers sin cambios. Población: 2048 canonical, 1565 current, 886 active. Gates: {"G1":"PASS","G2":"PASS","G3":"PASS","G4":"PASS","G5":"PASS","G6":"PASS","G7":"PASS","G8":"PASS","G9":"PASS","G10":"PASS","G11":"PASS","G12":"PASS","G13":"PASS","G14":"PASS","G15":"PASS"}.

## A. Root cause

- scripts/training-semantic-classification-v2/classify-catalog.ts:72
- scripts/training-semantic-classification-v2/classify-catalog.ts:80
- scripts/training-semantic-classification-v2-1/audit-a00.6.7.ts:222
- src/domain/training-semantic-snapshot/v2SnapshotBuilder.ts:29
- src/domain/training-semantic-snapshot/v2SnapshotBuilder.ts:61

A00.6.6 isResolved acepta el negativo histórico antes de comparar los assignments; resolutionState lo conserva. A00.6.7 preserva la resolución baseline. resolutionStateFor prioriza el CSV curado; semanticRecord marca resolved=true sin reconciliar assignments posteriores. El test rojo anterior al fix está capturado (1 failure esperado); el replay histórico actual reproduce el hash native y los 51 inválidos. Los builders ordinarios, stores y la publicación de bundles ahora los rechazan. La reconstrucción histórica en memoria no es una vía de publicación.

## B. New policy

- Previous: accepted-a00.6.7; hash sha256:4788d5e878152b36b39e830e61d8b80f43871b8579304ab453904961bb920e2e.
- New: training-resolution-policy-p2.3c-v1; hash sha256:35ad96b8fd319acbab1057d7388ffe4d6ba44b4d197ff05c0a570281b634090e.
- Builder: training-semantic-builder-p2.3c-v1; classifier: training-semantic-classifier-v2.1; rulesHash 5e4e591b45e7704975552f305d59d73535c3889ed655754aa0113844c9c03b6d.
- CodeRef: sha256:5eea114460ebb6b0e7dee8f442a51ce44fb596af076dd2579fc92bd7154d252e.
- Motivo: Reconcile historical negatives against evaluated source and final assignments; persist reproducible evidence; derive only source-required registry-authorized functions.

## C. 51 reconciliation

| Before state | After state | Count |
|---|---|---:|
| VERIFIED_NO_APPLICABLE_CAPABILITY | SEMANTIC_COMPLETE | 45 |
| VERIFIED_NO_APPLICABLE_CAPABILITY | ONTOLOGY_GAP | 6 |

- SEMANTIC_COMPLETE: 12, 87, 435, 437, 454, 455, 462, 463, 466, 777, 784, 1021, 1022, 1124, 1137, 1138, 1139, 1140, 1343, 1344, 1345, 1346, 1347, 1348, 1349, 1350, 1386, 1578, 1810, 1811, 1813, 1817, 1832, 1880, 1886, 1996, 1999, 2004, 2006, 2007, 2008, 2017, 2059, 2096, 2195.
- ONTOLOGY_GAP: 761, 930, 1512, 1536, 1540, 1545.

No blanket conversion: cada record compara fuente/reglas, candidatos, conceptos diferidos y assignments finales. El before/after, la evidencia completa y la evaluación del classifier se entregan por producto en training-resolution-delta.json e invalid-51-reconciliation.csv. Candidate violations = 0.

Delta exacto: {"totalRecords":2048,"unchangedRecords":1205,"changedRecords":843,"resolutionStateChanged":51,"exerciseAssignmentsChanged":0,"functionAssignmentsChanged":0,"negativeEvidenceChanged":792,"resolutionEvidenceChanged":843,"lineageOnlyChanged":0}. Las categorías se superponen: evidencia de resolución incluye el razonamiento de reconciliación; negativeEvidenceChanged cuenta los negativos vacíos cuyo estado no cambia.

## D. Negative evidence

836 baseline negatives: present=792, absent=44, not reconstructable=0. Ninguno cambia de estado. La evidencia PRESENT enlaza el input evaluado, una rama negativa real, policy y alcance MODELED_SNAPSHOT_COVERAGE. El reason genérico histórico no cuenta. ABSENT no es fallo automático. La evidencia nueva no satisface por sí sola una obligación positiva de admission; no fabrica consolidation. IDs/fuente/regla por cada negativo: negative-evidence-audit.json.

## E. Required assignment gaps

{"SAFE_DERIVABLE":0,"MISSING_SOURCE_DATA":0,"POLICY_UNKNOWN":2564,"ALREADY_SATISFIED":468}. Unidad: producto/dimensión/código; POLICY_UNKNOWN incluye las ramas de aplicabilidad desconocida por producto/dimensión. No hay assignments nuevos porque las obligaciones source-backed identificadas ya están satisfechas. El algoritmo y los tests prueban la derivación segura de un gap con fuente suficiente y el rechazo cuando falta autoridad. No se decide aplicabilidad por frecuencia. Detalle: source-required-training-gaps.json.

## F. Training candidate identity

- Snapshot: sha256:959e0cbac47fc19db88c36338a380a9cf9494bc653491d9e706d9f78201ff8d7.
- Semantic checksum: 47f8f493fea280549da079f1c7a4f6c6231ee11fdab69326ebbedbbad73b670b.
- Snapshot content hash (canonical + newline): sha256:23fcb56b2c03ec4dd802481d3684f8fc90027c0c5d5c47e4e97b5ee730670e3b.
- Training V2 wrapper content hash: sha256:1313a5f5341912773071d59cd7bcc6113d17d01a0d161ccecfe6095081addb0e.
- Schema: 2. resolutionEvidence existente alcanza; sin migración del snapshot.
- Baseline native: sha256:28be0bca348b2ba915fac8597919657e18438fa9053443ebf8ff6042197093a5.
- Legacy accepted: sha256:045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1.

## G. Query / Discovery

### exercise

Admission estricto activo: 89 → 101 (delta 12); retirados: [].

Agregados:

- 12: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 777: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 784: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1386: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1578: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1810: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1880: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1886: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 2007: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 2017: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 2059: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 2096: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.

Runtime bruto activo: 98 → 111. Query completo: 220 → 233; Discovery completo: 220 → 233. Los IDs exactos de todos los conjuntos están en discovery-delta.json.

### function

Admission estricto activo: 93 → 126 (delta 33); retirados: [].

Agregados:

- 87: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 435: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 437: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 454: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 455: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 462: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 463: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 466: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1021: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1022: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1124: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1137: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1138: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1139: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1140: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1343: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1344: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1345: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1346: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1347: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1348: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1349: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1350: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1811: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1813: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1817: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1996: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 1999: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 2004: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 2006: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 2008: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 2096: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.
- 2195: FINAL_SOURCE_RECONCILIATION_SEMANTIC_COMPLETE.

Runtime bruto activo: 95 → 128. Query completo: 221 → 254; Discovery completo: 221 → 254. Los IDs exactos de todos los conjuntos están en discovery-delta.json.

89/93 es el baseline estricto de admission P2.3B. Los servicios runtime existentes tienen un conjunto más amplio; se midieron ambos sin cambiar filtros ni relajar SEMANTIC_COMPLETE. Cada incremento estricto procede de resolución respaldada por contenido. Function no resuelve exercise.

## H. Consolidation / admission

Activos before: {"total":886,"knownObligations":256,"consolidation":{"UNKNOWN_OBLIGATIONS":563,"INVALID":51,"CONSOLIDATED":116,"REVIEW_REQUIRED":38,"BLOCKED_BY_CONFLICT":54,"PARTIALLY_CONSOLIDATED":62,"BLOCKED_BY_DATA":2},"certified":116,"exerciseDiscovery":89,"functionDiscovery":93,"unifiedRetrieval":{"REVIEW_REQUIRED":556,"BLOCKED":141,"ADMITTED":116,"PARTIAL":66,"NOT_APPLICABLE":7}}.

Activos after: {"total":886,"knownObligations":256,"consolidation":{"UNKNOWN_OBLIGATIONS":607,"CONSOLIDATED":116,"REVIEW_REQUIRED":38,"BLOCKED_BY_CONFLICT":60,"PARTIALLY_CONSOLIDATED":63,"BLOCKED_BY_DATA":2},"certified":116,"exerciseDiscovery":101,"functionDiscovery":126,"unifiedRetrieval":{"REVIEW_REQUIRED":600,"ADMITTED":116,"BLOCKED":96,"PARTIAL":67,"NOT_APPLICABLE":7}}.

Delta activo: {"certified":0,"exerciseDiscovery":12,"functionDiscovery":33,"unifiedAdmitted":0,"knownObligations":0}. Obligaciones conocidas permanecen 256/886; UNKNOWN familiar permanece 630/886. Consolidation certificado y Unified Retrieval admitted permanecen 116. Los UNKNOWN no se reinterpretan: las effectiveRequirements son idénticas por producto y dimensión. El contador UNKNOWN_OBLIGATIONS de estado puede aumentar al eliminar INVALID; no son obligaciones nuevas. ALL y payloads modificados: consolidation-delta.json.

## I. Regression

Product Discovery: mismos 791/886 IDs, cero agregados/retirados. Specs: mismos 82 conflict IDs. Product Semantics, Training V1, Specs y Trust Maps son idénticos byte a byte en el candidate bundle. 173 archivos protegidos, incluidos pointers, tienen el mismo fingerprint antes/después. P_NEW: 21 familias sin asignación ni promoción accidental. Contract: semantic-obligations-v2, hash sha256:125caf2727b6a8efe2727ca47f02abebc8b552e33d2cc80fb2db411f67008e94, sin modificación.

## J. Candidate bundle

ID: sha256:757c9bdb3038a97aeb4822c87d0a09e52257cdcc684d970e8a4987b85c5b5a72. Local: cross-projection-audit/p2-3c/candidate-bundle/757c9bdb3038a97aeb4822c87d0a09e52257cdcc684d970e8a4987b85c5b5a72. Comparator PASS; validation PASS. Sólo Training V2 y la identidad/metadata de construcción del bundle cambian. Hashes protegidos: {"productSemantics":{"unchanged":true,"contentHash":"sha256:73db59d459d0d1e233bb666df2592be7143395a3c9f6d02e1ec1d42e9b557d1f"},"trainingSemantics":{"unchanged":true,"contentHash":"sha256:6c2310ec7995b9ff64936a28012995bb662678d7b4c85eddd0b4d4f5e945331c"},"specs":{"unchanged":true,"contentHash":"sha256:faf7da28cb852aeced75a59758130db019db6b25c20ae035be120be95ccbc1bd"},"trustMaps":{"unchanged":true,"contentHash":"sha256:c72ab7ecff471c98bd15af77da43c34025d6f271926fc49242c91caf460ff640"}}. Nunca se activó.

## K. Tests

Suite completa: 2634 tests, 2634 passed, 0 failures; success=true. Runner directo Vitest, sin pretest publicador. Typecheck/lint se ejecutan por separado. El test histórico rojo conserva la falla anterior; la regresión debe pasar ahora. Reproducibilidad: mismo snapshot/hash/orden de evidencia con inputs reordenados y mismo resultado en builder native. G13 sólo PASS con suite completa exitosa.

## L. Repository hygiene

20 archivos candidatos a Git; contenido total de esos archivos: 203754 bytes. Diff de archivos ya tracked: 33736 bytes; archivos nuevos se incluyen en el total de contenido. No se creó commit ni se alteró el index. Todos los JSON/CSV/snapshot/bundle/resultados del directorio P2.3C siguen ignorados; sólo este reporte Markdown y el script pequeño son candidatos dentro de cross-projection-audit.

Archivos candidatos:

- .gitignore
- cross-projection-audit/README.md
- cross-projection-audit/p2-3c/REPORT-P2.3C.md
- cross-projection-audit/training-reconciliation-audit.mjs
- docs/catalog-v2/P2_3C_TRAINING_SEMANTIC_RECONCILIATION.md
- scripts/catalog-v2/audit-training-semantics-v2-authority.ts
- scripts/catalog-v2/build-projection-bundle.ts
- scripts/catalog-v2/build-training-semantics-v2.ts
- scripts/training-semantic-classification-v2/classify-catalog.ts
- src/domain/catalog/projection-bundle.ts
- src/domain/catalog/training-semantics-v2-projection.ts
- src/domain/training-semantic-classification/classifier.ts
- src/domain/training-semantic-snapshot/index.ts
- src/domain/training-semantic-snapshot/reconcileResolution.ts
- src/domain/training-semantic-snapshot/resolutionPolicy.ts
- src/domain/training-semantic-snapshot/semanticInvariants.ts
- src/domain/training-semantic-snapshot/v2Runtime.ts
- src/domain/training-semantic-snapshot/v2SnapshotBuilder.ts
- src/infrastructure/training-semantic/fileTrainingSemanticSnapshotV2Store.ts
- tests/unit/trainingSemanticReconciliation.test.ts

## M. Production disposition

**NEEDS_CONTENT_REVIEW**. Revisar los IDs, los seis ONTOLOGY_GAP y los deltas de elegibilidad antes de un gate de rollout separado. El binario previo con wrapper estricto requiere lectores compatibles con los campos nuevos de policy. No pm2 restart, activate, rollback, pointer mutation o production publish en esta fase.

## N. Remaining Training debt

- Content inconsistency: 0 negative-with-assignments.
- Negative evidence debt: 44 ausentes, 0 no reconstruibles; no democión automática.
- Family applicability UNKNOWN: 630 activos con alguna obligación desconocida; 2564 filas producto/dimensión UNKNOWN en el inventario Training. No se resuelve por assignments históricos.
- Source data / ontology / rule gaps: distribución total del candidato {"VERIFIED_NO_APPLICABLE_CAPABILITY":836,"SEMANTIC_COMPLETE":433,"ONTOLOGY_GAP":759,"DATA_GAP":16,"AMBIGUOUS":4}; los seis ONTOLOGY_GAP del cohort inválido requieren autoridad de ontology/rules antes de COMPLETE.
- Source-required missing assignments: SAFE_DERIVABLE=0, MISSING_SOURCE_DATA=0; no se agregan facts sin evidencia.
- Specs/Trust/Product debt continúa fuera de alcance, incluidos los 82 conflictos Specs.

Reproducir: node --import tsx cross-projection-audit/training-reconciliation-audit.mjs. [Metodología y rollout](../../docs/catalog-v2/P2_3C_TRAINING_SEMANTIC_RECONCILIATION.md).
