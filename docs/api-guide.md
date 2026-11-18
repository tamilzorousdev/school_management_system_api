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
| `YEAR_READ_ONLY` | 403 | Admin web is viewing an earlier academic year; switch back to change anything |
| `ACADEMIC_YEAR_NOT_FOUND` | 404 | `X-Academic-Year-Id` is not a year of this school |
| `INVALID_ACADEMIC_YEAR` | 400 | `X-Academic-Year-Id` is not a number |
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
| `TEACHER_OVER_LIMIT` | 409 | Teacher assignments or the timetable would give a teacher more periods a week than their `max_periods_per_week`. Changes that bring an old overload down are still allowed |
| `LIMIT_BELOW_LOAD` | 409 | Staff edit: the weekly limit cannot go below the periods a week the teacher already has |
| `SIGNATURE_NOT_FOUND` | 400 | Signature upload: no ink found in the photo, or the signature pad is empty |
| `NO_RECIPIENTS` | 400 | Emergency broadcast: nobody matches the chosen audience |
| `AUDIENCE_INVALID` | 400 | Emergency broadcast: a chosen class, section or student is not in this school |
| `STILL_SENDING` | 409 | Emergency resend while the broadcast is still going out |
| `NOT_GROUP_CREATOR` | 403 | Group chat delete: only the person who created the group can delete it in the apps |
| `RATING_CLOSED` | 403 | Parent rating: the school has teacher ratings off, or today is outside the academic year |
| `NOT_CHILD_TEACHER` | 400 | Parent rating: the teacher does not teach this child |
| `ALREADY_RATED` | 409 | Parent rating: already rated this teacher in this window; the message says when the next window opens |
| `FEEDBACK_CLOSED` | 403 | Student feedback: the school has it off |
| `NO_TERM_NOW` | 400 | Student feedback: today is not inside any term |
| `FEEDBACK_ALREADY_GIVEN` | 409 | Student feedback: this teacher already gave this student feedback this term |
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
| `UNDO_ALIGHTED_FIRST` | 409 | Boarding undo: remove the "got off" mark before the "boarded" mark |
| `BOARDING_NOT_FOUND` | 404 | Boarding undo: no such mark on this trip |
| `NOT_CLASS_TEACHER` | 403 | Class bus boarding: only the class teacher of that section |
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

### Student ID card design

`GET /admin/school` returns `id_card_design` (`design1`, `design2`, `design3` or `custom`), plus `id_card_front_file_id`, `id_card_front_url`, `id_card_back_file_id`, `id_card_back_url` and `id_card_layout` for the school's uploaded design.

`custom` is the full ID card design made by the school's design team. The admin web uploads it in School setup → Student ID card: a PDF is turned into one PNG per page in the browser (page 1 front, page 2 back), and PNG or JPG files go as they are. Each image goes to `POST /files` with purpose `id_card_design`, then `PATCH /admin/school { "id_card_front_file_id": 51, "id_card_back_file_id": 52, "id_card_design": "custom" }`. Send `null` to remove a side. A file that is not an image of this school returns `400 VALIDATION_FAILED`, and choosing `custom` without a front side returns `400` on `id_card_front_file_id`.

`id_card_layout` says where each student's details go on the design: `{ "front": [...], "back": [...] }`, each item `{ key, x, y, w, h, font_size, color, bold, align }`. `key` is one of `photo`, `qr`, `student_name`, `admission_no`, `class_section`, `roll_no`, `dob`, `blood_group`, `guardian_name`, `guardian_mobile`, `address`, `academic_year`, at most once per side. `x`, `y`, `w`, `h` are fractions (0 to 1) of the card width and height, `font_size` is in points (long values shrink to fit the box), `color` is `#RRGGBB`. The admin web sets a starting layout on the first upload and the admin drags the boxes into place. An unknown key or a bad colour returns `400 VALIDATION_FAILED` on `id_card_layout`.

When `id_card_design` is `custom`, `GET /admin/students/{id}/id-card` and `GET /admin/id-cards` print the uploaded front and back at ID card size (54 × 85.6 mm, portrait or landscape from the image) with each student's photo, details and boarding QR in the layout positions. Transparent areas of the design print white. Pass `?design=custom` to print it before it is in use.

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
| `GET /mobile/parent/children/{id}/behaviour` | Behaviour notes shared with parents (appreciation, concern, incident, disciplinary) |

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
| `GET /mobile/parent/children/{id}/transport` | Bus card: route, `stop` (pickup, or the only stop) with `pickup_time` and `drop_time`, `drop_stop` (evening stop when it differs, else `null`), bus registration, driver and attendant with mobile, `monthly_fee` (the higher of the two stops) and `fee` (`monthly_fee`, `billed`, `paid`, `pending` this year, `next_due_date`, `status`: `paid`, `pending`, `overdue` or `not_billed`). `null` when the child does not use the bus |

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

### Emergency broadcast

An urgent message from the school office to all parents, all staff, everyone, or the parents of chosen classes, sections or students (optionally with their teachers). School admin, Principal and AO can send it (`emergency.send`) and see the history (`emergency.view`). School admin and Principal also have `emergency.approve`.

**Approval.** A broadcast to the whole school (`everyone`, `parents`, `staff`) or with SMS, sent by someone without `emergency.approve` (for example the AO), waits with `status: pending_approval`; admins and the principal get `EMERGENCY_APPROVAL_NEEDED` (push). Approving sends it (or schedules it for its `send_at`); rejecting needs a note. The sender gets `EMERGENCY_REVIEWED`.

**Schedule and expiry.** `send_at` sends later (1 minute to 60 days ahead, `status: scheduled`). `expires_in { value, unit }` with `unit` = `seconds`, `minutes`, `hours`, `days`, `months` or `years` (5 seconds up to 5 years) takes it off every screen when the time is up, counted from when it goes out: pushes and SMS not sent yet are dropped, the push carries a time-to-live so phones that were offline do not get it late, the in-app notification leaves the bell list (`status: expired`), and apps get the socket event `emergency.ended { broadcast_id, reason, ended_at }`. Messages already in a phone's notification tray stay there. `POST /{id}/end` does the same at once (End now). A follow-up with `category: all_clear` ends the broadcast it follows up.

Every broadcast has `state`: `pending_approval`, `scheduled`, `active` (on screen), `expired`, `ended`, `rejected` or `cancelled`, plus `send_at`, `expiry { value, unit, label }`, `expires_at`, `ended_at`, `end_reason` (`expired`, `ended`, `all_clear`), `ended_by`, `reviewed_by`, `reviewed_at`, `review_note`.

**How it is delivered.** On send, the API saves one row per person first (a parent with several children gets one message that lists them), then delivers in the background: an in-app notification at once (category `alert`), a live socket event `emergency.alert { broadcast_id, title, message, category, severity, sent_at }` to everyone with the app open, push to app users and SMS to every mobile number, including parents without the app. Push and SMS each get up to 3 tries (10 s, 30 s, 90 s apart); after a restart the API carries on with whatever was not sent. Tamil readers get the Tamil title and message when given. Push follows `PUSH_AUTO`: while it is `false` the push is marked not sent and the in-app, socket and SMS still go out. SMS goes through Kafka with template `school_emergency_broadcast` (`_ta` for Tamil), variables `school`, `title`, `message`, `name`.

**Admin web (`/admin/emergency-broadcasts`).**

| Call | What it does |
|---|---|
| `GET /templates?all=` | The school's ready messages in English and Tamil (`id`, `is_active`, `sort_order`, …). A school starts with rain holiday, early closure, security, transport delay, health and all clear; `all=true` also lists switched-off ones |
| `POST /templates`, `PATCH /templates/{id}`, `DELETE /templates/{id}` | Add, change (`is_active: false` hides it), remove a ready message. 404 `TEMPLATE_NOT_FOUND` |
| `POST /preview` `{ audience, class_ids?, section_ids?, student_ids?, include_teachers? }` | People it will reach: `recipients`, `parents`, `staff`, `with_app`, `with_mobile`, `sms_only`, `unreachable` |
| `POST` `{ audience, …, title, message, title_ta?, message_ta?, category, severity?, channels?: ["push","sms"], client_id?, follow_up_of?, expires_in?: { value, unit }, send_at? }` | Sends now, later or for approval (201). `audience` = `everyone`, `parents`, `staff`, `classes`, `sections`, `students`. `category` = `weather`, `school_closed`, `security`, `health`, `transport`, `all_clear`, `other`. `severity` = `info`, `warning`, `critical` (default). `client_id` stops a double click sending twice. `follow_up_of` links an all clear to the original |
| `GET` | History, paged: `search`, `category`, `status`, `state` (`active`, `expired`, `ended`, `scheduled`, `pending_approval`, `rejected`, `cancelled`), `from`, `to`, `sort=sent_at|title` |
| `GET /{id}` | One broadcast with `audience_label` and `counts`: `total`, `parents`, `staff`, `in_app`, `push` and `sms` (`pending`, `sending`, `sent`, `failed`, `skipped`), `reached`, `read`, `acknowledged` and the two percentages. Poll while `status` is `sending` |
| `GET /{id}/recipients` | Paged people with `push_status`, `sms_status` and the reason when not sent, `read_at`, `acknowledged_at`, and their children. `filter` = `all`, `failed`, `not_read`, `not_acknowledged`, `sms_only`, `unreachable`; `search` = name, mobile or child |
| `POST /{id}/resend` `{ target: "failed" | "not_acknowledged", channels?: ["sms"] }` | Sends again to those it failed for, or to everyone who has not acknowledged; `channels` limits it, for example SMS only to people who have not seen it. 409 `STILL_SENDING`, `NOT_SENT_YET`, `NOT_ACTIVE` once it has ended |
| `POST /{id}/approve` `{ note? }`, `POST /{id}/reject` `{ note }` | `emergency.approve` only. 409 `NOT_PENDING_APPROVAL` |
| `POST /{id}/cancel` | Cancel a scheduled or waiting broadcast. 409 `NOT_CANCELLABLE` |
| `POST /{id}/end` | End now. 409 `NOT_ACTIVE` |
| `DELETE /{id}` | `emergency.approve`: remove an expired, ended, cancelled or rejected broadcast from the history and the counts (kept in the database). 409 `STILL_ACTIVE` |
| `GET /insights` | This month: broadcasts, people, reached % and acknowledged %, broadcasts still sending, and the last broadcast |

