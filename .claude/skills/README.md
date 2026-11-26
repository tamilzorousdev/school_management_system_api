# Claude skills for the School Management System

| Skill | Use it to |
|---|---|
| `fullstack-feature` | Build a feature across the API, Admin Web and Flutter app from one prompt |
| `qa-test-runner` | Run the QA test-case sheet, inspect code, and fill the result columns |
| `scope-lookup` | Read one section of a scope document without loading the whole file |

Test sheets go in `scope_documents/<group>/test-cases/`. The Flutter repo keeps its own skills in its `.claude/skills/` (`widget-catalog`, `flutter-flavors`).

## Setup on a new machine (once)

The Web and Flutter repos can be anywhere. From the API repo run `node .claude/skills/fullstack-feature/scripts/paths.js set` (add `--web <dir> --flutter <dir>` if they are not next to the API repo or in a usual folder). The paths are saved in `.claude/settings.local.json`, which is git-ignored, so each person has their own. Then add the two folders with `/add-dir` if you want edits there without prompts. `paths.js` with no argument shows what is configured.

Full guide for the team: `docs/claude-skills-guide.md`.

## Commits

Commits, pull requests and merges carry the developer's own git name only. Never add Claude or any AI attribution (co-author lines, "generated with" footers). The rules are in the Commits section of `fullstack-feature/SKILL.md`.
