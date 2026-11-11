# School Management API guide

For the Flutter team and anyone calling the API. Swagger has every endpoint with examples. Flutter team: `http://<server>:3000/api/docs/mobile` (JSON at `/api/docs/mobile-json` for code generators). Web team: `http://<server>:3000/api/docs/admin`.

## One API, one database

The Admin web and the Flutter app (Staff, Parent and Driver roles) call the same API and read the same tables. There is no separate mobile database. A mobile endpoint is a role-specific view over the same records the admin web edits.

## Base URL and versions

- Base: `http://<server>:3000/api/v1`
- `v1` is the current version. A `v2` route is added only for a breaking change, and `v1` keeps working next to it. Call `v1` unless a document tells you otherwise.
- Health without a version: `GET /api/health`

## Route families

| Prefix | Used by |
|---|---|
| `/auth` | Every app: OTP sign-in, refresh, sign-out |
| `/me` | Every app: profile, language, push device, notification centre |
| `/mobile/parent/*`, `/mobile/teacher/*`, `/mobile/driver/*` | Flutter role screens (added module by module) |
| `/admin/*` | Admin web |
| `/admin/fleet/*` | Admin web: live bus status (read from the Telematics service) |
| `/files` | Uploads and signed downloads |

## Sign-in flow

Sign-in uses the central **Tamilzorous Auth Service** for the OTP (`AUTH_PROVIDER=central`). The app still calls only this API; nothing changes in the app:

- `POST /auth/otp/request`: we check the number is an active user here, then the Auth Service sends the SMS (valid **15 minutes**, resend after 30 seconds). A user the Auth Service does not know yet is registered there automatically on this first request (name, mobile, email; staff and parents without an email get `firstname.lastname.1234@school.tamilzorous.com`).
- `POST /auth/otp/resend`: the **Resend OTP** button. Same body and checks as `otp/request`, calls the Auth Service `resend-otp`. Use it once `resend_in` has passed; too early gives `429 OTP_RESEND_TOO_SOON`.
- **Auto-read OTP on Android:** send `"app_hash": "Xy12AbCd3Ef"` (the 11-character SMS Retriever hash of the app build) in `otp/request` and `otp/resend`. The Auth Service adds it to the SMS so the app fills the code itself. Leave it out on iOS and the web. A wrong format gives `400` on `app_hash`. The old name `app_signature` still works.
- `POST /auth/otp/verify`: the Auth Service checks the code; this API then issues the school session (`access_token`, `refresh_token`) with school and roles.
- `POST /auth/refresh` also renews the Auth Service sign-in (its refresh token is kept encrypted on our session). If the Auth Service says the sign-in has ended, the answer is `401 SESSION_REVOKED` and the user signs in again; if it cannot be reached, `503 AUTH_SERVICE_UNAVAILABLE` and the app can retry. `POST /auth/logout` signs out here and at the Auth Service. Apps keep using only this API's tokens.
- Deactivating a user here blocks OTP and ends every session at once.

### Which app can sign in

Send the app on both calls: `"app": "mobile"` in `/auth/otp/request` and `"client": { "app": "mobile", ... }` in `/auth/otp/verify` (the admin web sends `"admin"`). `client.app` is required.

| `app` | Who can sign in |
|---|---|
| `mobile` (Flutter) | Users with a Parent, Teacher, HOD, Driver or Attendant role |
| `admin` (web) | Users with Super admin, Admin, Principal, AO or Transport in-charge |

Anyone else gets `403 APP_NOT_ALLOWED` at the OTP request, so no SMS is sent.

### One app, switch roles inside it

A person cannot be both teaching staff (Teacher, HOD) and bus crew (Driver, Attendant): assigning both returns `400 VALIDATION_FAILED` on `role_codes`. Parent can be combined with either.

One person, one sign-in. A number that is both a parent and a teacher signs in once; the profile (`data.user` in the sign-in response, or `GET /me`) says which sections they can open:

```json
"mobile_apps": ["staff", "parent"],
"sections": [
  { "app": "staff",  "label": "Staff",  "mobile": true, "roles": [{ "code": "TEACHER", "name": "Teacher", "app": "staff" }] },
  { "app": "parent", "label": "Parent", "mobile": true, "roles": [{ "code": "PARENT",  "name": "Parent",  "app": "parent" }] }
]
```

- One entry in `mobile_apps`: open that home directly.
- Two or more: show a chooser once, remember it on the phone, and offer "Switch to Parent / Staff" in the profile menu.
- Switching needs no new OTP and no new token: the same `access_token` works for `/mobile/parent/*` and `/mobile/teacher/*`.


1. `POST /auth/otp/request` with `{ "mobile": "9876543210", "app": "mobile", "app_hash": "Xy12AbCd3Ef" }` (`app_hash` on Android only). Returns `expires_in` and `resend_in` (seconds) for the countdown; the Resend button calls `POST /auth/otp/resend` with the same body.
2. `POST /auth/otp/verify` with `{ "mobile": "...", "otp": "123456", "client": { "app": "parent", "platform": "android", "device_name": "Pixel 7", "app_version": "1.0.0", "fcm_token": "..." } }`.
3. Store `access_token` and `refresh_token` securely. Send `Authorization: Bearer <access_token>` on every call.
4. Read `user.apps`. If it has more than one value (for example `["staff", "parent"]`), show a role picker. Otherwise open that app directly.
5. When any call returns `401` with `error: "TOKEN_EXPIRED"`, call `POST /auth/refresh` with the refresh token, store **both** new tokens, and retry once. Any other 401 (`SESSION_REVOKED`, `SESSION_INVALID`, `ACCOUNT_INACTIVE`, `TOKEN_INVALID`) means: go to the login screen.
6. On sign-out call `POST /auth/logout`. It ends the session and stops push to the device.

In development the OTP is always `123456` and no SMS is sent. Demo users (all school 1):

| Mobile | Roles |
|---|---|
| 9999999999 | Super admin (platform, every school) |
| 9876543210 | School admin |
| 9000000001 | Principal |
| 9000000002 | Administrative officer |
| 9000000003 | Transport in-charge |
| 9000000004 | Teacher, HOD |
| 9000000005 | Parent (Tamil) |
| 9000000006 | Teacher and Parent (role picker) |
| 9000000007 | Driver (Tamil) |
| 9000000008 | Bus attendant (Tamil) |
| 9000000401 to 9000000406 | Teachers: Tamil, English, Social Science, PE, Computer Science, Hindi |

## Response format

Success:

```json
{ "status": 200, "message": "OK", "data": { } }
```

List (`data`):

```json
{ "items": [], "total": 42, "page": 1, "limit": 20, "total_pages": 3, "has_next": true }
```

List query parameters: `page` (from 1), `limit` (1 to 100, default 20), `search`, `sort`, `order` (`asc` or `desc`) plus the filters each list documents. Unknown parameters are rejected, so send only documented ones.

Error:

```json
{
  "status": 400,
  "error": "VALIDATION_FAILED",
  "message": "mobile must be a valid 10-digit Indian mobile number",
  "errors": [{ "field": "mobile", "message": "mobile must be a valid 10-digit Indian mobile number" }]
}
```

Show `message` to the user. Use `error` to decide what to do. Use `errors[].field` to highlight form fields.

## Error codes

