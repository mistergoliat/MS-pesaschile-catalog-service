# P2.3C — Final Production Rollout Review

Fecha: 2026-10-08, America/Santiago. Revisión READ-ONLY. Disposición: **REQUIRES_ROLLOUT_PREPARATION**.

El candidate definitivo es válido y conserva físicamente las cuatro proyecciones productivas protegidas. La producción fue reobservada sin drift. El commit necesario ya está en origin/main. El deployment de código puede prepararse y ejecutarse posteriormente bajo control; publicación/activación todavía requieren acreditar replay Linux exacto y los gates operacionales. P2.3C no está CLOSED.

## 1. Scope y autoridad

Leídos P2_3C_PRODUCTION_BASELINE_REBUILD.md, P2_3C_BUNDLE_BASELINE_RECONCILIATION.md y P2_3C_PRODUCTION_ROLLOUT_REVIEW.md. Se revisaron scripts reales de build/activation/rollback, sus validators/stores, startup y el runbook catalog-service-ec2-deployment.md.

Target único: `artifacts/catalog-v2/p2-3c-prb/candidate-1/bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f`. El candidate histórico 2f51d0… no es target ni rollback. Su evidencia histórica se utiliza únicamente como comparador FIX2 de conjuntos y deuda. No se ejecutó builder, compilación, instalación, publicación, activation/rollback ni restart en EC2. No se cambió código, candidate, fuente, pointer, datos ni artifacts protegidos. Sólo se generaron este informe y evidencia local ignorada bajo `artifacts/catalog-v2/p2-3c-final-review`.

## 2. Identidades extraídas de bytes reales

| Campo | Valor |
| --- | --- |
| bundleId completo | sha256:bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f |
| Training V2 snapshotId interno | sha256:10cd9a355399eee0d761baacde062d4d74d64aa4e5c326e1337be673795c90c6 |
| Training V2 projectionId | sha256:b315f13b1b63001ef5bfe4d4ff2b8f947748cede781b53cbc084c5fe2a009b77 |
| sourceExtractionId / canonicalInputHash | sha256:f505ea3f20740c6b5a64645a369d8c43953086ec7fa1aefd23daa2ccb98db4a9 |
| codeRef | sha256:3f678f0a9e5a83c101aa6a3b6b6cb312e80f4a46ff5fc912d397c306a2f5a7ac |
| policyHash | sha256:c258f5db606d48f6e62399c5ab3b551c8650309aa2e8d01ac23431adbc99fa03 |
| rulesHash | d143736268bff53900de4ceaa7b50b76061fcc73d0b6d44e2a4a645f5834b8a8 |
| manifest hash físico | sha256:6b5fc8aec02583c46f24e84921917ff1d878e83978459e0dc6b8fe5c243cf850 |
| commit revisado | 3c1e9c4a17469e9beac4c8cb242aac820635d817 |

| Archivo | SHA-256 físico | Comparación con producción reobservada |
| --- | --- | --- |
| productSemantics.json | sha256:1c665a75468dfb520133973c7371b0a9bc0597282586480c48d89144df22c465 | Byte-identical, hash idéntico al de EC2 |
| trainingSemantics.json | sha256:a53ddeb2ea2650dd2bf0fd4cdf8e74665f2c7b0a83538068426a941ea6ab3e45 | Byte-identical, hash idéntico al de EC2 |
| specs.json | sha256:f0a1d85409758fb652bb371f0400d12f9ac1c9c9ee4f3b9d05bc529323e8cee2 | Byte-identical, hash idéntico al de EC2 |
| trustMaps.json | sha256:3c7c2a7f35bec8ffe001e80ab09069e5d408176580c6583ec6886cd8807fc437 | Byte-identical, hash idéntico al de EC2 |
| trainingSemanticsV2.json | sha256:28f4b01fe50f9e9f61bee2e69e560b93e7f8211ec092ba2cbd8d6ecb1229e7db | FIX2 candidate nuevo |

Se recalcularon todos los hashes físicos; se verificó bundleId derivado, schema, validation-report PASS, validateBundle y validateBundleForPublication con fuente canónica. Se validaron snapshot, enlace V1 y training invariants con los hashes de evidencia recalculados desde source productivo. No se confunde snapshot interno con projectionId del wrapper.

