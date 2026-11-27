# Senior playbook

Read this for any task bigger than a small fix. The goal is to think like the engineer who owns the feature, not like someone filling in a ticket.

## 1. Start from the goal
- Restate in one line who needs what and why. The plan row or scope document gives the context; read only that section.
- Choose the simplest design that fully solves the problem. Say what you chose not to build and why.

## 2. Plan before code
For anything beyond a small fix, put a short plan in the reply (about 25 lines) before writing code:
- **Today:** what the code does now, with the route or file.
- **Gaps:** what is missing for each role (teacher, parent, office, driver).
- **Proposal:** the recommended approach first, plus one alternative with its trade-off.
- **Phases:** slices that each work on their own, smallest useful slice first.
- **Risks and edge cases.**
- **Decisions needed:** at most four questions, each with a recommended default.

Stop and wait only when the answer changes scope or the data model. Otherwise state the assumption and continue. Once the user approves a direction, do not reopen it.

## 3. Design checklist (mention only what matters)
- **Lifecycle:** create, read, change, remove or undo, history (created and edited time and who).
- **Roles and privacy:** who sees what; a parent sees only their own child; what stays anonymous; what the office can hide or delete.
- **Time rules:** terms and academic year, timezone (+05:30), earlier years read only, what happens when a window closes mid-action.
- **Notifications:** template, which app lists it (`notification-apps.ts`), where a tap opens (`data.screen`), whether a silent change should notify.
- **States:** loading, empty, error, closed, offline. A tap must never end in nothing.
- **Language:** English and Tamil in the app; server labels are English only, so the app owns the words.
- **Scale:** pagination, indexes, no per-row queries in a loop.
- **Compatibility:** additive changes only (new route, optional field, nullable column); old app versions keep working; `v2` only for a breaking change.
- **Data:** safe migration, nullable or defaulted, nothing destructive. `migration:generate` on a local database also picks up unrelated drift (dropped constraints on other tables); when its SQL touches tables you did not change, write the migration by hand with only your columns.
- **Abuse:** one-per-window rules, moderation, rate limits where a user can spam.

## 4. Build small and clean
Reuse existing widgets and services. Keep diffs small and additive. Do not reformat files you only touched a little. Names explain the code. Tests sit next to the logic. Update `docs/api-guide.md` and the clients' types in the same change.

## 5. Prove it
- API: unit tests for each rule and error code, then lint, type check and tests. If the API is running, call it with `qa-test-runner/scripts/call.js`. A new migration or template needs the user to restart their API first.
- Apps: analyze, the repo guards and model tests. If an emulator or phone is connected (`adb devices`), look at the real behaviour instead of assuming: `adb -s <id> exec-out screencap -p > shot.png` and view the image, `adb -s <id> logcat -d -s flutter:V` for errors. Tap with `adb shell input tap x y` only on an emulator, or when the user has agreed. Say plainly what you could not run.
- **Hot reload does not refresh translations, route lists or const maps.** After adding a screen or strings, tell the user to stop and run the app again, and name a check ("the tile must read Teacher feedback").
- Give the user a numbered test script per role: who signs in, what to tap, what to expect, plus one failure case (closed, empty, duplicate).

## 6. Debug by evidence
Reproduce first. Read logs and screenshots before changing code. State the cause with its proof ("the tile shows the raw key, so the strings are stale"), then fix the cause, not the symptom. Check both sides: the server data and what the app shows. If you cannot reproduce, say what you checked and ask for the one missing fact.

## 7. Review your own work before reporting
- Is the diff the size you expect? Any unrelated file touched?
- Walk the feature once per role. Parent and Staff show the same facts.
- Old data and old clients still work.
- No local paths, secrets or a developer's `BASE_URL` in the change.

## 8. Report
Lead with the result in plain words. Then: what changed per repo, how to test it, what is not verified, what comes next with a recommendation. No long file lists unless asked.

## 9. Teach the repo
When you learn a gotcha (for example close the screen before the toast), add one line to the matching skill or reference file so the next person does not repeat it.