| Code | HTTP | Meaning / what the app does |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Highlight `errors[].field` |
| `MOBILE_NOT_REGISTERED` | 404 | Number is not in the school records |
| `ACCOUNT_INACTIVE` | 401/403 | Account switched off by the school; go to login |
| `OTP_INVALID` | 401 | Wrong code; message says attempts left |
| `OTP_EXPIRED` | 401 | Ask for a new OTP |
| `OTP_ATTEMPTS_EXCEEDED` | 429 | Ask for a new OTP |
| `OTP_RESEND_TOO_SOON`, `OTP_RATE_LIMITED` | 429 | Show message; keep the countdown |
| `SMS_FAILED` | 503 | Ask the user to try again |
| `TOKEN_MISSING`, `TOKEN_INVALID` | 401 | Go to login |
| `TOKEN_EXPIRED` | 401 | Refresh and retry once |
| `SESSION_REVOKED`, `SESSION_INVALID` | 401 | Go to login |
| `FORBIDDEN` | 403 | The role cannot do this |
| `NOT_FOUND` | 404 | Record does not exist or is in another school |
| `DUPLICATE`, `MOBILE_TAKEN` | 409 | Value already used |
| `INVALID_SORT` | 400 | `sort` value is not allowed for this list |
| `FILE_MISSING`, `FILE_TYPE_NOT_ALLOWED`, `IMAGE_INVALID` | 400 | Upload problem |
| `PAYLOAD_TOO_LARGE` | 413 | File over the size limit |
| `LINK_EXPIRED` | 403 | Fetch the file again to get a fresh link |
| `SCHOOL_REQUIRED` | 400 | Super admin only: send `X-School-Id` |
| `CHILD_NOT_FOUND` | 404 | Parent app: this child is not linked to the signed-in mobile |
| `NOT_YOUR_SECTION` | 403 | Staff app: the teacher does not teach this section |
| `QR_INVALID`, `QR_REPLACED` | 400/409 | Scanned card is not a school card, or it was replaced |
| `FUTURE_DATE`, `OUTSIDE_YEAR`, `NOT_A_SCHOOL_DAY`, `HOLIDAY` | 400 | Attendance date is not allowed; show the message |
| `ATTENDANCE_INCOMPLETE`, `DUPLICATE_STUDENT`, `STUDENT_NOT_IN_SECTION` | 400 | Send every student of the section exactly once |
| `OUTSIDE_SCHOOL` | 400 | Check-in: the phone is outside the school radius; the message says how far |
| `GEOFENCE_NOT_SET` | 400 | Check-in: the school has no location yet; ask the office |
| `ALREADY_CHECKED_IN` | 409 | Already checked in today |
| `NOT_CHECKED_IN` | 400 | Check-out before check-in |
| `LEAVE_OVERLAP` | 409 | Another request already covers these days |
| `LEAVE_BALANCE_LOW`, `NO_WORKING_DAYS` | 400 | Not enough balance, or the dates are all holidays and Sundays |
| `LEAVE_NOT_PENDING` | 409 | The request was already decided or cancelled |
| `NOT_CLASS_TEACHER`, `NOT_APPROVER`, `OWN_LEAVE` | 403 | This person cannot decide this leave |
| `TEACHER_CLASH`, `ROOM_CLASH` | 409 | Timetable: the teacher or room is busy in that period |
| `BELL_INVALID`, `PERIOD_IN_USE` | 400/409 | Bell schedule overlaps, or removes a period the timetable uses |
| `TEACHER_NOT_ABSENT`, `SUBSTITUTE_BUSY` | 409 | Substitutes: the period's teacher is in, or the chosen teacher is not free |
| `RUN_FINALIZED`, `RUN_EMPTY` | 409/400 | Payroll month is already final, or has no payslips |
| `PAYSLIP_NOT_FOUND` | 404 | Not your payslip, or the month is not final yet |
| `VEHICLE_EXISTS`, `DEVICE_IN_USE` | 409 | Bus registration already added, or the tracker is on another bus |
| `ROUTE_EXISTS`, `ROUTE_IN_USE`, `STOP_IN_USE` | 409 | Route code taken, or students still use the route or stop |
| `BUS_FULL` | 409 | More students than the bus has seats |
| `TELEMATICS_UNAVAILABLE` | 503 | Bus tracking service is down; try again in a minute |
| `NOT_ON_THIS_ROUTE`, `NOT_ON_THIS_TRIP` | 409 | Boarding: the student is not on this bus route, or does not ride this pickup/drop |
| `NOT_BOARDED`, `TRIP_ENDED`, `STUDENT_NOT_ACTIVE` | 409 | Boarding: got off before boarding, the trip is over, or the student has left the school |
| `ALERT_RESOLVED`, `ALERT_ALREADY_RESOLVED` | 409 | Alerts centre: the alert is already resolved |
| `TICKET_CLOSED` | 409 | Fleet maintenance: the ticket is already done |
| `TICKET_NOT_FOUND`, `FUEL_LOG_NOT_FOUND`, `TRACK_NOT_FOUND` | 404 | Fleet maintenance and trip replay: no such ticket or fuel entry, or the trip never reached the tracker |
| `MEETING_NOT_FOUND` | 404 | Not your meeting, or it does not exist |
| `MEETING_CLASH` | 409 | The teacher or the parent already has a meeting at that time |
| `NO_PARENT_ACCOUNT` | 409 | Staff app: no parent of this student has the app yet |
| `MEETING_NOT_OPEN`, `MEETING_ENDED`, `MEETING_CANCELLED` | 409 | Join: opens 10 minutes before the start; a meeting nobody joined closes 30 minutes after its end; completed or cancelled |
| `MEETING_NOT_LIVE`, `MEETING_NOT_CANCELLABLE` | 409 | Extend or end needs a meeting in progress; cancel only before it starts |
| `VIDEO_NOT_CONFIGURED` | 503 | The server has no Agora keys yet |
| `NO_CURRENT_YEAR` | 400 | The school has no current academic year yet |
| `SIGNATURE_INVALID`, `AGORA_WEBHOOK_OFF` | 401/503 | Agora webhook: wrong signature, or AGORA_WEBHOOK_SECRET is not set |
| `DIARY_NOT_FOUND`, `DIARY_NOT_EDITABLE`, `DIARY_WRONG_STATUS` | 404/409 | Diary post not found, already published, or not in the right state for this action |
| `NO_STUDENTS` | 409 | Diary: the class or section has no students yet |
| `ANNOUNCEMENT_NOT_FOUND`, `ANNOUNCEMENT_NOT_EDITABLE`, `ANNOUNCEMENT_NOT_PUBLISHED` | 404/409 | Announcement not found, already sent, or not published |
| `THREAD_NOT_FOUND`, `MESSAGE_NOT_FOUND` | 404 | Not your conversation or message |
| `NOTE_NOT_FOUND` | 404 | Meeting note is not yours (or was deleted) |
| `MEETING_CHAT_CLOSED`, `MEETING_NOT_OVER` | 409 | Meeting chat is read-only after the meeting; the recap is ready only after it ends |
| `NOT_A_TEACHER`, `STAFF_NOT_FOUND` | 400/404 | Teacher app preview: the staff member is not teaching staff, or not in this school |
| `OWN_MESSAGE`, `ALREADY_FLAGGED`, `ALREADY_HIDDEN`, `NOT_HIDDEN`, `NOT_FLAGGED` | 400/409 | Chat reporting and hiding rules |
| `PAYMENT_EXCEEDS_BALANCE`, `DISCOUNT_TOO_HIGH`, `NO_PLAN_FOR_INSTALLMENT` | 400 | Fees: the amount is more than the invoice balance, the discount goes below what is paid, or no plan has that installment |
| `INVOICE_PAID`, `INVOICE_CANCELLED`, `INVOICE_HAS_PAYMENTS` | 409 | Fees: nothing left to pay, the invoice is cancelled, or it has payments and cannot be cancelled |
| `FEE_HEAD_EXISTS`, `TRANSPORT_HEAD_EXISTS`, `FEE_HEAD_IN_USE` | 409 | Fees: head code taken, a transport head already exists, or the head is on plans or invoices |
| `INVOICE_NOT_FOUND`, `RECEIPT_NOT_FOUND`, `FEE_HEAD_NOT_FOUND` | 404 | Fees: not found or in another school (or another child for parents) |
| `EXAM_NOT_FOUND`, `SECTION_NOT_IN_EXAM`, `SUBJECT_NOT_IN_EXAM`, `CLASS_NOT_IN_EXAM` | 404 | Exams: the exam, or this section or subject in it, does not exist |
| `NOT_YOUR_SUBJECT` | 403 | Staff app: the teacher neither teaches this subject in the section nor is its class teacher |
| `EXAM_PUBLISHED` | 409 | Results are out: teachers can no longer change marks and the exam cannot be deleted |
| `EXAM_EXISTS`, `CLASS_HAS_MARKS`, `SUBJECT_HAS_MARKS`, `MARKS_ABOVE_MAX` | 409 | Exam name taken this year, or the change would lose or invalidate marks already entered |
| `CLASS_HAS_NO_SUBJECTS`, `NO_MARKS` | 400 | Pick class subjects in School setup first, or enter marks before publishing |

## Field conventions

- Field names are `snake_case`.
- IDs are integers.
- Dates are ISO 8601 with the India offset, for example `2026-11-02T09:15:00.000+05:30`.
- Mobile numbers are 10 digits. The API accepts `+91 98765 43210` and stores `9876543210`.
- `language` is `en` or `ta`. Notifications arrive in the user's language.
- Every response carries an `X-Request-Id` header. Include it when you report a bug.

## Push notifications

- Register the device after sign-in (or pass `client.fcm_token` in verify): `POST /me/devices` with `fcm_token`, `platform`, `app`. Call it again whenever Firebase gives a new token.
- Remove on sign-out: handled by `POST /auth/logout`. To remove a token alone: `DELETE /me/devices?fcm_token=...`.
- Push `data` always has `notification_id`, `category` and `template`, plus the values used in the message (for example `bus`, `stop`, `minutes`). Use `category` to open the right screen.
- The notification centre is `GET /me/notifications` (in-app copy of every message), `GET /me/notifications/unread-count`, `PATCH /me/notifications/{id}/read` and `POST /me/notifications/read-all`.

## Which school

Every school user belongs to one school, and the API reads it from the token. The super admin belongs to none: on `/admin/*` school pages they send `X-School-Id: <id>`, or the API answers `400 SCHOOL_REQUIRED`. The Flutter apps never send this header.

### School logo

`GET /me` returns `school: { id, name, code, logo_url }`. Show `logo_url` on the app header and splash; it is `null` when the school has no logo. The link is signed and expires after `FILE_URL_TTL_SECONDS` (1 hour), so take it from a fresh `/me` instead of caching it.

The admin web sets it in School setup → School profile: `POST /files` (purpose `school_logo`, PNG/JPG/WEBP), then `PATCH /admin/school { "logo_file_id": <id> }`, or `null` to remove it. A file that is not an image returns `400 VALIDATION_FAILED` on `logo_file_id`. ID cards, fee receipts, payslips and TCs print the same logo.

### Admin web roles

| Role | Sees in the admin web |
|---|---|
| School admin | Everything in the school, except assigning substitutes |
| Principal | Every module read-only, staff leave approval, announcements |
| AO (Administrative officer) | Admissions, students, staff records, attendance, fee collection, exams (view), timetable (view), announcements, bus status; **the only role that assigns substitutes**. No payroll, users and roles, staff bank details or school setup changes |
| Transport in-charge | Buses, routes and stops, students (view) |

Substitutes: `POST /admin/substitutes`, `POST /admin/substitutes/auto` and `DELETE /admin/substitutes/{id}` need `substitutes.manage` (AO only; others get `403 FORBIDDEN` and can still view the board). A substitute is set for one date and one period, only for a teacher who is on approved leave or absent that day, and only from the teachers who are free in that period (`GET /admin/substitutes/free`); anyone else returns `409 SUBSTITUTE_BUSY`.

### Dashboard (admin web)

`GET /admin/dashboard` returns the home screen in one call for every admin-web role. Each section is present only when the caller has its permission and is `null` otherwise:

| Section | Permission | Fields |
|---|---|---|
| `students` | `students.view` | `total` (active), `joined_this_month`, `applications_waiting`, `approved_not_enrolled` |
| `staff` | `staff.view` | `total`, `teachers`, `need_attention` |
| `attendance` | `attendance.view` | `students: { working_day, marked_sections, total_sections, present, absent, on_leave, percent }`, `staff: { total, checked_in, late, on_leave, absent, percent }` |
| `buses` | `fleet.view` | `telematics_available`, `total`, `with_tracker`, `live`, `moving`, `offline` (the last three are `null` when bus tracking is down; the call still returns 200) |
| `alerts` | `fleet.view` | `open`, `sos_open`, `high_open` |
| `fees` | `fees.view` | `academic_year`, `due_amount`, `overdue_amount`, `overdue_students`, `todays_collection` (`null` with no current academic year) |
| `exams` | `exams.view` | `total`, `upcoming`, `in_progress`, `published` for the current year |

`date` is today in the school time zone. Percentages have one decimal and are `null` when there is nothing to count. Student `percent` is the attendance board's figure (half day counts half); staff `percent` is `checked_in / (total - on_leave)`.

### Combine class (instead of a proxy)

When no teacher should take the period, the AO can send the students to other sections of the same class that have a period running at that time with a teacher in:

1. `GET /admin/substitutes/combine-options?date=&slot_id=` returns `students: { total, boys, girls }` and `targets`: each running section with its subject, teacher (its own, or its proxy), `students` and `joining` (students already sent there). Empty `targets` means no other section is running, so assign a proxy.
2. `POST /admin/substitutes/combine` with `mode: "whole"` and `section_id`, or `mode: "split"` with `boys_section_id` and `girls_section_id` (students marked other go with the girls). The teachers of those sections get `CLASS_COMBINED` (English and Tamil).

The board then shows the period with `kind: "combine"` and `combined_into: [{ section, group, students, teacher }]`; a proxy has `kind: "proxy"` and `substitute`. Either one counts as covered. Setting a proxy replaces a combine and the other way round; `DELETE /admin/substitutes/{id}` removes either. Errors: `409 SECTION_NOT_AVAILABLE` (that section has no class with a teacher then), `400` on `girls_section_id` when boys and girls are sent to the same section. AO and super admin only.

## Parent app: my children

`GET /mobile/parent/children` (Parent role) lists every active child linked to the signed-in parent, across schools, with this year's class:

