# CUSTOMER-INTELLIGENCE-R2-A00.2 â€” Commercial Product Ontology Registry

Status: **READY**
Type: pure domain module â€” no database, no network, no environment dependency, no HTTP surface.
Registry version: `commercial-product-ontology-v1`
Registry hash: `32d0b7f4a9a87ed5b1316b63f07af452d2f8a6b4ed012be3aa53729d149aefb9`

## 1. Why this registry exists

A00/A00.1/A00.1B/A00.1C built and repeatedly validated a simplified 3-axis commercial product ontology
by hand, against real evidence, across a 200-product golden set and then the full 2011-product catalog.
That work produced a candidate (`ontology_registry_candidate_v1.json`) and a closure decision
(`SIMPLIFIED_ONTOLOGY_READY`, `CUSTOMER-INTELLIGENCE-R2-A00.1C-ontology-review-closure.md`). Until now
that decision lived only in offline audit artifacts (CSVs, a JSON candidate file, markdown reports) â€”
nothing a future classifier, snapshot publisher, or analytics stage could import and rely on without
re-parsing prose.

This slice encodes that approved ontology as a **formal, versioned, immutable domain module** inside
`src/domain/commercial-product-ontology/`: strongly-typed contracts, the 35 real tags (+1 residual)
themselves, the global evidence/trust/exclusion/historical policies that govern how those tags may be
assigned, a runtime validator, a deterministic hash, and a small pure API. It defines the semantic
contract only â€” it does not classify anything.

## 2. Ontology axes

Three active axes, exactly as approved in A00.1C:

| Axis | Real tags | Residual |
| --- | ---: | --- |
| `PRODUCT_FAMILY` | 21 | `OTHER` (1) |
| `DISCIPLINE` | 8 | â€” |
| `USE_CONTEXT` | 6 | â€” |

`TRAINING_OBJECTIVE`, `COMMERCIAL_LEVEL`, `COMMERCIAL_ROLE` were considered in A00.1B/A00.1C and are
**not** active axes â€” see Section 8.

## 3. Final tag counts

**35 real semantic tags total**, 36 including the `OTHER` residual bucket:

- `PRODUCT_FAMILY` (21): `BARBELL`, `WEIGHT_PLATE`, `DUMBBELL`, `KETTLEBELL`, `BENCH`, `RACK_CAGE`,
  `CABLE_MACHINE`, `PLATE_LOADED_MACHINE`, `SELECTORIZED_MACHINE`, `CARDIO_MACHINE`, `FLOORING`,
  `STORAGE`, `BALL_BAG`, `ROPE_SLED`, `BAND_SUSPENSION`, `BODYWEIGHT_GYMNASTICS`, `PROTECTIVE_GEAR`,
  `MACHINE_ATTACHMENT`, `RECOVERY_TOOL`, `YOGA_PILATES`, `APPAREL` â€” plus `OTHER` (residual).
- `DISCIPLINE` (8): `CROSSFIT`, `HYROX`, `POWERLIFTING`, `CALISTHENICS`, `CARDIO_ENDURANCE`,
  `YOGA_PILATES`, `BOXING_MMA`, `REHABILITATION`.
- `USE_CONTEXT` (6): `HOME_GYM`, `SMALL_SPACE`, `COMMERCIAL_GYM`, `SEMI_COMMERCIAL_STUDIO`,
  `CLINICAL_RECOVERY`, `OUTDOOR_HIGH_TRAFFIC`.

Every count above is enforced at module load time by `validateCommercialProductOntologyRegistry` (fails
fast if a future edit breaks an invariant) and re-asserted by the test suite (Section 10).

## 4. Domain module layout

