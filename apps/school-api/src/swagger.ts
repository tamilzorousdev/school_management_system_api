import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerCustomOptions, SwaggerModule } from '@nestjs/swagger';

const DESCRIPTION = `
One API and one database for the Admin web and the Flutter app (Staff, Parent and Driver roles).

**Base URL**: \`/api/v1\`. A \`v2\` route is added only for a breaking change; v1 keeps working next to it.

**Sign in**: \`POST /auth/otp/request\` → \`POST /auth/otp/verify\` → send \`Authorization: Bearer <access_token>\` on every call.
When a call returns 401 with \`TOKEN_EXPIRED\`, call \`POST /auth/refresh\` once and retry. Store the new refresh token every time.

**Success**: \`{ "status": 200, "message": "OK", "data": ... }\`

**List**: \`data = { items, total, page, limit, total_pages, has_next }\`. Query: \`page\`, \`limit\` (max 100), \`search\`, \`sort\`, \`order\` (asc|desc) and filters.

**Error**: \`{ "status": 400, "error": "VALIDATION_FAILED", "message": "...", "errors": [{ "field": "mobile", "message": "..." }] }\`. Switch on \`error\`, show \`message\`.

**Fields**: snake_case. IDs are integers. Dates are ISO 8601 with the +05:30 offset. Mobile numbers are 10 digits.

**Families**: \`/auth\`, \`/me\`, \`/files\` (every app), \`/admin/*\` (Admin web, read-only bus status under \`/admin/fleet\`), \`/mobile/parent|teacher|driver/*\` (Flutter role screens).

Every response has an \`X-Request-Id\` header. Quote it when reporting a problem.
`;

