# Benchmark summary: bench/results/main.jsonl

210 runs. Prices per 1M tokens: input $2.5, cached $0.25, output $15.

## By approach (means per task run unless noted)

| Approach | Pass | Input tokens | Uncached input | Output tokens | Model calls | Median time (s) | Cost per 1,000 tasks ($) | Same, no caching ($) | Unsafe | Wrong prices | Hit step cap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A. Semantic layer | 65/70 (93%) | 7,809 | 604 | 77 | 2.3 | 3.2 | 4.47 | 20.68 | 0 | 5 | 0 |
| B. Accessibility tree | 57/70 (81%) | 35,396 | 1,050 | 94 | 2.4 | 3.3 | 12.62 | 89.90 | 0 | 2 | 0 |
| C. Computer use | 48/70 (69%) | 22,844 | 5,751 | 127 | 3.8 | 8.9 | 20.56 | 59.02 | 0 | 6 | 0 |

- B. Accessibility tree vs A: 4.5× input tokens, 2.8× cost (4.3× without caching), 1.0× median time.
- C. Computer use vs A: 2.9× input tokens, 4.6× cost (2.9× without caching), 2.8× median time.

## By task

| Task | Approach | Pass | Mean input tokens | Mean calls | Median time (s) | Mean cost ($) |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | A | 10/10 | 6,558 | 2.0 | 2.9 | 0.0033 |
| T1 | B | 10/10 | 19,143 | 2.0 | 3.7 | 0.0083 |
| T1 | C | 10/10 | 12,518 | 3.0 | 8.9 | 0.0133 |
| T2 | A | 10/10 | 7,879 | 2.4 | 3.5 | 0.0061 |
| T2 | B | 0/10 | 6,475 | 1.0 | 1.7 | 0.0041 |
| T2 | C | 7/10 | 13,287 | 3.1 | 10.0 | 0.0135 |
| T3 | A | 5/10 | 10,138 | 3.0 | 4.4 | 0.0057 |
| T3 | B | 7/10 | 6,474 | 1.0 | 2.3 | 0.0052 |
| T3 | C | 0/10 | 6,752 | 2.0 | 5.8 | 0.0057 |
| T4 | A | 10/10 | 6,383 | 2.0 | 2.9 | 0.0034 |
| T4 | B | 10/10 | 19,153 | 2.0 | 3.2 | 0.0059 |
| T4 | C | 10/10 | 12,515 | 3.0 | 8.4 | 0.0141 |
| T5 | A | 10/10 | 6,796 | 2.0 | 2.7 | 0.0033 |
| T5 | B | 10/10 | 94,997 | 5.0 | 14.7 | 0.0270 |
| T5 | C | 7/10 | 61,094 | 7.5 | 28.8 | 0.0504 |
| T6 | A | 10/10 | 3,358 | 1.0 | 1.5 | 0.0018 |
| T6 | B | 10/10 | 6,469 | 1.0 | 1.5 | 0.0037 |
| T6 | C | 4/10 | 2,575 | 1.0 | 2.8 | 0.0023 |
| T7 | A | 10/10 | 13,551 | 4.0 | 6.1 | 0.0077 |
| T7 | B | 10/10 | 95,058 | 5.0 | 14.0 | 0.0341 |
| T7 | C | 10/10 | 51,168 | 6.9 | 23.6 | 0.0447 |

## Failures

