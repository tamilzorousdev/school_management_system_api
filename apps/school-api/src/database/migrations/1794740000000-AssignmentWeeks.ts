import { MigrationInterface, QueryRunner } from 'typeorm';

export class AssignmentWeeks1794740000000 implements MigrationInterface {
  name = 'AssignmentWeeks1794740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "schools" ADD IF NOT EXISTS "class_periods_per_week" smallint NOT NULL DEFAULT 30`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "teacher_assignment_changes" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "academic_year_id" integer NOT NULL, "section_id" integer NOT NULL, "subject_id" integer NOT NULL, "from_teacher_user_id" integer, "to_teacher_user_id" integer, "from_periods" smallint, "to_periods" smallint, "week_start" date NOT NULL, "changed_by" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_teacher_assignment_changes" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_teacher_assignment_changes_year_week" ON "teacher_assignment_changes" ("school_id", "academic_year_id", "week_start")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "teacher_assignment_changes"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN IF EXISTS "class_periods_per_week"`);
  }
}