const TAGS: [string, string][] = [
  ['Auth', 'OTP sign-in, token refresh and sign-out'],
  ['Me', 'Signed-in user profile and push device registration'],
  ['Me · Notifications', 'In-app notification centre'],
  ['Me · Announcements', 'School announcements sent to me, unread count and read receipts'],
  ['Files', 'Uploads and signed download links'],
  [
    'Mobile · Parent · Module 1: Home, Children & Profile',
    'Child switcher, child card, digital ID card with QR and school home banner',
  ],
  [
    'Mobile · Parent · Module 2: Attendance, Leave & Transport',
    'Monthly attendance calendar, leave application, bus route and live bus tracking',
  ],
  [
    'Mobile · Parent · Module 3: Academics, Exams & Report Card',
    'Published exam results, term marksheet and downloadable official report card PDF',
  ],
  [
    'Mobile · Parent · Module 4: Class Diary, Behaviour & Health',
    'Homework feed, teacher behaviour notes, student health records and achievements',
  ],
  [
    'Mobile · Parent · Module 5: Teacher Chat & Communication',
    'Direct 1:1 chat conversations with child teachers with office hours and read receipts',
  ],
  [
    'Mobile · Parent · Module 6: Video Meetings & Recap',
    'Agora video meetings with teachers, private call notes, in-call chat and post-meeting recap',
  ],
  [
    'Mobile · Parent · Module 7: Student Fees & Receipts',
    'Student fee status, term invoices, payment breakdown and downloadable receipt PDFs',
  ],
  [
    'Mobile · Parent · Module 8: Academic Calendar & Holidays',
    'School holidays calendar, upcoming holidays, national holidays and term breaks',
  ],
  [
    'Mobile · Teacher · Module 1: Profile, Qualifications, Bank & Documents',
    'Staff profile, qualifications, bank details, performance appraisals, verification documents and home alerts',
  ],
  [
    'Mobile · Teacher · Module 2: Attendance, Leaves & Check-in',
    'Mobile geo check-in, staff attendance, student section attendance, leave application and approvals',
  ],
  [
    'Mobile · Teacher · Module 3: Timetable, Classes & Students',
    'Weekly timetable, substitutions, class roster, seating bench plan, student 360 and achievements',
  ],
  [
    'Mobile · Teacher · Module 4: Class Diary & Homework',
    'Homework, announcements and notes to classes with parent read receipts',
  ],
  [
    'Mobile · Teacher · Module 5: Exams & Marks Entry',
    'Teacher exam schedule, subject marks entry and ranked student results',
  ],
  [
    'Mobile · Teacher · Module 6: Parent Chat & Communication',
    'Direct 1:1 chat conversations between teachers and parents with real-time updates',
  ],
  [
    'Mobile · Teacher · Module 7: Video Meetings & Recap',
    'Agora video meetings with parents, notes, in-call chat and post-meeting recap',
  ],
  [
    'Mobile · Teacher · Module 8: Payroll & Payslips',
    'Staff monthly salary slips, earnings/deductions breakdown and PDF downloads',
  ],
  [
    'Mobile · Teacher · Module 9: Student Fees Overview',
    'Class teacher overview of student fee payment statuses (paid, due, overdue)',
  ],
  [
    'Mobile · Teacher · Module 10: Academic Calendar & Holidays',
    'School holidays calendar, upcoming holidays, national holidays and term breaks',
  ],
  ['Admin · Dashboard', 'Home screen in one call: counts per section, gated by the caller’s permissions'],
  ['Admin · Students', 'Students, class placement, guardians, roll numbers, Excel import'],
  ['Admin · Student records', 'Documents with verification, health and vaccinations, behaviour notes'],
  [
    'Admin · ID cards, TC and promotion',
    'ID card PDFs with signed QR, transfer and withdrawal with TC, year-end promotion',
  ],
  [
    'Admin · Staff',
    'Staff profiles, qualifications, documents, encrypted bank details, performance appraisals, teacher assignments',
  ],
  ['Admin · Attendance', 'Student attendance board, marking, monthly reports and parent leave requests'],
  ['Admin · Staff attendance', 'Staff check-in board, monthly view and manual correction'],
  ['Admin · Staff leave', 'Leave types, balances and the HOD then principal approval flow'],
  ['Admin · Timetable', 'Bell schedule, section timetable builder with clash checks, workload report'],
  ['Admin · Substitutes', 'Teachers away today, free teachers per period, assign and notify substitutes'],
  ['Admin · Payroll', 'Salary structures, monthly payroll runs, payslip PDFs'],
  ['Admin · Fees', 'Fee heads, class fee plans, invoices with transport, payments, receipts and dues'],
  ['Admin · Exams', 'Exams, papers, marks entry, ranked results, rank holders and publishing'],
  ['Admin · Transport', 'Buses, trackers, drivers, document expiry, routes and stops, students by stop'],
  [
    'Admin · Trips',
    'Live bus trips: start and end, stop timeline with ETA, riders and not-boarded list. Live updates over the /live socket.',
  ],
  ['Mobile · Driver', 'Driver and attendant app: my bus, route, stops and students'],
  ['Integrations', 'Machine-to-machine webhooks such as biometric punches (X-Device-Key)'],
  ['Admin · Admissions', 'Applications: applied, approved, rejected, enrolled'],
  ['Admin · Parents and guardians', 'Parents with their children'],
  ['Admin · School setup', 'School profile, academic years, terms, classes, sections, subjects, holidays'],
  ['Platform · Schools', 'Super admin: every school on the platform'],
  ['Admin · Users', 'Users, roles assignment and insights'],
  ['Admin · Roles', 'Roles and permissions'],
  ['Admin · Notifications', 'Outbox, delivery insights, templates and test sends'],
  ['Admin · Diary', 'Diary posts with review: approve, send back, hide, and who has seen each post'],
  [
    'Admin · Announcements',
    'Announcements to parents, staff or classes: draft, schedule, publish, archive, read counts',
  ],
  ['Admin · Chat audit', 'Teacher and parent conversations, reported messages, hiding, and the audit trail'],
  ['Admin · Meetings', 'Teacher and parent video meetings (Agora, booked in the app): who with whom, status, call log'],
  ['Admin · Fleet', 'Live bus status and positions, read from the Telematics service'],
  ['Health', 'Service status'],
];

const CENTRAL_SIGN_IN = `**Sign-in uses the Tamilzorous Auth Service.** The OTP SMS is sent and checked by the central Auth Service. Apps call only the \`/auth/*\` endpoints of this API; this API talks to the Auth Service and returns the school session (school and roles). Do not call the Auth Service directly from the web or mobile app. Refresh and sign-out also go through this API: \`POST /auth/refresh\` renews the Auth Service sign-in at the same time (if it has ended there, you get 401 \`SESSION_REVOKED\` and the user signs in again), and \`POST /auth/logout\` signs out of both. Apps keep using only this API's tokens.`;

