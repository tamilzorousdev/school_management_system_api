-- ============================================================================
-- STANDALONE POSTGRESQL SEED: DIARY, HOMEWORK & SUBMISSIONS
-- Run this directly in pgAdmin Query Tool, DBeaver, or psql.
-- Does NOT require npm or package.json.
-- ============================================================================

DO $$
DECLARE
  v_school_id INTEGER;
  v_year_id INTEGER;
  v_teacher_id INTEGER;
  v_class_id INTEGER;
  v_section_id INTEGER;
  v_subject_math_id INTEGER;
  v_subject_sci_id INTEGER;
  v_subject_eng_id INTEGER;
  v_student_1 INTEGER;
  v_student_2 INTEGER;
  v_student_3 INTEGER;
  v_entry_math INTEGER;
  v_entry_sci INTEGER;
  v_entry_eng INTEGER;
  v_entry_remark INTEGER;
  v_entry_note INTEGER;
  v_sub_1 INTEGER;
  v_sub_2 INTEGER;
  v_sub_3 INTEGER;
BEGIN
  -- 1. Identify School and Academic Year
  SELECT id INTO v_school_id FROM schools WHERE status = 'active' ORDER BY id LIMIT 1;
  IF v_school_id IS NULL THEN
    SELECT id INTO v_school_id FROM schools ORDER BY id LIMIT 1;
  END IF;

  SELECT id INTO v_year_id FROM academic_years WHERE school_id = v_school_id AND status = 'active' ORDER BY id DESC LIMIT 1;
  IF v_year_id IS NULL THEN
    SELECT id INTO v_year_id FROM academic_years WHERE school_id = v_school_id ORDER BY id DESC LIMIT 1;
  END IF;

  -- 2. Identify Teacher
  SELECT u.id INTO v_teacher_id FROM users u
  JOIN user_roles ur ON ur.user_id = u.id
  JOIN roles r ON r.id = ur.role_id
  WHERE u.school_id = v_school_id AND r.code IN ('teacher', 'staff', 'school_admin', 'super_admin')
  ORDER BY u.id LIMIT 1;

  IF v_teacher_id IS NULL THEN
    SELECT id INTO v_teacher_id FROM users WHERE school_id = v_school_id ORDER BY id LIMIT 1;
  END IF;

  -- 3. Identify Class, Section, and Students
  SELECT id INTO v_class_id FROM classes WHERE school_id = v_school_id AND status = 'active' ORDER BY id LIMIT 1;
  IF v_class_id IS NULL THEN
    SELECT id INTO v_class_id FROM classes WHERE school_id = v_school_id ORDER BY id LIMIT 1;
  END IF;

  SELECT id INTO v_section_id FROM class_sections WHERE class_id = v_class_id ORDER BY id LIMIT 1;

  SELECT id INTO v_student_1 FROM students WHERE school_id = v_school_id AND status = 'active' ORDER BY id LIMIT 1;
  SELECT id INTO v_student_2 FROM students WHERE school_id = v_school_id AND status = 'active' AND id != COALESCE(v_student_1, 0) ORDER BY id LIMIT 1;
  SELECT id INTO v_student_3 FROM students WHERE school_id = v_school_id AND status = 'active' AND id NOT IN (COALESCE(v_student_1, 0), COALESCE(v_student_2, 0)) ORDER BY id LIMIT 1;

  -- 4. Identify or Fallback Subjects
  SELECT id INTO v_subject_math_id FROM subjects WHERE school_id = v_school_id AND name ILIKE '%math%' LIMIT 1;
  SELECT id INTO v_subject_sci_id FROM subjects WHERE school_id = v_school_id AND name ILIKE '%sci%' LIMIT 1;
  SELECT id INTO v_subject_eng_id FROM subjects WHERE school_id = v_school_id AND name ILIKE '%eng%' LIMIT 1;

  RAISE NOTICE 'Target School ID: %, Year ID: %, Teacher ID: %, Class ID: %, Section ID: %', 
    v_school_id, v_year_id, v_teacher_id, v_class_id, v_section_id;

  -- Ensure Submissions table exists
  CREATE TABLE IF NOT EXISTS diary_submissions (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL,
    entry_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    submitted_by INTEGER,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_late BOOLEAN NOT NULL DEFAULT false,
    student_notes VARCHAR(1000),
    status VARCHAR(25) NOT NULL DEFAULT 'submitted',
    grade VARCHAR(10),
    marks NUMERIC(5,2),
    max_marks NUMERIC(5,2),
    teacher_feedback VARCHAR(1000),
    graded_by INTEGER,
    graded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT UQ_diary_submissions_entry_student UNIQUE (entry_id, student_id)
  );

  -- 5. Insert Diary Entry 1: Mathematics Homework (Due in 3 days)
  INSERT INTO diary_entries (
    school_id, academic_year_id, type, scope, class_id, section_id, subject_id,
    title, body, due_date, status, published_at, recipient_count, created_by, created_at, updated_at
  ) VALUES (
    v_school_id, v_year_id, 'homework', 'section', v_class_id, v_section_id, v_subject_math_id,
    'Mathematics: Real Numbers & Polynomials (Ex 1.2)',
    'Complete problems 1 to 10 from NCERT Chapter 1 Exercise 1.2. Show all step-by-step working clearly in your homework notebook. Submit online or bring physical copy on due date.',
    CURRENT_DATE + INTERVAL '3 days',
    'published',
    now() - INTERVAL '2 hours',
    3,
    v_teacher_id,
    now() - INTERVAL '2 hours',
    now() - INTERVAL '2 hours'
  ) RETURNING id INTO v_entry_math;

  -- 6. Insert Diary Entry 2: Science Homework (Due in 5 days)
  INSERT INTO diary_entries (
    school_id, academic_year_id, type, scope, class_id, section_id, subject_id,
    title, body, due_date, status, published_at, recipient_count, created_by, created_at, updated_at
  ) VALUES (
    v_school_id, v_year_id, 'homework', 'class', v_class_id, NULL, v_subject_sci_id,
    'Science: Chemical Reactions Lab Observations',
    'Write down observations for the exothermic reaction experiment discussed today. Diagram the apparatus and write balanced chemical equations for zinc reacting with dilute hydrochloric acid.',
    CURRENT_DATE + INTERVAL '5 days',
    'published',
    now() - INTERVAL '1 day',
    3,
    v_teacher_id,
    now() - INTERVAL '1 day',
    now() - INTERVAL '1 day'
  ) RETURNING id INTO v_entry_sci;

  -- 7. Insert Diary Entry 3: English Essay (Due tomorrow)
  INSERT INTO diary_entries (
    school_id, academic_year_id, type, scope, class_id, section_id, subject_id,
    title, body, due_date, status, published_at, recipient_count, created_by, created_at, updated_at
  ) VALUES (
    v_school_id, v_year_id, 'homework', 'section', v_class_id, v_section_id, v_subject_eng_id,
    'English: Essay on Environmental Conservation',
    'Write a 250-word essay on the importance of rainwater harvesting and planting native trees in urban school campuses. Use proper paragraph structure and transitions.',
    CURRENT_DATE + INTERVAL '1 day',
    'published',
    now() - INTERVAL '4 hours',
    3,
    v_teacher_id,
    now() - INTERVAL '4 hours',
    now() - INTERVAL '4 hours'
  ) RETURNING id INTO v_entry_eng;

  -- 8. Insert Diary Entry 4: Remark
  INSERT INTO diary_entries (
    school_id, academic_year_id, type, scope, class_id, section_id, subject_id,
    title, body, due_date, status, published_at, recipient_count, created_by, created_at, updated_at
  ) VALUES (
    v_school_id, v_year_id, 'remark', 'section', v_class_id, v_section_id, NULL,
    'Outstanding Performance in Science Quiz',
    'Congratulations to all students for active participation in today inter-house science preliminary round! Keep up the scientific curiosity.',
    NULL,
    'published',
    now() - INTERVAL '6 hours',
    3,
    v_teacher_id,
    now() - INTERVAL '6 hours',
    now() - INTERVAL '6 hours'
  ) RETURNING id INTO v_entry_remark;

  -- 9. Insert Diary Entry 5: Note
  INSERT INTO diary_entries (
    school_id, academic_year_id, type, scope, class_id, section_id, subject_id,
    title, body, due_date, status, published_at, recipient_count, created_by, created_at, updated_at
  ) VALUES (
    v_school_id, v_year_id, 'note', 'class', v_class_id, NULL, NULL,
    'Parent-Teacher Progress Meeting Reminder',
    'Parent-Teacher conference for Term 1 progress evaluation is scheduled for this coming Saturday from 9:30 AM to 1:00 PM. Please bring student homework logbooks.',
    NULL,
    'published',
    now() - INTERVAL '1 day',
    3,
    v_teacher_id,
    now() - INTERVAL '1 day',
    now() - INTERVAL '1 day'
  ) RETURNING id INTO v_entry_note;

  -- 10. Link Recipients for Student 1, 2, 3
  IF v_student_1 IS NOT NULL THEN
    INSERT INTO diary_recipients (school_id, entry_id, student_id, seen_at, seen_by)
    VALUES 
      (v_school_id, v_entry_math, v_student_1, now() - INTERVAL '1 hour', v_student_1),
      (v_school_id, v_entry_sci, v_student_1, now() - INTERVAL '5 hours', v_student_1),
      (v_school_id, v_entry_eng, v_student_1, NULL, NULL),
      (v_school_id, v_entry_remark, v_student_1, now() - INTERVAL '3 hours', v_student_1),
      (v_school_id, v_entry_note, v_student_1, now() - INTERVAL '10 hours', v_student_1)
    ON CONFLICT (entry_id, student_id) DO NOTHING;
  END IF;

  IF v_student_2 IS NOT NULL THEN
    INSERT INTO diary_recipients (school_id, entry_id, student_id, seen_at, seen_by)
    VALUES 
      (v_school_id, v_entry_math, v_student_2, now() - INTERVAL '30 minutes', v_student_2),
      (v_school_id, v_entry_sci, v_student_2, NULL, NULL),
      (v_school_id, v_entry_eng, v_student_2, NULL, NULL)
    ON CONFLICT (entry_id, student_id) DO NOTHING;
  END IF;

  IF v_student_3 IS NOT NULL THEN
    INSERT INTO diary_recipients (school_id, entry_id, student_id, seen_at, seen_by)
    VALUES 
      (v_school_id, v_entry_math, v_student_3, NULL, NULL),
      (v_school_id, v_entry_sci, v_student_3, now() - INTERVAL '12 hours', v_student_3),
      (v_school_id, v_entry_eng, v_student_3, NULL, NULL)
    ON CONFLICT (entry_id, student_id) DO NOTHING;
  END IF;

  -- 11. Insert Homework Submissions with Graded, Pending, and Resubmit States
  IF v_student_1 IS NOT NULL AND v_entry_math IS NOT NULL THEN
    -- Student 1: Graded submission (10/10, A+)
    INSERT INTO diary_submissions (
      school_id, entry_id, student_id, submitted_by, submitted_at, is_late,
      student_notes, status, grade, marks, max_marks, teacher_feedback, graded_by, graded_at, created_at, updated_at
    ) VALUES (
      v_school_id, v_entry_math, v_student_1, v_student_1, now() - INTERVAL '1 hour', false,
      'Attached all 10 solved questions for Exercise 1.2 with prime factorisation proofs.',
      'graded', 'A+', 10.00, 10.00,
      'Excellent work! All steps and calculations are neat and accurate.',
      v_teacher_id, now() - INTERVAL '30 minutes', now() - INTERVAL '1 hour', now() - INTERVAL '30 minutes'
    ) ON CONFLICT (entry_id, student_id) DO UPDATE SET
      status = EXCLUDED.status, grade = EXCLUDED.grade, marks = EXCLUDED.marks, teacher_feedback = EXCLUDED.teacher_feedback;
  END IF;

  IF v_student_2 IS NOT NULL AND v_entry_math IS NOT NULL THEN
    -- Student 2: Submitted (Awaiting teacher grading)
    INSERT INTO diary_submissions (
      school_id, entry_id, student_id, submitted_by, submitted_at, is_late,
      student_notes, status, grade, marks, max_marks, teacher_feedback, graded_by, graded_at, created_at, updated_at
    ) VALUES (
      v_school_id, v_entry_math, v_student_2, v_student_2, now() - INTERVAL '45 minutes', false,
      'Completed exercise 1.2. Awaiting review.',
      'submitted', NULL, NULL, 10.00, NULL, NULL, NULL, now() - INTERVAL '45 minutes', now() - INTERVAL '45 minutes'
    ) ON CONFLICT (entry_id, student_id) DO UPDATE SET status = EXCLUDED.status;
  END IF;

  IF v_student_3 IS NOT NULL AND v_entry_eng IS NOT NULL THEN
    -- Student 3: Resubmit Requested
    INSERT INTO diary_submissions (
      school_id, entry_id, student_id, submitted_by, submitted_at, is_late,
      student_notes, status, grade, marks, max_marks, teacher_feedback, graded_by, graded_at, created_at, updated_at
    ) VALUES (
      v_school_id, v_entry_eng, v_student_3, v_student_3, now() - INTERVAL '3 hours', false,
      'Draft essay on conservation.',
      'resubmit_requested', 'B', 5.00, 10.00,
      'Good beginning, but the conclusion lacks specific conservation steps and word count is below 200 words. Please expand and resubmit.',
      v_teacher_id, now() - INTERVAL '1 hour', now() - INTERVAL '3 hours', now() - INTERVAL '1 hour'
    ) ON CONFLICT (entry_id, student_id) DO UPDATE SET
      status = EXCLUDED.status, grade = EXCLUDED.grade, marks = EXCLUDED.marks, teacher_feedback = EXCLUDED.teacher_feedback;
  END IF;

  RAISE NOTICE 'SUCCESS: Diary and Homework seed data successfully inserted!';
END $$;
