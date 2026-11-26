# Mobile Master Plan: features by role, with Web, Mobile and API tasks

Date: 25 November 2026. Written for: product owner, mobile team, web team and API team.

Baselines: API and Admin Web = `origin/dev_2.0`. Flutter app = `main_2.0`. Method: static code reading, no device run.
This one file replaces `mobile-coverage-plan.md`, `mobile-feature-backlog.md` and the three `mobile-backlog-detail-*.md` files. Those can be deleted. Exact request and response payloads for the Driver routes, and file paths for every task, are still in the three detail files; keep them if developers need that level.

## How to read this file

- Each role has one task table. A blank cell means no work for that team.
- **Mobile** tasks use APIs that already exist on `dev_2.0` unless the API cell says otherwise.
- **API** and **Web** tasks are listed only where the mobile feature cannot work without them. Web tasks marked (inferred) are what the web needs so the new mobile flow has a place to land. They were not checked screen by screen.
- Pri: P1 before release, P2 normal, P3 later. Size: S about days, M one to two weeks, L more. Sizes are estimates. **AI hrs** is the estimated working time for the whole row (Mobile plus any API work in it, not Web) when a developer drives Claude Code and reviews its output, including tests and a device check. It excludes waiting on decisions, store review and design sign-off.
- IDs match the detail files (P = Parent, T = Teacher, D = Driver). New IDs here: O = Office and Management, X = all roles.
- UNSURE means the code could not prove it.

## 1. Summary

Estimated AI-assisted hours per area: Parent 144.5, Teacher 157, Driver 189.5, Office 63, All roles 87.5, total 641.5 (about 107 working days at 6 productive hours).

| Role | Mobile today | Mobile create | Mobile update | API tasks | Web tasks |
|---|---|---|---|---|---|
| Parent | Mostly built | 7 | 8 | 6 | 3 (inferred) |
| Teacher / Staff | Largely built | 6 | 8 | 10 | 5 (inferred) |
| Driver / Attendant | One-screen stub, 26 API routes unused | 28 | 9 | 7 | 4 (inferred) |
| Office / Management | Office app built, other roles none | 4 | 1 | 4 | |
| All roles | Strong base, gaps in offline, crash reporting, versioning | 6 | 6 | 3 | |

Corrections to earlier plans, found with the right baselines: every Flutter path exists on `dev_2.0`; Parent gallery is done; Teacher hard-coded English is small (about 6 literals plus quiz screens); HOD gate approval is not a defect because the API gives `gate.approve` to TEACHER only; the KRA commit only added a stage-track widget; Parent class-only holidays never show; Driver fuel carries `odometer_km`. Flutter CLAUDE.md still says only Staff is implemented, which is wrong.

## 2. Parent

### 2.1 Tasks