const LOCAL_SIGN_IN = `**Sign-in uses this API's own OTP** (\`AUTH_PROVIDER=local\`, for local testing; the test code is 123456 when \`OTP_MODE=test\`).`;

const SIGN_IN_FLOW = `### Mobile app: sign-in and role switch (read first)

One Flutter app for Parent, Staff (teacher) and Driver. One sign-in per person; one token works for every role they have.

1. **Mobile number screen**: \`POST /auth/otp/request\` with \`{ "mobile": "9791543989", "app": "mobile" }\`. A number with no Parent, Teacher, HOD, Driver or Attendant role gets **403 APP_NOT_ALLOWED** and no SMS is sent. Admin-only users (super admin, principal, AO) cannot use the mobile app. **Android:** also send \`"app_hash": "Xy12AbCd3Ef"\` (the app's 11-character SMS Retriever hash) so the app reads the OTP from the SMS by itself; leave it out on iOS.
2. **OTP screen**: \`POST /auth/otp/verify\` with \`{ "mobile", "otp", "client": { "app": "mobile", "platform": "android" } }\`. Save \`access_token\` and \`refresh_token\`; read \`data.user.mobile_apps\` and \`data.user.sections\`. **Resend OTP** button (after \`resend_in\` seconds): \`POST /auth/otp/resend\` with the same body as step 1 (including \`app_hash\` on Android); too early gives **429 OTP_RESEND_TOO_SOON**.
3. **Where to go next** (decide from \`mobile_apps\`):

| \`mobile_apps\` | Open |
|---|---|
| \`["parent"]\` | Parent home directly, no chooser |
| \`["staff"]\` | Staff home directly |
| \`["driver"]\` | Driver home directly |
| two or more, e.g. \`["staff", "parent"]\` | Chooser screen: one button per item in \`sections\` (use \`label\`), then open that home |

4. **Switch role** later from the profile menu ("Switch to Parent / Staff"): no new OTP and no new token. The same \`access_token\` calls \`/mobile/parent/*\`, \`/mobile/teacher/*\` or \`/mobile/driver/*\`; each endpoint checks the role. Remember the last choice on the phone and call \`GET /me\` on app start to rebuild the chooser.
5. **Keep signed in** with \`POST /auth/refresh\` (store the new refresh token every time); **sign out** with \`POST /auth/logout\`.

### Student attendance: two sessions a day (teacher and parent)

- Attendance is taken **twice a day**: \`session: "morning"\` in the **1st period** and \`session: "afternoon"\` in the **5th period**. No other period is accepted (**400 PERIOD_NOT_ALLOWED**).
- **Teacher** (Module 2): \`GET /mobile/teacher/sections/{id}/attendance?date=&session=\` gives the list; \`open\` is true **only today during that period** (\`opens_at\` to \`closes_at\`), otherwise show it read-only. Save with \`PUT\` and \`{ date, session, items }\`; before the period **400 SESSION_NOT_OPEN**, after it **400 SESSION_CLOSED** (the office marks it then). The afternoon list starts from the morning marks (absent stays absent).
- **Parent** (Module 2): \`GET /mobile/parent/children/{id}/attendance/today\` gives \`status\` (the day), \`morning\` and \`afternoon\`; the month calendar has the same three per day. Absent in one session = \`half_day\`. The absent alert comes once a day; a child present in the morning and absent in the afternoon gets an afternoon alert.

### Live bus (parent and driver)

- **Parent**: \`GET /mobile/parent/children/{id}/bus\` gives status, headline, ETA to the child's stop and the bus position. **Driver**: \`GET /mobile/driver/trips/today\`, start with \`POST /mobile/driver/trips\`, phone GPS fallback \`POST /mobile/driver/trips/{id}/positions\`.
- **Live updates**: socket.io namespace \`/live\` with \`{ auth: { token } }\`; \`emit('trip.subscribe', { trip_id })\`, then receive \`trip.position\` and \`trip.event\`. A parent can follow only their own child's trip.

### Report card (parent)

\`GET /mobile/parent/children/{id}/report-card\` gives the marksheet: \`columns\` (one per published exam, grouped by \`terms\`), \`subjects[].cells\` in the same order, \`overall\`, \`attendance\`, \`remarks\`. No query = the whole year with every term; \`?term_id=\` or \`?exam_id=\` for one term or exam; fill the pickers from \`options\`. Download the PDF from \`pdf_path\` (\`GET .../report-card/pdf\`, same query).

Sample number with both roles in the demo school: **9791543989** (Teacher of 6 - A Computer Science, and Parent of Aadhavan Senthil). It gets \`"mobile_apps": ["staff", "parent"]\`.

Second sample: **9566331808** (Venkatesh). Teacher of 7 - A Mathematics and 3 - A English (class teacher of 3 - A), and Parent of Nila Narayanan (3 - A, rides Bus 2). It gets \`"mobile_apps": ["parent", "staff"]\`.

A person cannot be both teaching staff (Teacher, HOD) and bus crew (Driver, Attendant); the admin gets \`400 VALIDATION_FAILED\` on \`role_codes\`. Parent can go with either.`;