```
src/domain/commercial-product-ontology/
  contracts.ts            â€” all types: OntologyAxis, OntologyConfidence, OntologyEvidenceSourceType,
                             ForbiddenOntologyEvidenceSourceType, CategoryTrustClass,
                             CommercialProductOntologyTag, CommercialProductOntologyAxisDefinition,
                             CommercialProductOntologyGlobalRules, CommercialProductOntologyRegistry, etc.
  product-family-tags.ts  â€” the 21 PRODUCT_FAMILY tags + OTHER, as data
  discipline-tags.ts      â€” the 8 DISCIPLINE tags, as data
  use-context-tags.ts     â€” the 6 USE_CONTEXT tags, as data
  global-rules.ts         â€” category trust gate, non-product exclusion policy, historical policy
  deferred-axes.ts        â€” TRAINING_OBJECTIVE/COMMERCIAL_LEVEL/COMMERCIAL_ROLE decisions + rejected tags
  immutable.ts            â€” deepFreeze helper (the one runtime-freezing module in this codebase â€” see Section 9)
  registry.ts             â€” assembles + freezes the canonical singleton, runs the startup validator,
                             exposes the pure API (getCommercialProductOntologyRegistry, getOntologyAxis,
                             getOntologyTag, isValidOntologyTag, isAllowedEvidenceSource,
                             getOntologyTagsForAxis, isResidualOntologyTag)
  validate.ts              â€” the invariant validator (Section 7)
  hash.ts                  â€” deterministic hash/serialization, reusing shared/checksum.ts
  index.ts                 â€” barrel re-export
```

Every relative import between these files uses TypeScript `type`, `readonly` on every field, and no
`interface` â€” matching the house convention already established in `src/domain/customer-rfm/` and
`src/domain/customer-clustering/`.

## 5. Evidence model

Allowed evidence source types (`OntologyEvidenceSourceType`): `NAME_TEXT`, `TRUSTED_CATEGORY`,
`STRUCTURED_FEATURE`, `FAMILY_INFERENCE`.

Forbidden evidence source types are declared, not just omitted, so a future classifier cannot
reintroduce them without visibly contradicting this registry: `FREE_TEXT_DESCRIPTION`,
`CAMPAIGN_CATEGORY`, `NAVIGATION_CATEGORY`, `LEGACY_CATEGORY`, `UNKNOWN_CATEGORY`, `NOISE_FEATURE`,
`PRESENTATION_FEATURE`, `LOGISTICS_FEATURE`, `SAMPLING_METADATA`. `FREE_TEXT_DESCRIPTION` in particular
is forbidden because A00.1B/A00.1C found it produced double-digit false-positive rates on `DISCIPLINE`
tags (`CROSSFIT` inflated from 1 to 25 tags, `REHABILITATION` from 0 to 19, on the same 200-product
golden set) before being removed from the evidence model.

**Category trust gate** (`categoryTrustGate`, Section 10 of the task): `PRODUCT_FAMILY` may use
`TRUSTED_CATEGORY` evidence backed by `SEMANTIC_STRONG` or `SEMANTIC_WEAK` trust-class categories.
`DISCIPLINE` and `USE_CONTEXT` may only use `SEMANTIC_STRONG` categories. This gate only constrains a
tag that actually declares `TRUSTED_CATEGORY` among its `allowedEvidenceSources` â€” a tag using only
`NAME_TEXT` or `STRUCTURED_FEATURE` is unaffected by it. Enforced by the validator and by
`categoryTrustGate` tests.

Each tag encodes, at minimum (Section 5 of the task): `axis`, `code`, `labelEs`, `definition`,
`positiveEvidence`, `negativeEvidence`, `allowedEvidenceSources`, `confidencePolicy` (which confidence
levels â€” `EXPLICIT` and/or `STRONGLY_INFERRED` â€” are ever legitimately assignable, plus prose notes),
`historicalPolicy` (whether the tag is classifiable from name text alone on a historical-only row, plus
notes), `status` (`ACTIVE` or `RESIDUAL`), and `residual`. Tag `code`s are
stable machine identifiers; only `labelEs` may evolve, and only in a future registry version.

## 6. Historical product policy

One global policy (`globalRules.historicalPolicy`), applied identically to every tag on every axis for
`catalogPresence = historical_order_detail_only` products:

- `PRODUCT_FAMILY` may be classified from name text only, when unambiguous.
- `DISCIPLINE` requires explicit name evidence.
- `USE_CONTEXT` requires explicit name evidence.
- Missing metadata is `UNKNOWN`, never treated as negative evidence.
- No automatic mapping to a current-catalog successor product, even when one is identifiable by name
  similarity.
