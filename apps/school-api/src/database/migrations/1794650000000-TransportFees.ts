import { MigrationInterface, QueryRunner } from 'typeorm';

export class TransportFees1794650000000 implements MigrationInterface {
  name = 'TransportFees1794650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transport_routes" ADD "monthly_fee" numeric(10,2) NOT NULL DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "route_stops" ALTER COLUMN "monthly_fee" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "route_stops" ALTER COLUMN "monthly_fee" DROP DEFAULT`);
    await queryRunner.query(`UPDATE "route_stops" SET "monthly_fee" = NULL WHERE "monthly_fee" = 0`);
    await queryRunner.query(`ALTER TABLE "fee_invoice_lines" ADD "kind" character varying(24) NOT NULL DEFAULT 'plan'`);
    await queryRunner.query(`ALTER TABLE "fee_invoice_lines" ADD "route_id" integer`);
    await queryRunner.query(`ALTER TABLE "fee_invoice_lines" ADD "stop_id" integer`);
    await queryRunner.query(`ALTER TABLE "fee_invoice_lines" ADD "drop_stop_id" integer`);
    await queryRunner.query(`ALTER TABLE "fee_invoice_lines" ADD "monthly_rate" numeric(12,2)`);
    await queryRunner.query(`ALTER TABLE "fee_invoice_lines" ADD "months" smallint`);
    await queryRunner.query(
      `UPDATE "fee_invoice_lines" l SET "kind" = 'transport' FROM "fee_heads" h WHERE h.id = l.fee_head_id AND h.is_transport = true`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fee_invoice_lines_transport" ON "fee_invoice_lines" ("route_id", "stop_id") WHERE kind = 'transport'`,
    );
    await queryRunner.query(
      `CREATE TABLE "transport_fee_adjustments" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "invoice_id" integer NOT NULL, "amount" numeric(12,2) NOT NULL, "reason" character varying(160) NOT NULL, "applied_invoice_id" integer, CONSTRAINT "PK_transport_fee_adjustments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_transport_fee_adjustments_school" ON "transport_fee_adjustments" ("school_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_transport_fee_adjustments_pending" ON "transport_fee_adjustments" ("school_id", "student_id") WHERE applied_invoice_id IS NULL AND deleted_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_transport_fee_adjustments_pending"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_transport_fee_adjustments_school"`);
    await queryRunner.query(`DROP TABLE "transport_fee_adjustments"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fee_invoice_lines_transport"`);
    await queryRunner.query(`ALTER TABLE "fee_invoice_lines" DROP COLUMN "months"`);
    await queryRunner.query(`ALTER TABLE "fee_invoice_lines" DROP COLUMN "monthly_rate"`);
    await queryRunner.query(`ALTER TABLE "fee_invoice_lines" DROP COLUMN "drop_stop_id"`);
    await queryRunner.query(`ALTER TABLE "fee_invoice_lines" DROP COLUMN "stop_id"`);
    await queryRunner.query(`ALTER TABLE "fee_invoice_lines" DROP COLUMN "route_id"`);
    await queryRunner.query(`ALTER TABLE "fee_invoice_lines" DROP COLUMN "kind"`);
    await queryRunner.query(`UPDATE "route_stops" SET "monthly_fee" = 0 WHERE "monthly_fee" IS NULL`);
    await queryRunner.query(`ALTER TABLE "route_stops" ALTER COLUMN "monthly_fee" SET DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "route_stops" ALTER COLUMN "monthly_fee" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "transport_routes" DROP COLUMN "monthly_fee"`);
  }
}