| ID | Feature | Pri | Size | AI hrs | Web | Mobile | API |
|---|---|---|---|---|---|---|---|
| P-C04 | Digital bus pass | P1 | M | 6 | | New bus pass screen with QR and the four states (awaiting payment, active, on hold, expired). Uses GET children/:id/bus-pass. Link from Bus screen and home tile. | |
| P-C06 | Live bus map | P1 | L | 20 | | Add map package (decision needed), connect `/live` socket (trip.subscribe, trip.position, trip.event), extend ChildBus with trip and position, ETA to the child's stop, fall back to polling. | Confirm the `/live` socket is reachable from the app (token, TLS, CORS) and how a token refresh is handled while connected. |
| P-C01 | Rate bus driver | P2 | S | 2 | | Rating sheet on Bus screen. GET and PUT children/:id/driver-rating. Low stars need a reason. | |
| P-C02 | Rate teachers | P2 | M | 5 | | Rating sheet on Teachers screen. GET and POST children/:id/teacher-ratings. Handle RATING_CLOSED, ALREADY_RATED, NOT_CHILD_TEACHER. | |
| P-C03 | Teachers' feedback on my child | P2 | S | 2 | | Card or tab in child profile. GET children/:id/feedback. | |
| P-C05 | Bus boarding history | P2 | M | 5 | | Paginated list with date range and not-boarded flags. GET children/:id/bus-history. | |
| P-C07 | Live boarding and delay card | P3 | S | 3 | | Reflect boarded, alighted and delay events from the socket. | |
| P-U01 | Class-only holidays | P1 | S | 2 | | Use GET children/:id/holidays when a child is selected; class-only badge. | |
| P-U02 | Transport card extras | P2 | S | 3 | | Add today's boarding and recent route or stop changes to the model and card. Field shapes UNSURE. | |
| P-U05 | Tamil parity | P2 | S | 1.5 | | Add 6 keys missing in Tamil (admit_card, assigned_hall, hall_ticket, invigilation_duties, percentile, seat_number). Add a key-diff test. | |
| P-U06 | Bus push opens Bus screen | P2 | S | 2 | | Make the transport category open Bus with the student id. Payload ids UNSURE. | |
| P-U07 | Entries to pass, history, rating | P2 | S | 1 | | Links from Bus screen and home bus tile. | |
| P-U08 | Home regrouping | P3 | M | 8 | | Group the 14-tile grid; split the 1,450-line home file. | |
| P-U03 | Dark mode | P3 | L | 16 | | Token pass over constant colours, then a settings toggle (theme is forced to light today). | |
| P-U04 | Offline last-known data | P3 | L | 18 | | Cache Home, timetable, results, fees summary with a "last updated" stamp. Never cache OTP or payments. | |
| P-B01 | Syllabus, lesson plans, study materials for the child's class | P2 | M | 10 | Publish control for parent visibility if needed (inferred) | New Academics screens after the API exists. | Add read-only routes under mobile/parent/children/:id (admin/academics/* only today). |
| P-B02 | Online class join | P3 | M | 10 | | Join with the existing Agora flow. | Add parent list and rtc-token route (admin only today). |
| P-B03 | NOC (clearance) status | P3 | S | 4 | | Status and PDF screen. | Add parent read route for admin/students/:id/noc. |
| P-B04 | Raise a concern (grievance) | P3 | L | 18 | Show parent-raised concerns in Grievances with a reply and status the parent can see (inferred) | New screen with status timeline. | Add parent create, list and notes routes. |
| P-B05 | Transport change request | P3 | M | 8 | Approve or reject requests in Transport (inferred) | Request form and status. | Add parent submit route. |

### 2.2 Look and feel ideas

- **Today first.** Open Home on a short ordered view: bus status, fee due, today's diary and attendance, then tiles. One aggregate call would make it cheap (API, optional). Size L.
- **Group the tiles** into Academics, School life, Money and safety, Communication, with the three most-used on top. Size M.
- **Bus is the emotional screen.** Live map with ETA, boarded and arrived events, bus pass card with the child's photo, driver rating. Size L.
- **Weak-network calm.** Cached data with a "last updated" label instead of blank screens. Size L.
- **Child switcher badges** showing each child's pending fees or homework. Size S.
- **Dark mode and text-size hint**, keeping the existing contrast-checked colours. Size L.
- **Fee screen polish:** due-date calendar, pay-all, share receipt PDF, installment view. Size M.
- **Calls over the socket.** Replace the meeting-call polling with the existing `meeting.call` event to save battery. Size M.

## 3. Teacher / Staff (Teacher, HOD, Gate in-charge)

### 3.1 Tasks

