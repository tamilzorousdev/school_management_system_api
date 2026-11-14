import { AppSection } from './entities/role.entity';

export const PERMISSIONS = {
  USERS_VIEW: 'users.view',
  USERS_MANAGE: 'users.manage',
  ROLES_VIEW: 'roles.view',
  SCHOOLS_VIEW: 'schools.view',
  SCHOOLS_MANAGE: 'schools.manage',
  PLATFORM_SCHOOLS: 'platform.schools',
  STUDENTS_VIEW: 'students.view',
  STUDENTS_MANAGE: 'students.manage',
  ADMISSIONS_MANAGE: 'admissions.manage',
  STAFF_VIEW: 'staff.view',
  STAFF_MANAGE: 'staff.manage',
  STAFF_BANK: 'staff.bank',
  ATTENDANCE_VIEW: 'attendance.view',
  ATTENDANCE_MANAGE: 'attendance.manage',
  LEAVE_APPROVE: 'leave.approve',
  TIMETABLE_VIEW: 'timetable.view',
  TIMETABLE_MANAGE: 'timetable.manage',
  SUBSTITUTES_MANAGE: 'substitutes.manage',
  PAYROLL_VIEW: 'payroll.view',
  PAYROLL_MANAGE: 'payroll.manage',
  FEES_VIEW: 'fees.view',
  FEES_MANAGE: 'fees.manage',
  EXAMS_VIEW: 'exams.view',
  EXAMS_MANAGE: 'exams.manage',
  FEEDBACK_VIEW: 'feedback.view',
  FEEDBACK_MANAGE: 'feedback.manage',
  NOTIFICATIONS_VIEW: 'notifications.view',
  NOTIFICATIONS_SEND: 'notifications.send',
  MEETINGS_VIEW: 'meetings.view',
  DIARY_VIEW: 'diary.view',
  DIARY_MODERATE: 'diary.moderate',
  ANNOUNCEMENTS_VIEW: 'announcements.view',
  ANNOUNCEMENTS_MANAGE: 'announcements.manage',
  CHAT_AUDIT: 'chat.audit',
  FLEET_VIEW: 'fleet.view',
  FLEET_MANAGE: 'fleet.manage',
} as const;

export interface PermissionDefinition {
  code: string;
  name: string;
  group: string;
}