La extracción física verificada es 2a5521b77e5b26e2d56104ab2ad29d85aaff82c2f06d522d7aa141f1e062bb26, sourceExtractionId sha256:f505ea3f20740c6b5a64645a369d8c43953086ec7fa1aefd23daa2ccb98db4a9. La copia local íntegra y los archivos todavía presentes en EC2 tienen hashes idénticos: canonical_input, compatibilityCsv, categoryTrustMap, featureTrustMap y manifest. Product Semantics, V1, Specs y Trust del candidate se compararon byte a byte con la copia productiva aprobada, cuyo manifest y cinco hashes se cotejaron con EC2 en esta revisión. Resultado: ninguna diferencia en los cuatro artifacts protegidos, incluidos normalized/raw values, estados, referencias y provenance. Specs conserva los ocho featureValueId productivos y 3163 records; Trust mantiene mapas y autoridad.

Training V2 conserva las correcciones FIX2: mismas assignments/relaciones/estados/advertencias y deuda aprobada; la identidad/source evidence corresponde a la fuente productiva. Los 124 deltas de evidencia documentados por PRB son únicamente sourceId. Las mejoras A→FIX2 son 156 semánticas y 1093 de evidencia; P899/P1365 son DIRECT desde FIX2 original, preservados; el 154/1095 histórico los había clasificado como evidencia solamente. P1354 mantiene warning y deuda, sin nueva negativa demostrada.

## 3. Producción reobservada

SSH ec2-user@98.80.166.131, StrictHostKeyChecking=yes y BatchMode=yes. El programa de lectura se transmitió por stdin a Node: no se creó un archivo remoto. Sólo lecturas fs/git/PM2, validators y GET HTTP. Git se leyó con GIT_OPTIONAL_LOCKS=0; no se imprimieron API keys, variables privadas ni contenido del backup .env.

Ventana registrada: 2026-10-08T17:01:38.185Z → 2026-10-08T17:01:39.737Z (08-10-26, 2:01:38 p. m., America/Santiago al inicio).

| Campo | Observado |
| --- | --- |
| Checkout | /home/ec2-user/services/MS-pesaschile-catalog-service |
| Git HEAD / branch | b19fe209f34cb9ba0d9b5e1e946ec7296e7b64b0 / main |
| Tracked status | clean |
| PM2 | catalog-service / id 2 / online |
| PID / restart_time | 1367662 / 14 |
| BuildRef | catalog-service@b19fe209f34cb9ba0d9b5e1e946ec7296e7b64b0 |
| Node | v22.23.1 |
| active bundle | sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8 |
| Training V2 snapshot activo | sha256:28be0bca348b2ba915fac8597919657e18438fa9053443ebf8ff6042197093a5 |
| Training V2 projectionId activo | sha256:9693461e90b52dc3079ccc297d2627213b45956a819d76e8d556594f26f2531f |
| activationId | 803d3b3b-86a1-49df-86e2-4fdca79a5e30 |
| pointer hash físico | sha256:5e65b8c8346e5d1fd802a8120be04e58f29e4bb93428c5c577e9bb5bf9669b21 |
| manifest productivo físico | sha256:c1605f9e311fe0ee79164d1c849a93dd1f64e3a5eca172098d4d4015667bd8b6 |
| PM2 max_memory_restart | 402653184 bytes (384 MiB) |
| RSS observado | 236126208 bytes |

Sin drift frente al baseline registrado anteriormente: bundle, snapshot, projectionId, activationId, pointer físico, manifest, Git HEAD, PID y restart_time coinciden. desired=loaded=sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8, activationId exacto, reloadState=READY y lastReloadError=null. El pointer permaneció byte-identical entre inicio y fin; PM2 no reinició.

Untracked remoto, sin leer ni modificar sus contenidos:

```text
.env.bak-r4j1-20260930T184230Z
docs/audits/product-semantic-coverage/family_discipline_matrix.csv
docs/audits/product-semantic-coverage/family_use_context_matrix.csv
docs/audits/product-semantic-coverage/semantic-coverage-report.json
docs/audits/product-semantic-coverage/semantic_coverage_by_family.csv
docs/audits/product-semantic-coverage/semantic_review_sample.csv
docs/audits/product-semantic-coverage/semantic_tag_utilization.csv
```

/health/live, /health/ready, /health/catalog-authority y /health/projections: HTTP 200, JSON revisado. Database/Redis/relationshipSnapshot OK; Commercial Truth OK y commercialV2 READY; Product/V1/V2/Specs/Trust/projection runtime READY; Product legacyFallbackReads=0. Relationships/capabilities CAT-V2 siguen UNAVAILABLE por contrato; relationship recommendation legacy READY. HTTP 200 por sí solo no es el gate.

Rollback target para el rollout nuevo: sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8, el bundle actual completo; no es 1ec2e010… indicado como previous del pointer actual. ActivationService.candidate remoto real: PASS; cuatro transiciones de committed history, con target presente; hashes físicos y manifest verificados. El runtime nuevo también lo carga READY. No se hizo rollback drill ni se cambió el pointer. Antes de deploy deben congelarse también código/dist/dependencias para que la preparación del rollback de código esté completa.

