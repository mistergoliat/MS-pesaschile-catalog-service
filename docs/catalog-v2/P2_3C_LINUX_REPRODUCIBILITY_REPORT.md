# P2.3C-LR — Linux Reproducibility & Code Identity

Fecha: 2026-10-08, America/Santiago. Disposición: **READY_FOR_CONTROLLED_ROLLOUT**, exclusivamente para el candidate aprobado y el procedimiento con entradas físicas congeladas acreditado aquí. Esta fase no autoriza ni ejecuta deployment, publicación productiva o activation. P2.3C continúa abierto.

Se ejecutaron **dos builds Linux reales e independientes** con el commit aprobado. Ambos reprodujeron exactamente bundleId, snapshotId, projectionId y los bytes de las cinco proyecciones. No se modificaron código TypeScript, FIX2, manifests existentes, fuente productiva ni artifacts protegidos. La receta explícita de identidad funciona en Windows y Linux sobre los mismos bytes; **el fallback nativo del builder sigue teniendo un bug de canonicalización**. Un checkout Linux LF obtenido sólo del SHA Git no equivale al paquete físico aprobado.

Documentación leída: [Final Production Rollout Review](P2_3C_FINAL_PRODUCTION_ROLLOUT_REVIEW.md), [Production Baseline Rebuild](P2_3C_PRODUCTION_BASELINE_REBUILD.md) y [Bundle Baseline Reconciliation](P2_3C_BUNDLE_BASELINE_RECONCILIATION.md). Target único: bddf7f… bajo p2-3c-prb/candidate-1. El candidate histórico 2f51d0… no se construyó ni se utilizó como target.

## A. Diagnóstico exacto del codeRef

Inventario real: **310 archivos .ts**, recursivamente bajo src/ y scripts/, más package-lock.json: **311 entradas**. El inventario completo ordenado y sus hashes físicos están en [code-identity.json del replay 1](../../artifacts/catalog-v2/p2-3c-lr/replay-1/code-identity.json); el replay 2 y el cálculo Windows actual coinciden en las 311 parejas, no sólo en su hash final.

Definiciones: H(x) = SHA-256 de los bytes UTF-8 de x, con prefijo sha256:. Para un archivo se usan sus bytes físicos. J es JSON compacto de un array de parejas [ruta relativa normalizada, hash del contenido]; en este dominio de arrays y strings, JSON.stringify y canonicalJson producen los mismos bytes. TS contiene todos los .ts de src/scripts. L es package-lock.json. O/ ordena ordinalmente las rutas con '/'; O\ ordena ordinalmente las claves virtuales obtenidas sustituyendo '/' por '\'. Las rutas SERIALIZADAS siempre contienen '/'. Orden ordinal JavaScript: comparación de unidades UTF-16, sin localeCompare.

`FIX2 = H(J(parejas(O\(TS)) concatenadas con pareja(L)))`

`Linux nativo = H(J(parejas(O/(TS unión {L}))))`

`Windows nativo = H(J(parejas(O\(TS unión {L}))))`

| Algoritmo sobre el mismo perfil físico aprobado | Resultado calculado |
| --- | --- |
| approvedRecipe | sha256:3f678f0a9e5a83c101aa6a3b6b6cb312e80f4a46ff5fc912d397c306a2f5a7ac |
| nativeLinux | sha256:cf55174c4e6ac097497d2852191dfbc6a1032fc0541688a45279eaf4f98f2fb0 |
| nativeWindows | sha256:c2692b26ebf2c98d48b12a0ccc54238767964131907c10c8720a10ebec9f474c |

El auditor histórico [training-targeted-closure-audit.mjs](../../cross-projection-audit/training-targeted-closure-audit.mjs) ordena los .ts antes de añadir L; training-reconciliation-audit.mjs y training-rule-precision-audit.mjs repiten esa convención. El [builder nativo](../../scripts/catalog-v2/build-projection-bundle.ts) añade L antes del sort y normaliza los separadores DESPUÉS de ordenar. Ambas decisiones son observables en el commit revisado; la receta no inventa un orden en función de un hash esperado.

Dos diferencias independientes: (1) L va al final en FIX2 y al principio en ambos fallbacks; (2) slash y backslash alteran el orden de **32 posiciones** entre los fallbacks, aun manteniendo idénticas las rutas serializadas y los hashes de cada archivo. Primera diferencia, índice 50: Linux src/application/catalog/explore-products/contracts.ts; Windows src/application/catalogService.ts. '/' tiene valor 47, 'S' 83 y '\' 92: se invierte el orden entre catalog/... y catalogService.ts. [diagnosis.json](../../artifacts/catalog-v2/p2-3c-lr/diagnosis.json) registra los primeros 16 cambios y los tres cálculos completos.

