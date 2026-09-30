# Catalog Platform V2 — Product & Architecture Requirements Document

**Short name:** CAT-V2  
**Status:** Proposed / implementation planning  
**Date:** 2026-09-30  
**Primary service:** `MS-pesaschile-catalog-service`  
**Primary consumers:** R4 agents, human catalog/CRM applications, internal services  
**Relationship to R4-J1:** CAT-V2 builds on J1 commercial truth; it does not redefine or delay J1 closure.

---

# 1. Executive Summary

Catalog Platform V2 transforms the existing `catalog-service` from a collection of historically accumulated product APIs into a coherent product-domain platform for autonomous agents, human applications and internal systems.

The platform will provide:

1. one authoritative commercial truth for product identity, sellable units, lifecycle, pricing, promotion, availability, stock, sellability and freshness;
2. reproducible product projections for semantics, training capabilities, normalized specifications and relationships;
3. a unified retrieval layer combining exact lookup, lexical retrieval, structured semantics and optional vector retrieval;
4. a narrow agent-oriented discovery primitive, `catalog.discover`, that turns natural product needs into a small, hydrated candidate set;
5. a human-oriented Browse API built on the same truth and retrieval core;
6. later, once the required curated data exists, deterministic multi-product composition through `catalog.compose`;
7. internal/diagnostic surfaces for lineage, snapshots, scores, registries and operations.

The platform will not become a sales agent. It will know the product universe and what combinations are factually feasible; R4 will decide what to ask, what to present, and what action to propose.

---

# 2. Product Vision

> Catalog Platform V2 provides a single authoritative, searchable and composable representation of the product universe for autonomous agents, human applications and internal systems, without requiring consumers to understand PrestaShop or Catalog's internal retrieval, semantic or projection machinery.

Operationally:

```text
Consumer:
"I need X"

Catalog:
"These products satisfy X,
for these structured reasons,
with this current commercial truth."

Consumer:
"Build a feasible solution under these constraints."

Catalog:
"These combinations are feasible,
with this coverage, evidence and limitations."
```

Catalog owns product-domain truth. Catalog does not decide what the customer should buy.

---

# 3. Background / Why This Exists

The existing service evolved incrementally:

- v1 product search/detail/batch;
- recommendation and customer-affinity logic;
- explore and intent resolution;
- product semantics;
- training semantics;
- semantic discovery;
- R3-specific client/capability code;
- J1 commercial v2 truth for R4.

Each generation added an endpoint for a specific consumer without retiring the previous generation.

The result is a service with valuable assets but excessive exposed complexity:
- multiple price/availability engines;
- multiple retrieval mechanisms;
- overlapping semantic surfaces;
- consumer-specific decision logic;
- legacy client code;
- human UI assembling its own product view;
- offline projections with manual/external build paths.

R2/R3 agents were forced to decide which Catalog tool to call, understand internal vocabularies, join IDs with details, reconcile multiple notions of price and availability, and repeatedly hydrate results. This increased tool calls, latency, token usage and semantic errors.

The opposite approach—injecting the complete catalog into the model context—is also unacceptable because the catalog is too large, commercially volatile and noisy.

CAT-V2 resolves the problem by moving product-domain joins and retrieval complexity behind a smaller, coherent public surface.

---

# 4. Goals

## G1 — One commercial truth
All public product surfaces must use the same canonical commercial engine for identity, lifecycle, price, promotion, tax semantics, stock, backorder, sellability and freshness.

## G2 — Product-domain retrieval
Consumers should ask for products, needs or constraints without knowing how Catalog combines exact match, lexical retrieval, concept lexicon, semantic taxonomy, training semantics, normalized specifications or optional vector retrieval.

## G3 — Agent efficiency
R4 should receive small structured candidate sets, not raw snapshots, registries or hundreds of products.

## G4 — Human usability
Humans should be able to browse, filter, inspect and compare products using the same truth and retrieval core.

## G5 — Reproducible product intelligence
Semantics, training capabilities, specifications, relationships and future vector indexes must be versioned projections with lineage, deterministic build inputs, validation, atomic publication and rollback.

## G6 — Safe degradation
Failure of optional intelligence must not invalidate commercial truth.

## G7 — Evidence-gated complexity
Vector retrieval, advanced semantics and composition are enabled only when evaluation shows that they solve measured gaps.

## G8 — Incremental migration
No big-bang rewrite. Existing consumers migrate phase by phase.

---

# 5. Non-Goals

CAT-V2 will not:

- become a Sales Agent;
- decide what product R4 should offer a particular customer;
- personalize using customer identity inside Catalog;
- authorize actions;
- write to PrestaShop;
- use an LLM as the primary retrieval/composition engine;
- use vector storage as source of truth;
- expose price or stock from embeddings/snapshots as current truth;
- send raw RAG chunks to R4;
- implement one generic `ask_catalog_anything` endpoint;
- preserve every legacy endpoint indefinitely;
- require a new distributed datastore without evidence;
- introduce multi-product composition before roles/dependencies/specs support it.

