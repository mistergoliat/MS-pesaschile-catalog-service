# CAT-DISCOVER-V0.2 — Recuperación, evidencia e interpretación: implementación y regresión

Fecha: 2026-10-08, America/Santiago. Evolución **offline y experimental** de `catalog.discoverV0` sobre la base de V0 (commit `6469eca`). Run oficial: `artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2/`. **Disposición: V0_2_ACCEPTED_WITH_LIMITATIONS. PRODUCTION_ROLLOUT=DEFER.**

No se tocó producción: sin despliegue, EC2, punteros, rebuild de bundles ni cambios en Product Semantics, Training V2, Specs, Trust o Admission. Sin embeddings, RAG ni base vectorial. Sin etiquetas humanas simuladas. No se modificaron los artifacts de QA1, QA2 ni Discover V0, ni el benchmark V0. Sin commit ni push. Los cambios se limitan a los módulos experimentales de Discover, sus pruebas y scripts, este informe y evidencia nueva en un directorio exclusivo (ignorado por Git).

## A. Resumen ejecutivo

- **V0.2 está implementado sobre el código de V0, sin un segundo motor.** El pipeline separa interpretación, recuperación, relevancia, evidencia, restricciones y disposición. Cada candidato termina en `VERIFIED_MATCH`, `POSSIBLE_MATCH` o `REJECTED`.
- **La relevancia nunca certifica.** Los subtipos, propósitos y nombres de producto se evalúan como *requisitos de relevancia* sobre el texto fuente: filtran u ordenan, pero jamás satisfacen una restricción.
- **El intérprete distingue roles** (identidad, rol de producto, función, ejercicio, propósito, relación, especificación y restricción comercial). Las ambigüedades materiales se representan como lecturas alternativas, nunca como restricciones simultáneas. «soporte de barra» ya no excluye los accesorios que se llaman exactamente así (Q060).
- **QuantityScope** tipa el significado de cada valor de Specs: por unidad, par, pack, capacidad de usuario, subcomponente, configuración o lado. «10 kg cada disco» certifica «bumper 10 kg» (Q081: 0 → 7 verificados). Un pack de 100 kg no certifica discos de 100 kg, y un par sin calificador queda ambiguo.
- **Coincidencia exacta sin degradación.** La entidad exacta se resuelve aparte, conserva sus contradicciones, y los productos relacionados mantienen las restricciones originales. En V0 «Kettlebell Acero 20kg» certificaba 184 productos (incluidos kettlebells de 4 kg); en V0.2 certifica 3 y rechaza 160 con evidencia.
- **Resultados, D (FIX2), 120 consultas:**
  - consultas con algún VERIFIED: 85 → 89;
  - consultas con alguna lista: 108 → 108;
  - 0 restricciones duras violadas entre los verificados (re-verificación independiente);
  - 0 violaciones de contrato y 0 regresiones exactas;
  - determinismo 120/120 en A/B/C/D.
- **Las 12 consultas que V0 perdía frente a la búsqueda:** 6 tienen ahora VERIFIED (Q033, Q073, Q078, Q080, Q081, Q105). Ningún producto que mostraba `catalog.search` quedó REJECTED. Las otras 6 dependen de defectos aguas arriba (Specs ambiguas, frontera CABLE_MACHINE, J-Cups no admitidos, packs).
- **Respuesta para agente:** p50 de 1.934 bytes en D (máx. 3.032), frente a 11.166 bytes de V0. La respuesta diagnóstica crece (p50 16.783 bytes) y sigue siendo la autoridad de depuración.
- **Lo que no se demuestra:** no existe gold de relevancia. Más resultados no significan mejores resultados, y varias transiciones de elegibilidad dependen de decisiones interpretativas declaradas en la sección N.

```text
DISCOVER_V0_2_IMPLEMENTED=YES
V0_BASELINE_REPRODUCED=YES
RETRIEVAL_CERTIFICATION_SEPARATED=YES
QUERY_AMBIGUITY_HANDLED=YES
EXACT_CONSTRAINT_REGRESSION=PASS
QUANTITY_SCOPE_IMPLEMENTED=YES
HARD_CONSTRAINT_VIOLATIONS=0
AGENT_RESPONSE_COMPACT=YES
FOUR_WAY_COMPARISON_COMPLETE=YES
INDEPENDENT_RELEVANCE_GOLD_AVAILABLE=NO
RETRIEVAL_QUALITY_VALIDATED=NO
PRODUCTION_ROLLOUT=DEFER
```

## B. Autoridad de fuentes

| Insumo | Identidad | Verificación |
| --- | --- | --- |
| Fuente congelada | `sha256:f505ea3f20740c6b5a64645a369d8c43953086ec7fa1aefd23daa2ccb98db4a9` (agregado `sha256:2a5521b7…`) | Hash de cada archivo contra su manifest |
| Bundle productivo (C) | `sha256:84c85d15c434b2af540139c476afb937a78dd5f018405746446c4566a7bac7b8` | Esquema, `bundleId` recalculado, fuente y `contentHash` de PS/Training V2/Specs: PASS |
| Candidate FIX2 (D) | `sha256:bddf7f367faec3d8f04e7f7cac9cedc5066467c4633c490a5f26a74d5a897e3f` | Ídem: PASS |
| Benchmark de desarrollo | `discover-v0-benchmark-v1`, `sha256:581ae835e42e…` | Igual al usado por V0 (el runner lo verifica) |
| Cohorte QA2 de Specs calificadas | `artifacts/catalog-v2/qa2/run-20261008-qa2-bddf7f-r2/specs_interpretation_risk.csv` (88 filas) | Hash registrado en `input_authority.json` |
| Contrato de Admission | `sha256:125caf27…` | Sin cambios |
| Código V0 de referencia | commit `6469eca2009a0cbdd897d43deadb1a7ff0d10c2c` | Reproducido (ver abajo) |

La huella **léxica** de ambos índices sigue siendo `sha256:da45eed1…`, igual que en V0: el texto indexado no cambió. Las huellas de índice sí cambian (`eab594dc…` productivo y `969234ba…` FIX2, frente a `7a50fcca…`/`af312f38…` en V0) porque la lineage incluye la versión de retrieval y la del léxico.

