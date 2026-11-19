import { EntityManager } from 'typeorm';
import { Book, BookCategory, BookCopy } from '../../modules/library/entities/book.entity';
import { LibraryFine, LibraryFinePayment } from '../../modules/library/entities/library-fine.entity';
import {
  LibraryCopyEvent,
  LibraryFollowUp,
  LibraryIssue,
  LibraryReminder,
} from '../../modules/library/entities/library-issue.entity';
import { LibraryMember, MemberType } from '../../modules/library/entities/library-member.entity';
import { LibrarySettings } from '../../modules/library/entities/library-settings.entity';
import { LibraryStockAudit, LibraryVisit } from '../../modules/library/entities/library-visit.entity';
import {
  accessionNumber,
  cardNumber,
  chargeableDays,
  DEFAULT_RULES,
  fineAmounts,
  lostFine,
  overdueFine,
} from '../../modules/library/library.logic';
import { School } from '../../modules/schools/entities/school.entity';
import { SequencesService } from '../../modules/schools/sequences.service';
import { todayIn } from '../../shared/dates';
import { addDays, holidaySet, weekday } from '../../shared/school-days';

const CATEGORIES: [string, string, boolean][] = [
  ['Fiction', 'FIC', false],
  ['Biography', 'BIO', false],
  ['Science', 'SCI', false],
  ['Tamil Literature', 'TAM', false],
  ['Children', 'CHD', false],
  ['General Knowledge', 'GK', false],
  ['Reference', 'REF', true],
];

const BOOKS: [string, string, string, string, number, number, string, string][] = [
  ['Wings of Fire', 'A. P. J. Abdul Kalam', 'BIO', 'English', 250, 4, 'R1', 'S1'],
  ['The Story of My Experiments with Truth', 'M. K. Gandhi', 'BIO', 'English', 180, 3, 'R1', 'S1'],
  ['Ignited Minds', 'A. P. J. Abdul Kalam', 'BIO', 'English', 220, 2, 'R1', 'S1'],
  ['Swami and Friends', 'R. K. Narayan', 'FIC', 'English', 199, 4, 'R2', 'S1'],
  ['Malgudi Days', 'R. K. Narayan', 'FIC', 'English', 225, 3, 'R2', 'S1'],
  ['The Room on the Roof', 'Ruskin Bond', 'FIC', 'English', 175, 3, 'R2', 'S2'],
  ['The Blue Umbrella', 'Ruskin Bond', 'CHD', 'English', 120, 5, 'R4', 'S1'],
  ['Panchatantra Stories', 'Vishnu Sharma (retold)', 'CHD', 'English', 150, 5, 'R4', 'S1'],
  ['Tenali Raman Stories', 'Traditional (retold)', 'CHD', 'English', 140, 4, 'R4', 'S2'],
  ['Akbar and Birbal', 'Traditional (retold)', 'CHD', 'English', 140, 4, 'R4', 'S2'],
  ['Ponniyin Selvan – Part 1', 'Kalki Krishnamurthy', 'TAM', 'Tamil', 350, 3, 'R3', 'S1'],
  ['Sivagamiyin Sabatham', 'Kalki Krishnamurthy', 'TAM', 'Tamil', 320, 2, 'R3', 'S1'],
  ['Thirukkural', 'Thiruvalluvar', 'TAM', 'Tamil', 120, 5, 'R3', 'S2'],
  ['Bharathiyar Kavithaigal', 'Subramania Bharati', 'TAM', 'Tamil', 160, 3, 'R3', 'S2'],
  ['A Brief History of Time', 'Stephen Hawking', 'SCI', 'English', 399, 2, 'R5', 'S1'],
  ['The Magic School Bus: Inside the Human Body', 'Joanna Cole', 'SCI', 'English', 275, 3, 'R5', 'S1'],
  ['Exploring Space', 'Editorial Board', 'SCI', 'English', 310, 3, 'R5', 'S2'],
  ['Wonders of Indian Science', 'Editorial Board', 'SCI', 'English', 260, 2, 'R5', 'S2'],
  ['General Knowledge 2026', 'Editorial Board', 'GK', 'English', 180, 4, 'R6', 'S1'],
  ['Quiz Time for Young Minds', 'Editorial Board', 'GK', 'English', 150, 3, 'R6', 'S1'],
  ['Oxford Student Atlas', 'Oxford University Press', 'REF', 'English', 450, 2, 'R7', 'S1'],
  ['Oxford English Dictionary for Schools', 'Oxford University Press', 'REF', 'English', 520, 2, 'R7', 'S1'],
  ['Tamil–English Dictionary', 'Editorial Board', 'REF', 'Tamil', 380, 1, 'R7', 'S2'],
  ['Charlotte’s Web', 'E. B. White', 'FIC', 'English', 299, 3, 'R2', 'S3'],
  ['Matilda', 'Roald Dahl', 'FIC', 'English', 299, 3, 'R2', 'S3'],
  ['The Jungle Book', 'Rudyard Kipling', 'FIC', 'English', 180, 4, 'R2', 'S3'],
];