---

# 6. Consumers

## 6.1 R4 agents
Needs:
- low-token responses;
- deterministic identity;
- explicit freshness;
- bounded candidate sets;
- closed enums/codes;
- clear failure semantics;
- reasons/evidence sufficient for grounded reasoning.

## 6.2 Human catalog/CRM users
Needs:
- browse;
- pagination;
- facets;
- filters;
- sort;
- comparison;
- complete inspection;
- relationships;
- semantic/debug visibility where appropriate.

## 6.3 Internal services
Examples:
- Customer Profile semantic batch;
- Quote item truth;
- future Shipping product facts;
- evaluation/operations tooling.

Needs:
- stable service-to-service contracts;
- batching;
- pins/snapshot IDs where relevant;
- no UI-oriented payload assumptions.

## 6.4 Operations / engineering
Needs:
- projection lineage;
- active versions;
- readiness by capability;
- metrics;
- debug scores;
- rebuild status;
- rollback.

---

# 7. Domain Ownership

## Catalog owns
- canonical product identity;
- canonical sellable-item identity;
- product lifecycle;
- category representation;
- product facts/specifications;
- pricing semantics;
- promotion semantics;
- tax representation;
- inventory/availability interpretation;
- backorder;
- sellability;
- product semantic projections;
- product capabilities;
- product relationships with explicit type/source;
- retrieval;
- candidate generation;
- deterministic composition feasibility;
- commercial data freshness/provenance.

## R4 owns
- conversational interpretation;
- clarification strategy;
- customer-context reasoning;
- which candidate to present;
- when to request another search/discovery;
- memory and multi-turn continuity;
- action proposals;
- customer-facing response;
- deciding when a commercial action should be attempted.

## Governance owns
- authorization;
- policy;
- approval;
- mutation authority.

## Customer Profile owns
- customer identity/profile;
- purchase-derived customer attributes;
- customer-specific affinity/personalization evidence.

---

# 8. Core Architectural Principles

## P1 — One Commercial Truth
Every consumer surface must reuse the same commercial truth engine.

## P2 — Retrieval is internal complexity
R4 does not choose between lexical, semantic, structured or vector search engines.

## P3 — Return entities, not chunks
Retrieval returns `productKey`s/signals; Catalog hydrates current product truth before returning candidates.

## P4 — Agent API != Human API
Same domain, different representation.

## P5 — Projections are versioned data products
Every offline-derived projection must have schema version, content hash, source lineage, validation, active pointer and rollback.

## P6 — UNKNOWN is not FALSE
For compatibility, constraints, relationships and incomplete semantics, unknown must be explicit.

## P7 — Deterministic first
Rules, typed semantics, filters and constraint solving are preferred before LLM reasoning.

## P8 — Evaluation before complexity
No vector path or composition engine becomes required without a benchmark demonstrating value.

## P9 — Freshness belongs to the owner
Catalog publishes data validity; consumers may retain expired observations as historical evidence but cannot treat them as current.

## P10 — New capabilities reduce exposed complexity
A new public capability must consolidate/internalize old surfaces rather than multiply tools.

---

# 9. Target Architecture

```text
PrestaShop (read-only)
       │
       ├──────────────── Commercial Truth ──────────────────────────┐
       │                                                            │
       └─ Read-only Extractor ─► Projection Build ─► Active Manifest│
                                  │                                 │
                                  ├─ Product Semantics              │
                                  ├─ Training Semantics             │
                                  ├─ Spec Projection                │
                                  ├─ Relationship Projection        │
                                  ├─ Capability / Role Projection   │
                                  └─ Optional Vector Index          │
                                            │                       │
                                            ▼                       │
                                  Unified Retrieval Layer           │
                         exact · lexical · structured · (vector)    │
                                            │ productKeys + signals │
                                            ▼                       │
                                  Candidate Hydration ◄─────────────┘
                                      │                 │
                                      ▼                 ▼
                                  `discover`        `compose`
                                                     (gated)
                                      │                 │
                                      └────────┬────────┘
                                               ▼
                    ┌──────────────────────────┼──────────────────────────┐
                    ▼                          ▼                          ▼
               Agent API                 Human/Browse API          Internal API
                    │                          │                          │
                    ▼                          ▼                          ▼
                   R4                     CRM / tools                 CP / Ops
```

---

# 10. Agent Domain API

Target public capabilities:

## 10.1 `catalog.search`
Purpose:
- nominal lookup;
- exact SKU/reference;
- product-name search;
- deterministic multi-token lookup.

Not responsible for broad goal discovery, customer personalization or composition.

## 10.2 `catalog.get_product_context`
Purpose:
- coherent product-level facts;
- variant options;
- product-level derived truth;
- specifications;
- current freshness.

## 10.3 `catalog.get_item_context`
Purpose:
- one concrete sellable unit;
- exact quantity pricing;
- promotion;
- tax representation;
- availability/sellability.

Normally used internally by R4/Quote, not necessarily model-visible.