```json
[
  {
    "id": 12,
    "full_name": "Kavin Narayanan",
    "admission_no": "TZMS-2026-0012",
    "gender": "male",
    "dob": "2015-04-12",
    "photo_file_id": null,
    "class_name": "6",
    "section_name": "A",
    "roll_no": 12,
    "class_teacher": "Priya Venkatesh",
    "relation": "father",
    "school": { "id": 1, "name": "Tamilzorous Model School" }
  }
]
```

Brothers and sisters show up together because the school links them to the same parent mobile. An empty list means the school has not linked a child yet. Sign in as 9000000005 (Tamil) to try it.

Child screens (all read-only, `{id}` comes from the list above; a child that is not linked to the parent returns `404 CHILD_NOT_FOUND`):

| Call | Screen |
|---|---|
| `GET /mobile/parent/children/{id}` | Child card: class, section, class teacher, photo, blood group, house and `counts` for the tile badges |
| `GET /mobile/parent/children/{id}/id-card` | Digital ID card. Draw `qr_token` as a QR code; the bus attendant scans it |
| `GET /mobile/parent/children/{id}/documents` | Documents the school shares, with `status` pending, verified or rejected |
| `GET /mobile/parent/children/{id}/health` | Health summary, BMI and the vaccination log (`overdue` flag) |
| `GET /mobile/parent/children/{id}/behaviour` | Behaviour notes shared with parents (appreciation, concern, incident) |

If the school replaces a lost card, the old `qr_token` stops working. Fetch the ID card again instead of caching it for long.

### Attendance and leave (parent)

| Call | Screen |
|---|---|
| `GET /mobile/parent/children/{id}/attendance/today` | Home badge: `{ "date": "2026-11-02", "status": "absent" }`; `status` is `null` until the class teacher marks |
| `GET /mobile/parent/children/{id}/attendance?month=2026-11` | Calendar: `days[]` with `date` and `status` (present, absent, late, half_day, leave, holiday), plus `summary.percent` |
| `GET /mobile/parent/children/{id}/leaves` | Leave requests, newest first, with `status` pending, approved, rejected or cancelled |
| `POST /mobile/parent/children/{id}/leaves` | `{ "from_date": "2026-11-10", "to_date": "2026-11-11", "reason": "Fever", "file_id": null }`. Up to 7 days back, 30 days long. **Half day:** add `"half_day": "morning"` or `"afternoon"` with the same from and to date; it counts 0.5 day, the child defaults to leave only in that session, and a morning and an afternoon half day on the same date are both allowed (`400` on `to_date` for two dates, `409 LEAVE_OVERLAP` against a full day). Every leave has `half_day` (null for full days) |
| `POST /mobile/parent/children/{id}/leaves/{leaveId}/cancel` | Cancel while it is still pending |

| `GET /mobile/parent/children/{id}/achievements` | Achievements the school shares, newest first |
| `GET /mobile/parent/children/{id}/transport` | Bus card: route, stop with `pickup_time` and `drop_time`, bus registration, driver and attendant with mobile, `monthly_fee`. `null` when the child does not use the bus |

When the class teacher marks the child absent for today's morning attendance, the parent gets a `STUDENT_ABSENT` push (once per day) and an in-app notification. The parent is told again when a leave request is approved or rejected (`LEAVE_STATUS`).

### Parent app preview (admin web)

The admin web shows the parent app for any student in a phone frame. It never signs in as the parent: these read-only calls (`students.view`) use the same services as the parent endpoints. Attendance, results and fees come from the existing admin calls (`/admin/attendance/students/{id}?month=`, `/admin/students/{id}/results`, `/admin/students/{id}/fees`).

| Call | Same data as |
|---|---|
| `GET /admin/students/{id}/parent-view` | `{ parent, child, today }`: `child` is the parent's child card, `today` the attendance badge. `parent` and `child` are `null` when no parent of the student has an app login |
| `GET /admin/students/{id}/parent-view/bus` | `GET /mobile/parent/children/{id}/bus` |
| `GET /admin/students/{id}/parent-view/achievements` | `GET /mobile/parent/children/{id}/achievements` |
| `GET /admin/students/{id}/parent-view/notifications?page=1&limit=10` | The primary parent's `GET /me/notifications` |
| `GET /admin/students/{id}/parent-view/diary?type=` | `GET /mobile/parent/children/{id}/diary` (also needs `diary.view`) |
| `GET /admin/students/{id}/parent-view/meetings?scope=upcoming\|past\|all` | The primary parent's `GET /mobile/parent/meetings?student_id={id}` (also needs `meetings.view`) |
| `GET /admin/students/{id}/parent-view/chat` | The primary parent's threads about this child (also needs `chat.audit`) |
| `GET /admin/students/{id}/parent-view/chat/{threadId}/messages?before_id=&limit=` | Messages as the parent sees them. Each call writes a `viewed_thread` row to the chat access log under the admin |
| `GET /admin/students/{id}/parent-view/announcements?unread=` | The primary parent's `GET /me/announcements` (also needs `announcements.view`) |

Without a parent login, meetings, chat and announcements return an empty page and a thread returns `404 THREAD_NOT_FOUND`. Everything is the current academic year only.

### Teacher app preview (admin web)

The same idea for a teacher, by **staff id** (`staff.view`). Non-teaching staff return `400 NOT_A_TEACHER`, an unknown id `404 STAFF_NOT_FOUND`.

| Call | Same data as |
|---|---|
| `GET /admin/staff/{id}/teacher-view` | `{ teacher, today, classes, counts }`: `today` is `GET /mobile/teacher/timetable/today`, `classes` is `GET /mobile/teacher/classes`, `counts` has `diary_pending`, `meetings_upcoming`, `chat_unread`, `announcements_unread`. `teacher.can_sign_in` is `false` when the login is switched off |
| `GET /admin/staff/{id}/teacher-view/diary?status=&type=&section_id=` | `GET /mobile/teacher/diary` (also needs `diary.view`) |
| `GET /admin/staff/{id}/teacher-view/meetings?scope=` | `GET /mobile/teacher/meetings` (also needs `meetings.view`) |
| `GET /admin/staff/{id}/teacher-view/chat?student_id=` | `GET /mobile/teacher/chat/threads` (also needs `chat.audit`) |
| `GET /admin/staff/{id}/teacher-view/chat/{threadId}/messages` | Messages as the teacher sees them; logged as `viewed_thread` |
| `GET /admin/staff/{id}/teacher-view/announcements?unread=` | The teacher's `GET /me/announcements` (also needs `announcements.view`) |

## Staff app: teachers

Teacher, HOD and Principal roles. Everything is limited to the teacher's own sections this year; other sections return `403 NOT_YOUR_SECTION`.

| Call | Screen |
|---|---|
| `GET /mobile/teacher/classes` | My classes: class-teacher sections first, then sections I teach, with my subjects and student count |
| `GET /mobile/teacher/sections/{id}/students` | Class roster in roll-number order |
| `GET /mobile/teacher/students/{id}` | Student detail (read-only) |
| `GET /mobile/teacher/students/{id}/behaviour` | Behaviour notes |
| `POST /mobile/teacher/students/{id}/behaviour` | Add a note: `{ "category": "appreciation", "title": "Neat notebook all week", "visible_to_parent": true }` |

Sign in as 9000000004 (Priya, class teacher of 6-A) to try it.

### Attendance, check-in, leave and timetable (staff)

| Call | Screen |
|---|---|
| `GET /mobile/teacher/check-in` | Today's card: `check_in_at`, `check_out_at`, `status` (present, late, not_checked_in), distance from school |
| `POST /mobile/teacher/check-in` | `{ "lat": 13.0879, "lng": 80.2102, "accuracy_m": 12 }`. Refused with `OUTSIDE_SCHOOL` outside the school radius. Late is after the school reporting time plus 10 minutes |
| `POST /mobile/teacher/check-out` | Same body |
| `GET /mobile/teacher/my-attendance?month=2026-11` | My month |
| `GET /mobile/teacher/sections/{id}/attendance?date=2026-11-02&session=morning` | Roster for the **morning (1st period)** or **afternoon (5th period)** session. `open` is true only today between `opens_at` and `closes_at`; students on approved leave default to `leave`; the afternoon starts from the morning marks |
| `PUT /mobile/teacher/sections/{id}/attendance` | `{ "date": "2026-11-02", "session": "afternoon", "items": [{ "student_id": 12, "status": "absent", "remarks": null }] }`. Send every student once. `400 SESSION_NOT_OPEN` before the period, `400 SESSION_CLOSED` after it, `400 PERIOD_NOT_ALLOWED` for other periods. Absent alerts go once a day per student |
| `PATCH /mobile/teacher/sections/{id}/attendance` | **Mark only some students in one call**, each with its own status: `{ "date": "2026-11-10", "session": "morning", "items": [{ "student_id": 12, "status": "A" }, { "student_id": 14, "status": "L", "remarks": "Came 9:20" }] }`. Everyone else keeps the saved status (or the default). Status can be the word or the button letter: **P = present, A = absent, L = late** (L is never leave). Same period window and absent alerts as PUT. Admin twin: `PATCH /admin/attendance/sections/{id}` |
| `GET /mobile/teacher/timetable` | My week: `periods` (bell schedule) and `slots` with `day_of_week` 1 Monday … 6 Saturday |
| `GET /mobile/teacher/leave-balances` | Per leave type: allowed, used, pending, balance |
| `GET /mobile/teacher/leaves` | My requests |
| `POST /mobile/teacher/leaves` | `{ "leave_type_id": 1, "from_date": "2026-11-20", "to_date": "2026-11-21", "half_day": false, "reason": "Family function" }`. Goes to the HOD of my department, then the principal |
| `POST /mobile/teacher/leaves/{id}/cancel` | Cancel while waiting |
| `GET /mobile/teacher/leave-approvals` | HOD / principal: staff requests waiting for me |
| `POST /mobile/teacher/leave-approvals/{id}/decision` | `{ "status": "approved", "note": null }` |
| `GET /mobile/teacher/student-leaves?status=pending` | Class teacher: parent leave requests for my sections (paginated) |
| `POST /mobile/teacher/student-leaves/{id}/decision` | `{ "status": "rejected", "note": "Please bring the medical note" }` |

