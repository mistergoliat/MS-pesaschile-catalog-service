# P2.3C — Production Deployment & Activation Review

Fecha: 2026-10-07. Revisión del candidate FIX2 aprobado, sin alterar sus identidades.
Resultado: **BLOCKED** para el rollout completo bajo el contrato de proyecciones protegidas solicitado.

La implementación compila, reproduce el candidate exacto y lee el bundle realmente activo. La activación fija, sin embargo, reemplazaría cuatro artifacts protegidos con bytes diferentes a producción; Specs además retrocedería ocho referencias sourceFeature.featureValueId. La igualdad de conjuntos de Discovery y conflictos no sustituye igualdad de bytes. No se modificó código, candidate, fuente histórica ni puntero para resolver esa diferencia.

## A. Current production baseline

Inspección SSH de lectura a ec2-user@98.80.166.131, con host key existente y StrictHostKeyChecking=yes. Acceso confirmado; identidad privada leída únicamente por OpenSSH. Registro principal: 2026-10-07T21:45:52.550Z; smokes posteriores de lectura en la misma sesión. Evidencias JSON locales ignoradas en cross-projection-audit/p2-3c-fix2/rollout-*.json.

| Campo | ROLLBACK_BASELINE leído en EC2 |
| --- | --- |
| Checkout | /home/ec2-user/services/MS-pesaschile-catalog-service |
| previousRuntimeCommit / git HEAD | b19fe209f34cb9ba0d9b5e1e946ec7296e7b64b0 |
| runtime buildRef | catalog-service@b19fe209f34cb9ba0d9b5e1e946ec7296e7b64b0 |
| PM2 | catalog-service, id 2, ONLINE, PID 1367662 |
| Ejecutable | dist/src/server.js |
| Node | 22.23.1 |
| PM2 max_memory_restart | 402653184 bytes (384 MiB); restart_time=14 |
| previousBundleId | sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8 |
| previousSnapshotId (Training V2 interno) | sha256:28be0bca348b2ba915fac8597919657e18438fa9053443ebf8ff6042197093a5 |
| Training V2 projectionId (wrapper) | sha256:9693461e90b52dc3079ccc297d2627213b45956a819d76e8d556594f26f2531f |
| previousPointer | artifacts/catalog-v2/control/active.json; JSON completo abajo |
| pointer manifest hash | sha256:c1605f9e311fe0ee79164d1c849a93dd1f64e3a5eca172098d4d4015667bd8b6 |
| loadedAt | 2026-10-05T17:48:57.300Z |
| reloadState | READY; desired=loaded, bundle y activationId coincidentes |

GET /health/ready devolvió HTTP 200: database, redis, relationshipSnapshot y Commercial Truth OK. GET /health/catalog-authority y /health/projections devolvieron HTTP 200. Product Semantics, Training V1, Training V2, Specs, Trust y runtime estaban READY. Product legacyFallbackReads=0. Relationships CAT-V2 y Capabilities CAT-V2 estaban UNAVAILABLE; Relationships recommendation legacy estaba READY. No confundir esos dominios.

previousPointer, leído directamente:
~~~json
{
  "schemaVersion": "1",
  "activeProjectionBundleId": "sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8",
  "activatedAt": "2026-10-05T17:48:55.817Z",
  "activationId": "803d3b3b-86a1-49df-86e2-4fdca79a5e30",
  "previousProjectionBundleId": "sha256:1ec2e01046a1b0c0049cf5730b553c4ce52fb7a841bdca05df98d5e830cd8c5c",
  "previousActivationId": "0aa2e66d-8862-4775-a8a3-dbc0ba725b59",
  "actor": {"type": "manual", "identity": "operator"},
  "reason": "p2.2b-training-v2-production-rollout",
  "bundleManifestHash": "sha256:c1605f9e311fe0ee79164d1c849a93dd1f64e3a5eca172098d4d4015667bd8b6"
}
~~~

El rollback del futuro FIX2 sería al bundle activo 84c85d15…, no al previousProjectionBundleId 1ec2e010… que aparece en el puntero actual. ActivationService.candidate verificó el rollback target en EC2: PASS; history contenía cuatro transiciones comprometidas, incluida la activación actual. Se descargaron artifacts y dist mediante lectura remota a un directorio temporal local; no se subió nada.

Git de EC2 no tenía modificaciones tracked. Tenía dos rutas untracked ajenas: un backup .env.bak-r4j1-20260930T184230Z y docs/audits/product-semantic-coverage/. No se leyó el backup ni se incluyó en el commit. No ejecutar git clean en ese checkout.

Lectura final de EC2 a 2026-10-07T21:54:31.004Z: hash físico del pointer, PID y restart_time permanecían iguales al baseline; authority seguía READY. Se verificó de nuevo que los 300 archivos protegidos locales, el snapshot y los cinco artifacts del candidate permanecían intactos.

## B. Candidate identities

