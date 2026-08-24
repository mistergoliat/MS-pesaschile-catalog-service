# A11.2-B — Catalog Search Stopword Retrieval Fix

## Objetivo

Corregir el fallback SQL tokenizado de `MySqlCatalogRepository.getSearchCandidates` para que
palabras de relleno en español (`de`, `del`, `la`, `el`, `los`, `las`, `un`, `una`) dejen de
participar como condición `AND` obligatoria, sin tocar ranking, contratos HTTP, ni el algoritmo
de `resolve-product-intent` (T12).

## Root cause (confirmado por lectura directa, no por la auditoría previa)

`MySqlCatalogRepository.getSearchCandidates` (`src/infrastructure/repositories/mysqlCatalogRepository.ts`)
ejecuta dos rutas de retrieval:

1. Una consulta de **frase** (`p.reference = ? OR pl.name = ? OR pl.name LIKE ? OR ...`).
2. Si esa frase no cubre por completo los tokens del query (`shouldRunNameTokenFallback`), un
   **fallback tokenizado** que exige, para cada token de `tokenizeCatalogSearchText(query)`, un
   `pl.name LIKE '%token%'` — todos unidos por `AND`.

Antes del fix, ese segundo paso usaba `tokens` sin filtrar. Para
`"discos olimpicos de 20kg"`, `tokenizeCatalogSearchText` produce
`['discos', 'olimpicos', 'de', '20kg']`, y el fallback exigía:

```sql
pl.name LIKE '%discos%' AND pl.name LIKE '%olimpicos%' AND pl.name LIKE '%de%' AND pl.name LIKE '%20kg%'
```

El producto real `"Par Discos Olímpicos Grip Rubber 20kg | PROmachine"` no contiene la
subcadena `"de"`, así que la condición `pl.name LIKE '%de%'` lo descartaba aunque los otros tres
tokens matchearan perfectamente.

Confirmado además:

- **El ranking ocurre después y no puede rescatar nada**: `MySqlSearchProvider.search`
  (`src/infrastructure/search/mysqlSearchProvider.ts`) solo ordena/puntúa lo que
  `repository.getSearchCandidates` ya devolvió. Si el candidato nunca llega, no hay señal de
  ranking que lo recupere.
- **T12 comparte el mismo retrieval**: `CatalogProductIntentProvider.search`
  (`src/infrastructure/catalog/catalogProductIntentProvider.ts`) llama a
  `CatalogApplicationService.searchProducts(term, ...)` con `term = query.normalized` de
  `DefaultProductQueryNormalizer` — que **no** filtra stopwords en el campo `normalized` (solo en
  `tokens`, usado por el ranker de T12, no por el retrieval). Ese `term` llega íntegro
  (con `"de"` incluido) a `MySqlSearchProvider` → mismo repositorio → mismo bug.
- El heurístico existente `shouldUseNameTokenFallback` (que decide *si* correr el fallback) no
  necesitó cambios: ya evita el fallback para queries compuestas solo por tokens cortos sin una
  unidad canónica (p. ej. `"de la"`), lo cual además garantiza que el nuevo filtro de stopwords
  nunca vacía el conjunto de tokens obligatorios (ver "Casos de borde").

## Fix

Un helper de dominio nuevo, usado únicamente para construir el conjunto de tokens obligatorios
del fallback — no para tokenización general, ranking, logging ni `resolution reasons`.

**Ubicación:** `src/domain/catalog/searchTextNormalization.ts`

```ts
const CATALOG_SEARCH_STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una']);

export function filterCatalogSearchStopwords(tokens: readonly string[]): string[] {
  const significant = tokens.filter((token) => !CATALOG_SEARCH_STOPWORDS.has(token));
  return significant.length > 0 ? significant : [...tokens];
}
```

**Punto de uso (único):** `src/infrastructure/repositories/mysqlCatalogRepository.ts`,
`getSearchCandidates`, justo antes de construir el fallback tokenizado:

```ts
const mandatoryTokens = filterCatalogSearchStopwords(tokens);
const tokenCandidates = this.mapSearchCandidateRows(await this.fetchSearchCandidateRows({
  searchPredicateSql: mandatoryTokens.map(() => 'pl.name LIKE ?').join(' AND '),
  searchValues: mandatoryTokens.map((token) => `%${token}%`),
  includeOutOfStock,
  limit,
}));
```

`tokens` (sin filtrar) se sigue usando sin cambios para `shouldUseNameTokenFallback` — la
heurística que decide si el fallback corre — porque ese comportamiento ya era correcto y no es
parte del bug.

### Por qué esta capa (opción B, alcance mínimo)

- **No** en `tokenizeCatalogSearchText`: esa función alimenta también el ranking
  (`searchTextRelevance.ts`, `evaluateCatalogSearchTextRelevance`, `catalogSearchTextTokenCoverage`)
  y el phrase-matching. Filtrar ahí habría cambiado `nameTokenCoverage`, `matchType` y el orden de
  resultados para *toda* búsqueda con estas palabras — fuera de alcance (Parte 5/6 del pedido).
- **Sí** un helper de dominio + un único punto de invocación en el repositorio: el helper vive
  junto a `tokenizeCatalogSearchText` porque conceptualmente es normalización de texto de
  búsqueda (testeable de forma aislada), pero su *efecto* queda confinado exactamente al lugar
  donde se construye la restricción SQL obligatoria — el único lugar donde el bug existía.
- T12 se beneficia automáticamente porque comparte el mismo `getSearchCandidates`; no se duplicó
  ningún filtrado dentro de `product-intent/`.

## Stopwords elegidas

Lista mínima y conservadora, igual a la propuesta como baseline: `de`, `del`, `la`, `el`, `los`,
`las`, `un`, `una`. Ninguna palabra comercial (`para`, `con`, `sin`, `pro`, `max`, `mini`, `home`)
se agregó sin evidencia. Ningún número, unidad, marca o referencia puede coincidir con esta lista
porque `tokenizeCatalogSearchText` ya canonicaliza unidades a la forma `\d+(?:kg|g|lb|mm|cm|m)`
antes de tokenizar (`20kg`, `15kg`, `50mm`, `2m` nunca son iguales a una palabra de 2–3 letras de
la lista).

## Casos de borde

`filterCatalogSearchStopwords` cae de vuelta a los tokens originales si el filtrado deja el
conjunto vacío — defensivo, pero en la práctica nunca se activa hoy: `shouldUseNameTokenFallback`
solo permite correr el fallback cuando hay al menos un token con unidad canónica (que nunca es
stopword) o cuando no hay ningún token corto/alfabético en absoluto (lo cual implica que tampoco
hay stopwords, ya que las 8 stopwords tienen 2–3 letras). Por lo tanto:

- `"de la"`, `"el"`, `"una"` (solo stopwords): el fallback tokenizado **no se ejecuta en
  absoluto** — comportamiento preexistente de `shouldUseNameTokenFallback`, sin cambios. No hay
  SQL inválido ni match masivo porque no hay SQL adicional.
- Cualquier query que sí dispara el fallback y contiene una stopword, siempre conserva al menos
  un token significativo como condición obligatoria.

## Qué no se cambió

- Ranking: `searchTextRelevance.ts`, `compareCatalogSearchRankEntries`, `matchType`, tie-breakers
  — intactos.
- `tokenizeCatalogSearchText` / `catalogSearchQueryVariants` — intactos; siguen incluyendo
  stopwords para coverage/ranking/logging.
- `shouldUseNameTokenFallback`, `hasFullNameTokenCoverage`, `shouldRunNameTokenFallback` —
  intactos.
- Algoritmo de `resolve-product-intent` (normalizer, synonyms, constraints, ranker,
  resolutionPolicy) — intacto; se beneficia por composición, no por duplicación.
- Contrato HTTP, response schemas, error codes, auth, env vars, límites, cache key — sin cambios.
  El fallback sigue siendo como máximo 1 query de frase + 1 query tokenizada por variante de
  query (igual que antes); no se agregaron round trips.

## Tests