El replay 1 además ejecutó el builder REAL sin --code-ref en Linux. Obtuvo sha256:cf55174c4e6ac097497d2852191dfbc6a1032fc0541688a45279eaf4f98f2fb0, bundle sha256:24699dd67c31489e85c1ccf5fb979c16a03b7d90de2a761bd7d907d4208e6c78, projection sha256:2c4571cffe6fe78f47d1ee969a99ba12bace1b5b8ba32695365fa20813847333; el snapshot interno completo fue idéntico al aprobado. Está bajo replay-1/native-default y es diagnóstico, nunca target de publicación.

**Tercera dimensión: EOL.** core.autocrlf=true; no hay .gitattributes que fije el perfil. Los blobs Git son LF y el checkout aprobado mezcla LF/CRLF. **281/311 entradas de codeRef** difieren físicamente de sus blobs; **560/648 archivos tracked** también. Cada diferencia se verificó como exclusivamente CRLF→LF, sin otro cambio. Aplicar la receta FIX2 a los blobs Git LF daría **sha256:63002a5af931a0f3a7a91de7ef80a096d9c31cea45a0b1cce2a2a2ec93595a3d**, no 3f678f…. La divergencia no queda resuelta diciendo sólo «ordenar el lock al final».

## B. Contrato de identidad observado

| Elemento | Contrato observado |
| --- | --- |
| contentHash | SHA-256 del string UTF-8; no normaliza EOL en el código/policy CSV. Los archivos de este inventario son texto UTF-8. |
| semanticHash / canonicalJson | Objetos con claves ordenadas; arrays conservan el orden de sus entradas. |
| --code-ref | Opción preexistente del CLI; string no vacío suministrado por el productor, precedencia sobre localCodeRef. |
| Manifest y wrapper V2 | Ambos contienen codeRef; validateBundle exige igualdad y verifica las identidades/hashes derivados. |
| Autoridad del código | El validator no recalcula la identidad del código. La autoridad exige attestation externa de commit, inventario, bytes y receta. |
| Snapshot Training V2 | Registry/classifier/rules, enlace V1, semanticChecksum y counts. No incluye codeRef. |
| projectionId V2 | semanticHash del wrapper, incluidos codeRef e inputs. Cambiar codeRef cambia projectionId y hash físico. |
| bundleId | schemaVersion, source, codeRef, builderVersions, projections y domainReview. Excluye build.builtAt. |
| validation-report.json | Reporte validado, con duraciones diagnósticas; no participa en bundleId/projectionId. |

La modalidad externa no se introdujo aquí: tests/integration/projectionBundleReplay.test.ts, projectionActivation.test.ts y projectionRuntimeHotReload.test.ts usan --code-ref; el schema del manifest y el wrapper aceptan la identidad del productor. Esto acredita que la opción es legítima, NO que cualquier valor pasado sea autorizado. Aquí se calcula desde los archivos antes de consultar/comparar el candidate esperado, y una segunda implementación lo verifica.

## C. Receta canónica acreditada

Se añadió únicamente el auxiliar de auditoría [code-identity-fix2.mjs](../../cross-projection-audit/code-identity-fix2.mjs), stdlib de Node, sin hashes esperados ni imports del candidate. Versión: **projection-code-identity-fix2-physical-bytes-v1**. Su hash físico es sha256:b56d08a5ea01a2cc0d36643268f816078c964655cc2e1efc82ac308029648a88. No cambia el algoritmo nativo ni los archivos del commit aprobado.

Procedimiento declarado:

1. Congelar los archivos físicos REALES del checkout revisado, verificar cada uno contra su blob en el commit 3c1e9c4a17469e9beac4c8cb242aac820635d817: byte exacto o únicamente CRLF→LF. Git diff HEAD debe ser vacío. No basta reconstruir todos los archivos como CRLF o todos como LF.
2. Enumerar todos los .ts recursivos de src/ y scripts/. Rechazar symlinks, duplicados y rutas no relativas normalizadas. Registrar exactamente el conjunto resultante.
3. Ordenar las rutas normalizadas con O\, una clave virtual definida independiente del host. Añadir package-lock.json al final. No usar los separadores físicos del host, timestamps, paths absolutos ni orden de readdir como entrada de identidad.
4. SHA-256 de los bytes físicos por archivo, serializar el array compacto de parejas y SHA-256 del resultado. No convertir EOL ni reconstruir el hash desde un manifest.
5. Verificar independientemente las 311 parejas desde el inventario tracked attestado, recalcular el hash con canonicalJson del commit aprobado y exigir igualdad con la receta. El self-check invierte la enumeración inicial y exige el mismo orden.
6. Ejecutar el builder aprobado pasando **el valor recién calculado** como --code-ref. Sólo después comparar la salida con el candidate aprobado.

