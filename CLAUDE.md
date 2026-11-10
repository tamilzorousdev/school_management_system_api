# CLAUDE.md — School Management API

NestJS 10 backend for the Tamilzorous School Management System. One API and **one PostgreSQL database** serve the Admin web (`C:\Users\DELL\Telamatics_web`) and the Flutter app (Staff, Parent and Driver roles). Bus tracking is the separate Telematics service (`C:/Users/DELL/telematics-service`); this API only reads from it.

Read `docs/api-guide.md` before changing anything a client sees.

## Commands

```bash
npm run start:dev            # watch mode, http://localhost:3000/api/v1, Swagger at /api/docs/admin and /api/docs/mobile
npm run build                # nest build -> dist/apps/school-api/src/main.js
npm run lint                 # must be clean before commit
npm run format               # prettier
npm test                     # unit tests, no database needed
npm run test:e2e             # smoke tests, needs a migrated database
npm run migration:generate -- apps/school-api/src/database/migrations/Name
npm run migration:run
npm run seed                 # roles, permissions, templates (production-safe)
npm run seed:demo            # local only: demo school + users (seeds/demo.data.ts)
npm run seed:super-admin -- --mobile 9xxxxxxxxx --name "Full Name"
```

Dev sign-in (after `seed:demo`): super admin `9999999999`, school admin `9876543210`, demo users `9000000001`–`9000000008` (one per role), OTP `123456` (`OTP_MODE=test`).

Schools and school users are data, created through the API by a super admin. Never put school names, codes or admin numbers in `.env`.

## Structure (modular monolith, NestJS monorepo layout)

```
apps/school-api/src/        the school app
  main.ts app.module.ts app.setup.ts swagger.ts
  config/                   configuration.ts (typed config) + env.validation.ts (fails fast)
  database/                 data-source.ts (CLI), database.module.ts, migrations/, seeds/run-seed.ts
  shared/                   mobile.ts (IsMobile, normalizeMobile), crypto.ts (hmac, safeEqual)
  modules/<feature>/        controller, service, dto/, entities/, *.spec.ts
libs/common/src/            @app/common — shared by everything; imports nothing from apps
test/                       e2e specs
```

Import shared code through the alias `@app/common`, never with `../../libs/...`.

Bus tracking is **not** in this repo. The Telematics service (`C:/Users/DELL/telematics-service`) has its own database and its own Swagger on port 3001. This API reads from it only through `modules/fleet/telematics.client.ts` using `TELEMATICS_API_URL` and `TELEMATICS_API_KEY`. Never add MQTT, device or telemetry tables here.

## Hard rules

- **No code comments.** Names and small functions explain the code.
- **Integer primary keys**, never UUIDs. Extend `BaseEntity`, `TrackedEntity` (adds `created_by`, filled automatically) or `SchoolScopedEntity` (adds `school_id`) from `@app/common`.
- **snake_case** for every column, DTO field and JSON key.
- **Every school-owned table has `school_id`.** Non-super-admin queries filter by `actor.school_id`.
- **No cascade delete on people tables** (users, students, staff, guardians). Use soft delete.
- **Times** are `timestamptz`; responses are converted to `APP_TIMEZONE` (+05:30) by the interceptor.
- **One database.** Mobile endpoints are thin controllers over the same services and tables as admin endpoints. Never create mobile-only tables that duplicate data.
- **Never hardcode hosts, keys or passwords.** Everything comes from `.env` and is validated in `env.validation.ts`. Add new settings to `.env.example` with a placeholder.
- **Never commit `.env`.**
- **Sensitive fields are encrypted.** Staff bank account and PAN go through `FieldCipher` (`DATA_ENCRYPTION_KEY`, AES-256-GCM) and are stored with only the last 4 digits in clear. Only `GET /admin/staff/:id/bank` (permission `staff.bank`) returns them. Changing the key makes existing values unreadable.
- **ID card QR codes are signed** with `QR_SIGNING_SECRET` (`QrTokens`, `TZS1.<student>.<version>.<signature>`). Replacing a card bumps `students.card_version`, which invalidates the old QR.

## API conventions