export const PERMISSION_CATALOG: PermissionDefinition[] = [
  { code: PERMISSIONS.USERS_VIEW, name: 'View users and their roles', group: 'Users' },
  { code: PERMISSIONS.USERS_MANAGE, name: 'Add, edit, deactivate users and assign roles', group: 'Users' },
  { code: PERMISSIONS.ROLES_VIEW, name: 'View roles and permissions', group: 'Users' },
  { code: PERMISSIONS.SCHOOLS_VIEW, name: 'View school setup', group: 'School' },
  { code: PERMISSIONS.SCHOOLS_MANAGE, name: 'Edit school setup and masters', group: 'School' },
  { code: PERMISSIONS.PLATFORM_SCHOOLS, name: 'Create schools and switch between them', group: 'Platform' },
  { code: PERMISSIONS.STUDENTS_VIEW, name: 'View students, parents and guardians', group: 'Students' },
  { code: PERMISSIONS.STUDENTS_MANAGE, name: 'Edit students, guardians, classes and roll numbers', group: 'Students' },
  { code: PERMISSIONS.ADMISSIONS_MANAGE, name: 'Take applications, approve, reject and enrol', group: 'Students' },
  { code: PERMISSIONS.STAFF_VIEW, name: 'View staff, teacher profiles and assignments', group: 'Staff' },
  { code: PERMISSIONS.STAFF_MANAGE, name: 'Add and edit staff, verify documents, assign teachers', group: 'Staff' },
  { code: PERMISSIONS.STAFF_BANK, name: 'See and edit staff bank and PAN details', group: 'Staff' },
  { code: PERMISSIONS.ATTENDANCE_VIEW, name: 'See student and staff attendance', group: 'Attendance' },
  {
    code: PERMISSIONS.ATTENDANCE_MANAGE,
    name: 'Mark or correct attendance, decide student leave',
    group: 'Attendance',
  },
  { code: PERMISSIONS.LEAVE_APPROVE, name: 'Give final approval to staff leave', group: 'Attendance' },
  { code: PERMISSIONS.TIMETABLE_VIEW, name: 'See timetables and workload', group: 'Timetable' },
  { code: PERMISSIONS.TIMETABLE_MANAGE, name: 'Build timetables and the bell schedule', group: 'Timetable' },
  { code: PERMISSIONS.SUBSTITUTES_MANAGE, name: 'Assign substitute teachers for absent staff', group: 'Timetable' },
  { code: PERMISSIONS.PAYROLL_VIEW, name: 'See salary structures, payroll runs and payslips', group: 'Payroll' },
  { code: PERMISSIONS.PAYROLL_MANAGE, name: 'Set salaries, run and finalise payroll', group: 'Payroll' },
  { code: PERMISSIONS.FEES_VIEW, name: 'See fee plans, invoices, dues and collections', group: 'Fees' },
  { code: PERMISSIONS.FEES_MANAGE, name: 'Set fee plans, raise invoices and record payments', group: 'Fees' },
  { code: PERMISSIONS.EXAMS_VIEW, name: 'See exams, marks, results and rank holders', group: 'Exams' },
  { code: PERMISSIONS.EXAMS_MANAGE, name: 'Create exams, enter marks and publish results', group: 'Exams' },
  {
    code: PERMISSIONS.FEEDBACK_VIEW,
    name: 'See parent ratings of teachers with the parent names, teacher ranking, teacher-wise results and teacher feedback on students',
    group: 'Feedback',
  },
  {
    code: PERMISSIONS.FEEDBACK_MANAGE,
    name: 'Turn parent ratings and student feedback on or off and choose how often parents can rate',
    group: 'Feedback',
  },
  { code: PERMISSIONS.NOTIFICATIONS_VIEW, name: 'View sent notifications and the SMS outbox', group: 'Communication' },
  { code: PERMISSIONS.NOTIFICATIONS_SEND, name: 'Send notifications and test messages', group: 'Communication' },
  {
    code: PERMISSIONS.MEETINGS_VIEW,
    name: 'See teacher and parent video meetings and their call log',
    group: 'Communication',
  },
  { code: PERMISSIONS.DIARY_VIEW, name: 'See diary posts sent to parents', group: 'Communication' },
  {
    code: PERMISSIONS.DIARY_MODERATE,
    name: 'Approve, send back or hide diary posts before parents see them',
    group: 'Communication',
  },
  { code: PERMISSIONS.ANNOUNCEMENTS_VIEW, name: 'See school announcements and who read them', group: 'Communication' },
  {
    code: PERMISSIONS.ANNOUNCEMENTS_MANAGE,
    name: 'Write, schedule, publish and archive announcements',
    group: 'Communication',
  },
  {
    code: PERMISSIONS.CHAT_AUDIT,
    name: 'Read teacher and parent chats, see flagged messages and hide them',
    group: 'Communication',
  },
  { code: PERMISSIONS.FLEET_VIEW, name: 'See buses on the map and their live status', group: 'Fleet' },
  { code: PERMISSIONS.FLEET_MANAGE, name: 'Manage buses, routes and stops', group: 'Fleet' },
];

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  PRINCIPAL: 'PRINCIPAL',
  AO: 'AO',
  TRANSPORT_INCHARGE: 'TRANSPORT_INCHARGE',
  HOD: 'HOD',
  TEACHER: 'TEACHER',
  PARENT: 'PARENT',
  DRIVER: 'DRIVER',
  ATTENDANT: 'ATTENDANT',
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];

export interface RoleDefinition {
  code: RoleCode;
  name: string;
  description: string;
  app: AppSection;
  permissions: string[] | 'all' | 'school';
}

const PLATFORM_ONLY: string[] = [PERMISSIONS.PLATFORM_SCHOOLS];
const AO_ONLY: string[] = [PERMISSIONS.SUBSTITUTES_MANAGE];
const ALL = PERMISSION_CATALOG.map((permission) => permission.code);
const SCHOOL_ALL = ALL.filter((code) => !PLATFORM_ONLY.includes(code) && !AO_ONLY.includes(code));