Fragmento equivalente al ejecutado por replay.mjs:

```js
const identity = await deriveFix2CodeIdentity('/work');
// Segunda derivación sobre archivos Git attestados y hashes físicos, antes del build.
assert.equal(identity.codeRef, sha256(canonicalJson(independentEntries)));
execFileSync(process.execPath, [
  '--import', 'tsx', 'scripts/catalog-v2/build-projection-bundle.ts',
  '--source-dir=/release/frozen-source', '--output-dir=/output/candidate',
  '--code-ref=' + identity.codeRef
]);
```

Los hashes esperados en prepare.mjs se usan exclusivamente como asserts de regresión DESPUÉS de calcular los tres resultados; nunca se pasan como sustitutos del cálculo al builder. replay.mjs sólo compara referencias después de producir el bundle. --code-ref no se obtiene de reference.json, diagnosis.json ni del manifest aprobado.

**Autoridad:** se empaquetaron **648 archivos tracked** del commit, preservando sus bytes físicos reales; [physical-inputs.json](../../artifacts/catalog-v2/p2-3c-lr/physical-inputs.json) registra commit, cada ruta, hash físico, hash del blob Git y perfil CRLF. Se validó cada blob del commit en AMBOS contenedores, y npm ci no alteró el inventario codeRef/lock. La fuente congelada se verificó contra su manifest y aggregateContentHash antes del build. Coincidir con 3f678f… no es el único fundamento de esta autoridad.

Los directorios absolutos sólo aparecen en diagnóstico/comandos de ejecución; no forman parte de la identidad. La receta es portable; **sus entradas deben tener los mismos bytes**, igual que cualquier receta de hash físico. El paquete approved-worktree y frozen-source conservado bajo p2-3c-lr evita depender de la copia de fuente que antes residía en Temp.

## D. Entorno Linux utilizado

Docker Desktop local, motor Linux sobre WSL2. Se inició localmente Docker Desktop y se descargó una imagen pública; se instalaron git/ca-certificates sólo dentro de cada contenedor efímero. Ninguna herramienta/build se instaló o ejecutó en EC2. No fue una simulación Windows.

| Dato | Replay 1 y replay 2 |
| --- | --- |
| Imagen fijada por digest | node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 (node:22.23.1-bookworm-slim) |
| Node / npm | v22.23.1 / 10.9.8 |
| OS / architecture | Debian GNU/Linux 12 bookworm / linux x64 (x86_64) |
| Kernel | 6.18.33.2-microsoft-standard-WSL2 |
| Containers independientes | a91643bcbeac / 85adc00df798; --rm, FS /work separados, node_modules separados |
| Commit / tracked diff | 3c1e9c4a17469e9beac4c8cb242aac820635d817 / vacío |
| Instalación | npm ci en ambos; 272 paquetes, sin reutilizar node_modules Windows |
| Entradas | /release y /candidate montados READ-ONLY; /output distinto por build |
| Exit status | replay-1=0; replay-2=0; self-check cierre=0 |

Cada contenedor copió el paquete aprobado a su filesystem Linux /work y reconstruyó las proyecciones desde CSV/canonical source; no copió proyecciones al output. /candidate se utilizó exclusivamente como comparador de salida. APT sólo aportó herramientas de verificación Git, no ejecutables usados por los classifiers. Node, npm y builder/dependencias se fijaron por image digest/lock/commit. [image.json](../../artifacts/catalog-v2/p2-3c-lr/image.json), container-command.json, apt.log, npm-ci.log y container.log de ambos replays conservan los detalles.

## E. Inputs y fingerprints

