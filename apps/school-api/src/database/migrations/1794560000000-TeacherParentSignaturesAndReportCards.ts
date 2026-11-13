import { MigrationInterface, QueryRunner } from 'typeorm';

export class TeacherParentSignaturesAndReportCards1794560000000 implements MigrationInterface {
  name = 'TeacherParentSignaturesAndReportCards1794560000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "signature_file_id" integer`);
    await queryRunner.query(`ALTER TABLE "guardians" ADD COLUMN IF NOT EXISTS "signature_file_id" integer`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signature_file_id" integer`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "report_card_signatures" (
        "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        "school_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "academic_year_id" integer NOT NULL,
        "term_id" integer,
        "exam_id" integer,
        "teacher_user_id" integer,
        "teacher_signature_file_id" integer,
        "teacher_signed_at" timestamptz,
        "parent_user_id" integer,
        "parent_signature_file_id" integer,
        "parent_signed_at" timestamptz,
        "created_by" integer,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      )
    `);
    await queryRunner.query(`ALTER TABLE "report_card_signatures" ADD COLUMN IF NOT EXISTS "created_by" integer`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_rc_sig_school_student" ON "report_card_signatures" ("school_id", "student_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_rc_sig_scope" ON "report_card_signatures" ("student_id", "academic_year_id", (coalesce("term_id", 0)), (coalesce("exam_id", 0))) WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "report_card_signatures"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "signature_file_id"`);
    await queryRunner.query(`ALTER TABLE "guardians" DROP COLUMN IF EXISTS "signature_file_id"`);
    await queryRunner.query(`ALTER TABLE "staff" DROP COLUMN IF EXISTS "signature_file_id"`);
  }
}