## 10.4 `catalog.discover`
Purpose:
- convert a product need/constraint into a bounded set of relevant, hydrated candidates.

This is the only major new short-term agent primitive.

## 10.5 `catalog.compose` — future/gated
Purpose:
- create feasible multi-product plans under explicit deterministic constraints.

Not available until Phase 5 acceptance criteria pass.

---

# 11. Human/Browse API

The Human API must use the same commercial truth, retrieval layer and projections.

Required capabilities:
- paginated browse;
- category/facet navigation;
- structured filters;
- sort;
- full product inspect;
- variant inspect;
- comparison;
- relationships;
- optional semantic/debug panels for authorized internal users.

Suggested conceptual routes:
- `POST /v2/catalog/browse`
- `GET /v2/catalog/products/{productKey}/context`
- `POST /v2/catalog/compare`

Exact route design remains an implementation decision.

The CRM BFF should remain thin and must not reconstruct commercial truth independently.

---

# 12. Internal / Diagnostic API

Internal surfaces may expose:
- product semantic facts;
- semantic batch;
- registries;
- training semantic facts;
- training registries;
- semantic discovery internals;
- relationship snapshots;
- raw evidence;
- projection manifest;
- active snapshot IDs;
- retrieval debug signals;
- rebuild state;
- health/readiness by capability.

These are not agent tools.

---

# 13. Commercial Truth Requirements

The J1 v2 engine becomes the only target commercial truth engine.

Required invariants:
- `productKey` identifies product;
- `itemKey` identifies concrete sellable unit;
- SKU is lookup/display data, never canonical identity;
- lifecycle explicit;
- variant selection explicit;
- price calculated by Catalog;
- amount/percentage promotions normalized;
- taxes represented without requiring PrestaShop interpretation;
- stock based on correct sellable quantity semantics;
- backorder explicit;
- sellability explicit with typed reason;
- owner freshness explicit (`asOf`, `validUntil`, cache age);
- output contract validated;
- one consistent read/coherence guarantee per context operation.

Legacy price/availability engines must migrate to the v2 engine before legacy removal.

---

# 14. Search Requirements

`catalog.search` remains nominal retrieval.

Required behavior:
- exact SKU/reference;
- exact/strong product name;
- phrase match;
- significant-token fallback;
- deterministic ranking;
- product-level grouping;
- explicit stock/sellability filters;
- bounded output;
- completeness/truncation metadata.

Search must not:
- act as full conceptual discovery;
- hide zero-stock products unless explicitly filtered;
- use customer personalization;
- mix promotion/popularity into textual relevance in a way that overrides exact product match.

Evaluation classes:
- exact SKU;
- exact product name;
- multi-token nominal;
- unit-bearing names;
- known synonyms;
- typos measured separately.

---

# 15. Product Semantics Projection

Purpose: describe what type of commercial product an entity is.

The current product ontology is preserved as a strong asset.

Requirements:
- explicit registry version;
- no silent schema defaults that change meaning;
- evidence/provenance for each assignment;
- content-hash snapshot;
- deterministic build;
- current-catalog presence evaluated safely;
- versioned trust maps.

Existing strong semantics must not be weakened by introducing free-text inference as authoritative evidence.

---

# 16. Training / Capability Projection

Purpose: answer what training functions/exercises a product enables.

The current machine-focused Training Semantics remains valid but incomplete.

CAT-V2 must evolve toward a broader capability projection incorporating:
- existing Training Semantics capabilities;
- training functions;
- curated family-implied capabilities;
- role;
- provenance.

Conceptual form:

```text
ProductCapabilities {
  productKey
  exerciseCapabilities[]
  trainingFunctions[]
  familyImpliedCapabilities[]
  role
  provenancePerAssignment[]
}
```

No new capability taxonomy should be invented casually. Vocabulary changes require evidence, versioning, domain/business review and evaluation.

---

# 17. Product Role

A role axis is required before composition.

Candidate roles include:
- primary_equipment;
- attachment;
- load;
- support;
- accessory;
- consumable;
- service;
- bundle.

Exact vocabulary is a design decision.

Requirements:
- role is versioned;
- role has provenance;
- ambiguous role may be `unknown`;
- role is not inferred from a single noisy text source without validation.

---

# 18. Spec Projection

Current feature text is authoritative but insufficient for machine constraints.

CAT-V2 must create a normalized spec projection while retaining raw provenance.

Initial high-value normalized dimensions may include:
- max_user_weight_kg;
- max_load_kg;
- assembled_length_cm;
- assembled_width_cm;
- assembled_height_cm;
- weight_kg;
- sleeve_diameter_mm;
- internal_diameter_mm.

Every normalized value includes:
- source feature;
- raw text;
- parser/rule version;
- normalized unit;
- status/confidence.

Conceptual shape:

```text
NormalizedSpec {
  key
  value
  unit
  sourceFeature
  rawValue
  derivationRule
  status: parsed | ambiguous | unsupported
}
```

No silent guesses.

---

