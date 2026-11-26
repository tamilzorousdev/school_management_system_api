# Claude skills guide

For developers and testers on the School Management System. It explains how to set up the folder paths on your machine and how to use the three skills.

The skills live in `.claude/skills/` in this repo (the API repo). They work on the API, the Admin Web repo and the Flutter repo from one place.

| Skill | Use it to | Who |
|---|---|---|
| `fullstack-feature` | Build or change one feature across the API, Admin Web and Flutter app from one prompt | Developers |
| `qa-test-runner` | Run the QA test-case sheet, inspect the code, and fill the result columns | Testers |
| `scope-lookup` | Read one section of a scope document without opening the whole Word file | Both (used by the other two) |

## 1. Setup (once per machine)

You need the API repo, the Admin Web repo and the Flutter repo cloned. They can be in any folder.

1. Pull the latest `dev` branch of this repo.
2. Open a terminal in the **API repo folder** and run:

   ```bash
   node .claude/skills/fullstack-feature/scripts/paths.js set
   ```

   It looks for the Web and Flutter repos next to the API repo and in common places (`~/StudioProjects/sms`, `~/AndroidStudioProjects/sms`, `~/Projects/sms`). If it cannot find them, give the folders yourself:

   ```bash
   node .claude/skills/fullstack-feature/scripts/paths.js set --web "D:\work\school_management_system_web" --flutter "D:\work\sms"
   ```

3. The paths are saved in `.claude/settings.local.json`. That file is git-ignored, so every person has their own and nothing is committed.
4. Check what is saved:

   ```bash
   node .claude/skills/fullstack-feature/scripts/paths.js
   ```

   It prints `api=`, `web=` and `flutter=`. `MISSING` means that path is wrong or not set.
5. Start Claude Code from the **API repo folder**, always. The skills load from here.
6. Optional: run `/add-dir` for the Web and Flutter folders so Claude can edit them without asking each time. The setup script never changes permissions.

Moved a repo or got a new laptop? Run `set` again.

## 2. Developers: build a feature with `fullstack-feature`

Write the task like you would tell a colleague. Name the skill, say who sees what in each app, and give the scope-document section if you know it.

```
/fullstack-feature  Parents can rate the bus driver.
Parent app: rating sheet on the Bus screen, 1 to 5 stars, a reason is required for low stars.
Admin web: show the average rating on the driver page.
Scope doc: Group G transport.
```

What happens:

1. Claude finds your Web and Flutter folders from the saved paths.
2. It reads only the needed scope-document section.
3. It writes a short contract: endpoints, fields, error codes, permissions.
4. It builds the API, then the Web, then the Flutter app, copying the nearest finished feature each time.
5. It runs lint, tests and build for each repo.
6. It reports what changed per repo and what it did not verify.

After that, review the changes in each repo. Claude commits or pushes only when you ask.

Tips:

- Need only one layer? Say so: "API only, the apps come later".
- Very large task? Add "use two subagents for Web and Flutter after the contract".
- Flutter commits must not carry AI attribution lines (the Flutter repo forbids them). The skill follows this.

## 3. Testers: run a test-case sheet with `qa-test-runner`

### Before you start

1. Put the QA sheet (`.xlsx`) in the test-cases folder of its group:

   ```
   scope_documents/group-a-school-setup-and-administration/test-cases/
   scope_documents/group-b-students-and-admissions/test-cases/
   scope_documents/group-c-academics/test-cases/
   ```

2. Run the API locally on a **scratch database**. `DB_NAME` in `.env` must contain `test` or `e2e`, and the demo data must be seeded. Test OTP must be on (`OTP_TEST=true`, sign-in code `123456`). Without a scratch database Claude runs read-only cases only and marks the rest `Blocked`.
3. Start the API yourself (`npm run start:dev`). Claude does not start databases or seed data.

### Run it

Test one module at a time. With a large sheet, do not ask for everything in one session.

```
/qa-test-runner  Test the Roles and permissions cases in
scope_documents/group-a-school-setup-and-administration/test-cases/GroupA_TestCases.xlsx
```

What happens, 25 cases at a time:

- API cases run against the live API. Claude records the status code and the key result.
- Web and app cases are checked by reading the code. The result says `Pass (code)` or `Fail (code)`, never a plain `Pass`. Cases that need a phone, camera, push or GPS are `Not run` with the remark "needs device".
- For a failure Claude opens the code once and writes the likely cause with a `file:line` in Remarks.
- Status, Actual result and Remarks are written into the sheet after every batch. A backup of the original sheet is saved in your temp folder.
- At the end it gives counts of Pass, Fail, Blocked and Not run, and the five most serious failures.

To continue later, run the same prompt again. Rows that already have a status are skipped.

### Result values

| Status | Meaning |
|---|---|
| Pass | Behaved as expected (API run) |
| Pass (code) | Matches the expected result in the code, not run on a screen |
| Fail | Wrong behaviour; Remarks say defect, wrong test or data issue |
| Blocked | A precondition or earlier case failed (blocking id in Remarks) |
| Not run | Needs a device or something not available here |

### If the sheet columns are not recognised

Run `node .claude/skills/qa-test-runner/scripts/sheet.js info <file.xlsx>`. It shows the header row and the columns it found. It needs id, steps or title, expected result and status. If your headings use other names, add them to `ALIASES` at the top of `.claude/skills/qa-test-runner/scripts/sheet.js`, or ask Claude to do it.

## 4. Read a scope-document section (`scope-lookup`)

Both skills use it automatically. You can also run it yourself, or ask Claude for "the API reference of the Attendance module".

```bash
S=.claude/skills/scope-lookup/scripts/scope.js
D="scope_documents/group-c-academics/Module_Scope_Document_Group_C_Academics_v1.0.docx"
node $S outline "$D"            # headings only
node $S section "$D" "6.8"      # one section, for example the Attendance API reference
node $S find "$D" "ATT-R-12"   # search for an id or a word
```

In every module chapter: `x.3` Features, `x.4` Business rules, `x.5` Role access, `x.6` User flows, `x.7` Screens, `x.8` API reference, `x.9` Data and states, `x.10` Notifications, `x.11` Test scenarios, `x.12` Gaps.

## 5. Troubleshooting

| Problem | What to do |
|---|---|
| `web=MISSING` or `flutter=MISSING` | Run the `set` command with `--web` and `--flutter` folders |
| Claude asks permission for every edit in the Web or Flutter repo | Run `/add-dir` for those folders |
| A skill does not appear in Claude | Start Claude Code from the API repo folder, after pulling `dev` |
| Sign-in fails in tests | Check `OTP_TEST=true` and that the API is running on port 3000 (or set `QA_API`) |
| `no test-case header found` | See "If the sheet columns are not recognised" above |
| Token or login errors in `call.js` | Delete `qa-token-*.json` files from your temp folder and run again |
| `flutter` command not found | Put Flutter on PATH, or tell Claude the full path to the executable |

## 6. Rules to remember

- Never commit `.claude/settings.local.json` or any file that holds your own paths.
- Run data-changing tests only on a scratch database.
- The test sheet is the source of truth: Claude fills result columns only and does not rewrite cases.
- Review Claude's changes before committing. These skills speed up the work; they do not replace review.