**Reproducción de V0 antes de modificar código.** Primero se capturó `protected_before.json`. Luego se ejecutó el benchmark V0 con el código de HEAD (`6469eca`) en `run-…-r1/v0-replay/v0-head-6469eca/` y se comparó contra el run histórico `run-20261008-discover-v0-r1`. Las 13 comparaciones resultaron idénticas byte a byte, salvo los campos de tiempo, e incluyen los cuatro `results_*.json`, CSV, markdown, interpretaciones, violaciones y huellas de índice ([v0_baseline_reproduction.json](../../artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2/v0_baseline_reproduction.json)). Toda comparación V0 ↔ V0.2 de este informe usa ese replay verificado como referencia V0.

## C. Cambios arquitectónicos

```text
Query interpretation      spans → lecturas (rol, conceptos, evidencia, restricciones, motivos sin resolver)
        ↓                 AmbiguityGroup (lecturas alternativas) · RelevanceRequirement (texto, nunca certifica)
Candidate retrieval       exacto · léxico (BM25F + nominal) · estructurado sobre TODAS las lecturas plausibles
        ↓                 gates de relevancia: requisito no agrupado obligatorio; por grupo, ≥1 lectura en objetivo
Relevance ranking         R = 0,5·L + 0,5·C (+0,15 preferencias de texto); tier EXACT/STRONG/PARTIAL/WEAK
        ↓
Evidence assessment       ConstraintVerifier por dimensión + Admission por dimensión + QuantityScope
Constraint evaluation     SATISFIED / VIOLATED / UNKNOWN / UNSUPPORTED (+ CONFLICTING_EVIDENCE)
        ↓                 fase 1 técnica (todo el pool) → hidratación comercial acotada → fase 2 comercial
Candidate disposition     VERIFIED_MATCH / POSSIBLE_MATCH / REJECTED (grupos: todas las lecturas)
        ↓
Final ranking + response  disposición → exacto → 0,7R + 0,2F + 0,1P → DiscoverDiagnosticResponse + DiscoverAgentResponse
```

| Módulo | Cambio |
| --- | --- |
| [contracts.ts](../../src/application/catalog/discover-v0/contracts.ts) | Versión `catalog-discover-v0.2`; `SemanticRole`, `InterpretationSpan`, `AmbiguityGroup`, `RelevanceRequirement`, `QuantityScope`, `SpecQuantity`, `CandidateDisposition`, `RelevanceAssessment`, `GroupResult`, ambas respuestas |
| [lexicon.ts](../../src/application/catalog/discover-v0/lexicon.ts) | `discover-v0.2-lexicon-v1`: entradas `AMBIGUOUS`, notas de lectura por término, `PURPOSE_HEAD_FAMILIES` |
| [queryInterpreter.ts](../../src/application/catalog/discover-v0/queryInterpreter.ts) | Spans y lecturas, grupos de ambigüedad, regla de propósito, escala de cantidad de la consulta; sin degradación por exacto |
| [quantityScope.ts](../../src/application/catalog/discover-v0/quantityScope.ts) (nuevo) | Adaptador derivado de Specs (`quantity-scope-v0.2`) |
| [constraintVerifier.ts](../../src/application/catalog/discover-v0/constraintVerifier.ts) | Specs vía QuantityScope; `CONFLICTING_EVIDENCE` también para negativas de Training; frescura comercial |
| [disposition.ts](../../src/application/catalog/discover-v0/disposition.ts) (nuevo) | Agregación de grupos y disposición |
| [ranker.ts](../../src/application/catalog/discover-v0/ranker.ts) | Relevancia separada del ajuste a restricciones; disposición como primera clave |
| [discoverV0.ts](../../src/application/catalog/discover-v0/discoverV0.ts) | Orquestación de dos fases, resolución exacta separada, diagnóstico de hidratación |
| [resultAssembler.ts](../../src/application/catalog/discover-v0/resultAssembler.ts) | Respuesta diagnóstica y de agente desde el mismo resultado; intercalado de lecturas en POSSIBLE |
| [generators.ts](../../src/application/catalog/discover-v0/generators.ts), [commercialHydrator.ts](../../src/application/catalog/discover-v0/commercialHydrator.ts) | Cobertura léxica en la señal BM25, truncación declarada, requisitos limitados al nombre; `validUntil` y motivo de disponibilidad |

No hay código de V0 duplicado: se evolucionaron los mismos módulos y se agregaron dos nuevos. El V0 ejecutable sigue siendo el commit `6469eca`; su salida es reproducible, como muestra la sección B.

## D. Interpretación de consultas

**Representación.** Cada fragmento con significado genera un `InterpretationSpan` con:

- texto original y span de tokens;
- lecturas (`SpanReading`), cada una con rol, conceptos candidatos, evidencia (entrada del léxico, regla del clasificador o patrón), restricciones y requisitos derivados, y un estado: `SELECTED`, `PLAUSIBLE_UNRESOLVED`, `RELEVANCE_ONLY` o `CONSIDERED_REJECTED` (este último con motivo);
- nivel de ambigüedad y motivos sin resolver.

Una ambigüedad material genera un `AmbiguityGroup`. Sus restricciones llevan `groupId` y `readingId` y son alternativas.

**Reglas nuevas, todas declaradas en el léxico gobernado** (`PENDING_DOMAIN_REVIEW`; nada depende de productId):

1. **Entradas `AMBIGUOUS`** (2):
   - `amb.barbell_holder` agrupa «soporte de/para barra», que admite dos lecturas: A, PRODUCT_ROLE accesorio MACHINE_ATTACHMENT, con gate de texto «soporte barra»; B, TRAINING_FUNCTION BARBELL_SUPPORT.
   - `amb.cardio_equipment` agrupa «equipo de cardio»: A, PRODUCT_ROLE CARDIO_MACHINE; B, USE_PURPOSE disciplina CARDIO_ENDURANCE.
2. **«X para Y».** Ya no se interpreta siempre como compatibilidad:
   - Si la cabeza pertenece a `PURPOSE_HEAD_FAMILIES` (hoy sólo STORAGE), el objetivo es un **propósito de uso**. Se exige que el **nombre** del producto lo mencione y nunca se certifica.
   - En cualquier otro caso sigue siendo COMPATIBILITY (UNSUPPORTED).
   - Un ejercicio modelado se convierte en EXERCISE.
   - Un ejercicio no modelado («para sentadilla») queda como preferencia de texto.
