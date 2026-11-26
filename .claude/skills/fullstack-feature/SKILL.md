---
name: fullstack-feature
description: Build or change one feature across the NestJS API, the React admin web and the Flutter app in a single pass (contract first, then API, Web, Flutter, verify). Use when a request touches more than one of the three repos, or asks for a new module, screen or endpoint that clients will call.
---

# Full-stack feature (API + Web + Flutter)

Repos: the API is this repo. The Web and Flutter folders differ on every machine, so no path is written in these files.

**First, resolve the paths (every time this skill starts):** `node .claude/skills/fullstack-feature/scripts/paths.js` prints `api=`, `web=` and `flutter=`. Use those absolute paths for every Read, Edit and command in the other two repos. If it prints `MISSING`, tell the user to run once `node .claude/skills/fullstack-feature/scripts/paths.js set` (it tries sibling folders and common locations; they add `--web <dir> --flutter <dir>` if it cannot find them). It saves the paths in `.claude/settings.local.json`, which is not committed. The user may also need `/add-dir` for each folder so edits there are allowed. Do not run `set` or change permissions yourself. If a repo is not cloned on this machine, say so and do only the layers that exist.

Digests: `reference/web.md` for the Web repo and `reference/flutter.md` for the Flutter repo. Read the digests, not the three CLAUDE.md files. Open a full CLAUDE.md only for a section the digest points to.

## Save tokens

- Do not explore. For every layer copy the nearest finished sibling (table below): `grep -rl` the sibling, read only the 1 to 3 files you need.
- The scope document already states the rules, roles, endpoints and error codes of each module. Read just that chapter: `node .claude/skills/scope-lookup/scripts/scope.js section "<docx>" "5.8"` (see skill `scope-lookup`). Do not read whole docs.
- Read a file once; edit with small `Edit` calls; never re-read after editing.
- Run lint, typecheck and tests once per repo at the end, not after every edit.
- Large feature: after step 1, hand Web and Flutter to two parallel subagents with the contract block pasted in. Small feature: do all three yourself.

## Steps

1. **Contract first (write it in the reply, 10 to 25 lines).** Endpoints (method, path, route family), permission or role, request fields with limits, response fields (snake_case), error codes, status values. Every later step uses this block unchanged. Ask the user only if a rule truly cannot be decided from the scope doc or code.
2. **API.** Follow the API CLAUDE.md "Adding a module" checklist: entity, migration (generate, review SQL), DTOs, service, admin controller under `admin/<feature>`, mobile controller under `mobile/<role>/<feature>` reusing the service, permission in `access.catalog.ts` plus seed, Swagger tags (mobile needs a module tag from the catalogs), notification template if a message is sent, `*.spec.ts`, and `docs/api-guide.md` for any client-visible change. Admin routes need school scoping and year handling (`yearWhere`).
3. **Web (only if admin screens are needed).** `src/features/<feature>/api.ts` types mirror the DTOs; page from the list-page recipe; route in `router.tsx`, menu in `config/nav.ts` with its permission, shortcut in `config/shortcuts.ts`.
4. **Flutter (only if Staff, Parent or Driver screens are needed).** Constants entry, repository method, model, screen pair (view plus controller), route in the owning module's page list, strings in both `lang_en.dart` and `lang_ta.dart`. Run the widget-reuse check first.
5. **Verify** (commands below). Fix everything the tools report in your own diff.
6. **Report** in 8 lines or fewer: what changed per repo (file list only), the contract, what was verified and its result, what was not verified (for example no device run), follow-ups.

## Reference implementations to copy

| Layer | Copy from |
|---|---|
| API module with admin and mobile controllers | `apps/school-api/src/modules/diary/` and `modules/mobile/mobile-diary.controller.ts` |
| API list with filters and insights | `modules/students/` (`listQuery`, `GET .../insights`) |
| Web list page | `src/features/users/pages/users-page.tsx`, `src/features/users/search.ts`, `api.ts` |
| Web feature with modals | `src/features/diary/` |
| Flutter screen pair (Staff) | `packages/sms_staff/lib/view/staff/diary/` (`diary.dart` + `diary_controller.dart`) |
| Flutter repository | `packages/sms_staff/lib/http/teacher_repository.dart`, `packages/sms_parent/lib/http/parent_repository.dart` |

## Verify commands

```bash
# API (cwd = api)
npm run lint && npm test && npm run build
# Web (cwd = web)
npm run lint && npm run typecheck && npm run build
# Flutter (cwd = flutter; if `flutter` is not on PATH use the full path to its executable)
flutter analyze && python tool/check_i18n.py && python tool/check_boundaries.py
```

## Contract sync checklist (the usual miss)

- Same field names and enum values in the DTO, the web `api.ts` type, the Flutter model and `docs/api-guide.md`.
- Error codes the clients switch on exist in the API and are handled (web toast or field error, Flutter snackbar plus Tamil text).
- New permission: in `access.catalog.ts`, seeded, used by the web menu `permission`, and (if a role needs it) listed in the role mapping.
- New mobile route: right route family and module tag, otherwise Swagger drops it.

## Commits

Commit or push only when the user asks. API repo: end the message with the attribution line from the session reminder. Flutter repo: no AI attribution lines at all (its CLAUDE.md forbids them). Web repo: none unless its owner says otherwise. Never change `Constants.BASE_URL` in Flutter.