**Parent and Staff apps (`/me/emergency-broadcasts`).**

| Call | What it does |
|---|---|
| `GET /me/emergency-broadcasts?pending=true&include_ended=` | My emergency messages still on screen, newest first, in my language; `pending=true` only the ones I have not acknowledged; `include_ended=true` adds expired and ended ones (history). Call it on app open and show any pending one as a full-screen alert |
| `GET /me/emergency-broadcasts/{id}` | One message; opening it marks it read (and its in-app notification) |
| `POST /me/emergency-broadcasts/{id}/acknowledge` | The "I have seen this" button; safe to press twice |

Each item has `title`, `message`, `category`, `severity`, `school`, `students` (my children it is about, for parents), `sent_at`, `read_at`, `acknowledged_at`, `follow_up_of`, `is_active`, `expires_at`, `ended_at` and `end_reason`. Hide the red strip and close the full-screen alert when `is_active` is false, at `expires_at`, or on the `emergency.ended` socket event. The push has `category: "alert"` and `broadcast_id`; the in-app notification `data` also has `expires_at` when one is set.

### Digital signature (sign on screen or photo)

Teachers, parents and the school have two ways to sign. Both are saved as a clean transparent PNG (`mime_type: image/png`, up to 900 px wide, cropped tight to the ink), so report cards, receipts and payslips look the same either way.

1. **Sign here (signature pad in the app).** The app shows a white pad; the person signs with a finger or stylus. Export the pad as a PNG (transparent or white background, dark ink) and upload it with `POST /files` (multipart `file`, `purpose: "signature_pad"`). The API keeps the strokes, removes the background and crops it. An empty pad gives `400 SIGNATURE_NOT_FOUND` ("The signature pad is empty").
2. **Upload photo (signed on paper).** Sign with a dark pen on white paper and take a photo; upload with `purpose: "signature"` (`teacher_signature`, `parent_signature` and `school_signature` work too). The API fixes the rotation and removes shadows, the paper and ruled lines, keeping only the ink in the pen's colour. A photo without ink gives `400 SIGNATURE_NOT_FOUND`.

Then save the file id with `PUT /mobile/teacher/signature` or `PUT /mobile/parent/signature` `{ "signature_file_id": 42 }` (school: `PATCH /admin/school` `{ signature_file_id }`). Other upload purposes keep their format. `GET` on the same paths returns the current signature and its `history` (newest first).

**Teacher and parent signatures are separate.** One person who is both a teacher and a parent has two signatures. Saving one never changes the other, with one exception: the first time they save a teacher signature while the Parent app one is empty, it is copied there. The save answers `{ signature_file_id, signature_url, parent_signature_copied, message }`; show `message` when it is not null:

| Saved from | When | `message` |
|---|---|---|
| Staff app | first time, copied | This signature is also set for your Parent app. You can change it there anytime. |
| Staff app | Parent app already has one | Your Parent app signature stays the same. Change it in the Parent app. |
| Parent app | the parent is also staff | Your Staff app signature stays the same. Change it in the Staff app. |

**On report cards.** A box shows a signature only after that person signs the card (`teacher_signed`, `parent_signed`). When someone changes their signature, cards they already signed **this academic year** switch to the new one and get `teacher_signature_updated_at` / `parent_signature_updated_at`; the PDF prints "Signed 12 Nov 2026 · updated 16 Nov 2026" under the box. Earlier years never change. Removing a signature leaves signed cards as they are, and signing again needs a signature (`400 NO_SIGNATURE_UPLOADED`).

**Admin web.** `GET`/`PUT /admin/staff/{id}/signature` (`staff.view` / `staff.manage`) and `GET`/`PUT /admin/guardians/{id}/signature` (`students.view` / `students.manage`) show and set or remove the signature for that person. Every add, change and removal is kept in `history` with `action` (`added`, `changed`, `removed`), the old and new image, `changed_by`, `by_admin` and `at`. When the office changes it, the owner gets an in-app note (`SIGNATURE_SET_BY_SCHOOL`). When a parent changes or removes their own signature, their children's class teachers and the school admin and principal get an in-app note (`PARENT_SIGNATURE_CHANGED`). Neither sends push or SMS.

**Use an earlier signature again.** Each `history` row has `can_use_again` (its image is not the current signature). `POST /mobile/teacher/signature/history/{changeId}/use` or `POST /mobile/parent/signature/history/{changeId}/use` (admin: `POST /admin/staff/{id}/signature/history/{changeId}/use` and `POST /admin/guardians/{id}/signature/history/{changeId}/use`) makes that image current again with no new drawing or photo. It answers like the save (`message` included), is recorded as `changed` with the note "Used an earlier signature again", and report cards signed this year switch to it. A row of another person gives `404 SIGNATURE_CHANGE_NOT_FOUND`; the current one gives `400 SIGNATURE_ALREADY_IN_USE`.

### Teacher feedback

**Settings (admin web).** `GET`/`PUT /admin/feedback/settings` `{ teacher_rating_enabled, teacher_rating_months: 1|2|3|6|12, student_feedback_enabled }` (permission `feedback.manage` to save, `feedback.view` to read). Rating windows start on the first day of the academic year and last `teacher_rating_months`; `cycle` is today's window and `term` is today's term (id 0 = the whole year when the school has no terms).

**Parent rates a teacher (Parent app).** `GET /mobile/parent/children/{id}/teacher-ratings` lists the child's class teacher and subject teachers with `rated` and `my_rating` for this window, plus `enabled`, `months` and `cycle` (hide the Rate button when `enabled` is false or `rated` is true). `POST` the same path `{ teacher_user_id, stars: 1-5, behaviour: "good"|"bad", remark? }` saves it and tells the school admin at once (`TEACHER_RATED`). One rating per parent, child and teacher per window.

**Teacher sees own ratings (Staff app).** `GET /mobile/teacher/ratings` returns `summary` (this year), `this_cycle`, `cycle` and `remarks` (stars, label, behaviour, remark and the window only). It never names the parent or child and never gives the exact time.

**Teacher gives student feedback (Staff app).** `GET /mobile/teacher/feedback/sections/{sectionId}` lists the section's students with the feedback I gave this term (`enabled`, `term`, `total`, `given`). `POST /mobile/teacher/feedback/students/{studentId}` `{ studies: 1-5, behaviour: 1-5, sports?: 1-5, remark? }`: once per student per term; the parents get `STUDENT_FEEDBACK`. Stars come back with labels: 5 Excellent, 4 Very good, 3 Good, 2 Average, 1 Needs improvement.

**Parent sees feedback (Parent app).** `GET /mobile/parent/children/{id}/feedback`: every teacher's feedback on the child this year, newest first.

**Admin web.** `GET /admin/feedback/ratings` (paged; parent and child shown; `teacher_user_id`, `behaviour`, `max_stars`, `search`, `sort=created_at|stars`), `DELETE /admin/feedback/ratings/{id}` (the parent can rate again), `GET /admin/feedback/ranking` (average stars, then % good, then number of ratings; unrated teachers last with `rank: null`), `GET /admin/feedback/student-feedback` (paged; `section_id`, `teacher_user_id`, `term_id`), `DELETE /admin/feedback/student-feedback/{id}`, and `GET /admin/feedback/teacher-report?exam_id=&teacher_user_id=`: each teacher with every class and subject they take (from teacher assignments), `students`, `papers` (one student in one subject of one exam), `pass_percent`, `fail_percent`, `average_percent`, an `overall` line, their parent `rating` summary and the latest 5 remarks.

### Promotion (admin web)

`GET /admin/promotions/preview?class_id=&section_id=` lists the students of a class or section with each one's `result_percent` and `passed` from this year's published exams, and the selection's `pass_percent` and `average_percent`. `class_results` gives every class (grade) this year with `assessed`, `pass_percent` and `average_percent`, lowest grade first; `section_results` gives the same for each section of the chosen class. The web ticks every student by default; `POST /admin/promotions` takes the unticked ones in `detained_ids` (they repeat the class) and skips students already in next year.

### Two attendance sessions a day

Student attendance is taken in the **1st period (`session: "morning"`)** and the **5th period (`session: "afternoon"`)**; they are stored as periods 1 and 5. The old `period` field still works (0 or 1 = morning, 5 = afternoon); any other period gives `400 PERIOD_NOT_ALLOWED`.

**Session-wise or period-wise.** The school picks it in School profile (`attendance_mode` on `PATCH /admin/school`):

| `attendance_mode` | How attendance is taken | What the app sends |
|---|---|---|
| `session` (default) | Twice a day: 1st period (morning) and 5th period (afternoon) | `session`; other periods give `400 PERIOD_NOT_ALLOWED` |
| `period` | Every teaching period of the bell schedule; the teacher of that period in the timetable (or the proxy) can mark it | `period` = 1 to the last period; beyond the bell schedule gives `400 PERIOD_NOT_ALLOWED` |

