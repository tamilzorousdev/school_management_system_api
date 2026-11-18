import { MigrationInterface, QueryRunner } from 'typeorm';

export class FeeRequestsRefundsLateFees1794710000000 implements MigrationInterface {
  name = 'FeeRequestsRefundsLateFees1794710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "fee_settings" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "grace_days" smallint NOT NULL DEFAULT '0', "late_fee_type" character varying(8) NOT NULL DEFAULT 'none', "late_fee_value" numeric(12,2) NOT NULL DEFAULT '0', "updated_by" integer, CONSTRAINT "CHK_fee_settings_values" CHECK ("grace_days" >= 0 AND "grace_days" <= 90 AND "late_fee_type" IN ('none', 'flat', 'percent') AND "late_fee_value" >= 0 AND ("late_fee_type" <> 'percent' OR "late_fee_value" <= 100)), CONSTRAINT "PK_7250ae05908b1c77e37317b8c23" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_cc59314546abb41651c416cc77" ON "fee_settings" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_fee_settings_school" ON "fee_settings" ("school_id") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "fee_requests" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "kind" character varying(10) NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'pending', "invoice_id" integer NOT NULL, "payment_id" integer NOT NULL DEFAULT '0', "student_id" integer NOT NULL, "amount" numeric(12,2), "details" jsonb NOT NULL DEFAULT '{}', "reason" character varying(300) NOT NULL, "decided_by" integer, "decided_at" TIMESTAMP WITH TIME ZONE, "decision_comment" character varying(300), CONSTRAINT "CHK_fee_requests_status" CHECK ("status" IN ('pending', 'approved', 'rejected', 'withdrawn')), CONSTRAINT "CHK_fee_requests_kind" CHECK ("kind" IN ('discount', 'cancel', 'reversal', 'refund')), CONSTRAINT "PK_f034109e9a1010b91c7f67c4c2c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_7ee1ba1b6deec52147c692052f" ON "fee_requests" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_57a802cc20ec51ffad4f171de4" ON "fee_requests" ("status") `);
    await queryRunner.query(`CREATE INDEX "IDX_c029bc02ce1621bb3398c7918f" ON "fee_requests" ("invoice_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_423b752c718686301f8bb9bbfd" ON "fee_requests" ("student_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_fee_requests_pending" ON "fee_requests" ("school_id", "kind", "invoice_id", "payment_id") WHERE deleted_at IS NULL AND status = 'pending'`,
    );
    await queryRunner.query(
      `CREATE TABLE "fee_refunds" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "refund_no" character varying(30) NOT NULL, "invoice_id" integer NOT NULL, "student_id" integer NOT NULL, "request_id" integer NOT NULL, "amount" numeric(12,2) NOT NULL DEFAULT '0', "mode" character varying(20) NOT NULL, "reference" character varying(60), "paid_on" date NOT NULL, "reason" character varying(300) NOT NULL, "approved_by" integer, CONSTRAINT "CHK_fee_refunds_amount" CHECK ("amount" > 0), CONSTRAINT "PK_00fc51e77e82974b063f32ef77d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_29c92069fbe947317981ba6fcd" ON "fee_refunds" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_48fbcd91c56ae775a799514b0d" ON "fee_refunds" ("invoice_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_85d428682ed0d10c847e2028c7" ON "fee_refunds" ("student_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_184fdd88d2bda7d4b769624450" ON "fee_refunds" ("paid_on") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_fee_refunds_school_no" ON "fee_refunds" ("school_id", "refund_no") `,
    );
    await queryRunner.query(`ALTER TABLE "fee_invoices" ADD "late_fee" numeric(12,2) NOT NULL DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "fee_invoices" ADD "late_fee_applied_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "fee_invoices" ADD "refunded" numeric(12,2) NOT NULL DEFAULT '0'`);
    await queryRunner.query(
      `ALTER TABLE "fee_invoices" ADD CONSTRAINT "CHK_fee_invoices_refunded" CHECK ("refunded" >= 0 AND "refunded" <= "paid" AND "late_fee" >= 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fee_invoices" DROP CONSTRAINT "CHK_fee_invoices_refunded"`);
    await queryRunner.query(`ALTER TABLE "fee_invoices" DROP COLUMN "refunded"`);
    await queryRunner.query(`ALTER TABLE "fee_invoices" DROP COLUMN "late_fee_applied_at"`);
    await queryRunner.query(`ALTER TABLE "fee_invoices" DROP COLUMN "late_fee"`);
    await queryRunner.query(`DROP TABLE "fee_refunds"`);
    await queryRunner.query(`DROP TABLE "fee_requests"`);
    await queryRunner.query(`DROP TABLE "fee_settings"`);
  }
}
