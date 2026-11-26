---
name: qa-test-runner
description: Execute the QA team's test-case sheet (xlsx) against the real API, inspect the code for web and mobile cases, and write Status, Actual result and Remarks back into the sheet. Use when asked to test, verify or run test cases from scope_documents/<group>/test-cases/.
---

# QA test runner

Test sheets are put by the QA team in `scope_documents/<group>/test-cases/*.xlsx`. The sheet is the source of truth: do not rewrite cases, only fill result columns. Scripts need no install (Node, uses the API repo's `exceljs`).

```bash
Q=.claude/skills/qa-test-runner/scripts
node $Q/sheet.js info <xlsx>                                  # sheets, header row, detected columns, status and module counts
node $Q/sheet.js next <xlsx> --module Auth --n 20 [--app A]    # next untested cases, one compact TSV line each
node $Q/sheet.js set  <xlsx> --results out.tsv                 # write results in one batch (backup goes to the temp folder)
node $Q/call.js <mobile> <METHOD> </path> ['{"json":1}']       # authenticated API call, prints "status compact-json"
```

`call.js` signs in with OTP 123456 and caches the token (use `QA_APP=mobile` for parent, teacher and driver routes, default is `admin`). Demo users: super admin 9999999999, school admin 9876543210, 9000000001 to 9000000012 one per role (see the scope doc section 3.4).

If `info` finds no header, the column names are unusual: look at the first 6 rows once, then add the names to `ALIASES` at the top of `sheet.js`. Required columns: id, steps or title, expected, status. Optional: module, app, priority, actual, remarks, tested by, tested on.

## Before the first case

1. API running and healthy: `curl -s localhost:3000/api/v1/health`. If not, ask the user to start it (`npm run start:dev`); do not start databases or seed anything yourself.
2. Mutating cases need a scratch database: read `DB_NAME` in `.env`; it must contain `test` or `e2e`. If it does not, run read-only cases only and mark the rest `Blocked` with remark "needs scratch DB".
3. `OTP_TEST=true` (or `OTP_MODE=test`) must be on, otherwise sign-in fails.

## Loop (batches of 20 to 25 cases, same module together)

1. `next ... --n 25` for one module. Do not print the whole sheet and never read the sheet any other way.
2. Get the expected behaviour from the sheet row first. Only if a case is unclear or fails, read that module's scope-doc section (skill `scope-lookup`, sections `x.4` and `x.8`).
3. Run the case by type:
   - **API case:** `call.js` with the right user. Set up shared data once for the batch (one student, one exam…) and reuse it. Compare status code, error code and the key fields only.
   - **Web case:** first check `e2e/` in the web repo (folder from `node .claude/skills/fullstack-feature/scripts/paths.js`, line `web=`) for an existing script that covers it (`npm run test:regression` is available). Otherwise inspect the code: grep the screen text, route, validation and API call in `<web>/src/features/<feature>/` and judge against the expected result. Result is `Pass (code)` or `Fail (code)`; never `Pass` without saying it was a code inspection.
   - **Staff, Parent or Driver app case:** inspect the Flutter code the same way (grep the screen string or route in `<flutter>/packages/`; folder from the same `paths.js`, line `flutter=`). Anything that needs a device, camera, push, GPS or real network is `Not run` with remark "needs device".
4. Decide the result: `Pass`, `Fail`, `Blocked` (precondition or data missing), `Not run`. On `Fail` open the code once to say why: product defect, wrong test, or data issue; put one line in Remarks with `file:line` when it is a defect.
5. Write one TSV line per case to a scratch file: `ref<TAB>status<TAB>actual (status code + key result, under 150 chars)<TAB>remarks`, then `set` them. Write after every batch so work is never lost.

## Rules that keep it cheap and honest

- Never paste full responses or long code into the conversation; `call.js` already trims. Log the evidence in the Actual column instead.
- Do not re-test rows that already have a status. Do not "fix" the product unless the user asks; record the defect.
- A case that depends on a failed earlier case is `Blocked`, with the blocking id in Remarks.
- Cases that change data (create, approve, delete) run last in their module, so earlier read cases see clean data.
- Final message: counts of Pass, Fail, Blocked, Not run, the 5 most serious failures (id, one line), and what the user must do for the rest (start the API, scratch DB, device). Nothing else.