- URI versioning: every route is `/api/v1/...` by default. Add `v2` only for a breaking change and keep `v1` working (`@Controller({ path, version: '2' })` or `@Version('2')`).
- Route families: `auth/*`, `me/*` (all apps), `admin/*` (web), `mobile/parent|teacher|driver/*` (Flutter screens), `admin/fleet/*` (read-only bus status from the Telematics service), `files/*`.
- Success body `{ status, message, data }` is added by `ResponseInterceptor`; controllers return plain data. Set the message with `@ResponseMessage('User created')`.
- Lists return `paginate(...)`: `{ items, total, page, limit, total_pages, has_next }`.
- Errors: throw `AppException.notFound('Student not found', 'STUDENT_NOT_FOUND')` etc. **No try/catch in controllers.** `AllExceptionsFilter` is the only error handler and returns `{ status, error, message, errors? }`. The `error` code is what clients switch on, so keep codes stable and SCREAMING_SNAKE_CASE.
- Validation: global pipe has `whitelist` + `forbidNonWhitelisted`; field errors come back as `errors: [{ field, message }]`.
- **Two Swagger docs, one API.** `/api/docs/admin` (web team: `admin/*`, `integrations/*`) and `/api/docs/mobile` (Flutter team: `mobile/*`); both also show the shared `auth/*`, `me/*`, `files/*` and `health`. JSON at `/api/docs/admin-json` and `/api/docs/mobile-json`; `/api/docs` has a dropdown for both. The split is by path in `swagger.ts`, so a new route lands in the right doc only if it uses the right route family. Web and mobile are told apart by the route family, never by the version: `v1` is the API version for both.
- Swagger on every endpoint: `@ApiTags('Admin · Students')`, `@ApiBearerAuth()`, `@ApiOperation({ summary })`, `@ApiEnvelope(Dto, { paginated })`, `@ApiErrors(...)`. Response shapes are classes in `dto/*.dto.ts` with `@ApiProperty({ example })`.

## Auth and permissions

- `JwtAuthGuard` and `PermissionsGuard` are global. **Every route requires a token** unless marked `@Public()`.
- Restrict with `@RequirePermissions(PERMISSIONS.X)` (admin) or `@RequireRoles(ROLES.PARENT)` (mobile). Read the caller with `@CurrentUser() user: AuthUser`.
- New permissions go in `modules/access/access.catalog.ts` (`PERMISSIONS`, `PERMISSION_CATALOG`, role mapping in `ROLE_CATALOG`), then `npm run seed`.
- Refresh tokens rotate; reuse of an old one revokes the session. Deactivating or deleting a user revokes all sessions and push devices.
- **OTP comes from the central Tamilzorous Auth Service** when `AUTH_PROVIDER=central` (`CENTRAL_AUTH_URL`, `modules/auth/central-auth.client.ts`): `/auth/otp/request` checks our user is active, then calls its `send-otp` (`/auth/otp/resend` calls its `resend-otp`; the Android `app_hash` is forwarded and dropped on a retry if the Auth Service refuses it) (registering the user there on first use: name, mobile, email or a name-based email on `AUTH_EMAIL_DOMAIN`, role SUPER_ADMIN/ADMIN → TENANT, others → TECHNICIAN); `/auth/otp/verify` calls its `verify-otp`, then issues our session. Users, roles, school and deactivation stay ours. Each session keeps the Auth Service tokens encrypted (`user_sessions.central_*_enc`, `FieldCipher`): our `/auth/refresh` also calls its `refresh` (ended there → 401 `SESSION_REVOKED`, unreachable → 503 and the session is kept), and our `/auth/logout` also calls its `logout`. Apps only ever see our tokens. `AUTH_PROVIDER=local` keeps the built-in OTP (test code 123456) for tests and demos. `OTP_TEST=true` is the quick switch: every user signs in with `OTP_TEST_CODE` (default 123456), no SMS and no Auth Service call for the OTP, even with `AUTH_PROVIDER=central`; it is refused when `NODE_ENV=production`.

## Lists and search

Extend `ListQueryDto` (page, limit, search, sort, order) and add filters with validators. In the service:

```ts
const qb = this.repo.createQueryBuilder('s');
if (query.status) qb.andWhere('s.status = :status', { status: query.status });
return listQuery(qb, query, {
  searchable: ['s.name', 's.admission_no'],
  sortable: { created_at: 's.created_at', name: 's.name' },
  defaultSort: 'created_at',
});
```