- No category or structured-feature inference â€” those evidence sources are structurally unavailable for
  historical rows, not merely disallowed by choice.

This is accessible programmatically both globally (`registry.globalRules.historicalPolicy`) and per-tag
(`tag.historicalPolicy.classifiableFromNameOnly`), so a future classifier does not need to re-derive it
from prose.

## 7. Non-product exclusion policy

A00.1C's human-style audit found 9 PrestaShop productIds that are service/installation/logistics fee
line items, not physical products â€” two of which (`902` "INSTALACION BARRA PARED FACIL", `903`
"INSTALACION JAULA A LA PARED") were confirmed to actively produce *wrong* tags (`PRODUCT_FAMILY:BARBELL`/
`RACK_CAGE` and `USE_CONTEXT:SMALL_SPACE`) from stray keyword matches before this policy was documented.

The registry encodes both a `knownExcludedProductIds` list (all 9, each with its evidence documented
inline in `global-rules.ts`) and `normalizedNameExclusionPatterns` â€” three regex source strings
(`^servicio\b`, `^costo logistico\b`, `^instalacion\b`), **anchored to the start of the normalized name**
so a legitimate product whose description happens to mention "servicio" is never caught, only a product
whose own name literally begins with an administrative term. This registry only *describes* the policy;
applying it to the product universe belongs to A00.3's classifier pipeline.

## 8. Deferred / dropped axes

| Axis | Decision | Reason |
| --- | --- | --- |
| `TRAINING_OBJECTIVE` | **DEFER** | No structured feature or trusted category maps to a training-goal concept; populating it would require the forbidden `FREE_TEXT_DESCRIPTION` source. |
| `COMMERCIAL_LEVEL` | **DROP** | ~1:1 redundant with `USE_CONTEXT` â€” both would be sourced from the identical `ClasificaciÃ³n de Uso` structured feature. |
| `COMMERCIAL_ROLE` | **DROP** | Every candidate tag is already implied by an existing `PRODUCT_FAMILY`. |

None of these three ever appear in `ontologyAxes` or `registry.axes` â€” they are metadata about a design
decision (`deferredOrDroppedAxes`), not active axis definitions. The validator asserts this.

## 9. The rejected WEIGHTLIFTING decision

`DISCIPLINE` deliberately does **not** include `WEIGHTLIFTING`, even though it appeared in the A00.1B
candidate. A00.1C's full-catalog validation (not just the 200-product golden set) found the proposed
evidence rule â€” "`CategorÃ­a: OlÃ­mpico`/`PreolÃ­mpico` feature on a `BARBELL`/`WEIGHT_PLATE` product" â€”
firing on 216 of 2011 products (55% of all `BARBELL`+`WEIGHT_PLATE` SKUs, 10.7% of the entire catalog).
Direct reading of sampled product descriptions confirmed this is a **technical specification**, not a
discipline signal: "CategorÃ­a: OlÃ­mpico" means the standard IWF sleeve diameter (50mm), the industry-wide
default used by CrossFit boxes, powerlifters, and general strength trainees alike â€” not evidence that a
product is positioned for the sport of competitive Weightlifting. A representative example: a "Barra
OlÃ­mpica Eco Serie" bar explicitly marketed as *"diseÃ±ada para entrenamientos bÃ¡sicos... usuarios
principiantes"* (a beginner bar) still carried Olympic-spec, and would have been mistagged
`WEIGHTLIFTING` under the rejected rule.

No alternative reliable evidence source was found (literal "halterofilia"/"weightlifting" name text does
not appear on any sampled product). The tag is permanently recorded in `rejectedOntologyTags` with this
reasoning, and `validateCommercialProductOntologyRegistry` **fails the entire registry** if a tag with
code `WEIGHTLIFTING` is ever found on any axis â€” this is a hard guard, not just documentation, so future
classifier code cannot accidentally resurrect it. `FUNCTIONAL_TRAINING`, `BODYBUILDING` (`DISCIPLINE`),
`CROSSFIT_BOX` (`USE_CONTEXT`), `PACK_SET`, and `BOXING_MMA`-as-a-family (`PRODUCT_FAMILY`) were also
proposed and rejected during A00.1B/A00.1C for zero-evidence or redundancy reasons; all five are recorded
the same way in `rejectedOntologyTags`.