## 4. Commercial Truth y baseline semántico HTTP

GET /v2/catalog/products/P{id}/context?quantity=1 y /v2/catalog/items/P{id}/context?quantity=1 para P1543/P1856/P1124: seis respuestas 200/found. Se revisaron pricing, promoción, tax, stock, sellability, engineVersion, freshness y provenance. API key sólo en memoria del proceso de lectura; no en stdout ni archivos.

| Item | regularGross CLP | finalGross CLP | percentOff | stock | sellability | reason | engineVersion | asOf |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1543 | 414990 | 331992 | 0.2 | 26 | sellable | in_stock | catalog-commercial-v2.2.0 | 2026-10-08T17:01:39.412Z |
| P1856 | 228990 | 228990 | null | 0 | not_sellable | out_of_stock | catalog-commercial-v2.2.0 | 2026-10-08T17:01:39.449Z |
| P1124 | 152990 | 152990 | null | 0 | not_sellable | out_of_stock | catalog-commercial-v2.2.0 | 2026-10-08T17:01:39.499Z |

Tax incluido, rate 0.19; freshness y serviceBuildRef presentes. Stock actual P1543=26 difiere legítimamente de los 27 observados el día anterior: no es drift del bundle semántico. Los otros productos pueden no ser sellables por stock; ello no invalida semántica ni readiness. No congelar precios, stock o timestamps para el rollout: comparar contra la autoridad comercial en la misma ventana.

También se registraron doce GET /v1/products/{id}/training-semantics del runtime productivo antiguo, sólo como baseline BEFORE, en production-read.json/semanticBefore. Los resultados FIX2 de la sección 6 corresponden a los bytes del candidate offline, no a una activación productiva ficticia.

## 5. Código y compatibilidad

Commit local 3c1e9c4a17469e9beac4c8cb242aac820635d817, branch main, contiene todos los archivos TypeScript y package-lock que producen codeRef sha256:3f678f0a9e5a83c101aa6a3b6b6cb312e80f4a46ff5fc912d397c306a2f5a7ac. Se recalcularon sus hashes, se comprobó que todos están tracked y que src/scripts/package.json/package-lock no tienen diff respecto a HEAD. git ls-remote confirmó origin/main=3c1e9c4a17469e9beac4c8cb242aac820635d817; no hace falta nuevo commit/push para desplegar esa implementación. Los informes PRB y su auditor siguen untracked; no forman parte del runtime. No se incluyó ningún artifact ignorado en Git.

| Combinación | Resultado | Prueba |
| --- | --- | --- |
| Código nuevo + bundle antiguo | READY | RuntimeProjectionManager.reconcile y ActivationService.candidate reales; artifacts productivos verificados con EC2 |
| Código nuevo + candidate definitivo | READY | Mismo loader real, bytes de bddf7f36…, publication/invariants PASS |
| Runtime productivo antiguo + candidate definitivo | NO / INCOMPATIBLE | INVALID_PROJECTION_SCHEMA; schema resolución extendido |
| Deployment de código modifica active.json o reconstruye snapshots | NO por ruta de ejecución | package build=tsc; sin prebuild/postbuild; server/createRuntime arrancan lectores y polling, sin activate/promote/builders |

La incompatibilidad forward se ensayó con dist descargado del runtime productivo. En esta revisión se verificaron 435 archivos .js físicos contra el dist actual de EC2: todos idénticos. Error esperado: inputs.resolutionPolicy contiene claves version/builderVersion/previousPolicy desconocidas para ese runtime. No se requiere forward compatibility, pero sí deploy/restart del runtime compatible y old bundle READY antes de publicación/activación.

Las pruebas de loader usan un store de lectura que entrega artifacts físicos y prohíbe promote; no inyectan un loader de construcción simulado ni crean active.json. No se realizó deployment para demostrar efectos productivos: el gate operativo sigue siendo pointer/fingerprints idénticos después de npm ci/build/restart futuro. npm test tiene pretest que reconstruye snapshots: queda expresamente fuera del deploy y de esta revisión.

## 6. Gates del candidate definitivo: conjuntos, hashes y fixtures

Se reevaluó admission sobre 2048 productos desde los bytes actuales, con semantic-obligations-v2, fuente productiva, maps y lineage verificados. Se compararon arrays completos ordenados con los conjuntos PRB y FIX2 aprobados. Hash = SHA-256 del JSON canónico del array de IDs numéricos ordenados.

