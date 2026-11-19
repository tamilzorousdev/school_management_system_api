import { MigrationInterface, QueryRunner } from 'typeorm';

export class DiarySubmissionsAndGrading1794640000000 implements MigrationInterface {
  name = 'DiarySubmissionsAndGrading1794640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "diary_submissions" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "entry_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "submitted_by" integer,
        "submitted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "is_late" boolean NOT NULL DEFAULT false,
        "student_notes" character varying(1000),
        "status" character varying(25) NOT NULL DEFAULT 'submitted',
        "grade" character varying(10),
        "marks" numeric(5,2),
        "max_marks" numeric(5,2),
        "teacher_feedback" character varying(1000),
        "graded_by" integer,
        "graded_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_diary_submissions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_diary_submissions_entry" FOREIGN KEY ("entry_id") REFERENCES "diary_entries"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_diary_submissions_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_diary_submissions_submitted_by" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_diary_submissions_graded_by" FOREIGN KEY ("graded_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_diary_submissions_entry_student" ON "diary_submissions" ("entry_id", "student_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_diary_submissions_school_entry" ON "diary_submissions" ("school_id", "entry_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_diary_submissions_student" ON "diary_submissions" ("student_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "diary_submission_attachments" (
        "id" SERIAL NOT NULL,
        "submission_id" integer NOT NULL,
        "file_id" integer NOT NULL,
        "sort_order" smallint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_diary_submission_attachments_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_diary_submission_attachments_submission" FOREIGN KEY ("submission_id") REFERENCES "diary_submissions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_diary_submission_attachments_file" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_diary_submission_attachments_submission_file" ON "diary_submission_attachments" ("submission_id", "file_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_diary_submission_attachments_submission" ON "diary_submission_attachments" ("submission_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "diary_submission_attachments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "diary_submissions"`);
  }
}