| Identidad inalterada | Valor |
| --- | --- |
| rulesHash | d143736268bff53900de4ceaa7b50b76061fcc73d0b6d44e2a4a645f5834b8a8 |
| policy | training-resolution-policy-p2.3c-fix2-v1 |
| policyHash | sha256:c258f5db606d48f6e62399c5ab3b551c8650309aa2e8d01ac23431adbc99fa03 |
| builder | training-semantic-builder-p2.3c-fix2-v1 |
| snapshotId | sha256:acf4434ad02dd09c11708111e86b78732f37ffd2647a2ffc98e8e5202196b202 |
| snapshotContentHash | sha256:8b71a46a61012d3ff9e63438360d8dd1757f26638c4a92eb9c58a831d1e5f74a |
| trainingWrapperContentHash | sha256:711c85a82b285fd7d182249e02b3cc654935e4563dd78674a43eccda02b74853 |
| candidateBundleId | sha256:2f51d0c80a75e331232537c4bf97ffe59c40aef3db4738daeb4b5bcf3d524329 |
| frozen codeRef | sha256:3f678f0a9e5a83c101aa6a3b6b6cb312e80f4a46ff5fc912d397c306a2f5a7ac |
| semantic-obligations-v2 | sha256:125caf2727b6a8efe2727ca47f02abebc8b552e33d2cc80fb2db411f67008e94 |
| Training registry hash | 7f7c6e88f31a7e4be4fb03761b58b380c6b37070297172a713b2d8a5ba9f14f8 |

El snapshotId interno difiere del projectionId del wrapper. Comparar los campos correctos en health, manifest y API. Se revalidaron snapshot, wrapper, bundle y gate de publicación; todos PASS.

## C. Runtime backward compatibility

Prueba local con código FIX2 compilado y bytes descargados del bundle real de EC2. RuntimeProjectionManager.reconcile ejecutó su loader y ActivationService.candidate reales, sin usar un loader simulado ni escribir un puntero. El store de lectura entregó el manifest/artifacts reales y prohibía promote. Resultado: reloadState=READY, projectionRuntime y las cinco proyecciones requeridas READY, sin lastReloadError.

| Pregunta | Respuesta |
| --- | --- |
| Can new runtime read current production bundle? | YES |
| Can new runtime read historical Training V2 snapshot? | YES |
| Does old bundle require migration? | NO |
| Does code deploy mutate active pointer? | NO |
| new code + old active bundle | READY, prueba del loader local sobre artifacts productivos |

El snapshot legacy 045f04fb739218e24e6ffcbd27560df94b21d91c26f0e84befebf9696622c5c1 pasó getById del FileTrainingSemanticSnapshotV2Store y refresh del lector, conservando sus facts históricos. El snapshot nativo 28be0bca… productivo pasó el loader del bundle real. El bundle histórico local P2.3B ee4881b5… también quedó READY, pero no se usó como sustituto del baseline real.

Revisión de los siete archivos solicitados:

| Archivo | Implicación operativa |
| --- | --- |
| projection-bundle.ts | Lectura comprueba identidad y lineage; el wrapper productivo sin version conserva lectura histórica. Las nuevas publicaciones usan invariantes adicionales. |
| training-semantics-v2-projection.ts | Nuevos campos de policy opcionales permiten el wrapper antiguo; schema sigue siendo 2. |
| v2Runtime.ts | refresh valida snapshot histórico y deriva facts; invariantes adicionales están en save, no en refresh. |
| fileTrainingSemanticSnapshotV2Store.ts | getById/getActive siguen leyendo histórico; save/activate tienen gate más estricto. |
| reconcileResolution.ts | Trabajo de construcción; el loader del bundle no reconstruye ni readjudica contenido antiguo. |
| resolutionPolicy.ts | Identidad de nuevas publicaciones; no migra automáticamente snapshots antiguos. |
| semanticInvariants.ts | Gate de escritura y wrappers con policy actual; no se aplica a la lectura legacy original sin policy versionada. |

Límite observado: el bundle histórico P2.3C-FIX 6c2e3800… falla con SOURCE_LINEAGE_INVALID: training resolution policy identity, aunque el allowlist admite su rulesHash a nivel de snapshot. No usar ese bundle como rollback target. El rollback target real 84c85d15… sí pasa. No convertir compatibilidad del snapshot en promesa de lectura de todos los wrappers históricos.

Esta prueba no es un reinicio productivo: tras un despliegue futuro habrá que repetir los gates HTTP y PM2 de J antes de cualquier activación.

## D. Runtime forward compatibility

**old runtime + FIX2 bundle = INCOMPATIBLE.**

Se descargó dist del proceso productivo de lectura y se ejecutó su validateBundle localmente contra el candidate. Rechaza inputs.resolutionPolicy: unrecognized keys builderVersion, previousPolicy, version. El HEAD local anterior 70ba858031ea6241a597a050181e9213f2ea95f0 mostró el mismo rechazo en una exportación separada.

Secuencia obligatoria: desplegar runtime compatible → demostrar que el bundle 84c85d15… continúa READY → resolver el gate H → publicar/verificar candidate → activar. No activar FIX2 usando el runtime actualmente desplegado. El runtime anterior tampoco sirve como fallback de código mientras FIX2 permanezca activo: restaurar primero el bundle previo.

## E. Git/commit review

Un commit cohesivo para reconciliation, precision y targeted closure. Los reports de las tres fases preservan revisión y decisiones; no simulan tres releases históricos. El nuevo reporte documenta el bloqueo operativo.

Inventario completo de los archivos locales candidatos, sin artifacts generados:

