-- ==============================================================================
-- KRA CONFIGURATION & APPRAISAL SEED SCRIPT (PostgreSQL Direct Runner)
-- Can be run directly in psql / pgAdmin / DBeaver without npm scripts
-- ==============================================================================

-- 1. Ensure Table and Columns Exist
CREATE TABLE IF NOT EXISTS "kra_configs" (
  "id" SERIAL NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMP WITH TIME ZONE,
  "created_by" integer,
  "school_id" integer NOT NULL,
  "academic_year_id" integer,
  "code" character varying(50) NOT NULL,
  "title" character varying(150) NOT NULL,
  "description" text,
  "category" character varying(50) NOT NULL DEFAULT 'academics',
  "weightage_percent" numeric(5,2) NOT NULL DEFAULT 20.00,
  "min_score" numeric(3,1) NOT NULL DEFAULT 1.0,
  "max_score" numeric(3,1) NOT NULL DEFAULT 5.0,
  "applicable_to" character varying(50) NOT NULL DEFAULT 'all',
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  CONSTRAINT "PK_kra_configs" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IDX_kra_configs_school" ON "kra_configs" ("school_id");
CREATE INDEX IF NOT EXISTS "IDX_kra_configs_school_active" ON "kra_configs" ("school_id", "is_active");

ALTER TABLE "staff_appraisals"
  ADD COLUMN IF NOT EXISTS "kra_scores" jsonb,
  ADD COLUMN IF NOT EXISTS "appeal_status" character varying(20) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "appeal_reason" text,
  ADD COLUMN IF NOT EXISTS "appeal_requested_hike" numeric(4,1),
  ADD COLUMN IF NOT EXISTS "appeal_feedback" text,
  ADD COLUMN IF NOT EXISTS "appealed_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "appeal_resolved_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "appeal_resolved_by" integer;

-- 2. Populate Standard School KRA Configs for Every School
DO $$
DECLARE
  r_school RECORD;
  v_count INT;
BEGIN
  FOR r_school IN SELECT id FROM schools LOOP
    SELECT COUNT(*) INTO v_count FROM kra_configs WHERE school_id = r_school.id;
    
    IF v_count = 0 THEN
      INSERT INTO kra_configs (
        school_id, code, title, description, category, weightage_percent, min_score, max_score, applicable_to, sort_order, is_active
      ) VALUES
      (
        r_school.id,
        'curriculum_pedagogy',
        'Curriculum Delivery & Innovative Pedagogy',
        'Lesson plan completion, engaging pedagogy, smart board/digital tool integration, and practical exercises',
        'pedagogy',
        25.00,
        1.0,
        5.0,
        'teaching',
        1,
        true
      ),
      (
        r_school.id,
        'student_outcomes',
        'Student Academic Growth & Exam Outcomes',
        'Class pass percentage, subject mastery, learning curve improvements, and remedial support for struggling students',
        'academics',
        25.00,
        1.0,
        5.0,
        'teaching',
        2,
        true
      ),
      (
        r_school.id,
        'classroom_management',
        'Classroom Culture & Student Discipline',
        'Classroom decorum, student attendance adherence, positive behavioral reinforcement, and inclusive learning atmosphere',
        'administrative',
        20.00,
        1.0,
        5.0,
        'all',
        3,
        true
      ),
      (
        r_school.id,
        'parent_collaboration',
        'Parent Communication & Feedback Index',
        'Regular homework and diary dispatch, proactive PTM participation, prompt query responses, and positive parent satisfaction index',
        'general',
        15.00,
        1.0,
        5.0,
        'all',
        4,
        true
      ),
      (
        r_school.id,
        'professional_conduct',
        'Professional Conduct & School Initiatives',
        'Staff punctuality, participation in annual day/sports/science fairs, collegial mentorship, and professional upskilling',
        'extracurricular',
        15.00,
        1.0,
        5.0,
        'all',
        5,
        true
      );
      
      RAISE NOTICE 'Seeded 5 Standard KRAs for School ID %', r_school.id;
    END IF;
  END LOOP;
END $$;

-- 3. Update existing appraisals with KRA score breakdown snapshot if empty
UPDATE staff_appraisals
SET kra_scores = jsonb_build_array(
  jsonb_build_object(
    'code', 'curriculum_pedagogy',
    'title', 'Curriculum Delivery & Innovative Pedagogy',
    'weightage', 25,
    'score', teaching_effectiveness,
    'remarks', 'Consistent lesson delivery and interactive multimedia presentations.'
  ),
  jsonb_build_object(
    'code', 'student_outcomes',
    'title', 'Student Academic Growth & Exam Outcomes',
    'weightage', 25,
    'score', student_outcomes,
    'remarks', 'Class average improved to 88% with zero failures.'
  ),
  jsonb_build_object(
    'code', 'classroom_management',
    'title', 'Classroom Culture & Student Discipline',
    'weightage', 20,
    'score', classroom_management,
    'remarks', 'Maintains orderly classroom engagement and punctuality.'
  ),
  jsonb_build_object(
    'code', 'parent_collaboration',
    'title', 'Parent Communication & Feedback Index',
    'weightage', 15,
    'score', 4.5,
    'remarks', 'Parents appreciate prompt homework announcements and responsive diary replies.'
  ),
  jsonb_build_object(
    'code', 'professional_conduct',
    'title', 'Professional Conduct & School Initiatives',
    'weightage', 15,
    'score', professional_conduct,
    'remarks', 'Active coordinator for science exhibitions and inter-school quiz.'
  )
)
WHERE kra_scores IS NULL;

SELECT count(*) as total_kra_configs FROM kra_configs;
SELECT count(*) as total_appraisals_updated FROM staff_appraisals WHERE kra_scores IS NOT NULL;