export const ROLE_CATALOG: RoleDefinition[] = [
  {
    code: ROLES.SUPER_ADMIN,
    name: 'Super admin',
    description: 'Tamilzorous platform owner. Full access to every school.',
    app: 'admin',
    permissions: 'all',
  },
  {
    code: ROLES.ADMIN,
    name: 'School admin',
    description:
      'Full access to one school in the admin web, except assigning proxy teachers (the AO or super admin does that).',
    app: 'admin',
    permissions: 'school',
  },
  {
    code: ROLES.PRINCIPAL,
    name: 'Principal',
    description: 'Oversees the school; approves leave and views every module.',
    app: 'admin',
    permissions: [
      PERMISSIONS.USERS_VIEW,
      PERMISSIONS.ROLES_VIEW,
      PERMISSIONS.SCHOOLS_VIEW,
      PERMISSIONS.STUDENTS_VIEW,
      PERMISSIONS.STAFF_VIEW,
      PERMISSIONS.ATTENDANCE_VIEW,
      PERMISSIONS.LEAVE_APPROVE,
      PERMISSIONS.TIMETABLE_VIEW,
      PERMISSIONS.PAYROLL_VIEW,
      PERMISSIONS.FEES_VIEW,
      PERMISSIONS.EXAMS_VIEW,
      PERMISSIONS.FEEDBACK_VIEW,
      PERMISSIONS.NOTIFICATIONS_VIEW,
      PERMISSIONS.NOTIFICATIONS_SEND,
      PERMISSIONS.MEETINGS_VIEW,
      PERMISSIONS.DIARY_VIEW,
      PERMISSIONS.DIARY_MODERATE,
      PERMISSIONS.ANNOUNCEMENTS_VIEW,
      PERMISSIONS.ANNOUNCEMENTS_MANAGE,
      PERMISSIONS.CHAT_AUDIT,
      PERMISSIONS.FLEET_VIEW,
    ],
  },
  {
    code: ROLES.AO,
    name: 'Administrative officer',
    description:
      'Runs the school office in the admin web: admissions, student and staff records, attendance, fee collection, announcements and the only school role that assigns proxy teachers. No salaries, user roles or school setup changes.',
    app: 'admin',
    permissions: [
      PERMISSIONS.SCHOOLS_VIEW,
      PERMISSIONS.STUDENTS_VIEW,
      PERMISSIONS.STUDENTS_MANAGE,
      PERMISSIONS.ADMISSIONS_MANAGE,
      PERMISSIONS.STAFF_VIEW,
      PERMISSIONS.STAFF_MANAGE,
      PERMISSIONS.ATTENDANCE_VIEW,
      PERMISSIONS.ATTENDANCE_MANAGE,
      PERMISSIONS.TIMETABLE_VIEW,
      PERMISSIONS.SUBSTITUTES_MANAGE,
      PERMISSIONS.FEES_VIEW,
      PERMISSIONS.FEES_MANAGE,
      PERMISSIONS.EXAMS_VIEW,
      PERMISSIONS.NOTIFICATIONS_VIEW,
      PERMISSIONS.NOTIFICATIONS_SEND,
      PERMISSIONS.MEETINGS_VIEW,
      PERMISSIONS.DIARY_VIEW,
      PERMISSIONS.DIARY_MODERATE,
      PERMISSIONS.ANNOUNCEMENTS_VIEW,
      PERMISSIONS.ANNOUNCEMENTS_MANAGE,
      PERMISSIONS.CHAT_AUDIT,
      PERMISSIONS.FLEET_VIEW,
    ],
  },
  {
    code: ROLES.TRANSPORT_INCHARGE,
    name: 'Transport in-charge',
    description: 'Manages buses, routes and transport alerts.',
    app: 'admin',
    permissions: [
      PERMISSIONS.FLEET_VIEW,
      PERMISSIONS.FLEET_MANAGE,
      PERMISSIONS.STUDENTS_VIEW,
      PERMISSIONS.NOTIFICATIONS_VIEW,
    ],
  },
  {
    code: ROLES.HOD,
    name: 'Head of department',
    description: 'Teacher who also approves leave for the department.',
    app: 'staff',
    permissions: [],
  },
  {
    code: ROLES.TEACHER,
    name: 'Teacher',
    description: 'Uses the Staff app for classes, attendance, diary and chat.',
    app: 'staff',
    permissions: [],
  },
  {
    code: ROLES.PARENT,
    name: 'Parent',
    description: 'Uses the Parent app to follow their children.',
    app: 'parent',
    permissions: [],
  },
  {
    code: ROLES.DRIVER,
    name: 'Driver',
    description: 'Uses the Driver app to run bus trips.',
    app: 'driver',
    permissions: [],
  },
  {
    code: ROLES.ATTENDANT,
    name: 'Bus attendant',
    description: 'Uses the Driver app to scan students on and off the bus.',
    app: 'driver',
    permissions: [],
  },
];

export function rolePermissions(role: RoleDefinition): string[] {
  if (role.permissions === 'all') return ALL;
  if (role.permissions === 'school') return SCHOOL_ALL;
  return role.permissions;
}

export const FULL_ACCESS_ROLES: string[] = [ROLES.SUPER_ADMIN];

const TEACHING_ROLES: string[] = [ROLES.TEACHER, ROLES.HOD];
const BUS_CREW_ROLES: string[] = [ROLES.DRIVER, ROLES.ATTENDANT];

export function roleConflict(codes: string[]): string | null {
  const teaching = codes.filter((code) => TEACHING_ROLES.includes(code));
  const crew = codes.filter((code) => BUS_CREW_ROLES.includes(code));
  if (!teaching.length || !crew.length) return null;
  const name = (code: string) => ROLE_CATALOG.find((role) => role.code === code)?.name ?? code;
  return `A person cannot be both ${name(teaching[0]!)} and ${name(crew[0]!)}. Teaching staff and bus crew must be different people.`;
}