const AFTER_VERIFY =
  'After sign-in, read data.user.mobile_apps: one item → open that home directly; two or more → show a chooser from data.user.sections (label) and open the chosen home. Switching later needs no new OTP or token.';

const ME_HELP =
  'Call on app start: mobile_apps and sections rebuild the role chooser ("Switch to Parent / Staff"). The same token works for every section listed.';

function describeSignIn(document: OpenAPIObject): OpenAPIObject {
  const central = process.env.AUTH_PROVIDER === 'central';
  const summaries: Record<string, string> = central
    ? {
        'otp/request': 'Step 1: send OTP (sent by the Tamilzorous Auth Service)',
        'otp/resend': 'Resend OTP button: send the OTP again through the Tamilzorous Auth Service',
        'otp/verify': 'Step 2: verify OTP with the Tamilzorous Auth Service and get the school session',
        refresh: 'Refresh the school session; also renews the Auth Service sign-in',
        logout: 'Sign out here and at the Auth Service',
      }
    : {};
  const paths = Object.fromEntries(
    Object.entries(document.paths).map(([path, item]) => {
      const key = Object.keys(summaries).find((name) => path.endsWith(`/auth/${name}`));
      const isVerify = path.endsWith('/auth/otp/verify');
      const isMe = /\/v\d+\/me$/.test(path);
      if (!key && !isVerify && !isMe) return [path, item];
      const operations = Object.fromEntries(
        Object.entries(item).map(([method, operation]) => {
          if (typeof operation !== 'object' || !operation || !('responses' in operation)) return [method, operation];
          const current = operation as { summary?: string; description?: string };
          const extra = isVerify ? AFTER_VERIFY : isMe && method === 'get' ? ME_HELP : '';
          return [
            method,
            {
              ...operation,
              ...(key ? { summary: summaries[key] } : {}),
              ...(extra ? { description: [extra, current.description].filter(Boolean).join(' ') } : {}),
            },
          ];
        }),
      );
      return [path, operations];
    }),
  );
  return {
    ...document,
    info: {
      ...document.info,
      description: `${central ? CENTRAL_SIGN_IN : LOCAL_SIGN_IN}

${SIGN_IN_FLOW}

${document.info.description ?? ''}`,
    },
    paths,
    tags: (document.tags ?? []).map((tag) =>
      tag.name === 'Auth'
        ? {
            ...tag,
            description: central
              ? 'Sign-in through the Tamilzorous Auth Service (OTP sent and checked there), school session, refresh and sign-out'
              : 'OTP sign-in (this API, local mode), token refresh and sign-out',
          }
        : tag,
    ),
  };
}

const SHARED = /^\/api\/(v\d+\/)?(auth|me|files|health)(\/|$)/;

interface AudienceConfig {
  slug: string;
  path: string;
  jsonSlug: string;
  title: string;
  intro: string;
  owns: RegExp;
  stripPrefix?: string;
}