3. **Notas por término** para compuestos gobernados: identidad del producto como preferencia de relevancia («barra de dominadas»), y lecturas rechazadas explícitamente (BARBELL en «barra de dominadas», anatomía en «soga de tríceps», función en «máquina de poleas»).
4. **Escala de la cantidad pedida:**
   - `PER_UNIT` por defecto para equipos de carga;
   - `PACK_TOTAL` cuando la consulta dice «total», «pack», «set» o «kit»;
   - «par de X de N kg» se lee como `PER_UNIT` por la convención de nomenclatura del propio catálogo («Par Discos 10kg» + «10 kg cada disco»). `PER_PAIR` queda como alternativa considerada.

**Casos obligatorios (FIX2):**

| Consulta | Lecturas | Resultado V0.2 |
| --- | --- | --- |
| soporte de barra / soporte para barra | MATERIAL: A accesorio · B función | 0 VERIFIED / 110 y 82 POSSIBLE. P2003, P1814, P2002 y P1815 ya no se excluyen (A=SATISFIED; B=UNKNOWN por conflicto nombre/negativa). Racks: A=VIOLATED/OFF_TARGET, B=SATISFIED. Los POSSIBLE se intercalan por lectura |
| almacenamiento para discos | STORAGE + propósito «discos» (nombre). COMPATIBILITY considerada y rechazada | 5 VERIFIED: P1510, P479, P1001, P1196, P774 (los 5 de `catalog.search`) |
| rack para sentadillas | Identidad lexicalizada RACK_CAGE (gate «rack sentadilla» \| «squat»). Propósito sentadilla rechazado (no modelado) | 10 VERIFIED, igual que V0 |
| máquina de poleas | PRODUCT_ROLE CABLE_MACHINE. Función CABLE_RESISTANCE considerada y rechazada | 29 VERIFIED; agarres pasivos POSSIBLE (`FAMILY_OBLIGATION_UNMET`) |
| agarre para polea | Identidad MACHINE_ATTACHMENT. Relación con CABLE_MACHINE parte de la identidad, sin restricción de encaje | 0/8: los 8 agarres de `catalog.search` quedan POSSIBLE con `CONFLICTING_EVIDENCE` (QA2-R1) |
| soga de tríceps | Identidad MACHINE_ATTACHMENT. Anatomía TRICEPS rechazada | 0/3 POSSIBLE con `CONFLICTING_EVIDENCE` (QA2-R1) |
| equipo de cardio | MATERIAL: máquina · propósito cardio | 34 VERIFIED: ambas lecturas se cumplen, porque la disciplina coincide con la familia en los datos. El resto, POSSIBLE de relevancia WEAK, se omite en la respuesta de agente |
| barra para dominadas | EXERCISE PULL_UP. Identidad «barra … dominadas» como preferencia. BARBELL rechazada | Las barras de dominadas encabezan los VERIFIED (P1705, P2007, P1810…) |
| rack multifuncional con dominadas y fondos | RACK_CAGE + PULL_UP + DIP (sin BUNDLE_COMPONENT); «multifuncional» como texto | 2 VERIFIED (P1543, P2058). P1856 POSSIBLE con `CONFLICTING_EVIDENCE` (familia BODYWEIGHT_GYMNASTICS frente a «rack» en el nombre) |

Se cambió la interpretación de 39/120 consultas, según `query_interpretation_diff.csv`. Las causas fueron:

- coincidencia exacta sin degradación: 20 consultas;
- sólo se agregó la etiqueta de escala (`[PER_UNIT]`) a una restricción de peso que ya existía: 16;
- grupos de ambigüedad: 2;
- propósito de uso: 1.

## E. Recuperación y ranking

- **Relevancia sin estado de restricciones ni datos comerciales.** Se calcula a partir de:
  - el nivel exacto;
  - `L` (BM25 normalizado y tier nominal, como en V0);
  - `C`, la fracción de unidades conceptuales o de specs requeridas para las que una proyección emitió señal, admitida o no;
  - las preferencias de texto no bloqueantes.
- **El orden final usa primero la disposición.** Un REJECTED nunca supera a un VERIFIED o POSSIBLE, aunque su nombre se parezca más. Los pesos (0,7·R, 0,2·F, 0,1·P) se fijaron a priori, igual que en V0: no hay gold para ajustarlos.
- **Diversidad bajo ambigüedad.** En la lista POSSIBLE de «soporte de barra», los dos primeros son P1814 (lectura A) y P1707 (lectura B).
- **Límite de hidratación de 40.** En V0, la verificación técnica ya abarcaba todo el pool. Lo acotado era la **hidratación comercial**, que seguía el ranking *preliminar* (antes de verificar). La auditoría ([hydration_bound_audit.json](../../artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2/hydration_bound_audit.json)) muestra que en 12 consultas de D había productos técnicamente VERIFIED más allá de la posición 40 de ese orden. Ejemplos: Q063 (103), Q101 (51), Q003/Q032/Q036/Q110 (27). Con una restricción de precio, esos productos nunca habrían podido quedar conformes: **la pérdida era sistemática**.
- **Corrección en V0.2.** El algoritmo cambia y el límite se mantiene:
  1. Se verifica lo técnico de todo el pool.
  2. Se hidratan primero los candidatos técnicamente VERIFIED y luego los POSSIBLE, en orden de relevancia.
  3. Si los conformes superan 40, se declara en `completeness.commercialHydration.technicallyEligibleBeyondBound` y, cuando la consulta tiene restricción comercial, con la advertencia `COMMERCIAL_HYDRATION_BOUNDED`.

  En 10 consultas hay más de 40 verificados (máximo 143, Q063). En el benchmark, ninguna de ellas tiene restricción comercial. Una prueba unitaria fija este comportamiento: un producto conforme en la posición 13 de relevancia, con un límite de 3, se hidrata primero.
- **Truncación léxica.** El generador léxico alcanzó su tope de 200 en 19 consultas. Ahora se declara con `retrievalTruncated` y `RETRIEVAL_TRUNCATED`. La recuperación estructurada no tiene tope, así que los conformes por concepto siguen recuperándose.

## F. Evidencia y restricciones

- **Disposición:**
  - VERIFIED: todas las restricciones obligatorias están SATISFIED y cada grupo se cumple bajo **todas** sus lecturas;
  - REJECTED: alguna restricción está VIOLATED, o, en un grupo, todas las lecturas fallan (VIOLATED u OFF_TARGET);
  - POSSIBLE: el resto.
