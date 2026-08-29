# CATALOG-INTELLIGENCE-A00.4.1 - Existing Family Miss Adjudication

Status: **READY**
Type: read-only domain/evidence adjudication for the 32 A00.4 existing-family-miss candidates.

## 1. Scope

This slice reviews exactly the 32 products flagged by A00.4 as:

`CURRENT_EXISTING_FAMILY_MISS`

It does not modify:

- ontology registry
- classifier rules
- ontology version
- ontology hash
- semantic checksum
- snapshot generation
- production runtime
- SearchProducts V2
- relationship engine
- `customer-profile`

Production runtime changed: **NO**

## 2. Methodology

The adjudication re-used the A00.4 candidate set derived from the acceptance audit dated
`2026-08-28` and reviewed each row against the unchanged v3 classifier
output on `2026-08-29`.

For each candidate, the review checked:

1. what existing family, if any, actually fits the product;
2. what evidence the current row really exposes;
3. whether that evidence is allowed by the current family policy;
4. whether a future rule candidate could be added without evident false positives in the local
   neighborhood.

Neighborhood review explicitly considered nearby products sharing:

- the relevant name token;
- trusted categories;
- structured machine features;
- the likely target family.

## 3. Evidence policy

Evidence priority used in the adjudication:

1. `STRUCTURED_FEATURE`
2. `TRUSTED_CATEGORY`
3. `NAME_TEXT`
4. bounded combinations of real signals

Still forbidden:

- `FREE_TEXT_DESCRIPTION`
- `CAMPAIGN_CATEGORY`
- `NAVIGATION_CATEGORY`
- `LEGACY_CATEGORY`
- `UNKNOWN_CATEGORY`
- `NOISE_FEATURE`
- `PRESENTATION_FEATURE`
- `LOGISTICS_FEATURE`

Current classification checksum remained unchanged:

- expected: `83d97a9ce4fb90fcf0159f80e81cc64e5518ae8be861659adc68a5c854bc3fe3`
- observed: `83d97a9ce4fb90fcf0159f80e81cc64e5518ae8be861659adc68a5c854bc3fe3`
- unchanged: `true`

## 4. Full adjudication table