| `GET /mobile/teacher/timetable/today` | Home: today's periods in bell order with `kind` (class, substitute, free, break), section, subject, room, `students`, `present` (after the morning attendance) and `is_now`. Tap a section to open its student list |
| `GET /mobile/teacher/students/{id}/history` | Student full history: profile and parents (with mobile numbers), attendance this year and this month, leave, remarks and discipline (`behaviour`), `achievements`, health, documents and ID card |
| `GET` / `POST /mobile/teacher/students/{id}/achievements` | List or add an achievement: `{ "title": "Inter-school football", "category": "sports", "level": "district", "result": "winner", "event_scope": "inter_school", "venue_type": "outdoor", "participation": "team", "team_name": "U-14 team", "prize_received": "Trophy", "school_reward": "Medal", "achieved_on": "2026-10-24" }`. Sports needs `venue_type`. Parents are told |
| `GET /mobile/teacher/sections/{id}/activity-ranking` | My section ranked by sports and activity points (default all non-academic; `?category=sports` for sports only) |
| `GET /mobile/teacher/banner` | Home alert banner: `{ date, banners: [{ code, severity, title, message, count?, action: { screen, params? } }] }`, most important first. Codes: `HOLIDAY_TODAY`, `ON_LEAVE_TODAY`, `CHECK_IN_PENDING`, `ATTENDANCE_NOT_MARKED` (`params.section_id`), `PROXY_TODAY`, `COMBINED_CLASS_TODAY`, `LEAVE_REQUESTS_PENDING`, `UNREAD_ALERTS`. Empty list = nothing to show |
| `GET /mobile/teacher/sections/{id}/students?sort=&order=` | Roster sorted by `roll_no` (default), `name` or `rank` (latest published exam, or `exam_id`), `asc` or `desc`; each student has `rank`. Students without a roll number or rank come last |
| `GET /mobile/teacher/sections/{id}/benches?sort=&order=&groups=3` | Bench-wise view: the sorted roster split into `groups` (2–9, default 3) labelled First, Second … Last. 30 students give 10, 10, 10; 31 give 11, 10, 10 |
| `GET /mobile/teacher/payslips?year=&month=` | My final payslips, newest first, filtered by year and/or month (1–12) |
| `GET /mobile/teacher/payslips/periods` | Years and months that have a payslip (net per month, total per year) to fill the year and month filters |
| `GET /mobile/teacher/payslips/{id}` | Payslip preview: `earnings[]` and `deductions[]` lines, working, paid and LOP days, gross, net and `pdf_path`; another person’s payslip returns `404 PAYSLIP_NOT_FOUND` |
| `GET /mobile/teacher/payslips/{id}/pdf` | Payslip PDF download. The same four calls also exist under `/me/payslips` for every staff role |
| `GET /mobile/teacher/profile` | Me screen header: designation, department, subjects, `is_hod`, `class_teacher_of`, weekly load and a ready `headline` ("Mathematics · HOD · Class teacher 6 - A") |
| `GET /mobile/teacher/leaves/preview?leave_type_id=&from_date=&to_date=&half_day=` | Before applying: working days (Sundays and holidays left out), balance before and after, my periods on those days, morning-attendance sections, who decides first (`goes_to`) and a ready `message` |
| `GET /mobile/teacher/classes` | Now also `periods_per_week`, `academic_year`, and for class-teacher sections `class_teacher_summary` (present and absent today, attendance marked, fees overdue and due, parent leave requests) |
| `GET /mobile/teacher/sections/{id}/students` | Each student also has `today_status` (present, absent, late, half_day, leave, not_marked) |
| `GET /mobile/teacher/timetable/today` | Substitute periods have `covering_for` (the teacher who is away) |
| `GET /mobile/teacher/leave-approvals` | Each request also has `balance_remaining`, `affected_periods` and `affected_sections` |
| `GET /mobile/teacher/check-in` | Also `school_latitude` and `school_longitude`, so the app can show the distance before checking in |
| `GET /mobile/teacher/substitutions` | Classes I cover for absent teachers, today and the next 7 days: date, period and time, section, subject, room, who is away, note |

Staff leave status moves `pending_hod` → `pending_principal` → `approved` (or `rejected` at any step). With no HOD in the department it starts at `pending_principal`.

### Two attendance sessions a day

Student attendance is taken in the **1st period (`session: "morning"`)** and the **5th period (`session: "afternoon"`)**; they are stored as periods 1 and 5. The old `period` field still works (0 or 1 = morning, 5 = afternoon); any other period gives `400 PERIOD_NOT_ALLOWED`.

- **The day** comes from both sessions: both present = `present` (`late` if either was late), absent in one = `half_day`, absent in both = `absent`, leave in both = `leave`. Reports, percentages, the parent calendar, today's badge, the report card and bus no-shows all use the day.
- **Teachers** can save a session only **today during its period**: morning in the 1st period, afternoon in the 5th (bell times from the timetable). Before it: `400 SESSION_NOT_OPEN`; after it or on an earlier day: `400 SESSION_CLOSED`. The office (AO, admin) can save any session at any time, so a missed session is marked by the AO.
- **Absent alert**: once per student per day. Absent in the morning → alert; present in the morning and absent in the afternoon → alert "(afternoon)".
- Parent `GET /mobile/parent/children/{id}/attendance/today` and each day of the month calendar now also return `morning` and `afternoon`.

### Attendance reports (admin web)

| Call | What it gives |
|---|---|
| `GET /admin/attendance/board?date=&session=morning` | Every section for the session, with `morning_marked` and `afternoon_marked` |
| `GET /admin/attendance/sections/{id}?date=&session=` | Section roster for the session |
| `GET /admin/attendance/sections/{id}/report?month=` | Section, student-wise %, monthly |
| `GET /admin/attendance/sections/{id}/report/xlsx?month=` | Same as Excel |
| `GET /admin/attendance/classes/{id}/report?month=` | **Class-wise**: every section of the class with students, days marked, average % and below 75% |
| `GET /admin/attendance/classes/{id}/report/xlsx?month=` | Same as Excel |
| `GET /admin/attendance/students/{id}?month=` | Student-wise month: each day with `morning`, `afternoon` and the day `status` |
| `GET /admin/attendance/sections/{id}/day?date=` | **Daily** report of a section: each student with `morning`, `afternoon`, day `status`, plus `summary` counts and % |
| `GET /admin/attendance/students/{id}/summary` | Student this academic year: `year` totals and `months[]`, each with `working_days`, `marked_days`, counts and `percent` |

### Parent profile (Parent app)

| Call | What it does |
|---|---|
| `GET /mobile/parent/profile` | My profile: `name`, `mobile`, `alt_mobile`, `email`, `occupation`, `qualification`, `language`, `address_line`, `city`, `pincode`, `on_app`, `last_login_at`, `children[]` (`id`, `full_name`, `class_section`, `relation`, `admission_date`, `years_in_school`) and `co_guardians[]` (the other parent: `name`, `mobile`, `relation`) |
| `PATCH /mobile/parent/profile` | Change `alt_mobile`, `email`, `occupation`, `qualification`, `address_line`, `city`, `pincode`, `language` (`en`/`ta`). Send only what changes; `null` clears a field. Returns the profile |

- Name, mobile (the login), children and relation are changed only by the school office (`PATCH /admin/guardians/{id}`); sending `name` or `mobile` gives `400 VALIDATION_FAILED`.
- `language` also changes the app and notification language (`GET /me` shows it).
- Same data and table as the admin parent page: no copy.
- `404 PARENT_PROFILE_NOT_FOUND` when the login is not linked to a parent record.

### Attendance time window, grace and missed

Teachers mark the **morning** session in the 1st period and the **afternoon** session in the 5th period, plus a grace time after each period (school setting `attendance_grace_minutes`, default 15, 0–30, `PATCH /admin/school`). Example: 1st period 09:00–09:45 with 15 min grace → teachers can mark 09:00–10:00.

**Teacher, without date or session** (the API uses its own clock in India time; the phone time is never used):

| Call | What it does |
|---|---|
| `GET /mobile/teacher/sections/{section_id}/attendance/current` | Roster of the session open now. Outside the windows `open` is false (read-only) |
| `PUT /mobile/teacher/sections/{section_id}/attendance/current` | `{ "items": [{ "student_id", "status", "remarks" }] }` with every student |
| `PATCH /mobile/teacher/sections/{section_id}/attendance/current` | `{ "items": [...] }` with only the students to change |

- Roster fields: `date`, `session`, `open`, `opens_at`, `period_ends_at`, `closes_at` (period end + grace), `grace_minutes`.
- `400 SESSION_NOT_OPEN` before the period, `400 SESSION_CLOSED` after the grace. Sending `date` or `session` to `/current` gives `400 VALIDATION_FAILED`.
- The old calls with `date` and `session` still work and follow the same window with grace.
- A **proxy teacher** assigned to the 1st or 5th period of that section that day can also mark.

**Missed** = not marked when the period plus grace is over (Sundays and holidays never count).

| Call | What it gives |
|---|---|
| `GET /admin/attendance/board?date=&session=&status=missed` | Each section has `missed` and `class_teacher_id`; the board has `sections_missed`, `opens_at`, `closes_at`, `grace_minutes`. `status` = `marked`, `not_marked` or `missed` filters the list |
| `GET /admin/attendance/missed?month=2026-11` | Per class teacher: `missed` count and `sessions[]` (`date`, `session`, `section`, `still_not_marked`), most missed first |

Alerts (every minute, once per section and session):
- `ATTENDANCE_REMINDER` to the class teacher and the proxy when the period ends and it is still not marked ("You can still mark it until 10:00").
- `ATTENDANCE_MISSED` to AO and Admin once the grace is over, listing the sections.

### Attendance reports (class teacher and parent)

Class teacher (Staff app). Only the class teacher of the section or student; others get `403 NOT_CLASS_TEACHER`.

| Call | Report |
|---|---|
| `GET /mobile/teacher/sections/{id}/attendance/day?date=2026-11-10` | Daily: every student with morning, afternoon, day status and the day counts |
| `GET /mobile/teacher/sections/{id}/attendance/report?month=2026-11` | Monthly, class-wise: every student with present, late, half day, absent, leave and % |
| `GET /mobile/teacher/students/{id}/attendance?month=2026-11` | Student-wise month: each day and the month % |
| `GET /mobile/teacher/students/{id}/attendance/summary` | Student-wise year: year % and each month's % |

Parent (own child only, else `404 CHILD_NOT_FOUND`).

| Call | Report |
|---|---|
| `GET /mobile/parent/children/{id}/attendance/today` | Daily: today's morning, afternoon and day status |
| `GET /mobile/parent/children/{id}/attendance?month=2026-11` | Monthly: each day and the month % |
| `GET /mobile/parent/children/{id}/attendance/summary` | Year: year % and each month's % |

`percent` = (present + late + half of half_day) / marked days × 100, one decimal; `null` when nothing is marked yet. Sundays and holidays are not working days.

### Admin web: daily attendance and bulk marking (AO, admin)