# 19. Relationship Model

Minimum vocabulary:
- `compatible`
- `required_dependency`
- `optional_accessory`
- `substitute`
- `frequently_bought_together`
- `bundle_component`

Every relation includes:
- source;
- direction;
- provenance;
- confidence/reliability where applicable;
- projection/snapshot version.

Candidate sources:
- deterministic feature matching;
- curated rule files;
- `ps_accessory`;
- `ps_pack`;
- statistical same-order data.

`same_order` must never be treated as compatibility.

---

# 20. Retrieval Architecture

CAT-V2 uses multiple internal candidate generators.

## G1 — exact
- SKU/reference;
- exact names.

## G2 — lexical
- normalized phrase;
- significant tokens;
- governed synonyms/concept lexicon;
- deterministic text ranking.

## G3 — structured
- product family;
- discipline;
- use context;
- training capabilities;
- role;
- normalized specs.

## G4 — vector, optional
Only after evaluation demonstrates incremental value.

All generators return `productKey` + retrieval signals, never current price/stock authority.

Pipeline:
1. merge by `productKey`;
2. dedupe;
3. rank;
4. apply hard filters;
5. hydrate commercial truth;
6. return structured candidates.

---

# 21. Retrieval Ranking

Retrieval relevance and commercial desirability remain separate.

Retrieval signals may include:
- exact reference;
- exact name;
- token coverage;
- synonym/concept match;
- semantic code match;
- semantic confidence;
- spec constraint satisfaction;
- vector similarity if enabled.

Strong exact matches dominate.

Use deterministic tiering/RRF or another explainable method.

Commercial signals may include sellability, promotion, stock or popularity, but must not replace relevance. They may be exposed separately or used only as explicit sort/tie-break behavior.

---

# 22. Vector / RAG Policy

Vector retrieval is optional.

Allowed only as:
- internal candidate generator;
- over a derived deterministic semantic document;
- returning `productKey`s;
- with timeout/fallback;
- with index/model versioning.

Forbidden as:
- commercial truth;
- price source;
- stock source;
- direct chunk provider to R4;
- compatibility/dependency authority;
- justification for a dedicated vector database without operational need.

Initial storage preference: in-memory index + versioned file/snapshot.

A dedicated vector store requires explicit evidence.

---

# 23. Product Semantic Document

If vector retrieval is introduced, use a derived semantic document rather than raw long descriptions.

Conceptual shape:

```text
ProductSemanticDocument {
  productKey
  documentVersion
  name
  brand
  semanticCategoryPath[]
  shortDescription
  selectedSemanticSpecs[]
  taxonomy {
    family[]
    discipline[]
    useContext[]
  }
  trainingCapabilities[]
  synonyms[]
}
```

Always exclude price, promotion, stock, sellability and raw long marketing descriptions.

---

# 24. `catalog.discover`

## Purpose
Resolve conceptual product needs without exposing Catalog internals to R4.

Examples:
- “pesa rusa de 20 kg”
- “algo para entrenar espalda”
- “equipamiento compacto para departamento”
- “banco para una persona de 150 kg”
- “algo parecido a este producto pero más barato”

## Responsibilities
`discover` may:
- interpret a governed concept lexicon;
- use structured hints supplied by R4;
- use exact/lexical/structured/vector retrieval internally;
- evaluate hard product constraints;
- hydrate current commercial truth;
- return a bounded candidate set;
- explain why each candidate matched.

`discover` must not:
- choose what the customer should buy;
- personalize by customer identity;
- solve total-solution budget composition;
- produce sales copy.

Conceptual request:

```text
DiscoverRequest {
  schemaVersion
  need
  hints?
  constraints?
  limit <= 8
}
```

Conceptual response:

```text
DiscoverResponse {
  schemaVersion
  interpretation {
    concepts[]
    appliedConstraints[]
    unrecognizedTerms[]
  }
  candidates[] {
    productKey
    name
    whyMatched[]
    capabilities[]
    constraintResults[]
    priceSummary
    availabilitySummary
  }
  completeness {
    totalCandidates
    truncated
    strategy[]
    degraded[]
  }
  lineage
  freshness
}
```

Exact schema is finalized during implementation.

---

# 25. `catalog.compose` — Future

`compose` is intentionally deferred until data readiness exists.

Use cases:
- “tengo $500.000 y quiero armar un gym”
- “equipa un home gym de fuerza en 2x2 m”
- “arma una solución básica y una ampliable”

Preconditions:
- normalized specs;
- product role;
- broad enough capability coverage;
- dependency model;
- compatibility model;
- goal templates;
- `discover` production-ready;
- reliable price/sellability hydration.

Design principle: deterministic or semi-deterministic solver. No generic LLM planner inside Catalog.

Conceptual pipeline:

```text
goal template
→ required/optional roles
→ discover <= N candidates per role
→ hard constraints
→ dependency/compatibility validation
→ bounded combination enumeration
→ budget validation
→ coverage/ranking
→ 1–3 plans
```