| Entrada | SHA-256 físico |
| --- | --- |
| Commit Git | 3c1e9c4a17469e9beac4c8cb242aac820635d817 |
| package-lock.json | sha256:f0cc0d7483c225e7da7b12e1ccc794748a077c9560ca1359c8ab34f939f93cb0 |
| Extracción productiva aggregateContentHash | sha256:2a5521b77e5b26e2d56104ab2ad29d85aaff82c2f06d522d7aa141f1e062bb26 |
| canonical_input.json | sha256:f505ea3f20740c6b5a64645a369d8c43953086ec7fa1aefd23daa2ccb98db4a9 |
| category_trust_map.csv | sha256:01ac8a64b5aa20975d0e781eda618890bb7604219963eaf81ffaaed00db278fd |
| feature_trust_map.csv | sha256:88bde84b077f86d21c04b419885f11cfb15c9f1a7ecf082942ef88d7e5dfd2c8 |
| product_catalog_exploration.csv | sha256:e4f83e5513803e714089a2ad9f7590ffaea1f0b4373203cefc0559054fb7a442 |
| projection_input_manifest.json | sha256:e25120e2c5dd519707dfe8f16012fd5000073492caca76227119ffd5008b7a6b |
| CSV policy histórica aceptada | sha256:4788d5e878152b36b39e830e61d8b80f43871b8579304ab453904961bb920e2e |
| Policy FIX2 estructurada | sha256:c258f5db606d48f6e62399c5ab3b551c8650309aa2e8d01ac23431adbc99fa03 |
| rulesHash FIX2 | d143736268bff53900de4ceaa7b50b76061fcc73d0b6d44e2a4a645f5834b8a8 |
| physical-inputs.json (648 entradas) | sha256:9dce1885c84f013b393d6b4cdf6540d338aa939516af2ab3d869d0932eb5dae1 |
| identity-recipe.mjs | sha256:b56d08a5ea01a2cc0d36643268f816078c964655cc2e1efc82ac308029648a88 |
| replay.mjs | sha256:6a4cbc2de49eb5231e83ac7299c628c90fbe37bd2008c4d9f8f99ca9c840ae55 |
| job.sh | sha256:98c30444369944d41e8a4f8173fe06ed2c81f6d5589b9b5101bf6915adace474 |

CSV policy real: docs/audits/training-semantics/a00.6.7/post-closure-resolution-active.csv. Su hash CRLF es 4788d5…; normalizando SÓLO CRLF→LF se obtiene exactamente **sha256:1514a58f7ab1a013e1b0c5ab39224846623593f7f30c782ed77d6842d550db33**, el hash de la policy histórica productiva. Esto aclara que esa divergencia física previamente registrada no demuestra un cambio de estados/contenido de policy. **No se normalizó la policy durante los replays**: su hash físico aparece en previousPolicy del wrapper V2 y cambiarlo alteraría la identidad del candidate.

Todas las fingerprints de herramientas, fuentes, manifests, artifacts y referencias de comparación están en [summary.json](../../artifacts/catalog-v2/p2-3c-lr/summary.json). Los dos code-identity.json incluyen los 311 hashes de código; physical-inputs.json incluye además package.json, tsconfig.json, CSV policy y todos los otros tracked. No se reconstruyeron ni extrajeron datos desde PrestaShop.

## F. Resultado de ambos replays

| Gate | Replay 1 | Replay 2 |
| --- | --- | --- |
| bundleId | sha256:bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f | sha256:bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f |
| Training V2 snapshotId | sha256:10cd9a355399eee0d761baacde062d4d74d64aa4e5c326e1337be673795c90c6 | sha256:10cd9a355399eee0d761baacde062d4d74d64aa4e5c326e1337be673795c90c6 |
| Training V2 projectionId | sha256:b315f13b1b63001ef5bfe4d4ff2b8f947748cede781b53cbc084c5fe2a009b77 | sha256:b315f13b1b63001ef5bfe4d4ff2b8f947748cede781b53cbc084c5fe2a009b77 |
| codeRef calculado | sha256:3f678f0a9e5a83c101aa6a3b6b6cb312e80f4a46ff5fc912d397c306a2f5a7ac | sha256:3f678f0a9e5a83c101aa6a3b6b6cb312e80f4a46ff5fc912d397c306a2f5a7ac |
| validateBundle | PASS | PASS |
| validateBundleForPublication | PASS | PASS |
| Fuente/lineage/V1→V2/invariants | PASS | PASS |
| Runtime compatible offline | READY | READY |
| Builder immutable publication | Fresh directory, reused=false | Fresh directory, reused=false |
| Semántica y conjuntos de IDs | Exactos respecto al aprobado | Exactos respecto al aprobado |

| Artifact | SHA-256 idéntico: candidate, replay 1, replay 2 |
| --- | --- |
| productSemantics.json | sha256:1c665a75468dfb520133973c7371b0a9bc0597282586480c48d89144df22c465 |
| trainingSemantics.json | sha256:a53ddeb2ea2650dd2bf0fd4cdf8e74665f2c7b0a83538068426a941ea6ab3e45 |
| specs.json | sha256:f0a1d85409758fb652bb371f0400d12f9ac1c9c9ee4f3b9d05bc529323e8cee2 |
| trustMaps.json | sha256:3c7c2a7f35bec8ffe001e80ab09069e5d408176580c6583ec6886cd8807fc437 |
| trainingSemanticsV2.json | sha256:28f4b01fe50f9e9f61bee2e69e560b93e7f8211ec092ba2cbd8d6ecb1229e7db |

