import { MigrationInterface, QueryRunner } from 'typeorm';

const CHECKS: [string, string, string][] = [
  ['fee_plans', 'CHK_fee_plans_amount', `"amount" >= 0`],
  ['fee_invoice_lines', 'CHK_fee_invoice_lines_amount', `"amount" >= 0`],
  [
    'fee_invoices',
    'CHK_fee_invoices_amounts',
    `"gross" >= 0 AND "discount" >= 0 AND "paid" >= 0 AND "balance" >= 0 AND "total" = "gross" - "discount" AND "paid" <= "total"`,
  ],
  ['fee_invoices', 'CHK_fee_invoices_balance', `"status" = 'cancelled' OR "balance" = "total" - "paid"`],
  ['fee_invoices', 'CHK_fee_invoices_status', `"status" IN ('unpaid', 'partly_paid', 'paid', 'cancelled')`],
  ['fee_payments', 'CHK_fee_payments_amount', `"amount" > 0`],
  ['fee_payments', 'CHK_fee_payments_status', `"status" IN ('success', 'reversed')`],
];

export class FeeAuditAndReversal1794680000000 implements MigrationInterface {
  name = 'FeeAuditAndReversal1794680000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "fee_audit_logs" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "entity" character varying(20) NOT NULL, "entity_id" integer, "action" character varying(20) NOT NULL, "before" jsonb, "after" jsonb, "reason" character varying(300), CONSTRAINT "PK_1740082478aa8dae06507afd4cd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_1f9a172eb7fe03817807a47f07" ON "fee_audit_logs" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_fee_audit_logs_created" ON "fee_audit_logs" ("school_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fee_audit_logs_subject" ON "fee_audit_logs" ("school_id", "entity", "entity_id") `,
    );
    await queryRunner.query(`ALTER TABLE "fee_payments" ADD "status" character varying(12) NOT NULL DEFAULT 'success'`);
    await queryRunner.query(`ALTER TABLE "fee_payments" ADD "idempotency_key" character varying(80)`);
    await queryRunner.query(`ALTER TABLE "fee_payments" ADD "reversed_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "fee_payments" ADD "reversed_by" integer`);
    await queryRunner.query(`ALTER TABLE "fee_payments" ADD "reversal_reason" character varying(300)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_fee_payments_school_idempotency" ON "fee_payments" ("school_id", "idempotency_key") WHERE idempotency_key IS NOT NULL`,
    );
    for (const [table, name, check] of CHECKS) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${check}) NOT VALID`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, name] of [...CHECKS].reverse()) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`);
    }
    await queryRunner.query(`DROP INDEX "public"."UQ_fee_payments_school_idempotency"`);
    await queryRunner.query(`ALTER TABLE "fee_payments" DROP COLUMN "reversal_reason"`);
    await queryRunner.query(`ALTER TABLE "fee_payments" DROP COLUMN "reversed_by"`);
    await queryRunner.query(`ALTER TABLE "fee_payments" DROP COLUMN "reversed_at"`);
    await queryRunner.query(`ALTER TABLE "fee_payments" DROP COLUMN "idempotency_key"`);
    await queryRunner.query(`ALTER TABLE "fee_payments" DROP COLUMN "status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fee_audit_logs_subject"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fee_audit_logs_created"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1f9a172eb7fe03817807a47f07"`);
    await queryRunner.query(`DROP TABLE "fee_audit_logs"`);
  }
}