| ID | Feature | Pri | Size | AI hrs | Web | Mobile | API |
|---|---|---|---|---|---|---|---|
| T-C01 | Term feedback to students | P1 | M | 6 | | New feedback list and form for the class teacher. GET feedback/sections/:id, POST feedback/students/:id. Confirm window-closed signal. | |
| T-C02 | Bus boarding card for class teacher | P1 | S | 2 | | Card in class roster. GET sections/:id/bus-boarding. Hide on 403 NOT_CLASS_TEACHER. | |
| T-C03 | My parent ratings | P2 | S | 2 | | New screen. GET ratings. No parent or child names shown. | |
| T-C04 | Class results and ranking | P2 | S | 3 | | Section in class roster using the existing ranking call. Exam picker if needed. | |
| T-C05 | Home banner and pending-work strip | P2 | S-M | 5 | | Banner card plus chips: attendance not marked, homework to grade, approvals, marks pending. | Optional: one summary route instead of 4 to 5 calls. |
| T-C06 | Per-student fee status | P3 | S | 2 | | Read-only card on student detail. GET students/:id/fees. | |
| T-U01 | Diary attachments | P1 | M | 7 | | Send file_ids from compose: photo, PDF, voice note, with upload retry. | |
| T-U02 | Quiz edit for drafts | P1 | M | 6 | | Reuse create screen with prefill. GET and PUT quizzes/:id. Draft only. | |
| T-U03 | Errors that look like empty | P1 | M | 8 | | Separate error from empty state, add Retry to the shared empty widget, apply to attendance, diary, classes, inbox first. | |
| T-U04 | Hard-coded quiz strings | P1 | S | 2 | | Move labels and messages to English and Tamil keys. | |
| T-U05 | Offline and attendance speed | P2 | L | 18 | | Cache timetable, classes, roster; keep unsaved attendance and marks as a draft with a "pending upload" chip. Mark-all-present already exists. | |
| T-U06 | Dead repository methods | P3 | S | 1 | | Remove four unused methods after checking callers. | |
| T-U07 | Dark theme | P3 | M | 6 | | Settings toggle after a palette check. | |
| T-U08 | Student detail size | P3 | M | 8 | | Split the 2,400-line file into tab widgets. | |
| T-B01 | Syllabus and lesson plans | P2 | M | 10 | | New screens after the API exists. | Add mobile/teacher routes (admin/academics only today; no delete for lesson plans). |
| T-B02 | Study materials | P3 | M | 8 | | Upload and list. | Add mobile/teacher routes. |
| T-B03 | Online classes | P3 | M | 10 | | Schedule, status, join with the existing Agora flow. | Add teacher routes and rtc-token (admin only today). |
| T-B04 | HOD department view | P2 | L | 18 | | HOD tab: teachers present, unmarked classes, below-average students, pending approvals. | Add mobile/teacher/department routes (HOD has only exams.view). |
| T-B05 | Substitution accept or decline | P2 | M | 7 | Show accepted or declined status and let admin reassign (inferred) | Accept and decline buttons. | Add POST accept and decline (GET only today). |
| T-B06 | Staff events and RSVP | P3 | M | 8 | Show staff RSVP counts on Events (inferred) | Event list, detail, RSVP. | Add staff event routes (parent only today). |
| T-B07 | Missed-punch request | P3 | M | 8 | Approval queue in Staff attendance (inferred) | Request form. | Add request route. |
| T-B08 | Report a lost asset | P3 | S | 4 | Show "reported lost" in Inventory (inferred) | Button in My assets. | Add me/assets report-lost route (admin only today). |
| T-B09 | Report-card remarks | P2 | M | 8 | Show and edit remarks in report card view (inferred) | Remark editor in the signing flow. | Add remark field and routes (sign only today). |

### 3.2 Look and feel ideas

- **"What do I owe today"** on Home: pending-work chips with counts, then the day's periods, each with a direct action (mark this period's attendance, enter this exam's marks). Size M.
- **Attendance under a minute:** all present by default, swipe absent or late, sticky save bar with unsaved count, local draft if the save fails. Size M.
- **Student detail in tabs** (Overview, Attendance, Behaviour and Achievements, Fees and Library, Parents) with one-tap call, chat or meeting to the parent. Size M.
- **Errors never look like "no data."** One error widget with Retry everywhere. Size M.
- **My day timeline** that interleaves periods with duties (invigilation, substitution, special class, meeting, gate duty). Size L.
- **Accessibility pass:** labels on icon buttons, announce attendance toggle state, no count text below 12 px. Size M.
- **Tamil everywhere:** replace remaining literals and add the key-diff test. Size S.
- **Subtle motion:** shared photo transition from list to detail. Size S.

## 4. Driver / Attendant

Driver is the largest piece of work. All 26 `mobile/driver/*` routes exist on `dev_2.0` and none is called. The app has no driver repository, one route (`/driver`), and 3 driver Tamil keys. It has no QR scanner, no foreground location service, and no background or foreground-service permissions.

### 4.1 Tasks