| Clase | Archivos |
| --- | --- |
| DOC / higiene | .gitignore; cross-projection-audit/README.md |
| SOURCE | scripts/catalog-v2/build-projection-bundle.ts |
| SOURCE | scripts/catalog-v2/build-training-semantics-v2.ts |
| SOURCE | scripts/training-semantic-classification-v2/classify-catalog.ts |
| SOURCE | scripts/training-semantic-classification/lib/load-input.ts |
| SOURCE | src/domain/catalog-admission/applicability-v2.ts |
| SOURCE | src/domain/catalog/projection-bundle.ts |
| SOURCE | src/domain/catalog/training-semantics-v2-projection.ts |
| SOURCE | src/domain/training-semantic-classification-v2/classifier.ts |
| SOURCE | src/domain/training-semantic-classification-v2/rules.ts |
| SOURCE | src/domain/training-semantic-classification/classifier.ts |
| SOURCE | src/domain/training-semantic-classification/contracts.ts |
| SOURCE | src/domain/training-semantic-snapshot/index.ts |
| SOURCE | src/domain/training-semantic-snapshot/v2Runtime.ts |
| SOURCE | src/domain/training-semantic-snapshot/v2SnapshotBuilder.ts |
| SOURCE | src/domain/training-semantic-snapshot/reconcileResolution.ts |
| SOURCE | src/domain/training-semantic-snapshot/resolutionPolicy.ts |
| SOURCE | src/domain/training-semantic-snapshot/semanticInvariants.ts |
| SOURCE | src/infrastructure/training-semantic/fileTrainingSemanticSnapshotV2Store.ts |
| TEST | tests/unit/catalog-admission-v2.test.ts |
| TEST | tests/unit/training-semantic-classifier-v2.test.ts |
| TEST | tests/unit/trainingV2AuthorityParity.test.ts |
| TEST | tests/unit/trainingSemanticReconciliation.test.ts |
| TEST | tests/unit/trainingRulePrecision.test.ts |
| AUDIT SCRIPT | scripts/catalog-v2/audit-training-semantics-v2-authority.ts |
| AUDIT SCRIPT | cross-projection-audit/training-reconciliation-audit.mjs |
| AUDIT SCRIPT | cross-projection-audit/training-rule-precision-audit.mjs |
| AUDIT SCRIPT | cross-projection-audit/training-targeted-closure-audit.mjs |
| DOC | docs/catalog-v2/P2_3C_TRAINING_SEMANTIC_RECONCILIATION.md |
| DOC | docs/catalog-v2/P2_3C_FIX_TRAINING_RULE_PRECISION.md |
| DOC | docs/catalog-v2/P2_3C_FIX2_TARGETED_TRAINING_CLOSURE.md |
| DOC | docs/catalog-v2/P2_3C_PRODUCTION_ROLLOUT_REVIEW.md |
| HUMAN REPORT | cross-projection-audit/p2-3c/REPORT-P2.3C.md |
| HUMAN REPORT | cross-projection-audit/p2-3c-fix/REPORT-P2.3C-FIX.md |
| HUMAN REPORT | cross-projection-audit/p2-3c-fix2/REPORT-P2.3C-FIX2.md |
| UNRELATED | Ninguno en el conjunto local elegible; backups y audit ajeno de EC2 excluidos. |

GENERATED/SHOULD_NOT_TRACK: los 127 archivos ignorados actuales de los tres directorios de evidencia, incluyendo REPORT-P2.3C-FINAL-CONTENT-REVIEW.md histórico, JSON/CSV, snapshots, bundles, dumps y los cuatro nuevos rollout JSON. Fuentes frozen bajo artifacts/, datos legacy bajo data/, dist/ y node_modules/ también permanecen fuera del commit. .gitignore sólo permite un report humano por cada directorio p2-3c, p2-3c-fix y p2-3c-fix2; los scripts viven en la raíz de cross-projection-audit. No agregar directorios con git add -f ni incluir el backup .env de EC2.

Métricas del conjunto a versionar, incluyendo este documento:
~~~text
FILES_TO_COMMIT=36
TOTAL_TRACKED_BYTES=0000503890
DIFF_FILES=36
DIFF_INSERTIONS=0000003238
DIFF_DELETIONS=72
~~~
TOTAL_TRACKED_BYTES suma el tamaño completo de los archivos candidatos, no el tamaño de todo el repositorio. El diff de los 21 archivos ya tracked era 289 inserciones / 72 eliminaciones; los 14 archivos nuevos previos sumaban 2520 líneas. Este documento se suma a ese inventario.

Mensaje propuesto:
~~~text
fix(catalog): reconcile training V2 evidence and close P2.3C precision defects

Reconcile resolution states against reproducible source evidence, refine
cable attachments and barbell support, and enforce publication invariants.
Preserve historical readers and protected local projections.
Document production rollout blocked by the active source/projection baseline.
~~~

SAFE_TO_COMMIT=YES para este conjunto revisado. Validación FIX2 existente: 2680/2680 tests, 181/181 focused, typecheck y lint PASS. En esta review se añadió compilación aislada, reproducción nativa exacta y pruebas de lectores sobre producción. git diff --check PASS. No hubo cambios de SOURCE/TEST durante esta review; no se repitió la suite completa ni se ejecutó npm test/pretest sobre los punteros protegidos.

## F. Source reproducibility

Se creó una exportación aislada y reproducible de los archivos tracked de HEAD más el overlay elegible explícito del inventario E. No se creó commit ni se modificó el index. Cada archivo exportado quedó identificado por SHA-256 en review-export.json, fuera del repo. Dependencias existentes se compartieron mediante junction; la compilación produjo dist separado. Frozen inputs y fixtures históricos se copiaron como entradas externas identificadas, fuera del conjunto a versionar.

Ruta local de evidencia temporal:
C:/Users/dell/AppData/Local/Temp/p23c-rollout-Vs7KXj