Hard invariants:
- never exceed budget;
- never violate known required dependencies;
- never claim unknown compatibility as true;
- every selected item has a role;
- all current prices come from commercial truth;
- every plan carries evidence/provenance.

---

# 26. Human Browse Requirements

The Human API must eventually support:
- pagination;
- category/family facets;
- price ranges;
- availability filters;
- structured spec filters;
- manufacturer/brand;
- sort;
- product inspection;
- variant inspection;
- product comparison;
- relationships;
- optional semantic evidence for authorized users.

Human browse uses the same retrieval core but may return more data than Agent API.

---

# 27. Projection Build System

Current manual/external CSV-based projection builds must migrate to a reproducible in-repo read-only extractor.

Target pipeline:

```text
PrestaShop change / scheduled extraction
→ read-only extractor
→ normalized projection input
→ semantic/training/spec/relationship/capability builds
→ validation gates
→ unified manifest
→ atomic publish
→ hot reload
→ rollback by active pointer
```

Unified manifest includes:
- manifest schema version;
- build timestamp;
- source extraction identity/hash;
- product semantics snapshot ID;
- training semantics snapshot ID;
- spec projection ID;
- relationship projection ID;
- capability projection ID;
- vector index/model ID if present;
- code/build ref;
- validation summary.

---

# 28. Hot Reload

Projection changes must not require service restart.

Target behavior:
- poll/watch active manifest pointer;
- validate new bundle;
- load atomically;
- expose active version;
- retain previous valid projection for rollback;
- fail closed on incompatible projection schemas.

Commercial truth remains independent from projection hot reload.

---

# 29. Freshness Model

## Live commercial truth
Examples: price, promotion, sellability, stock.

Must expose:
- `asOf`;
- `validUntil`;
- cache age/provenance.

## Offline projections
Examples: semantics, capabilities, normalized specs, relationships, vector index.

Must expose:
- snapshot/index ID;
- builtAt;
- source lineage;
- age;
- active manifest.

Consumers distinguish current truth, older valid projections and degraded/missing projections.

---

# 30. Failure / Degradation Requirements

## Database unavailable
Commercial truth returns typed source-unavailable/retryable failure. Never serve stale price/stock as current beyond owner validity.

## Semantic projection unavailable
Nominal search remains available. `discover` degrades to exact/lexical where possible and declares degradation.

## Vector unavailable
Fall back to exact/lexical/structured. Never make the entire service unavailable.

## Snapshot invalid
Reject activation, retain previous valid snapshot if available, expose degraded capability, never apply semantic-changing defaults.

## Candidate hydration partial failure
Return successfully hydrated candidates if contract allows and report degradation; never fabricate price.

## Compose infeasible
Return typed infeasibility such as budget too low, missing candidate role, missing compatibility data or unsatisfied dependency.

---

# 31. Readiness Model

Readiness is capability-aware.

Conceptual state:

```text
commercialTruth: READY | UNAVAILABLE
productSemantics: READY | DEGRADED | UNAVAILABLE
trainingSemantics: READY | DEGRADED | UNAVAILABLE
relationships: READY | DEGRADED | UNAVAILABLE
retrieval: READY | DEGRADED | UNAVAILABLE
discover: READY | DEGRADED | UNAVAILABLE
compose: READY | DEGRADED | UNAVAILABLE
```

A missing optional projection must not make commercial truth unavailable.

---

# 32. Security and Trust

Requirements:
- Catalog remains read-only against PrestaShop;
- API keys/scopes separated for agent/human/internal consumers;
- per-key rate limits where feasible;
- input bounds;
- bounded caches;
- bounded candidate generation;
- bounded compose search space;
- schema validation;
- staff-authored text treated as data, not instruction;
- long free-text descriptions not authoritative semantic evidence;
- avoid unnecessary storage of raw customer queries;
- logs prefer query class/hash over sensitive text;
- no customer identity required by `discover`/`compose`.

---

# 33. Observability

Per request, log/measure:
- request type;
- retrieval strategy used;
- degraded components;
- candidate counts per generator;
- post-filter counts;
- returned count;
- no-result reason;
- projection/index version;
- hydration freshness age;
- latency per stage;
- failure class.

For compose additionally:
- goal template;
- candidate counts per role;
- combinations evaluated;
- hard-rule exclusions;
- infeasible reason;
- plans returned.

Metrics labels must be bounded-cardinality.

---

# 34. Evaluation Framework

No single overall score.

## Commercial truth
- price parity;
- stock/sellability parity;
- lifecycle correctness;
- freshness correctness.

## Search quality
- exact lookup accuracy;
- recall@10;
- precision@5;
- MRR;
- nDCG where useful.

## Discovery quality
- relevant candidate recall@8;
- irrelevant top-5 rate;
- hard-constraint violation rate;
- unknown-constraint rate;
- no-result correctness.

## Composition quality
- budget adherence;
- dependency correctness;
- compatibility correctness;
- capability/role coverage;
- redundancy;
- diversity;
- explainability/evidence.