```csv
productId,name,currentStatus,candidateFamily,availableEvidence,allowedEvidence,disallowedEvidence,trustedCategories,structuredFeatures,nameSignals,decision,decisionReason,ruleCandidate,falsePositiveRisk,commercialHistory,activeStatus
280,Extensión de Cuádriceps MO Series | Obelix,OTHER,SELECTORIZED_MACHINE,NAME_TEXT:extension de cuadriceps || STRUCTURED_FEATURE:34:Pila de Stack=80 kg.[SEMANTIC],NAME_TEXT:extension de cuadriceps,STRUCTURED_FEATURE not allowed here: 34:Pila de Stack=80 kg.[SEMANTIC] || FORBIDDEN_CATEGORY:61:Obelix MO Series[LEGACY] ; 2:CATEGORÍAS[NAVIGATION],N/A,34:Pila de Stack=80 kg.[SEMANTIC],extension de cuadriceps,CLEAR_EXISTING_FAMILY,"The exact Spanish machine noun ""extension de cuadriceps"" already maps to a classified selectorized neighbor and does not collide with the plate-loaded wording actually used elsewhere in this catalog.",NAME_TEXT exact phrase: /\bextension de cuadriceps\b/ -> SELECTORIZED_MACHINE,LOW,orders=14 units=14 revenue=13707047,false
416,RowErg | Concept2,OTHER,CARDIO_MACHINE,NAME_TEXT:rowerg || TRUSTED_CATEGORY:69:Gimnasia y Acondicionamiento[SEMANTIC_STRONG] || STRUCTURED_FEATURE:24:Pantalla=Monitor PM5 con conexión Bluetooth Smart y compatible con unidad flash USB[SEMANTIC],NAME_TEXT:rowerg,TRUSTED_CATEGORY not allowed here: 69:Gimnasia y Acondicionamiento[SEMANTIC_STRONG] || STRUCTURED_FEATURE not allowed here: 24:Pantalla=Monitor PM5 con conexión Bluetooth Smart y compatible con unidad flash USB[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],69:Gimnasia y Acondicionamiento[SEMANTIC_STRONG],24:Pantalla=Monitor PM5 con conexión Bluetooth Smart y compatible con unidad flash USB[SEMANTIC],rowerg,CLEAR_EXISTING_FAMILY,"The product name is the ergometer product type itself; ""rowerg"" is cardio-specific and no conflicting strength-machine neighbor shares that token.",NAME_TEXT exact phrase: /\browerg\b/ -> CARDIO_MACHINE,LOW,orders=8 units=8 revenue=11613000,false
448,Shoulder Press T8 Series | Obelix,OTHER,PLATE_LOADED_MACHINE,NAME_TEXT:shoulder press || STRUCTURED_FEATURE:2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=250 kg. (por lado)[SEMANTIC] ; 48:Diámetro de manga=Ø50 mm[SEMANTIC],NAME_TEXT:shoulder press,STRUCTURED_FEATURE not allowed here: 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=250 kg. (por lado)[SEMANTIC] ; 48:Diámetro de manga=Ø50 mm[SEMANTIC] || FORBIDDEN_CATEGORY:62:Obelix T8 Series[LEGACY] ; 2:CATEGORÍAS[NAVIGATION],N/A,2:Categoría=Olímpico[SEMANTIC] || 12:Peso máximo de carga=250 kg. (por lado)[SEMANTIC] || 48:Diámetro de manga=Ø50 mm[SEMANTIC],shoulder press,CONDITIONAL_EXISTING_FAMILY,"The family is credible, but ""shoulder press"" also appears on selectorized machines. A safe closure needs a plate-loaded guard such as Olympic sleeve/load features, not the noun alone.","NAME_TEXT ""shoulder press"" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE",MEDIUM,orders=0 units=0 revenue=0,false
1023,MAQUINA CUADRICEPS,OTHER,,NAME_TEXT:maquina cuadriceps,N/A,FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],N/A,N/A,maquina cuadriceps,DATA_QUALITY,"The row exposes only a generic name (""maquina cuadriceps"") with no trusted category and no structured features, so domain review cannot land a reproducible family decision.",,HIGH,orders=0 units=0 revenue=0,false
1070,Linear Leg Press PL Series | Obelix,OTHER,PLATE_LOADED_MACHINE,NAME_TEXT:linear leg press || STRUCTURED_FEATURE:2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=500 kg.[SEMANTIC],NAME_TEXT:linear leg press,STRUCTURED_FEATURE not allowed here: 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=500 kg.[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],N/A,2:Categoría=Olímpico[SEMANTIC] || 12:Peso máximo de carga=500 kg.[SEMANTIC],linear leg press,CLEAR_EXISTING_FAMILY,"The exact name ""linear leg press"" is already inside the plate-loaded neighborhood and does not collide with the selectorized wording used by the seated-stack variant.",NAME_TEXT exact phrase: /\blinear leg press\b/ -> PLATE_LOADED_MACHINE,LOW,orders=3 units=3 revenue=4249990,false
1071,Linear Hack Squat PL Series | Obelix,OTHER,PLATE_LOADED_MACHINE,NAME_TEXT:hack squat || STRUCTURED_FEATURE:2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=500 kg.[SEMANTIC],NAME_TEXT:hack squat,STRUCTURED_FEATURE not allowed here: 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=500 kg.[SEMANTIC] || FORBIDDEN_CATEGORY:459:PRIMAVERA[CAMPAIGN] ; 2:CATEGORÍAS[NAVIGATION],N/A,2:Categoría=Olímpico[SEMANTIC] || 12:Peso máximo de carga=500 kg.[SEMANTIC],hack squat,CLEAR_EXISTING_FAMILY,Hack-squat naming is consistently plate-loaded in the current catalog and no conflicting selectorized or accessory neighbor shares the exact phrase.,NAME_TEXT exact phrase: /\bhack squat\b/ -> PLATE_LOADED_MACHINE,LOW,orders=10 units=10 revenue=9479921,false
1072,Hip Thrust Machine PL Series | Obelix,OTHER,PLATE_LOADED_MACHINE,NAME_TEXT:hip thrust machine,NAME_TEXT:hip thrust machine,FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],N/A,N/A,hip thrust machine,CLEAR_EXISTING_FAMILY,"The exact phrase ""hip thrust machine"" isolates the standalone machine population from bench, belt, and pad products that also mention hip thrust.",NAME_TEXT exact phrase: /\bhip thrust machine\b/ -> PLATE_LOADED_MACHINE,LOW,orders=2 units=2 revenue=1709981,false
1162,Remo de Aire Magnético Lite Series | Obelix,OTHER,CARDIO_MACHINE,NAME_TEXT:remo de aire || TRUSTED_CATEGORY:313:Remos & Ski[SEMANTIC_STRONG] ; 308:Cardio[SEMANTIC_STRONG] ; 314:Máquinas Home Gym[SEMANTIC_STRONG] ; 280:EQUIPAMIENTO[SEMANTIC_WEAK] || STRUCTURED_FEATURE:1:Clasificación de Uso=USO REGULAR - HOGAR - 2 horas de uso continuo - 7 a 20 horas de uso promedio semanal[SEMANTIC],NAME_TEXT:remo de aire,TRUSTED_CATEGORY not allowed here: 313:Remos & Ski[SEMANTIC_STRONG] ; 308:Cardio[SEMANTIC_STRONG] ; 314:Máquinas Home Gym[SEMANTIC_STRONG] ; 280:EQUIPAMIENTO[SEMANTIC_WEAK] || STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO REGULAR - HOGAR - 2 horas de uso continuo - 7 a 20 horas de uso promedio semanal[SEMANTIC] || FORBIDDEN_CATEGORY:459:PRIMAVERA[CAMPAIGN] ; 2:CATEGORÍAS[NAVIGATION],313:Remos & Ski[SEMANTIC_STRONG] || 308:Cardio[SEMANTIC_STRONG] || 314:Máquinas Home Gym[SEMANTIC_STRONG] || 280:EQUIPAMIENTO[SEMANTIC_WEAK],1:Clasificación de Uso=USO REGULAR - HOGAR - 2 horas de uso continuo - 7 a 20 horas de uso promedio semanal[SEMANTIC],remo de aire,CLEAR_EXISTING_FAMILY,"The phrase ""remo de aire"" is a rowing-ergometer signal, not a strength-row station signal, and no conflicting classified neighbor uses that wording.",NAME_TEXT exact phrase: /\bremo de aire\b/ -> CARDIO_MACHINE,LOW,orders=46 units=49 revenue=13733661,false
1179,BikeErg | Concept2,OTHER,CARDIO_MACHINE,NAME_TEXT:bikeerg || TRUSTED_CATEGORY:69:Gimnasia y Acondicionamiento[SEMANTIC_STRONG] || STRUCTURED_FEATURE:24:Pantalla=Monitor PM5 Con Conexión Bluetooth Smart Y Compatible Con Unidad Flash USB[SEMANTIC],NAME_TEXT:bikeerg,TRUSTED_CATEGORY not allowed here: 69:Gimnasia y Acondicionamiento[SEMANTIC_STRONG] || STRUCTURED_FEATURE not allowed here: 24:Pantalla=Monitor PM5 Con Conexión Bluetooth Smart Y Compatible Con Unidad Flash USB[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],69:Gimnasia y Acondicionamiento[SEMANTIC_STRONG],24:Pantalla=Monitor PM5 Con Conexión Bluetooth Smart Y Compatible Con Unidad Flash USB[SEMANTIC],bikeerg,CLEAR_EXISTING_FAMILY,BikeErg is an unambiguous cardio product token with no strength-family collisions in the current catalog.,NAME_TEXT exact phrase: /\bbikeerg\b/ -> CARDIO_MACHINE,LOW,orders=1 units=1 revenue=1430990,false
1180,SkiErg | Concept2,OTHER,CARDIO_MACHINE,NAME_TEXT:skierg || TRUSTED_CATEGORY:69:Gimnasia y Acondicionamiento[SEMANTIC_STRONG] || STRUCTURED_FEATURE:24:Pantalla=Monitor PM5 Con Conexión Bluetooth Smart Y Compatible Con Unidad Flash USB[SEMANTIC],NAME_TEXT:skierg,TRUSTED_CATEGORY not allowed here: 69:Gimnasia y Acondicionamiento[SEMANTIC_STRONG] || STRUCTURED_FEATURE not allowed here: 24:Pantalla=Monitor PM5 Con Conexión Bluetooth Smart Y Compatible Con Unidad Flash USB[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],69:Gimnasia y Acondicionamiento[SEMANTIC_STRONG],24:Pantalla=Monitor PM5 Con Conexión Bluetooth Smart Y Compatible Con Unidad Flash USB[SEMANTIC],skierg,CLEAR_EXISTING_FAMILY,SkiErg is an unambiguous cardio product token with no conflicting non-cardio neighbor in the source universe.,NAME_TEXT exact phrase: /\bskierg\b/ -> CARDIO_MACHINE,LOW,orders=1 units=1 revenue=1669990,false
1188,Pasto Sintético Rollo 10x2mt,OTHER,FLOORING,NAME_TEXT:pasto sintetico || TRUSTED_CATEGORY:345:Pasto Sintético[SEMANTIC_STRONG] ; 341:PISO[SEMANTIC_STRONG] ; 69:Gimnasia y Acondicionamiento[SEMANTIC_STRONG] ; 143:Accesorios y Complementos[SEMANTIC_STRONG],NAME_TEXT:pasto sintetico,TRUSTED_CATEGORY not allowed here: 345:Pasto Sintético[SEMANTIC_STRONG] ; 341:PISO[SEMANTIC_STRONG] ; 69:Gimnasia y Acondicionamiento[SEMANTIC_STRONG] ; 143:Accesorios y Complementos[SEMANTIC_STRONG] || FORBIDDEN_CATEGORY:458:CYBERDAY[CAMPAIGN] ; 501:PESAS DAYS[CAMPAIGN] ; 506:Funcional[CAMPAIGN] ; 510:Funcional[CAMPAIGN] ; 2:CATEGORÍAS[NAVIGATION],345:Pasto Sintético[SEMANTIC_STRONG] || 341:PISO[SEMANTIC_STRONG] || 69:Gimnasia y Acondicionamiento[SEMANTIC_STRONG] || 143:Accesorios y Complementos[SEMANTIC_STRONG],N/A,pasto sintetico,CLEAR_EXISTING_FAMILY,Synthetic turf roll naming is a direct flooring concept and does not collide with yoga/pilates or machine families.,NAME_TEXT exact phrase: /\bpasto sintetico\b/ -> FLOORING,LOW,orders=11 units=12 revenue=9537418,true
1231,Standing Leg Curl Solid Rock | BODYTONE,OTHER,PLATE_LOADED_MACHINE,NAME_TEXT:standing leg curl || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=280 kg. (140 kg. por lado)[SEMANTIC] ; 45:Largo de la manga=31 cm.[TECHNICAL] ; 48:Diámetro de manga=Ø50 mm[SEMANTIC],NAME_TEXT:standing leg curl,STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=280 kg. (140 kg. por lado)[SEMANTIC] ; 45:Largo de la manga=31 cm.[TECHNICAL] ; 48:Diámetro de manga=Ø50 mm[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],N/A,1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 2:Categoría=Olímpico[SEMANTIC] || 12:Peso máximo de carga=280 kg. (140 kg. por lado)[SEMANTIC] || 45:Largo de la manga=31 cm.[TECHNICAL] || 48:Diámetro de manga=Ø50 mm[SEMANTIC],standing leg curl,CLEAR_EXISTING_FAMILY,"The exact phrase ""standing leg curl"" matches the plate-loaded neighborhood and does not collide with the seated/prone stack machines.",NAME_TEXT exact phrase: /\bstanding leg curl\b/ -> PLATE_LOADED_MACHINE,LOW,orders=0 units=0 revenue=0,false
1232,Leg Extension Solid Rock | BODYTONE,OTHER,PLATE_LOADED_MACHINE,NAME_TEXT:leg extension || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=280 kg. (140 kg. por lado)[SEMANTIC] ; 45:Largo de la manga=31 cm.[TECHNICAL] ; 48:Diámetro de manga=Ø50 mm[SEMANTIC],NAME_TEXT:leg extension,STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=280 kg. (140 kg. por lado)[SEMANTIC] ; 45:Largo de la manga=31 cm.[TECHNICAL] ; 48:Diámetro de manga=Ø50 mm[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],N/A,1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 2:Categoría=Olímpico[SEMANTIC] || 12:Peso máximo de carga=280 kg. (140 kg. por lado)[SEMANTIC] || 45:Largo de la manga=31 cm.[TECHNICAL] || 48:Diámetro de manga=Ø50 mm[SEMANTIC],leg extension,CONDITIONAL_EXISTING_FAMILY,"The family is likely correct, but ""leg extension"" crosses plate-loaded and selectorized neighborhoods. A safe fix needs a plate-loaded guard such as sleeve/load features.","NAME_TEXT ""leg extension"" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE",MEDIUM,orders=0 units=0 revenue=0,false
1240,Escalera LED S1 Series | Obelix®,OTHER,CARDIO_MACHINE,NAME_TEXT:escalera led || TRUSTED_CATEGORY:311:Escaladoras[SEMANTIC_STRONG] ; 308:Cardio[SEMANTIC_STRONG] ; 280:EQUIPAMIENTO[SEMANTIC_WEAK] || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL - Uso continuo ilimitado - Más de 20 horas de uso promedio semanal[SEMANTIC] ; 24:Pantalla=LED[SEMANTIC] ; 32:Velocidad=25 niveles[SEMANTIC],NAME_TEXT:escalera led,TRUSTED_CATEGORY not allowed here: 311:Escaladoras[SEMANTIC_STRONG] ; 308:Cardio[SEMANTIC_STRONG] ; 280:EQUIPAMIENTO[SEMANTIC_WEAK] || STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL - Uso continuo ilimitado - Más de 20 horas de uso promedio semanal[SEMANTIC] ; 24:Pantalla=LED[SEMANTIC] ; 32:Velocidad=25 niveles[SEMANTIC] || FORBIDDEN_CATEGORY:402:Star1 Series[LEGACY] ; 418:EN TENDENCIA[CAMPAIGN] ; 2:CATEGORÍAS[NAVIGATION],311:Escaladoras[SEMANTIC_STRONG] || 308:Cardio[SEMANTIC_STRONG] || 280:EQUIPAMIENTO[SEMANTIC_WEAK],1:Clasificación de Uso=USO INTENSIVO - COMERCIAL - Uso continuo ilimitado - Más de 20 horas de uso promedio semanal[SEMANTIC] || 24:Pantalla=LED[SEMANTIC] || 32:Velocidad=25 niveles[SEMANTIC],escalera led,CLEAR_EXISTING_FAMILY,"The exact phrase ""escalera led"" is a cardio-machine signal in this catalog and avoids the agility-ladder collision created by the bare word ""escalera"".",NAME_TEXT exact phrase: /\bescalera led\b/ -> CARDIO_MACHINE,LOW,orders=9 units=10 revenue=23146640,true
1241,Remo de Agua 1.0 | PROmachine,OTHER,CARDIO_MACHINE,NAME_TEXT:remo de agua || TRUSTED_CATEGORY:313:Remos & Ski[SEMANTIC_STRONG] ; 308:Cardio[SEMANTIC_STRONG] ; 314:Máquinas Home Gym[SEMANTIC_STRONG] ; 280:EQUIPAMIENTO[SEMANTIC_WEAK] || STRUCTURED_FEATURE:24:Pantalla=LCD[SEMANTIC],NAME_TEXT:remo de agua,TRUSTED_CATEGORY not allowed here: 313:Remos & Ski[SEMANTIC_STRONG] ; 308:Cardio[SEMANTIC_STRONG] ; 314:Máquinas Home Gym[SEMANTIC_STRONG] ; 280:EQUIPAMIENTO[SEMANTIC_WEAK] || STRUCTURED_FEATURE not allowed here: 24:Pantalla=LCD[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],313:Remos & Ski[SEMANTIC_STRONG] || 308:Cardio[SEMANTIC_STRONG] || 314:Máquinas Home Gym[SEMANTIC_STRONG] || 280:EQUIPAMIENTO[SEMANTIC_WEAK],24:Pantalla=LCD[SEMANTIC],remo de agua,CLEAR_EXISTING_FAMILY,"The phrase ""remo de agua"" is a rowing-ergometer signal and does not collide with the strength-row machine population.",NAME_TEXT exact phrase: /\bremo de agua\b/ -> CARDIO_MACHINE,LOW,orders=7 units=7 revenue=1367964,false
1289,Air Cycle Eco Smart Connect | XEBEX,OTHER,CARDIO_MACHINE,NAME_TEXT:air cycle || TRUSTED_CATEGORY:312:Bicicletas[SEMANTIC_STRONG] ; 308:Cardio[SEMANTIC_STRONG] ; 280:EQUIPAMIENTO[SEMANTIC_WEAK] || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL - Uso continuo ilimitado - Más de 20 horas de uso promedio semanal[SEMANTIC] ; 24:Pantalla=LCD[SEMANTIC],NAME_TEXT:air cycle,TRUSTED_CATEGORY not allowed here: 312:Bicicletas[SEMANTIC_STRONG] ; 308:Cardio[SEMANTIC_STRONG] ; 280:EQUIPAMIENTO[SEMANTIC_WEAK] || STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL - Uso continuo ilimitado - Más de 20 horas de uso promedio semanal[SEMANTIC] ; 24:Pantalla=LCD[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],312:Bicicletas[SEMANTIC_STRONG] || 308:Cardio[SEMANTIC_STRONG] || 280:EQUIPAMIENTO[SEMANTIC_WEAK],1:Clasificación de Uso=USO INTENSIVO - COMERCIAL - Uso continuo ilimitado - Más de 20 horas de uso promedio semanal[SEMANTIC] || 24:Pantalla=LCD[SEMANTIC],air cycle,CLEAR_EXISTING_FAMILY,"The exact token ""air cycle"" is cardio-specific and no non-cardio neighbor shares the phrase.",NAME_TEXT exact phrase: /\bair cycle\b/ -> CARDIO_MACHINE,LOW,orders=6 units=9 revenue=6819946,true
1360,Chest Press Solid Rock | BODYTONE,OTHER,PLATE_LOADED_MACHINE,NAME_TEXT:chest press || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=280 kg. (140 kg. por lado)[SEMANTIC] ; 45:Largo de la manga=31 cm.[TECHNICAL] ; 48:Diámetro de manga=Ø50 mm[SEMANTIC],NAME_TEXT:chest press,STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=280 kg. (140 kg. por lado)[SEMANTIC] ; 45:Largo de la manga=31 cm.[TECHNICAL] ; 48:Diámetro de manga=Ø50 mm[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],N/A,1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 2:Categoría=Olímpico[SEMANTIC] || 12:Peso máximo de carga=280 kg. (140 kg. por lado)[SEMANTIC] || 45:Largo de la manga=31 cm.[TECHNICAL] || 48:Diámetro de manga=Ø50 mm[SEMANTIC],chest press,CONDITIONAL_EXISTING_FAMILY,"The Solid Rock row looks plate-loaded, but ""chest press"" also names selectorized machines. A closure rule should require a plate-loaded structured guard, not the noun alone.","NAME_TEXT ""chest press"" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE",MEDIUM,orders=0 units=0 revenue=0,false
1361,Pulldown Solid Rock | BODYTONE,OTHER,PLATE_LOADED_MACHINE,NAME_TEXT:pulldown || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=280 kg. (140 kg. por lado)[SEMANTIC] ; 45:Largo de la manga=31 cm.[TECHNICAL] ; 48:Diámetro de manga=Ø50 mm[SEMANTIC],NAME_TEXT:pulldown,STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=280 kg. (140 kg. por lado)[SEMANTIC] ; 45:Largo de la manga=31 cm.[TECHNICAL] ; 48:Diámetro de manga=Ø50 mm[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],N/A,1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 2:Categoría=Olímpico[SEMANTIC] || 12:Peso máximo de carga=280 kg. (140 kg. por lado)[SEMANTIC] || 45:Largo de la manga=31 cm.[TECHNICAL] || 48:Diámetro de manga=Ø50 mm[SEMANTIC],pulldown,CONDITIONAL_EXISTING_FAMILY,"The row looks plate-loaded, but ""pulldown"" spans plate-loaded and cable-machine populations. A safe rule needs an explicit plate-loaded guard and cable exclusion.","NAME_TEXT ""pulldown"" + STRUCTURED_FEATURE sleeve/load guard + no cable tokens -> PLATE_LOADED_MACHINE",HIGH,orders=0 units=0 revenue=0,false
1362,Shoulder Press Solid Rock | BODYTONE,OTHER,PLATE_LOADED_MACHINE,NAME_TEXT:shoulder press || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=280 Kg. (140 Kg. Por Lado)[SEMANTIC] ; 45:Largo de la manga=31 cm.[TECHNICAL] ; 48:Diámetro de manga=Ø50 mm[SEMANTIC],NAME_TEXT:shoulder press,STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=280 Kg. (140 Kg. Por Lado)[SEMANTIC] ; 45:Largo de la manga=31 cm.[TECHNICAL] ; 48:Diámetro de manga=Ø50 mm[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],N/A,1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 2:Categoría=Olímpico[SEMANTIC] || 12:Peso máximo de carga=280 Kg. (140 Kg. Por Lado)[SEMANTIC] || 45:Largo de la manga=31 cm.[TECHNICAL] || 48:Diámetro de manga=Ø50 mm[SEMANTIC],shoulder press,CONDITIONAL_EXISTING_FAMILY,"The family is credible, but ""shoulder press"" appears in both machine neighborhoods. A future rule must carry a plate-loaded guard.","NAME_TEXT ""shoulder press"" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE",MEDIUM,orders=0 units=0 revenue=0,false
1363,Low Row Solid Rock | BODYTONE,OTHER,PLATE_LOADED_MACHINE,NAME_TEXT:low row || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=280 Kg. (140 Kg. Por Lado)[SEMANTIC] ; 45:Largo de la manga=31 cm.[TECHNICAL] ; 48:Diámetro de manga=Ø50 mm[SEMANTIC],NAME_TEXT:low row,STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 2:Categoría=Olímpico[SEMANTIC] ; 12:Peso máximo de carga=280 Kg. (140 Kg. Por Lado)[SEMANTIC] ; 45:Largo de la manga=31 cm.[TECHNICAL] ; 48:Diámetro de manga=Ø50 mm[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],N/A,1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 2:Categoría=Olímpico[SEMANTIC] || 12:Peso máximo de carga=280 Kg. (140 Kg. Por Lado)[SEMANTIC] || 45:Largo de la manga=31 cm.[TECHNICAL] || 48:Diámetro de manga=Ø50 mm[SEMANTIC],low row,CONDITIONAL_EXISTING_FAMILY,"The row likely belongs to the plate-loaded line, but low-row naming overlaps with selectorized and cable-row concepts. A structured plate-loaded guard is needed.","NAME_TEXT ""low row"" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE",HIGH,orders=0 units=0 revenue=0,false
1364,Chest Press Forza Bold | BODYTONE,OTHER,SELECTORIZED_MACHINE,"NAME_TEXT:chest press || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC]",NAME_TEXT:chest press,"STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION]",N/A,"1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC]",chest press,CONDITIONAL_EXISTING_FAMILY,"The stack feature strongly points to selectorized, but ""chest press"" by itself collides with plate-loaded machines. A stack guard is required for a safe rule.","NAME_TEXT ""chest press"" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE",MEDIUM,orders=0 units=0 revenue=0,false
1366,Seated Row Forza Bold | BODYTONE,OTHER,SELECTORIZED_MACHINE,"NAME_TEXT:seated row || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC]",NAME_TEXT:seated row,"STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION]",N/A,"1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC]",seated row,CONDITIONAL_EXISTING_FAMILY,"The stack feature points to selectorized, but ""seated row"" overlaps with plate-loaded and row-machine naming. A future rule should combine the noun with stack evidence.","NAME_TEXT ""seated row"" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE",HIGH,orders=0 units=0 revenue=0,false
1367,Shoulder Press Forza Bold | BODYTONE,OTHER,SELECTORIZED_MACHINE,"NAME_TEXT:shoulder press || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC]",NAME_TEXT:shoulder press,"STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION]",N/A,"1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC]",shoulder press,CONDITIONAL_EXISTING_FAMILY,"The family is plausible because of the stack feature, but the noun ""shoulder press"" also names plate-loaded rows in the current catalog.","NAME_TEXT ""shoulder press"" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE",MEDIUM,orders=0 units=0 revenue=0,false
1372,Leg Extension Forza Bold | BODYTONE,OTHER,SELECTORIZED_MACHINE,"NAME_TEXT:leg extension || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC]",NAME_TEXT:leg extension,"STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION]",N/A,"1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC]",leg extension,CONDITIONAL_EXISTING_FAMILY,"The stack feature points to selectorized, but ""leg extension"" alone collides with the plate-loaded leg-extension neighborhood.","NAME_TEXT ""leg extension"" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE",MEDIUM,orders=0 units=0 revenue=0,false
1373,Seated Leg Curl Forza Bold | BODYTONE,OTHER,SELECTORIZED_MACHINE,"NAME_TEXT:seated leg curl || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC]",NAME_TEXT:seated leg curl,"STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION]",N/A,"1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC]",seated leg curl,CLEAR_EXISTING_FAMILY,"The exact phrase ""seated leg curl"" is distinct from the standing plate-loaded curl and from bench attachments, so name-only classification is bounded.",NAME_TEXT exact phrase: /\bseated leg curl\b/ -> SELECTORIZED_MACHINE,LOW,orders=0 units=0 revenue=0,false
1374,Prone Leg Curl Forza Bold | BODYTONE,OTHER,SELECTORIZED_MACHINE,"NAME_TEXT:prone leg curl || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC]",NAME_TEXT:prone leg curl,"STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION]",N/A,"1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 34:Pila de Stack=105 kg., con placas de 7 kg.[SEMANTIC]",prone leg curl,CLEAR_EXISTING_FAMILY,"The exact phrase ""prone leg curl"" is a selectorized station concept in the current catalog and does not collide with the standing plate-loaded curl or bench accessories.",NAME_TEXT exact phrase: /\bprone leg curl\b/ -> SELECTORIZED_MACHINE,LOW,orders=0 units=0 revenue=0,false
1378,Seated Leg Press Forza Bold | BODYTONE,OTHER,SELECTORIZED_MACHINE,"NAME_TEXT:seated leg press || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=133 kg., con placas de 7 kg.[SEMANTIC]",NAME_TEXT:seated leg press,"STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=133 kg., con placas de 7 kg.[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION]",N/A,"1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 34:Pila de Stack=133 kg., con placas de 7 kg.[SEMANTIC]",seated leg press,CONDITIONAL_EXISTING_FAMILY,"The family is plausible because the row has a stack, but ""seated leg press"" stays too close to the plate-loaded leg-press neighborhood to clear on name alone.","NAME_TEXT ""seated leg press"" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE",MEDIUM,orders=0 units=0 revenue=0,false
1381,Dual Leg Curl/Extension Forza Bold | BODYTONE,OTHER,SELECTORIZED_MACHINE,"NAME_TEXT:dual leg curl/extension || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=80 kg., con placas de 5 kg.[SEMANTIC]",NAME_TEXT:dual leg curl/extension,"STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=80 kg., con placas de 5 kg.[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION]",N/A,"1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 34:Pila de Stack=80 kg., con placas de 5 kg.[SEMANTIC]",dual leg curl/extension,CLEAR_EXISTING_FAMILY,"The exact phrase ""dual leg curl/extension"" already expresses the selectorized dual-station concept and avoids the bench-attachment wording used elsewhere.",NAME_TEXT exact phrase: /\bdual leg curl\/extension\b/ -> SELECTORIZED_MACHINE,LOW,orders=0 units=0 revenue=0,false
1385,Dual Leg Curl/Extension MO Series | Obelix,OTHER,SELECTORIZED_MACHINE,NAME_TEXT:dual leg curl/extension || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=100 kg.[SEMANTIC],NAME_TEXT:dual leg curl/extension,STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=100 kg.[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],N/A,1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 34:Pila de Stack=100 kg.[SEMANTIC],dual leg curl/extension,CLEAR_EXISTING_FAMILY,The same exact dual-station phrase is present here and remains bounded away from pack and bench-accessory rows.,NAME_TEXT exact phrase: /\bdual leg curl\/extension\b/ -> SELECTORIZED_MACHINE,LOW,orders=0 units=0 revenue=0,false
1619,Pack Dúo Leg Curl/Extension MO 2.0 | Obelix,OTHER,,NAME_TEXT:pack duo leg curl/extension || TRUSTED_CATEGORY:390:Packs Gimnasio[SEMANTIC_WEAK] ; 386:PACKS[SEMANTIC_WEAK] || STRUCTURED_FEATURE:1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=Extensión de cuádriceps: 138 Kg + 4.6 Kg (Peso Incremental Desplegable)[SEMANTIC] ; 34:Pila de Stack=Curl Femoral: 117 Kg + 4.6 Kg (Peso Incremental Desplegable)[SEMANTIC],N/A,TRUSTED_CATEGORY not allowed here: 390:Packs Gimnasio[SEMANTIC_WEAK] ; 386:PACKS[SEMANTIC_WEAK] || STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] ; 34:Pila de Stack=Extensión de cuádriceps: 138 Kg + 4.6 Kg (Peso Incremental Desplegable)[SEMANTIC] ; 34:Pila de Stack=Curl Femoral: 117 Kg + 4.6 Kg (Peso Incremental Desplegable)[SEMANTIC] || FORBIDDEN_CATEGORY:2:CATEGORÍAS[NAVIGATION],390:Packs Gimnasio[SEMANTIC_WEAK] || 386:PACKS[SEMANTIC_WEAK],1:Clasificación de Uso=USO INTENSIVO - COMERCIAL[SEMANTIC] || 34:Pila de Stack=Extensión de cuádriceps: 138 Kg + 4.6 Kg (Peso Incremental Desplegable)[SEMANTIC] || 34:Pila de Stack=Curl Femoral: 117 Kg + 4.6 Kg (Peso Incremental Desplegable)[SEMANTIC],pack duo leg curl/extension,FALSE_POSITIVE_IN_A00_4_AUDIT,"This is a pack SKU containing two machines. Under the current ontology boundary, the residual pack space is intentional, so OTHER was already correct.",,HIGH,orders=5 units=5 revenue=11474915,true
1881,Escalera Home Led S1 Series | Obelix®,OTHER,CARDIO_MACHINE,NAME_TEXT:escalera home led || TRUSTED_CATEGORY:311:Escaladoras[SEMANTIC_STRONG] ; 308:Cardio[SEMANTIC_STRONG] ; 314:Máquinas Home Gym[SEMANTIC_STRONG] ; 280:EQUIPAMIENTO[SEMANTIC_WEAK] || STRUCTURED_FEATURE:1:Clasificación de Uso=USO REGULAR - HOGAR - 2 horas de uso continuo - 7 a 20 horas de uso promedio semanal[SEMANTIC] ; 24:Pantalla=LED[SEMANTIC] ; 32:Velocidad=25 niveles[SEMANTIC],NAME_TEXT:escalera home led,TRUSTED_CATEGORY not allowed here: 311:Escaladoras[SEMANTIC_STRONG] ; 308:Cardio[SEMANTIC_STRONG] ; 314:Máquinas Home Gym[SEMANTIC_STRONG] ; 280:EQUIPAMIENTO[SEMANTIC_WEAK] || STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=USO REGULAR - HOGAR - 2 horas de uso continuo - 7 a 20 horas de uso promedio semanal[SEMANTIC] ; 24:Pantalla=LED[SEMANTIC] ; 32:Velocidad=25 niveles[SEMANTIC] || FORBIDDEN_CATEGORY:402:Star1 Series[LEGACY] ; 418:EN TENDENCIA[CAMPAIGN] ; 2:CATEGORÍAS[NAVIGATION],311:Escaladoras[SEMANTIC_STRONG] || 308:Cardio[SEMANTIC_STRONG] || 314:Máquinas Home Gym[SEMANTIC_STRONG] || 280:EQUIPAMIENTO[SEMANTIC_WEAK],1:Clasificación de Uso=USO REGULAR - HOGAR - 2 horas de uso continuo - 7 a 20 horas de uso promedio semanal[SEMANTIC] || 24:Pantalla=LED[SEMANTIC] || 32:Velocidad=25 niveles[SEMANTIC],escalera home led,CLEAR_EXISTING_FAMILY,"The exact phrase ""escalera home led"" is bounded to the cardio stair-machine population and avoids the agility-ladder collision of the bare word ""escalera"".",NAME_TEXT exact phrase: /\bescalera home led\b/ -> CARDIO_MACHINE,LOW,orders=9 units=9 revenue=12119920,true
2297,Air Bike Hurricane 3.0 HWM®,OTHER,CARDIO_MACHINE,NAME_TEXT:air bike || TRUSTED_CATEGORY:312:Bicicletas[SEMANTIC_STRONG] ; 308:Cardio[SEMANTIC_STRONG] ; 280:EQUIPAMIENTO[SEMANTIC_WEAK] || STRUCTURED_FEATURE:1:Clasificación de Uso=Clase SC (Studio/Semi-Comercial)[SEMANTIC],NAME_TEXT:air bike,TRUSTED_CATEGORY not allowed here: 312:Bicicletas[SEMANTIC_STRONG] ; 308:Cardio[SEMANTIC_STRONG] ; 280:EQUIPAMIENTO[SEMANTIC_WEAK] || STRUCTURED_FEATURE not allowed here: 1:Clasificación de Uso=Clase SC (Studio/Semi-Comercial)[SEMANTIC] || FORBIDDEN_CATEGORY:513:Hurricane Series[LEGACY] ; 2:CATEGORÍAS[NAVIGATION],312:Bicicletas[SEMANTIC_STRONG] || 308:Cardio[SEMANTIC_STRONG] || 280:EQUIPAMIENTO[SEMANTIC_WEAK],1:Clasificación de Uso=Clase SC (Studio/Semi-Comercial)[SEMANTIC],air bike,CLEAR_EXISTING_FAMILY,"The spaced form ""air bike"" is the same cardio concept already classified elsewhere as the unspaced ""airbike"" token.",NAME_TEXT exact phrase: /\bair bike\b/ -> CARDIO_MACHINE,LOW,orders=0 units=0 revenue=0,true
```

