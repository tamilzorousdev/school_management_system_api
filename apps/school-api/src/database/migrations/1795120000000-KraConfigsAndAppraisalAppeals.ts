import { MigrationInterface, QueryRunner } from 'typeorm';

export class KraConfigsAndAppraisalAppeals1795120000000 implements MigrationInterface {
  name = 'KraConfigsAndAppraisalAppeals1795120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "kra_configs" (
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
      )`,
    );

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kra_configs_school" ON "kra_configs" ("school_id")`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kra_configs_school_active" ON "kra_configs" ("school_id", "is_active")`,
    );

    await queryRunner.query(
      `ALTER TABLE "staff_appraisals"
       ADD COLUMN IF NOT EXISTS "kra_scores" jsonb,
       ADD COLUMN IF NOT EXISTS "appeal_status" character varying(20) NOT NULL DEFAULT 'none',
       ADD COLUMN IF NOT EXISTS "appeal_reason" text,
       ADD COLUMN IF NOT EXISTS "appeal_requested_hike" numeric(4,1),
       ADD COLUMN IF NOT EXISTS "appeal_feedback" text,
       ADD COLUMN IF NOT EXISTS "appealed_at" TIMESTAMP WITH TIME ZONE,
       ADD COLUMN IF NOT EXISTS "appeal_resolved_at" TIMESTAMP WITH TIME ZONE,
       ADD COLUMN IF NOT EXISTS "appeal_resolved_by" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "staff_appraisals"
       DROP COLUMN IF EXISTS "kra_scores",
       DROP COLUMN IF EXISTS "appeal_status",
       DROP COLUMN IF EXISTS "appeal_reason",
       DROP COLUMN IF EXISTS "appeal_requested_hike",
       DROP COLUMN IF EXISTS "appeal_feedback",
       DROP COLUMN IF EXISTS "appealed_at",
       DROP COLUMN IF EXISTS "appeal_resolved_at",
       DROP COLUMN IF EXISTS "appeal_resolved_by"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "kra_configs"`);
  }
}