## Projection quality
- semantic coverage;
- reviewed precision;
- spec parsing accuracy;
- relationship provenance completeness;
- reproducibility hash equality for same inputs.

---

# 35. Gold Dataset

Create versioned evaluation datasets:

```text
contracts/catalog/eval/
  gold-search-v1.json
  gold-discover-v1.json
  gold-compose-v1.json
```

Query classes:
- exact SKU;
- exact name;
- synonym;
- typo;
- multi-token;
- unit-bearing;
- capability;
- training goal;
- use context;
- structured spec;
- similarity;
- multi-product/budget.

Use commercial review, anonymized real queries where authorized and existing benchmark cases. No PII.

---

# 36. API Versioning

Requirements:
- breaking semantic/schema changes require explicit versioning;
- additive optional fields should be tolerated by older consumers where safe;
- owner fixtures and schemas are versioned;
- Catalog remains contract owner;
- generated clients are preferred to hand-maintained duplicate types where practical.

Agent API evolution must be coordinated with R4.

---

# 37. Legacy Migration

## Preserve temporarily
- v1 APIs required by active CRM consumers;
- semantics batch required by Customer Profile.

## Internalize
- semantic discovery;
- training query;
- registries;
- intent-resolution building blocks;
- relationship/raw recommendation data.

## Deprecate
- v1 search/detail/batch after CRM migration;
- explore;
- resolve-product-intent;
- unused `client/` capability code;
- redundant training query endpoint.

## Remove only after
- replacement production-ready;
- consumers migrated;
- observed traffic zero;
- rollback window completed.

---

# 38. Human/Agent Shared-Core Requirement

Agent and Human APIs must never implement independent product truth.

Both use:

```text
same Commercial Truth
same Projection Bundle
same Retrieval Layer
```

Differences are representation and interaction needs only.

Agent:
- bounded candidates;
- compact;
- structured;
- closed semantics.

Human:
- pagination;
- facets;
- rich detail;
- more evidence/debug.

---

# 39. Integration with R4 Roadmap

CAT-V2 runs in parallel with R4.

## R4-J1 closure dependency
Required only:
- stable J1 commercial truth;
- nominal search fixed;
- production validation complete.

`catalog.discover` is not required to close J1.

## R4-J2 Shipping
May proceed after J1 closure.

Any product data required by Shipping must use an explicit contract; Shipping must not depend on Catalog internals.

## R4-J3 Quote
Uses concrete sellable-item truth and current quantity pricing. Does not wait for `discover`.

## R4-J4 Customer Profile
Can proceed independently while service-to-service semantic batch remains supported.

## R4-J5 Sales Autonomy
CAT-V2 `discover` should be available before final Sales Autonomy quality acceptance where conceptual product discovery is required behavior.

## R4-J6 Benchmark
Benchmark must include Catalog conceptual discovery once `discover` is integrated.

## `catalog.compose`
May arrive after initial J5 capability, but becomes required once advanced multi-product scenarios enter Sales quality gates.

---

# 40. Phased Roadmap

## Phase 0 — J1 Production Closure
Owned jointly by current J1 work, not CAT-V2 feature expansion.

Deliverables:
- J1D closure;
- production B1–B8 evidence;
- OD resolution;
- nominal search fix;
- meaningful category;
- bounded cache;
- fail-closed snapshots;
- capability-aware readiness;
- gold search v0;
- live smoke.

Gate: `R4-J1 CLOSED`.

## Phase 1 — Projection Foundation
Deliver:
- read-only extractor inside catalog-service;
- reproducible normalized projection input;
- unified projection manifest;
- strict schema/version validation;
- hot reload;
- rollback;
- live-presence handling;
- initial normalized Spec Projection;
- fix/cleanup snapshot-dependent tests;
- FBT wiring or explicit removal decision;
- consolidate obsolete classifier/script paths where safe.

Gate:
- same source + same code => same content hash;
- invalid bundle cannot activate;
- previous valid bundle remains usable;
- spec parsing meets reviewed precision target;
- no commercial-truth regression.

## Phase 2 — Unified Retrieval
Deliver:
- exact generator;
- fixed lexical generator;
- governed concept lexicon;
- structured semantic generator;
- merge/dedupe/rank;
- hard-filter stage;
- retrieval observability;
- gold search/discovery v1.

Optional Phase 2b:
- vector generator behind flag only if benchmark shows material incremental gain.

Gate:
- no regression in exact/name queries;
- improved conceptual recall/nDCG;
- deterministic result ordering where expected;
- zero hard-constraint violations marked satisfied;
- vector path can be disabled without functional loss of truth.

## Phase 3 — `catalog.discover`
Deliver:
- stable Agent API contract;
- interpretation block;
- bounded hydrated candidates;
- `whyMatched`;
- constraint results;
- completeness/degradation;
- lineage/freshness;
- R4 adapter/capability integration;
- agent evaluation cases.