Every roster and board answer has `mode`, `session` and `period`. The `/current` endpoints pick the period running now in either mode, so the Staff app needs no change if it uses them. In period mode a later period starts from the marks of the period before, the grace minutes apply after each period, reminders go to the teacher of that period, and the day status is the average of all periods (all present = present, all absent = absent, otherwise half day).

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

### Child timetable and teachers (Parent app)

| Call | What it gives |
|---|---|
| `GET /mobile/parent/children/{id}/timetable?date=` | The child's day (default today): `day`, `class_section`, `working_day`, `holiday` and `periods[]` in bell order with breaks: `period_no`, `name`, `start_time`, `end_time`, `is_break`, `state` (`done`/`now`/`next`/`later`, today only), `subject`, `teacher` (`id`, `name`, `photo_url`), `usual_teacher` (when a proxy takes it), `note` ("Combined with 6 - B"), `room` |
| `GET /mobile/parent/children/{id}/teachers` | The child's teachers, class teacher first: `id`, `name`, `is_class_teacher`, `subjects` (taught to this child), `designation`, `department`, `experience_years`, `photo_url`. Same `id` for meetings and chat |
| `GET /mobile/parent/children/{id}/teachers-overview` | For the teachers screen: `class_teacher` on its own (or `null`) and `subject_teachers` without the class teacher, by name. Same fields as the list |
| `GET /mobile/parent/children/{id}/teachers/{teacherId}` | Teacher profile: everything above plus `joined_year`, `qualifications[]` (`degree`, `specialization`, `institution`, `year_completed`), `classes[]` they handle this year (`class_section`, `subjects`, `is_class_teacher`) and `periods_per_week` |

- `experience_years` = experience before joining + full years at this school.
- Only teachers of this child: other ids give `404 TEACHER_NOT_FOUND`. Phone, email, address, salary, bank and staff documents are never returned to parents.
- Sundays and holidays return `working_day: false` and no periods.

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
| `GET /admin/attendance/board?date=&session=` (On Duty) | `on_duty`: students on Sports OD for that date and session, marked or not (`student_id`, `name`, `admission_no`, `section_id`, `section`, `title`, `sport_name`, `session`: null = full day). Each section's `od` is the saved OD count once marked, else the students on OD who will be marked OD. OD counts as present |
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

## Drivers and attendants (admin web)

Crew are staff rows whose user has the `DRIVER` or `ATTENDANT` role. Permission `fleet.view` to read, `fleet.manage` to change. `{id}` is the staff id.

| Call | Use |
|---|---|
| `GET /admin/crew` | List. Filters: `role` (`driver`/`attendant`), `duty_status` (`pending`/`approved`/`blocked`), `expiry_state` (`expired`/`due_soon`/`missing`), `vehicle_id`, `unassigned`, `status`. Search: name, mobile, employee no, licence no, badge no. Sort: `name`, `employee_no`, `licence_expiry`, `joining_date`, `created_at` |
| `GET /admin/crew/insights` | `{ drivers, attendants, approved, pending, blocked, due_soon, unassigned }` |
| `GET /admin/crew/{id}` | Profile with `checks`, `clear`, `approved_at`/`approved_by`/`approved_until`, `last_reminded_at`/`last_reminded_by`, `documents` |
| `POST /admin/crew` | `{ role, name, mobile, …, licence_no, licence_type (LMV/HMV/TRANSPORT), licence_issued_on, licence_expiry, badge_no, badge_expiry, medical_fitness_expiry, police_verified_on, police_verification_expiry }`. Licence and badge fields are dropped for attendants. 409 `MOBILE_TAKEN`, `STAFF_EXISTS`, `EMPLOYEE_NO_TAKEN` |
| `PATCH /admin/crew/{id}` | Same fields plus `status`, `left_on`. Changing any licence, badge, medical or police field clears the approval |
| `DELETE /admin/crew/{id}` | Removes from staff and takes them off their bus |
| `POST /admin/crew/{id}/approve` | Approve for duty. 400 `CREW_NOT_CLEAR` (message lists the failing checks), 400 `CREW_INACTIVE` |
| `POST /admin/crew/{id}/remind` | Push "Renew your documents" to the crew member. 400 `NOTHING_DUE`, 429 `REMINDER_TOO_SOON` (6 hours) |
| `POST /admin/crew/remind` | `{ staff_ids: [] }` → `{ sent, skipped }` |
| `POST /admin/crew/{id}/documents`, `…/documents/{documentId}/verify`, `DELETE …/documents/{documentId}` | Same body as staff documents. Types `driving_licence`, `psv_badge`, `medical_fitness`, `police_verification` count for clearance; a new one clears the approval |

**Checks.** Drivers: driving licence, PSV badge, medical fitness, police verification. Attendants: medical fitness, police verification. A check is clear when its newest document is verified and its date is today or later.

**Duty status.** `pending` until approved; `approved` while every check stays clear; `blocked` when an approved member's check fails (a date passes or a document is rejected). Only approved crew can be put on a bus (`driver_user_id` / `attendant_user_id` field error) or start a trip (403 `CREW_NOT_APPROVED`, unless allowed for today). `GET /admin/transport/drivers` now carries `duty_status`.

**Allow for today.** `POST /admin/crew/{id}/allow-today` `{ "reason": "Medical renewal appointment tomorrow" }` (5–255 characters) lets a crew member who is not cleared start trips until midnight. It returns `{ on_date, reason, by, at }` and shows as `allowed_today` on `GET /admin/crew/{id}`. Sending it again the same day replaces the reason. 404 `CREW_NOT_FOUND`.

## Buses: vehicle master (admin web)

Permission `fleet.view` to read, `fleet.manage` to change.

**Master details** on `POST`/`PATCH /admin/transport/vehicles`: `vehicle_type` (`bus`, `mini_bus`, `van`, `car`), `fuel_type` (`diesel`, `petrol`, `cng`, `electric`), `manufacture_year`, `chassis_no`, `engine_no`, `ownership` (`school` or `contractor`, with `contractor_name` and `contractor_mobile`). Lowering `capacity` below the students on the bus's routes gives 400 `CAPACITY_BELOW_ASSIGNED`.

**Documents and dates.** Nine dated documents: `insurance`, `fitness`, `permit`, `puc`, `rc`, `road_tax`, `speed_governor`, `fire_extinguisher`, `first_aid` (each has a `<kind>_expiry` field on the bus), plus `other`. `expiries` on every bus lists all nine with `days_left` and `state`.

| Call | Use |
|---|---|
| `GET /admin/transport/vehicles/{id}/documents` | Newest first; `current` is true for the newest copy of each type, older copies are the renewal history |
| `POST /admin/transport/vehicles/{id}/documents` | `{ type, file_id, title?, number?, expiry_date }` (upload with `POST /files`, purpose `vehicle_document`). `expiry_date` is required except for `other` and becomes the bus's date, so a renewal updates the alerts and road-worthiness at once. Starts as `pending` |
| `POST …/documents/{documentId}/verify` | `{ status: "verified" \| "rejected", remarks }` (remarks required to reject) |
| `DELETE …/documents/{documentId}` | Removes a wrong upload; the bus date stays |
| `GET /admin/transport/vehicles/insights` | `{ total, not_road_worthy, expired, due_soon, nearly_full, contractor }` for active buses |
| `GET /admin/transport/vehicles?flag=` | `not_road_worthy`, `expired`, `due_soon`, `nearly_full`, `contractor`; also `vehicle_type` |
| `POST /admin/transport/vehicles/{id}/allow-today` | `{ reason }`: lets a bus that is not road-worthy run trips until midnight; shows as `allowed_today` on the bus |

**Road-worthy.** A bus is `road_worthy: false` when insurance, fitness or permit has expired; `road_blockers` names them. Trips cannot start on it (403 `VEHICLE_NOT_ROADWORTHY`) unless it is allowed for today. Other documents (PUC, RC, road tax and the rest) raise alerts but do not stop trips. Missing dates do not stop trips.

**Seats.** Each bus has `students`, `occupancy_percent`, `nearly_full` (90% or more) and `over_capacity`.

**Expiry alerts (buses and crew, one rule).** 07:00 daily, or `POST /admin/transport/expiries/check` to run now. Admins and the transport in-charge get an alert at 30, 15, 7 and 1 days before, on the day, then every 3 days while it stays expired (in-app and push). At 7 days, 1 day and on the expiry day the alert is `FLEET_DOCUMENT_EXPIRY_URGENT` / `CREW_DOCUMENT_EXPIRY_URGENT`, which also goes by SMS; the others are `FLEET_DOCUMENT_EXPIRY` / `CREW_DOCUMENT_EXPIRY` with no SMS. AO is not alerted. `CREW_BLOCKED` goes when an approved member's date passes. Drivers and attendants get `CREW_DOCUMENT_EXPIRY_SELF` for their own documents, and the bus driver gets `BUS_DOCUMENT_EXPIRY_DRIVER` for their bus, at 7, 1 and 0 days and every 3 days after; set `CREW_EXPIRY_AUTO_NOTIFY=false` to stop these. `GET /admin/transport/expiries` rows have `staff_id` for crew documents.

## Student transport (admin web)

Permission `fleet.view` to read, `fleet.manage` to change. A student has one route, a pickup `stop` and optionally a different `drop_stop` on the same route (only with `mode: both`).