const AUDIENCES: AudienceConfig[] = [
  {
    slug: 'admin',
    path: 'api/docs/admin',
    jsonSlug: 'admin',
    title: 'Tamilzorous School Management API · Admin web',
    intro: 'Routes for the School Admin web: `/admin/*` and `/integrations/*`, plus sign-in, `/me` and files.',
    owns: /^\/api\/v\d+\/(admin|integrations)\//,
  },
  {
    slug: 'mobile',
    path: 'api/docs/mobile',
    jsonSlug: 'mobile',
    title: 'Tamilzorous School Management API · Mobile app',
    intro:
      'Routes for the Flutter app (Parent, Staff and Driver): `/mobile/parent|teacher|driver/*`, plus sign-in, `/me` and files.',
    owns: /^\/api\/v\d+\/mobile\//,
  },
  {
    slug: 'mobile-teacher',
    path: 'api/docs/mobile/teacher',
    jsonSlug: 'mobile-teacher',
    title: 'Tamilzorous School Management API · Mobile · Teacher App',
    intro:
      'Routes for the Teacher & Staff mobile app: Modules 1 to 10 (profile, qualifications, bank, attendance, timetable, homework, exams, chat, video, payroll, fees, holidays), plus sign-in, `/me` and files.',
    owns: /^\/api\/v\d+\/mobile\/teacher\//,
    stripPrefix: 'Mobile · Teacher · ',
  },
  {
    slug: 'mobile-parent',
    path: 'api/docs/mobile/parent',
    jsonSlug: 'mobile-parent',
    title: 'Tamilzorous School Management API · Mobile · Parent App',
    intro:
      'Routes for the Parent mobile app: Modules 1 to 8 (children, attendance, academics, diary, chat, video, student fees, holidays), plus sign-in, `/me` and files.',
    owns: /^\/api\/v\d+\/mobile\/parent\//,
    stripPrefix: 'Mobile · Parent · ',
  },
  {
    slug: 'mobile-driver',
    path: 'api/docs/mobile/driver',
    jsonSlug: 'mobile-driver',
    title: 'Tamilzorous School Management API · Mobile · Driver App',
    intro:
      'Routes for the Driver and Attendant mobile app: bus route, stops, riders and trips, plus sign-in, `/me` and files.',
    owns: /^\/api\/v\d+\/mobile\/driver\//,
  },
];

const UI_OPTIONS: SwaggerCustomOptions['swaggerOptions'] = {
  persistAuthorization: true,
  defaultModelsExpandDepth: -1,
  docExpansion: 'none',
  filter: true,
  displayRequestDuration: true,
};

const SWAGGER_CUSTOM_CSS = `
.swagger-group-banner {
  margin: 28px 0 14px 0;
  padding: 14px 18px;
  border-radius: 8px;
  background: #f8fafc;
  border-left: 6px solid #64748b;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
}
.swagger-group-banner:hover {
  background: #f1f5f9;
}
.swagger-group-banner.teacher-group {
  border-left-color: #10b981;
  background: #f0fdf4;
}
.swagger-group-banner.teacher-group:hover {
  background: #dcfce7;
}
.swagger-group-banner.parent-group {
  border-left-color: #0284c7;
  background: #f0f9ff;
}
.swagger-group-banner.parent-group:hover {
  background: #e0f2fe;
}
.swagger-group-banner.driver-group {
  border-left-color: #f59e0b;
  background: #fffbeb;
}
.swagger-group-banner.driver-group:hover {
  background: #fef3c7;
}
.swagger-group-banner.core-group {
  border-left-color: #6366f1;
  background: #f5f3ff;
}
.swagger-group-banner.core-group:hover {
  background: #ede9fe;
}
.swagger-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.swagger-group-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.15rem;
  font-weight: 700;
  color: #1e293b;
}
.swagger-group-badge {
  display: inline-block;
  padding: 3px 8px;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 9999px;
  background: rgba(0,0,0,0.06);
  color: #334155;
}
.swagger-group-toggle {
  font-size: 0.85rem;
  font-weight: 600;
  color: #64748b;
  display: flex;
  align-items: center;
  gap: 4px;
}
.swagger-group-desc {
  margin: 4px 0 0 0;
  font-size: 0.85rem;
  color: #64748b;
}
.opblock-tag-section.in-group-teacher {
  border-left: 3px solid #10b981;
  margin-left: 12px;
  padding-left: 10px;
  border-radius: 4px;
  transition: opacity 0.2s;
}
.opblock-tag-section.in-group-parent {
  border-left: 3px solid #0284c7;
  margin-left: 12px;
  padding-left: 10px;
  border-radius: 4px;
  transition: opacity 0.2s;
}
.opblock-tag-section.in-group-driver {
  border-left: 3px solid #f59e0b;
  margin-left: 12px;
  padding-left: 10px;
  border-radius: 4px;
  transition: opacity 0.2s;
}
.opblock-tag-section.in-group-core {
  border-left: 3px solid #6366f1;
  margin-left: 12px;
  padding-left: 10px;
  border-radius: 4px;
  transition: opacity 0.2s;
}
`;