Every search word must match one searchable column; LIKE wildcards are escaped. Unknown `sort` returns `INVALID_SORT`. Pages that show insight cards get a separate `GET .../insights` endpoint returning counts.

## Adding a module (checklist)

1. `modules/<feature>/entities/*.entity.ts` extending a base entity; register with `TypeOrmModule.forFeature`.
2. `npm run migration:generate -- apps/school-api/src/database/migrations/<Name>`, review the SQL, run it.
3. DTOs with class-validator rules and Swagger examples; list query extends `ListQueryDto`.
4. Service with the business rules and school scoping.
5. Admin controller under `admin/<feature>`; mobile controller under `mobile/<role>/<feature>` reusing the same service.
6. Permissions in `access.catalog.ts` if needed; seed data in `run-seed.ts`.
7. Unit tests `*.spec.ts` next to the service. `npm run lint && npm test && npm run build` must pass.
8. Update `docs/api-guide.md` when a client-visible contract changes.

## Notifications

Send through `NotificationsService.dispatch({ template, audience, data })`:
- `audience`: `{ user_ids }` or `{ roles, school_id }`.
- Templates (English + Tamil) are in `notifications/notification-templates.catalog.ts`; add new ones there and run the seed.
- Flow: in-app row → push (`PUSH_DRIVER`: `kafka` = through the central Notification Service, which sends with OneSignal using its own key; we only publish `{ type: 'push', templateId: 'school_push', variables: { title, body, … }, externalIds: [user id] }`, and the app calls `OneSignal.login(<user id>)`; `onesignal`/`fcm` send directly) → SMS when the template says `always`, or `fallback` and push did not reach a phone. Every attempt is a row in `notifications` (the outbox).
- Incoming meeting calls: on `join` the other side gets a data-only `category: call` push (`event: ring`, then `cancel` with the same `call_id` on answer, `reject-call`, caller left, end or 45 s timeout), plus the `meeting.call` socket event. `CALL_PUSH_DRIVER` picks the route (empty = `PUSH_DRIVER`); code in `meetings/meeting-ring.ts`.
- Jobs run on the in-process queue (`QUEUE_DRIVER=memory`) with retries; queued jobs are lost on restart.

## SMS and Kafka

- `SMS_DRIVER=log` writes to the outbox only. `ping4sms` sends directly (needs a DLT template id per template). `kafka` publishes to the central Tamilzorous notification service, the same pattern as `NOOL360/softsilk_api`.
- Kafka message on topic `NOTIFY_KAFKA_TOPIC` (default `notifications`): `{ type: 'sms'|'email', tenantId, to: '91XXXXXXXXXX', templateId, variables }`. `templateId` = `NOTIFY_TEMPLATE_PREFIX` + lowercase template code (`school_student_absent`). Variables are the dispatch `data` plus `name`.
- With `AUTH_PROVIDER=central` the OTP comes from the Auth Service and these OTP settings do not apply. In local mode `OTP_SMS_DRIVER` (optional, default `kafka`, shared `otp` template) picks the OTP route; `ping4sms` also needs the `PING_*` settings.
- Code: `modules/sms/sms.service.ts`, `modules/sms/kafka-notify.service.ts`.

## Infrastructure switches

No Docker is required in this phase. `STORAGE_DRIVER=local`, `QUEUE_DRIVER=memory`, `VIRUS_SCAN=off`. S3, Redis and ClamAV come later behind the same switches; do not add hard dependencies on them.

## Gotchas

- **ES2022 class fields**: a DTO property with no class-validator decorator still exists on the instance and fails `forbidNonWhitelisted`. Every input property needs a validator; Swagger-only fields (like multipart `file`) go in an `@ApiBody({ schema })` instead.
- **`user` is a reserved word in Postgres.** Use the alias `u` in query builders and raw SQL.
- Upload files are read through `@UploadedFile()`; body fields still need a validated DTO.
- `nest-cli.json` `entryFile` is `apps/school-api/src/main`; the TypeORM CLI and seed run through `ts-node -r tsconfig-paths/register`.
- Keep `docs/api-guide.md`, Swagger and the web app's `src/features/*/api.ts` types in sync when a payload changes.