La exportación no es un commit publicado ni prueba un checkout Linux todavía. Sí prueba el estado revisado sin depender de archivos SOURCE no inventariados. npm run build PASS. Comando operativo real, ejecutado sólo en esa exportación:
~~~bash
npm run catalog:bundle:build -- --source-dir=artifacts/catalog-projection-input/36ef08110d3444e750c5c94b00009777425d8f86c9e77d6c55bc39d0f180aef2 --output-dir=rollout-rebuild/bundles --code-ref=sha256:3f678f0a9e5a83c101aa6a3b6b6cb312e80f4a46ff5fc912d397c306a2f5a7ac
~~~

Resultado exacto: snapshotId acf4434a…b202; bundleId 2f51d0c8…4329. Las cinco proyecciones publicadas son byte-identical al candidate aprobado. El snapshot canonizado más newline coincide con snapshotContentHash; wrapper coincide con trainingWrapperContentHash. Manifest sólo difiere en build.builtAt, excluido de bundleId por el contrato existente; el control plane hash del manifest publicado se debe calcular sobre sus bytes reales, no copiar el hash de otra reconstrucción. validation-report incluye tiempos locales y no participa en bundleId.

El builder CLI acepta --code-ref como referencia inmutable explícita. Mantener la referencia frozen aprobada; el serviceBuildRef del proceso será el SHA del commit futuro, una identidad distinta. El cálculo por defecto del codeRef usa todos los archivos TS y package-lock, y el orden del lock difiere del audit FIX2; no asumir que omitir --code-ref mantiene bundleId. Tampoco pasar el SHA del futuro commit como codeRef del artifact aprobado.

El audit targeted se intentó además en la exportación; terminó sus cálculos semánticos pero no completó el gate de higiene porque git check-ignore requiere .git. No se presenta ese intento como PASS completo. La reproducción exacta demostrada arriba proviene del builder operativo y sus validators, no de atribuir éxito al audit incompleto.

## G. Production artifact strategy

Estrategia seleccionada: **A. deterministic rebuild on EC2 from frozen source**, mediante catalog:bundle:build existente. No se crea publicador alternativo ni se extrae fuente nueva. Publicación immutable con directorio temporal, validación y rename ya implementados. Nunca tocar active.json al construir.

| Fuente | Candidate | Producción actualmente |
| --- | --- | --- |
| sourceExtractionId / canonicalInputHash | sha256:3694b291c89d5f011904b44dc7fe51eb6f355da63d5bb25c485009fadd67d007 | sha256:f505ea3f20740c6b5a64645a369d8c43953086ec7fa1aefd23daa2ccb98db4a9 |
| aggregateContentHash | sha256:36ef08110d3444e750c5c94b00009777425d8f86c9e77d6c55bc39d0f180aef2 | sha256:2a5521b77e5b26e2d56104ab2ad29d85aaff82c2f06d522d7aa141f1e062bb26 |
| compatibilityCsv | sha256:0073f7e76e8914ec3f4924adc84aedb1837a66b7d2677c054bc93c70cedb0d57 | sha256:e4f83e5513803e714089a2ad9f7590ffaea1f0b4373203cefc0559054fb7a442 |
| categoryTrustMap | sha256:01ac8a64b5aa20975d0e781eda618890bb7604219963eaf81ffaaed00db278fd | mismo hash |
| featureTrustMap | sha256:88bde84b077f86d21c04b419885f11cfb15c9f1a7ecf082942ef88d7e5dfd2c8 | mismo hash |

La fuente aprobada no estaba en EC2; sólo se encontró la extracción 2a5521b7…. Una transferencia futura deberá conservar los cinco archivos aprobados completos, verificando physical input hashes, manifest, extraction ID y aggregateContentHash antes de construir. Registro Training y semantic-obligations deben coincidir con B. Conservar un manifiesto de los SOURCE revisados y del commit futuro; cambios de código posteriores requieren nueva review. Diferencias de newline Git/OS pueden cambiar la referencia física calculada; --code-ref no autoriza a omitir revisión de fuente/código.

Reproducir con la extracción que ya está en EC2 generaría otro bundle: STOP. Construir otro hash, aun con counts iguales, también es STOP. La reproducción Linux del comando exacto permanece pendiente del rollout futuro; no se ejecutó construcción ni transferencia hacia producción en esta review.

## H. Protected projections

Hash físico SHA-256 del artifact completo:

| Proyección | Candidate esperado local | Bundle realmente activo en EC2 | Byte-identical a producción |
| --- | --- | --- | --- |
| Product Semantics | 73db59d459d0d1e233bb666df2592be7143395a3c9f6d02e1ec1d42e9b557d1f | 1c665a75468dfb520133973c7371b0a9bc0597282586480c48d89144df22c465 | NO |
| Training V1 | 6c2310ec7995b9ff64936a28012995bb662678d7b4c85eddd0b4d4f5e945331c | a53ddeb2ea2650dd2bf0fd4cdf8e74665f2c7b0a83538068426a941ea6ab3e45 | NO |
| Specs | faf7da28cb852aeced75a59758130db019db6b25c20ae035be120be95ccbc1bd | f0a1d85409758fb652bb371f0400d12f9ac1c9c9ee4f3b9d05bc529323e8cee2 | NO |
| Trust Maps | c72ab7ecff471c98bd15af77da43c34025d6f271926fc49242c91caf460ff640 | 3c7c2a7f35bec8ffe001e80ab09069e5d408176580c6583ec6886cd8807fc437 | NO |