Los validators ejecutaron checks de los cinco artifacts, fuente canónica, source inputs, wrapper/codeRef, contenido/identidades, vínculo Training V1 y evidencia de fuente. Training semantic invariants se ejecutaron con las entradas CSV verificadas y productFamilyEvidence de Product Semantics. validateBundleForPublication se ejecutó con la fuente, tanto dentro del builder antes del rename como en la verificación independiente. No se afirma que ejecutar un builder offline equivalga a publicar en producción.

Specs mantiene sus warnings aprobados; la igualdad física impide ocultarlos. Las proyecciones relationships/capabilities siguen unavailable. Los manifests mantienen TECHNICALLY_VALID/domainReview=PENDING del candidate; los validators PASS no inventan un domainReview distinto.

## G. Diff completo contra candidate

Se comparó el conjunto completo de **7 archivos** en cada directorio. Las cinco proyecciones son byte-identical, incluidas provenance, source IDs, raw/normalized values, assignments y estados. Comparación recursiva sin otros campos ignorados:

| Archivo/campo | Candidate aprobado | Replay 1 | Replay 2 |
| --- | --- | --- | --- |
| manifest.json /build/builtAt | 2026-10-08T16:47:03.897Z | 2026-10-08T17:24:39.144Z | 2026-10-08T17:24:39.107Z |
| validation-report.json /buildDurationMs | 11981 | 16863 | 16863 |
| validation-report.json /validationDurationMs | 596 | 743 | 790 |
| Cualquier otro campo | Sin cambios | Sin cambios | Sin cambios |

build.builtAt es el ÚNICO timestamp distinto y está expresamente excluido por bundleId(). Los generatedAt de snapshots siguen fijados a epoch por el builder. Las dos duraciones son diagnósticas y no participan en identidades. No se excluyeron genericamente campos de evidence/provenance ni se editaron timestamps para alcanzar igualdad. La allowlist del checker también contempla artifactBytes/manifest.json si cambia su longitud, pero esa diferencia NO ocurrió.

| Archivo | Candidate aprobado | Replay 1 | Replay 2 |
| --- | --- | --- | --- |
| manifest.json | sha256:6b5fc8aec02583c46f24e84921917ff1d878e83978459e0dc6b8fe5c243cf850 | sha256:684cbdd39fcdec1e34cdddcbdd3a46a03137ea50c6d9054f2456cfc5387e920a | sha256:ede373ba092bf2068e0536378b6481587a767c2621a4924a4d0c48ca36a0aa05 |
| validation-report.json | sha256:d85cf700fd163a99e7509307c802162e490651d7d5096c15b3d1d85e2a5f9d59 | sha256:c2de0510749912eeebca05c7bbf635f4d532c750ad84bc923a6b2a8e40a1584a | sha256:facdf8ef7a657dfe587c396c8d5a1deb41ebfc274cf65245f527c2ca226e3f12 |

Los hashes físicos de manifest/report son distintos y se registran, aunque bundleId y las cinco proyecciones sean exactos. Ningún manifest existente se parcheó. **385 fingerprints protegidas previas permanecieron intactas** al cierre; tracked diff HEAD vacío. El self-check close-evidence.mjs compara los dos resultados completos y las referencias previas.

Los siguientes conjuntos se recalcularon mediante el código aprobado sobre los bytes de AMBOS replays; se compararon los arrays completos, además de cantidades y hashes. Hash de conjunto = SHA-256 de JSON canónico del array de productId ordenado numéricamente.

| Conjunto | Cantidad | Hash exacto, ambos builds y candidate |
| --- | --- | --- |
| canonical | 2048 | sha256:b3f0df7fed594ca5ef9478047a4a17d5fac51d07648a912f331794a248f206b1 |
| current | 1565 | sha256:55f1a726ec700886d1fbac380d430d44d281aa6202cfcaac2fa42c2290ee43e3 |
| historical | 483 | sha256:2055acdecb86c360405ca9fb8820d79bf4427ca9aed644f34ee88815a8841562 |
| active | 886 | sha256:72b830c5d4c27bd9ade88e320dd2f0a342d6f96283530d03b76682db1d18dcfa |
| productDiscovery | 791 | sha256:7d5d07a3ba600c823df31fa244859fa00b668a153c5a09b12b873e479e4568b7 |
| specsConflict | 82 | sha256:1d9bba9a2933ebe256a02c3803085f4b42e0085ffca6bb135c5cc34ecbd3d408 |
| exerciseDiscovery | 100 | sha256:3056e67908bffb4496bf5037b63f29f0fb777b2663a1fcb2033d1d47e3158bac |
| functionDiscovery | 71 | sha256:a96de64ee5b2a735cd1b85cd7deb1bc22d1f48192c8c2b8d6d4813334a50b501 |
| unifiedAdmitted | 95 | sha256:b3bdb9d1be48fa65a179c58114058683a80b1462a1b60a907288576a1e00c8e3 |

