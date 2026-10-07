# P2.3C-FIX2: targeted Training closure

FIX2 changes Training V2 source rules and finalization only. It rebuilds all
2048 frozen inputs through the native builder into a new local snapshot/bundle.
Product Semantics, Training V1, Specs, Trust, ontology and semantic-obligations-v2
remain unchanged. It does not activate a bundle or create a Product Functional Role.

## Cable evidence

A sold tobillera/ankle strap, handle/grip/agarre, soga/rope, strap/correa,
passive bar, seat or pad cannot inherit cable resistance from compatibility,
family wording or a host feature. The existing material exclusion still applies.
An actual pulley **with a seat** is not synonymous with a seat **for a pulley**.
Mentioning a seated host does not turn a sold handle into a mechanical module.

For a non-passive accessory module, the existing trusted structured mechanism
feature (for example `Relación de cable y polea: 1:1`) remains sufficient for
DIRECT cable resistance. Material fields are not mechanism proof. Existing
station-name/category positives and independently authorized family derivations
continue under their source guards; weak/circular family provenance stays suppressed.

An accessory cable module without explicit mechanism proof stays unresolved,
including a loaded structure with a sleeve and large dimensions. FIX2 deliberately
does not derive cable resistance from any combination of load/dimensions alone.
It also does not certify a negative: `Polea Alta Remo` plus own load, sleeve and
structure (P247) stays DATA_GAP. Adding trusted explicit mechanism evidence would
allow a positive. Sparse `Accesorio Polea Alta Remo` and `Accesorio Polea con
Asiento` sources (P1624/P897) likewise stay DATA_GAP without restored positives.

This uses existing states and internal deterministic predicates, not new roles,
schemas or product-ID overrides. `V1_ACCESSORY_NAME` remains a V1 exercise coverage
branch; V2 must veto it as negative proof when the cable module is unresolved.
Clear passive parts can produce `V2_PASSIVE_CABLE_ATTACHMENT` where V1 had no
negative branch, but only after positive/review vetoes and frozen source replay.

## Barbell support

The word `rack` alone is insufficient. A positive needs an explicit own open
support name (squat/power/half rack, jaula, atril de sentadillas, plegable wall
rack, powerlifting combo rack), a strong discriminating category, or a trusted
own barbell-support/load feature. A generic maximum load is insufficient.
Storage and host/installation exclusions take precedence. Existing unspecified
Body Pump rack bundles remain AMBIGUOUS, not auto-published.

P1856 loses only BARBELL_SUPPORT, keeping its own PULL_UP, DIP and BODYWEIGHT_SUPPORT.
All 59 previously approved own supports remain. The independent publication
invariant also rejects an unresolved cable accessory mislabeled as a verified negative.

## Evidence and reproduction

Run `node --import tsx cross-projection-audit/training-targeted-closure-audit.mjs`
after the focused/full test suites, typecheck and lint. The audit consumes the
pre-correction fingerprints in `p2-3c-fix2/protected-before.json`, compares to the
frozen P2.3C-FIX candidate and writes only local FIX2 evidence. It verifies native
builder parity, reversed-source/context determinism, schema/identity/registry,
semantic invariants, bundle, exact protected IDs and all new semantic deltas.

The old FIX rules identity remains readable solely as hash-validated historical
evidence. Publication still requires the current policy and source guards.
Large generated evidence is ignored; source/tests/audit/docs/report are reviewable.
Known defect residuals are checked across the corpus without claiming universal
linguistic completeness. Final identities, gates, metrics and hygiene are in
`cross-projection-audit/p2-3c-fix2/REPORT-P2.3C-FIX2.md`.
