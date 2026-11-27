---
name: scope-doc-writer
description: Write or update a module scope document (.docx) from the API, Admin Web and Flutter code, in the same easy-to-read layout as the Group A, B and C documents. Use when asked to prepare a new scope document, add a module chapter, or bring a scope document up to date with the code.
---

# Scope document writer

Output is a Word document QA can write test cases from. Style, chapter layout and IDs must match `scope_documents/group-*/Module_Scope_Document_*.docx`. Read a finished chapter first with the `scope-lookup` skill (`scope.js section <docx> "5"`) and copy its tone and table columns.

```bash
S=.claude/skills/scope-doc-writer/scripts
sh $S/docx.sh unpack <doc.docx> <dir>        # editable copy
node $S/dp.js rows|find <dir> "<heading prefix or text>"
node $S/dp.js apply <dir> <patch.json> [--dry]   # edit an existing document (ops below)
node $S/mkdoc.js <spec.json> <baseDir> <outDir>   # NEW document from a content spec; baseDir = unpacked existing doc (styles, header, footer)
node $S/chap.js <chapter.json> <dir> "<heading to insert before>"   # add a chapter to an existing document
sh $S/docx.sh pack <dir> <out.docx>
```

## Steps (cheap order)

1. Paths: `node .claude/skills/fullstack-feature/scripts/paths.js` (api, web, flutter).
2. One analysis agent per module chapter, in parallel, each given the rules below, its module and the three code locations. Each writes ONE patch or spec file and dry-runs it; nobody edits the document directly. Do not read code yourself when an agent can.
3. Apply patches in order: front chapters (2 to 4), then modules. Fix every `failed` entry. Renumber gap tables with `renumber`, rename stale headings with `setHeading`, then pack. Never run tests; reading code and read-only GET calls are enough.
4. Check once: `docx.sh pack` prints ok, then `scope.js outline` shows the headings.

## Chapter layout (every module)

x.1 Overview, x.2 Applications involved, x.3 Features (ID-F-nn), x.4 Business rules (ID-R-nn), x.5 Role access, x.6 User flows, x.7 Screens by application, x.8 API reference, x.9 Data and states, x.10 Notifications and automation, x.11 Test scenarios (ID-T-nn, P1/P2/P3, apps, scenario, expected), x.12 Gaps and observations. Document level: 1 control, 2 introduction (applications, module x application matrix), 3 how to read (IDs, application codes, API conventions, test data), 4 users, roles, applications, menus, then modules, Traceability Matrix, Consolidated Gaps, Glossary, Appendix A error codes, Appendix B permissions.

## Writing rules

- Present-tense facts only; every rule, code, route, limit, label and role verified in code. No change-history words (updated, now, no longer, previously, new, split, since, fixed), no revision notes, no mention that code changed.
- Easy to read: short sentences, one fact per rule, exact strings in quotes, status and error codes spelled out, tables over prose.
- Keep IDs stable; new items take the next number; delete a row only when the item is gone. Gaps hold only real current gaps.
- Application model: Admin Web (W) plus three Android apps, each with the Parent role: SMS (Parent + Staff, `com.sms.app`), SMS Transport (Parent + Driver, `com.sms.driver`), SMS Office (Parent + Office/AO, `com.sms.office`). Codes: W, S, P, D, O, A. Verify against `access/entities/role.entity.ts`, the Flutter `apps/*/lib/main.dart` and `/me` (`mobile_apps`).
- Code: API `apps/school-api/src/modules/<m>`, Web `src/features/<m>`, Flutter `packages/sms_*`, API paths in `sms_core/lib/utils/constant.dart`, rules in `*.spec.ts`. Read-only live calls: `QA_APP=mobile node .claude/skills/qa-test-runner/scripts/call.js <mobile> GET </path>`.

## Patch ops (JSON array, applied in order)

Row = first cell text (`row` exact or `rowStarts`), `section` = heading prefix (use it when an ID repeats), `occ` = nth match, `col` from 0.
`setCell`, `replaceInCell {find,repl}`, `setRow {cells,null keeps}`, `addRow {after,cells}`, `deleteRow`, `setPara`/`replaceInPara`/`addPara {after}`/`deletePara` for body paragraphs, `setHeading {startsWith,text}`, `insertHeadingBefore {before,like,text}`, `renumber {section}` (first column of a table 1..n). One-cell call-outs: row ops with `rowStarts`, col 0, first line is the title. Spec schema for `mkdoc.js`/`chap.js`: `{title, subtitle, chapters:[{h1, blocks:[{type:"h2|h3|p|bullets|table|callout", ...}]}]}`, table `{cols, widths (sum 9600), rows}`, callout `{title, text}`.

## Token budget

Read only needed sections, never dump a whole document or sheet, reuse one agent brief for all modules, ask agents for a short final report (under 200 words), and stop when the dry-runs are clean.
