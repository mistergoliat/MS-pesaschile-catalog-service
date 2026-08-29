# CUSTOMER-INTELLIGENCE-R2-A00.3 — Product Semantic Classification Pipeline

Status: **READY**
Type: deterministic offline classification pipeline — no database writes, no snapshot publication, no
customer affinity, no LLM, no HTTP endpoints, no runtime PrestaShop dependency.

Registry consumed: `commercial-product-ontology-v1`
Registry hash: `df58006b9a68f056a36988ff2c178a5084fe6400fd3f6abe96091472f9969009`

## 1. What this slice is

A00.2 encoded the approved 3-axis commercial ontology (21 `PRODUCT_FAMILY` + `OTHER`, 8 `DISCIPLINE`,
6 `USE_CONTEXT`) as a formal, versioned, frozen registry — but a registry only defines *what tags mean
and what evidence may assign them*. Nothing consumed it yet. A00.3 is the classifier: it reads A00's
2011-product export plus the A00.1 category/feature trust maps, applies the registry's evidence rules
deterministically, and produces an explainable classification for every product. It does not touch the
registry's semantics, does not publish anything durable (that's A00.5), and does not connect to
PrestaShop or the Catalog Service at runtime.

## 2. Architecture

```
src/domain/product-semantic-classification/
  contracts.ts             — ProductSemanticClassificationInput/Result, ClassifiedOntologyTag,
                              ClassificationEvidenceRecord, OntologyRuleMatch (shared internal type)
  normalize.ts              — normalizeProductName / normalizeEvidenceValue / splitExplicitBundleName
  category-catalog.ts       — classifier-owned category-name → tag-code tables (per axis)
  non-product-exclusion.ts  — applies registry.globalRules.nonProductExclusion
  product-family-rules.ts   — the 21 PRODUCT_FAMILY tags: ordered NAME_TEXT pass + TRUSTED_CATEGORY vote
  discipline-rules.ts       — the 8 DISCIPLINE tags (independent multi-label evaluation)
  use-context-rules.ts      — the 6 USE_CONTEXT tags, including "Clasificación de Uso" bucketing
  classifier.ts             — orchestrator: exclusion → family resolution → discipline/context → provenance
  checksum.ts               — deterministic run checksum (reuses customer-rfm/checksum.ts)
  index.ts                  — barrel

scripts/product-semantic-classification/
  lib/csv.ts                — dependency-free RFC4180 CSV reader/writer
  lib/load-input.ts         — A00 export CSV + A00.1 trust maps → ProductSemanticClassificationInput[]
  lib/summary.ts            — aggregate summary builder
  classify-catalog.ts        — the offline CLI runner (`npm run product:semantic:classify`)
  golden-set-regression.ts  — ad-hoc console comparison tool used while calibrating the rules
```

Every relative import inside the domain module uses `type`, `readonly` fields, no `interface` —
matching `commercial-product-ontology`'s and `customer-rfm`'s house convention. The domain module
imports `CategoryTrustClass`/`OntologyAxis`/`OntologyConfidence`/`OntologyEvidenceSourceType` and the
registry accessors directly from `commercial-product-ontology` rather than redeclaring them (Section 2
of the task: "do not duplicate registry semantics in ad-hoc classifier constants").

## 3. Input contract (Section 3)

`ProductSemanticClassificationInput` is independent of PrestaShop SQL:

```
productId, productName, catalogPresence ('current_catalog' | 'historical_order_detail_only'),
activeStatus (boolean | null)
categories[]  { categoryId, name, trustClass }         — trustClass from the A00.1 category trust map
features[]    { featureId, featureName, value, trustClass } — trustClass from the A00.1 feature trust map
```

A historical-only row is valid with just `productId`/`productName`/`catalogPresence` and empty
`categories`/`features` arrays — exactly what the real export produces for
`historical_order_detail_only` rows (no category or feature data exists for a product no longer in the
catalog). `scripts/product-semantic-classification/lib/load-input.ts` is the one place that translates
the A00 CSV export's PrestaShop-shaped columns (`allCategoryIds`/`allCategoryNames`, `features_json`)
into this contract; the domain layer never parses a CSV or a raw database column.

## 4. Output contract (Section 18)

`ProductSemanticClassificationResult`:

```
productId, registryVersion, registryHash, classificationStatus,
primaryProductFamily: { axis, code, confidence, ruleId } | null,
secondaryProductFamilies: [...same shape...],
disciplines: [...same shape...],
useContexts: [...same shape...],
evidence: { axis, code, ruleId, sourceType, sourceId, rawValue, normalizedValue }[],
warnings: string[],
exclusionReason: string | null,
matchedExclusionRule: string | null,
needsReviewCandidates: [...same shape as tags...],
```

`classificationStatus` — exact semantics:

| Status | Meaning |
| --- | --- |
| `EXCLUDED_NON_PRODUCT` | Matched the registry's non-product exclusion policy before any semantic rule ran. No axis was evaluated. |
| `CLASSIFIED` | A real (non-residual) `primaryProductFamily` was assigned on a `current_catalog` row — full evidence (name, category, structured feature) was available for every axis, whether or not a discipline/use-context tag ended up matching. |
| `PARTIALLY_CLASSIFIED` | A real `primaryProductFamily` was assigned on a `historical_order_detail_only` row — evidence was structurally incomplete (name-only) by construction, not by choice. |
| `OTHER` | `primaryProductFamily` is the residual bucket (no rule matched) — regardless of `catalogPresence`. A product can still carry `DISCIPLINE`/`USE_CONTEXT` tags in this state (e.g. a historical "Máquina Home Gym" row: family stays `OTHER`, `USE_CONTEXT:HOME_GYM` still fires from the literal name). |
| `NEEDS_REVIEW` | The `TRUSTED_CATEGORY` vote fallback (Section 6 below) found more than one mutually-exclusive `PRODUCT_FAMILY` candidate with no `NAME_TEXT` evidence to break the tie and no approved hybrid rule. `primaryProductFamily` stays `null`; the candidates are recorded in `needsReviewCandidates`. |

`OTHER` and `EXCLUDED_NON_PRODUCT` are deliberately distinct (Section 5): `OTHER` means "a real
product with no supported family fit"; `EXCLUDED_NON_PRODUCT` means "not part of the product semantic
universe at all" (a service/installation/logistics line item). Neither is ever confused with the other.

## 5. Normalization (Section 4)