Los cuatro hashes candidate coinciden con su baseline local aprobado FIX/P2.3B y con el replay operativo. Los 300 fingerprints de artifacts/punteros históricos locales siguen intactos. Esa garantía local no demuestra byte-identical respecto a EC2.

Product, Training V1 y Trust contienen el mismo contenido al quitar exclusivamente sourceExtractionId; sus wrappers cambian físicamente. Specs cambia también ocho referencias de provenance, con valores normalizados conservados:

| Product | Feature ID | featureValueId actual EC2 | featureValueId FIX2 |
| --- | --- | --- | --- |
| P269 | 12 | 241622 | 231123 |
| P269 | 11 | 241621 | 231122 |
| P269 | 3 | 241620 | 231121 |
| P1839 | 3 | 241675 | 212768 |
| P1840 | 3 | 241691 | 217555 |
| P1853 | 11 | 241663 | 217836 |
| P1853 | 3 | 241659 | 217832 |
| P2132 | 3 | 241639 | 222211 |

Relationships/Capabilities permanecen explícitamente UNAVAILABLE en ambos manifests; el recommendation legacy conserva su snapshot independiente.

**Gate H = FAIL.** No activar bajo la exigencia de cambiar únicamente Training V2/bundle preservando los cuatro artifacts productivos. Para desbloquear hace falta una decisión explícita posterior sobre el baseline: revisar un nuevo candidate construido sobre la fuente productiva y sus artifacts protegidos, o autorizar y revisar separadamente esta sustitución de lineage/provenance. Cualquiera cambia el contrato o las identidades de artifact y queda fuera de esta review. No parchear manifests, sustituir proyecciones dentro de 2f51d0c8… ni volver silenciosamente al baseline local mediante una activación intermedia.

## I. Commercial Truth isolation

RuntimeProjectionState no contiene precios, stock, promociones ni sellability. Activación/promote escribe sólo control/history y control/active.json; runtime intercambia la referencia de autoridad semántica. Código de precios, repositorios comerciales y API pública no tienen cambios en el inventario E. No hay migración DB.

Smokes reales ANTES: Product context y Item context de P1543, P1856, P1124, todos HTTP 200. Ejemplos observados, no valores futuros congelados:

| Item | regularGross CLP | finalGross CLP | promoción | stock | sellability |
| --- | --- | --- | --- | --- | --- |
| P1543 | 414990 | 331992 | percentage 0.2; validUntil 2026-10-12T03:00:00.000Z | 27 | sellable / in_stock |
| P1856 | 228990 | 228990 | null | 0 | not_sellable / out_of_stock |
| P1124 | 152990 | 152990 | null | 0 | not_sellable / out_of_stock |

pricing.engineVersion=catalog-commercial-v2.2.0. Product freshness tuvo asOf actual, cache.ageMs 6–8 ms y validUntil posterior. La indisponibilidad por stock de P1856/P1124 no es una regresión semántica ni un fallo de readiness.

Antes de code deploy, después de code deploy/old bundle, después de activation y después de persistence restart: repetir los mismos context endpoints con quantity=1 y el smoke existente; comprobar price, promotion, stock, sellability, tax/engineVersion y freshness/provenance. Añadir una variante real desde facts.variantOptions si está disponible, sin inventar itemKey. Comparar contra el owner comercial actual en la misma ventana: cambios legítimos de stock/precio/promoción y timestamps frescos son posibles. No exigir timestamps idénticos ni forzar los valores de esta tabla. Resolver diferencias con fuente comercial de lectura, y rollback si la activación introduce una regresión.

AFTER activation/persistence: PENDING, no ejecutados porque la review prohíbe activación/restart. La separación arquitectónica está demostrada; no se afirma que smoke AFTER pasó.

## J. Deployment sequence

Plan futuro condicionado al desbloqueo H y aprobación de ejecución; ningún comando mutante de esta sección se ejecutó. Comandos derivados de package.json, docs/operations/catalog-service-ec2-deployment.md y operación PM2 realmente observada. Consultar también CAT-V2-P1.4-activation-control-plane.md y CAT-V2-P1.5-runtime-hot-reload.md.

1. Revisar exactamente los 36 archivos E; stage explícito de esas rutas, git diff --cached --stat y git diff --cached --check; crear un commit con el mensaje E. No stage artifacts/. No hacerlo durante esta review.
2. Push normal de ese commit a la rama acordada; registrar REVIEWED_COMMIT completo. No force push.
3. Volver a leer baseline/health/commercial/history. Exigir bundle y activationId de A, o repetir review si hubo otra activación. Conservar rollback artifacts y runtime previo; comprobar espacio para ambos bundles.
4. En EC2, avanzar sólo al commit revisado, sin arrastrar otros cambios:
~~~bash
cd /home/ec2-user/services/MS-pesaschile-catalog-service
git fetch origin
git cat-file -e "$REVIEWED_COMMIT^{commit}"
git merge --ff-only "$REVIEWED_COMMIT"
test "$(git rev-parse HEAD)" = "$REVIEWED_COMMIT"
npm ci
npm run build
export CATALOG_SERVICE_BUILD_REF="catalog-service@$(git rev-parse HEAD)"
pm2 restart catalog-service --update-env
~~~
El shell debe usar ejecución con stop-on-error. Si el avance no es fast-forward o cambia SOURCE fuera del conjunto revisado, STOP; no resolver con reset/clean. El restart de este paso es exclusivamente para cargar código nuevo y su buildRef. No ejecutar builders de snapshot ni activation como parte del deploy de código.
5. Exigir que control/active.json permanezca byte-identical al baseline; el nuevo proceso debe cargar 84c85d15… y Training snapshot 28be0bca…, no FIX2.
~~~bash
pm2 status catalog-service
curl --fail --silent --show-error http://127.0.0.1:4010/health/ready
curl --fail --silent --show-error http://127.0.0.1:4010/health/projections
curl --fail --silent --show-error http://127.0.0.1:4010/health/catalog-authority
npm run catalog:projection:status -- --root=artifacts/catalog-v2 --bundle=sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8
npm run smoke -- --base-url=http://127.0.0.1:4010 --api-key="$CATALOG_SMOKE_API_KEY" --query=barra
~~~
CATALOG_SMOKE_API_KEY es una variable del operador cargada de forma privada; no imprimir ni persistir su valor. Los health endpoints devuelven HTTP 200 también en algunos estados degradados: comprobar JSON, no sólo curl exit code.