| Call | What it does |
|---|---|
| `GET /admin/staff-attendance/board?date=&page=1&limit=20&search=&status=` | Staff for a date, **a page at a time** (default 20, max 100). `total`, `present`, `late`, `on_leave`, `not_checked_in` count the whole school; `staff` is the page after `search` (name, designation, department) and `status` (`present` includes half day, `not_checked_in` includes absent). Also `page`, `limit`, `filtered_total`, `total_pages`, `has_next` |
| `PUT /admin/staff-attendance/{userId}` | Correct one person; reason required, saved as manual |
| `PUT /admin/staff-attendance/bulk` | Mark many staff: `{ "date", "user_ids": [9, 12], "status": "present", "check_in_at": null, "check_out_at": null, "remarks": null }`, or `"all_not_checked_in": true` instead of `user_ids`. **Reason optional**. Staff on approved leave are skipped unless the status is `absent`. Returns `{ marked, skipped: [{ id, name, reason }] }`; `400` on `user_ids` when nobody is chosen, `FUTURE_DATE` |
| `PUT /admin/attendance/bulk` | Mark many sections for a session: `{ "date", "session": "morning", "section_ids": [3, 4], "status": "present", "remarks": null, "overwrite": false }`; leave out `section_ids` for every section not marked yet. Every student gets the status, students on approved leave stay `leave`, sections already marked are skipped unless `overwrite`. Absent alerts go to parents as usual (today only). Returns `{ marked, students, skipped }`; `HOLIDAY`, `NOT_A_SCHOOL_DAY`, `NOTHING_TO_MARK` |

Permission `attendance.manage` (AO, school admin, super admin).

Biometric machines push punches to `POST /integrations/biometric/punches` with header `X-Device-Key` (`BIOMETRIC_WEBHOOK_KEY`); the first punch of the day is the check-in and the last is the check-out.

## Live bus

### Driver app (Driver and Attendant)
| Call | Screen |
|---|---|
| `GET /mobile/driver/trips/today` | Home: my bus, `active_trip` (the trip running now) and each route with today's trips. Show "Start morning pickup" / "Start evening drop" when `active_trip` is null |
| `POST /mobile/driver/trips` | `{ "route_id": 1, "kind": "pickup" }` starts the trip. Parents of the route get "Bus has started". 409 `TRIP_ALREADY_ACTIVE`, 400 `NO_TRACKER` |
| `GET /mobile/driver/trips/{id}` | Trip screen: `stop_list` in travel order with `status` and `eta_seconds`, `school` (end of a pickup), `riders` (with `boarded`, `alighted`), `not_boarded` and `boardings` (newest first) |
| `POST /mobile/driver/trips/{id}/positions` | Phone GPS fallback every 5–10 s: `{ "lat", "lng", "speed", "heading" }`. Used only when the bus tracker is silent for 60 s |
| `POST /mobile/driver/trips/{id}/end` | End by hand. A pickup also ends by itself inside the school gate; a drop after the last stop |
| `POST /mobile/driver/trips/{id}/boardings` | Scan or tap: `{ "action": "boarded", "qr_token": "TZS1.12.1.…" }` after scanning the ID card, or `{ "action": "alighted", "student_id": 12 }` from the `riders` list. Returns the row with `method` (`qr`/`manual`), `stop` (null at the school gate), `occurred_at` and `already_recorded` (a double scan is safe and sends nothing). Parents get **{child} boarded the bus** / **got off the bus**. 409 `NOT_ON_THIS_ROUTE`, `NOT_ON_THIS_TRIP`, `NOT_BOARDED`, `QR_REPLACED` (old card), `TRIP_ENDED`; 400 `QR_INVALID` |
| `POST /mobile/driver/sos` | SOS button: `{ "trip_id"?, "lat"?, "lng"?, "note"? }` (all optional; the running trip and the bus position are used). School admins and the transport in-charge get a push and an SMS with the name and number to call. Pressing again within 2 minutes returns the same alert with `already_raised: true` |

### Parent app
`GET /mobile/parent/children/{id}/bus` returns `status` (`no_trip`, `on_the_way`, `approaching`, `at_stop`, `passed`, `trip_ended`), a ready `headline` ("Bus is 4 min away from Thirumangalam metro"), the child's `stop`, `eta_seconds`, `position` (live, or the bus's last known position with `position_stale`), `trip` and `boarding` (the child's latest scan on that trip: `action`, `method`, `stop`, `occurred_at`; null before the first scan). It is `null` when the child does not use the bus.

**v2 with the stop timeline.** `GET /api/v2/mobile/parent/children/{id}/bus` is the same call with the same access rules; **v1 stays unchanged** and keeps working. v2 returns every v1 field plus:

| Field | Meaning |
|---|---|
| `boarding_status` | `not_yet`, `boarded` or `alighted` on today's trip |
| `last_position_at` | Time of the bus's last position, or `null` |
| `timeline` | `{ source, trip_id, kind, trip_date, child_stop_id, stops }`, or `null` when the route has no stops or no trip is planned in the next 14 days |

`timeline.source` is `live` while a trip runs (`trip_id` is that trip) and `scheduled` when none is running: then it is the next planned trip for the child's route and mode (today's pickup or drop if it has not run and its time has not passed, otherwise the next working day), `trip_id` is `null` and every stop is `pending`. Each item of `stops`, in travel order: `stop_id`, `name`, `sequence`, `planned_time` ("07:25"), `planned_at`, `status` (`pending`, `approaching`, `arrived`, `departed`, `skipped`), `eta_seconds` and `eta_at` (upcoming stops only, counted from the last bus position), `arrived_at` and `departed_at` (past stops only), `is_child_stop`, and `minutes_late` (minutes behind `planned_time`, negative when early: from the arrival for past stops, from the ETA for upcoming ones; `null` when unknown or skipped).

Parents are told automatically: **Bus has started** (whole route), **Bus is N min away** (only parents of that stop, before the bus arrives; SMS if the push does not reach the phone) and **Bus reached {stop}**, plus **{child} boarded the bus** and **{child} got off the bus** when the attendant scans the ID card.

At the end of a pickup, class teachers get the list of expected children who were not scanned on (only when the trip had at least one scan, so a bus without scanning sends no false list).

### Live updates (socket.io)
Connect to the namespace `/live` on the API host with `{ auth: { token: "<access_token>" } }`, then:

- `emit('trip.subscribe', { trip_id })` → ack `{ ok: true }`. A parent can follow only a trip their child rides; a driver only their own bus; admins any trip of their school. Otherwise `{ ok: false, error: "FORBIDDEN" }`.
- Receive `trip.position` `{ trip_id, position: { lat, lng, speed, heading, recorded_at, source } }` every few seconds and `trip.event` `{ trip_id, type, stop, eta_seconds, end_reason }` for `trip.started`, `stop.approaching`, `stop.arrived`, `stop.departed`, `trip.ended`.
- `passenger.boarded` / `passenger.alighted` `{ trip_id, boarding_id, student_id, action, method, stop, occurred_at }` on each scan. The fleet room (admin web) also gets `full_name` and `class_section`; trip followers (parents) get only `student_id`.
- Admin web: `emit('fleet.subscribe', {})` to get every trip of the school plus `alert.raised` and `alert.updated` (same shape as an alerts centre row).
- When the access token expires the socket is closed with an `error` event: refresh the token and connect again.

### Alerts centre (admin web)
`GET /admin/fleet/alerts` lists SOS and safety alerts, newest first: search (message, bus, driver), `kind` (`sos`, `overspeed`, `harsh_braking`, `idle`, `route_deviation`, `vehicle_fault`, `other`), `status` (`open`, `acknowledged`, `resolved`), `severity`, `active=true` (not resolved), `vehicle_id`, `trip_id`, `from`, `to`. Each row has `kind_label`, `message`, `vehicle`, `route`, `trip`, `raised_by` (with `mobile` to call), `position`, `data` and who acknowledged or resolved it. `GET /admin/fleet/alerts/insights` returns `open`, `sos_active`, `high_active`, `acknowledged`, `resolved_today`, `raised_today` and `active_by_kind`. `POST .../{id}/acknowledge` (safe to repeat) and `POST .../{id}/resolve` `{ "resolution_note": "Called the driver, all safe" }` (at least 3 characters) need `fleet.manage`; reading needs `fleet.view`.

Safety alerts come from the Telematics service as `alert.raised` webhook events (overspeed, harsh braking, idling, off route). The bus is found from `device_id` (and the trip, when given). Retries of the same event are stored once. The office gets a push; `high` severity also an SMS when the push does not reach the phone.

### Maintenance, fuel, vehicle health and trip replay (admin web)
Read with `fleet.view`, change with `fleet.manage`. `{id}` of a bus is the school bus (`/admin/transport/vehicles`).

| Call | Use |
|---|---|
| `GET /admin/fleet/buses/{id}/health` | Health card: `bus`, `has_tracker`, `open_tickets` and `health` (null without a tracker): `status` `good`/`warning`/`critical`/`unknown`, `reasons`, `battery_v`, `coolant_c`, `rpm`, `fuel_pct`, `odometer_km`, `engine_load_pct`, `reading_at` and `faults` `[{ code, description, severity, first_seen_at }]` |
| `GET /admin/fleet/buses/{id}/obd?from&to&page&limit` | OBD log, newest first. 400 `NO_TRACKER` |
| `GET /admin/fleet/maintenance` | Tickets: search, `status` (`open`, `in_progress`, `done`), `source` (`obd`, `manual`), `vehicle_id`; sort `opened_at`, `closed_at`, `cost`, `status`. `GET .../insights?vehicle_id=` returns `total`, `open`, `in_progress`, `done`, `obd_open`, `cost_this_month` |
| `POST /admin/fleet/maintenance` | `{ "vehicle_id": 1, "title": "Front tyre worn", "description"?, "fault_code"? ("P0301"), "severity"?, "odometer_km"?, "vendor"?, "cost"?, "notes"? }` |
| `PATCH /admin/fleet/maintenance/{id}` | Any field above (not the bus) and `status`; `done` sets `closed_at`, leaving `done` clears it |
| `POST /admin/fleet/maintenance/{id}/close` | `{ "cost"?, "vendor"?, "odometer_km"?, "notes"? }`. 409 `TICKET_CLOSED` |
| `GET /admin/fleet/fuel` | Fuel log: `vehicle_id`, `from`, `to`, search (station, bus); sort `filled_on`, `amount`, `litres`, `odometer_km`. Each entry has `price_per_litre`, `km_since_last` and `km_per_litre` (distance since the previous fill of that bus ÷ litres of this fill; null for the first). `GET .../insights?vehicle_id=` returns this month's `entries_this_month`, `litres_this_month`, `amount_this_month` and `avg_km_per_litre` (last 90 days) |
| `POST` / `PATCH` / `DELETE /admin/fleet/fuel[/{id}]` | `{ "vehicle_id": 1, "filled_on": "2026-11-03", "litres": 60.5, "amount": 5800, "odometer_km": 48213, "station"?, "bill_file_id"? (from `POST /files`), "filled_by"? (user id) }`. `filled_on` cannot be in the future and `odometer_km` must sit between the fills before and after it (field errors) |
| `GET /admin/transport/trips?date&route_id&vehicle_id&status=ended` | Trip history |
| `GET /admin/fleet/trips/{id}/playback?max_points=1500` | Replay: `trip`, `school`, `path` (planned route), `points` `[{ at, lat, lng, speed, heading }]` oldest first (thinned evenly to `max_points`, `sampled` says so), `distance_km`, `duration_seconds`, `max_speed`, `avg_speed`, `stop_arrivals` and `safety_events`. 404 `TRACK_NOT_FOUND` |