- `tests/unit/catalogSearchTextNormalization.test.ts` — nueva sección
  `filterCatalogSearchStopwords`: cada stopword individual, tokens comerciales que no deben
  filtrarse (`para`, `con`, `sin`, `pro`, `max`, `mini`, `home`), unidades/números que nunca se
  filtran, fallback a tokens originales cuando todo es stopword, array vacío.
- `tests/unit/mysqlCatalogRepository.test.ts` — nueva sección `stopword retrieval fallback
  (A11.2-B)` con los casos SEARCH01–SEARCH10 pedidos: `"discos olimpicos de 20kg"`,
  `"disco olimpico de 20kg"`, regresión de `"discos olimpicos 20kg"` /
  `"disco olimpico 20 kg"`, `"del"` intermedio, `"el"`/`"la"` intermedios, queries solo-stopword
  (`"de la"`, `"el"`, `"una"`, sin llamada SQL adicional), unidad nunca filtrada, y una prueba
  explícita de que el fallback sigue siendo `AND` (no se convirtió en `OR`) usando el nombre real
  `"Par Discos Olimpicos Grip Rubber 20kg | PROmachine"` y verificando los valores `LIKE`
  generados (sin `%de%`, `%del%`, `%el%`, `%la%`).
- `tests/integration/productIntentRuntimeWiring.test.ts` — nueva sección `Product Intent
  stopword retrieval fix (A11.2-B)`: wiring real de `MySqlCatalogRepository` +
  `MySqlSearchProvider` + `CatalogProductIntentProvider` + `DefaultProductIntentResolutionService`
  (sin stubear el retrieval) contra un pool falso que solo devuelve el candidato si los tokens
  `LIKE` mandatorios realmente construidos matchean el nombre real del producto — así la prueba
  falla si el fix se revierte, sin depender de contar llamadas SQL exactas. Confirma
  `resolution.status !== 'no_match'` para `"discos olimpicos de 20kg"` y
  `"disco olimpico de 20kg"`, sin exigir `resolved` (puede ser `clarification_required` según los
  candidatos reales).
- Verificado manualmente que los tests nuevos **fallan** contra el código sin el fix (revertido
  temporalmente) y **pasan** con el fix — confirmando que son regresiones reales, no tautologías.

## Smoke (read-only)

No ejecutado. Requiere levantar el servicio localmente contra la base de datos real configurada
en `.env` (host/credenciales de solo lectura), y no hay confirmación en este contexto de que esa
conexión esté disponible o sea segura de disparar de forma autónoma. Si se desea, correr:

```bash
npm run dev   # en una terminal
npm run smoke -- --query "discos olimpicos de 20kg" --api-key <key>
```

y repetir con los 6 queries de la Parte 10 del pedido original, comparando conteos de resultados
antes/después. Apagar el servidor local al terminar.

## Riesgos / deuda

1. La lista de stopwords es intencionalmente mínima; si aparecen nuevos casos reales de retrieval
   fallido por otra palabra de relleno (p. ej. otras preposiciones), extender
   `CATALOG_SEARCH_STOPWORDS` es un cambio de una línea en el mismo archivo.
2. El fallback defensivo de `filterCatalogSearchStopwords` (volver a los tokens originales si el
   filtrado los vacía) no tiene hoy ningún caso real que lo ejercite, dado el heurístico existente
   — es una red de seguridad barata para si `shouldUseNameTokenFallback` cambia en el futuro, no
   un requisito actual.
3. No se corrió el smoke read-only contra la base real (ver arriba) — pendiente si el equipo
   quiere esa confirmación adicional antes de desplegar.

## Veredicto

```text
A11_2_B_CATALOG_STOPWORD_FIX_VALIDATED
```

Root cause confirmado por lectura directa, fix mínimo aplicado en una sola capa (repository
fallback, con helper de dominio reutilizable), `"de"`/`"del"`/`"la"`/`"el"` ya no participan como
restricción SQL obligatoria, T12 se beneficia por composición sin duplicar lógica, ranking y
contratos HTTP intactos, y las regresiones nuevas (unit + integración) fallan sin el fix y pasan
con él. Pendiente únicamente el smoke read-only opcional contra la base real, no bloqueante para
este alcance.