Gates antes de publicar/activar: PM2 ONLINE; serviceBuildRef exacto; desired=loaded=oldBundle y activationId coincidentes; projectionRuntime, Product, Training V1/V2, Specs, Trust y commercialV2 READY; lastReloadError=null; fallback reads sin incremento; relaciones/capabilities CAT-V2 UNAVAILABLE; Commercial smoke PASS. Cualquier fallo → STOP; no activar para reparar código.

6. Resolver H y confirmar nuevamente el rollback target. Actualmente este paso impide continuar.
7. Transferir sólo el frozen source aprobado completo a un directorio nuevo e inmutable si se mantiene la estrategia A; verificar hashes G. No volver a extraer Prestashop. El directorio destino del candidate aprobado sería artifacts/catalog-projection-input/36ef0811…aef2, no el existente 2a5521b7…bb26.
8. Rebuild/publish mediante el comando existente:
~~~bash
npm run catalog:bundle:build -- --source-dir=artifacts/catalog-projection-input/36ef08110d3444e750c5c94b00009777425d8f86c9e77d6c55bc39d0f180aef2 --output-dir=artifacts/catalog-v2/bundles --code-ref=sha256:3f678f0a9e5a83c101aa6a3b6b6cb312e80f4a46ff5fc912d397c306a2f5a7ac
npm run catalog:projection:status -- --root=artifacts/catalog-v2 --bundle=sha256:2f51d0c80a75e331232537c4bf97ffe59c40aef3db4738daeb4b5bcf3d524329
~~~
Exigir bundleId y snapshot/hash B, publication report PASS, cinco artifact hashes exactos y gate H resuelto. Si algún hash diverge → STOP. No publicar con otro ID para después activarlo por parecido.
9. Activación K; confirmar hot reload y health; ejecutar L y Commercial I; persistence N; final health. PM2 save sólo conforme a N.

SAFE_TO_DEPLOY_CODE_WITH_OLD_BUNDLE=YES para este código revisado y el baseline leído, con los gates anteriores. Esta decisión no autoriza despliegue en esta review ni elimina el bloqueo de artifacts para activación.

## K. Activation sequence

Comando existente y comparación CAS obligatoria, sólo en un rollout futuro autorizado y con H resuelto:
~~~bash
npm run catalog:projection:activate -- --root=artifacts/catalog-v2 --bundle=sha256:2f51d0c80a75e331232537c4bf97ffe59c40aef3db4738daeb4b5bcf3d524329 --expected-active=sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8 --actor=operator --reason=p2.3c-fix2-production-rollout
~~~

CLI valida candidate antes de promote. FileProjectionActivationStore toma lock exclusivo, compara activationId bajo lock, escribe/fsync history y pointer temporal, y rename atómico. ACTIVATION_CONFLICT deja el puntero anterior; no reintentar omitiendo expected-active.

Runtime detecta el pointer por polling (default 1000 ms), valida candidato completo y hace un swap único de estado. Registrar old bundle, new bundle, activationId, activatedAt, lastReloadAttemptAt, loadedAt, desired/loaded bundle e IDs, authority health y errores. Acordar ventana máxima de convergencia antes de ejecutar; observar errores/backoff y consumo de memoria. No encubrir failure con PM2 restart.

El CLI status es del control plane y no observa el runtime HTTP. Exigir ambos health endpoints y lineage de fixtures con snapshotId acf4434a…b202. SAFE_TO_ACTIVATE_FIX2_BUNDLE=NO por H, y también NO si todavía corre el runtime anterior.

## L. Smoke matrix

Los diez fixtures se leyeron realmente en HTTP durante preflight: HTTP 200 y lineage 28be0bca… todos. Tras activar debe aparecer únicamente la lineage nueva de B, conservando respuestas públicas. Capability/function codes en HTTP se llaman code; en snapshot se llaman capabilityCode/functionCode.