| ID | Feature | Pri | Size | AI hrs | Web | Mobile | API |
|---|---|---|---|---|---|---|---|
| D-C00 | Foundation | P1 | M | 6 | | Driver repository, models, path constants, error-code to Tamil and English mapping. | |
| D-U06 | Driver routes | P1 | S | 2 | | Register named routes for duty, trip, boarding, SOS, vehicle, profile. | |
| D-U07 | Tamil and English keys | P1 | M | 6 | | Keys for every driver screen and every error code. | |
| D-U03 | Packages | P1 | S | 2 | | Add QR scanner and foreground-service packages. | |
| D-C01 | Today card | P1 | M | 5 | | Replace the false "No trips yet" with bus, tracker status, running trip, start buttons. GET trips/today. (D-U05) | |
| D-C02 | Duty | P1 | M | 5 | | Stops, times and riders with parent phone. GET duty. | |
| D-C10 | Start trip | P1 | M | 6 | | POST trips with route and kind. Map NO_BUS, NOT_YOUR_ROUTE, CREW_NOT_APPROVED, BUS_CHECK_FAILED, TRIP_ALREADY_ACTIVE to messages. | |
| D-C11 | Trip screen | P1 | M | 6 | | Stop list, status, ETA, not-boarded, events. GET trips/:id. | |
| D-C13 | End trip | P1 | S | 2 | | Confirm and warn when children are not alighted. POST trips/:id/end. | |
| D-C14 | Delay chips | P1 | S | 2 | | 10, 20, 30 minutes and custom. POST trips/:id/delay. Handle DELAY_TOO_SOON. | |
| D-C15 | Live location sender | P1 | L | 18 | | Foreground service posting to trips/:id/positions every 5 to 10 s while a trip runs; permission education screen. | Buses without a GPS tracker cannot start a trip (400 NO_TRACKER) and phone positions forward to the tracker's device id. Decide whether phone-only tracking is needed, then change the API. |
| D-U01 | Android permissions | P2 | S | 2 | | Foreground-service location permission and service declaration. Play disclosure only if background location is used. | |
| D-U02 | iOS permissions | P2 | S | 2 | | Location background mode, location and camera usage text. | |
| D-C20 | Boarding checklist | P1 | M | 7 | | Stop-grouped tick list with away and held-pass badges. GET trips/:id/checklist and POST boardings. | |
| D-C21 | QR scan boarding | P1 | M | 7 | | Scan ID card QR with sound and haptic. Handle QR_INVALID, QR_OTHER_SCHOOL, QR_REPLACED, STUDENT_NOT_FOUND. | |
| D-C22 | Undo a wrong tap | P1 | S | 2 | | DELETE boardings/:id. Handle UNDO_ALIGHTED_FIRST, TRIP_ENDED. | |
| D-C30 | SOS button | P1 | M | 5 | | Hold 2 s to send. POST sos with optional trip, position, note. | |
| D-C31 | Active SOS and live location | P1 | M | 6 | | Red banner, poll sos/active every 10 s, send location every 15 s. | |
| D-C32 | Cancel false alarm | P1 | S | 2 | | Confirm dialog, POST sos/:id/cancel. | |
| D-C33 | Pre-trip check | P1 | M | 6 | | 10-item checklist with optional odometer and photo. GET and POST pre-trip-check. | |
| D-C40 | Profile and duty clearance | P1 | M | 6 | | Licence, badge, medical, police expiry chips and why blocked. GET profile. | |
| D-U04 | Push routing | P1 | S | 3 | | Route alert pushes to SOS, transport pushes to trip, profile (document expiry), fuel or duty. | |
| D-C23 | Post-trip flags | P2 | S | 3 | | Not-alighted in red first with call-parent buttons. | |
| D-C03 | Student list with search | P2 | S | 3 | | Search and call parent. GET students. | |
| D-C04 | Roster by route | P2 | S | 3 | | Morning get-on and evening get-off per stop. GET roster. | |
| D-C05 | Passes on hold banner | P2 | S | 2 | | GET passes-on-hold. | |
| D-C06 | Notifications inbox | P2 | M | 5 | | Reuse the Office pattern with unread badge. | |
| D-C12 | Open stop in Google Maps | P2 | S | 1.5 | | Launch maps from stop coordinates. | |
| D-C41 | Edit profile | P2 | S | 3 | | PATCH profile with photo upload. | |
| D-C42 | My bus card | P2 | S | 3 | | Registration, seats, document expiry, routes, co-crew. | |
| D-C43 | Fuel log and add fuel | P2 | M | 6 | | GET and POST vehicle/fuel. Odometer required. | |
| D-C44 | Report a problem | P2 | S | 3 | | POST vehicle/problems with photo. | |
| D-C07 | Payslips and announcements tiles | P3 | S | 2 | | Reuse Staff payslip screens; check they pick the driver route (D-U09). | |
| D-C16 | Trip history | P3 | S | 3 | | Paginated last 30 days with summary. | |
| D-C45 | Upkeep view | P3 | S | 3 | | Services due, open problems, off-road banner. | |
| D-C24 | Offline boarding queue | P3 | M | 8 | | Local queue replayed on reconnect. | Add a client timestamp or id to boardings; today a replay is stamped with sync time. |
| D-U08 | Emergency overlay on trip screen | P3 | S | 2 | | Check emergency on resume. | |
| D-B01 | Document upload for renewed licence or badge | P2 | M | 8 | Show driver uploads as pending in Crew documents (inferred) | Upload from profile. | Add mobile/driver/profile/documents route. |
| D-B02 | Breakdown handover request | P3 | M | 8 | Show the request in the existing handover flow (inferred) | Request button. | Add driver-initiated handover route. |
| D-B03 | Incident types (child unwell, accident) | P3 | S | 4 | Show new alert kinds in the alerts centre (inferred) | Type picker on SOS or report. | Add alert kinds; only free-text note exists. |
| D-B04 | Driver check-in and leave | P3 | M | 8 | Make sure crew have staff records | Screens reusing `me/staff/*`. | Needs a staff record for crew (UNSURE if they have one). |
| D-B05 | Driver view of parent ratings | P3 | S | 3 | | Rating summary card. | Policy decision, then a read route. |