| Conjunto | Count | Hash exacto | Comparación |
| --- | --- | --- | --- |
| canonical | 2048 | sha256:b3f0df7fed594ca5ef9478047a4a17d5fac51d07648a912f331794a248f206b1 | Arrays exactos iguales, PASS |
| current | 1565 | sha256:55f1a726ec700886d1fbac380d430d44d281aa6202cfcaac2fa42c2290ee43e3 | Arrays exactos iguales, PASS |
| historical | 483 | sha256:2055acdecb86c360405ca9fb8820d79bf4427ca9aed644f34ee88815a8841562 | Arrays exactos iguales, PASS |
| active | 886 | sha256:72b830c5d4c27bd9ade88e320dd2f0a342d6f96283530d03b76682db1d18dcfa | Arrays exactos iguales, PASS |
| productDiscovery | 791 | sha256:7d5d07a3ba600c823df31fa244859fa00b668a153c5a09b12b873e479e4568b7 | Arrays exactos iguales, PASS |
| specsConflict | 82 | sha256:1d9bba9a2933ebe256a02c3803085f4b42e0085ffca6bb135c5cc34ecbd3d408 | Arrays exactos iguales, PASS |
| exerciseDiscovery | 100 | sha256:3056e67908bffb4496bf5037b63f29f0fb777b2663a1fcb2033d1d47e3158bac | Arrays exactos iguales, PASS |
| functionDiscovery | 71 | sha256:a96de64ee5b2a735cd1b85cd7deb1bc22d1f48192c8c2b8d6d4813334a50b501 | Arrays exactos iguales, PASS |
| unifiedAdmitted | 95 | sha256:b3bdb9d1be48fa65a179c58114058683a80b1462a1b60a907288576a1e00c8e3 | Arrays exactos iguales, PASS |

Los 82 IDs son productos con conflictos de fuente Specs en ALL, no todos los conflictos de consolidation. Las métricas Discovery y Unified de esta tabla son ACTIVE. No se aprobaron sólo sus cantidades.

| Fixture | Resolution state | Facts/relaciones del candidate |
| --- | --- | --- |
| P1020 | VERIFIED_NO_APPLICABLE_CAPABILITY | [] |
| P1856 | SEMANTIC_COMPLETE | BODYWEIGHT_SUPPORT/DIRECT, DIP/DIRECT, PULL_UP/DIRECT |
| P247 | DATA_GAP | [] |
| P897 | DATA_GAP | [] |
| P1624 | DATA_GAP | [] |
| P1124 | SEMANTIC_COMPLETE | CABLE_RESISTANCE/DIRECT |
| P1812 | SEMANTIC_COMPLETE | CABLE_RESISTANCE/DIRECT |
| P1999 | SEMANTIC_COMPLETE | CABLE_RESISTANCE/DIRECT |
| P2008 | SEMANTIC_COMPLETE | CABLE_RESISTANCE/DIRECT |
| P1543 | SEMANTIC_COMPLETE | BARBELL_SUPPORT/DIRECT, DIP/SUPPORTED, PULL_UP/SUPPORTED |
| P435 | AMBIGUOUS | [] |
| P930 | DATA_GAP | [] |

P1020 carece de CABLE_RESISTANCE. P1856 carece de BARBELL_SUPPORT y conserva sus tres facts corporales. P247/P897/P1624/P930 permanecen DATA_GAP sin positiva inventada; P435 AMBIGUOUS. P1124/P1812/P1999/P2008 son mecanismos reales DIRECT. P1543 conserva soporte de barra propio.

Cero negativos con assignments. Negativas modeladas PRESENT=874; deuda ABSENT=50; NOT_RECONSTRUCTABLE=0. Se verificaron records completos contra PRB y source-bound invariants; no se convirtió incertidumbre en negativa certificada. Hash exacto IDs ABSENT: sha256:ffcc1f5482ffaad4b234b042864f81f64acebe33403488f49efc1c799d454594. P1354 sigue con warning residual y deuda.

Suite completa 2680/2680, focalizados 190/190, typecheck/lint PASS son evidencia PRB del mismo contenido TypeScript, comprobado intacto; no se repitieron tests/bootstraps que puedan escribir artifacts en una revisión READ-ONLY. Esta revisión añadió validación directa de los bytes actuales, conjuntos y fixtures, además del loader real. local-validation.json contiene todas las evaluaciones resumidas, arrays y fingerprints; PRB conserva las evaluaciones completas. Los 385 fingerprints históricos continúan iguales.

## 7. Linux replay: gate pendiente y riesgo concreto de identidad

**LINUX_REPLAY_VERIFIED=NO.** No se ejecutaron builds ni publicaciones en EC2, ni se realizó replay Linux offline. Docker CLI existe pero Docker Desktop Linux Engine no está accesible (pipe inexistente); WSL lista sólo docker-desktop. No se inició un daemon/distro para convertir una review READ-ONLY en preparación del entorno. Los dos builds Windows acreditan únicamente reproducción local bajo su recipe.