| Call | Use |
|---|---|
| `PUT /admin/students/{id}/transport` | `{ route_id, stop_id, drop_stop_id?, mode?, start_date? }`. Assigns or moves the student. `drop_stop_id` must be on the same route and only with `mode: both` (field error otherwise); the same stop as `stop_id` is stored as no separate drop stop |
| `DELETE /admin/students/{id}/transport` | Takes the student off the bus |
| `GET /admin/students/{id}/transport` | Current assignment with `stop`, `drop_stop`, `monthly_fee`, or `null` |
| `GET /admin/students/{id}/transport/history` | Assignments, moves and removals, newest first: `{ action, from, to, mode, by, at }` |
| `POST /admin/transport/routes/{id}/stops/{stopId}/students` | Bulk: `{ student_ids, mode? }` put on this stop for both trips (clears any separate drop stop) |
| `GET /admin/transport/students` | Paged riders. Filters `route_id`, `stop_id` (pickup or drop), `class_id`, `section_id`, `mode`. Sort `name`, `admission_no`, `class`, `stop`, `created_at` |
| `GET /admin/transport/routes/{id}/roster` | Route list: stops in order, each with `pickup_students` and `drop_students` (name, admission no, class, mode, guardian name and mobile, `pass_status`), plus `morning_riders`/`evening_riders` for the route and `bus_morning_riders`/`bus_evening_riders` for the whole bus |

**Seats.** Counted per trip across every active route of the bus: morning riders (`both` + `pickup`) and evening riders (`both` + `drop`) must each fit `capacity`. Only active students count. A pickup-only and a drop-only student share one seat. Over capacity returns 409 `BUS_FULL` naming the trip. Giving a route a different bus checks the new bus the same way.

**Notifications** on every assign, move and removal: parents with alerts on get `TRANSPORT_ASSIGNED` (route, pickup and drop with times) or `TRANSPORT_REMOVED`; the driver and attendant of the old and new bus get `BUS_RIDER_CHANGED`. Drop trips use the drop stop for `BUS_APPROACHING`/`BUS_ARRIVED`, the child bus card, boarding and the trip rider list.
## Routes, stops and timings (admin web, Parent and Driver apps)