| Evidencia negativa conservada | Cantidad | Hash exacto de IDs |
| --- | --- | --- |
| NEGATIVE_EVIDENCE_PRESENT | 874 | sha256:03f67bd55e9a0cc52132de0b6dda451ceae0979fa6a17309ff94ae0fd954a276 |
| NEGATIVE_EVIDENCE_ABSENT | 50 | sha256:ffcc1f5482ffaad4b234b042864f81f64acebe33403488f49efc1c799d454594 |
| NEGATIVE_EVIDENCE_NOT_RECONSTRUCTABLE | 0 | sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |

Cero VERIFIED_NO_APPLICABLE_CAPABILITY con assignments. Se compararon todos los records de la evidencia negativa previa con los records regenerados, y la igualdad física completa de Training V2 conserva sus evidencias y warnings. Los estados de evidencia de la tabla se obtienen del comparador aprobado y se cotejan con records exactos, no se presenta su lectura como una nueva adjudicación. P1354 mantiene su deuda/warning; 50 negativos siguen sin evidencia positiva acreditada de negatividad. DATA_GAP/AMBIGUOUS no se sustituyen por negativos.

| Fixture | resolutionState exacto | Facts exactos |
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

Además de los facts mostrados se exigió igualdad del RECORD ENTERO de los doce fixtures contra el comparador definitivo, incluida evidencia. P1020 no tiene CABLE_RESISTANCE y P1856 no tiene BARBELL_SUPPORT. Product/Exercise/Function/Unified Discovery conservan sus conjuntos exactos y Specs los 82 conflictos de fuente.

Commercial Truth: no hubo cambio de runtime comercial ni de fuente/datos. El paquete contiene exactamente los TS comerciales del commit aprobado; la receta sólo calcula metadatos de identidad y no ejecuta cambios comerciales. No se ejecutó un smoke HTTP productivo nuevo en esta fase. La continuidad HTTP comercial sigue siendo un gate operacional del rollout, no se infiere del replay offline.

## H. Compatibilidad de publicación

**Sí se puede reconstruir y publicar el candidate aprobado sin reidentificarlo**, utilizando la receta y el paquete físico acreditados. No se requiere modificar el código semántico ni el contrato existente. El builder actual admite la identidad calculada, valida publication invariants, genera las cinco proyecciones exactas y publica de forma inmutable mediante staging/rename en un directorio offline nuevo. No se creó active.json ni hubo activation offline/productiva.

Para el rollout posterior: verificar el paquete físico y fuente congelada, recalcular codeRef con la receta, exigir bddf7f…/10cd9…/b315f… y los cinco hashes exactos. No usar el fallback nativo ni imponer 3f678f… a un checkout LF diferente. No copiar artifacts aprobados como inputs para fabricar una prueba de rebuild. No modificar un manifest regenerado para devolverle el hash físico viejo.

Elegir y congelar el paquete de siete archivos que realmente se publicará. Si se publica el candidate original, su manifest físico es sha256:6b5fc8aec02583c46f24e84921917ff1d878e83978459e0dc6b8fe5c243cf850. Si se usa una reconstrucción acreditada, registrar el nuevo hash físico y el diff builtAt; la futura activation debe ligar el manifest REAL publicado. Nunca sobreescribir un directorio inmutable ya publicado con el mismo bundleId. samePublished() acepta builtAt/timings distintos al verificar reutilización, pero conserva el contenido existente; no garantiza recuperar el manifest físico del build nuevo.

La revisión anterior acreditó que el runtime productivo antiguo NO admite el nuevo candidate. Debe desplegarse primero el commit/runtime compatible, reiniciar controladamente y comprobar OLD_BUNDLE READY; luego publicación, CAS y los demás gates. Este reporte elimina el pendiente técnico de replay Linux, no ejecuta ni reemplaza esa secuencia. Reobservar baseline, pointer exacto, activationId y rollback antes de ejecutar operaciones; no asumir ausencia de drift desde la revisión anterior.

## I. Defecto de diseño y correcciones necesarias

