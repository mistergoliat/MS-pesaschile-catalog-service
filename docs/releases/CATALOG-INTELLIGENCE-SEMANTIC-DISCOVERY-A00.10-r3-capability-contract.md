# CATALOG-INTELLIGENCE SEMANTIC-DISCOVERY-A00.10 — R3 Capability Contract

Status: `R3_SEMANTIC_DISCOVERY_CAPABILITY_READY_WITH_DEBT`

## Scope and boundary

This release adds the server-side R3 capability client for Catalog's combined
semantic discovery surface. The stable capability name is:

```text
search_products_by_semantics
```

The capability translates a planner-owned structured intent into Catalog's
HTTP request. It does not interpret natural language, classify products,
maintain semantic truth, relax requirements, rank commercially, or hydrate
price/stock data.

R3 owns intent interpretation, canonical-code selection, required versus
preferred decisions, explicit relaxation, follow-up decisions, and
conversation state. Catalog owns the canonical registries, code validation,
Product Truth matching, cross-domain intersections, deterministic semantic
ranking, explanations, and snapshot lineage.

The implementation lives in `client/semanticDiscoveryCapability.ts`. Planner
code depends on `SemanticDiscoveryCapabilityPort`, never on the HTTP route.

## Planner-facing input

Only semantic constraints and a bounded result limit are exposed:

```json
{
  "requirements": [
    {
      "axis": "USE_CONTEXT",
      "codes": ["HOME_GYM"],
      "mode": "required",
      "match": "any"
    },
    {
      "axis": "BODY_REGION",
      "codes": ["LOWER_BODY"],
      "mode": "required",
      "match": "any"
    }
  ],
  "limit": 20
}
```

Supported axes are exactly:

```text
PRODUCT_FAMILY
DISCIPLINE
USE_CONTEXT
EXERCISE_CAPABILITY
TRAINING_FUNCTION
BODY_REGION
MUSCLE_GROUP
TRAINING_PATTERN
```

`TRAINING_GOAL`, RFM, customer segments, price, stock, and commercial scores
are not capability axes. Commercial filters such as `minPrice`, `inStock`,
brand, and price sorting belong to a separate capability.

Requirements use `mode: required | preferred` and `match: any | all` exactly as
provided. The adapter does not reinterpret, reorder, or weaken them. It
rejects empty requests, unknown axes, unknown codes, duplicate codes or
requirements, excessive requirements, and invalid relation filters before
issuing the semantic query.

Relations are optional. Omitting them preserves Catalog defaults:

- `EXERCISE_CAPABILITY`, `BODY_REGION`, `MUSCLE_GROUP`, and
  `TRAINING_PATTERN`: `DIRECT`, `SUPPORTED`.
- `TRAINING_FUNCTION`: `DIRECT`, `FAMILY_DERIVED`.
- Product axes do not accept relations.

The adapter accepts canonical codes only. Examples include `HOME_GYM`,
`LOWER_BODY`, `LEG_PRESS`, `CABLE_RESISTANCE`, `BACK`, and `PULL`. Natural
language such as `casa`, `piernas`, or `pesas libres` is not sent to Catalog.

Interpretation examples for the future R3 planner are guidance, not Catalog
lexical rules:

| Intent | Structured constraint |
| --- | --- |
| para piernas | `BODY_REGION=LOWER_BODY` |
| para pecho | `MUSCLE_GROUP=CHEST` |
| para hacer remo | `EXERCISE_CAPABILITY=ROW` |
| una polea | potentially `TRAINING_FUNCTION=CABLE_RESISTANCE` |
| para home gym | `USE_CONTEXT=HOME_GYM` |
| rack para barra | `PRODUCT_FAMILY=RACK_CAGE` and/or `TRAINING_FUNCTION=BARBELL_SUPPORT` |

Ambiguous phrases remain planner concerns. For example, `remo` may mean a
strength `ROW` capability or a cardio rower; R3 must use context or ask a
follow-up question.

## Catalog adapter request and output

The infrastructure adapter maps the planner input internally to:

```text
POST /v1/products/semantic-discovery/query
{
  "schemaVersion": 1,
  "requirements": [...],
  "options": { "limit": 20 }
}
```

HTTP-only fields and snapshot pins are not exposed to the planner. Optional
lineage pinning is available on a capability instance with `pinLineage: true`.
When enabled, the first successful result's source pins are applied to later
dependent calls. A single 409 retry may clear those pins and rerun the exact
same constraints; no retry ever relaxes semantics. The default is unpinned.

The capability output is structured and compact:

```json
{
  "results": [
    {
      "productId": 1273,
      "matchedRequirements": [
        {
          "axis": "EXERCISE_CAPABILITY",
          "requestedCodes": ["LEG_PRESS"],
          "matchedCodes": ["LEG_PRESS"],
          "source": "TRAINING_SEMANTICS",
          "mode": "required",
          "match": "any",
          "relationTypes": ["DIRECT"],
          "reason": "required_match"
        }
      ],
      "productSemantics": {},
      "trainingSemantics": {}
    }
  ],
  "totalMatches": 1,
  "truncated": false,
  "lineage": {}
}
```

`matchedRequirements` is the evidence available to the agent: it preserves
axis, requested/matched codes, source, mode, match, relation types, and
confidence levels. The result projection retains key semantic facts but
removes redundant classifier metadata and evidence payloads from the prompt.
Lineage remains machine-readable. The adapter never turns semantic evidence
into user-facing prose.

An empty result is a successful result (`results=[]`, `totalMatches=0`). R3
must distinguish this `NO_MATCH` state from a capability error so a later
planner can explicitly relax a requirement or ask a question.

## Registry synchronization

Catalog remains the source of truth. The capability has no handwritten code
enum. It lazily loads only the registry needed by a query, or can load both at
startup through `getSemanticDiscoveryRegistry`:

- `GET /v1/products/semantics/registry` for Product Semantic axes and codes.
- `GET /v1/products/training-semantics/registry` for Training Semantic axes and
  codes.

The registry response is validated for published status, required axes,
duplicate axes/codes, and schema compatibility before a semantic request is
sent. A runtime can call `refreshRegistry()` during deployment or a controlled
registry refresh. The loaded ontology/registry hashes are retained in the
registry object and query lineage comes from the semantic response.

This is a dynamic synchronization strategy: Catalog registry definitions are
authoritative, and a malformed or incompatible registry produces
`registry_sync_failure`. A future build-time generated contract may reduce
startup dependency on Catalog, but it must still validate its generated hash
or version against Catalog before activation.

## Errors and retry policy

`SemanticDiscoveryCapabilityError` hides Catalog HTTP details from the
planner and exposes a stable category, code, correlation id, and retryability:

| Catalog condition | Capability mapping |
| --- | --- |
| local/schema or Catalog 400 | `input_error` / `CAPABILITY_INPUT_ERROR` |
| 409 snapshot mismatch | `snapshot_mismatch` / `SEMANTIC_VERSION_MISMATCH`, retryable |
| 503, timeout, or 5xx | `temporarily_unavailable`, retryable |
| 401/403 | `unauthorized` |
| 429 | `rate_limited`, retryable |
| incompatible registry | `registry_sync_failure` |
| malformed successful response | `invalid_response` |

The shared Catalog client retries read-only transient 5xx/transport failures
once with the identical request. It never retries 400 or an ordinary 409.
Pin-managed execution may perform the one explicit 409 lineage retry described
above.

## Two-stage discovery

Semantic eligibility and commercial state remain separate:

```text
search_products_by_semantics(intent)
  → productIds + semantic evidence
  → existing batch product capability
  → names, prices, variants, stock, freshness
```

`searchProductsBySemanticsWithDetails` is an explicit orchestration helper. It
first completes semantic discovery, then hydrates the returned IDs through the
existing batch product capability in chunks of 20. The semantic adapter itself
does not access the database and does not perform N+1 hydration.

## Security and observability

The Catalog API key is supplied in the server-side `CatalogClientContext` and
is sent only as `x-api-key`. It is not part of the planner input, tool result,
prompt, or browser contract. The capability logs only the stable capability
name, axes, required/preferred counts, result counts, truncation, lineage,
latency, and error category. It never logs customer language because this
contract accepts no natural-language field.

## Test coverage

`tests/unit/semanticDiscoveryCapability.test.ts` covers:

- exact planner-to-Catalog request mapping;
- all supported axis families and registry-backed code validation;
- required/preferred and any/all fields remaining structured;
- relation restrictions;
- zero matches versus failures;
- 400 and 409 error mapping;
- optional lineage pinning and one retry;
- dynamic loading of both authoritative registries;
- two-stage batch hydration.

Natural-language LLM tests are intentionally not included. They belong to
A00.11, which will test intent interpretation and tool selection.

## Known debt

- This repository provides the Catalog-facing R3 capability adapter; the R3
  planner/runtime still needs to adopt the port in its own repository.
- Registry freshness is controlled by explicit capability refresh/instance
  lifecycle; a shared deployment registry cache and generated hash check remain
  future runtime work.
- The compact projection intentionally defers richer agent-facing semantic
  explanation policy to the later R3 conversational integration.
- Product detail hydration remains a separate commercial capability and is not
  part of semantic truth.

## Acceptance decision

`R3_SEMANTIC_DISCOVERY_CAPABILITY_READY_WITH_DEBT`

Next release: `A00.11 — R3 Semantic Intent Planning + Tool Selection`.

