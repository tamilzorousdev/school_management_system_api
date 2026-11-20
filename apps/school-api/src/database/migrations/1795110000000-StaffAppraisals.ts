import { MigrationInterface, QueryRunner } from 'typeorm';

export class StaffAppraisals1795110000000 implements MigrationInterface {
  name = 'StaffAppraisals1795110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "staff_appraisals" (
        "id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_by" integer,
        "school_id" integer NOT NULL,
        "academic_year_id" integer NOT NULL,
        "staff_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "reviewer_user_id" integer NOT NULL,
        "period" character varying(50) NOT NULL,
        "review_date" date NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'draft',
        "teaching_effectiveness" numeric(3,1) NOT NULL DEFAULT 0.0,
        "student_outcomes" numeric(3,1) NOT NULL DEFAULT 0.0,
        "classroom_management" numeric(3,1) NOT NULL DEFAULT 0.0,
        "professional_conduct" numeric(3,1) NOT NULL DEFAULT 0.0,
        "extracurricular_contribution" numeric(3,1) NOT NULL DEFAULT 0.0,
        "overall_score" numeric(3,1) NOT NULL DEFAULT 0.0,
        "overall_rating" character varying(30) NOT NULL DEFAULT 'meets_expectations',
        "strengths" text,
        "areas_for_improvement" text,
        "goals_next_period" text,
        "reviewer_remarks" text,
        "staff_remarks" text,
        "expected_increment_percent" numeric(4,1),
        "hike_justification" text,
        "recommendation" character varying(30) NOT NULL DEFAULT 'increment',
        "increment_percent" numeric(4,1) NOT NULL DEFAULT 0.0,
        "finalized_at" TIMESTAMP WITH TIME ZONE,
        "finalized_by" integer,
        CONSTRAINT "PK_staff_appraisals" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_staff_appraisals_school" ON "staff_appraisals" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_staff_appraisals_school_staff" ON "staff_appraisals" ("school_id", "staff_id")`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_staff_appraisals_user" ON "staff_appraisals" ("user_id")`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_staff_appraisals_school_year" ON "staff_appraisals" ("school_id", "academic_year_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "staff_appraisals"`);
  }
}