| Pregunta | Respuesta y alcance |
| --- | --- |
| ¿Debería el builder nativo dar la misma identidad en Windows/Linux? | Sí, sobre entradas idénticas. Actualmente no. También falta fijar el perfil de bytes de un checkout Git. |
| ¿La diferencia es un bug de canonicalización? | Sí: ordenar antes de normalizar separadores y dos convenciones de posición del lock. El hash físico depende además del EOL no especificado. |
| ¿Es legítimo preservar 3f678f… sin cambiar código aprobado? | Sí, preservando el perfil físico real y usando la receta histórica documentada con --code-ref calculado. Ambos Linux replays lo prueban. Sólo el SHA Git es insuficiente. |
| ¿Puede reutilizarse la receta? | Sí como receta versionada de identidad física: inventario dinámico, ningún hash/ID/producto hardcoded. Siempre requiere attestation completa de inputs/entorno. No convierte el fallback nativo en correcto. |
| ¿codeRef cubre TODO lo que puede cambiar el resultado? | NO por sí solo. Cubre todo el código computacional TS del builder, registry/rules y lock, pero no package.json, tsconfig.json, CSV policy, recipe externa, Node/OS ni archivos nuevos no TS. |

Cobertura compuesta observada: fuente/canonical CSV/trust maps están ligados por manifest de extracción y hashes de inputs del wrapper; la CSV policy externa está ligada mediante previousPolicy.hash; registry/rules/policy FIX2 están en TS y sus hashes de contrato. package.json y tsconfig.json afectan resolución/ejecución y no están en codeRef. El lock fija dependencias, pero no prueba por sí solo el runtime/toolchain ni scripts de instalación. La receta auxiliar tampoco está cubierta por codeRef histórico: su versión/hash y las herramientas se registran fuera de ese campo. El paquete físico attestado de 648 tracked + imagen por digest + fuentes/policy + fingerprints de herramientas cierra esas omisiones para **esta** prueba. No se afirma que 3f678f… sea por sí solo una attestation completa.

Corrección mínima propuesta para una revisión separada; **NO aplicada al runtime actual**:

1. Un único helper versionado compartido por builder y auditores, inventario explícito, rutas POSIX normalizadas ANTES del orden ordinal, lock en una posición declarada; ningún sort dependiente del OS.
2. Declarar el perfil de contenido: Git blobs UTF-8 LF o normalización CRLF→LF definida, con .gitattributes que fije los archivos relevantes; no confiar en core.autocrlf local. Mantener versión legacy para lectura de artifacts aprobados.
3. Incorporar package.json y tsconfig.json, y registrar inputs externos efectivos/toolchain/recipe como attestation versionada; ampliar el inventario si futuros builders cargan JSON/JS/etc. La policy puede seguir separada si está ligada explícitamente y se valida.
4. Mantener --code-ref como modalidad del productor, con verificación obligatoria de recipe/version/fingerprints antes de publicación; no usar una cadena libre como evidencia de código aprobado.
5. Añadir un fixture de orden con hermanos tipo catalog/... y catalogService.ts y replay LF/CRLF en Windows/Linux sobre bytes declarados. Si se cambia el perfil u orden/coverage, regenerar codeRef, wrapper y bundle y hacer revisión de identidades. No atribuir al candidate bddf7f… una identidad nueva «equivalente».

Usar el helper histórico portable para el rollout actual no cambia contratos ni requiere regenerar el candidate. Adoptar la receta moderna del punto anterior SÍ sería una nueva revisión: incluso la misma TS LF con el orden histórico ya produce 63002a…, y ampliar el inventario cambia nuevamente la identidad. El snapshot semántico podría permanecer igual, pero deben revisarse wrapper/bundle y todo cambio real de comportamiento.

## J. Impacto en roadmap P2.3D–F

No se inició P2.3D, QA1 ni implementación de nuevos dominios. La receta física histórica puede reutilizarse técnicamente en futuras revisiones: enumerará entradas nuevas y calculará identidades nuevas desde bytes, sin reglas para productos o hashes esperados. **No es suficiente como contrato completo de release futuro**: la cobertura compuesta/attestation debe mantenerse y revisar nuevos inputs; preferible resolver el helper compartido/perfil de EOL en una revisión independiente antes de promoverla como estándar D–F.

Una corrección de canonicalización no debe acoplarse silenciosamente a cambios semánticos D/E/F ni conservar un codeRef viejo mediante --code-ref literal. Registrar versión de receta, SHA revisado, inventario físico y source/toolchain para cada release. La preservación probada aquí no autoriza reutilizar 3f678f… con otro commit o contenido.

## K. Riesgos restantes