| Fixture | Resultado requerido después de FIX2 |
| --- | --- |
| P1020 | Sin CABLE_RESISTANCE; assignments vacíos; VERIFIED_NO_APPLICABLE_CAPABILITY; NO_CAPABILITY_APPLICABLE. |
| P1856 | Sin BARBELL_SUPPORT; conservar PULL_UP, DIP, BODYWEIGHT_SUPPORT; SEMANTIC_COMPLETE. |
| P247, P897, P1624 | DATA_GAP; assignments vacíos; resolved=false en artifact; sin CABLE_RESISTANCE automático ni VERIFIED_NO_APPLICABLE_CAPABILITY. |
| P1124, P1812, P1999, P2008 | CABLE_RESISTANCE DIRECT conservado; sin etiquetar negativos con assignments. |
| P1543 | BARBELL_SUPPORT conservado; rack real. |
| P435, P930 | AMBIGUOUS / DATA_GAP preservados; sin BARBELL_SUPPORT ni función Discovery/Unified ADMITTED. |

Comandos HTTP existentes para fixtures, usando variable privada para API key:
~~~bash
for id in 1020 1856 247 897 1624 1124 1812 1999 2008 1543 435 930; do
  curl --fail --silent --show-error -H "x-api-key: $CATALOG_SMOKE_API_KEY" "http://127.0.0.1:4010/v1/products/$id/training-semantics"
done
~~~

Ejemplo discriminante de discovery de función:
~~~bash
curl --fail --silent --show-error -H "x-api-key: $CATALOG_SMOKE_API_KEY" -H 'content-type: application/json' -X POST http://127.0.0.1:4010/v1/products/semantic-discovery/query --data '{"schemaVersion":1,"requirements":[{"axis":"TRAINING_FUNCTION","codes":["CABLE_RESISTANCE"],"mode":"required","match":"any","relations":["DIRECT"]}],"options":{"limit":100}}'
~~~
Verificar ausencia de P1020/P247/P897/P1624 y presencia de mecanismos que pertenezcan al conjunto devuelto. Consultar EXERCISE_CAPABILITY/DIP/PULL_UP para P1856 y TRAINING_FUNCTION/BARBELL_SUPPORT para P1543. No inferir presencia sólo de totalMatches ni omitir truncated.

La API pública no expone un endpoint de todos los estados de admission ni un contador Specs source conflicts. No inventar uno. Los counts pedidos son evaluaciones de admission sobre el cohort frozen activo, no el tamaño de cualquier búsqueda HTTP del catálogo completo. options.limit máximo 100 y sin paginación: no afirmar que una respuesta truncada enumera 791 IDs.

Prueba ejecutada en esta review: evaluateAdmissionSnapshot y semantic-obligations-v2 del código revisado sobre ambos bundles y sus fuentes verificadas; conjuntos completos ordenados guardados en rollout-projection-regressions.json. Se exige repetir la evaluación con bytes del bundle realmente loaded y fuente frozen verificada, cruzar lineage HTTP y consultar códigos representativos. El audit FIX2 existente documenta esa evaluación offline; sus paths son fixtures locales y no se debe ejecutar a ciegas sobre EC2 ni usar su gate de parity con histórico como gate de rollout.

| Métrica / conjunto | Baseline real evaluado con código nuevo | Expected FIX2 |
| --- | --- | --- |
| Active cohort | 886 | 886 |
| knownObligations | 228 | 228 |
| certified | 95 | 95 |
| Training Exercise Discovery | 89 | 100 |
| Training Function Discovery | 65 | 71 |
| Unified REVIEW_REQUIRED | 580 | 625 |
| Unified ADMITTED | 95 | 95 |
| Unified BLOCKED | 141 | 96 |
| Unified PARTIAL | 63 | 63 |
| Unified NOT_APPLICABLE | 7 | 7 |

Los counts baseline de esta tabla son evaluación local de artifacts descargados con el evaluator nuevo; no se presentan como un endpoint de admission del proceso actual.

Comparación exacta de conjuntos, SHA-256 de JSON.stringify(array de IDs numéricos ordenados ascendente):

| Conjunto | Cardinalidad FIX2 | Digest requerido |
| --- | --- | --- |
| Product Discovery activo | 791 | sha256:7d5d07a3ba600c823df31fa244859fa00b668a153c5a09b12b873e479e4568b7 |
| Specs source conflict, todos los productos | 82 | sha256:1d9bba9a2933ebe256a02c3803085f4b42e0085ffca6bb135c5cc34ecbd3d408 |
| Exercise Discovery activo | 100 | sha256:3056e67908bffb4496bf5037b63f29f0fb777b2663a1fcb2033d1d47e3158bac |
| Function Discovery activo | 71 | sha256:a96de64ee5b2a735cd1b85cd7deb1bc22d1f48192c8c2b8d6d4813334a50b501 |

Product 791 y Specs 82 son exactamente los mismos conjuntos en producción y candidate, demostrado sobre artifacts reales. Representantes Product: P7,P8,P9,P10,P11,P12,P13,P15,P16; Specs: P176,P389,P417,P425,P435,P480,P548,P549,P577. Exercise activo: P12,P176,P177,P300,P301,P302,P485,P503,P528; Function activo: P176,P300,P301,P302,P495,P761,P899,P934,P1021. Conservar todas las listas, no sólo esos representantes. Mechanism fixtures pueden estar fuera del cohort activo y se comprueban además por su endpoint individual.

Si Product set deriva → ROLLBACK. Si Specs set cambia → ROLLBACK. Si admission/counts difieren con exact bundle → STOP/investigar inconsistencia runtime/admission y rollback de activación, sin reclasificar para arreglar los totals. La igualdad de sets aquí no absuelve FAIL H.

## M. Rollback plan

Target existente, verificado y retenido: bundle 84c85d15…bac7b8, snapshot 28be0bca…7093a5; fuente productiva 2a5521b7…bb26 y código previo b19fe209…. No reconstruir artifacts durante incidente. Mantener ambos directorios y committed history; no pruning en la ventana.

