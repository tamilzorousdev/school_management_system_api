---
name: scope-lookup
description: Read one section of a module scope document (.docx) cheaply, without loading the whole file. Use before building or testing a module to get its rules, API table, role access or test scenarios.
---

# Scope lookup

Scope documents are big Word files in `scope_documents/<group>/`. Never open them whole. Use the script (Node, no install; first call converts the file to text and caches it in the temp folder):

```bash
S=.claude/skills/scope-lookup/scripts/scope.js
D="scope_documents/group-c-academics/Module_Scope_Document_Group_C_Academics_v1.0.docx"
node $S outline "$D"            # headings level 1 and 2 only (about 100 lines)
node $S section "$D" "6.8"      # one section, e.g. ATT API reference; "6" gives the whole module chapter
node $S find "$D" "ATT-R-12"    # grep: prints line number and the line
```

Chapter map (same in groups A, B, C): section `x.3` Features, `x.4` Business rules, `x.5` Role access, `x.6` User flows, `x.7` Screens, `x.8` API reference, `x.9` Data and states, `x.10` Notifications, `x.11` Test scenarios, `x.12` Gaps. Ids look like `ATT-F-01`, `ATT-R-12`, `ATT-T-05`.

Pick the smallest section that answers the question. Tables print one row per line, cells separated by ` | `.