## 5. Counts by decision

- `CLEAR_EXISTING_FAMILY`: `19`
- `CONDITIONAL_EXISTING_FAMILY`: `11`
- `EVIDENCE_GAP`: `0`
- `ONTOLOGY_GAP`: `0`
- `DATA_QUALITY`: `1`
- `FALSE_POSITIVE_IN_A00_4_AUDIT`: `1`

## 6. Families affected

- `PLATE_LOADED_MACHINE`: `10`
- `SELECTORIZED_MACHINE`: `10`
- `CARDIO_MACHINE`: `9`
- `FLOORING`: `1`

## 7. False-positive risks

The adjudication found three clear risk patterns:

- bare machine nouns like `chest press`, `shoulder press`, `leg extension`, `pulldown`,
  `low row`, and `seated row` cross plate-loaded, selectorized, and cable neighborhoods;
- bare `escalera` is unsafe because it collides with agility-ladder products, while the bounded
  phrases `escalera led` and `escalera home led` are safe;
- pack rows like `1619` must stay residual even when their component machines are semantically
  recognizable.

Conditional and false-positive rows:

- `448` `Shoulder Press T8 Series | Obelix` - risk `MEDIUM`; supporting neighbors `447`; collision set `1367`
- `1232` `Leg Extension Solid Rock | BODYTONE` - risk `MEDIUM`; supporting neighbors `452`; collision set `280`, `1372`
- `1360` `Chest Press Solid Rock | BODYTONE` - risk `MEDIUM`; supporting neighbors `447`; collision set `1364`
- `1361` `Pulldown Solid Rock | BODYTONE` - risk `HIGH`; supporting neighbors `449`; collision set `176`, `899`, `1365`
- `1362` `Shoulder Press Solid Rock | BODYTONE` - risk `MEDIUM`; supporting neighbors `447`, `448`; collision set `1367`
- `1363` `Low Row Solid Rock | BODYTONE` - risk `HIGH`; supporting neighbors `1885`; collision set `264`, `503`, `1366`
- `1364` `Chest Press Forza Bold | BODYTONE` - risk `MEDIUM`; supporting neighbors `492`; collision set `1360`, `447`
- `1366` `Seated Row Forza Bold | BODYTONE` - risk `HIGH`; supporting neighbors `265`, `489`; collision set `446`, `1885`
- `1367` `Shoulder Press Forza Bold | BODYTONE` - risk `MEDIUM`; supporting neighbors `492`; collision set `448`, `1362`
- `1372` `Leg Extension Forza Bold | BODYTONE` - risk `MEDIUM`; supporting neighbors `280`, `492`; collision set `1232`, `452`
- `1378` `Seated Leg Press Forza Bold | BODYTONE` - risk `MEDIUM`; supporting neighbors none; collision set `1070`, `1227`, `451`
- `1619` `Pack Dúo Leg Curl/Extension MO 2.0 | Obelix` - risk `HIGH`; supporting neighbors `1622`, `1623`; collision set `1381`, `1385`