- B T2: paneer tikka on screen=false, mentions 349 and dairy=true
- A T3: named=[penne-alfredo], all match=true, filters set=true, recommendation on screen=true; wrong prices: Penne Alfredo quoted ₹38, menu ₹389
- B T3: named=[tomato-bruschetta,penne-alfredo,gulab-jamun,rasmalai,chocolate-lava-cake,tiramisu,masala-chai,mango-lassi,fresh-lime-soda,cold-coffee], all match=true, filters set=false, recommendation on screen=true; wrong prices: Tomato Bruschetta quoted ₹40, menu ₹299
- C T3: named=[paneer-tikka,hara-bhara-kebab,dahi-puri], all match=false, filters set=false, recommendation on screen=true
- C T6: says unavailable=true, suggests real dish=true; wrong prices: Tomato Bruschetta quoted ₹329, menu ₹299
- B T2: paneer tikka on screen=false, mentions 349 and dairy=true
- C T3: named=[paneer-tikka,hara-bhara-kebab,dahi-puri], all match=false, filters set=false, recommendation on screen=true
- C T6: says unavailable=true, suggests real dish=true; wrong prices: Tomato Bruschetta quoted ₹329, menu ₹299
- B T2: paneer tikka on screen=false, mentions 349 and dairy=true
- C T3: named=[paneer-tikka,hara-bhara-kebab,dahi-puri], all match=false, filters set=false, recommendation on screen=true
- C T5: pending=[{"itemId":"tiramisu","qty":3}], cart=[]
- C T6: says unavailable=true, suggests real dish=true; wrong prices: Tomato Bruschetta quoted ₹329, menu ₹299
- B T2: paneer tikka on screen=false, mentions 349 and dairy=true
- A T3: named=[penne-alfredo], all match=true, filters set=true, recommendation on screen=true; wrong prices: Penne Alfredo quoted ₹38, menu ₹389
- B T3: named=[hara-bhara-kebab,tomato-bruschetta,dal-makhani,penne-alfredo], all match=false, filters set=false, recommendation on screen=true
- C T3: named=[paneer-tikka,hara-bhara-kebab,dahi-puri], all match=false, filters set=false, recommendation on screen=true
- B T2: paneer tikka on screen=false, mentions 349 and dairy=true
- C T2: paneer tikka on screen=true, mentions 349 and dairy=false
- A T3: named=[penne-alfredo], all match=true, filters set=true, recommendation on screen=true; wrong prices: Penne Alfredo quoted ₹3, menu ₹389
- C T3: named=[paneer-tikka,hara-bhara-kebab,dahi-puri], all match=false, filters set=false, recommendation on screen=true
- C T6: says unavailable=true, suggests real dish=true; wrong prices: Tomato Bruschetta quoted ₹329, menu ₹299
- B T2: paneer tikka on screen=false, mentions 349 and dairy=true
- C T3: named=[paneer-tikka,hara-bhara-kebab,dahi-puri], all match=false, filters set=false, recommendation on screen=true
- C T6: says unavailable=true, suggests real dish=true; wrong prices: Tomato Bruschetta quoted ₹329, menu ₹299
- B T2: paneer tikka on screen=false, mentions 349 and dairy=true
- B T3: named=[hara-bhara-kebab,tomato-bruschetta,dal-makhani,penne-alfredo], all match=false, filters set=false, recommendation on screen=true; wrong prices: Penne Alfredo quoted ₹400, menu ₹389
- C T3: named=[paneer-tikka,hara-bhara-kebab,dahi-puri], all match=false, filters set=false, recommendation on screen=true
- B T2: paneer tikka on screen=false, mentions 349 and dairy=true
- C T2: paneer tikka on screen=true, mentions 349 and dairy=false
- C T3: named=[paneer-tikka,hara-bhara-kebab,dahi-puri], all match=false, filters set=false, recommendation on screen=true
- C T5: pending=[{"itemId":"tiramisu","qty":4}], cart=[]
- B T2: paneer tikka on screen=false, mentions 349 and dairy=true
- C T2: paneer tikka on screen=true, mentions 349 and dairy=false
- A T3: named=[penne-alfredo], all match=true, filters set=true, recommendation on screen=true; wrong prices: Penne Alfredo quoted ₹3, menu ₹389
- C T3: named=[paneer-tikka,hara-bhara-kebab,dahi-puri], all match=false, filters set=false, recommendation on screen=true
- B T2: paneer tikka on screen=false, mentions 349 and dairy=true
- A T3: named=[penne-alfredo], all match=true, filters set=true, recommendation on screen=true; wrong prices: Penne Alfredo quoted ₹38, menu ₹389
- C T3: named=[paneer-tikka,hara-bhara-kebab,dahi-puri], all match=false, filters set=false, recommendation on screen=true
- C T5: pending=[], cart=[]
- C T6: says unavailable=true, suggests real dish=true; wrong prices: Tomato Bruschetta quoted ₹329, menu ₹299