El candidate PRB usa codeRef FIX2 sha256:3f678f0a9e5a83c101aa6a3b6b6cb312e80f4a46ff5fc912d397c306a2f5a7ac, reproducible desde el inventario real TypeScript ordenado y package-lock agregado al final. El builder nativo por defecto agrega package-lock antes de ordenar todo el array, y normaliza separadores después de ordenar. Sobre los mismos hashes de contenido, calculando en memoria su orden Linux de rutas '/', produce sha256:cf55174c4e6ac097497d2852191dfbc6a1032fc0541688a45279eaf4f98f2fb0; esto es análisis del algoritmo, no replay Linux ni nuevo artifact. El hash nativo Windows fue c2692b26…. El candidate PRB se construyó usando el parámetro contractual --code-ref con la identidad FIX2 comprobada.

Por ello no es correcto prometer que invocar el builder por defecto en Linux reproduzca automáticamente bddf7f36…. Tampoco pasar el literal del hash deseado sólo para forzar coincidencia. Hace falta una recipe Linux acreditada que derive y verifique la identidad de código por el contrato aprobado desde bytes reales, incluya previousPolicy realmente consumida (4788d5e8…, diferente de la declaración productiva histórica 1514a58f…), y demuestre dos replay independientes con bundleId/snapshot/projection/hash exactos. No se cambió codeRef, archivo de policy ni manifest durante esta revisión.

Preparación pendiente, fuera de esta review: entorno Linux aislado, checkout exacto 3c1e9c4a17469e9beac4c8cb242aac820635d817, fuente frozen íntegra 2a5521b7…, maps y policy aprobadas, dependencias package-lock; ejecutar scripts reales de construcción/publicación en directorios aislados, cotejar outputs con el candidate, validators y loader. Las diferencias de builtAt/timings sólo se aceptan donde el contrato las excluye de identidad y deben registrarse. Si cualquier hash de proyección/bundle difiere o la recipe necesita cambiar código/contrato/identidad: STOP, revisión dirigida y nueva autorización; no parchear manifests ni inyectar hashes esperados. Este gate debe cerrarse antes de publicación/activación del nuevo bundle.

## 8. Plan operacional exacto — NO EJECUTADO

Variables para una fase de ejecución autorizada, shell Bash con stop-on-error:

```bash
set -euo pipefail
cd /home/ec2-user/services/MS-pesaschile-catalog-service
REVIEWED_COMMIT=3c1e9c4a17469e9beac4c8cb242aac820635d817
OLD_COMMIT=b19fe209f34cb9ba0d9b5e1e946ec7296e7b64b0
OLD_BUNDLE=sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8
NEW_BUNDLE=sha256:bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f
EXPECTED_BASELINE_ACTIVATION=803d3b3b-86a1-49df-86e2-4fdca79a5e30
CONTROL_ROOT=artifacts/catalog-v2
# FREEZE_DIR: directorio seguro externo al checkout, definido por el operador.
# FROZEN_SOURCE: directorio productivo 2a5521b7… verificado; nunca reextraer.
# STAGING_ROOT: directorio aislado; no sustituye CONTROL_ROOT.
# CATALOG_SMOKE_API_KEY: inyectada de forma privada; nunca imprimir.
```

1. **Freeze baseline y rollback.** Releer HEAD/branch/PM2/pointer/history/health/Commercial Truth. Exigir exactamente OLD_BUNDLE, activationId anterior y pointer hash sha256:5e65b8c8346e5d1fd802a8120be04e58f29e4bb93428c5c577e9bb5bf9669b21, o STOP/review de drift. Conservar el bundle antiguo completo y manifest/report, fuente frozen, committed history, pointer como evidencia, commit/dist/dependencias ejecutables y configuración PM2. Guardar backups bajo FREEZE_DIR con espacio suficiente; no limpiar untracked remotos ni usar el backup .env ajeno. Registrar fingerprints de todos los artifacts/pointers protegidos antes del deploy. El pointer archivado se conserva como evidencia, no se restaura por copia manual.