When the Telematics service reports a new engine fault code it sends `vehicle.fault` `{ id, type, at, device_id, fault: { code, description, severity }, odometer_km? }`. The bus with that tracker gets a maintenance ticket (`source: obd`, one open ticket per code; retries are stored once) and admins and the transport in-charge get `VEHICLE_FAULT` (push and in-app; `bus`, `code`, `fault`, `severity`).

## Exams, marks and ranking

Grades (CBSE-like, on the percentage): A1 91+, A2 81+, B1 71+, B2 61+, C1 51+, C2 41+, D 33+, E below. A student fails with any subject below its pass marks or absent. `percent` has one decimal. Ranks use competition ranking on the total (1, 2, 2, 4): equal totals share a rank. A student with any mark not entered is `incomplete`, has `percent`, `grade` and ranks `null`, and is not ranked. `result` is `pass`, `fail` or `incomplete`.

### Staff app (Teacher, HOD, Principal)

| Call | Screen |
|---|---|
| `GET /mobile/teacher/exams` | Exams this year with my sections and the subjects I can enter (class teacher: every subject), each with `entered` / `total` |
| `GET /mobile/teacher/exams/{id}/sections/{sectionId}/marks?subject_id=4` | Marks sheet in roll order: `marks`, `is_absent`, `entered`; `editable` is false once results are published |
| `PUT /mobile/teacher/exams/{id}/sections/{sectionId}/marks?subject_id=4` | `{ "items": [{ "student_id": 12, "marks": 78.5, "is_absent": false }] }`. Marks 0 to max marks; `is_absent: true` saves an absence; `marks: null` with `is_absent: false` clears. Some or all students. `400 VALIDATION_FAILED` with `errors[].field` `items.N.marks`; `403 NOT_YOUR_SUBJECT`; `409 EXAM_PUBLISHED` |
| `GET /mobile/teacher/sections/{id}/ranking?exam_id=1` | Students by rank. Without `exam_id`: the latest published exam of the section's class; `exam` is `null` when there is none |

```json
{
  "exam": { "id": 1, "name": "Quarterly exam", "status": "published", "start_date": "2026-09-14", "end_date": "2026-09-24", "published_at": "2026-10-03T10:30:00.000+05:30" },
  "section": { "id": 8, "name": "6 - A", "class_id": 8, "class_name": "6", "section_name": "A" },
  "rows": [
    { "rank": 1, "student_id": 12, "full_name": "Janani Bala", "roll_no": 7, "total": 629, "max_total": 700, "percent": 89.9, "grade": "A2", "result": "pass", "class_rank": 2 },
    { "rank": 6, "student_id": 8, "full_name": "Bharath Kumar", "roll_no": 2, "total": 465, "max_total": 700, "percent": 66.4, "grade": "B2", "result": "pass", "class_rank": 10 },
    { "rank": 6, "student_id": 9, "full_name": "Dharshini Ravi", "roll_no": 4, "total": 465, "max_total": 700, "percent": 66.4, "grade": "B2", "result": "pass", "class_rank": 10 }
  ]
}
```

### Parent app

`GET /mobile/parent/children/{id}/results` lists the child's published results, newest first: `exam`, `class_name`, `section_name`, `total`, `max_total`, `percent`, `grade`, `result`, `section_rank` of `section_size`, `class_rank` of `class_size`, and `subjects[]` with `name`, `code`, `max_marks`, `pass_marks`, `marks`, `is_absent`, `passed`. When the school publishes results the parent gets `RESULT_PUBLISHED` (push and in-app; `exam`, `student`, `percent`, `grade`, `rank` like `2/15`).

### Admin web

`/admin/exams` (list, create with `class_ids`, `PATCH`, `DELETE` draft only), `/admin/exams/{id}/subjects` (`GET`, `PUT` the full list of papers), `/admin/exams/{id}/sections/{sectionId}/marks?subject_id=` (`GET`, `PUT`), `/admin/exams/{id}/sections/{sectionId}/results`, `/admin/exams/{id}/classes/{classId}/toppers?limit=3`, `/admin/exams/{id}/toppers` (top 3 of every class), `POST /admin/exams/{id}/publish` and `/admin/students/{id}/results`. Permissions `exams.view` (Principal, AO) and `exams.manage` (AO).

### Report card

One marksheet for a student built from the **published** exams of an academic year.

| Call | Who | Returns |
|---|---|---|
| `GET /admin/students/{id}/report-card` | `exams.view` | Report card JSON |
| `GET /admin/students/{id}/report-card/pdf` | `exams.view` | A4 PDF (inline, for print) |
| `GET /admin/report-cards/sections/{sectionId}/pdf` | `exams.view` | One PDF with a page per student, roll-number order; students without results in the scope are skipped |
| `GET /mobile/parent/children/{id}/report-card` | Parent | Report card JSON |
| `GET /mobile/parent/children/{id}/report-card/pdf` | Parent | A4 PDF (download) |

Query (all optional): `academic_year_id` (default: the current year, else the latest enrollment), then **one** scope: nothing = the whole year with every term side by side, `term_id` = only that term, `exam_id` = only that exam (wins over `term_id`). The section PDF takes `term_id` / `exam_id` only (the section fixes the year).

- `terms[]` groups the columns: `{ term_id, name, exam_ids }`. Exams without a term come last under "Other exams".
- `columns[]`: one per exam in order, with `total`, `max_total`, `percent`, `grade`, `result`, `section_rank`/`section_size`, `class_rank`/`class_size`, and `common_max` (the max marks when every paper has the same, for the header "Quarterly exam (100)").
- `subjects[]`: languages first, then theory, practical and activity, each by name. `cells[]` has one entry per column (`null` when the subject was not in that exam; `passed: null` when marks are not entered). The row's `total`, `max_total`, `percent`, `grade` add up every exam; `passed` is false when the total is below the sum of the pass marks.
- `overall`: totals of the complete exams. `result` is `fail` only when a subject's combined total is below its combined pass marks, so one weak unit test does not fail the year.
- `attendance`: daily attendance (period 0) in `scope.from`–`scope.to` (term or year dates, never after today). `late` counts as present, `half_day` as half.
- `remarks` (from the overall percentage), `grade_scale`, `options` (`academic_years`, `terms`, `exams` for the pickers) and `pdf_path`.

Errors: `404 STUDENT_NOT_FOUND`, `ENROLLMENT_NOT_FOUND`, `TERM_NOT_FOUND`, `EXAM_NOT_FOUND`, `SECTION_NOT_FOUND`, `CHILD_NOT_FOUND`; the PDFs give `404 NO_PUBLISHED_RESULTS` when there is nothing to print.

## App banners (image banners on the home screen)

The school office posts image banners (events, holidays, notices) in the admin web under Communication → App banners: image, title, short message, which app (`all`, `staff`, `parents`), first and last day, optional link and order. Only live banners (active and today between the dates) reach the apps, at most 5.

| Call | Use |
|---|---|
| `GET /mobile/teacher/banner` | Alerts first, then the school banners with `code: "SCHOOL_BANNER"`, `image_url`, `thumbnail_url` and `action` (`link` with `params.url`, or `home`) |
| `GET /mobile/parent/banner` | The school banners for parents, same item shape |
| `/admin/app-banners` | List (filters `state` live/scheduled/ended/paused, `audience`, search), `insights`, add, edit (`is_active: false` pauses), delete. Upload the image first with `POST /files` (purpose `app_banner`) |

Image links are signed and expire in about an hour, so take them from a fresh call instead of caching them.

## Sports and activities

Students are ranked by activities too, not only by marks. Every achievement has `result` (`winner`, `runner_up`, `third_place`, `participated` = took part, no win), `event_scope` (`sports_day`, `in_school`, `inter_school`, `out_of_school`), `venue_type` (`indoor`/`outdoor`, required for `category: "sports"`), `participation` (`individual`/`team` with `team_name`), `prize_received` (what the event gave), `school_reward` (what the school gave) and `points`.

Points = level (class 1, school 2, zone 3, district 5, state 8, national 12, international 15) × result (winner 4, runner-up 3, third 2, took part 1). A district winner scores 20.

| Call | Use |
|---|---|
| `GET /admin/achievements/leaderboard?category=sports` | Students ranked by points (`non_academic` = every activity except academic). Filters `class_id`, `section_id`, `from`, `to` (default: current academic year). Equal points share a rank |
| `GET /admin/achievements` | Every achievement in the school with filters: `category`, `level`, `result` (or `podium`), `event_scope`, `venue_type`, `participation`, `outside_school`, `district_or_above`, class and section, search |
| `GET /admin/achievements/insights` | Counts: total, sports, wins, outside school, district and above, students |
| `GET /mobile/teacher/sections/{id}/activity-ranking` | Same ranking for one of my sections |

## Fees and payment status

A student's fee `status` is one of:

| `status` | Meaning |
|---|---|
| `paid` | Nothing left to pay (also when nothing is billed yet; `total` is then 0) |
| `partly_paid` | Something is paid, a balance is left, nothing is past its due date |
| `due` | A balance is left, nothing is paid, nothing is past its due date |
| `overdue` | Some balance is past its due date (the due date itself is not overdue) |

Every fee summary also has `total`, `paid`, `balance`, `overdue_amount`, `next_due_date` (the next unpaid due date, or the oldest overdue one) and `last_payment` `{ date, amount }` or `null`. Invoices have `status` `unpaid`, `partly_paid`, `paid` or `cancelled`, plus `is_overdue` and `days_overdue`. Amounts are rupees as numbers with up to 2 decimals.

### Staff app (class teacher, read-only)

| Call | Screen |
|---|---|
| `GET /mobile/teacher/sections/{id}/fees` | Section roster with each student's fee `status`, `balance`, `next_due_date`, `overdue_amount`, `last_payment`, plus `counts` per status. Only the class teacher of the section; others get `403 NOT_CLASS_TEACHER` |
| `GET /mobile/teacher/students/{id}/fees` | One student's summary with invoices and payments (same shape as the parent call) |

```json
{
  "section_id": 8,
  "class_section": "6 - A",
  "counts": { "paid": 2, "partly_paid": 3, "due": 2, "overdue": 2 },
  "overdue_amount": 25440,
  "students": [
    { "student_id": 10, "full_name": "Gowtham Raja", "admission_no": "TZMS-2026-0002", "roll_no": 5, "photo_file_id": null,
      "status": "overdue", "total": 32400, "paid": 0, "balance": 32400, "overdue_amount": 18400,
      "next_due_date": "2026-10-03", "last_payment": null }
  ]
}
```

### Parent app