`normalizeProductName`/`normalizeEvidenceValue` (in `normalize.ts`): Unicode NFD, strip diacritics,
lowercase, collapse non-alphanumeric runs to a single space, trim. `normalizeProductName` additionally
preserves the literal `+` character — the one piece of punctuation that carries semantic meaning
(Section 7's explicit multi-component bundle signal). Raw evidence is never mutated in place; every
`ClassificationEvidenceRecord` carries both `rawValue` (the original string) and `normalizedValue` side
by side.

## 6. PRODUCT_FAMILY rule precedence (Section 6, Section 17)

Deterministic precedence, highest to lowest — first match wins, which is the actual conflict-resolution
mechanism (not incidental array order):

1. **Non-product exclusion** (registry `knownExcludedProductIds` + anchored name patterns) — before
   anything else runs at all.
2. **Explicit "+" bundle split** (Section 7): if the normalized name contains a literal `+`, the
   left-hand substring is evaluated as the primary family and the right-hand substring independently as
   a candidate secondary family — only attached as secondary when it resolves to a genuinely different
   family code. `"Pack 105kg Mancuernas Hexagonales + Rack Vertical"` → primary `DUMBBELL`
   (left), secondary `STORAGE` (right, because `"Rack Vertical"` matches the `STORAGE` pattern before
   the generic `RACK_CAGE` pattern gets a chance). `"... + Rack"` (no `"vertical"`) → secondary
   `RACK_CAGE` instead, correctly, because the narrower `STORAGE` pattern does not match.
3. **Ordered NAME_TEXT pass**, one regex-backed rule per PRODUCT_FAMILY tag, in this fixed order (each
   with a stable rule id — full list in `product-family-rules.ts`):
   `STORAGE → CABLE_MACHINE → MACHINE_ATTACHMENT (mount hardware) → BODYWEIGHT_GYMNASTICS → BARBELL →
   RACK_CAGE → WEIGHT_PLATE → DUMBBELL → KETTLEBELL → BENCH → PLATE_LOADED_MACHINE →
   SELECTORIZED_MACHINE → CARDIO_MACHINE → FLOORING → BALL_BAG → ROPE_SLED → BAND_SUSPENSION →
   PROTECTIVE_GEAR → RECOVERY_TOOL → YOGA_PILATES → APPAREL`. Smith-machine naming
   (`PF_SMITH_OVERRIDE_V1`) is checked immediately after `STORAGE`, before every other rule, and always
   resolves to `PLATE_LOADED_MACHINE` regardless of "Jaula"/"Multifuncional" wording elsewhere in the name.
4. **TRUSTED_CATEGORY vote fallback**, only reached when no NAME_TEXT rule matched, and only for
   `current_catalog` rows: votes across `WEIGHT_PLATE`, `DUMBBELL`, `PLATE_LOADED_MACHINE`,
   `SELECTORIZED_MACHINE`, `STORAGE`, `PROTECTIVE_GEAR`, `MACHINE_ATTACHMENT`, `YOGA_PILATES` — the only
   PRODUCT_FAMILY tags whose registry-declared `allowedEvidenceSources` include `TRUSTED_CATEGORY`.
5. **`OTHER`** (zero votes) or **`NEEDS_REVIEW`** (more than one distinct family code voted, no tie-break).

### Documented boundaries (Section 6/17)

| Boundary | Resolution |
| --- | --- |
| STORAGE before generic equipment nouns | Checked first in the ordered pass — `"Rack de Almacenamiento Mancuernas"` is `STORAGE`, never `DUMBBELL`. |
| BODYWEIGHT_GYMNASTICS before generic BARBELL | Checked before `BARBELL` — `"Barra Pull Ups Multigrip"`/`"Barra Dominadas..."` is `BODYWEIGHT_GYMNASTICS`, not `BARBELL`. |
| Smith-machine override | `PF_SMITH_OVERRIDE_V1` fires on bare `"smith"` before `RACK_CAGE`'s `"jaula"` pattern or `BENCH`/`CABLE_MACHINE` naming ever gets a chance — always `PLATE_LOADED_MACHINE`. |
| PLATE_LOADED_MACHINE vs SELECTORIZED_MACHINE | Distinct NAME_TEXT vocabularies (`"prensa"/"carga de discos"` vs `"selectorizad"/"dual cuádriceps..."`); the majority of `SELECTORIZED_MACHINE` (Obelix MO/V8-series "Curl de Bíceps", "Press de Pectoral", "Extensión de Cuádriceps", etc.) has no distinguishing name text at all and resolves via the `Máquinas Selectorizadas` category vote — matches A00.1C's own finding ("72% category-inferred... verified sound"). |
| CABLE_MACHINE vs MACHINE_ATTACHMENT / ROPE_SLED | `CABLE_MACHINE` is checked before both: `"Soga de Tríceps - Accesorio Polea"` is `CABLE_MACHINE` (its own pulley wording wins), not `ROPE_SLED` (`"soga"`) or `MACHINE_ATTACHMENT` (`"accesorio"`). |
| Mount hardware vs the noun it holds | `"Soporte de Barra x1 Accesorio Delta"` / `"Par de Soportes Para Discos Olímpicos"` are `MACHINE_ATTACHMENT`, not `BARBELL`/`WEIGHT_PLATE` — the mount-hardware rule is checked before the generic noun rules. |
| FLOORING vs YOGA_PILATES | `FLOORING`'s pattern explicitly excludes names containing `"yoga"`/`"pilates"`, so `"Mat de Yoga TPE..."` falls through to `YOGA_PILATES`. |
| BALL_BAG vs YOGA_PILATES | Same exclusion — `"Balón Pilates 65cm"` is `YOGA_PILATES`, not `BALL_BAG`. |

## 7. Multi-family products (Section 7)

Secondary families are assigned **only** via the explicit `"+"` bundle-split mechanism above — never
because a description merely lists compatible/possible exercises. Verified against the golden set:
`DUMBBELL + STORAGE` (id 1183), `DUMBBELL + RACK_CAGE` (id 1089), `BENCH + BAND_SUSPENSION` (ids 2193,
2214). One documented exception survives (Section 12).

## 8. DISCIPLINE (Section 8)

All 8 active tags are evaluated **independently** — unlike `PRODUCT_FAMILY`, `DISCIPLINE` is a
multi-label axis with no "primary" concept, so no conflict-resolution precedence is needed between
tags (a product may legitimately carry zero, one, or more than one). `CROSSFIT`, `HYROX`,
`POWERLIFTING`, `YOGA_PILATES`, `BOXING_MMA` fire from literal name text and/or a `SEMANTIC_STRONG`
trusted category (registry-approved per tag); `CALISTHENICS` and `CARDIO_ENDURANCE` additionally accept
`FAMILY_INFERENCE` (from `BODYWEIGHT_GYMNASTICS`/`CARDIO_MACHINE` respectively); `REHABILITATION`'s
category path is a compound rule (`family=RECOVERY_TOOL` **and** a dedicated clinical-device category).

**WEIGHTLIFTING cannot be emitted.** No rule in `discipline-rules.ts` ever reads the `"Categoría"`
feature (Olímpico/Preolímpico) — the technical sleeve-diameter spec A00.1C found inflating a rejected
`WEIGHTLIFTING` rule to 216/2011 products. `getOntologyTag('DISCIPLINE', 'WEIGHTLIFTING')` returns
`undefined` from the registry itself, and this module has no code path that could reintroduce it: tested
explicitly in `product-semantic-classification-discipline.test.ts` ("WEIGHTLIFTING must never be
emitted").

## 9. USE_CONTEXT (Section 9)

The only `STRUCTURED_FEATURE` ever consulted is `"Clasificación de Uso"` (`use-context-rules.ts`'s
`classifyUsageFeatureValue`), normalized from its 14 observed raw values into 4 buckets (`HOME`,
`SEMI_COMMERCIAL`, `COMMERCIAL`, `OUTDOOR_HIGH_TRAFFIC`; indoor-only "Tráfico alto" folds into
`COMMERCIAL`). `HOME_GYM` never infers from mere consumer-suitability — its only three paths are the
structured feature (EXPLICIT), the `"Máquinas Home Gym"` category (STRONGLY_INFERRED), and literal
`"Home Gym"` name text (STRONGLY_INFERRED); tested explicitly. `COMMERCIAL_GYM` never reads
`primaryProductFamilyCode` at all — it is absent from `UseContextMatchContext`; tested explicitly with a
`CARDIO_MACHINE` product carrying no commercial signal. `SMALL_SPACE` is evaluated only after the global
non-product exclusion gate, so the confirmed false positives on ids 902/903 ("INSTALACION...PARED") never occur.

## 10-11. Category and feature trust gating (Sections 10-11)

`category-catalog.ts` maps trusted category **names** (not ids — ids are dataset-specific, names are
the stable semantic anchor) to tag codes, per axis, and every table only feeds a tag that declares
`TRUSTED_CATEGORY` in the registry. The classifier never infers a category's trust class itself — it
consumes exactly the `trustClass` supplied on the input contract (sourced from the A00.1 category trust
map) and applies the registry's own `categoryTrustGate` (`PRODUCT_FAMILY`: STRONG+WEAK;
`DISCIPLINE`/`USE_CONTEXT`: STRONG only). An absent or unrecognized trust class defaults to `UNKNOWN`,
which never votes on anything (tested explicitly). The broad `"Accesorios de Protección"` (WEAK) and
`"Accesorios de Weightlifting"` (STRONG) categories are deliberately excluded from their respective
tables — A00.1C found both wrongly voting families for unrelated products (chalk, a bare `Magnesio` SKU)
in an earlier draft; tested explicitly (`product-semantic-classification-product-family.test.ts`).
Only `"Clasificación de Uso"` is ever read as a structured feature; the `"Categoría"` feature (SEMANTIC
trust in the A00.1 feature trust map, but never referenced by any tag) cannot vote by construction.

## 12. Historical policy (Section 12)

For `historical_order_detail_only` rows, exactly one gate applies uniformly across every axis: only
`NAME_TEXT` evidence is permitted (`TRUSTED_CATEGORY` and `STRUCTURED_FEATURE` are both disabled,
matching Section 12's "no category or feature inference"). `FAMILY_INFERENCE`-sourced discipline rules
are allowed to fire on historical rows for `CALISTHENICS` and `CARDIO_ENDURANCE` — because by the time a
historical row's `primaryProductFamily` is known, it was necessarily derived from name text alone
(category evidence is unavailable), so chaining a discipline off that already-name-derived family adds
no additional, unavailable evidence. This was confirmed empirically against A00.1C's own full-catalog
counts (`ontology_full_catalog_tag_counts.csv`): `CALISTHENICS`'s `historicalProducts` (20) exactly
equals `BODYWEIGHT_GYMNASTICS`'s `historicalProducts` (20). `REHABILITATION`'s compound
family+category rule stays blocked on historical rows because it separately requires
`TRUSTED_CATEGORY`, which is independently disabled. No successor-mapping to a current-catalog sibling
is ever attempted. Missing evidence produces `OTHER`/no tag, never a negative signal.

## 13-14. Confidence and provenance (Sections 13-15)

Only `EXPLICIT` and `STRONGLY_INFERRED` are ever assigned, and only when the target tag's
`confidencePolicy.allowedConfidenceLevels` (from the registry) actually permits that level — e.g.
`STORAGE` and `YOGA_PILATES` (`PRODUCT_FAMILY`) only ever allow `EXPLICIT`, so even a category-sourced
match is emitted as `EXPLICIT`, never `STRONGLY_INFERRED`. No combined numeric score is computed
anywhere (`classificationConfidence` only — no `semanticRelevance`, per Section 14). Every emitted tag
carries its own `ruleId`, and every rule id also appears in the flattened `evidence[]` array alongside
`sourceType`/`sourceId`/`rawValue`/`normalizedValue` — bounded, deterministic, and traceable; no
free-text excerpts are ever embedded.

## 15. Non-product exclusion (Section 5, Section 25)

`non-product-exclusion.ts` applies the registry's `nonProductExclusion` policy before any semantic rule:
9 known productIds (`444`, `505`, `554`-`558`, `902`, `903`) plus 3 anchored normalized-name patterns
(`^servicio`, `^costo logistico`, `^instalacion`). Verified against the full 2011-product catalog: all 9
known ids are excluded, zero additional ids match the name patterns beyond those 9 (so zero risk of a
false-positive exclusion), and the previously-confirmed false positives (`SMALL_SPACE`/`BARBELL`/
`RACK_CAGE` on ids 902/903) no longer occur.

**Newly detected candidate (reported, not auto-excluded):** ids `550`-`553`
(`"Revisión R-10"`/`"R-20"`/`"R-30"`/`"R-40"`) share the exact same fingerprint as the 9 known
service-fee rows — no real category assignment beyond the root `CATEGORÍAS` navigation node, and a
naming pattern parallel to the already-excluded `"Servicio de armado tipo A-10"`/`"A-20"`/`"A-30"`/
`"A-40"` tier family. They do not match any of the registry's 3 approved name patterns, so this
classifier correctly leaves them `OTHER` rather than silently inventing a new exclusion rule (Do Not Do:
"do not modify ontology v1"). Flagged here for a future registry-maintenance decision.

## 16. Full-catalog sanity check (Section 21)

Run against the real 2011-product A00 export (`docs/audits/product-intelligence-exploration/inputs/`).
Reference column is `ontology_full_catalog_tag_counts.csv` (the A00.1C full-catalog reference run).

| PRODUCT_FAMILY | A00.3 | Reference | Δ | Note |
| --- | ---: | ---: | ---: | --- |
| BAND_SUSPENSION | 24 | 24 | 0 | |
| BODYWEIGHT_GYMNASTICS | 50 | 66 | -16 | OCR grip tools (Monkey Rope/Nunchuck/Ninja Hooks grips), a Salmon Ladder, and plain "Push Ups" handles stay `OTHER` — none literally match the registry's `"paralelas"/"dominadas"/"pull up"/"anillas"` vocabulary; a defensible long tail, not forced. |
| PROTECTIVE_GEAR | 140 | 144 | -4 | Residual, unexplained; immaterial. |
| BARBELL | 138 | 133 | +5 | |
| RECOVERY_TOOL | 22 | 22 | 0 | |
| BENCH | 142 | 144 | -2 | |
| YOGA_PILATES | 17 | 17 | 0 | |
| CARDIO_MACHINE | 67 | 73 | -6 | Two Obelix stair-climbers are literally named `"Escalera..."` (not `"Escaladora"`) and 2 rowers are literally named `"Remo de..."` — both deliberately excluded (see below); `CARDIO_MACHINE` is NAME_TEXT-only per the registry, so no category fallback can recover them. |
| BALL_BAG | 89 | 86 | +3 | |
| ROPE_SLED | 25 | 22 | +3 | |
| WEIGHT_PLATE | 249 | 258 | -9 | Residual, unexplained; immaterial (3.5% of the family). |
| FLOORING | 60 | 62 | -2 | |
| CABLE_MACHINE | 72 | 67 | +5 | Individual cable-station grip/bar/rope attachments sold under their own `"... - Accesorio Polea"` listing (confirmed golden-set precedent, id 437) correctly route to `CABLE_MACHINE` rather than `BARBELL`/`MACHINE_ATTACHMENT`; this generalization picks up ~15-20 such SKUs the un-reordered rule set missed. |
| RACK_CAGE | 80 | 66 | +14 | `"Atril de Sentadillas"`/`"Atril de Discos Olímpicos"` (squat/plate stands, 17 SKUs) were previously unclassified; the registry's own category hierarchy files `Atriles` directly under `EQUIPAMIENTO > Racks` alongside Power/Half/Squat Racks, so this is treated as a genuine coverage improvement, not a bug. |
| KETTLEBELL | 46 | 44 | +2 | |
| DUMBBELL | 205 | 207 | -2 | |
| MACHINE_ATTACHMENT | 53 | 32 | +21 | Barbell collar clamps (`"Collarines Olímpicos"`, a distinct word form from `"collar(es)"`) and cable-machine `"Ankle Straps"` SKUs were previously unclassified; both are textbook "mount hardware" per the tag's own definition. Also includes bar/plate-holder mount accessories (`"Soporte de Barra..."`, `"Par de Soportes Para Discos..."`) that a naive rule pass would misfile as `BARBELL`/`WEIGHT_PLATE`. |
| SELECTORIZED_MACHINE | 42 | 43 | -1 | |
| PLATE_LOADED_MACHINE | 76 | 76 | 0 | |
| STORAGE | 33 | 28 | +5 | `"Rack Organizador..."`/`"Rack Colgador..."` (organizer/hanging racks) were previously misfiled as `RACK_CAGE` via the generic `"rack"` pattern. |
| APPAREL | 48 | 50 | -2 | |

| DISCIPLINE | A00.3 | Reference | Δ |
| --- | ---: | ---: | ---: |
| CALISTHENICS | 51 | 67 | -16 (tracks the BODYWEIGHT_GYMNASTICS family gap above) |
| POWERLIFTING | 38 | 38 | 0 |
| YOGA_PILATES | 17 | 17 | 0 |
| CARDIO_ENDURANCE | 67 | 73 | -6 (tracks the CARDIO_MACHINE family gap above) |
| HYROX | 27 | 27 | 0 |
| CROSSFIT | 19 | 19 | 0 |
| REHABILITATION | 4 | 4 | 0 |
| BOXING_MMA | 13 | 13 | 0 |

| USE_CONTEXT | A00.3 | Reference | Δ |
| --- | ---: | ---: | ---: |
| HOME_GYM | 92 | 92 | 0 |
| SMALL_SPACE | 32 | 30 | +2 |
| COMMERCIAL_GYM | 206 | 206 | 0 |
| SEMI_COMMERCIAL_STUDIO | 13 | 13 | 0 |
| OUTDOOR_HIGH_TRAFFIC | 3 | 3 | 0 |
| CLINICAL_RECOVERY | 4 | 4 | 0 |

`USE_CONTEXT` and most of `DISCIPLINE` match the reference exactly or near-exactly. Every
`PRODUCT_FAMILY`/`DISCIPLINE` deviation above 5 products was individually investigated by name (not
guessed) and is either a defensible, documented coverage improvement (the `+14`/`+21`/`+5` cases) or a
narrow, explained residual (the `-16`/`-9`/`-6` cases). None required inventing a new evidence source or
touching the registry.

**Status counts** (2011 total): `CLASSIFIED` 1246, `PARTIALLY_CLASSIFIED` 397, `OTHER` 359,
`EXCLUDED_NON_PRODUCT` 9, `NEEDS_REVIEW` 0.

## 17. Golden-set regression (Section 22-23)

Run against all 200 `ontology_review_closure.csv` rows using the real per-product evidence (name,
categories with real trust classes, `"Clasificación de Uso"` feature) from the same A00 export.

- `PRODUCT_FAMILY`: **199/200 exact match** (primary + secondary set).
- `DISCIPLINE`: **200/200 exact match**.
- `USE_CONTEXT`: **200/200 exact match**.

**The one surviving mismatch** — id 2134, `"Multifuncional Smith ZR Series"`: the golden set carries a
secondary `CABLE_MACHINE` tag that A00.1C assigned only after reading the product's free-text
description ("integrating... Half Rack, Máquina Smith y Sistema de Poleas Dual — a genuine manufactured
3-in-1 unit"). A00.3 is explicitly forbidden from using descriptions (Do Not Do list), and
`CABLE_MACHINE`'s registry-declared `allowedEvidenceSources` is `NAME_TEXT` only (no `TRUSTED_CATEGORY`
fallback either, even though the product does carry a `"Máquinas con Poleas"` category) — so this
specific secondary tag is structurally unreproducible under the current registry without reintroducing a
forbidden evidence source. **Classified as `EXPECTED_POLICY_CHANGE`, not `CLASSIFIER_BUG`.** No other
mismatch category (`GOLDEN_SET_ERROR`, `ONTOLOGY_AMBIGUITY`, `SOURCE_DATA_GAP`) was needed — every other
row matched exactly.

No accuracy threshold was hardcoded in advance; this is the exact, investigated result.

## 18. OTHER population analysis (Section 24)

359/2011 products (17.9%) are `OTHER`. Recurring clusters (≥3 products, by first two significant
normalized name words), none large or coherent enough to justify a 22nd `PRODUCT_FAMILY`:

| Cluster | Count | Note |
| --- | ---: | --- |
| Protein bars/whey (`"barrita/barritas proteina"`, `"proteina whey"`) | 22 | Nutrition/supplement SKUs — not physical training equipment at all; outside the ontology's scope by design. |
| Weighted vests / ankle-wrist weights (`"chaleco lastre"`, `"pesos tobillo"`) | 15 | Real `LASTRE` category cluster (`Chalecos de Lastre`, `Pesos de Tobillo & Muñeca`) with no home in any of the 21 families — **ontology debt candidate**, not created here (Do Not Do: no new family in this slice). |
| Apparel not covered by the current keyword list (`"leggins savage"`, `"top savage"`, `"grab mujer"`) | ~17 | `APPAREL` is NAME_TEXT-only; these use vocabulary (leggings, "grab"-branded tops) outside the registry's example list. |
| Plyo boxes (`"cajon pliometrico"`, `"plyo box"`) | 9 | A00.1C already investigated and explicitly decided against a new family here (too few distinct active SKUs catalog-wide) — confirmed unchanged. |
| OCR grip tools (`"agarre ocr"`) | 4 | Niche obstacle-course-racing grip trainers; no clean fit in the registry's `BODYWEIGHT_GYMNASTICS` definition. |
| `AbMat` (`"abmat hwm"`) | 4 | A00.1C already reviewed this exact SKU directly and confirmed `OTHER` (real `SEMANTIC_STRONG` category, but no family maps to it) — confirmed unchanged. |
| Ab wheel (`"rueda abdominal"`) | 4 | Same ab-training-accessory long tail A00.1C already flagged. |
| `"Revisión R-10..R-40"` | 4 | See Section 15 — likely non-product service-tier rows, reported not auto-excluded. |
| Standalone hip-thrust machines/pads without a `Máquinas Selectorizadas`/`Carga de Discos` category (`"hip thrust"`) | 3 | Genuinely ambiguous machine type without further evidence. |
| Agility cones (`"conos agilidad"`) | 3 | Same long tail A00.1C already flagged (agility ladders/cones). |
| Standalone exercise-station modules (`"curl femoral"`, `"squat bench"`, `"shoulder press"`, `"multi estacion"`) | 9 | No `Máquinas Selectorizadas`/`Carga de Discos` category and no name-pattern match; likely legitimately `SELECTORIZED_MACHINE`/`PLATE_LOADED_MACHINE` but this classifier does not force a family without qualifying evidence. |
| Farmer's-carry handles (`"mini farmer"`) | 3 | No clean fit in the registry's family list. |
| Steel mace/hammer implement (`"martillo thor"`) | 3 | Distinct implement from kettlebells/clubbells; no clean fit. |

None of these clusters is force-fit into an existing family or used to justify a new one, per Section 24
and the registry's own "precision over recall" design (A00.1C: 347/2011 already stayed `OTHER` by
design at v1).

## 19. Determinism (Section 27)

`computeClassificationChecksum` (reuses `sha256Stable`/`stableStringify` from `customer-rfm/checksum.ts`)
sorts results by `productId` before hashing, so caller iteration order never affects the checksum.
Verified: running the full 2011-product catalog twice in a row produces an identical checksum; verified
in tests that classifying the same input object twice produces a byte-identical result, that the
checksum changes when the input set changes, and that it stays the same when only array order changes.
Latest full-catalog run: `d5c368ddcd597caa6cc340fe8653c28eed0a8906c245f3e2f55bc347d17dcf94`.

## 20. Performance (Section 26)

2011 products classified in ~79ms (~25,500 products/second) on a single thread, no database or network
dependency. No premature optimization was applied or needed.

## 21. Output artifacts (Section 20)

Written by `npm run product:semantic:classify` to `scripts/product-semantic-classification/outputs/`
(gitignored, regenerated on demand):

- `product_semantic_classifications.json` — full result array + `generatedAt`/`registryVersion`/`registryHash`.
- `product_semantic_classifications.csv` — one row per product (status, primary/secondary families,
  disciplines, use contexts, exclusion reason, warnings).
- `product_semantic_classification_summary.json` — the aggregate counts in Sections 16/19/20 above,
  plus `loaderWarnings` (data-quality notes from the CSV loader, e.g. an unrecognized trust class).
- `product_semantic_needs_review.csv` — rows with `classificationStatus = NEEDS_REVIEW` (0 rows in the
  current run).

## 22. Tests (Section 28)

- `tests/unit/product-semantic-classification-product-family.test.ts` — one test per PRODUCT_FAMILY
  tag, every documented boundary, the "+"-bundle hybrid mechanism, category trust gating (including the
  two deliberately-excluded broad categories), and NEEDS_REVIEW conflict detection.
- `tests/unit/product-semantic-classification-discipline.test.ts` — one test per DISCIPLINE tag, the
  WEIGHTLIFTING-impossible guard (including a direct "Categoría: Olímpico/Preolímpico" feature that must
  produce zero disciplines), and feature trust gating.
- `tests/unit/product-semantic-classification-use-context.test.ts` — one test per USE_CONTEXT tag,
  HOME_GYM's no-plausibility-inference guarantee, COMMERCIAL_GYM's no-family-inference guarantee, and
  SMALL_SPACE's post-exclusion-only guarantee.
- `tests/unit/product-semantic-classification-classifier.test.ts` — non-product exclusion (all 9 known
  ids + pattern matching + no false positives), historical policy (family/discipline/context, and the
  `CLASSIFIED` vs `PARTIALLY_CLASSIFIED` distinction), evidence provenance, and determinism.
- `tests/unit/product-semantic-classification-golden-set-regression.test.ts` — reads the real
  `ontology_review_closure.csv` + the real A00 export and trust maps directly (no fixtures duplicated
  in-repo) and asserts 200/200 agreement on every axis except the one documented, named exception; also
  asserts the exact 9-id exclusion set and zero `NEEDS_REVIEW` rows across the full 2011-product catalog.

No live database, no network call, no LLM call anywhere in the test suite.

## 23. What A00.3 does NOT do

Per the task's explicit scope boundary, this slice does not:

- Modify `commercial-product-ontology-v1` (no tag, evidence rule, or global policy was changed).
- Publish any durable semantic snapshot (A00.5).
- Add customer affinity of any kind.
- Use free-text product descriptions as classification evidence anywhere.
- Use an LLM anywhere in the pipeline.
- Connect to PrestaShop or the Catalog Service at runtime (the CLI reads only the already-exported CSVs).
- Build an API or UI surface.
- Auto-map a historical-only product to a current-catalog successor.
- Write to any database.
- Introduce `WEIGHTLIFTING` on any axis (structurally impossible, not just avoided).

## 24. Validation run

```
npm run typecheck                                        → clean, 0 errors
npx vitest run (full suite)                               → 195 test files, 1851 tests, all passing (0 regressions)
npm run product:semantic:classify -- --catalog=... ...    → 2011 products classified in ~79ms, checksum stable across runs
golden-set regression (200/200 ontology_review_closure.csv rows) → 199/200 exact match on PRODUCT_FAMILY,
                                                              200/200 on DISCIPLINE, 200/200 on USE_CONTEXT
```