## 8. Rule candidates

No production rule changed in this slice.

Safe-looking candidates carried forward to A00.4.2:

- `280` `Extensión de Cuádriceps MO Series | Obelix`: NAME_TEXT exact phrase: /\bextension de cuadriceps\b/ -> SELECTORIZED_MACHINE
- `416` `RowErg | Concept2`: NAME_TEXT exact phrase: /\browerg\b/ -> CARDIO_MACHINE
- `448` `Shoulder Press T8 Series | Obelix`: NAME_TEXT "shoulder press" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE
- `1070` `Linear Leg Press PL Series | Obelix`: NAME_TEXT exact phrase: /\blinear leg press\b/ -> PLATE_LOADED_MACHINE
- `1071` `Linear Hack Squat PL Series | Obelix`: NAME_TEXT exact phrase: /\bhack squat\b/ -> PLATE_LOADED_MACHINE
- `1072` `Hip Thrust Machine PL Series | Obelix`: NAME_TEXT exact phrase: /\bhip thrust machine\b/ -> PLATE_LOADED_MACHINE
- `1162` `Remo de Aire Magnético Lite Series | Obelix`: NAME_TEXT exact phrase: /\bremo de aire\b/ -> CARDIO_MACHINE
- `1179` `BikeErg | Concept2`: NAME_TEXT exact phrase: /\bbikeerg\b/ -> CARDIO_MACHINE
- `1180` `SkiErg | Concept2`: NAME_TEXT exact phrase: /\bskierg\b/ -> CARDIO_MACHINE
- `1188` `Pasto Sintético Rollo 10x2mt`: NAME_TEXT exact phrase: /\bpasto sintetico\b/ -> FLOORING
- `1231` `Standing Leg Curl Solid Rock | BODYTONE`: NAME_TEXT exact phrase: /\bstanding leg curl\b/ -> PLATE_LOADED_MACHINE
- `1232` `Leg Extension Solid Rock | BODYTONE`: NAME_TEXT "leg extension" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE
- `1240` `Escalera LED S1 Series | Obelix®`: NAME_TEXT exact phrase: /\bescalera led\b/ -> CARDIO_MACHINE
- `1241` `Remo de Agua 1.0 | PROmachine`: NAME_TEXT exact phrase: /\bremo de agua\b/ -> CARDIO_MACHINE
- `1289` `Air Cycle Eco Smart Connect | XEBEX`: NAME_TEXT exact phrase: /\bair cycle\b/ -> CARDIO_MACHINE
- `1360` `Chest Press Solid Rock | BODYTONE`: NAME_TEXT "chest press" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE
- `1361` `Pulldown Solid Rock | BODYTONE`: NAME_TEXT "pulldown" + STRUCTURED_FEATURE sleeve/load guard + no cable tokens -> PLATE_LOADED_MACHINE
- `1362` `Shoulder Press Solid Rock | BODYTONE`: NAME_TEXT "shoulder press" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE
- `1363` `Low Row Solid Rock | BODYTONE`: NAME_TEXT "low row" + STRUCTURED_FEATURE sleeve/load guard -> PLATE_LOADED_MACHINE
- `1364` `Chest Press Forza Bold | BODYTONE`: NAME_TEXT "chest press" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE
- `1366` `Seated Row Forza Bold | BODYTONE`: NAME_TEXT "seated row" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE
- `1367` `Shoulder Press Forza Bold | BODYTONE`: NAME_TEXT "shoulder press" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE
- `1372` `Leg Extension Forza Bold | BODYTONE`: NAME_TEXT "leg extension" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE
- `1373` `Seated Leg Curl Forza Bold | BODYTONE`: NAME_TEXT exact phrase: /\bseated leg curl\b/ -> SELECTORIZED_MACHINE
- `1374` `Prone Leg Curl Forza Bold | BODYTONE`: NAME_TEXT exact phrase: /\bprone leg curl\b/ -> SELECTORIZED_MACHINE
- `1378` `Seated Leg Press Forza Bold | BODYTONE`: NAME_TEXT "seated leg press" + STRUCTURED_FEATURE stack guard -> SELECTORIZED_MACHINE
- `1381` `Dual Leg Curl/Extension Forza Bold | BODYTONE`: NAME_TEXT exact phrase: /\bdual leg curl\/extension\b/ -> SELECTORIZED_MACHINE
- `1385` `Dual Leg Curl/Extension MO Series | Obelix`: NAME_TEXT exact phrase: /\bdual leg curl\/extension\b/ -> SELECTORIZED_MACHINE
- `1881` `Escalera Home Led S1 Series | Obelix®`: NAME_TEXT exact phrase: /\bescalera home led\b/ -> CARDIO_MACHINE
- `2297` `Air Bike Hurricane 3.0 HWM®`: NAME_TEXT exact phrase: /\bair bike\b/ -> CARDIO_MACHINE

