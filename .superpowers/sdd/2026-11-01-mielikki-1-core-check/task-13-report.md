# Task 13 report
Implemented local/phone-consistency, tel-link (page), name-consistency, swap-test (site) in src/rules/local/ + index.ts (localRules), one line in all.ts. Tests: tests/unit/rules/local.test.ts (11 tests; fires/does-not-fire per rule, brief cases for swap-test). Full suite 287/287, lint/typecheck/build clean.
Note: TDD red step not separately recorded (tests written together with implementation). Phone normalization reuses schema/_helpers normalizePhone.
