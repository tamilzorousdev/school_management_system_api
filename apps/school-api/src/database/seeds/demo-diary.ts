import { EntityManager } from 'typeorm';
import { DiaryAttachment } from '../../modules/diary/entities/diary-attachment.entity';
import { DiaryEntry } from '../../modules/diary/entities/diary-entry.entity';
import { DiaryRecipient } from '../../modules/diary/entities/diary-recipient.entity';
import { DiarySubmissionAttachment } from '../../modules/diary/entities/diary-submission-attachment.entity';
import { DiarySubmission } from '../../modules/diary/entities/diary-submission.entity';
import { FileRecord } from '../../modules/files/entities/file-record.entity';
import { School } from '../../modules/schools/entities/school.entity';
import { AcademicYear } from '../../modules/setup/entities/academic-year.entity';
import { todayIn } from '../../shared/dates';
import { addDays } from '../../shared/school-days';

export async function seedDemoDiary(manager: EntityManager, school: School): Promise<void> {
  const schoolId = school.id;
  if (await manager.exists(DiaryEntry, { where: { school_id: schoolId } })) {
    console.log(`Diary     ${school.code}  class diary, homework, and submissions already set up: kept`);
    return;
  }

  const timeZone = process.env.APP_TIMEZONE ?? 'Asia/Kolkata';
  const today = todayIn(timeZone);
  const year = await manager.findOneBy(AcademicYear, { school_id: schoolId, is_current: true });
  if (!year) {
    console.log(`Diary     ${school.code}  no active academic year found: skipped`);
    return;
  }

  // Find teachers: Priya Venkatesh (Maths / Teacher), Arun Prakash (Science / Teacher), Admin
  const teachers: { id: number; name: string; mobile: string }[] = await manager.query(
    `SELECT u.id, u.name, u.mobile FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.school_id = $1 AND r.code IN ('TEACHER', 'ADMIN', 'PRINCIPAL') AND u.deleted_at IS NULL
     ORDER BY u.id`,
    [schoolId],
  );

  const priya = teachers.find((t) => t.mobile === '9000000004') ?? teachers[0];
  const arun = teachers.find((t) => t.mobile === '9000000006') ?? teachers[1] ?? priya;
  const admin = teachers.find((t) => t.mobile === '9876543210') ?? teachers[0];

  type SectionRow = { id: number; class_id: number; class_name: string; section_name: string };
  const [section6A]: SectionRow[] = await manager.query(
    `SELECT sec.id, sec.class_id, c.name AS class_name, sec.name AS section_name
     FROM sections sec
     JOIN classes c ON c.id = sec.class_id
     WHERE sec.school_id = $1 AND sec.academic_year_id = $2 AND c.name = '6' AND sec.name = 'A' AND sec.deleted_at IS NULL`,
    [schoolId, year.id],
  );

  if (!section6A) {
    console.log(`Diary     ${school.code}  Class 6-A section not found: skipped`);
    return;
  }

  // Find subjects
  const subjectRows: { id: number; code: string; name: string }[] = await manager.query(
    `SELECT id, code, name FROM subjects WHERE school_id = $1 AND deleted_at IS NULL ORDER BY name`,
    [schoolId],
  );
  const math = subjectRows.find((s) => s.code === 'MATH') ?? subjectRows[0];
  const sci = subjectRows.find((s) => s.code === 'SCI') ?? subjectRows[1];
  const eng = subjectRows.find((s) => s.code === 'ENG') ?? subjectRows[2];
  const tam = subjectRows.find((s) => s.code === 'TAM') ?? subjectRows[3];

  // Find enrolled students in 6-A
  const students: { id: number; first_name: string; last_name: string; guardian_user_id: number | null }[] =
    await manager.query(
      `SELECT s.id, s.first_name, s.last_name,
              (SELECT g.user_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
               WHERE sg.student_id = s.id AND g.user_id IS NOT NULL LIMIT 1) AS guardian_user_id
       FROM students s
       JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = $2 AND e.section_id = $3
       WHERE s.school_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'
       ORDER BY e.roll_no NULLS LAST, s.id`,
      [schoolId, year.id, section6A.id],
    );

  if (!students.length) {
    console.log(`Diary     ${school.code}  no students enrolled in Class 6-A: skipped`);
    return;
  }

  // Seed sample file attachments (worksheets, diagrams, student notebook photos)
  const filesToInsert = [
    {
      original_name: 'Linear_Equations_Ex_4.2_Worksheet.pdf',
      storage_key: 'demo/diary/math_worksheet_ex42.pdf',
      mime_type: 'application/pdf',
      size_bytes: 245000,
    },
    {
      original_name: 'Plant_Cell_Diagram_Reference.png',
      storage_key: 'demo/diary/plant_cell_diagram.png',
      mime_type: 'image/png',
      size_bytes: 184000,
    },
    {
      original_name: 'Kavin_Maths_HW_Notebook_Page1.jpg',
      storage_key: 'demo/submissions/kavin_maths_p1.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 320000,
    },
    {
      original_name: 'Kavin_Maths_HW_Notebook_Page2.jpg',
      storage_key: 'demo/submissions/kavin_maths_p2.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 295000,
    },
    {
      original_name: 'Diya_Maths_Solved_Notebook.pdf',
      storage_key: 'demo/submissions/diya_maths_notes.pdf',
      mime_type: 'application/pdf',
      size_bytes: 412000,
    },
    {
      original_name: 'Kavya_Maths_Notebook.jpg',
      storage_key: 'demo/submissions/kavya_maths_hw.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 278000,
    },
    {
      original_name: 'Kavin_Essay_Draft.pdf',
      storage_key: 'demo/submissions/kavin_essay_draft.pdf',
      mime_type: 'application/pdf',
      size_bytes: 154000,
    },
  ];

  const fileEntities = await manager.save(
    FileRecord,
    filesToInsert.map((f) =>
      manager.create(FileRecord, {
        school_id: schoolId,
        storage_key: f.storage_key,
        original_name: f.original_name,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
        purpose: 'diary',
        scan_status: 'clean',
        created_by: priya?.id,
      }),
    ),
  );

  const [
    mathWorksheetFile,
    cellDiagramFile,
    kavinMathsP1,
    kavinMathsP2,
    diyaMathsFile,
    kavyaMathsFile,
    kavinEssayFile,
  ] = fileEntities;

  // 1. Math Homework Entry
  const mathHw = await manager.save(
    manager.create(DiaryEntry, {
      school_id: schoolId,
      academic_year_id: year.id,
      type: 'homework',
      scope: 'section',
      class_id: section6A.class_id,
      section_id: section6A.id,
      subject_id: math?.id ?? null,
      title: 'Mathematics - Exercise 4.2 Linear Equations',
      body: 'Complete questions 1 to 8 in your homework notebook. Show all step-by-step calculations and state the formula used. Submit photos of your completed notebook pages.',
      due_date: addDays(today, 1),
      status: 'published',
      reviewed_by: admin?.id ?? priya?.id,
      reviewed_at: new Date(),
      review_note: 'Approved for publishing',
      published_at: new Date(),
      recipient_count: students.length,
      created_by: priya?.id,
    }),
  );

  // Attach worksheet to math homework
  if (mathWorksheetFile) {
    await manager.save(
      manager.create(DiaryAttachment, {
        entry_id: mathHw.id,
        file_id: mathWorksheetFile.id,
        sort_order: 0,
      }),
    );
  }

  // 2. Science Homework Entry
  const scienceHw = await manager.save(
    manager.create(DiaryEntry, {
      school_id: schoolId,
      academic_year_id: year.id,
      type: 'homework',
      scope: 'section',
      class_id: section6A.class_id,
      section_id: section6A.id,
      subject_id: sci?.id ?? null,
      title: 'Science - Plant Cell Structure & Labelling',
      body: 'Draw a neat, labelled diagram of a plant cell. Write brief 2-line notes on Chloroplast, Cell Wall, and Nucleus. Refer to Chapter 3 page 45.',
      due_date: addDays(today, 2),
      status: 'published',
      reviewed_by: admin?.id ?? arun?.id,
      reviewed_at: new Date(),
      review_note: 'Approved',
      published_at: new Date(),
      recipient_count: students.length,
      created_by: arun?.id,
    }),
  );

  if (cellDiagramFile) {
    await manager.save(
      manager.create(DiaryAttachment, {
        entry_id: scienceHw.id,
        file_id: cellDiagramFile.id,
        sort_order: 0,
      }),
    );
  }

  // 3. English Essay Homework (Past due date: yesterday)
  const englishHw = await manager.save(
    manager.create(DiaryEntry, {
      school_id: schoolId,
      academic_year_id: year.id,
      type: 'homework',
      scope: 'section',
      class_id: section6A.class_id,
      section_id: section6A.id,
      subject_id: eng?.id ?? null,
      title: 'English - Paragraph Writing: My Favorite Festival',
      body: 'Write a composition of 150 words describing your favorite festival, why you celebrate it, and the traditional festive dishes prepared at home.',
      due_date: addDays(today, -1),
      status: 'published',
      reviewed_by: admin?.id ?? priya?.id,
      reviewed_at: new Date(),
      review_note: 'Approved',
      published_at: new Date(Date.now() - 2 * 86_400_000),
      recipient_count: students.length,
      created_by: priya?.id,
    }),
  );

  // 4. Tamil Homework
  const tamilHw = await manager.save(
    manager.create(DiaryEntry, {
      school_id: schoolId,
      academic_year_id: year.id,
      type: 'homework',
      scope: 'section',
      class_id: section6A.class_id,
      section_id: section6A.id,
      subject_id: tam?.id ?? null,
      title: 'தமிழ் - திருக்குறள் அதிகாரம் 5 வினா விடைகள்',
      body: 'அதிகாரம் 5 இல் உள்ள முதல் 5 குறட்பாக்களை மனனம் செய்து, பாடநூலில் உள்ள பயிற்சி வினாக்களுக்கு விடையளித்து வரவும்.',
      due_date: addDays(today, 3),
      status: 'published',
      reviewed_by: admin?.id,
      reviewed_at: new Date(),
      review_note: 'Approved',
      published_at: new Date(),
      recipient_count: students.length,
      created_by: arun?.id,
    }),
  );

  // 5. General Teacher Remark Entry
  await manager.save(
    manager.create(DiaryEntry, {
      school_id: schoolId,
      academic_year_id: year.id,
      type: 'remark',
      scope: 'section',
      class_id: section6A.class_id,
      section_id: section6A.id,
      subject_id: null,
      title: 'Appreciation: Active Participation in Science Quiz Prelims',
      body: 'Students of Class 6-A displayed commendable enthusiasm and teamwork during the Inter-House Science Quiz preliminary rounds today. Keep up the inquisitive spirit!',
      due_date: null,
      status: 'published',
      reviewed_by: admin?.id,
      reviewed_at: new Date(),
      review_note: 'Approved',
      published_at: new Date(),
      recipient_count: students.length,
      created_by: priya?.id,
    }),
  );

  // Seed Diary Recipients for all entries
  const allEntries = [mathHw, scienceHw, englishHw, tamilHw];
  const recipients: Partial<DiaryRecipient>[] = [];
  for (const entry of allEntries) {
    for (const [sIndex, student] of students.entries()) {
      recipients.push({
        school_id: schoolId,
        entry_id: entry.id,
        student_id: student.id,
        seen_at: sIndex % 4 !== 3 ? new Date() : null,
        seen_by: sIndex % 4 !== 3 ? student.guardian_user_id : null,
      });
    }
  }
  await manager.save(DiaryRecipient, recipients);

  // Find Kavin Narayanan (Lakshmi Narayanan's son)
  const kavin = students.find((s) => s.first_name.toLowerCase() === 'kavin') ?? students[0];
  const secondStudent = students.find((s) => s.id !== kavin.id) ?? students[1] ?? students[0];
  const thirdStudent =
    students.find((s) => s.id !== kavin.id && s.id !== secondStudent.id) ?? students[2] ?? students[0];
  const fourthStudent =
    students.find((s) => s.id !== kavin.id && s.id !== secondStudent.id && s.id !== thirdStudent.id) ??
    students[3] ??
    students[0];

  // Seed Submissions for Math Homework (Entry 1)
  // 1. Kavin Narayanan: Graded A+ (10/10) with glowing teacher remarks
  const kavinMathSub = await manager.save(
    manager.create(DiarySubmission, {
      school_id: schoolId,
      entry_id: mathHw.id,
      student_id: kavin.id,
      submitted_by: kavin.guardian_user_id,
      submitted_at: new Date(Date.now() - 36_000_000),
      is_late: false,
      student_notes: 'Completed all questions 1 to 8 with step-by-step methods shown in my homework notebook.',
      status: 'graded',
      grade: 'A+',
      marks: 10,
      max_marks: 10,
      teacher_feedback: 'Outstanding work Kavin! All linear equation solutions are neat, accurate, and properly boxed.',
      graded_by: priya?.id,
      graded_at: new Date(Date.now() - 18_000_000),
    }),
  );

  if (kavinMathsP1 && kavinMathsP2) {
    await manager.save(DiarySubmissionAttachment, [
      manager.create(DiarySubmissionAttachment, {
        submission_id: kavinMathSub.id,
        file_id: kavinMathsP1.id,
        sort_order: 0,
      }),
      manager.create(DiarySubmissionAttachment, {
        submission_id: kavinMathSub.id,
        file_id: kavinMathsP2.id,
        sort_order: 1,
      }),
    ]);
  }

  // 2. Second Student: Graded A (9/10)
  if (secondStudent.id !== kavin.id) {
    const secondMathSub = await manager.save(
      manager.create(DiarySubmission, {
        school_id: schoolId,
        entry_id: mathHw.id,
        student_id: secondStudent.id,
        submitted_by: secondStudent.guardian_user_id,
        submitted_at: new Date(Date.now() - 40_000_000),
        is_late: false,
        student_notes: 'Uploaded solved worksheet solutions.',
        status: 'graded',
        grade: 'A',
        marks: 9,
        max_marks: 10,
        teacher_feedback: 'Well done! Re-check question 5 calculation step for signs.',
        graded_by: priya?.id,
        graded_at: new Date(Date.now() - 15_000_000),
      }),
    );
    if (diyaMathsFile) {
      await manager.save(
        manager.create(DiarySubmissionAttachment, {
          submission_id: secondMathSub.id,
          file_id: diyaMathsFile.id,
          sort_order: 0,
        }),
      );
    }
  }

  // 3. Third Student: Submitted (Pending Review - ready for teacher to test grading in UI)
  if (thirdStudent.id !== kavin.id && thirdStudent.id !== secondStudent.id) {
    const thirdMathSub = await manager.save(
      manager.create(DiarySubmission, {
        school_id: schoolId,
        entry_id: mathHw.id,
        student_id: thirdStudent.id,
        submitted_by: thirdStudent.guardian_user_id,
        submitted_at: new Date(Date.now() - 7_200_000),
        is_late: false,
        student_notes: 'Completed homework. Awaiting teacher review.',
        status: 'submitted',
        grade: null,
        marks: null,
        max_marks: 10,
        teacher_feedback: null,
        graded_by: null,
        graded_at: null,
      }),
    );
    if (kavyaMathsFile) {
      await manager.save(
        manager.create(DiarySubmissionAttachment, {
          submission_id: thirdMathSub.id,
          file_id: kavyaMathsFile.id,
          sort_order: 0,
        }),
      );
    }
  }

  // 4. Fourth Student: Late submission (Submitted past due)
  if (fourthStudent.id !== kavin.id && fourthStudent.id !== secondStudent.id && fourthStudent.id !== thirdStudent.id) {
    await manager.save(
      manager.create(DiarySubmission, {
        school_id: schoolId,
        entry_id: mathHw.id,
        student_id: fourthStudent.id,
        submitted_by: fourthStudent.guardian_user_id,
        submitted_at: new Date(),
        is_late: true,
        student_notes: 'Sorry maam, could not upload yesterday due to travel.',
        status: 'submitted',
        grade: null,
        marks: null,
        max_marks: 10,
        teacher_feedback: null,
        graded_by: null,
        graded_at: null,
      }),
    );
  }

  // Seed Submissions for English Homework (Entry 3)
  // Kavin Narayanan: Resubmit Requested (teacher requested revisions)
  const kavinEngSub = await manager.save(
    manager.create(DiarySubmission, {
      school_id: schoolId,
      entry_id: englishHw.id,
      student_id: kavin.id,
      submitted_by: kavin.guardian_user_id,
      submitted_at: new Date(Date.now() - 48_000_000),
      is_late: false,
      student_notes: 'Draft essay about Pongal festival celebration.',
      status: 'resubmit_requested',
      grade: null,
      marks: 6,
      max_marks: 10,
      teacher_feedback:
        'Good start Kavin, but the second paragraph is missing punctuation and the total length is below 150 words. Please elaborate on traditional dishes and resubmit.',
      graded_by: priya?.id,
      graded_at: new Date(Date.now() - 24_000_000),
    }),
  );

  if (kavinEssayFile) {
    await manager.save(
      manager.create(DiarySubmissionAttachment, {
        submission_id: kavinEngSub.id,
        file_id: kavinEssayFile.id,
        sort_order: 0,
      }),
    );
  }

  console.log(
    `Diary     ${school.code}  seeded 5 diary & homework entries with submissions (graded, pending, resubmit) for Class 6-A`,
  );
}