## 10. Versioning contract

`registryVersion = 'commercial-product-ontology-v1'`. Semantics are immutable once published: a material
change to any tag's evidence rules, the tag set, or a global policy requires a new version
(`commercial-product-ontology-v2`, etc.) rather than silently mutating v1. `labelEs` (the Spanish
human-readable label) is the one field that may evolve within a version if the underlying semantics have
not changed; `code` values are permanent machine identifiers.

The registry exposes `registryVersion`, `status` (`PUBLISHED`), `createdFrom` (the source audit
documents), `axes`, the flattened `tags`, `globalRules`, `deferredOrDroppedAxes`, and `rejectedTags`.

## 11. Immutability

The registry is the **first runtime-frozen data structure in this codebase** â€” every other domain module
relies on compile-time `readonly` typing alone. This is a deliberate, narrowly-scoped exception
(`immutable.ts`, a local `deepFreeze` helper, not a new shared utility): TypeScript's `readonly` does not
stop a runtime mutation from a plain-JS caller or an `as any` cast, and this registry is explicitly meant
to be a durable contract that future semantic-snapshot and classifier code can trust never silently
changed underneath it. The canonical registry object is deep-frozen once at module load;
`getCommercialProductOntologyRegistry()` always returns the same frozen singleton reference. Attempting
to mutate any array or field throws a `TypeError` (proven by 6 dedicated tests â€” pushing into an evidence
array, reassigning a tag field, pushing a new tag into an axis, mutating `globalRules`, mutating the
excluded-product-id list, and confirming the singleton reference and its frozen state are stable across
calls).

## 12. Registry hash

`computeCommercialProductOntologyRegistryHash(registry)` reuses `sha256Stable` from
`src/domain/customer-rfm/checksum.ts` â€” the same cross-domain checksum utility already used by
clustering, customer-analytics, and customer-intelligence-query â€” rather than redefining hashing here.
`stableStringify` sorts object keys alphabetically at every level, so key-insertion order never affects
the hash; array order is deterministic by construction (every registry array is a fixed literal defined
in canonical source order, never derived from object/Map iteration). The registry contains no
timestamps or other runtime-dependent values, so the hash is stable across executions and machines:

```
32d0b7f4a9a87ed5b1316b63f07af452d2f8a6b4ed012be3aa53729d149aefb9
```

This hash is meant to be embedded in future semantic snapshots (A00.5) so it is always traceable exactly
which ontology version produced a given classification.

`serializeCommercialProductOntologyRegistry(registry)` exposes the same canonical JSON string
independently of the hash, for audits, debugging, and migration tooling.

## 13. What A00.2 does NOT do

Per the task's explicit scope boundary, this slice does not:

- Classify any of the 2011 catalog products.
- Consume PrestaShop or the Catalog Service runtime.
- Create SQL tables or touch a database.
- Publish product semantic snapshots.
- Create or touch customer affinity.
- Add dashboard UI or HTTP analytics endpoints.
- Introduce LLM classification.
- Re-enable free-text description as an evidence source.
- Add any ontology tag not already approved in A00.1C (no implementation contradiction was discovered
  during this slice that would have justified redesigning the ontology).

## 14. Tests

`tests/unit/commercial-product-ontology-registry.test.ts` â€” 95 tests across 14 `describe` blocks (A-N per
the task's required coverage): registry counts, every expected tag exists, `WEIGHTLIFTING` absence,
`OTHER` residual semantics, evidence-source rules, category trust gates, historical policy, non-product
exclusion metadata, immutability, deterministic hash, deterministic serialization, deferred/dropped
axes, duplicate-tag validation failure, and invalid-evidence-source validation failure. No live
PrestaShop dependency, no DB dependency â€” pure in-process assertions against the frozen singleton and
the exported validator function.

## 15. Validation run

```
npm run typecheck   â†’ clean, 0 errors
npm test             â†’ 190 test files, 1760 tests, all passing (0 regressions; includes the 95 new tests)
```