## 9. Cases that really were evidence gap

- none

## 10. Cases that really were ontology gap

- none

## 11. Cases that really were data quality

- `1023` `MAQUINA CUADRICEPS`

## 12. Commercial prioritization

Commercial history was used only for prioritization, not for semantic adjudication.

Top revenue/order candidates excluding the one audit false positive:

- `1240` `Escalera LED S1 Series | Obelix®` - CLEAR_EXISTING_FAMILY - orders=9 units=10 revenue=23146640
- `1162` `Remo de Aire Magnético Lite Series | Obelix` - CLEAR_EXISTING_FAMILY - orders=46 units=49 revenue=13733661
- `280` `Extensión de Cuádriceps MO Series | Obelix` - CLEAR_EXISTING_FAMILY - orders=14 units=14 revenue=13707047
- `1881` `Escalera Home Led S1 Series | Obelix®` - CLEAR_EXISTING_FAMILY - orders=9 units=9 revenue=12119920
- `416` `RowErg | Concept2` - CLEAR_EXISTING_FAMILY - orders=8 units=8 revenue=11613000
- `1188` `Pasto Sintético Rollo 10x2mt` - CLEAR_EXISTING_FAMILY - orders=11 units=12 revenue=9537418
- `1071` `Linear Hack Squat PL Series | Obelix` - CLEAR_EXISTING_FAMILY - orders=10 units=10 revenue=9479921
- `1289` `Air Cycle Eco Smart Connect | XEBEX` - CLEAR_EXISTING_FAMILY - orders=6 units=9 revenue=6819946
- `1070` `Linear Leg Press PL Series | Obelix` - CLEAR_EXISTING_FAMILY - orders=3 units=3 revenue=4249990
- `1072` `Hip Thrust Machine PL Series | Obelix` - CLEAR_EXISTING_FAMILY - orders=2 units=2 revenue=1709981

## 13. Recommendation for the next slice

The adjudication supports a focused follow-up:

`A00.4.2 - Existing Family Miss Rule Closure`

Recommended scope for that slice:

- close the `19` clear name-only misses first;
- add guarded closure only for the `11` conditional rows, where
  structured plate-loaded or stack evidence is needed to avoid false positives;
- leave `1023` in `OTHER` until source data improves;
- keep `1619` residual because it is a deferred pack SKU, not a single-family product.

## 14. Final decision

`EXISTING_FAMILY_MISS_ADJUDICATION_COMPLETE`