Gate:
- required discovery thresholds met;
- <=8 candidates;
- no consumer-facing need to call semantic/training registries;
- R4 does not perform Catalog joins;
- no Catalog customer personalization.

## Phase 4 — Capability, Role and Relationships
Deliver:
- role projection;
- broader product capability projection;
- curated family-implied capabilities;
- normalized compatibility fields;
- deterministic derived compatibility where possible;
- curated required-dependency rules;
- audit/use of `ps_accessory` and `ps_pack`;
- typed relationship projection.

Gate:
- reviewed precision threshold met;
- every relation has source/provenance;
- unknown remains unknown;
- no statistical relation masquerades as compatibility.

## Phase 5 — `catalog.compose`
Deliver:
- versioned goal templates;
- role requirements;
- deterministic solver;
- budget handling;
- dependency/compatibility constraints;
- plan coverage;
- infeasibility semantics;
- Agent and Human representation.

Gate:
- 100% budget adherence;
- 100% known hard dependency adherence;
- no unsupported compatibility claims;
- reviewed plan quality;
- bounded execution cost.

## Phase 6 — Human Convergence and Legacy Retirement
Deliver:
- Human Browse API;
- CRM catalog console migration;
- comparison;
- facets/pagination/sort;
- v1 traffic instrumentation;
- deprecation notices;
- removal plan;
- generated/standard client strategy.

Gate:
- human functional parity or improvement;
- v1 traffic zero before removal;
- rollback plan validated.

---

# 41. Milestone Dependencies

```text
J1 CLOSED
   │
   ├──────────────► R4 J2 Shipping
   ├──────────────► R4 J3 Quote
   │
   └─► CAT-V2 Phase 1
             ↓
          Phase 2
             ↓
          Phase 3 discover ─────────► R4 J5/J6 quality convergence
             ↓
          Phase 4
             ↓
          Phase 5 compose
             ↓
          Phase 6
```

---

# 42. Success Criteria

CAT-V2 is successful when:

1. all consumers use one commercial truth;
2. agents no longer need to understand Catalog semantic registries or retrieval internals;
3. nominal lookup is reliable;
4. conceptual product discovery is solved by one bounded structured call;
5. humans browse the same product truth as agents;
6. projections are reproducible, versioned, hot-reloadable and rollbackable;
7. optional intelligence failures degrade without taking down truth;
8. vector retrieval, if enabled, demonstrates measurable incremental value;
9. multi-product composition never violates hard budget/dependency constraints;
10. legacy surfaces are retired after consumer migration rather than kept indefinitely.

---

# 43. Acceptance Criteria by Consumer

## R4
- <=4 agent-facing Catalog primitives before compose;
- no direct semantic/training registry dependency;
- no Catalog business repair logic;
- no raw PrestaShop semantics;
- bounded candidate payloads;
- current price/stock always hydrated from commercial truth;
- owner freshness respected.

## Humans
- browse/pagination/filter/sort;
- meaningful categories;
- current commercial truth;
- complete product inspection;
- comparison;
- explainable relationships where shown.

## Internal
- batch semantics remain possible where justified;
- lineage/pins/versioning;
- deterministic rebuilds;
- clear readiness by capability.

---

# 44. Key Decisions to Freeze

## D1 — Capability/role ownership
Catalog owns product capability/role data. Business/domain reviewers validate curated mappings. R4 does not own the ontology.

## D2 — Price `from`
Catalog defines and computes it. Only commercially eligible variants participate, with explicit fallback semantics.

## D3 — Category representation
Use meaningful product/category projection, not root default category.

## D4 — Vector enablement
Disabled by default. Enable only after gold-set evidence.

## D5 — Concept lexicon governance
Versioned in Catalog. Business/domain review for curated terms.

## D6 — Compose goal templates
Catalog owns factual template/requirements data. R4 decides when to invoke a template.

## D7 — Customer personalization
Moves outside Catalog.

## D8 — Human Browse ownership
Catalog owns browse-domain output; CRM BFF remains thin.

## D9 — FBT
Expose only as explicitly statistical/inferred relationship, never compatibility.

## D10 — Discover exposure
Expose only after unified retrieval is evaluated.

---

# 45. Deferred Decisions

Do not freeze yet:
- embedding provider/model;
- vector dimensionality;
- dedicated vector datastore;
- final capability vocabulary extension;
- full role vocabulary;
- final compose ranking weights;
- exact Human Browse route shapes;
- final legacy removal dates.

These require phase-specific evidence.

---

# 46. Risks

## R1 — Recreating R2/R3 tool sprawl
Mitigation: `discover` internalizes semantic/retrieval joins and Agent API remains narrow.

## R2 — Semantic drift
Mitigation: strict schema/versioning, unified manifest, fail-closed activation, lineage.

## R3 — Commercial truth divergence
Mitigation: one v2 engine, migration of legacy consumers, parity tests.

## R4 — Overengineering vector search
Mitigation: benchmark-gated optional vector generator, in-memory first.

## R5 — Composition on weak data
Mitigation: Phase 5 blocked on Phase 4 data gate.