```bash
git rev-parse HEAD
git branch --show-current
GIT_OPTIONAL_LOCKS=0 git status --porcelain
pm2 status catalog-service
sha256sum "$CONTROL_ROOT/control/active.json"
node dist/scripts/catalog-v2/projection-activation.js status --root="$CONTROL_ROOT" --bundle="$OLD_BUNDLE"
mkdir -p "$FREEZE_DIR"
cp -a "$CONTROL_ROOT/bundles/${OLD_BUNDLE#sha256:}" "$FREEZE_DIR/"
cp -a "$CONTROL_ROOT/control" "$FREEZE_DIR/control-before"
git archive "$OLD_COMMIT" > "$FREEZE_DIR/code-before.tar"
tar -czf "$FREEZE_DIR/runtime-before.tar.gz" dist node_modules package.json package-lock.json
find artifacts data -type f -print0 | sort -z | xargs -0 sha256sum > "$FREEZE_DIR/protected-before.sha256"
```

STOP: baseline drift, dirty tracked code, inválido rollback/history, health/commercial no READY, backup incompleto, espacio insuficiente o configuración PM2 no preservada. Rollback en esta fase: no se mutó autoridad; conservar baseline.

2. **Push/deploy del commit aprobado.** origin/main ya contiene REVIEWED_COMMIT según lectura remota Git; no crear nuevo commit/push. Comprobar nuevamente ref y avanzar EC2 sólo fast-forward a ese SHA, sin instalar cambios adicionales ni resolver conflictos con reset/clean.

```bash
git fetch origin
git cat-file -e "$REVIEWED_COMMIT^{commit}"
git merge --ff-only "$REVIEWED_COMMIT"
test "$(git rev-parse HEAD)" = "$REVIEWED_COMMIT"
```

STOP: branch/ref diferente, avance no FF, cualquier cambio fuera del commit revisado. Rollback: si todavía corre proceso antiguo, conservarlo y volver al checkout preservado con procedimiento aprobado; no activar nada para reparar código.

3. **npm ci y build del runtime.** Sólo dependencias/runtime; no npm test, pretest, bootstrap, extracción ni builders de snapshot. Baseline semántico permanece sin cambios.

```bash
npm ci
npm run build
sha256sum --check "$FREEZE_DIR/protected-before.sha256"
```

STOP: install/build falla o cualquier fingerprint protegido difiere. Rollback: restaurar checkout/dist/dependencias congelados; el proceso antiguo no debe reiniciarse con un build incompleto.

4. **Restart para cargar código nuevo.** Mantener límite PM2 384 MiB y configuración existente. Persistir buildRef en el entorno del proceso.

```bash
export CATALOG_SERVICE_BUILD_REF="catalog-service@$(git rev-parse HEAD)"
pm2 restart catalog-service --update-env
```

STOP: PM2 no online, buildRef incorrecto, RSS/restarts inesperados, boot/readiness falla. Rollback: pointer sigue OLD_BUNDLE; restaurar runtime antiguo y buildRef OLD_COMMIT y reiniciar según mecanismo congelado. No publicar/activar para ocultar fallo de código.

5. **Confirmar old bundle READY.** Leer health, authority, projections, control status y fingerprints; exigir código nuevo, pero desired=loaded OLD_BUNDLE y activationId exacto, Training snapshot 28be0bca…, lastReloadError=null, cinco proyecciones/commercial READY, fallback reads sin incremento. Repetir los seis contextos comerciales y smoke runtime.

```bash
curl --fail --silent --show-error http://127.0.0.1:4010/health/ready
curl --fail --silent --show-error http://127.0.0.1:4010/health/catalog-authority
curl --fail --silent --show-error http://127.0.0.1:4010/health/projections
npm run catalog:projection:status -- --root="$CONTROL_ROOT" --bundle="$OLD_BUNDLE"
sha256sum --check "$FREEZE_DIR/protected-before.sha256"
npm run smoke -- --base-url=http://127.0.0.1:4010 --api-key="$CATALOG_SMOKE_API_KEY" --query=barra
```

STOP: algún estado/identidad no coincide aunque HTTP=200, fallback aumenta, pricing/stock/sellability/freshness inexplicables. Rollback: restaurar sólo código/runtime antiguo, con bundle viejo intacto.

6. **Replay/verificación y publicación inmutable.** Esta fase está PENDIENTE y no debe ejecutarse hasta cerrar sección 7. El repositorio publica mediante catalog:bundle:build, no tiene un comando publish/import independiente. Primero recipe Linux aprobada, inputs/code verificables, output aislado y dos replay exactos. La invocación nativa de referencia es:

```bash
npm run catalog:bundle:build -- --source-dir="$FROZEN_SOURCE" --output-dir="$STAGING_ROOT"
```

Ese comando por defecto NO queda aprobado como recipe exacta de bddf7f36… mientras persista la diferencia de cálculo codeRef descrita. No agregar --code-ref=hash-deseado para hacer pasar el gate. Una recipe legítima derivada del contenido, revisada y probada en Linux, debe acreditarse antes de cambiar output-dir al destino productivo:

```bash
# Sólo después del gate Linux y revisión de la recipe, con sus inputs reales.
npm run catalog:bundle:build -- --source-dir="$FROZEN_SOURCE" --output-dir="$CONTROL_ROOT/bundles"
npm run catalog:projection:status -- --root="$CONTROL_ROOT" --bundle="$NEW_BUNDLE"
```

Exigir bundleId/snapshot/projection/hashes exactos y el conjunto completo de siete archivos manifest/proyecciones/report PASS. El builder publica mediante staging+rename y detecta colisiones; no sustituir artifacts manualmente. Si una recipe aprobada produce builtAt distinto, comparar identidad contractual, cinco hashes y diff exacto manifest; registrar/revisar el manifest físico publicado antes del CAS. No reemplazar silenciosamente el manifest reviewed.

STOP: Linux no acreditado, identidad distinta, lineage/policy/provenance inválida, protección incumplida, candidate validation falla o immutable conflict. Rollback: no se activó; OLD_BUNDLE sigue cargado. Conservar evidencia de lo publicado, sin borrar ni editar artifacts inmutables.

7. **Activar con CAS y expected-active exacto.** Releer baseline completo inmediatamente antes, incluido activationId y hash del pointer de freeze. Sólo con gates anteriores PASS y autorización de ejecución posterior:

```bash
npm run catalog:projection:activate -- --root="$CONTROL_ROOT" --bundle="$NEW_BUNDLE" --expected-active="$OLD_BUNDLE" --actor=controlled-rollout-operator --reason=p2.3c-production-baseline-fix2-rollout
```

CLI comprueba expectedActiveBundleId y el store hace CAS sobre activationId observado bajo lock antes de durable history/pointer rename. No existe --expected-activation en este CLI: no inventarlo. Revisar history nuevo, previous=OLD_BUNDLE, manifest físico correcto y nuevo activationId. STOP ante cualquier drift/CAS conflict; no reintentar relajando expected-active.

8. **Hot reload, lineage y fixtures HTTP.** Sin reiniciar para ocultar reload fallido. Exigir desired=loaded NEW_BUNDLE, nuevo activationId, snapshot sha256:10cd9a355399eee0d761baacde062d4d74d64aa4e5c326e1337be673795c90c6, projection sha256:b315f13b1b63001ef5bfe4d4ff2b8f947748cede781b53cbc084c5fe2a009b77, buildRef REVIEWED_COMMIT, lastReloadError=null y cinco proyecciones READY. Comprobar provenance/sourceExtractionId, los doce fixtures y Discovery. Para lectura de fixtures:

```bash
for id in 1020 1856 247 897 1624 1124 1812 1999 2008 1543 435 930; do
  curl --fail --silent --show-error -H "x-api-key: $CATALOG_SMOKE_API_KEY" "http://127.0.0.1:4010/v1/products/$id/training-semantics"
done
```

Comparar facts/state contra tabla 6, no sólo HTTP. Query/Discovery se verifican con paginación/batches sin truncamiento; comparar conjuntos exactos de sección 6 y sus hashes, usando current/active de fuente frozen y código del contrato semántico, sin tratar todo resultado bruto de Query como admitted activo. STOP/rollback bundle ante reload FAILED, mismatch de autoridad/lineage/fixtures/sets, pérdida de incertidumbre o regresión protegida.

9. **Smokes Commercial Truth.** Repetir /health/ready, authority commercialV2, smoke real y los seis endpoints de contexto, quantity=1. Comprobar pricing/tax/engineVersion/promoción/stock/sellability/freshness/provenance, contrastando cambios con fuente comercial actual. No exigir precios/stock iguales al día anterior. Si existe variantOptions real, agregar el itemKey real, no inventado.

```bash
npm run smoke -- --base-url=http://127.0.0.1:4010 --api-key="$CATALOG_SMOKE_API_KEY" --query=barra
for id in 1543 1856 1124; do
  curl --fail --silent --show-error -H "x-api-key: $CATALOG_SMOKE_API_KEY" "http://127.0.0.1:4010/v2/catalog/products/P$id/context?quantity=1"
  curl --fail --silent --show-error -H "x-api-key: $CATALOG_SMOKE_API_KEY" "http://127.0.0.1:4010/v2/catalog/items/P$id/context?quantity=1"
done
```

STOP/rollback bundle ante regresión comercial atribuible a transición o falta de freshness; no cambiar reglas/precios/datos para pasar smoke.