- **Sin conversiones forzadas.** UNKNOWN nunca se convierte en VIOLATED ni en SATISFIED.
- **CONFLICTING_EVIDENCE.** Se generaliza la regla de V0, que sólo cubría familias: una negativa PRESENT de Training ya no excluye cuando el **nombre** del producto nombra el concepto pedido (`NEGATIVE_CONFLICTS_WITH_NAME`), y queda UNKNOWN con el conflicto registrado. En D, 48 transiciones REJECTED → POSSIBLE vienen de esta regla y de los grupos. Ejemplos: Q056 «máquina para hip thrust» (7 productos «Banco Hip Thrust» con negativa PRESENT para HIP_THRUST) y Q053 «equipo para fondos».
- **Cuándo excluye una negativa PRESENT.** Sólo cuando la interpretación no es ambigua y el nombre no la contradice. Por ejemplo, en «barra de dominadas» se excluyen P1814 y P454.
- **Admisión por dimensión.** Se mantiene intacta: no se usa Unified Admission como filtro.

## G. QuantityScope y Specs

`quantity-scope-v0.2` es un adaptador derivado: los snapshots de Specs no se modifican. Cada valor parsed se tipa con:

- magnitud;
- objeto al que se aplica;
- ámbito;
- número de componentes, tomado del nombre: «Par», «Pack N», «Set N», «xN», «(Unidad)»; «N pares» sólo cuenta si encabeza el nombre o sigue a pack/set;
- si es aproximado;
- si incluye al usuario;
- ejercicios del subcomponente;
- estado, regla y evidencia.

Además lleva una **certificabilidad** separada del tipado:

- `CERTIFIABLE`;
- `CONDITIONAL`: subcomponente, configuración, valor aproximado o familia del componente desconocida;
- `NOT_CERTIFIABLE`.

| Caso | Regla | Comportamiento |
| --- | --- | --- |
| «10 kg. cada disco» en «Par Bumper … 10kg» | `EXPLICIT_EACH` → PER_UNIT/disco, coherente con nombre y familia | Satisface `weight_kg=10/PER_UNIT` (Q081, Q033, Q080, Q105) |
| Par de mancuernas | «cada mancuerna» → PER_UNIT; «(el par)» → PER_PAIR (por unidad derivable = v/2, marcado `derived`); «20 kg.» sin calificador en «Par …» → `MULTI_UNIT_UNQUALIFIED` (AMBIGUOUS) | Una prueba sintética distingue 10 kg por unidad de 10 kg por par |
| Pack de 100 kg | Nombre de pack con el mismo total → `PACK_NAME_TOTAL` | Para «discos de 100 kg»: `PACK_TOTAL_NOT_PER_UNIT` (UNKNOWN). Para «pack de discos de 150 kg»: certifica P1925–P1930 |
| Máquina con carga máxima | `max_load_kg` y `weight_kg` son claves distintas y nunca se cruzan | — |
| «300 kg (incluido peso de usuario)» | `INCLUDES_USER` → capacidad total del producto | Satisface «banco que soporte N kg». Nunca satisface `max_user_weight_kg` |
| «150 kg (barra pull up)» | `SUBCOMPONENT` (PULL_UP) | Sólo cuenta si la consulta pide PULL_UP. P1862 «Jaula Smith» queda REJECTED en Q088 porque su barra soporta 100 kg |
| «Aprox. (No calibrada)», «≈» | `APPROXIMATE` | Nunca satisface EQ; en GTE/LTE sólo con un margen de 10 % |
| Valores por configuración (plano/plegado) | `CONFIGURATION` | Satisface sólo si todas las configuraciones cumplen |
| «por lado» | `PER_SIDE` | NOT_CERTIFIABLE frente a totales |

**Cohorte QA2 (88 valores)** ([spec_quantity_scope_cases.csv](../../artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2/spec_quantity_scope_cases.csv)). **No se declaran resueltos los 88:**