## R6 — Hidden human/agent divergence
Mitigation: one domain core, representation-specific APIs only.

## R7 — Manual curation burden
Mitigation: curate only high-value roles/dependencies/capabilities, explicit provenance, incremental coverage.

---

# 47. Required Deliverables

## Architecture / product
- this PRD;
- phase ADRs where required;
- API schemas;
- projection schema/manifest;
- migration/deprecation plan.

## Evaluation
- gold datasets;
- evaluation harnesses;
- per-layer reports.

## Operations
- projection build tooling;
- hot reload;
- readiness/metrics;
- rollback procedures.

## Integration
- R4 adapter/capability changes;
- CRM Human Browse migration;
- CP service-to-service compatibility where required.

---

# 48. Definition of Done

Catalog Platform V2 is not a single release.

The program is complete when:
- Phase 0–6 gates are satisfied;
- R4 uses the intended Agent API;
- humans use the intended Human API;
- internal consumers use explicit service-to-service/internal contracts;
- obsolete legacy surfaces have zero production traffic and are removed or formally archived;
- `catalog-service` no longer exposes internal retrieval complexity as consumer-facing decision burden;
- one commercial truth powers all representations.

---

# Appendix J1D — Items handed over from R4-J1D

Added by R4-J1D (Production Catalog Closure). These are concrete residuals found while closing J1; none blocks J1, all belong to the CAT-V2 phases above.

| # | Item | Evidence / state at J1D | CAT-V2 home |
|---|---|---|---|
| H1 | Typo tolerance | Gold v0 `typo` bucket 0/4 (measured, not gated); v2 search is nominal, no fuzzy matching | §35 gold search v1, hybrid retrieval |
| H2 | Category trust map is a static, generated snapshot | `src/domain/catalog/v2/categoryTrustMap.ts` generated from the 2026-08-29 trust audit (production ids); 35/889 active products get `category: null` (campaign/outlet/service only) | versioned trust maps, projection manifest |
| H3 | Product semantic snapshot must be rebuilt | J1D-CAT-04 rejects snapshots without `catalogPresence`; the 2026-08-29 snapshot (schema 1, 2011 records) has none → semantic discovery unavailable until rebuilt | reproducible semantic extractor, hot reload |
| H4 | Search candidate retrieval is unbounded | v2 retrieval ranks the full candidate set (correct, no pre-ranking truncation) but has no row cap; latency to be observed in the J1D production smoke | retrieval architecture, operational bounds |
| H5 | Two price engines | v1 `priceResolver` and v2 `commercialEngine` coexist; v2 is the J1 truth | §"J1 v2 engine becomes the only target commercial truth engine", legacy retirement |
| H6 | Singular/plural and unit spellings are the only equivalences | explicit, deterministic (gold `supported_synonyms`); anything conceptual (e.g. "pesa rusa" → kettlebell) is out of `catalog.search` | `catalog.discover`, concept lexicon |

# Appendix J1D-R1 — Items handed over after the production smoke (2026-09-30)

Found in the R4-J1D Step 5 production smokes (Catalog `47875d5`, `fea0dc5`). None blocks R4-J1; none is
part of the R4 ↔ Catalog contract gate.

| # | Item | Evidence | CAT-V2 home |
|---|---|---|---|
| H7 | Typo tolerance (live) | live Gold v0: `typo` 0/4 (measured), all hard classes 100 % | as H1 |
| H8 | Broad search latency | `barra` (213 matches) ≈ 1.1–1.3 s server-side on every cache miss; exact/multi-token ≈ 0.1–0.3 s | as H4 |
| H9 | `frequentlyBoughtTogether` never wired in v2 | `bootstrap.ts` passes no provider to `CatalogContractService`: always `unavailable/snapshot_unavailable` while the relationship snapshot is loaded | relationship projection in v2 context |
| H10 | `provenance.serviceBuildRef` | reports `catalog-service@local`; `CATALOG_SERVICE_BUILD_REF` unset in the deployment | operations / deployment metadata |
| H11 | Canonical `publicUrl` | built as `/categories/{id}-{rewrite}.html`; the storefront redirects to `/categorias/…` | Human Browse API / URL projection |
| H12 | Unknown search-body fields | stripped by Fastify instead of rejected (`{query, foo}` → 200) | contract strictness at the HTTP boundary |
| H13 | Relationship snapshot freshness | active snapshot evidence ends 2026-08-21 | relationship rebuild cadence |
| H14 | H3 update | production's active product semantic snapshot (`a86a8c6f…`, 2026-09-10) carries `catalogPresence` on 2011/2011 records — compatible; only the archived 2026-08-31 build lacked it | — (resolved) |
| H15 | H5 update: three price paths | v2 `commercialEngine` and commercial-truth `CommercialPriceCalculator` share `prestashopUnitPrice` (J1D-R1); v1 `priceResolver` still prices on its own and ignores zero-dated promotions | `CAT-HOTFIX-ZERO-DATE-PROMOTIONS`, then single engine |