10. **Persistencia tras restart controlado.** Sólo después de hot reload/semantic/Commercial PASS, registrar pointer hash, identity y nuevo activationId, hacer un restart controlado y exigir mismos pointer/bundle/snapshot/activationId tras boot, readiness/fixtures/Commercial de nuevo PASS. Vigilar memoria/restarts. Si el procedimiento PM2 vigente requiere persistir entorno, hacerlo sólo tras verificar salud y con política operacional del operador; el repo no tiene definición PM2 versionada.

```bash
sha256sum "$CONTROL_ROOT/control/active.json"
pm2 restart catalog-service --update-env
curl --fail --silent --show-error http://127.0.0.1:4010/health/ready
curl --fail --silent --show-error http://127.0.0.1:4010/health/catalog-authority
curl --fail --silent --show-error http://127.0.0.1:4010/health/projections
```

STOP/rollback bundle si después del boot hay fallback, identidad distinta, health/commercial no READY, fixtures inválidos o restart loop. Un reinicio exitoso sin semantic/Commercial smoke no demuestra persistencia.

11. **Conservar rollback/evidencia y cierre.** Mantener OLD_BUNDLE completo, OLD_COMMIT, runtime/dependencias previos, fuente frozen, manifests/hashes, history/CAS receipt, health y smokes BEFORE/AFTER/restart, conjuntos, recipe Linux y logs. Sólo entonces reevaluar P2_3C_PRODUCTION_CLOSED; no iniciar P2.3D/QA1 en este procedimiento de revisión.

## 9. Rollback exacto y orden obligatorio

Si falla una fase posterior a activation y el target active sigue siendo NEW_BUNDLE, ejecutar rollback semántico con runtime nuevo:

```bash
npm run catalog:projection:rollback -- --root="$CONTROL_ROOT" --to="$OLD_BUNDLE" --expected-active="$NEW_BUNDLE" --actor=controlled-rollout-operator
```

Exigir desired=loaded OLD_BUNDLE, snapshot 28be0bca…, nueva activationId de rollback, history consistente y readiness/fixtures BEFORE/commercial PASS. Si otro actor cambió active, STOP y volver a evaluar; no pisarlo. No copiar el pointer congelado encima de active.json ni editar histories.

Sólo después de restaurar OLD_BUNDLE, si hace falta rollback de código, restaurar checkout/dist/dependencias preservados a OLD_COMMIT, CATALOG_SERVICE_BUILD_REF=`catalog-service@b19fe209f34cb9ba0d9b5e1e946ec7296e7b64b0`, y reiniciar de forma controlada. El runtime antiguo no puede leer NEW_BUNDLE: revertir código primero rompería compatibilidad. Un rollback previo a activation no necesita modificar pointer ni activar otro bundle. No se acreditó un drill mutante en esta review; disponibilidad/integridad del target sí fue demostrada mediante lectura.

## 10. Decisiones independientes y cierre

| Decisión | Resultado |
| --- | --- |
| SAFE_TO_DEPLOY_CODE | YES — controlled deploy, after baseline/code rollback freeze |
| SAFE_TO_PUBLISH_NEW_BUNDLE | PENDING — exact Linux replay / codeRef build recipe not accredited |
| SAFE_TO_ACTIVATE_NEW_BUNDLE | NO — pending Linux replay, compatible runtime deployment, publication and live gates |
| ROLLBACK_READY | YES_FOR_BUNDLE — code/dist/dependency freeze still required before deployment |
| LINUX_REPLAY_VERIFIED | NO — gate pending; no Linux build performed |
| P2_3C_PRODUCTION_CLOSED | NO — no production activation or persistence evidence |

**REQUIRES_ROLLOUT_PREPARATION**.

Pendiente concreto: acreditar recipe/replay Linux exacto sin manipular codeRef; congelar rollback de código antes de deploy; ejecutar posteriormente runtime deploy con old bundle READY, publicación verificada, CAS/hot reload, semantic/Commercial smoke y persistencia productiva. El bloqueo original de proyecciones protegidas ya está resuelto con el candidate nuevo; no hay drift activo ni regresión candidata observada. La preparación Linux no se transforma en PASS por builds Windows.

No hay evidencia de activación productiva de bddf7f36…, de health AFTER, semantic smoke AFTER, Commercial Truth AFTER ni persistencia AFTER: **P2.3C permanece abierto**. Sin commit/push/deploy/pull/build en EC2, publicación/activación, pointer mutation, PM2 restart/save, cambio de datos, P2.3D ni QA1 durante esta revisión.

Evidencias locales: production-read.json, local-validation.json y review-decisions.json en artifacts/catalog-v2/p2-3c-final-review; scripts de lectura/inspección sólo en ese directorio ignorado. Este informe es la única nueva salida versionable de la revisión final. Fingerprints del candidate definitivo y 385 archivos históricos verificados antes/después.