| Clase | Valores | Reglas |
| --- | --- | --- |
| Interpretable con evidencia suficiente | 52 | 46 `EXPLICIT_EACH` en su propia familia y 6 `INCLUDES_USER` |
| Ambiguo o dependiente de contexto | 25 | 10 subcomponentes con ejercicio (barra pull up, fondos, leg curl), 6 aproximados, 4 de configuración, 4 `EXPLICIT_EACH` con familia de componente desconocida (P358, P360, P361 tobilleras; P1355 farmer's carry) y 1 componente de otra familia (P435) |
| Conflictivo | 0 | — |
| No soportado | 11 | 10 subcomponentes sin ejercicio modelado (P1620 «Máquina Abductora» ×6, P1974 «Polea» ×4) y 1 `PER_SIDE` (P1811) |

**Universo (1.434 valores parsed):**

- 1.316 suficientes, 78 contextuales, 31 no soportados y 9 conflictivos;
- de los 265 que V0 trataba como calificados, 178 son ahora certificables;
- a la inversa, **31 valores sin calificador que V0 certificaba ya no lo son**:
  - pesos «≈» que V0 no detectaba, como P454 «4 kg. ≈»: era un defecto latente de V0;
  - nombres que contradicen el valor (`NAME_MEASURE_DISAGREES`): sandbags «80lbs (Sin relleno)» con 0,7 kg, que es el peso vacío, o «Home Gym 68kg» con 81 kg;
  - productos de varias unidades sin calificador.

## H. Coincidencia exacta

La resolución exacta (`EXACT_ENTITY_RESOLUTION`) y el descubrimiento relacionado (`RELATED_PRODUCT_DISCOVERY`) están separados. La entidad exacta siempre se devuelve en `exactResolution` y en `agent.exactMatch`, con su propia disposición, y ocupa el rank 1 de la lista comparable. Las restricciones nunca se degradan.

| Prueba | Resultado (D) |
| --- | --- |
| `P1543` | RESOLVED/PRODUCT_KEY, sin descubrimiento relacionado (`NOT_APPLICABLE`); VERIFIED |
| `Kettlebell Acero 20kg \| HWM®` | P186 exacto y VERIFIED. Relacionados verificados: P1845 y P196 (20 kg). P180–P185 REJECTED (`weight_kg=4…16 EQ 20`). V0 certificaba 184 |
| `kettlebell 20 kg` / `pesa rusa de 20 kg` | P186, P196 y P1845 verificados. P1202 «Set 20kg …» POSSIBLE (`PACK_TOTAL_NOT_PER_UNIT`) |
| `barra de dominadas para usuario de 120 kg` | 20 verificados (V0: 12). Los nuevos son racks cuyo **subcomponente** «barra pull up» soporta 150–200 kg (P1543, P1541, P1546, P1547, P2058, P1059). P1035 (90 kg) y P177 (100 kg) quedan REJECTED |
| Entidad exacta con contradicción | P437 «Soga de Tríceps» (Q014) se devuelve como exacto POSSIBLE con `CONFLICTING_EVIDENCE`. P1807 J-Cups (Q013), POSSIBLE por no admitido. P1124 (Q008), POSSIBLE porque no afirma LAT_PULLDOWN |

Fixtures de ingeniería (29 con gating): pasan 24/29/29/29 en A/B/C/D, igual que V0. Hay **0 regresiones exactas**, ni en la lista de recuperación ni en la presentada (`EXACT_CONSTRAINT_REGRESSION=PASS`).

## I. Respuestas Agent / Diagnostic

Las dos representaciones se derivan del mismo resultado interno: `assembler.agent(response)` sólo lee la respuesta diagnóstica.

**DiagnosticResponse** conserva:

- spans, lecturas y grupos;
- requisitos de relevancia;
- señales de recuperación y scores desglosados (relevancia, L, C, ajuste, preferencias);
- resultados de restricciones con evidencia, cantidad y conflicto;
- resultados por grupo;
- resolución exacta, hasta 8 VERIFIED, hasta 8 POSSIBLE y hasta 8 REJECTED con motivo;
- completitud (hidratación y truncaciones) y lineage completa.

**AgentResponse** contiene:

- interpretación resumida (requeridas, preferidas, no verificables, ambigüedades y términos no reconocidos);
- la coincidencia exacta;
- hasta 8 VERIFIED y hasta 3 POSSIBLE (sin relevancia WEAK);
- por candidato, códigos cortos de lo verificado y su autoridad (`weight_kg=10kg/PER_UNIT@SPECS`), lo no verificado con estado y motivo, y las lecturas que lo sostienen;
- estado comercial, completitud con advertencias y lineage mínima.

No incluye señales, tokens, entradas crudas ni evidencia textual. Las advertencias críticas no se eliminan; el runner lo verifica en cada consulta y registró 0 omisiones:

| Advertencia | Consultas en D |
| --- | --- |
| `COMMERCIAL_TRUTH_NOT_OBSERVED` | 120/120 |
| `RETRIEVAL_TRUNCATED` | 19 |
| `CONFLICTING_EVIDENCE_PRESENT` | 18 |
| `WEAK_MATCHES_OMITTED` | 8 |
| `AMBIGUOUS_NEED` | 2 |
| `COMMERCIAL_HYDRATION_BOUNDED` | 1 |

Ejemplo real (Q060, 1.816 bytes, abreviado):

```json
{"interpretation":{"need":"soporte de barra","ambiguities":[{"text":"soporte de barra","readings":["A:accesorio físico «soporte de barra»","B:función: sostener la barra durante el entrenamiento"]}]},
 "verified":[],
 "possible":[{"productKey":"P1814","verified":["MACHINE_ATTACHMENT@PRODUCT_SEMANTICS"],"unverified":["G1:UNKNOWN:AMBIGUOUS_NEED:CONFLICTING_EVIDENCE"],"readings":["A:accesorio físico «soporte de barra»"]},
             {"productKey":"P1707","verified":["BARBELL_SUPPORT@TRAINING_V2"],"unverified":["G1:UNKNOWN:AMBIGUOUS_NEED"],"readings":["B:función: sostener la barra durante el entrenami…"]}, …],
 "completeness":{"verified":0,"possible":110,"rejected":114,"noVerifiedReason":"AMBIGUOUS_NEED_UNRESOLVED","warnings":["COMMERCIAL_TRUTH_NOT_OBSERVED","AMBIGUOUS_NEED","RETRIEVAL_TRUNCATED","CONFLICTING_EVIDENCE_PRESENT"]}}
```

**Commercial Truth.** Se reutiliza el puerto `commercialHydrator`; offline siempre informa `COMMERCIAL_TRUTH_NOT_OBSERVED`. Se probaron dobles tipados para estos casos:

- precio dentro del presupuesto (SATISFIED) y fuera de él (REJECTED);
- precio ausente (`PRICE_UNAVAILABLE`);
- producto no vendible (REJECTED);
- stock disponible (VERIFIED);
- datos vencidos según `validUntil` (UNKNOWN `COMMERCIAL_OBSERVATION_EXPIRED`, regla P9 del PRD);
- fallo parcial (`COMMERCIAL_TRUTH_UNAVAILABLE`) y total (`COMMERCIAL_HYDRATION_FAILED`, degradado).

No se fabrica precio ni stock, y no existe un motor comercial paralelo.

## J. Comparación V0 vs. V0.2

Diff por consulta y variante en [v0_v02_regression.csv](../../artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2/v0_v02_regression.csv). Columnas: queryId, variant, version, topK, verified/possible/rejected V0 y V0.2, cambios de interpretación, restricciones, evidencia y score, señales de relevancia, latencia, bytes y lineage. Transiciones por producto en [candidate_disposition_diff.csv](../../artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2/candidate_disposition_diff.csv); detalle de restricciones de las 24 consultas prioritarias en [constraint_assessment_diff.csv](../../artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2/constraint_assessment_diff.csv); comparación lado a lado en [priority_queries.md](../../artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2/priority_queries.md).

**Categorías de cambio, por número de consultas sobre 120:**

| Variante | Recuperación nueva / perdida | Interpretación | Elegibilidad | Ranking | Evidencia | Formato |
| --- | --- | --- | --- | --- | --- | --- |
| A | 0 / 0 (sin cambios; verificado contra V0) | — | — | — | — | — |
| B | 5 / 7 | 39 | 21 | 0 | 22 | 120 |
| C | 30 / 30 | 39 | 29 | 3 | 46 | 120 |
| D | 22 / 24 | 39 | 26 | 3 | 46 | 120 |

**Transiciones de disposición en D** (productos en el top-50 de cualquiera de las dos versiones):

| Transición | Productos | Origen principal |
| --- | --- | --- |
| VERIFIED → POSSIBLE | 108 | Nombres exactos (V0 certificaba relacionados por degradación) y Q060 |
| VERIFIED → REJECTED | 25 | Nombres exactos: relacionados de otro peso (Q001, Q006, Q007, Q010, Q016) |
| POSSIBLE → VERIFIED | 52 | QuantityScope (Q033, Q039, Q080, Q105, Q081, Q078) e `INCLUDES_USER` (Q084) |
| POSSIBLE → REJECTED | 29 | Pesos por unidad ahora tipados y distintos de lo pedido (Q033, Q034, Q078, Q079, Q095) |
| REJECTED → POSSIBLE | 48 | Conflicto nombre/negativa (Q056, Q053, Q044, Q049, Q098) y grupos (Q060) |

**Las 12 consultas que V0 perdía frente a la búsqueda nominal (D):**

| Consulta | Resultados de A | VERIFIED V0 → V0.2 | Productos de A en V0.2: verificados / posibles / rechazados | Motivo si queda sin VERIFIED |
| --- | --- | --- | --- | --- |
| Q033 discos preolímpicos 10 kg | 1 | 0 → 9 | 1 / 0 / 0 | — |
| Q073 almacenamiento para discos | 5 | 0 → 5 | 5 / 0 / 0 | — |
| Q078 mancuernas de 10 kg | 5 | 0 → 2 | 2 / 3 / 0 | P216, P228 y P1298 con Specs `ambiguous` |
| Q079 mancuerna de 25 kg | 5 | 0 → 0 | 0 / 5 / 0 | Specs `ambiguous` / multiunidad |
| Q080 disco olímpico de 20 kg | 2 | 0 → 10 | 2 / 0 / 0 | — |
| Q081 bumper 10 kg | 7 | 0 → 7 | 7 / 0 / 0 | — |
| Q095 mancuernas de 2,5 kg | 3 | 0 → 0 | 0 / 3 / 0 | Specs `ambiguous` |
| Q096 agarre para polea | 8 | 0 → 0 | 0 / 8 / 0 | `CONFLICTING_EVIDENCE` CABLE_MACHINE (QA2-R1) |
| Q097 soga de tríceps | 3 | 0 → 0 | 0 / 3 / 0 | `CONFLICTING_EVIDENCE` (QA2-R1) |
| Q099 j cups | 2 | 0 → 0 | 0 / 2 / 0 | No admitidos (QA2-R5) |
| Q100 pack de mancuernas con rack | 3 | 0 → 0 | 0 / 3 / 0 | Composición de pack no modelada (QA2-R4) |
| Q105 par de discos de 20 kg | 4 | 0 → 11 | 4 / 0 / 0 | — |

Ningún producto devuelto por `catalog.search` queda REJECTED en estas 12 consultas.

**Consultas prioritarias adicionales:**

| Consulta | Cambio |
| --- | --- |
| Q060 | 19 → 0 VERIFIED y 0 exclusiones de los accesorios homónimos (sección D) |
| Q001 | 184 → 3 VERIFIED (sección H) |
| Q088 | 12 → 20 VERIFIED, por subcomponente |
| Q031, Q051, Q052, Q058, Q059, Q064, Q076, Q083, Q106 | Listas idénticas a V0 |

## K. Comparación A/B/C/D

En [abcd_comparison.csv](../../artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2/abcd_comparison.csv) (480 filas): mismo universo de 884 productos, misma fuente, mismos bundles, mismo límite y misma estrategia de tiempos que V0.

| Métrica (120 consultas) | A CURRENT_SEARCH | B LEXICAL_PLUS | C HYBRID_OLD | D HYBRID_FIX2 |
| --- | --- | --- | --- | --- |
| Consultas con ≥1 VERIFIED, V0.2 (V0) | 47 (47)* | 10 (31) | 88 (84) | 89 (85) |
| Consultas con alguna lista o exacto | 47 | 103 | 108 | 108 |
| Media VERIFIED / POSSIBLE devueltos | 0,97 / — | 0,20 / 5,72 | 4,37 / 4,76 | 4,42 / 4,62 |
| Total VERIFIED en el pool, V0.2 (V0) | — | 91 (1.736) | 1.356 (3.215) | 1.407 (3.246) |
| Determinismo | 120/120 | 120/120 | 120/120 | 120/120 |
| Restricciones duras violadas entre VERIFIED | — | 0 | 0 | 0 |

\* A sigue siendo `catalog.search`, que no verifica restricciones; sus resultados son idénticos a V0.

**Por clase en D, V0.2 (V0), consultas con VERIFIED:**

| Clase | V0.2 (V0) |
| --- | --- |
| EXACT_NAME_SKU | 23 (25) |
| SYNONYM_LEXICAL | 19 (17) |
| CONCEPTUAL | 23 (23) |
| STRUCTURED_UNITS | 18 (15) |
| ADVERSARIAL | 6 (5) |
| OUT_OF_SCOPE | 0 (0) |

**Lectura de las cifras:**

- **B cae de 31 a 10.** LEXICAL_PLUS nunca verifica restricciones técnicas. En V0, 25 de sus 31 consultas con elegibles eran nombres exactos con las restricciones degradadas. La entidad exacta se sigue devolviendo; sólo deja de llamarse verificada.
- **C → D.** Las listas VERIFIED difieren en 16 consultas (V0: 17), concentradas en dominadas, racks, poleas y bíceps/tríceps (sección L de V0). FIX2 sigue siendo la diferencia, no V0.2.
- **El total del pool baja.** El descenso se explica casi entero por la eliminación de la degradación exacta (Q001/Q016: 184 → 3) y por tipar packs y pares.

No se calcula P@K, R@K, MRR ni nDCG: no hay gold adjudicado.

## L. Regresiones y limitaciones

**Regresiones reconocidas.** No son mejoras demostradas; algunas son el costo deliberado de no sobreafirmar:

1. **Q060 «soporte de barra»: 19 VERIFIED → 0.** La necesidad es ambigua y nada se certifica bajo ambas lecturas. Para el agente sólo hay POSSIBLE con la ambigüedad explícita; probablemente deba repreguntar.
2. **Q008 y Q013 pierden la lista VERIFIED.** V0 certificaba 8 relacionados por degradación. Ahora la entidad exacta (P1124, P1807) queda POSSIBLE y no hay relacionados conformes.
3. **B pierde «elegibles»** en los nombres exactos, como se explica en la sección K.
4. **Más POSSIBLE.** Hay 48 REJECTED → POSSIBLE. Las listas POSSIBLE son más largas: la media en D pasa de 3,61 a 4,62 devueltos. La respuesta de agente limita a 3 y omite los WEAK, pero el diagnóstico es más ruidoso.
5. **31 valores de Specs sin calificador dejan de certificar.** Es correcto según la evidencia, pero reduce resultados en consultas de peso para packs, pares sin calificador y valores «≈».
6. **Respuesta diagnóstica más grande:** p50 de 11,2 KB a 16,8 KB.

**Límites que V0.2 no corrige:**

- Q079 y Q095: Specs `ambiguous`.
- Q096 y Q097: frontera CABLE_MACHINE.
- Q099: J-Cups no admitidos.
- Q100: packs.
- Compatibilidad y sustitución: siguen UNSUPPORTED.
- Clubbell P1845 sigue siendo KETTLEBELL por decisión del clasificador.

**Ambigüedad.** Sólo se maneja la que el léxico gobernado declara: 2 entradas. Una ambigüedad no registrada se interpreta con la lectura de la entrada más larga, como en V0.

**Iteración sobre el mismo benchmark.** Las reglas se diseñaron mirando las consultas prioritarias de este conjunto. La regla PURPOSE_HEAD_FAMILIES, los dos grupos ambiguos y QuantityScope responden a sus fallos. Esto **no** es una evaluación independiente.

**Historia de runs:**

- `run-…-r1` quedó **superseded**. Después de ese run, la revisión universal de QuantityScope detectó que «N pares» en cualquier parte del nombre se contaba como unidades (racks «… 6 pares» pasaban a 12 unidades). Se corrigió con una prueba de regresión. r1 y r2 tienen listas idénticas: 0 diferencias.
- En r2, la primera ejecución principal corrió en paralelo con su réplica, lo que contaminó sólo la latencia. Esos archivos recién generados se borraron y la ejecución se repitió de forma secuencial. Detalle en `validation_results.json`.

## M. Rendimiento y tamaño de respuestas

Medición in-process offline (`performance.now`, Node v22.23.2, win32/x64), con la misma estrategia que V0: una primera ejecución, una re-ejecución y 5 warm (mediana). **No es latencia end-to-end.**

| ms | A | B | C | D |
| --- | --- | --- | --- | --- |
| Primera, p50 / p95 V0.2 | 1,56 / 2,97 | 2,64 / 27,56 | 3,52 / 33,86 | 3,34 / 30,05 |
| Primera, p50 / p95 V0 (replay) | 1,37 / 2,51 | 2,76 / 31,27 | 3,33 / 30,01 | 3,08 / 26,26 |
| Warm, p50 / p95 V0.2 | 1,41 / 2,51 | 2,51 / 28,08 | 3,18 / 27,88 | 2,90 / 28,74 |

Las diferencias con V0 son del mismo orden que la variación entre procesos: incluso A, que no cambió, varía. No se afirma ninguna mejora ni degradación de latencia.

Etapas warm de D (p50 / p95 en ms):

| Etapa | p50 / p95 |
| --- | --- |
| interpret | 0,13 / 0,24 |
| lexical | 1,60 / 26,03 (domina el p95) |
| verify, en dos fases | 0,15 / 2,24 |
| rank | 0,38 / 2,24 |
| assemble, con las dos respuestas | 0,11 / 0,28 |

La construcción del índice tarda 2,6–3,8 s por bundle.

**Tamaño serializado** ([agent_response_sizes.json](../../artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2/agent_response_sizes.json)), en bytes p50 / p95 / máx.:

| Variante | Agent V0.2 | Diagnostic V0.2 | Respuesta V0 |
| --- | --- | --- | --- |
| B | 1.448 / 1.840 / 2.038 | 10.728 / 14.788 / 16.726 | 6.646 / 8.687 / 10.290 |
| C | 1.937 / 2.928 / 3.032 | 17.061 / 34.803 / 39.496 | 11.162 / 19.115 / 27.929 |
| D | 1.934 / 2.928 / 3.032 | 16.783 / 34.807 / 38.051 | 11.166 / 18.720 / 26.588 |

- El objetivo de p50 < 3 KB se cumple: D ≈ 1,9 KB, unos 484 tokens estimados (bytes/4, no medidos). Ninguna respuesta de agente supera 3.072 bytes.
- La mayor es Q065 «equipo de cardio», con 3.032 bytes.

## N. Riesgos y deuda pendiente

1. **Decisiones interpretativas que cambian la elegibilidad.** Requieren revisión de dominio:
   - `INCLUDES_USER` se lee como carga total del producto. Agrega 9 bancos verificados en Q084. Si «banco que soporte 300 kg» se entendiera como carga *sin* usuario, sería una sobreafirmación.
   - `PAIR_NAMING_CONVENTION` («par de X de N kg» = N por unidad).
   - Las capacidades de subcomponente (Q088: +8 racks).
   - El margen de 10 % para valores aproximados.
2. **Léxico.** Hay 108 entradas (V0: 106), 101 en `PENDING_DOMAIN_REVIEW`, con sha `b1cac443…`. Las 2 entradas ambiguas y las notas de lectura por término necesitan revisión de dominio.
3. **Mapa componente → familia en QuantityScope.** Es una tabla experimental (disco, mancuerna, palmeta, agarre…). Los términos desconocidos quedan CONDITIONAL.
4. **Detección de conflictos nombre/negativa.** Depende de los términos del léxico. Un término demasiado genérico podría convertir exclusiones válidas en POSSIBLE.
5. **Aguas arriba** (QA2-B1/R1, R4, R5, B5/B8): frontera cable, packs, vocabulario de J-Cups y estados `ambiguous` de Specs.
6. **Truncación léxica a 200**, en 19 consultas. Está declarada, pero no se probó si oculta conformes léxicos sin señal estructurada.
7. **Identidad de código.** El worktree tiene 14 archivos modificados y 11 nuevos de Discover sobre `6469eca`. No construir bundles desde este worktree.

## O. Recomendaciones para V1

1. **Gold held-out antes de cualquier ajuste adicional.** El contrato está en [heldout_contract.v1.json](../../scripts/catalog-v2/discover-v0/benchmark/heldout/heldout_contract.v1.json) y el validador en [heldout.ts](../../scripts/catalog-v2/discover-v0/heldout.ts), con pruebas. Requisitos:
   - entre 80 y 100 consultas de logs comerciales autorizados y anonimizados, o elicitadas por ventas sin ver la salida;
   - sin solaparse con el conjunto de desarrollo;
   - congeladas por hash;
   - `usedForTuning=false`;
   - adjudicación con dos revisores ciegos y un adjudicador distinto.

   El validador rechaza uso para ajuste, tamaño fuera de rango, solapamiento, PII evidente y etiquetas sin adjudicar. **No se crearon consultas ni etiquetas.** La comparación oficial (P@3, R@8, MRR, nDCG@8, ya implementados) se ejecutará sólo sobre ese conjunto adjudicado.
2. **Revisión de dominio** de las reglas de la sección N.1 y del léxico, priorizando `INCLUDES_USER` y las capacidades de subcomponente.
3. **Corregir aguas arriba**, fuera de Discover: QA2-R1 (agarres CABLE_MACHINE), R5 (J-Cups), B5/B8 (Specs `ambiguous` en mancuernas PU y hexagonales) y la política de packs. Son las causas de los 6 casos que siguen sin VERIFIED.
4. **Repregunta.** Cuando `noVerifiedReason=AMBIGUOUS_NEED_UNRESOLVED`, la respuesta de agente ya trae las lecturas: R4 debería repreguntar en lugar de elegir.
5. **Commercial Truth en línea** detrás del puerto, conservando el orden de hidratación de dos fases y la regla de vigencia.
6. **Mantener descartados embeddings y RAG.** Ninguna regresión observada es de semántica latente.

## P. Disposición final

**V0_2_ACCEPTED_WITH_LIMITATIONS** (aceptación técnica y experimental). V0.2 cumple los criterios de ingeniería pedidos:

- separa recuperación de certificación;
- maneja la ambigüedad gobernada sin excluir por negativas ambiguas;
- tipa cantidades sin declarar resuelta la cohorte;
- elimina la degradación por coincidencia exacta sin regresiones de identidad;
- produce una respuesta compacta;
- es reproducible: 0 violaciones duras y determinismo completo.

Las limitaciones de las secciones L y N impiden una aceptación plena: no hay gold, hay decisiones interpretativas sin revisión de dominio y persisten defectos aguas arriba. **No habilita producción ni la integración con R4.**

## Reproducción

```bash
# integridad (antes / después; escritura create-only)
npx tsx scripts/catalog-v2/discover-v0/integrity.ts --out=<dir>/protected_before.json --exclude=artifacts/catalog-v2/discover-v0-2
# V0 reproducido desde 6469eca (antes de modificar código) y comparación con el run histórico
DISCOVER_V0_OUT_ROOT=<dir>/v0-replay npx tsx scripts/catalog-v2/discover-v0/discover-spike.ts --benchmark --run-id=v0-head-6469eca
npx tsx scripts/catalog-v2/discover-v0/compare-v0-replay.ts --frozen=artifacts/catalog-v2/discover-v0/run-20261008-discover-v0-r1 --replay=<dir>/v0-replay/v0-head-6469eca --out=<dir>/v0_baseline_reproduction.json
# V0.2: A/B/C/D + diff contra V0, y réplica
npx tsx scripts/catalog-v2/discover-v0/benchmark-v02.ts --run-dir=<dir> --v0=<v0-replay>/v0-head-6469eca
npx tsx scripts/catalog-v2/discover-v0/compare-v02-runs.ts --left=<dir> --right=<dir>/reproducibility --out=<dir>/reproducibility_check.json
# consulta individual (diagnóstico)
npm run catalog:discover:spike -- --query="soporte de barra" --mode=hybrid --bundle=candidate
npx vitest run --config vitest.config.ts tests/unit/discover-v0 tests/integration/discover-v0
```

**Validación ejecutada** ([validation_results.json](../../artifacts/catalog-v2/discover-v0-2/run-20261008-discover-v0-2-r2/validation_results.json)):

- `tsc --noEmit`: PASS.
- ESLint sobre Discover (src, scripts y tests): PASS.
- **95/95 pruebas** en 9 archivos: 22 de V0 unitarias, 10 del intérprete, 38 de V0.2, 2 del held-out, 8 de aceptación V0 y 6 de aceptación V0.2 sobre bundles reales, más las suites existentes `catalogSearchGoldV0` (1), `catalogV2Endpoint` (3) y `semanticDiscoveryQueryEndpoint` (5).
- **Seis pruebas existentes cambiaron de forma intencional**, cada una con motivo y nueva expectativa en el propio test y en `validation_results.json`:
  - coincidencia exacta sin degradación (unitaria y 2 de integración);
  - motivo tipado `APPROXIMATE_VALUE`;
  - «cada disco» ahora certifica;
  - versión de retrieval.

  Además, se renombraron campos de forma mecánica, sin eliminar ninguna aserción.
- Reproducibilidad V0.2 entre dos runs: 12/12 artefactos deterministas idénticos.
- Integridad:
  - 0 de 1.559 archivos protegidos cambiaron (artifacts, `data/`, docs de QA y arquitectura, `scripts/audits`, cross-projection);
  - 0 de 19 archivos de entrada cambiaron;
  - la evidencia V0 congelada no cambió;
  - HEAD `6469eca` sin cambios;
  - los archivos sin seguimiento preexistentes siguen presentes.
- **No ejecutado:**
  - `npm test`, porque su `pretest` reconstruye snapshots de Training bajo `data/`;
  - el benchmark held-out, porque no existe todavía;
  - Commercial Truth en vivo;
  - rebuild de bundles, prohibido.

Evidencia del run r2: `implementation_summary.json`, `input_authority.json`, `v0_v02_regression.csv`, `abcd_comparison.csv`, `query_interpretation_diff.csv`, `constraint_assessment_diff.csv`, `spec_quantity_scope_cases.csv`, `candidate_disposition_diff.csv`, `agent_response_sizes.json`, `latency_metrics.json`, `protected_before.json`, `protected_after.json` y `validation_results.json`. Además: `hydration_bound_audit.json`, `priority_queries.md`, `results_v02.json`, `v0_baseline_reproduction.json`, `reproducibility_check.json`, `reproducibility/` y `evidence_checksums_benchmark.json`.
