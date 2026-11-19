import { MigrationInterface, QueryRunner } from 'typeorm';

const OLD_AMOUNTS = `"gross" >= 0 AND "discount" >= 0 AND "paid" >= 0 AND "balance" >= 0 AND "total" = "gross" - "discount" AND "paid" <= "total"`;
const NEW_AMOUNTS = `"gross" >= 0 AND "benefit" >= 0 AND "discount" >= 0 AND "paid" >= 0 AND "balance" >= 0 AND "total" = "gross" - "benefit" - "discount" AND "paid" <= "total"`;

export class FeePlanApprovalsAndBenefits1794700000000 implements MigrationInterface {
  name = 'FeePlanApprovalsAndBenefits1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "fee_plan_versions" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "academic_year_id" integer NOT NULL, "class_id" integer NOT NULL, "version" integer NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'draft', "lines" jsonb NOT NULL DEFAULT '[]', "note" character varying(300), "submitted_by" integer, "submitted_at" TIMESTAMP WITH TIME ZONE, "reviewed_by" integer, "reviewed_at" TIMESTAMP WITH TIME ZONE, "review_comment" character varying(300), "published_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_fee_plan_versions_status" CHECK ("status" IN ('draft', 'pending_approval', 'published', 'superseded')), CONSTRAINT "PK_290ae5ea47fe6f1b03ab691c086" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_6f3a271d56bc0ab8e29cd1f1fe" ON "fee_plan_versions" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_dfe06ca3aa7d31701b1f5bb3a0" ON "fee_plan_versions" ("class_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_146c828f6dda3f015cb33c5754" ON "fee_plan_versions" ("status") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_fee_plan_versions_published" ON "fee_plan_versions" ("school_id", "academic_year_id", "class_id") WHERE deleted_at IS NULL AND status = 'published'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_fee_plan_versions_open" ON "fee_plan_versions" ("school_id", "academic_year_id", "class_id") WHERE deleted_at IS NULL AND status IN ('draft', 'pending_approval')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_fee_plan_versions_number" ON "fee_plan_versions" ("school_id", "academic_year_id", "class_id", "version") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `INSERT INTO "fee_plan_versions" ("school_id", "academic_year_id", "class_id", "version", "status", "lines", "published_at")
       SELECT p."school_id", p."academic_year_id", p."class_id", 1, 'published',
              jsonb_agg(jsonb_build_object('fee_head_id', p."fee_head_id", 'installment', p."installment",
                'amount', p."amount", 'due_date', to_char(p."due_date", 'YYYY-MM-DD')) ORDER BY p."due_date", p."id"),
              max(p."updated_at")
       FROM "fee_plans" p WHERE p."deleted_at" IS NULL
       GROUP BY p."school_id", p."academic_year_id", p."class_id"`,
    );
    await queryRunner.query(
      `CREATE TABLE "fee_benefits" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "academic_year_id" integer NOT NULL, "kind" character varying(12) NOT NULL, "name" character varying(80) NOT NULL, "type" character varying(20) NOT NULL, "calc_type" character varying(8) NOT NULL, "value" numeric(12,2) NOT NULL DEFAULT '0', "fee_head_ids" integer array NOT NULL DEFAULT '{}', "class_ids" integer array NOT NULL DEFAULT '{}', "description" character varying(300), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "CHK_fee_benefits_value" CHECK ("value" > 0 AND "calc_type" IN ('percent', 'fixed') AND ("calc_type" = 'fixed' OR "value" <= 100)), CONSTRAINT "CHK_fee_benefits_kind" CHECK ("kind" IN ('concession', 'scholarship')), CONSTRAINT "PK_0abf5054fd04026abe0df2ebde4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_b429b6d99df638cda2baf819c8" ON "fee_benefits" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_e718b4eac7d25d3344d5eb848d" ON "fee_benefits" ("academic_year_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_fee_benefits_name" ON "fee_benefits" ("school_id", "academic_year_id", "kind", "name") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "student_fee_benefits" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "benefit_id" integer NOT NULL, "academic_year_id" integer NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'active', "reason" character varying(300), "revoked_at" TIMESTAMP WITH TIME ZONE, "revoked_by" integer, "revoke_reason" character varying(300), CONSTRAINT "CHK_student_fee_benefits_status" CHECK ("status" IN ('active', 'revoked')), CONSTRAINT "PK_2a79530b80ec5583304389b1332" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_1474b21a3dcb42c4c7982449c2" ON "student_fee_benefits" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_1fa7fe811a5dc33c6434517721" ON "student_fee_benefits" ("student_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_59bf54b517a093c3fb30e662ad" ON "student_fee_benefits" ("benefit_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_14df26d8643d5c1d23b81bb6b7" ON "student_fee_benefits" ("academic_year_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_student_fee_benefits_active" ON "student_fee_benefits" ("benefit_id", "student_id") WHERE deleted_at IS NULL AND status = 'active'`,
    );
    await queryRunner.query(
      `CREATE TABLE "fee_invoice_benefits" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "invoice_id" integer NOT NULL, "award_id" integer NOT NULL, "benefit_id" integer NOT NULL, "kind" character varying(12) NOT NULL, "name" character varying(80) NOT NULL, "fee_head_id" integer, "amount" numeric(12,2) NOT NULL DEFAULT '0', CONSTRAINT "CHK_fee_invoice_benefits_amount" CHECK ("amount" > 0), CONSTRAINT "PK_6fc8197b248486bd9f47698cf85" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_e436eb564a0049c62161ed3f64" ON "fee_invoice_benefits" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_391bb84df4fa893a936858d975" ON "fee_invoice_benefits" ("invoice_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_d1268a9cbd52517fa1bc5fb492" ON "fee_invoice_benefits" ("award_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_63831053cf3f4c2c845282e24e" ON "fee_invoice_benefits" ("benefit_id") `);
    await queryRunner.query(`ALTER TABLE "fee_invoices" ADD "benefit" numeric(12,2) NOT NULL DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "fee_invoices" DROP CONSTRAINT IF EXISTS "CHK_fee_invoices_amounts"`);
    await queryRunner.query(
      `ALTER TABLE "fee_invoices" ADD CONSTRAINT "CHK_fee_invoices_amounts" CHECK (${NEW_AMOUNTS}) NOT VALID`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fee_invoices" DROP CONSTRAINT IF EXISTS "CHK_fee_invoices_amounts"`);
    await queryRunner.query(
      `UPDATE "fee_invoices" SET "discount" = "discount" + "benefit", "benefit" = 0 WHERE "benefit" > 0`,
    );
    await queryRunner.query(`ALTER TABLE "fee_invoices" DROP COLUMN "benefit"`);
    await queryRunner.query(
      `ALTER TABLE "fee_invoices" ADD CONSTRAINT "CHK_fee_invoices_amounts" CHECK (${OLD_AMOUNTS}) NOT VALID`,
    );
    await queryRunner.query(`DROP TABLE "fee_invoice_benefits"`);
    await queryRunner.query(`DROP TABLE "student_fee_benefits"`);
    await queryRunner.query(`DROP TABLE "fee_benefits"`);
    await queryRunner.query(`DROP TABLE "fee_plan_versions"`);
  }
}