- El fallback nativo actual no es portable. Requiere la receta externa y verificación de las entradas físicas congeladas. Si sólo queda el SHA Git y se pierde ese perfil, STOP: no puede afirmarse reconstrucción exacta.
- Los artifacts y evidencia p2-3c-lr están ignorados por Git; deben archivarse en almacenamiento de release persistente/inmutable antes del rollout, incluidos approved-worktree, physical-inputs.json, frozen-source, recipe/tool hashes y outputs/logs. No hay commit/push en esta fase. Conservarlos sólo en una máquina local no es estrategia permanente de release.
- npm ci conservó el lock y notificó 13 vulnerabilidades (5 moderate, 8 high); no se actualizaron dependencias ni se realizó un nuevo análisis de seguridad/explotabilidad en este scope. Ambos logs están conservados.
- La instalación APT no quedó fijada por versión de paquetes; aporta Git para attestation y no modifica el código generador. La cadena computational sí usa imagen por digest y lock. Para un runner duradero, puede prepararse una imagen con esas herramientas fijadas y validar nuevamente sus fingerprints.
- La fuente, semantic gates y bytes son offline. No se reobservó EC2 en esta fase. El freeze/rollback de código, compatibilidad OLD_BUNDLE tras deploy, CAS, hot reload, fixtures HTTP, smokes Commercial Truth y persistencia productiva continúan pendientes de ejecución controlada.
- 50 negativos sin evidencia acreditada, P1354 warning/deuda, DATA_GAP/AMBIGUOUS y conflictos Specs permanecen; no se ocultan ni corrigen en esta fase.

STOP antes de publicar ante hash de entrada distinto, attestation Git inválida, receta/inventario diferente, npm ci que altere lock/code, validator/invariants FAIL o cualquier diferencia semántica/IDs/physical hashes fuera de la allowlist exacta. STOP antes de activation ante drift del baseline, runtime antiguo, old bundle no READY o rollback no congelado. No se autoriza «arreglar» identidad editando manifests.

No se corrió de nuevo la suite completa del runtime: no se modificaron sus TS/config/lock. La validación pertinente fue el self-check de la nueva receta, la segunda derivación independiente, dos builds Linux, validators/runtime/invariants, comparación byte a byte y regresiones de conjuntos/fixtures. Los tests completos previos documentados en la revisión siguen siendo evidencia anterior, no se presentan como ejecutados en Linux hoy.

## L. Disposición final

Los flags siguientes evalúan **el procedimiento acreditado con recipe física versionada y paquete attestado**, no el fallback nativo ni un checkout cualquiera derivado sólo del SHA. El cálculo Windows y ambos Linux dieron las mismas 311 parejas y codeRef; por eso la receta es cross-platform deterministic sobre los mismos bytes. **NATIVE_DEFAULT_CODE_REF_CROSS_PLATFORM_DETERMINISTIC=NO** y **GIT_SHA_ONLY_REPLAY_PRESERVES_APPROVED_IDENTITY=NO** son límites explícitos, pendientes de la corrección general separada.

```text
LINUX_REPLAY_VERIFIED=YES
CODE_REF_CONTENT_DERIVED=YES
CODE_REF_CROSS_PLATFORM_DETERMINISTIC=YES
CANDIDATE_IDENTITY_PRESERVED=YES
PROTECTED_PROJECTIONS_IDENTICAL=YES
READY_FOR_CONTROLLED_ROLLOUT=YES
```

Disposición: **READY_FOR_CONTROLLED_ROLLOUT** del candidate bddf7f… mediante el procedimiento acreditado. Puede publicarse sin modificar su identidad contractual; se acreditó la vía física reproducible permitida por el contrato existente. No se afirma que el builder nativo ya esté corregido ni que el codeRef histórico cubra por sí solo todos los inputs. La corrección general recomendada exige revisión propia y regeneración si cambia las identidades.

**P2_3C_PRODUCTION_CLOSED=NO.** Ninguna evidencia nueva de deployment, activation, health productivo, semantic HTTP smoke, Commercial Truth o persistencia tras reinicio se generó aquí. No hubo acceso/modificación EC2, PM2, pointer, datos ni publicación productiva; tampoco commit/push. El plan operacional y STOP/rollback de la revisión anterior siguen vigentes, sustituyendo únicamente su gate pendiente de replay Linux por las pruebas acreditadas aquí.

Evidencia principal: [summary.json](../../artifacts/catalog-v2/p2-3c-lr/summary.json), [replay 1](../../artifacts/catalog-v2/p2-3c-lr/replay-1/evidence.json), [replay 2](../../artifacts/catalog-v2/p2-3c-lr/replay-2/evidence.json), [runner ejecutado](../../artifacts/catalog-v2/p2-3c-lr/replay.mjs), [launcher](../../artifacts/catalog-v2/p2-3c-lr/run-containers.mjs), [self-check cierre](../../artifacts/catalog-v2/p2-3c-lr/close-evidence.mjs). Todos los comparadores históricos se usaron sólo para comprobar outputs regenerados; no se copiaron artifacts como sustituto de construcción.