**Route timings.** Every route (`GET /admin/transport/routes`, `GET …/routes/{id}`) has `timings`: `leaves_at` (first pickup), `reaches_school_at` (estimated from the last stop's distance to school, never after school starts), `leaves_school_at` and `last_drop_at`, plus `problems` (number of stop time errors). School start and end come from the bell schedule. `GET /admin/transport/routes?flag=` takes `no_bus`, `inactive` or `has_problems`; `GET /admin/transport/routes/insights` gives `{ routes, active, stops, students, no_bus, with_problems }`.

**Stop time checks** on `PUT /admin/transport/routes/{id}/stops` (they block saving):
- Once one stop has a pickup (or drop) time, every stop needs one.
- Pickup times go up stop by stop, at least 2 minutes apart, and the last pickup is before school starts.
- Drop times go up from the last stop outwards (the evening order), at least 2 minutes apart, and the first drop is after school ends.
- A stop cannot lose the time its students need (a morning rider needs a pickup time, an evening rider a drop time).

Errors are `400 VALIDATION_FAILED` with `field` `items.N.pickup_time` or `items.N.drop_time` and a message naming the stop ("Pickup at Kilpauk (07:35) must be at least 2 minutes after Anna Nagar (07:40)"). Stops far apart but only minutes apart come back as a warning in `schedule_problems` on the route (`STOP_TIMES_TOO_CLOSE`), which does not block saving.

**No double booking.** A bus cannot run two routes at overlapping times (`409 BUS_TIME_CLASH`), and its driver or attendant cannot work another bus's route at the same time (`409 CREW_TIME_CLASH`). Checked when stops are saved, when a route gets a bus and when a route is switched on. A bus can run two rounds when they do not overlap. `RouteDetailDto.warnings` lists a missing bus, a bus off the road or not road-worthy, and a nearly full bus.

**Putting students on a stop** (`POST …/routes/{id}/stops/{stopId}/students`, `PUT /admin/students/{id}/transport`): only stops of that route; `400 ROUTE_HAS_NO_BUS`, `ROUTE_INACTIVE`, `STOP_TIME_MISSING` (no pickup time for morning riders or no drop time for evening riders); `409 BUS_FULL`. Giving a route another bus checks that bus's seats too.

**Change history and parent notes.** `GET /admin/transport/routes/{id}/history` lists what changed and when (`stop_time`, `stop_moved`, `stop_added`, `stop_removed`, `bus_changed`, `student_moved`, `pass_changed`) with `changed_by` and `parents_told`. Parents get an in-app note (`TRANSPORT_CHANGED`, no push, no SMS) when their child's stop time moves by 5 minutes or more, the stop moves 100 m or more, the child is moved to another stop, the route's bus changes, or the bus pass changes.

**Bus pass.** `PUT /admin/students/{id}/transport/pass` `{ "status": "on_hold" | "active", "note"? }`. The admin list (`GET /admin/transport/students?pass_status=on_hold`) shows `pass_status`, `pass_note`, `pass_changed_at`. The driver sees only `pass_status`, never fees or the note; the app shows "Bus pass on hold – contact office" and the child is never left behind. Parents see `pass_status` and `pass_note`.

**Parent app.** `GET /mobile/parent/children/{id}/transport` also returns `route_stops` (every stop in order with times, `is_my_stop`), `timings`, `pass_status`, `pass_note` and `recent_changes` (last 30 days, newest first, at most 10): route changes such as stop times plus this child's own changes ("Bus given on R1: boards at Kilpauk", "Moved to R2: …", "Pickup stop changed from A to B", "Evening stop changed from A to B").

**Driver app (Module 1).** `GET /mobile/driver/duty` returns `students`, `morning`, `evening`, `passes_on_hold`; each route has `path` ("Anna Nagar → Kilpauk → School"), `from`, `to`, `timings` and `students`; each student has `photo_url`, class and section, `parents` (name, relation, mobile, primary first), `mode`, `journey` ("Boards at Kilpauk 07:25 · Drops at Kilpauk 16:30") and `pass_status`. `GET /mobile/driver/students?search=&ride=morning|evening` is the same list for the whole bus, searchable by name, admission number or parent mobile.

**Driver app (Module 3).** `GET /mobile/driver/roster` returns the admin route roster for every active route on my bus: stops in route order, each with `pickup_students` (get on in the morning) and `drop_students` (get off in the evening), so a child with a different evening stop is listed at both. Each student has `pass_status`, `away_morning` and `away_evening`: null when the child rides that bus today, otherwise the reason to show ("On leave", "Half-day leave: comes in the afternoon", "Half-day leave: goes home at noon", "Sports OD – District athletics", "Marked absent"). Do not wait for an away child, but still let the attendant mark them if they turn up. Empty list when I have no bus. Use the roster before a trip starts (the plan) and `GET /mobile/driver/trips/{id}/checklist` while it runs (the live tick list). `GET /mobile/driver/duty` also has `away_morning` and `away_evening` counts, and every student in duty and `GET /mobile/driver/students` has `away_morning` / `away_evening`.

**Away rule (per bus).** Morning bus: approved full-day leave or morning half-day leave, sports OD for the whole day or the morning session, or marked absent / leave / OD in the morning attendance. Evening bus: the same with the afternoon half (afternoon attendance, or the morning mark when the afternoon is not taken yet). Late does not count. The same rule sets `status: away` and `away_note` in the trip checklist, trip riders and bus-history, and away children are never flagged `not_boarded`.

**Driver rating.** Parents rate their child's bus driver once a month (sending again the same month changes it).

| Call | Use |
|---|---|
| `GET /mobile/parent/children/{id}/driver-rating` | Parent app (Module 2): `driver` (name, photo), `vehicle`, `month`, `can_rate` (false when the child does not use the bus or the bus has no driver), `my_rating` (`rating`, `tags`, `comment`, `updated_at`) and `tags` (the chips: code, label, positive) |
| `PUT /mobile/parent/children/{id}/driver-rating` | `{ "rating": 1-5, "tags"?: ["safe_driving", "on_time"], "comment"? }`. For 1 or 2 stars pick a complaint chip (`rash_driving`, `late`, `rude`, `uses_phone`) or write a comment, else 400 `VALIDATION_FAILED` on `comment`. 400 `NOT_ON_BUS`, `NO_DRIVER`. A new 1 or 2 star rating sends `DRIVER_LOW_RATING` (in-app) to admins and the transport in-charge |
| `GET /admin/transport/driver-ratings/summary` | Each driver of an active bus (and anyone rated): `average`, `count`, `month_average`, `month_count`, `low_count`, `distribution` (1 to 5 star counts) and `top_tags`. Lowest average first. Permission `fleet.view` |
| `GET /admin/transport/driver-ratings?driver_user_id&vehicle_id&rating&low=true&from&to&search&sort` | The ratings with driver, bus, student, parent, chips and comment. search: driver, parent or student name, or comment. sort: `updated_at` (default), `created_at`, `rating` |
| `GET /admin/transport/driver-ratings/insights` | `average`, `count`, `month_count`, `month_low`, `drivers_rated` |

**Bus pass (digital).** Every student with a bus stop gets one pass a year (`pass_no` like `TZMS-BP-2026-0042`, `valid_from` = year start, `valid_until` = the settings date or the year end). State:
- `awaiting_payment` until the first bus fee invoice of the year is fully paid (free stops are active at once);
- `active`;
- `on_hold` when the office restricts it. A hold made while a bus fee is pending (`hold_kind: fee`) lifts by itself once nothing is past the grace days; an office hold (`hold_kind: office`) stays until the office activates it;
- `expired` after `valid_until`. A new pass with a new number comes with the next academic year.

The bus fee is the transport line on the fee plan installment invoices (the cycle is the installments). A bus fee counts as paid when its invoice is fully paid. `fee.standing`: `clear`, `due` (unpaid, within the grace days) or `past_grace` (the fee pending list). A job every 10 minutes issues passes that became paid (`BUS_PASS_ISSUED`), sends one reminder the day the grace ends (`BUS_FEE_REMINDER`) and reactivates paid fee holds (`BUS_PASS_ACTIVE`).

| Call | Use |
|---|---|
| `GET /admin/transport/bus-passes?search&state&fee&route_id` | Passes with `student`, `route`, `pickup`, `drop`, `bus` (of today), `fee { standing, oldest_due, grace_ends, pending_amount }`. `fee=past_grace` is the fee pending list |
| `GET /admin/transport/bus-passes/insights` | `total`, `active`, `awaiting_payment`, `on_hold`, `fee_due`, `fee_past_grace`, `expired` |
| `GET` / `PUT /admin/transport/bus-passes/settings` | `{ grace_days (0-90), valid_until? }` (`null` = end of year) |
| `POST /admin/transport/bus-passes/restrict` `{ student_ids, note? }` / `activate` `{ student_ids }` | One or many. Parents get `BUS_PASS_HELD` ("The bus pass for Kavin is on hold as the bus fee is pending. Please pay in the app or contact the school office.") or `BUS_PASS_ACTIVE` |
| `GET` / `PATCH /admin/transport/bus-passes/{studentId}` `{ valid_until }` | One pass (print card); change its end date |
| `POST /admin/transport/bus-passes/check-payments` | Run the 10-minute job now |
| `GET /mobile/parent/children/{id}/bus-pass` | Parent app (Module 2): the digital pass with `school`, `message` and `qr` (the signed ID card QR, only while active); `null` when the child does not use the bus |
| `GET /mobile/driver/passes-on-hold` | Driver app (Module 3): children on my bus today whose pass is on hold, with `label` ("Pass on hold – fee pending, contact office"). No amounts. Still take the child |

Crew lists (duty, students, roster, trip checklist) also have `pass_label` (null when active).

**Reason for a change.** `PATCH /admin/transport/routes/{id}` and `PUT /admin/transport/routes/{id}/stops` take an optional `reason` (up to 200 letters, for example "Road work on 2nd Avenue"). Parents read it at the end of their note ("… Reason: Road work on 2nd Avenue") and the route history keeps it in `reason`.

**Bus for a day (breakdown).** `PUT /admin/transport/routes/{id}/swap { vehicle_id, date?, reason? }` runs the route with another bus on one day (today by default, up to 30 days ahead; sending again for the same day replaces it); the next day the usual bus is back without any step. The other bus must be free at the route times (409 `BUS_TIME_CLASH`, `CREW_TIME_CLASH`); in an emergency send `force: true` to change anyway: the answer has `warning`, and the parents of the route that bus also runs get a note that it may be late. 400 `SAME_BUS`, `ROUTE_INACTIVE`. Parents of the route and the driver and attendant of both buses get `BUS_SWAPPED` (push) with the reason, and the route history gets a `bus_swapped` entry. On that day the swap bus's driver sees the route on the home screen, roster and student lists and can start its trips; the parent's transport card and live bus show the swap bus. `DELETE /admin/transport/routes/{id}/swap?date=` undoes it (parents get a note; 404 `SWAP_NOT_FOUND`). `GET /admin/transport/bus-swaps?date=` lists swaps from today on (or for one date). Route list items have `swap_today { vehicle, reason }`.

**Breakdown on the road (hand-over).** `POST /admin/transport/trips/{id}/handover { vehicle_id, reason?, keep_for_today? }` on a running trip: a new trip starts on the other bus for the stops not passed yet (the bus needs a GPS tracker and must not be on another trip; its crew must be cleared), the children already on board are copied to it, and the old trip ends with `end_reason: breakdown` without the left-on-bus and missed-bus alerts. Parents of children on board get `BUS_HANDOVER_ONBOARD` ("Kavin is moving to Bus 2"), parents still waiting, both crews and the office get `BUS_HANDOVER`, and screens following the old trip get `trip.event` with `type: trip.handover` and `new_trip_id`. `keep_for_today` also runs the route with the new bus for the rest of the day (a bus for a day, changed anyway). Trips have `handover_of` (the trip it took over from) and `replaced_by`. Answer: `old_trip`, `new_trip`, `on_board`, `waiting`, `parents_told`, `warning`. 409 `TRIP_ENDED`, `TRIP_ALREADY_ACTIVE`; 400 `SAME_BUS`, `NO_TRACKER`.

**Bus delayed (driver app, Module 2).** `POST /mobile/driver/trips/{id}/delay { minutes: 5-180, reason? }` while the trip runs: parents of that trip and the transport office get `BUS_DELAYED` (push, "Bus 1 is running about 20 minutes late"), live screens get `trip.event` with `type: trip.delayed`, and the trip shows `delay { minutes, reason, at }`. Once every 3 minutes (429 `DELAY_TOO_SOON`); 409 `TRIP_ENDED`, 403 `NOT_YOUR_TRIP`.

**Route list.** `GET /admin/transport/routes` items also have `morning_riders` and `evening_riders` (active students on each trip) next to `students`, so cards can show "Morning 23/40 · Evening 19/40".

## Live bus

### Driver app (Driver and Attendant)
| Call | Screen |
|---|---|
| `GET /mobile/driver/trips/today` | Home: my bus, `active_trip` (the trip running now) and each route with today's trips. Show "Start morning pickup" / "Start evening drop" when `active_trip` is null |
| `POST /mobile/driver/trips` | `{ "route_id": 1, "kind": "pickup" }` starts the trip. Parents of the route get "Bus has started". 409 `TRIP_ALREADY_ACTIVE`, 400 `NO_TRACKER`, 403 `CREW_NOT_APPROVED` when the bus driver or attendant is not cleared for duty (show the message: renew documents at the transport office) |
| `GET /mobile/driver/trips/{id}` | Trip screen: `stop_list` in travel order with `status` and `eta_seconds`, `school` (end of a pickup), `riders` (with `boarded`, `alighted`), `not_boarded` and `boardings` (newest first) |
| `POST /mobile/driver/trips/{id}/positions` | Phone GPS fallback every 5–10 s: `{ "lat", "lng", "speed", "heading" }`. Used only when the bus tracker is silent for 60 s |
| `POST /mobile/driver/trips/{id}/end` | End by hand. A pickup also ends by itself inside the school gate; a drop after the last stop. The response also has `not_alighted` (boarded but never marked off) |
| `POST /mobile/driver/trips/{id}/boardings` | Scan or tap: `{ "action": "boarded", "qr_token": "TZS1.12.1.…" }` after scanning the ID card, or `{ "action": "alighted", "student_id": 12 }` from the `riders` list. Returns the row with `method` (`qr`/`manual`), `stop` (null at the school gate), `occurred_at` and `already_recorded` (a double scan is safe and sends nothing). Parents get **{child} boarded the bus** / **got off the bus**. 409 `NOT_ON_THIS_ROUTE`, `NOT_ON_THIS_TRIP`, `NOT_BOARDED`, `QR_REPLACED` (old card), `TRIP_ENDED`; 400 `QR_INVALID` |
| `GET /mobile/driver/trips/{id}/checklist` | **Boarding checklist** (Module 3): `trip`, `summary` `{ total, away, waiting, on_bus, off_bus, not_boarded, not_alighted }` and `students` in stop order, each with `stop`, `status` (`waiting`, `on_bus`, `off_bus`, `away` = on leave or absent today), `flag` (after the trip ends: `not_boarded` or `not_alighted`, else null), and `boarded` / `alighted` marks `{ id, at, method, stop, recorded_by }`. Each student also has `photo_url`, `parents` (name, relation, mobile, primary first; call them when the child is still `waiting`) and `pass_status` (`on_hold`: show "Bus pass on hold – contact office", never leave the child behind). Lighter than the trip screen, so poll it freely. Works for past trips too. In this phase the attendant marks by tapping (`POST …/boardings` with `student_id`) |
| `DELETE /mobile/driver/trips/{id}/boardings/{boardingId}` | Undo a wrong tap while the trip runs (`boardingId` = the mark's `id` from the checklist). Returns the updated checklist; parents are not told. Undo "got off" before "boarded" (409 `UNDO_ALIGHTED_FIRST`); 404 `BOARDING_NOT_FOUND`; 409 `TRIP_ENDED` |
| `GET /mobile/driver/trips/history?from=&to=&page=&limit=` | Past trips of my bus, newest first, each with the checklist `summary`. `from`/`to` default to the last 30 days. Open one with `…/{id}/checklist` |
| `POST /mobile/driver/sos` | SOS button: `{ "trip_id"?, "lat"?, "lng"?, "note"? }` (all optional, and no trip needs to be running; the running trip and the bus position are used). School admins, the transport in-charge and every teacher get a push and an SMS with the bus, route, place, time and number to call. A press by me or the other crew member of my bus within 2 minutes returns the same alert with `already_raised: true` |
| `GET /mobile/driver/sos/active` | My bus's SOS that is still `open` (waiting) or `acknowledged` (the office has seen it: `acknowledged_by`), else `null`. Poll every 10 s while one is open |
| `POST /mobile/driver/sos/{id}/location` | `{ "lat", "lng" }` every 15 s while the SOS is open so the office map moves. 409 `SOS_CLOSED` once resolved, 403 `NOT_YOUR_SOS` |
| `POST /mobile/driver/sos/{id}/cancel` | False alarm: `{ "note"? }`. Closes it as resolved with `data.cancelled: true`; the office and teachers get `SOS_CANCELLED` |
| `GET /mobile/driver/profile` | My profile (Module 5): `me` (details, photo, licence and badge, `checks` for licence, badge, medical and police with expiry and document status, `duty_status`, `allowed_today`, `documents`), `duty_message` (one line to show when not cleared, else null) and `vehicle` (my bus: registration, type, fuel, year, chassis and engine number, owner, seats and students, the 9 document expiries, `road_worthy`, routes, driver and attendant). 404 `CREW_NOT_FOUND` when the office has not added me |
| `PATCH /mobile/driver/profile` | Change my own `email`, `language`, `address`, `emergency_contact_name`, `emergency_contact_mobile` and `photo_file_id` (upload with `POST /files`, purpose `profile_photo`); null clears. Name, mobile, licence, badge, medical and police details stay with the transport office (any other field gives 400) |

The Driver app Swagger (`/api/docs`, "Mobile · Driver App") is split into modules: 1 Home, My Bus & Duty · 2 Trips & Live Tracking · 3 Student Boarding · 4 Safety & SOS · 5 My Profile & Vehicle.

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

When a trip ends (by hand, from the office, or by itself) with children still marked on the bus, school admins and the transport in-charge get **{count} still on {bus} after the trip ended** with the names (push, SMS if the push does not reach the phone). It is sent once per trip.

At the same moment the parents of each child who was expected on that trip (not away) and never marked get **{student} did not come on the morning bus / evening bus** (`CHILD_NOT_ON_BUS`, push and in-app, data `student`, `bus`, `trip`, `trip_id`, `student_id`). It is skipped when the attendant marked nobody on the trip, so a trip run without the app does not alarm every parent.

**Boarding history.**

| Call | Use |
|---|---|
| `GET /mobile/parent/children/{id}/bus-history?from=&to=&page=&limit=` | The child's trips, newest first: `trip_id`, `trip_date`, `kind`, `trip_status`, `route`, `status` (`waiting`, `on_bus`, `off_bus`, `away`), `flag` (`not_boarded` / `not_alighted` after the trip ends) and `boarded` / `alighted` marks `{ id, at, method, stop, recorded_by }`. Last 30 days by default |
| `GET /mobile/teacher/sections/{id}/bus-boarding?date=` | Class teacher: each bus student of the class with that day's pickup and drop trips (same fields as above). `date` defaults to today. 403 `NOT_CLASS_TEACHER` for other sections |
| `GET /mobile/parent/children/{id}/transport` | The transport card also has `today`: the trips that have started today, morning first, with the same fields as bus-history ("Boarded at 07:02, Kilpauk"). Empty before the first trip starts |
| `GET /admin/transport/trips/{id}/checklist` | Office: the same checklist the attendant sees (permission `fleet.view`). 404 `TRIP_NOT_FOUND` |
| `GET /admin/students/{id}/bus-history?from=&to=&page=&limit=` | Office: the student's trips, same fields as the parent bus-history. 404 `STUDENT_NOT_FOUND` |

Bus-history covers trips on the child's current route plus any trip where the child was marked. After a move to another route, trips on the old route where the child was not marked do not show.

### Live updates (socket.io)
Connect to the namespace `/live` on the API host with `{ auth: { token: "<access_token>" } }`, then:

- `emit('trip.subscribe', { trip_id })` → ack `{ ok: true }`. A parent can follow only a trip their child rides; a driver only their own bus; admins any trip of their school. Otherwise `{ ok: false, error: "FORBIDDEN" }`.
- Receive `trip.position` `{ trip_id, position: { lat, lng, speed, heading, recorded_at, source } }` every few seconds and `trip.event` `{ trip_id, type, stop, eta_seconds, end_reason }` for `trip.started`, `stop.approaching`, `stop.arrived`, `stop.departed`, `trip.ended`.
- `passenger.boarded` / `passenger.alighted` `{ trip_id, boarding_id, student_id, action, method, stop, occurred_at }` on each scan. The fleet room (admin web) also gets `full_name` and `class_section`; trip followers (parents) get only `student_id`.
- `passenger.undone` `{ trip_id, route_id, vehicle_id, boarding_id, student_id, action }` when the attendant undoes a wrong tap: drop that mark.
- Admin web: `emit('fleet.subscribe', {})` to get every trip of the school plus `alert.raised` and `alert.updated` (same shape as an alerts centre row).
- When the access token expires the socket is closed with an `error` event: refresh the token and connect again.

**SOS screen in the driver app.** Show the SOS button on the trip screen while a trip runs, and also on the home screen. Trigger it with a 3-second long press or a confirm dialog, never a single tap. Send the phone's `lat`/`lng` with the press. If the request fails, retry until it gets through; a repeat within 2 minutes is safe. Then show a full-screen status: "Sent, waiting for the office" (`open`) or "{acknowledged_by.name} has seen it" (`acknowledged`). Keep sending the location every 15 s, offer **Cancel (false alarm)**, and close the screen when `sos/active` returns `null`. The crew also get the push `SOS_ACKNOWLEDGED` / `SOS_RESOLVED` (category `alert`, `alert_id` in data) and the `/comm` socket event `sos.updated` with the alert. Teachers receive `SOS_ALERT`, `SOS_RESOLVED` and `SOS_CANCELLED` as read-only alert cards in the staff app.

### Alerts centre (admin web)
`GET /admin/fleet/alerts` lists SOS and safety alerts, newest first: search (message, bus, driver), `kind` (`sos`, `overspeed`, `harsh_braking`, `idle`, `route_deviation`, `vehicle_fault`, `other`), `status` (`open`, `acknowledged`, `resolved`), `severity`, `active=true` (not resolved), `vehicle_id`, `trip_id`, `from`, `to`. Each row has `kind_label`, `message`, `vehicle`, `route`, `trip`, `raised_by` (with `mobile` to call), `position`, `data` and who acknowledged or resolved it. `GET /admin/fleet/alerts/insights` returns `open`, `sos_active`, `high_active`, `acknowledged`, `resolved_today`, `raised_today` and `active_by_kind`. `GET /admin/fleet/alerts/{id}` returns one alert. `POST .../{id}/acknowledge` (safe to repeat) and `POST .../{id}/resolve` `{ "resolution_note": "Called the driver, all safe" }` (at least 3 characters) need `fleet.manage`; reading needs `fleet.view`. Acknowledging or resolving an SOS tells the driver and attendant (push and `sos.updated`), and resolving also tells the teachers. Statuses read as Raised (`open`), Acknowledged and Resolved; a crew cancel has `data.cancelled: true`.

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
| `GET /admin/transport/trips?date&route_id&vehicle_id&status=ended&flag=` | Trip history. Ended trips have `flags` `{ not_boarded, not_alighted }` (the same counts as the checklist; null while running). `flag`: `not_alighted` (a child left marked on the bus), `not_boarded` (a child who was not away and never got on) or `any` |
| `GET /admin/fleet/trips/{id}/playback?max_points=1500` | Replay: `trip`, `school`, `path` (planned route), `points` `[{ at, lat, lng, speed, heading }]` oldest first (thinned evenly to `max_points`, `sampled` says so), `distance_km`, `duration_seconds`, `max_speed`, `avg_speed`, `stop_arrivals` and `safety_events`. 404 `TRACK_NOT_FOUND` |

When the Telematics service reports a new engine fault code it sends `vehicle.fault` `{ id, type, at, device_id, fault: { code, description, severity }, odometer_km? }`. The bus with that tracker gets a maintenance ticket (`source: obd`, one open ticket per code; retries are stored once) and admins and the transport in-charge get `VEHICLE_FAULT` (push and in-app; `bus`, `code`, `fault`, `severity`).

## Class performance, special classes and extra classes

| Call | What it gives |
|---|---|
| `GET /admin/performance/classes?exam_id=&class_id=` | Class-wise report: for each section `average_percent`, `pass_percent`, `fail_percent`, `attendance_percent` (this academic year) and `below_average`, plus school `totals`. Without `exam_id` every published exam of the year counts |
| `GET /admin/performance/sections/{id}/below-average?band=&below=&from=&to=` | Students to pick, lowest first, with `gap` (points below the class average), `weak_subjects`, `attendance_percent` and the classes they already attend. `band=below` (default): under the class average or under `below` %. `band=average`: within 10 points of the class average. `band=range`: between `from` and `to` % |
| `GET/POST /admin/special-classes`, `PATCH/DELETE /admin/special-classes/{id}` | See below. Filter the list with `section_id` (who in a class has one) or `teacher_user_id` (a teacher's profile) |
| `GET/PUT /admin/special-classes/settings` | `class_ids`: classes that can have a whole-class special class; `null` = every class |
| `GET/PUT /admin/special-classes/{id}/attendance?date=` | Attendance of the class for a date; students not sent stay present |
| `GET /mobile/teacher/special-classes` | Staff app: classes I take |
| `GET /mobile/teacher/special-classes/sections/{sectionId}` | Staff app: who in my section has a special or extra class |
| `GET/PUT /mobile/teacher/special-classes/{id}/attendance` | Staff app: take attendance (only the teacher of that class, else 403 `NOT_YOUR_SPECIAL_CLASS`) |
| `GET /mobile/parent/children/{id}/special-classes` | Parent app: classes the child attends, with `attendance` (days, present, absent, late, percent) |

**Kinds.** `kind=extra`: only `student_ids` (for example below-average or average students). `kind=special`: the whole section, including students who join later; only for classes turned on in the settings (`400 CLASS_NOT_ALLOWED`).

**Timing.** `timing=period`: one bell-schedule period every week (`day_of_week`, `period_no`); the students miss that period and it counts toward the teacher's weekly limit. `timing=extra_time`: its own `start_time` and `end_time` on the chosen `days` (0 = Sunday … 6 = Saturday) between `start_date` and `end_date` (no days = that one date). It may be before or after school, in a break or lunch, or on a Sunday or holiday (`day_part` full / morning / afternoon / custom is a label for people); it does not count toward the weekly limit. `when` is a ready line such as "every Mon, Wed, 4:00 PM – 5:00 PM, 1 Dec to 28 Feb".

**Special class slots in the bell schedule.** `PUT /admin/timetable/periods` rows may set `is_special: true` (for example "Special class" 15:55–16:40 after the last period, with a "Special class break" before it as a normal break). A special slot is not a teaching period: it has no `period_no`, is not counted in attendance, workload or the teacher's limit, and is left out of the Staff and Parent app day timetables. The admin timetable builder shows it as its own column where extra-time special classes are added. `section_ids` on a special slot limits it to those sections (null = every section).

**Checks.** `409 DURING_CLASS_TIME` (extra time overlaps a teaching period on a school day), `TEACHER_CLASH` (the teacher has another class, regular or special, then), `STUDENT_CLASH`, `SPECIAL_CLASS_CLASH` (two period classes in one section), `TEACHER_OVER_LIMIT` (period classes only).

**Notifications.** Created: the teacher gets `SPECIAL_CLASS_ASSIGNED`, parents `SPECIAL_CLASS_ADDED`. Changed time or title: `SPECIAL_CLASS_CHANGED`; new students' parents get `ADDED`, removed students' parents and a replaced teacher get `SPECIAL_CLASS_CANCELLED`. Stopped: everyone gets `SPECIAL_CLASS_CANCELLED`. Absent in the class today: parents get `SPECIAL_CLASS_ABSENT`.

**Class-wise holidays.** `POST/PATCH /admin/holidays` take `class_ids` (null = whole school); each holiday returns `whole_school` and `classes`. On those days attendance is not expected from those classes (the board shows `holiday` on the section, it is not counted as missed or as a working day in reports), and their timetable is empty in the Staff app. Parents see them in `GET /mobile/parent/children/{id}/holidays`, teachers in their holiday list when the class is one they teach. Special and extra classes can still be held on those days.

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

Invoice lines have `kind`: `plan`, `transport` (the bus fee) or `transport_adjustment` (a credit or extra charge after a bus change on an already paid invoice). Parents get `TRANSPORT_FEE_UPDATED` when an unpaid invoice changes because the child's bus stop changed. Parents get `FEE_DUE` (category `fees`) when the school raises an invoice, and `FEE_OVERDUE` at 08:00 for each overdue invoice, at most once every 7 days. SMS is sent only if the push does not reach the phone.

### Admin web

`/admin/fees/heads` (CRUD; one transport head), `/admin/fees/plans` and `/admin/fees/plans/{classId}` (`GET`, `PUT` the lines of a class: head, installment, amount, due date), `/admin/fees/installments`, `POST /admin/fees/invoices/generate` `{ class_id?, installment, due_date? }` (safe to run again), `/admin/fees/invoices` (search, `status`, `class_id`, `section_id`, `installment`, `overdue`), `/admin/fees/invoices/{id}`, `PATCH .../discount`, `POST .../cancel`, `POST .../payments`, `/admin/fees/payments` (+ `/summary`, `from`, `to`, `mode`), `/admin/fees/payments/{id}/receipt`, `/admin/fees/insights` and `/admin/students/{id}/fees`. **Bus fee.** Each route has a `monthly_fee`; a stop can have its own (`fee_override`, `null` = route fee). A student pays the higher of their pickup and drop stop. Transport line on an invoice = that fee × months since the previous installment's due date in the class plan (the year start for the first one), at least 1; the line keeps `route_id`, `stop_id`, `drop_stop_id`, `monthly_rate` and `months`. When a student is assigned, moved or taken off the bus, unpaid invoices due today or later are re-priced at once (a line is added, changed or removed; an invoice left with nothing is cancelled). A paid or part-paid one gets a `transport_fee_adjustments` row for the difference, added to the next invoice raised. `GET /admin/fees/transport/summary?route_id=` returns billed, collected, pending and overdue per route and stop (collected = the bus line's share of each payment). `GET /admin/fees/transport` lists students on the bus with their bus fee: `route_id`, `stop_id` (pickup or drop), `student_id`, `status` (`paid`, `pending`, `overdue`, `not_billed`), search, sort `name`, `pending`, `billed`. Permissions `fees.view` (Principal, AO) and `fees.manage` (AO).

## Academic year

Meetings, diary posts, announcements and chats belong to the academic year they were created in. Every list (apps and admin web) shows only the **current** academic year; when the school switches to a new year, last year's history is no longer shown (the records stay in the database). An old record opened by id returns 404.

**Viewing an earlier year (admin web only).** On `/admin/*` routes the web may send `X-Academic-Year-Id: <id>` to see an earlier year: attendance, students (only those enrolled that year, with their class that year), exams and results, fees, diary, leave, timetable and the dashboard then use that year instead of the current one. Leave the header out (or send the current year's id) for normal use.

| Case | Answer |
|---|---|
| Earlier year, `GET` | 200, that year's data |
| Earlier year, `POST`/`PUT`/`PATCH`/`DELETE` | 403 `YEAR_READ_ONLY` (earlier years are read only) |
| Year of another school | 404 `ACADEMIC_YEAR_NOT_FOUND` |
| Not a number | 400 `INVALID_ACADEMIC_YEAR` |

`/mobile/*`, `auth/*` and `me/*` ignore the header: the Staff and Parent apps always show the current year.

**Year by year on the dashboard.** `GET /admin/dashboard/year-performance` returns `{ years: [...] }`, one row per academic year, newest first, up to the current year, so the office can compare years. Each row has `academic_year`, `studies` (published exams, average result %, pass rate, fail rate, % of papers absent), `attendance` (student %, students below 75%, staff %), `activities` (achievements, sports, podium finishes, students taking part, points, highest level), `students` (enrolled, promoted, left) and `fees` (billed, collected, collection %, and `heads`: the same for every fee head such as Tuition, Sports or Transport, biggest first; a payment is shared across its invoice lines by amount, and `is_transport` marks the bus fee). A section is `null` without its permission, the same as the dashboard. It lists every year whatever `X-Academic-Year-Id` says.

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
- **No meeting with yourself:** a person who is both teacher and parent cannot book a meeting with themselves (`400 SAME_PERSON`). **Chat with yourself is allowed** (for example to share a file as the teacher with yourself as the parent). In the pickers (`/students/{id}/parents`, `/children/{id}/teachers`) that person comes with `is_me: true`: hide them when booking a meeting, show them for chat.
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
- **Rings only the phone signed in for that side.** The ring and cancel go to the devices registered with `POST /me/devices` whose `app` matches the side being called (`staff` for the teacher, `parent` for the parent), never to every phone of the user. A person who is both teacher and parent is not rung on their Staff app for a parent call. Devices registered without `app` (or `mobile`) are used only when the user has no device for the other side. So the app must send `app: "staff"` or `app: "parent"` (the selected side) with `push_token` after login and whenever the user switches side.
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

## Homework (formerly Digital diary)

Teachers post **homework**, **remarks**, **feedback** or **notes** to a whole class (only if they teach every section), a section, or chosen students (up to 60), with up to 5 files and, for homework, a due date. There is no office review: every post reaches parents at once (`diary_review_mode` is always `none` and can no longer be changed). The office can still hide a post. Shown as **Homework** in the admin web; the API routes keep the `diary` name. Published posts reach parents with a `DIARY_POSTED` push.

| Call | Screen |
|---|---|
| `GET /mobile/teacher/diary?status=&type=&section_id=` | My posts this year with `seen_count` of `recipient_count` |
| `POST /mobile/teacher/diary` | `{ "type": "homework", "scope": "section", "section_id": 4, "title": "Exercise 4.2", "body": "...", "subject_id": 7, "due_date": "2026-11-12", "file_ids": [41] }`; `scope: "students"` with `student_ids`, or `"class"` with `class_id` |
| `GET /mobile/teacher/diary/{id}` | With every student and when their parent saw it |
| `PATCH /mobile/teacher/diary/{id}` | Edit a post the office sent back earlier (`rejected`); new posts are published at once, so delete and post again to change one |
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

**Each academic year starts fresh.** Conversations belong to an academic year. When a new year becomes current, the earlier year's conversations are **soft-deleted** (hidden from the Staff and Parent apps, kept in the database) by an hourly job. Two years after that academic year ends they are **deleted for good** (messages and audit log too). A year created ahead of time is never touched.

The office can still read an archived year: `GET /admin/chat/threads?academic_year_id=<earlier year id>` lists it (each thread has `archived: true`) and `GET /admin/chat/threads/{id}` opens it read-only. Without `academic_year_id` the list is the current year. Code: `chat/chat-retention.service.ts` (`CHAT_KEEP_YEARS = 2`).

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


### Deleting, editing, clearing, voice and video

Same paths for both apps: teacher under `/mobile/teacher/chat/threads/{id}/…`, parent under `/mobile/parent/chat/threads/{id}/…`.

| Call | What it does |
|---|---|
| `POST …/messages/{messageId}/delete` `{ "for": "me" }` | Removes the message from my chat only; the other person still sees it |
| `POST …/messages/{messageId}/delete` `{ "for": "everyone" }` | My own message, within 24 hours (`400 DELETE_WINDOW_PASSED` after, `403 NOT_YOUR_MESSAGE`, `409 ALREADY_DELETED`). Both sides get `deleted: true` with `body` and `file` null: show "This message was deleted". `undo_until` = 10 seconds |
| `POST …/messages/{messageId}/undo-delete` | Brings it back for both within 10 seconds (`400 UNDO_EXPIRED`, `409 NOTHING_TO_UNDO`) |
| `POST …/clear` | Clears the chat for me: older messages disappear from my list and preview; the other person keeps them |
| `POST …/messages/{messageId}/edit` `{ "body": "..." }` | Changes the text of my own message within 24 hours (`400 EDIT_WINDOW_PASSED`, `403 NOT_YOUR_MESSAGE`, `409 ALREADY_DELETED`, `409 MESSAGE_HIDDEN`). Both sides get `edited: true` and `edited_at`: show "edited" next to the time. Sending the same text changes nothing |

Socket events: `chat.deleted { thread_id, message_id, deleted_at }`, `chat.restored` (the message), `chat.edited` (the message). Every message now has `kind` (text, image, file, voice, video), `duration_seconds`, `deleted`, `deleted_at`, `can_delete_for_everyone`, `undo_until`. The office always sees the original in Chat audit with `deleted_by` and `deleted_for_me_by`, and every text an edit replaced in `earlier_versions` (`body`, `replaced_at`, `edited_by`, oldest first); teacher and parent see only the latest text. Clears and edits appear in the audit log.

**Voice and video.** Upload with `POST /files` (multipart `file`, `purpose: chat_media`), then send `{ file_id, duration_seconds }`. Voice: m4a, aac, mp3, ogg, wav, webm, 3gp, up to 25 MB, no length limit. Video: mp4, mov, 3gp, webm, up to 25 MB and 120 seconds (`duration_seconds` required; `400 VIDEO_TOO_LONG`). Images and documents keep the `FILE_MAX_MB` limit.

### Group chats

| Who | Create | Add members | Members | Delete |
|---|---|---|---|---|
| Teacher | `POST /mobile/teacher/chat/groups` `{ name, member_user_ids }` | `POST /mobile/teacher/chat/groups/{id}/members` `{ user_ids }` | `GET …/groups/{id}/members` | `DELETE /mobile/teacher/chat/groups/{id}` |
| Parent | `POST /mobile/parent/chat/groups` | `POST /mobile/parent/chat/groups/{id}/members` | `GET …/groups/{id}/members` | `DELETE /mobile/parent/chat/groups/{id}` |
| Office (Chat audit) | `POST /admin/chat/groups` | `POST /admin/chat/groups/{id}/members` | `GET /admin/chat/groups/{id}/members` | `DELETE /admin/chat/groups/{id}` |

Messages in a group use the normal thread routes (`…/chat/threads/{id}/messages`). **Delete:** in the apps only the person who created the group can delete it (`403 NOT_GROUP_CREATOR`); the office can delete any group in its school. The group disappears from every member's list at once (socket event `chat.group_deleted { thread_id, title }`: remove it from the screen); its messages are kept for the office and the deletion is in the audit log. Deleting again gives `404 GROUP_NOT_FOUND`.

**Directory.** `GET …/chat/directory?search=` rows also carry `children` (parents: `{ id, name, class_section }` this year), `classes` (teachers: `{ class_section, class_teacher }` this year) and `detail`, one line to show under the name, for example "Class teacher 7 - A · Teaches 3 - A · Parent of Harini Narayanan (7 - A)".

**Remove a member.** `DELETE /mobile/teacher/chat/groups/{id}/members/{userId}` (parent: `/mobile/parent/chat/groups/…`, office: `/admin/chat/groups/{id}/members/{userId}`) returns the current members. In the apps only the group admin can remove (`403 NOT_GROUP_ADMIN`); `400 USE_LEAVE_GROUP` for yourself, `404 MEMBER_NOT_FOUND` when they are not in the group.

**Leave.** `POST /mobile/teacher/chat/groups/{id}/leave` (parent: `/mobile/parent/chat/groups/{id}/leave`) returns the group as you now see it. When the group admin leaves, the longest-standing member becomes admin. Leaving again gives `403 NOT_GROUP_MEMBER`.

**Group notices.** Adding, removing, leaving and a new admin each post a message with `kind: "system"`, `event` (`member_added`, `member_removed`, `member_left`, `admin_changed`) and `event_user`. `body` is already worded for whoever reads it; show it centred, not as a bubble. Notices cannot be edited, deleted or reported (`400 SYSTEM_MESSAGE`).

| Event | The person it is about | The person who did it | Everyone else |
|---|---|---|---|
| Removed | "Priya removed you from this group. You are no longer a member of this group, so you cannot send or receive messages here." | "You removed Lakshmi" | "Priya removed Lakshmi" |
| Left | "You left this group. You are no longer a member of this group, so you cannot send or receive messages here." | | "Arun left the group" |
| Added | "Priya added you" | "You added Lakshmi" | "Priya added Lakshmi" |
| New admin | "You are now the group admin" | | "Lakshmi is now the group admin" |

**After leaving or being removed** the group stays in your list with `is_member: false`, `can_send: false`, `left_reason` (`left`/`removed`) and `left_at`; the list preview is your own notice. You see the messages up to that moment and nothing after; sending gives `403 NOT_GROUP_MEMBER` with the same "You are no longer a member" text. Hide the message box when `can_send` is false. If someone adds you back you see "… added you" and only messages from then on. Members lists show current members only. Socket events: `chat.message` (each person gets the notice in their own wording) and `chat.members_changed { thread_id, by_user_id, added_user_ids, gone_user_id }`.
## Push notification data (tap routing)

**Automatic pushes can be switched off.** With `PUSH_AUTO=false` the API sends no push on its own: every notification is still saved in the app's notification list (`GET /me/notifications`), and its push row is marked `skipped` ("Automatic push is off"), with no SMS fallback because of it. Pushes only go out when the app asks for one:

`POST /me/notifications/test-push` `{ "title"?: "...", "body"?: "...", "data"?: { "category": "chat", "thread_id": "8" } }` sends a push to my own phone now, through the configured channel, even when `PUSH_AUTO=false`. The reply says what happened: `status` (`sent`, `failed` or `skipped`), `provider`, `error`, `devices` (registered with `POST /me/devices`) and `external_id`, the id `OneSignal.login` must use. One every 5 seconds (`429 TEST_PUSH_TOO_SOON`). `sent` means the push left our API; if the phone shows nothing, check the External ID in OneSignal.


Register the phone with `POST /me/devices` `{ "push_token": "<OneSignal subscription id>", "platform": "android" }` (`fcm_token` is the old name and still works); remove with `DELETE /me/devices?push_token=…`.

**Delivery (PUSH_DRIVER=kafka):** pushes go through the central Notification Service with OneSignal. The app only needs the OneSignal **App ID** and must call `OneSignal.login("<our user id>")` right after sign-in (`data.user.id` from `/auth/otp/verify`) and `OneSignal.logout()` on sign-out; we target that external id. The Notification Service needs our templates registered for tenant `TZSMS`: `docs/notification-service/push-template.json` lists all of them (push `school_push` and `school_call`, every SMS template in English and Tamil, and the shared `otp`). Title and body come ready from us in English or Tamil.

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
| `alert` | EMERGENCY_BROADCAST (`broadcast_id`, `severity`) to parents and staff | — | full-screen emergency alert, then `GET /me/emergency-broadcasts/{broadcast_id}` |
| `system` | STUDENT_FEEDBACK (`feedback_id`) to the parents | `student_id` | the child's feedback |
| `system` | TEACHER_RATED (`rating_id`, `teacher_user_id`) to the school admin | `student_id` | admin web, Teacher feedback |
| `transport`, `alert`, `announcement`, `account` | bus, SOS, notices, invites, payslips | `trip_id`, `alert_id`, `announcement_id` where present | the matching screen |

## Payslips (every staff app)

`GET /me/payslips` lists the signed-in staff member's payslips for months the office has finalised (paginated, newest first): `month`, `month_label`, `gross`, `total_deductions`, `net`, `paid_days`, `lop_days` and each earning and deduction. `GET /me/payslips/{id}/pdf` downloads the PDF (`Content-Disposition: attachment`). A `PAYSLIP_READY` push arrives when a month is finalised.

## Driver app

Driver and Attendant roles. `GET /mobile/driver/duty` returns my bus and its routes, each with stops in travel order (`lat`, `lng`, `geofence_radius_m`, pickup and drop times) and the students at each stop (`full_name`, `class_section`, `mode` both/pickup/drop, `passenger_ref`, and `for`: `pickup` when they only get on here, `drop` when they only get off here, `both` otherwise). A student with a separate evening stop appears at both stops. `passenger_ref` is the opaque id the bus tracking system uses; it is never the student id. Sign in as 9000000007 (driver) or 9000000008 (attendant).

## Files

- Upload: `POST /files` as `multipart/form-data` with field `file` and optional `purpose` (snake_case). Images, PDF, Word, Excel and CSV; 10 MB by default.
- The response has `url` and, for images, `thumbnail_url`. Both are signed links that work without a token until `url_expires_at` (1 hour). After that, call `GET /files/{id}` for fresh links.
- Other records store the file `id`, never the URL.