| Call | Screen |
|---|---|
| `GET /mobile/parent/children/{id}/fees` | Fee card and history: status, totals, `invoices` (each with `lines` such as tuition, books and transport, and its `payments`) and every `payment` newest first |
| `GET /mobile/parent/children/{id}/fees/receipts/{paymentId}` | Receipt PDF (`Content-Disposition: attachment`) |

Parents get `FEE_DUE` (category `fees`) when the school raises an invoice, and `FEE_OVERDUE` at 08:00 for each overdue invoice, at most once every 7 days. SMS is sent only if the push does not reach the phone.

### Admin web

`/admin/fees/heads` (CRUD; one transport head), `/admin/fees/plans` and `/admin/fees/plans/{classId}` (`GET`, `PUT` the lines of a class: head, installment, amount, due date), `/admin/fees/installments`, `POST /admin/fees/invoices/generate` `{ class_id?, installment, due_date? }` (safe to run again), `/admin/fees/invoices` (search, `status`, `class_id`, `section_id`, `installment`, `overdue`), `/admin/fees/invoices/{id}`, `PATCH .../discount`, `POST .../cancel`, `POST .../payments`, `/admin/fees/payments` (+ `/summary`, `from`, `to`, `mode`), `/admin/fees/payments/{id}/receipt`, `/admin/fees/insights` and `/admin/students/{id}/fees`. Transport line on an invoice = stop `monthly_fee` × months since the previous installment's due date (the year start for the first one), at least 1. Permissions `fees.view` (Principal, AO) and `fees.manage` (AO).

## Academic year

Meetings, diary posts, announcements and chats belong to the academic year they were created in. Every list (apps and admin web) shows only the **current** academic year; when the school switches to a new year, last year's history is no longer shown (the records stay in the database). An old record opened by id returns 404.

## Live updates (socket.io `/comm`)

Connect once after sign-in: `io('<server>/comm', { auth: { token: access_token } })`. The server puts you in your own room and sends:

| Event | When |
|---|---|
| `chat.message` | A new message in one of my conversations (also my own, for my other devices) |
| `chat.read` | `{ thread_id, reader_id, read_at, message_ids }`: the other person read my messages |
| `chat.updated` | The school hid or restored a message |
| `chat.typing` | `{ thread_id, user_id }`. Send `chat.typing { thread_id }` while typing |
| `meeting.status` | `{ meeting_id, status, ends_at, extended_minutes, ended_at, end_reason, by }` on booking, start, extension, over time, end and cancel |
| `meeting.reminder` | `{ meeting_id, kind: "start" }` 10 minutes before; `{ kind: "ending", minutes_left: 5, ends_at }` 5 minutes before the end: show it inside the call |
| `meeting.participant` | `{ meeting_id, user_id, party, action: "joined" or "left" }` |
| `meeting.message` | A message in the meeting chat (same shape as `POST .../messages` returns; `mine` is `false` here, compare `sender.id`) |
| `meeting.note` | Parent only: `{ meeting_id, note_id }` when the teacher shares a note |

## Video meetings (Agora)

A teacher and a parent book a video call about one child. Either side can book it; both join from the app with `agora_rtc_engine`. The teacher is the **host**: only the host can extend or end the meeting. The admin web only lists meetings and their call log.

Lifecycle (example 10:00 to 10:30):

- Booking: `scheduled`, `MEETING_SCHEDULED` push to the other person, `MEETING_REMINDER` 10 minutes before the start.
- 09:50: join opens. The first join makes it `in_progress` and records the actual start.
- 10:25: `MEETING_ENDING` push and a `meeting.reminder` (`kind: ending`) event: show it inside the call.
- 10:30: the status becomes `time_exceeded`. **Nobody is disconnected**; people keep talking and can still join. The host can extend (`POST .../extend { "minutes": 10 }`, 120 minutes in total), which moves `ends_at` and sets it back to `in_progress`.
- The host ends it: `completed`, actual end and length saved, every attendance row closed, no new tokens, and the server asks Agora to remove everyone from the channel (kicking rule).
- A meeting nobody joins becomes `missed` 30 minutes after its end. A running meeting that everyone left more than 15 minutes ago, after its end time, closes itself as `completed` (`end_reason: empty`).

Tokens are short-lived (15 minutes). Renew with `POST .../token` on `onTokenPrivilegeWillExpire`; a completed meeting gets no new token (`409 MEETING_ENDED`). After a network drop, call `join` again: it records a new attendance row.

Every meeting has `from` (who booked), `to`, `teacher`, `parent`, `student`, `host_id`, `academic_year`, `ends_at` (with extensions), `extended_minutes`, `can_join`, `join_opens_at`, `join_closes_at` (only before it starts), `call_minutes` (actual length) and `end_reason`.

### Staff app (Teacher, HOD, Principal)

| Call | Screen |
|---|---|
| `GET /mobile/teacher/meetings?scope=upcoming` | My meetings; `scope` is `upcoming` (default), `past` or `all` |
| `GET /mobile/teacher/students/{id}/parents` | Parents of the student who have the app, primary first |
| `POST /mobile/teacher/meetings` | `{ "student_id": 12, "parent_user_id": 31, "title": "Maths progress", "scheduled_at": "2026-11-11T10:00:00+05:30", "duration_minutes": 30 }` |
| `GET /mobile/teacher/meetings/{id}` | One meeting with `call_log` |
| `POST /mobile/teacher/meetings/{id}/join` | `{ "platform": "android" }` → `{ provider, app_id, channel_name, uid, token, expires_at, role: "host", meeting }` |
| `POST /mobile/teacher/meetings/{id}/token` | Fresh token during the call |
| `POST /mobile/teacher/meetings/{id}/leave` | I left; I can rejoin |
| `POST /mobile/teacher/meetings/{id}/extend` | Host: `{ "minutes": 10 }` |
| `POST /mobile/teacher/meetings/{id}/end` | Host: end for everyone |
| `POST /mobile/teacher/meetings/{id}/cancel` | `{ "reason": "..." }` before it starts |

### Parent app

`GET /mobile/parent/meetings`, `GET /mobile/parent/children/{id}/teachers`, `POST /mobile/parent/children/{id}/meetings` `{ "teacher_user_id": 9, "title": "...", "scheduled_at": "...", "duration_minutes": 15 }`, `GET /mobile/parent/meetings/{id}`, `join` (role `participant`), `token`, `leave` and `cancel`. Parents cannot extend or end.

### When a meeting ends

| Case | What happens |
|---|---|
| Teacher presses End | `completed`, `end_reason: host_ended`, straight away |
| Everyone has left (cut the call) | `completed`, `end_reason: empty`, **5 minutes** after the last person left, even before the end time (rejoining within those 5 minutes keeps it open) |
| Time is up | **10 minutes after the end time** (extensions included) it closes as `completed`, `end_reason: time_up`, the Agora channel is ended for everyone and Join returns `409 MEETING_ENDED` |
| Nobody joined | `missed` 30 minutes after the end time |

`join_closes_at` on every meeting is the last moment Join works: show it as the link expiry. Extending (host, up to 120 minutes in total) moves the end time and so the expiry.

### Agora uid

`POST …/meetings/{id}/join` returns `uid` = user id × 2 for the teacher side and user id × 2 + 1 for the parent side, so one person who is both teacher and parent can join from two phones without Agora kicking one off. Always use the `uid` from the join response; never build it from the user id.

### Accept or decline (like a Teams invite)

Whoever books a meeting, the **other side** gets it as an invite: `response` is `pending`, then `accepted` or `declined` (with an optional `response_note`).

| Call | Who |
|---|---|
| `POST /mobile/teacher/meetings/{id}/accept` · `/decline` | Teacher, for a meeting the **parent** booked |
| `POST /mobile/parent/meetings/{id}/accept` · `/decline` | Parent, for a meeting the **teacher** booked |

Body (optional): `{ "note": "Busy with exam duty" }`. The side that booked gets a push (`MEETING_ACCEPTED` / `MEETING_DECLINED`, category `meeting`, with `meeting_id`) and the `meeting.status` socket event now carries `response`.

- **Joining needs the reply `accepted`.** `can_join` is false while `response` is `pending` or `declined`; `POST .../join` returns `409 MEETING_NOT_ACCEPTED` or `409 MEETING_DECLINED`. Declining does not cancel; the booker can cancel or book another time.
- A **declined** meeting does not hold the time slot: the same teacher and parent can book that time again.
- `join_closes_at`: for a meeting nobody has joined yet it is the **end time** (it becomes `missed` then); once it is live it is the end time + 10 minutes (hard stop).
- `in_call: { teacher, parent }` and `active_participants` (0, 1 or 2) show who is in the call right now. Ring only when the other side is in and you are not.
- When the **last person leaves** (`POST .../leave`), the meeting ends at once: `status: completed`, `end_reason: empty`, and any ring is cancelled. If someone drops without calling leave, it closes 5 minutes after the last activity.
- The reply can be changed (decline → accept) until the meeting starts.
- `403 NOT_MEETING_INVITEE` if the side that booked tries to reply; `409 MEETING_REPLY_CLOSED` once the meeting started, ended or was cancelled.
- Every meeting in lists and details has `response`, `responded_at`, `response_note`; `to` is the invited person.

### Incoming call ring and cancel

When one side joins (`POST .../join` succeeds) and the other side is not in the call, the API rings the other side. The joiner is never rung.

Ring and cancel arrive as a **data-only, high-priority push** (no title or body, every value a string) and as the socket event `meeting.call` with the same payload:

```json
{
  "category": "call",
  "event": "ring",
  "call_id": "c_8f21a3b4c5d6",
  "meeting_id": "11",
  "channel_name": "tzs_1_62b42c63d586b740",
  "caller_name": "Arun Prakash",
  "caller_role": "teacher",
  "student_name": "Harini Arun",
  "timeout_seconds": "45"
}
```

`caller_role` is the role of the person calling (pick the join endpoint for the **other** role on Accept). A `cancel` has the same `call_id` and fields plus `reason`:

| reason | When |
|---|---|
| `answered` | The rung side joined |
| `declined` | The rung side tapped Decline (`POST .../reject-call`) |
| `caller_left` | The caller left before it was answered |
| `ended` | The host ended the meeting, or it closed (empty or time up) |
| `timeout` | Nobody answered in 45 seconds |

| Endpoint | Who |
|---|---|
| `POST /mobile/teacher/meetings/{id}/reject-call` | Teacher declines a ringing call from the parent |
| `POST /mobile/parent/meetings/{id}/reject-call` | Parent declines a ringing call from the teacher |

