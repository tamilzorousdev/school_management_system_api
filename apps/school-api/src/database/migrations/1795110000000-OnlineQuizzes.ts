import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE = `"id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL`;

export class OnlineQuizzes1795110000000 implements MigrationInterface {
  name = 'OnlineQuizzes1795110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "online_quizzes" (${BASE}, "academic_year_id" integer NOT NULL, "subject_id" integer NOT NULL, "section_id" integer NOT NULL, "teacher_user_id" integer NOT NULL, "title" character varying(150) NOT NULL, "description" text, "instructions" text, "total_marks" numeric(6,2) NOT NULL DEFAULT 0, "pass_marks" numeric(6,2) NOT NULL DEFAULT 0, "duration_minutes" integer NOT NULL DEFAULT 30, "start_at" TIMESTAMP WITH TIME ZONE NOT NULL, "end_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'draft', "approved_by_user_id" integer, "approved_at" TIMESTAMP WITH TIME ZONE, "rejection_reason" text, CONSTRAINT "PK_online_quizzes" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_online_quizzes_school" ON "online_quizzes" ("school_id")`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_online_quizzes_section" ON "online_quizzes" ("school_id", "section_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_online_quizzes_teacher" ON "online_quizzes" ("school_id", "teacher_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_online_quizzes_status" ON "online_quizzes" ("school_id", "status")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "quiz_questions" ("id" SERIAL NOT NULL, "quiz_id" integer NOT NULL, "sequence" integer NOT NULL DEFAULT 1, "question_text" text NOT NULL, "options" jsonb NOT NULL, "correct_option" character varying(10) NOT NULL, "explanation" text, "marks" numeric(5,2) NOT NULL DEFAULT 1, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_quiz_questions" PRIMARY KEY ("id"), CONSTRAINT "FK_quiz_questions_quiz" FOREIGN KEY ("quiz_id") REFERENCES "online_quizzes"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_quiz_questions_quiz" ON "quiz_questions" ("quiz_id")`);

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "quiz_submissions" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "quiz_id" integer NOT NULL, "student_id" integer NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'in_progress', "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "submitted_at" TIMESTAMP WITH TIME ZONE, "auto_submitted" boolean NOT NULL DEFAULT false, "score" numeric(6,2) DEFAULT 0, "total_marks" numeric(6,2) NOT NULL DEFAULT 0, "percentage" numeric(5,2) DEFAULT 0, "passed" boolean DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_quiz_submissions" PRIMARY KEY ("id"), CONSTRAINT "FK_quiz_submissions_quiz" FOREIGN KEY ("quiz_id") REFERENCES "online_quizzes"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_quiz_submissions_quiz_student" ON "quiz_submissions" ("quiz_id", "student_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_quiz_submissions_student" ON "quiz_submissions" ("school_id", "student_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "quiz_answers" ("id" SERIAL NOT NULL, "submission_id" integer NOT NULL, "question_id" integer NOT NULL, "selected_option" character varying(10), "is_correct" boolean NOT NULL DEFAULT false, "marks_awarded" numeric(5,2) NOT NULL DEFAULT 0, "answered_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_quiz_answers" PRIMARY KEY ("id"), CONSTRAINT "FK_quiz_answers_submission" FOREIGN KEY ("submission_id") REFERENCES "quiz_submissions"("id") ON DELETE CASCADE, CONSTRAINT "FK_quiz_answers_question" FOREIGN KEY ("question_id") REFERENCES "quiz_questions"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_quiz_answers_sub_q" ON "quiz_answers" ("submission_id", "question_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "quiz_answers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quiz_submissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quiz_questions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "online_quizzes"`);
  }
}
