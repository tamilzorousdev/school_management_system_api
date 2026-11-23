import { EntityManager } from 'typeorm';
import {
  AuthorisedPickup,
  GateBlock,
  GateEvent,
  GateEventKind,
  GatePass,
  GateSettings,
  GateVisit,
} from '../../modules/gate/entities/gate.entity';
import { School } from '../../modules/schools/entities/school.entity';
import { todayIn } from '../../shared/dates';
import { addDays } from '../../shared/school-days';

const ZONE = process.env.APP_TIMEZONE ?? 'Asia/Kolkata';

const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const shift = (time: string, minutes: number) => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const total = Math.max(0, Math.min(23 * 60 + 59, h * 60 + m + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

interface Kid {
  id: number;
  guardian_id: number;
  guardian_name: string;
  relation: string;
  mobile: string;
  class_teacher: number | null;
}

export async function seedDemoGate(manager: EntityManager, school: School): Promise<void> {
  if (await manager.existsBy(GatePass, { school_id: school.id })) {
    console.log('  Gate and visitors: already set up: kept');
    return;
  }
  const kids: Kid[] = (
    await manager.query(
      `SELECT DISTINCT ON (s.id) s.id, g.id AS guardian_id, g.name AS guardian_name, sg.relation, g.mobile,
              sec.class_teacher_user_id AS class_teacher
       FROM students s
       JOIN student_guardians sg ON sg.student_id = s.id AND sg.can_pickup = true
       JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
       JOIN academic_years ay ON ay.school_id = s.school_id AND ay.is_current = true AND ay.deleted_at IS NULL
       JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ay.id
       LEFT JOIN sections sec ON sec.id = e.section_id
       WHERE s.school_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'
       ORDER BY s.id, sg.is_primary DESC
       LIMIT 12`,
      [school.id],
    )
  ).map((row: Kid) => ({ ...row, id: Number(row.id), guardian_id: Number(row.guardian_id) }));
  if (kids.length < 6) {
    console.log('  Gate and visitors: not enough students with parents: skipped');
    return;
  }
  const users: { id: number; code: string }[] = await manager.query(
    `SELECT u.id, r.code FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE u.school_id = $1 AND u.deleted_at IS NULL AND r.code IN ('ADMIN', 'GATE_INCHARGE', 'AO', 'TEACHER') ORDER BY u.id`,
    [school.id],
  );
  const role = (code: string) => Number(users.find((row) => row.code === code)?.id ?? users[0]?.id ?? 0) || null;
  const admin = role('ADMIN');
  const gate = role('GATE_INCHARGE') ?? admin;
  const ao = role('AO') ?? admin;
  const teacher = role('TEACHER');
  const today = todayIn(ZONE);
  const now = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());

  await manager.createQueryBuilder().insert().into(GateSettings).values({ school_id: school.id }).orIgnore().execute();

  const pickups = await manager.save(
    AuthorisedPickup,
    [
      {
        student_id: kids[0]!.id,
        name: 'Murugan Sundaram',
        relation: 'Grandfather',
        mobile: '9876500101',
        valid_until: null,
      },
      {
        student_id: kids[1]!.id,
        name: 'Kavitha Raman',
        relation: 'Aunt',
        mobile: '9876500102',
        valid_until: addDays(today, 60),
      },
      {
        student_id: kids[2]!.id,
        name: 'Senthil Auto (driver)',
        relation: 'Auto driver',
        mobile: '9876500103',
        valid_until: addDays(today, 150),
      },
    ].map((row) =>
      manager.create(AuthorisedPickup, { ...row, school_id: school.id, is_active: true, created_by: admin }),
    ),
  );

  await manager.save(
    GateBlock,
    manager.create(GateBlock, {
      school_id: school.id,
      name: 'Rajesh Kumar',
      mobile: '9876500199',
      reason: 'Court order: not allowed to meet or take the student',
      is_active: true,
      created_by: admin,
    }),
  );

  const codes = new Set<string>();
  const code = () => {
    let value = '';
    do value = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    while (codes.has(value));
    codes.add(value);
    return value;
  };
  const year = Number(today.slice(0, 4));
  let passCount = 0;
  let visitCount = 0;
  const events: Partial<GateEvent>[] = [];
  const event = (
    kind: GateEventKind,
    when: Date,
    refs: { pass_id?: number; visit_id?: number; student_id?: number },
    actor: number | null,
    note: string,
    method: string | null = null,
  ) =>
    events.push({
      school_id: school.id,
      kind,
      pass_id: refs.pass_id ?? null,
      visit_id: refs.visit_id ?? null,
      student_id: refs.student_id ?? null,
      actor_id: actor,
      note,
      method,
      created_at: when,
    });

  type PassPlan = {
    kid: Kid;
    date: string;
    from: string;
    until: string;
    reason: string;
    status: GatePass['status'];
    source: GatePass['source'];
    person?: 'guardian' | 'authorised' | 'other';
    method?: GatePass['release_method'];
    emergency?: boolean;
    consent?: boolean;
  };
  const plans: PassPlan[] = [
    {
      kid: kids[0]!,
      date: addDays(today, -6),
      from: '11:30',
      until: '13:30',
      reason: 'Dentist appointment',
      status: 'released',
      source: 'parent',
      method: 'qr',
    },
    {
      kid: kids[1]!,
      date: addDays(today, -5),
      from: '12:00',
      until: '14:00',
      reason: 'Family function',
      status: 'released',
      source: 'parent',
      person: 'authorised',
      method: 'code',
    },
    {
      kid: kids[2]!,
      date: addDays(today, -5),
      from: '10:30',
      until: '12:30',
      reason: 'Fever, mother coming',
      status: 'released',
      source: 'office',
      method: 'manual',
    },
    {
      kid: kids[3]!,
      date: addDays(today, -4),
      from: '13:00',
      until: '15:00',
      reason: 'Going to native place',
      status: 'rejected',
      source: 'parent',
    },
    {
      kid: kids[4]!,
      date: addDays(today, -3),
      from: '11:00',
      until: '13:00',
      reason: 'Passport office visit',
      status: 'cancelled',
      source: 'parent',
    },
    {
      kid: kids[5]!,
      date: addDays(today, -3),
      from: '14:00',
      until: '15:00',
      reason: 'Eye check-up',
      status: 'expired',
      source: 'parent',
    },
    {
      kid: kids[0]!,
      date: addDays(today, -2),
      from: '10:15',
      until: '11:15',
      reason: 'Grandmother admitted in hospital',
      status: 'released',
      source: 'gate',
      person: 'guardian',
      method: 'manual',
      emergency: true,
    },
    {
      kid: kids[3]!,
      date: addDays(today, -1),
      from: '12:40',
      until: '13:40',
      reason: 'Father met with a small accident',
      status: 'released',
      source: 'gate',
      person: 'other',
      method: 'manual',
      emergency: true,
      consent: true,
    },
    {
      kid: kids[4]!,
      date: today,
      from: shift(now, 20),
      until: shift(now, 140),
      reason: 'Music exam at the centre',
      status: 'approved',
      source: 'parent',
    },
    {
      kid: kids[0]!,
      date: today,
      from: shift(now, 45),
      until: shift(now, 165),
      reason: 'Temple festival at home',
      status: 'approved',
      source: 'parent',
      person: 'authorised',
    },
    {
      kid: kids[5]!,
      date: addDays(today, 1),
      from: '12:30',
      until: '14:30',
      reason: 'Sports selection trial',
      status: 'pending',
      source: 'parent',
    },
    {
      kid: kids[2]!,
      date: addDays(today, 2),
      from: '11:00',
      until: '13:00',
      reason: 'Visa interview',
      status: 'approved',
      source: 'staff',
    },
  ];

  for (const plan of plans) {
    passCount++;
    const kind = plan.person ?? 'guardian';
    const authorised = kind === 'authorised' ? pickups.find((row) => row.student_id === plan.kid.id) : undefined;
    const pickupKind = authorised ? 'authorised' : kind === 'other' ? 'other' : 'guardian';
    const created = at(
      addDays(plan.date, plan.source === 'gate' ? 0 : -1),
      plan.source === 'gate' ? plan.from : '19:30',
    );
    const decidedAt = at(
      addDays(plan.date, plan.source === 'gate' ? 0 : -1),
      plan.source === 'gate' ? shift(plan.from, 4) : '20:05',
    );
    const decided = plan.status !== 'pending';
    const releasedAt = plan.status === 'released' ? at(plan.date, shift(plan.from, plan.emergency ? 12 : 15)) : null;
    const decider = plan.emergency ? (plan.kid.class_teacher ?? ao) : (plan.kid.class_teacher ?? teacher ?? admin);
    const pass = await manager.save(
      GatePass,
      manager.create(GatePass, {
        school_id: school.id,
        pass_no: `GP-${year}-${String(passCount).padStart(4, '0')}`,
        student_id: plan.kid.id,
        pass_date: plan.date,
        from_time: plan.from,
        until_time: plan.until,
        reason: plan.reason,
        pickup_kind: pickupKind,
        guardian_id: pickupKind === 'guardian' ? plan.kid.guardian_id : null,
        authorised_id: authorised?.id ?? null,
        pickup_name: authorised?.name ?? (pickupKind === 'other' ? 'Ramesh Babu' : plan.kid.guardian_name),
        pickup_relation: authorised?.relation ?? (pickupKind === 'other' ? 'Neighbour' : plan.kid.relation),
        pickup_mobile: authorised?.mobile ?? (pickupKind === 'other' ? '9876500150' : plan.kid.mobile),
        status: plan.status,
        source: plan.source,
        is_emergency: Boolean(plan.emergency),
        needs_consent: Boolean(plan.consent),
        consent_status: plan.consent ? 'approved' : null,
        consent_at: plan.consent ? at(plan.date, shift(plan.from, 3)) : null,
        consent_code: plan.consent ? code() : null,
        consent_verified_at: plan.consent ? at(plan.date, shift(plan.from, 8)) : null,
        requested_by:
          plan.source === 'gate' ? gate : plan.source === 'office' ? ao : plan.source === 'staff' ? teacher : null,
        decided_by: decided ? (plan.status === 'cancelled' ? null : decider) : null,
        decided_at: decided ? decidedAt : null,
        decision_note: plan.status === 'rejected' ? 'Final exams this week; please plan after the exams' : null,
        code: code(),
        released_at: releasedAt,
        released_by: releasedAt ? gate : null,
        release_method: plan.method ?? null,
        id_proof_kind: plan.method === 'manual' ? 'aadhaar' : null,
        id_proof_last4: plan.method === 'manual' ? '4821' : null,
        created_by: plan.source === 'gate' ? gate : admin,
        created_at: created,
      }),
    );
    const refs = { pass_id: pass.id, student_id: plan.kid.id };
    event(
      plan.emergency ? 'emergency_raised' : 'pass_requested',
      created,
      refs,
      plan.source === 'gate' ? gate : null,
      `${pass.pass_no} · ${plan.reason}`,
    );
    if (plan.consent) {
      event('consent_asked', created, refs, gate, pass.pickup_name ?? '');
      event('consent_approved', at(plan.date, shift(plan.from, 3)), refs, null, pass.pickup_name ?? '');
      event('consent_verified', at(plan.date, shift(plan.from, 8)), refs, gate, pass.pickup_name ?? '', 'code');
    }
    if (decided && plan.status !== 'cancelled') {
      event(plan.status === 'rejected' ? 'pass_rejected' : 'pass_approved', decidedAt, refs, decider, pass.pass_no);
    }
    if (plan.status === 'cancelled') event('pass_cancelled', at(plan.date, '08:10'), refs, null, pass.pass_no);
    if (plan.status === 'expired')
      event('pass_expired', at(plan.date, shift(plan.until, 31)), refs, null, pass.pass_no);
    if (releasedAt) {
      event('pass_checked', new Date(releasedAt.getTime() - 60000), refs, gate, `${pass.pass_no} · ok`, plan.method);
      event('released', releasedAt, refs, gate, `${pass.pass_no} to ${pass.pickup_name}`, plan.method);
    }
  }
  event('check_failed', at(addDays(today, -4), '12:05'), {}, gate, 'Not a school pass', 'code');

  type VisitPlan = Partial<GateVisit> & { offset: number; inAt?: string; outAt?: string };
  const host = teacher ?? admin;
  const visits: VisitPlan[] = [
    {
      offset: -6,
      name: 'Suresh Babu',
      mobile: '9876500201',
      purpose: 'vendor',
      company: 'Lab Supplies Co',
      status: 'left',
      inAt: '10:05',
      outAt: '10:50',
      host_user_id: ao,
    },
    {
      offset: -5,
      name: 'Anitha Selvam',
      mobile: '9876500202',
      purpose: 'admission_enquiry',
      status: 'left',
      inAt: '11:20',
      outAt: '12:00',
    },
    {
      offset: -4,
      name: 'Prakash Raj',
      mobile: '9876500203',
      purpose: 'parent_meeting',
      student_id: kids[1]!.id,
      status: 'left',
      inAt: '15:10',
      outAt: '15:40',
      host_user_id: host,
    },
    {
      offset: -3,
      name: 'Courier: Blue Dart',
      mobile: '9876500204',
      purpose: 'delivery',
      status: 'left',
      inAt: '12:30',
      outAt: '12:40',
    },
    {
      offset: -2,
      name: 'Deepa Krishnan',
      mobile: '9876500205',
      purpose: 'interview',
      status: 'left',
      inAt: '09:45',
      outAt: '11:15',
      host_user_id: admin,
      expected_from: '09:30',
      expected_until: '11:00',
    },
    {
      offset: -1,
      name: 'Rajesh Kumar',
      mobile: '9876500199',
      purpose: 'meet_staff',
      status: 'declined',
      blocked_hit: true,
      decision_note: 'On the blocked list',
    },
    {
      offset: 0,
      name: 'Vignesh Electricals',
      mobile: '9876500206',
      purpose: 'vendor',
      company: 'Vignesh Electricals',
      status: 'inside',
      inAt: shift(now, -50),
      host_user_id: ao,
      expected_until: shift(now, 40),
    },
    {
      offset: 0,
      name: 'Meena Ravi',
      mobile: '9876500207',
      purpose: 'fee_payment',
      student_id: kids[2]!.id,
      status: 'inside',
      inAt: shift(now, -10),
    },
    {
      offset: 0,
      name: 'Dr. Arvind (health camp)',
      mobile: '9876500208',
      purpose: 'event',
      status: 'expected',
      expected_from: shift(now, 30),
      expected_until: shift(now, 180),
      host_user_id: admin,
    },
    {
      offset: 0,
      name: 'Selva Kumar',
      mobile: '9876500209',
      purpose: 'meet_staff',
      status: 'waiting',
      host_user_id: host,
    },
    {
      offset: 1,
      name: 'Book fair team',
      mobile: '9876500210',
      purpose: 'event',
      company: 'Chennai Book House',
      people_count: 3,
      status: 'expected',
      expected_from: '10:00',
      expected_until: '13:00',
      host_user_id: admin,
    },
  ];
  for (const plan of visits) {
    visitCount++;
    const date = addDays(today, plan.offset);
    const invited = plan.status === 'expected' || Boolean(plan.expected_from);
    const createdAt = invited
      ? at(addDays(date, -1), '16:00')
      : at(date, plan.inAt ? shift(plan.inAt, -5) : shift(now, -3));
    const visit = await manager.save(
      GateVisit,
      manager.create(GateVisit, {
        school_id: school.id,
        visit_no: `VP-${year}-${String(visitCount).padStart(4, '0')}`,
        visit_date: date,
        name: plan.name,
        mobile: plan.mobile,
        purpose: plan.purpose,
        company: plan.company ?? null,
        people_count: plan.people_count ?? 1,
        host_user_id: plan.host_user_id ?? null,
        student_id: plan.student_id ?? null,
        status: plan.status,
        expected_from: plan.expected_from ?? null,
        expected_until: plan.expected_until ?? null,
        code: code(),
        invited_by: invited ? admin : null,
        decided_by: plan.status === 'declined' || (!invited && plan.inAt) ? (plan.host_user_id ?? ao) : null,
        decided_at: plan.status === 'declined' || (!invited && plan.inAt) ? createdAt : null,
        decision_note: plan.decision_note ?? null,
        checked_in_at: plan.inAt ? at(date, plan.inAt) : null,
        checked_in_by: plan.inAt ? gate : null,
        check_in_method: plan.inAt ? (invited ? 'qr' : 'manual') : null,
        checked_out_at: plan.outAt ? at(date, plan.outAt) : null,
        checked_out_by: plan.outAt ? gate : null,
        check_out_method: plan.outAt ? 'manual' : null,
        blocked_hit: Boolean(plan.blocked_hit),
        id_proof_kind: invited ? null : 'aadhaar',
        id_proof_last4: invited ? null : '7712',
        created_by: invited ? admin : gate,
        created_at: createdAt,
      }),
    );
    const refs = { visit_id: visit.id };
    event(
      invited ? 'visitor_invited' : 'visitor_registered',
      createdAt,
      refs,
      invited ? admin : gate,
      `${visit.visit_no} · ${visit.name}`,
    );
    if (plan.blocked_hit) event('blocked_person', createdAt, refs, gate, `${visit.name} · Court order`);
    if (plan.inAt) {
      if (!invited) event('visitor_allowed', at(date, shift(plan.inAt, -2)), refs, plan.host_user_id ?? ao, visit.name);
      event('visitor_in', at(date, plan.inAt), refs, gate, `${visit.visit_no} · ${visit.name}`, visit.check_in_method);
    }
    if (plan.outAt)
      event('visitor_out', at(date, plan.outAt), refs, gate, `${visit.visit_no} · ${visit.name}`, 'manual');
  }

  await manager.save(
    GateEvent,
    events.map((row) => manager.create(GateEvent, row)),
  );
  console.log(
    `  Gate and visitors: ${passCount} gate passes, ${visitCount} visitors, ${pickups.length} pickup persons, ${events.length} log entries`,
  );
}