- Accept = `POST .../join` as usual (it also sends `cancel` with `answered` to the caller's other devices).
- `reject-call` is safe to repeat; if the ring already stopped nothing happens. No body.
- One ring at a time per meeting. Rejoining while the other side is in the call does not ring.
- Delivery: `CALL_PUSH_DRIVER` (`kafka` → Notification Service template `school_call` with `dataOnly: true`, `data`, `priority: high`, `ttl`; `onesignal` → OneSignal data-only with `content_available`, `priority 10`, `include_aliases.external_id`; `fcm` → FCM data message, Android priority high). Empty = same as `PUSH_DRIVER`.
- iOS VoIP (PushKit through APNs) is not in this phase: it needs the Apple VoIP certificate.

### Notes, meeting chat and recap

Both apps use the same paths under `/mobile/teacher/meetings/{id}` and `/mobile/parent/meetings/{id}`. Everything is current academic year only, like the meetings themselves.

| Call | What it does |
|---|---|
| `GET .../notes` | My notes plus the teacher's shared notes, oldest first. Each note has `author`, `author_party`, `body`, `shared`, `shared_at` and `mine` |
| `POST .../notes` | Teacher: `{ "body": "...", "shared": true }`; `shared: true` shows it to the parent and sends `MEETING_NOTES_SHARED`. Parent: `{ "body": "..." }`, always private |
| `PATCH .../notes/{noteId}` | Edit my note. Teacher can also send `shared` (sharing tells the parent once; `false` hides it again) |
| `DELETE .../notes/{noteId}` | Delete my note |
| `GET .../messages?before_id=&limit=50` | Meeting chat, newest first, `{ items, has_more }` |
| `POST .../messages` | `{ "body": "...", "file_id": null }` (file from `POST /files`). Open from 10 minutes before the start until the meeting ends; the other person gets `meeting.message` on `/comm` |
| `GET .../recap` | After a `completed` or `missed` meeting: `{ meeting, call_minutes, attendance, notes, message_count, messages }`. `attendance` has the teacher then the parent with `attended`, `minutes`, `sessions` (reconnects), `first_joined_at`, `last_left_at`, `platforms`; overlapping app and Agora records count once. `messages` is the whole chat, oldest first (up to 500) |

Notes are allowed before, during and after a meeting, but not on a cancelled one (`409 MEETING_CANCELLED`). Someone else's note returns `404 NOTE_NOT_FOUND`. The chat answers `409 MEETING_NOT_OPEN` before the join window, `409 MEETING_CHAT_CLOSED` once the meeting has ended (history stays readable) and `409 MEETING_CANCELLED`. The recap answers `409 MEETING_NOT_OVER` while the meeting is still scheduled or running. The video itself is not recorded.

### Admin web and server

`GET /admin/meetings` (filters `status`, `when`, `scheduled_by`, `teacher_user_id`, `guardian_id`, `student_id`, `date_from`, `date_to`), `/insights` and `/{id}` with the call log. Permission `meetings.view`.

Server settings: `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` (tokens), `AGORA_TOKEN_TTL_SECONDS` (default 900), `AGORA_CUSTOMER_ID` and `AGORA_CUSTOMER_SECRET` (Agora console → RESTful API; needed to remove everyone when the host ends), `AGORA_REST_URL`, and `AGORA_WEBHOOK_SECRET` (Agora console → Notifications, pointed at `POST /api/v1/integrations/agora/events`; join and leave events 103–108 then fill the call log with what Agora saw, including network drops). Without the customer keys, ending still blocks new tokens, and anyone still connected drops when their 15-minute token runs out.

## Digital diary

Teachers post **homework**, **remarks**, **feedback** or **notes** to a whole class (only if they teach every section), a section, or chosen students (up to 60), with up to 5 files and, for homework, a due date. The school chooses in School setup → Diary and chat → Diary review (option A, B or C): `all` (option A: every post waits), `remarks` (option B, default: remarks and feedback wait for the office; homework and notes go out at once), or `none` (option C: no review, all posts go out at once). Published posts reach parents with a `DIARY_POSTED` push.

| Call | Screen |
|---|---|
| `GET /mobile/teacher/diary?status=&type=&section_id=` | My posts this year with `seen_count` of `recipient_count` |
| `POST /mobile/teacher/diary` | `{ "type": "homework", "scope": "section", "section_id": 4, "title": "Exercise 4.2", "body": "...", "subject_id": 7, "due_date": "2026-11-12", "file_ids": [41] }`; `scope: "students"` with `student_ids`, or `"class"` with `class_id` |
| `GET /mobile/teacher/diary/{id}` | With every student and when their parent saw it |
| `PATCH /mobile/teacher/diary/{id}` | Edit while `pending_review` or `rejected` (sent back); it goes for review again |
| `DELETE /mobile/teacher/diary/{id}` | Removes it from the feed |
| `GET /mobile/parent/children/{id}/diary?type=` | Parent feed (published only) with `seen` |
| `POST /mobile/parent/children/{id}/diary/{entryId}/seen` | Mark as seen |

Office: `GET /admin/diary` (+ `/insights`, `/{id}`), `POST /admin/diary/{id}/approve`, `/reject { "note" }` (the teacher gets `DIARY_REJECTED`), `/hide { "note" }` and `/restore`. Permissions `diary.view` and `diary.moderate`.

## Announcements

The office writes announcements for `everyone`, `parents`, `staff`, or `classes` (parents of chosen `class_ids` / `section_ids`), as a draft, scheduled (`publish_at`), or sent now (`publish_now: true`), with an optional `expires_at`. Urgent ones (`priority: urgent`) also go by SMS when the push does not arrive.

Every app reads them the same way:

| Call | Screen |
|---|---|
| `GET /me/announcements?unread=true` | Announcements sent to me this year, newest first, with `is_read` |
| `GET /me/announcements/unread-count` | Badge |
| `GET /me/announcements/{id}` | One |
| `POST /me/announcements/{id}/read` | Mark read |

Office: `GET`/`POST /admin/announcements`, `GET`/`PATCH`/`DELETE /admin/announcements/{id}` (edit and delete only drafts and scheduled ones), `POST .../publish`, `POST .../archive`, `GET .../readers?state=read|unread` and `GET /admin/announcements/insights`. Permissions `announcements.view` and `announcements.manage`.

## Chat (teacher and parent)

One conversation per teacher, parent and child per academic year. Messages are saved first, then delivered live over `/comm` with a `CHAT_MESSAGE` push.

Office hours (School setup, default 08:00–17:00, Monday to Saturday, not on holidays): a parent message sent outside them is saved and shown to the teacher, but the teacher's push waits until office hours start (`held_for_office_hours: true`; the thread's `office_hours.next_open_at` says when). Teachers can write at any time.

| Call | Screen |
|---|---|
| `GET /mobile/teacher/chat/threads`, `GET /mobile/parent/chat/threads` | My conversations with `other`, `unread`, `last_message_preview` and `office_hours` |
| `POST /mobile/teacher/chat/threads` | `{ "student_id": 12, "parent_user_id": 31 }` opens or reuses |
| `POST /mobile/parent/children/{id}/chat/threads` | `{ "teacher_user_id": 9 }` opens or reuses |
| `GET .../chat/threads/{id}/messages?before_id=` | Newest first, 30 at a time, `has_more` |
| `POST .../chat/threads/{id}/messages` | `{ "body": "...", "file_id": null }` (text or a file) |
| `POST .../chat/threads/{id}/read` | Read receipts for the other person's messages |
| `POST .../chat/threads/{id}/messages/{messageId}/flag` | `{ "reason": "..." }` reports it to the office |

A message the school hides comes back with `hidden: true` and `body: null`. Office audit: `GET /admin/chat/threads?flagged=true`, `/insights`, `/flagged`, `GET /admin/chat/threads/{id}` (whole transcript; the visit is logged), `POST /admin/chat/messages/{id}/hide { "reason" }`, `/unhide` and `/dismiss-flag`. Permission `chat.audit`.

## Push notification data (tap routing)

Register the phone with `POST /me/devices` `{ "push_token": "<OneSignal subscription id>", "platform": "android" }` (`fcm_token` is the old name and still works); remove with `DELETE /me/devices?push_token=…`.

**Delivery (PUSH_DRIVER=kafka):** pushes go through the central Notification Service with OneSignal. The app only needs the OneSignal **App ID** and must call `OneSignal.login("<our user id>")` right after sign-in (`data.user.id` from `/auth/otp/verify`) and `OneSignal.logout()` on sign-out; we target that external id. The Notification Service needs one push template registered once: `docs/notification-service/push-template.json` (`school_push`, title and body come ready from us in English or Tamil).

Every push (OneSignal `additionalData`) has `category`, `template` and `notification_id`, plus the ids below. Ids are strings.

| category | templates | ids sent | open |
|---|---|---|---|
| `chat` | CHAT_MESSAGE | `thread_id` | the chat thread |
| `meeting` | MEETING_SCHEDULED, MEETING_REMINDER, MEETING_ENDING, MEETING_CANCELLED, MEETING_NOTES_SHARED | `meeting_id`, `student_id` | the meeting |
| `approval` | LEAVE_APPROVAL_NEEDED (staff leave waiting for me), STUDENT_LEAVE_REQUEST (parent leave for my class), SUBSTITUTE_ASSIGNED, CLASS_COMBINED | `leave_id` and `student_id` for leaves; `on_date` (YYYY-MM-DD), `section_id` for proxies | the teacher Inbox |
| `attendance` | STUDENT_ABSENT (`session`), LEAVE_STATUS (`leave_id`), STAFF_LEAVE_STATUS (`leave_id`) | `student_id` for parent pushes | attendance |
| `diary` | DIARY_POSTED, DIARY_REJECTED | `entry_id` where present | diary |
| `fees` | FEE_DUE, FEE_OVERDUE | `student_id` | fees |
| `system` | RESULT_PUBLISHED (`exam_id`), ACHIEVEMENT_ADDED (`achievement_id`) | `student_id` | results / achievements |
| `transport`, `alert`, `announcement`, `account` | bus, SOS, notices, invites, payslips | `trip_id`, `alert_id`, `announcement_id` where present | the matching screen |

## Payslips (every staff app)

`GET /me/payslips` lists the signed-in staff member's payslips for months the office has finalised (paginated, newest first): `month`, `month_label`, `gross`, `total_deductions`, `net`, `paid_days`, `lop_days` and each earning and deduction. `GET /me/payslips/{id}/pdf` downloads the PDF (`Content-Disposition: attachment`). A `PAYSLIP_READY` push arrives when a month is finalised.

## Driver app

Driver and Attendant roles. `GET /mobile/driver/duty` returns my bus and its routes, each with stops in travel order (`lat`, `lng`, `geofence_radius_m`, pickup and drop times) and the students at each stop (`full_name`, `class_section`, `mode` both/pickup/drop, `passenger_ref`). `passenger_ref` is the opaque id the bus tracking system uses; it is never the student id. Sign in as 9000000007 (driver) or 9000000008 (attendant).

## Files

- Upload: `POST /files` as `multipart/form-data` with field `file` and optional `purpose` (snake_case). Images, PDF, Word, Excel and CSV; 10 MB by default.
- The response has `url` and, for images, `thumbnail_url`. Both are signed links that work without a token until `url_expires_at` (1 hour). After that, call `GET /files/{id}` for fresh links.
- Other records store the file `id`, never the URL.