### 4.2 Look and feel ideas

- **One-hand cab mode:** very large buttons, high contrast, haptics and sound on every scan, minimal text, Tamil first. Size M.
- **One "Next action" card** on Home: Start pre-trip check, then Start trip, then Next stop, then End trip. Size M.
- **Boarding built for speed:** grouped by stop, red "on leave" and "pass on hold" badges, undo toast, offline-safe. Size M.
- **SOS always one hold away,** with a visible active-SOS banner. Size S.
- **Permission education screens** for location, camera and battery, with a settings link when blocked. Size S.
- **Stop-by-stop in-app map** with route line and Tamil voice prompt on approach. Size L.
- **Shared notification inbox** like the other roles. Size M.

## 5. Office and Management (AO, Principal, Accountant, Transport in-charge, Librarian, Store keeper)

Office app already exists in Flutter (home dashboard, wing > class > section > student drill-down, teachers, drivers, gate-pass decisions, notifications, Me) and is reachable on `dev_2.0` (`OFFICE_APP_ROLES`, `mobile/office/*`). This section was only partly re-checked on `dev_2.0`; the admin-role needs come from the earlier analysis and need re-confirming.

### 5.1 Tasks

| ID | Feature | Pri | Size | AI hrs | Web | Mobile | API |
|---|---|---|---|---|---|---|---|
| O-U01 | Verify Office app on `dev_2.0` end to end | P1 | S | 3 | | Run all Office screens against `dev_2.0` with an AO user and fix 404s. | |
| O-C01 | Principal approvals tab | P2 | L | 20 | | Counts and approve or reject with reason for staff leave, fee requests, expenses, gate passes, inventory, diary and quiz approvals. Reuse the reject-reason dialog. | Add an aggregate mobile/principal/approvals route and mobile approve routes (only admin routes exist). |
| O-C02 | Emergency broadcast raise and approve | P2 | M | 8 | | Raise and approve screens. | Add mobile routes (admin only today). |
| O-C03 | Management dashboard tiles | P3 | M | 8 | | Attendance today, fee collection, buses on road, gate passes waiting. | Add a summary route. |
| O-C04 | Small shells for Accountant, Transport in-charge, Librarian, Store keeper | P3 | L | 24 | | Role-driven tabs over new mobile routes (collection today, live bus and SOS, issue and return by scan, receive and issue by scan). | Add mobile/<role>/* controllers and Swagger tags. |

Decisions: the approach below is a recommendation, not verified work. Prefer new role shells inside the existing app (one sign-in, push, role switching, chat, design system, release train; many principals are also parents or teachers) over a second app.

### 5.2 Look and feel ideas

- Approvals inbox first: swipe to approve or reject, reason prompt, approve straight from the notification. Size L.
- KPI tiles on Home with drill-down to the existing wing, class, section, student screens. Size M.

## 6. All roles (foundations)

### 6.1 Tasks

| ID | Feature | Pri | Size | AI hrs | Web | Mobile | API |
|---|---|---|---|---|---|---|---|
| X-U01 | Update Flutter CLAUDE.md and API guide | P1 | S | 1.5 | | Replace "only Staff implemented" with the real scope. | Update docs/api-guide.md. |
| X-C01 | Crash reporting and analytics | P1 | S | 3 | | Add crash reporting; decide privacy rules for student data in traces. | |
| X-U02 | Real app version | P1 | S | 1 | | Send the real version (package_info_plus) instead of hard-coded 1.0.0+1. | |
| X-C02 | Minimum-version gate | P2 | M | 7 | | Show "update required" screen. | Add a minimum-version setting to the API. |
| X-C03 | One push-routing table | P1 | M | 7 | | Shared NotificationRouter used by Staff, Parent, Driver, Office shells. | |
| X-C04 | One notification centre | P2 | M | 6 | | Single inbox for every role (Driver has none). | |
| X-C05 | Offline layer | P2 | L | 20 | | Read cache and write queue shared by all roles, "pending upload" chip. | Add idempotency keys or client timestamps on attendance, marks, gate, boardings. |
| X-U03 | Tamil completeness | P2 | S | 3 | | Key-diff test between English and Tamil; sweep remaining literals. | |
| X-U04 | Dark mode decision | P3 | L | 16 | | Wire a setting after a colour token pass, or delete the unused dark theme. | |
| X-U05 | Disk image cache and pagination | P3 | M | 8 | | Add disk image cache; paginate lists that load everything. | |
| X-U06 | Style layers | P3 | M | 8 | | Fold `office_styles.dart` and `parent_styles.dart` back into the shared theme. | |
| X-C06 | Tests on risky logic | P2 | M | 7 | | Tests for RoleResolver, token refresh, push routing. | |

### 6.2 Look and feel ideas

- One shared error widget with Retry, one empty state, one skeleton pattern in every list.
- Consistent bottom sheets (reason prompt, confirm dialog) instead of per-screen inline ones.
- Press feedback and subtle list-to-detail motion everywhere, not only some screens.
- Accessibility sweep: labels, state announcements, minimum text size, large-text layouts.
- Text size and language chooser reachable before sign-in as well as in Settings.

## 7. Tasks by team

### API team (new routes or changes)
- Parent: syllabus, lesson plans, study materials; online class list and join; NOC status and PDF; grievance create, list, notes; transport change request.
- Teacher: syllabus, lesson plans (with delete), study materials; online classes and join; HOD department routes; substitution accept and decline; staff events and RSVP; missed-punch request; report lost asset; report-card remarks; optional pending-work summary.
- Driver: document upload; breakdown handover request; incident alert kinds; client timestamp or id on boardings; phone-only tracking for buses without a tracker; staff record for crew; policy and route for rating summary.
- Management: principal approvals aggregate and mobile approve routes; emergency raise and approve; dashboard summary; role-specific mobile controllers.
- All: minimum-version setting; idempotency keys or client timestamps for queued writes; socket access check for the parent bus map.

### Web team (screens to receive mobile requests, all inferred)
- Grievances: show parent-raised concerns and replies. Transport: approve change requests. Substitutes: show accept and decline, reassign on decline. Events: staff RSVP counts. Staff attendance: missed-punch queue. Inventory: lost-asset reports. Report cards: view and edit remarks. Crew: pending document uploads. Transport handover: driver requests. Alerts centre: new incident kinds. Crew: staff records. Academics: parent visibility of syllabus and materials, if needed.

### Mobile team
Everything in the Mobile columns above. Suggested order:
1. **Week 1:** X-U01, X-C01, X-U02, X-C03, X-U03, D-C00, D-U06, D-U07, D-U03, O-U01.
2. **Weeks 1 to 3, quick wins:** P-U01, P-C04, P-C01, T-U01 to T-U04, T-C02, D-C01 with D-U05, D-C30 to D-C32, D-U04.
3. **Weeks 3 to 7:** driver trip and boarding (D-C10 to D-C15, D-C20 to D-C22, D-C33, D-C40, D-U01, D-U02); parent live map P-C06; teacher feedback T-C01.
4. **Later:** offline layer, dark mode, home regrouping, Management shell, and every item that waits on the API team.

## 8. Decisions needed

1. Map provider for the parent live bus map (none in `pubspec.yaml`; needs a key and Android and iOS setup).
2. Are there buses without a GPS tracker? If yes, phone-only tracking must be built in the API first.
3. Must attendance and marks work offline? A queued write can conflict with a second device.
4. Background location for drivers: Android 14 and iOS need store declarations.
5. Allow Principal and other admin roles on mobile? This changes the sign-in rule and needs the Management routes above.
6. Should parents see teacher ratings and feedback now? The web already has windows and moderation.
7. Should HOD get department data on mobile? Today HOD has only leave approval and KRA review.
8. Are drivers expected to have attendance, leave and payslips in the app?
9. Crash reporting provider and privacy rules.
10. UNSURE items to check first: teacher gallery actions, feedback window-closed signal, transport `today` and `recent_changes` shapes, push payload ids for deep links, crew staff records.