function isbnFor(index: number): string {
  const body = `97893${String(5000000 + index * 137).slice(0, 7)}`;
  const sum = body.split('').reduce((total, digit, position) => total + Number(digit) * (position % 2 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

export async function seedDemoLibrary(manager: EntityManager, school: School): Promise<void> {
  const schoolId = school.id;
  if (await manager.existsBy(Book, { school_id: schoolId })) {
    console.log('Library   books already set up: kept');
    return;
  }
  const today = todayIn(process.env.APP_TIMEZONE || 'Asia/Kolkata');
  const sequences = new SequencesService();
  const [librarian] = await manager.query(`SELECT id FROM users WHERE mobile = '9000000009' AND deleted_at IS NULL`);
  const actorId: number | null = librarian ? Number(librarian.id) : null;

  await manager.save(manager.create(LibrarySettings, { school_id: schoolId, updated_by: actorId }));

  const categories = new Map<string, BookCategory>();
  for (const [name, code, reference] of CATEGORIES) {
    categories.set(
      code,
      await manager.save(
        manager.create(BookCategory, { school_id: schoolId, name, code, is_reference: reference, description: null }),
      ),
    );
  }

  const books: Book[] = [];
  const copies: BookCopy[] = [];
  for (const [index, [title, authors, category, language, price, count, rack, shelf]] of BOOKS.entries()) {
    const book = await manager.save(
      manager.create(Book, {
        school_id: schoolId,
        title,
        authors,
        isbn: isbnFor(index),
        language,
        category_id: categories.get(category)!.id,
        price,
        rack,
        shelf,
        published_year: 1990 + ((index * 7) % 35),
        created_by: actorId,
      }),
    );
    books.push(book);
    for (let copyIndex = 0; copyIndex < count; copyIndex += 1) {
      const accession = accessionNumber(school.code, await sequences.next(manager, schoolId, 'library_accession'));
      copies.push(
        await manager.save(
          manager.create(BookCopy, {
            school_id: schoolId,
            book_id: book.id,
            accession_no: accession,
            barcode: accession,
            status: 'available',
            condition: copyIndex === 0 && index % 5 === 0 ? 'fair' : 'good',
            source: index % 6 === 0 ? 'donation' : 'purchase',
            vendor: index % 6 === 0 ? null : 'Higginbothams',
            bill_no: index % 6 === 0 ? null : `HB-${2026}-${100 + index}`,
            acquired_on: addDays(today, -180 - index),
            price,
            created_by: actorId,
          }),
        ),
      );
    }
  }
  await manager.query(`UPDATE book_copies SET created_at = acquired_on::timestamptz WHERE school_id = $1`, [schoolId]);
  await manager.insert(
    LibraryCopyEvent,
    copies.map((copy) => ({
      school_id: schoolId,
      copy_id: copy.id,
      kind: 'added' as const,
      note: copy.vendor ? `purchase · ${copy.vendor}` : 'donation',
      actor_id: actorId,
      created_at: at(copy.acquired_on!, '11:00'),
    })),
  );

  const students: { id: number; section_id: number | null; class_id: number | null }[] = await manager.query(
    `SELECT s.id, e.section_id, e.class_id FROM students s
     JOIN student_enrollments e ON e.student_id = s.id
     JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current
     JOIN classes c ON c.id = e.class_id
     WHERE s.school_id = $1 AND s.deleted_at IS NULL AND s.status = 'active' AND c.grade_level >= 1
     ORDER BY s.id`,
    [schoolId],
  );
  const staff: { user_id: number; mobile: string }[] = await manager.query(
    `SELECT st.user_id, u.mobile FROM staff st JOIN users u ON u.id = st.user_id
     WHERE st.school_id = $1 AND st.deleted_at IS NULL AND st.status = 'active' ORDER BY st.id`,
    [schoolId],
  );
  const members = new Map<string, LibraryMember>();
  const enrol = async (type: MemberType, studentId: number | null, userId: number | null) => {
    const value = await sequences.next(manager, schoolId, `library_card_${type}`);
    const member = await manager.save(
      manager.create(LibraryMember, {
        school_id: schoolId,
        member_type: type,
        student_id: studentId,
        user_id: userId,
        card_no: cardNumber(school.code, type, value),
        status: 'active',
        joined_on: addDays(today, -150),
      }),
    );
    members.set(studentId ? `s${studentId}` : `u${userId}`, member);
    return member;
  };
  for (const student of students) await enrol('student', Number(student.id), null);
  for (const person of staff) await enrol('staff', null, Number(person.user_id));

  const parentChild = async (mobile: string) => {
    const [row] = await manager.query(
      `SELECT sg.student_id FROM guardians g JOIN student_guardians sg ON sg.guardian_id = g.id
       WHERE g.school_id = $1 AND g.mobile = $2 ORDER BY sg.student_id LIMIT 1`,
      [schoolId, mobile],
    );
    return row ? (members.get(`s${row.student_id}`) ?? null) : null;
  };
  const showcaseChild = await parentChild('9000000005');
  const heldChild = await parentChild('9000000006');
  const studentMembers = [...members.values()].filter(
    (member) => member.member_type === 'student' && member.id !== showcaseChild?.id && member.id !== heldChild?.id,
  );
  const teacher = members.get(`u${staff.find((person) => person.mobile === '9000000004')?.user_id}`) ?? null;
  const sectionOf = new Map(students.map((student) => [Number(student.id), student]));

  const holidays = await holidaySet(manager, schoolId, addDays(today, -120), today);
  const circulating = copies.filter(
    (copy) =>
      !categories.get('REF') ||
      books.find((book) => book.id === copy.book_id)?.category_id !== categories.get('REF')!.id,
  );
  const free = new Set(circulating.map((copy) => copy.id));
  const takeCopy = (skipBook?: number) => {
    const copy = circulating.find((item) => free.has(item.id) && item.book_id !== skipBook);
    if (!copy) throw new Error('Not enough library copies for the demo');
    free.delete(copy.id);
    return copy;
  };
  const bookOf = (copy: BookCopy) => books.find((book) => book.id === copy.book_id)!;
  let raised = 0;
  let collected = 0;

  const loan = async (
    member: LibraryMember,
    copy: BookCopy,
    issuedOn: string,
    dueDate: string,
    outcome: { returned_on?: string; lost?: boolean; condition?: 'good' | 'fair' | 'poor' },
    purpose: 'personal' | 'class_set' = 'personal',
    sectionId: number | null = null,
  ) => {
    const enrollment = member.student_id ? sectionOf.get(member.student_id) : undefined;
    const status = outcome.lost ? 'lost' : outcome.returned_on ? 'returned' : 'issued';
    const issue = await manager.save(
      manager.create(LibraryIssue, {
        school_id: schoolId,
        copy_id: copy.id,
        book_id: copy.book_id,
        member_id: member.id,
        academic_year_id: null,
        class_id: enrollment?.class_id ? Number(enrollment.class_id) : null,
        section_id: sectionId ?? (enrollment?.section_id ? Number(enrollment.section_id) : null),
        purpose,
        issued_at: at(issuedOn, '10:15'),
        due_date: dueDate,
        returned_at: outcome.returned_on ? at(outcome.returned_on, '09:40') : null,
        return_condition: outcome.returned_on ? (outcome.condition ?? 'good') : null,
        status,
        issued_by: actorId,
        returned_by: outcome.returned_on || outcome.lost ? actorId : null,
        created_by: actorId,
      }),
    );
    await manager.query(
      `UPDATE library_issues SET created_at = issued_at, academic_year_id = (
      SELECT id FROM academic_years WHERE school_id = $1 AND is_current LIMIT 1) WHERE id = $2`,
      [schoolId, issue.id],
    );
    if (status === 'issued') await manager.update(BookCopy, copy.id, { status: 'issued' });
    if (status === 'lost') await manager.update(BookCopy, copy.id, { status: 'lost' });
    const events: Partial<LibraryCopyEvent>[] = [
      { kind: 'issued', note: `Due ${dueDate}`, created_at: at(issuedOn, '10:15') },
      ...(outcome.returned_on
        ? [{ kind: 'returned' as const, note: null, created_at: at(outcome.returned_on, '09:40') }]
        : []),
      ...(outcome.lost
        ? [{ kind: 'marked_lost' as const, note: 'Parent said the book was lost', created_at: at(today, '09:00') }]
        : []),
    ];
    await manager.insert(
      LibraryCopyEvent,
      events.map((event) => ({
        ...event,
        school_id: schoolId,
        copy_id: copy.id,
        issue_id: issue.id,
        member_id: member.id,
        actor_id: actorId,
      })),
    );
    return issue;
  };

  const fine = async (
    issue: LibraryIssue,
    kind: 'overdue' | 'lost',
    amount: number,
    reason: string,
    days: number | null,
    settle: 'unpaid' | 'paid' | 'partly' | 'waived',
    on: string,
  ) => {
    if (amount <= 0) return;
    const paid = settle === 'paid' ? amount : settle === 'partly' ? Math.floor(amount / 2) : 0;
    const waived = settle === 'waived' ? amount : 0;
    const saved = await manager.save(
      manager.create(LibraryFine, {
        school_id: schoolId,
        member_id: issue.member_id,
        issue_id: issue.id,
        kind,
        ...fineAmounts(amount, waived, paid),
        days_late: days,
        reason,
        waived_by: waived ? actorId : null,
        waived_at: waived ? at(on, '12:00') : null,
        waive_reason: waived ? 'Student was unwell that week' : null,
        created_by: actorId,
      }),
    );
    await manager.query(`UPDATE library_fines SET created_at = $2 WHERE id = $1`, [saved.id, at(on, '09:41')]);
    raised += 1;
    if (paid > 0) {
      const value = await sequences.next(manager, schoolId, `library_receipt:${on.slice(0, 4)}`);
      const payment = await manager.save(
        manager.create(LibraryFinePayment, {
          school_id: schoolId,
          fine_id: saved.id,
          member_id: issue.member_id,
          amount: paid,
          mode: collected % 2 ? 'upi' : 'cash',
          reference: collected % 2 ? `UPI${800000 + saved.id}` : null,
          receipt_no: SequencesService.format(`${school.code}-LIB`, on.slice(0, 4), value),
          paid_on: on,
          received_by: actorId,
          created_by: actorId,
        }),
      );
      await manager.query(`UPDATE library_fine_payments SET created_at = $2 WHERE id = $1`, [
        payment.id,
        at(on, '09:45'),
      ]);
      collected += 1;
    }
  };

  const lateFine = (due: string, returned: string) => {
    const days = chargeableDays(due, returned, DEFAULT_RULES.grace_days, true, holidays);
    return { days, amount: overdueFine(days, DEFAULT_RULES.fine_per_day, DEFAULT_RULES.max_fine_per_book) };
  };

  let history = 0;
  for (const [index, member] of studentMembers.slice(0, 45).entries()) {
    const issuedOn = addDays(today, -70 + (index % 40));
    const due = addDays(issuedOn, 14);
    const late = index % 6 === 0;
    const returnedOn = late ? addDays(due, 3 + (index % 5)) : addDays(issuedOn, 6 + (index % 7));
    if (returnedOn >= today) continue;
    const copy = takeCopy();
    const issue = await loan(member, copy, issuedOn, due, {
      returned_on: returnedOn,
      condition: index % 9 === 0 ? 'fair' : 'good',
    });
    free.add(copy.id);
    history += 1;
    if (late) {
      const { days, amount } = lateFine(due, returnedOn);
      const settle = (['paid', 'partly', 'unpaid', 'waived'] as const)[index % 4]!;
      await fine(
        issue,
        'overdue',
        amount,
        `${days} ${days === 1 ? 'day' : 'days'} late: ${bookOf(copy).title}`,
        days,
        settle,
        returnedOn,
      );
    }
  }

  const current: { member: LibraryMember; dueOffset: number; reminders: string[] }[] = [];
  const pool = studentMembers.slice(45);
  const pick = (index: number) => pool[index % pool.length]!;
  [12, 9, 6, 5].forEach((offset, index) => current.push({ member: pick(index), dueOffset: offset, reminders: [] }));
  [2, 1, 2].forEach((offset, index) =>
    current.push({ member: pick(4 + index), dueOffset: offset, reminders: ['due_soon'] }),
  );
  [0, 0].forEach((offset, index) =>
    current.push({ member: pick(7 + index), dueOffset: offset, reminders: ['due_soon', 'due_today'] }),
  );
  [-1, -3, -4].forEach((offset, index) =>
    current.push({ member: pick(9 + index), dueOffset: offset, reminders: ['due_soon', 'due_today', 'overdue'] }),
  );
  [-9, -11].forEach((offset, index) =>
    current.push({
      member: pick(12 + index),
      dueOffset: offset,
      reminders: ['due_soon', 'due_today', 'overdue', 'escalated'],
    }),
  );
  current.push({
    member: pick(14),
    dueOffset: -36,
    reminders: ['overdue', 'escalated', 'escalated_w1', 'long_overdue'],
  });
  const [teacherSection]: { id: number }[] = await manager.query(
    `SELECT sec.id FROM sections sec JOIN users u ON u.id = sec.class_teacher_user_id
     JOIN academic_years y ON y.id = sec.academic_year_id AND y.is_current
     WHERE sec.school_id = $1 AND u.mobile = '9000000004' AND sec.deleted_at IS NULL LIMIT 1`,
    [schoolId],
  );
  const inClass = teacherSection
    ? studentMembers.filter(
        (member) =>
          Number(sectionOf.get(member.student_id!)?.section_id) === Number(teacherSection.id) &&
          !current.some((item) => item.member.id === member.id),
      )
    : [];
  if (inClass[0]) {
    current.push({ member: inClass[0], dueOffset: -3, reminders: ['due_soon', 'due_today', 'overdue'] });
  }
  if (inClass[1]) {
    current.push({
      member: inClass[1],
      dueOffset: -10,
      reminders: ['due_soon', 'due_today', 'overdue', 'escalated'],
    });
  }
  if (inClass[2]) current.push({ member: inClass[2], dueOffset: 5, reminders: [] });
  if (showcaseChild) current.push({ member: showcaseChild, dueOffset: 2, reminders: ['due_soon'] });
  if (heldChild)
    current.push({ member: heldChild, dueOffset: -8, reminders: ['due_soon', 'due_today', 'overdue', 'escalated'] });

  const openIssues: LibraryIssue[] = [];
  for (const item of current) {
    const due = addDays(today, item.dueOffset);
    const issue = await loan(item.member, takeCopy(), addDays(due, -14), due, {});
    openIssues.push(issue);
    for (const [step, kind] of item.reminders.entries()) {
      await manager.insert(LibraryReminder, {
        school_id: schoolId,
        issue_id: issue.id,
        kind,
        recipients: 1 + (kind.startsWith('escalated') ? 1 : 0),
        sent_at: at(addDays(today, -(item.reminders.length - step)), '08:00'),
      });
    }
    if (item.dueOffset <= -8) {
      await manager.save(
        manager.create(LibraryFollowUp, {
          school_id: schoolId,
          issue_id: issue.id,
          member_id: item.member.id,
          action: 'called_parent',
          note: 'Spoke to the mother; she will send the book this week',
          promised_on: addDays(today, item.dueOffset === -8 ? -1 : 2),
          next_follow_up_on: null,
          created_by: actorId,
        }),
      );
    }
  }

  if (heldChild) {
    const copy = takeCopy();
    const due = addDays(today, -40);
    const returnedOn = addDays(due, 6);
    const issue = await loan(heldChild, copy, addDays(due, -14), due, { returned_on: returnedOn });
    free.add(copy.id);
    const { days, amount } = lateFine(due, returnedOn);
    await fine(issue, 'overdue', amount, `${days} days late: ${bookOf(copy).title}`, days, 'unpaid', returnedOn);
  }

  const lostMember = pick(15);
  const lostCopy = takeCopy();
  const lostIssue = await loan(lostMember, lostCopy, addDays(today, -30), addDays(today, -16), { lost: true });
  await fine(
    lostIssue,
    'lost',
    lostFine(lostCopy.price, DEFAULT_RULES.lost_processing_fee),
    `Lost book: ${bookOf(lostCopy).title}`,
    null,
    'partly',
    today,
  );
  const late = lateFine(addDays(today, -16), today);
  await fine(
    lostIssue,
    'overdue',
    late.amount,
    `${late.days} days late: ${bookOf(lostCopy).title}`,
    late.days,
    'unpaid',
    today,
  );

  let classSet = 0;
  const [sixA]: { id: number }[] = await manager.query(
    `SELECT sec.id FROM sections sec JOIN classes c ON c.id = sec.class_id JOIN academic_years y ON y.id = sec.academic_year_id AND y.is_current
     WHERE sec.school_id = $1 AND c.name = '6' AND sec.name = 'A' LIMIT 1`,
    [schoolId],
  );
  const setBook = books.find((book) => book.title === 'Panchatantra Stories');
  if (teacher && sixA && setBook) {
    for (const copy of circulating.filter((item) => item.book_id === setBook.id && free.has(item.id)).slice(0, 4)) {
      free.delete(copy.id);
      await loan(teacher, copy, addDays(today, -10), addDays(today, 20), {}, 'class_set', Number(sixA.id));
      classSet += 1;
    }
  }
  const arun = members.get(`u${staff.find((person) => person.mobile === '9000000006')?.user_id}`);
  if (arun) await loan(arun, takeCopy(), addDays(today, -12), addDays(today, 18), {});

  const visits = await seedVisits(manager, schoolId, today, students, staff, actorId);
  const periods = await seedLibraryPeriods(manager, schoolId, today, actorId);

  const audit = await manager.save(
    manager.create(LibraryStockAudit, {
      school_id: schoolId,
      name: 'Half-yearly stock check',
      status: 'closed',
      notes: 'Two copies found on the wrong rack and put back',
      closed_at: at(addDays(today, -25), '15:30'),
      closed_by: actorId,
      expected_count: copies.length - 6,
      found_count: copies.length - 8,
      missing_count: 2,
      created_by: actorId,
    }),
  );
  await manager.query(`UPDATE library_stock_audits SET created_at = $2 WHERE id = $1`, [
    audit.id,
    at(addDays(today, -26), '10:00'),
  ]);

  console.log(
    `Library   ${BOOKS.length} titles, ${copies.length} copies, ${members.size} members, ${history} returned loans, ${openIssues.length + classSet + 1} books out (${classSet} class set), 1 lost, ${raised} fines (${collected} collected), ${visits} visits, ${periods} library periods a week`,
  );
}

async function seedVisits(
  manager: EntityManager,
  schoolId: number,
  today: string,
  students: { id: number; section_id: number | null; class_id: number | null }[],
  staff: { user_id: number }[],
  actorId: number | null,
): Promise<number> {
  const rows: Partial<LibraryVisit>[] = [];
  for (let back = 12; back >= 0; back -= 1) {
    const day = addDays(today, -back);
    if (weekday(day) === 0) continue;
    const count = back === 0 ? 7 : 8 + ((back * 5) % 9);
    for (let index = 0; index < count; index += 1) {
      const isStaff = index % 7 === 6;
      const student = students[(back * 11 + index * 3) % students.length]!;
      const person = staff[(back + index) % staff.length]!;
      const hour = 8 + ((index * 3 + back) % 8);
      const minute = (index * 13) % 60;
      let inAt = new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`);
      if (back === 0) {
        const latest = Date.now() - (count - index) * 6 * 60000;
        if (inAt.getTime() > latest) inAt = new Date(latest);
        if (inAt < at(day, '08:00')) continue;
      }
      const inside = back === 0 && index >= 4;
      rows.push({
        school_id: schoolId,
        kind: 'walk_in',
        member_type: isStaff ? 'staff' : 'student',
        student_id: isStaff ? null : Number(student.id),
        user_id: isStaff ? Number(person.user_id) : null,
        class_id: isStaff ? null : student.class_id,
        section_id: isStaff ? null : student.section_id,
        visit_date: day,
        in_at: inAt,
        out_at: inside ? null : new Date(Math.min(inAt.getTime() + (15 + ((index * 7) % 50)) * 60000, Date.now())),
        purpose: (['read', 'borrow', 'return', 'study'] as const)[index % 4]!,
        present: true,
        marked_by: actorId,
        created_by: actorId,
      });
    }
  }
  if (rows.length) await manager.insert(LibraryVisit, rows);
  return rows.length;
}

async function seedLibraryPeriods(
  manager: EntityManager,
  schoolId: number,
  today: string,
  actorId: number | null,
): Promise<number> {
  const [year]: { id: number }[] = await manager.query(
    `SELECT id FROM academic_years WHERE school_id = $1 AND is_current AND deleted_at IS NULL LIMIT 1`,
    [schoolId],
  );
  if (!year) return 0;
  const [existing]: { id: number }[] = await manager.query(
    `SELECT id FROM subjects WHERE school_id = $1 AND upper(code) = 'LIB' AND deleted_at IS NULL`,
    [schoolId],
  );
  const subjectId = existing
    ? Number(existing.id)
    : Number(
        (
          await manager.query(
            `INSERT INTO subjects (school_id, code, name, type, created_at, updated_at) VALUES ($1, 'LIB', 'Library', 'theory', now(), now()) RETURNING id`,
            [schoolId],
          )
        )[0].id,
      );
  const periods: { period_no: number }[] = await manager.query(
    `SELECT DISTINCT period_no FROM bell_periods WHERE school_id = $1 AND is_break = false AND period_no IS NOT NULL ORDER BY period_no`,
    [schoolId],
  );
  const sections: { id: number }[] = await manager.query(
    `SELECT sec.id FROM sections sec JOIN classes c ON c.id = sec.class_id
     WHERE sec.school_id = $1 AND sec.academic_year_id = $2 AND sec.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM timetable_slots t WHERE t.section_id = sec.id)
     ORDER BY c.grade_level, sec.name`,
    [schoolId, year.id],
  );
  const todayDow = weekday(today) || 1;
  let added = 0;
  for (const [index, section] of sections.entries()) {
    const days = index < 4 ? [todayDow] : [((todayDow + index) % 6) + 1];
    for (const day of days) {
      const taken: { period_no: number }[] = await manager.query(
        `SELECT period_no FROM timetable_slots WHERE section_id = $1 AND day_of_week = $2`,
        [section.id, day],
      );
      const freePeriod = periods.find(
        (period) => !taken.some((slot) => Number(slot.period_no) === Number(period.period_no)),
      );
      if (!freePeriod) continue;
      const [slot]: { id: number }[] = await manager.query(
        `INSERT INTO timetable_slots (school_id, academic_year_id, section_id, day_of_week, period_no, subject_id, teacher_user_id, room, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, now(), now()) RETURNING id`,
        [schoolId, year.id, section.id, day, freePeriod.period_no, subjectId],
      );
      added += 1;
      let lastWeek = addDays(today, -1);
      while (weekday(lastWeek) !== day) lastWeek = addDays(lastWeek, -1);
      const roster: { student_id: number; class_id: number }[] = await manager.query(
        `SELECT e.student_id, e.class_id FROM student_enrollments e JOIN students s ON s.id = e.student_id AND s.status = 'active' AND s.deleted_at IS NULL
         WHERE e.section_id = $1 AND e.status = 'studying' ORDER BY e.roll_no NULLS LAST, s.id`,
        [section.id],
      );
      if (!roster.length) continue;
      await manager.insert(
        LibraryVisit,
        roster.map((student, position) => ({
          school_id: schoolId,
          kind: 'period' as const,
          member_type: 'student' as const,
          student_id: Number(student.student_id),
          class_id: Number(student.class_id),
          section_id: Number(section.id),
          visit_date: lastWeek,
          purpose: 'period' as const,
          present: position % 9 !== 4,
          slot_id: Number(slot!.id),
          period_no: Number(freePeriod.period_no),
          marked_by: actorId,
          created_by: actorId,
        })),
      );
    }
  }
  return added;
}