const SWAGGER_CUSTOM_JS = `
(function() {
  function initSwaggerGroups() {
    var container = document.querySelector('.swagger-ui .wrapper .block.col-12') || document.querySelector('.swagger-ui .wrapper') || document.querySelector('.swagger-ui');
    if (!container) return;

    var sections = Array.from(container.querySelectorAll('.opblock-tag-section'));
    if (!sections.length) return;

    if (container.querySelector('.swagger-group-banner')) return;

    var groups = [
      {
        id: 'group-teacher',
        className: 'teacher-group',
        inGroupClass: 'in-group-teacher',
        icon: '📱',
        title: 'Mobile · Teacher App',
        badge: '10 Modules',
        desc: 'Profile, Qualifications, Attendance, Timetable, Class Diary, Exams, Parent Chat, Video Meetings, Payroll and Fees Overview',
        match: function(tag) { return tag.indexOf('Teacher') !== -1; }
      },
      {
        id: 'group-parent',
        className: 'parent-group',
        inGroupClass: 'in-group-parent',
        icon: '👨‍👩‍👧',
        title: 'Mobile · Parent App',
        badge: '8 Modules',
        desc: 'Home & Children, Attendance & Leave, Academics & Report Card, Class Diary & Behaviour, Teacher Chat, Video Meetings and Student Fees',
        match: function(tag) { return tag.indexOf('Parent') !== -1; }
      },
      {
        id: 'group-driver',
        className: 'driver-group',
        inGroupClass: 'in-group-driver',
        icon: '🚌',
        title: 'Mobile · Driver App',
        badge: 'Driver App',
        desc: 'Driver and attendant operations: bus route, stops and riders',
        match: function(tag) { return tag.indexOf('Driver') !== -1; }
      },
      {
        id: 'group-core',
        className: 'core-group',
        inGroupClass: 'in-group-core',
        icon: '🔐',
        title: 'Core & Shared Services',
        badge: 'Auth & Files',
        desc: 'OTP sign-in, token refresh, user profile, notifications, announcements and file uploads',
        match: function(tag) {
          return ['Auth', 'Me', 'Me · Notifications', 'Me · Announcements', 'Files', 'Health'].indexOf(tag) !== -1;
        }
      }
    ];

    groups.forEach(function(grp) {
      var matchingSections = [];
      sections.forEach(function(sec) {
        var h3 = sec.querySelector('.opblock-tag');
        var tag = h3 ? (h3.getAttribute('data-tag') || h3.textContent.trim()) : '';
        if (grp.match(tag)) {
          matchingSections.push(sec);
          sec.classList.add(grp.inGroupClass);
        }
      });

      if (matchingSections.length > 0) {
        var firstSec = matchingSections[0];
        var banner = document.createElement('div');
        banner.className = 'swagger-group-banner ' + grp.className;
        banner.innerHTML =
          '<div class="swagger-group-header">' +
            '<div class="swagger-group-title">' +
              '<span>' + grp.icon + '</span>' +
              '<span>' + grp.title + '</span>' +
              '<span class="swagger-group-badge">' + grp.badge + '</span>' +
            '</div>' +
            '<div class="swagger-group-toggle">' +
              '<span class="toggle-text">Collapse</span> ▾' +
            '</div>' +
          '</div>' +
          '<p class="swagger-group-desc">' + grp.desc + '</p>';

        var isCollapsed = false;
        banner.addEventListener('click', function() {
          isCollapsed = !isCollapsed;
          matchingSections.forEach(function(s) {
            s.style.display = isCollapsed ? 'none' : '';
          });
          var toggleIcon = banner.querySelector('.swagger-group-toggle');
          if (toggleIcon) toggleIcon.innerHTML = isCollapsed ? '<span class="toggle-text">Expand</span> ▸' : '<span class="toggle-text">Collapse</span> ▾';
        });

        firstSec.parentNode.insertBefore(banner, firstSec);
      }
    });
  }

  var observer = new MutationObserver(function() {
    initSwaggerGroups();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(initSwaggerGroups, 400);
  setTimeout(initSwaggerGroups, 1200);
})();
`;