Comandos existentes, alternativas según protocolo operativo; ejecutar sólo una:
~~~bash
npm run catalog:projection:activate -- --root=artifacts/catalog-v2 --bundle=sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8 --expected-active=sha256:2f51d0c80a75e331232537c4bf97ffe59c40aef3db4738daeb4b5bcf3d524329 --actor=operator --reason=p2.3c-rollback
npm run catalog:projection:rollback -- --root=artifacts/catalog-v2 --to=sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8 --expected-active=sha256:2f51d0c80a75e331232537c4bf97ffe59c40aef3db4738daeb4b5bcf3d524329 --actor=operator
~~~

| Trigger | Acción |
| --- | --- |
| Hash mismatch antes de activar | STOP; no se cambió puntero y no hay nada que revertir. |
| Authority NOT_READY después de activar | Reactivar previousBundle; verificar reload y salud previa. |
| Hot reload failure | Reactivar previousBundle si el puntero fue promovido; investigar, sin restart para esconder failure. |
| Semantic smoke mismatch | Reactivar previousBundle; comparar lineage y smokes baseline. |
| Product Discovery ID drift | Reactivar previousBundle; demostrar igualdad exacta del set previo. |
| Specs regression | Reactivar previousBundle; restaurar provenance/conflict set previo. |
| Commercial Truth regression | Reactivar previousBundle; verificar Commercial owner y salud, investigar causas de código/dependencias además del bundle. |
| Runtime error spike / proceso inestable | Detener rollout y reactivar previousBundle si es posible; aplicar procedimiento existente de rollback de código si el error persiste. |
| Pointer/loaded mismatch | Investigar control vs runtime; reactivar sólo si CAS coincide. Si cambió por otra operación, STOP y coordinación; no sobrescribirla a ciegas. |

Después del rollback: desired=loaded=84c85d15…, nueva activationId convergente, snapshot 28be0bca…, seis autoridades READY, Commercial PASS, Product/Specs sets previos, fixtures con facts históricos. No exigir que baseline defectos corregidos desaparezcan al volver al contenido anterior.

No hay --dry-run en activation CLI; no se ejecutó drill contra EC2. La existencia del target, gate candidate y committed history se verificaron mediante lectura. Un fallo previo a activar se resuelve conservando el puntero; no activar otro bundle para simular rollback. Para rollback de código conservar checkout/dist/dependencias anteriores en el mecanismo operativo acordado antes del deploy; no depender de recrearlos en medio del incidente.

## N. Persistence/restart plan

Sólo después de hot reload exitoso y todos los smokes: registrar pointer hash, bundleId, snapshotId, authority y resultados; realizar reinicio controlado según la práctica PM2 existente:
~~~bash
pm2 restart catalog-service --update-env
~~~
Repetir health, K/L/I y lectura del pointer. Deben persistir exactamente el mismo pointer, bundleId y snapshotId. loadedAt puede cambiar al reiniciar; activationId y lineage semántica no. El reinicio prueba persistencia y nunca repara una activación fallida.

Antes de ejecutar, inspeccionar si el dump PM2 existente y la política del operador requieren persistir el buildRef nuevo; el repo no versiona una definición PM2. Si el procedimiento normal lo requiere y health/smokes pasan, pm2 save. No se ejecutó pm2 save ni restart en esta review. Conservar el límite observado de 384 MiB; el runbook histórico documenta fallos con 250 MiB durante reload. Vigilar RSS/restarts durante la transición.

P2.3C CLOSED sólo después de evidencia productiva: exact approved bundle activo, todas las autoridades requeridas READY, semantic smokes PASS, Product exact-ID regression PASS, Specs regression PASS, Commercial PASS, restart persistence PASS y rollback target retenido. Ningún test local cierra producción.

## O. Final disposition

~~~text
DISPOSITION=BLOCKED
SAFE_TO_COMMIT=YES
SAFE_TO_DEPLOY_CODE_WITH_OLD_BUNDLE=YES
SAFE_TO_ACTIVATE_FIX2_BUNDLE=NO
P2.3C_PRODUCTION_CLOSED=NO
~~~

Causa: incompatibilidad del artifact aprobado con la exigencia de preservar byte-identical las proyecciones del baseline real. Cuatro wrappers protegidos difieren; Specs también difiere en ocho referencias de fuente. El runtime productivo anterior es incompatible con FIX2, pero esa incompatibilidad forward sí tiene solución de secuencia mediante C/J. El blocker restante es H, no un fallo de implementación ni una simple ausencia de acceso.

Completo en esta review: lectura real de EC2/PM2/health/pointer/source, rollback target verificado, backward READY sobre bundle productivo, forward INCOMPATIBLE sobre dist productivo, build aislado y reproducción exacta, comparación de proyecciones y exact ID sets, smokes comerciales/semánticos BEFORE, inventario de commit y comandos futuros.

Pendiente para desbloquear: decisión y revisión separadas del baseline de fuente/proyecciones protegidas; luego hash-identical replay Linux y todos los gates productivos antes/después. No se ha cambiado ninguna identidad aprobada para sortear el blocker.

Sin commit, push, deployment, EC2 filesystem mutation, activation, pointer mutation, PM2 restart/save, DB write ni trabajo P2.3D. Sin cambios a R4 prompts, Sales Agent, catalog.discover, Unified Retrieval API, quote service ni customer-profile.
