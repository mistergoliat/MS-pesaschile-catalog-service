# P2.3C — Training Semantic Reconciliation & Evidence Integrity

Esta fase construye un candidato local. La disposición es `NEEDS_CONTENT_REVIEW`; no publica producción, no cambia pointers y no despliega. Los resultados exactos, IDs y hashes están en [REPORT-P2.3C](../../cross-projection-audit/p2-3c/REPORT-P2.3C.md). El contenido generado por producto permanece local e ignorado.

## Causa y reproducción histórica

1. `scripts/training-semantic-classification-v2/classify-catalog.ts:isResolved` devuelve `true` inmediatamente para un negativo histórico, antes de comparar los códigos publicados. `resolutionState` devuelve ese negativo sin considerar los assignments finales. Se exportan estas funciones y se protege la entrada CLI para probar su comportamiento histórico sin regenerar artifacts aceptados.
2. A00.6.7, `audit-a00.6.7.ts:main`, conserva `baselineResolved` y, cuando el estado original es negativo, vuelve a elegir el negativo. Su policy CSV aceptada se mantiene intacta.
3. `v2SnapshotBuilder.ts:resolutionStateFor` prioriza la policy curada sobre el resultado de V2/V2.1. El classifier V2 agrega funciones después de la cobertura V1; V2.1 agrega enriquecimientos sin reconciliar esa resolución. `semanticRecord` fija `resolved=true` para el negativo contradictorio. Antes de P2.3C ni el validator ni el store impedían esa publicación.

El test rojo se ejecutó antes del fix: una función `CABLE_RESISTANCE` válida y un override negativo no provocaban rechazo. `historical-red.json` conserva la falla; el mismo test ahora pasa. El test histórico adicional ejecuta `isResolved`, `resolutionState` y el builder histórico, y demuestra la contradicción. `replayHistorical` es una reconstrucción en memoria explícita; sus resultados inconsistentes son rechazados por las entradas de publicación. El reader histórico conserva compatibilidad para los artifacts ya aceptados.

Baselines protegidos:

- Native: `sha256:28be0bca348b2ba915fac8597919657e18438fa9053443ebf8ff6042197093a5`.
- Legacy: `sha256:045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1`.
- Obligations: `semantic-obligations-v2`, schema 2, `sha256:125caf2727b6a8efe2727ca47f02abebc8b552e33d2cc80fb2db411f67008e94`.

## Nueva policy e identidad

`training-resolution-policy-p2.3c-v1` y `training-semantic-builder-p2.3c-v1` viven en `resolutionPolicy.ts`. El hash canónico incluye las reglas de reconciliación, las ramas negativas originales, classifier/rules/registry y el contrato P2.3B. El descriptor de proyección guarda versión, builder, hash, policy anterior y hash del CSV anterior. No se reusa el identificador histórico con conducta nueva. La clasificación sigue siendo `training-semantic-classifier-v2.1`: sus reglas positivas no cambiaron. El snapshot obtiene una identidad nueva por su resolución y evidencia nuevas.

## Algoritmo puro

`reconcileTrainingResolution` recibe el record, su input original y el contexto offline opcional. No accede a DB, network o archivos y no tiene condiciones por productId.

1. Evalúa explícitamente `semantic-obligations-v2`, preservando UNKNOWN y separando exercise/function.
2. Audita cada código requerido. Un código ya presente es `ALREADY_SATISFIED`. UNKNOWN es `POLICY_UNKNOWN`. Fuentes insuficientes son `MISSING_SOURCE_DATA`.
3. Una adición `SAFE_DERIVABLE` requiere dimensión REQUIRED, evidencia vinculada de la familia primaria, lineage verificada, mapping ACTIVE del registry y un assignment emitido por una regla existente. Otros ejes Product pueden permanecer PARTIAL; esa deuda no invalida una prueba independiente de familia. Sólo está autorizada la derivación familiar vigente de function, nunca la de exercise. Sin un contexto con esa autoridad no se agrega nada.
4. Para negativos contradictorios o assignments agregados, reproduce los classifiers sobre la fuente; compara evidencia y relaciones de los assignments finales. Fuente ausente o evidencia no reproducible → DATA_GAP; candidatos de revisión → AMBIGUOUS; conceptos diferidos no modelados → ONTOLOGY_GAP; códigos positivos requeridos que faltan → RULE_GAP; contenido modelado probado y satisfecho → SEMANTIC_COMPLETE.
5. Guarda la evaluación, gaps/candidatos, regla, hash de policy y referencia canónica de fuente. Una función nunca satisface una capacidad de exercise. COMPLETE conserva el alcance del contenido modelado del snapshot; no certifica obligaciones familiares desconocidas.

## Invariant y publicación

`validateTrainingSemanticInvariants` es independiente de parity. Exige negativo ⇒ ambas listas vacías; códigos y relaciones contractuales; mapping familiar aprobado; combinaciones resolved/state; IDs únicos; referencias de reglas y fuente; hash y nota de evidencia nuevos. Con los inputs disponibles verifica también las referencias de features/categorías y resolución. No es otro classifier.