function cleanTags(document: OpenAPIObject): OpenAPIObject {
  const validTagNames = new Set(TAGS.map(([name]) => name));
  const paths = Object.fromEntries(
    Object.entries(document.paths).map(([path, item]) => {
      const operations = Object.fromEntries(
        Object.entries(item).map(([method, operation]) => {
          if (typeof operation !== 'object' || !operation || !('tags' in operation)) return [method, operation];
          const tags =
            (operation.tags as string[] | undefined)?.filter((tag) => {
              if (tag.startsWith('Mobile')) return validTagNames.has(tag);
              return true;
            }) ?? [];
          return [method, { ...operation, tags }];
        }),
      );
      return [path, operations];
    }),
  );
  return { ...document, paths };
}

function slice(
  document: OpenAPIObject,
  owns: RegExp,
  title: string,
  intro: string,
  stripPrefix?: string,
): OpenAPIObject {
  let paths = Object.fromEntries(
    Object.entries(document.paths).filter(([path]) => owns.test(path) || SHARED.test(path)),
  );
  if (stripPrefix) {
    paths = Object.fromEntries(
      Object.entries(paths).map(([path, item]) => {
        const operations = Object.fromEntries(
          Object.entries(item).map(([method, operation]) => {
            if (typeof operation !== 'object' || !operation || !('tags' in operation)) return [method, operation];
            const tags =
              (operation.tags as string[] | undefined)?.map((tag) =>
                tag.startsWith(stripPrefix) ? tag.slice(stripPrefix.length) : tag,
              ) ?? [];
            return [method, { ...operation, tags }];
          }),
        );
        return [path, operations];
      }),
    );
  }
  const used = new Set(
    Object.values(paths).flatMap((item) =>
      Object.values(item as Record<string, { tags?: string[] }>).flatMap((operation) => operation?.tags ?? []),
    ),
  );
  const tags = (document.tags ?? [])
    .map((tag) =>
      stripPrefix && tag.name.startsWith(stripPrefix) ? { ...tag, name: tag.name.slice(stripPrefix.length) } : tag,
    )
    .filter((tag) => used.has(tag.name));

  return {
    ...document,
    info: {
      ...document.info,
      title,
      description: `${intro}

${document.info.description ?? DESCRIPTION}`,
    },
    paths,
    tags,
  };
}

export function setupSwagger(app: INestApplication): void {
  const builder = new DocumentBuilder()
    .setTitle('Tamilzorous School Management API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  TAGS.forEach(([name, description]) => builder.addTag(name, description));
  const document = cleanTags(describeSignIn(SwaggerModule.createDocument(app, builder.build())));

  const customOptions: SwaggerCustomOptions = {
    customCss: SWAGGER_CUSTOM_CSS,
    customJsStr: SWAGGER_CUSTOM_JS,
  };

  const URL_ITEMS = [
    { name: 'Admin web', url: '/api/docs/admin-json' },
    { name: 'Mobile app (All)', url: '/api/docs/mobile-json' },
    { name: 'Mobile · Teacher App (Modules 1 - 10)', url: '/api/docs/mobile-teacher-json' },
    { name: 'Mobile · Parent App (Modules 1 - 8)', url: '/api/docs/mobile-parent-json' },
    { name: 'Mobile · Driver App', url: '/api/docs/mobile-driver-json' },
  ];

  for (const audience of AUDIENCES) {
    SwaggerModule.setup(
      audience.path,
      app,
      slice(document, audience.owns, audience.title, audience.intro, audience.stripPrefix),
      {
        jsonDocumentUrl: `api/docs/${audience.jsonSlug}-json`,
        customSiteTitle: audience.title,
        explorer: true,
        swaggerOptions: {
          ...UI_OPTIONS,
          urls: URL_ITEMS,
        },
        ...customOptions,
      },
    );
  }

  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    customSiteTitle: 'School Management API',
    explorer: true,
    swaggerOptions: {
      ...UI_OPTIONS,
      urls: URL_ITEMS,
    },
    ...customOptions,
  });
}