El builder ordinario, ambos stores y `validateBundleForPublication` ejecutan este gate. El builder native aplica el finalizer antes de validarlo. `validateBundle` admite lectura de bundles históricos, pero para la nueva policy valida además identidad de policy e invariants. La CLI de bundles usa el gate estricto antes de escribir. La antigua CLI que intenta publicar el CSV histórico contradictorio falla cerrada.

No se persiste anatomía en assignments ni funciones: el schema estricto la rechaza. `v2Runtime.fact` deriva anatomía exclusivamente con `deriveExerciseSemantics(capabilityCode)` de códigos válidos del registry.

## Evidencia negativa

Los 836 negativos vacíos conservan estado. Se reproducen las ramas negativas reales de `determineCoverageStatus`, con veto de cualquier positivo o candidato de revisión V2/V2.1. Un motivo genérico histórico no es prueba. Fuente ausente se distingue de fuente disponible sin prueba negativa.

La representación V2 existente `resolutionEvidence: {kind, sourceId, note}[]` alcanza: `sourceId` enlaza el hash del input canónico; `note` contiene regla, policy y scope. `CLASSIFIER_NEGATIVE_RULE` prueba cobertura negativa modelada; no prueba obligaciones universales ni se introduce como tipo aceptado de admission para satisfacer un requisito positivo. El audit mantiene la fuente reproducible por producto. La falta de evidencia no invalida por sí sola un negativo coherente.

## Delta, Query/Discovery y admission

La comparación conserva el before/after completo de cada record cambiado, regla y fuente. Hay categorías superpuestas de cambio y un contador separado de lineage-only. Los 51 no se convierten en bloque a COMPLETE: cada uno tiene evaluación de sus assignments finales, candidatos y conceptos diferidos.

Se ejecutan las implementaciones existentes de Query y Semantic Discovery. Readers en grupos de 100 evitan truncar por el límite del contrato; se unen IDs y se comparan antes/después. No se modifican filtros ni se relaja COMPLETE. El baseline 89/93 corresponde a admission estricto de P2.3B, no al conjunto bruto que devuelve runtime: se reportan ambos conjuntos y sus diferencias. Product Discovery estricto debe conservar los mismos 791/886 IDs. Specs mantiene sus 82 conflict IDs.

Admission se recalcula para todos los productos y activos. Una mejora de contenido no cambia la aplicabilidad: se comparan, producto por producto, todas las effectiveRequirements y los UNKNOWN. Se mantienen los tests P_NEW por las 21 familias. Consolidation y Unified Retrieval sólo cambian cuando el contrato lo permite; no se usa evidencia negativa nueva para fabricar certificación.

## Compatibilidad y candidate bundle

El snapshot sigue en schema 2, sin migración. El descriptor de policy del wrapper tiene campos opcionales nuevos: readers actuales reconocen la policy nueva y la histórica; un binario anterior con schema estricto del wrapper necesitará actualizarse antes del rollout. La validación histórica y lectura de artifacts aceptados se preservan; la publicación nueva es más estricta.

El audit construye un bundle local después de validar el snapshot, con codeRef basado en código y builder nuevo. Compara bytes de Product Semantics, Training V1, Specs y Trust Maps; todos deben ser idénticos. Sólo cambia Training V2 y la identidad/metadata de construcción del bundle. No escribe en los stores protegidos. El fingerprint completo de `artifacts/` y `data/`, incluyendo pointers, se compara antes/después.

## Reproducción y rollout

Con las fuentes y baselines locales verificados disponibles:

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.config.ts --reporter=json --outputFile=cross-projection-audit/p2-3c/test-results.json
npm run typecheck
npm run lint
node --import tsx cross-projection-audit/training-reconciliation-audit.mjs
```

No usar el pretest npm que publica/activa snapshots. El test rojo histórico es evidencia de la ejecución anterior al fix; no se genera una falla falsa en ejecuciones posteriores. Cuando ese resultado original está disponible, el audit verifica su falla; en todo checkout reproduce el snapshot histórico y sus 51 contradicciones desde source/policy, sin publicarlo. Las ejecuciones posteriores comparan snapshot/hash/evaluación/evidence ordering, además del native builder. Los scripts, tests, docs y el informe Markdown son candidatos para Git; los JSON/CSV/bundle generado son ignorados.

El rollout requiere revisión del delta y sus IDs, aprobación separada del candidato, despliegue de lectores compatibles, comprobación de hashes y un gate productivo explícito. No ejecutar en esta fase pm2 restart, activation/rollback, publicación productiva ni mutación de pointers. Deuda restante: conceptos/rules no modelados, ausencia de evidencia negativa, obligaciones familiares UNKNOWN, fuentes faltantes y deuda Product/Specs/Trust fuera de alcance.
