import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdvanceOnlineAccountant1794730000000 implements MigrationInterface {
  name = 'AdvanceOnlineAccountant1794730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "fee_payment_orders" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "invoice_id" integer NOT NULL, "student_id" integer NOT NULL, "amount" numeric(12,2) NOT NULL DEFAULT '0', "gateway" character varying(12) NOT NULL DEFAULT 'razorpay', "gateway_order_id" character varying(40) NOT NULL, "gateway_payment_id" character varying(40), "status" character varying(10) NOT NULL DEFAULT 'created', "collection_id" integer, "paid_at" TIMESTAMP WITH TIME ZONE, "failure_reason" character varying(300), CONSTRAINT "CHK_fee_payment_orders" CHECK ("amount" > 0 AND "status" IN ('created', 'paid', 'failed')), CONSTRAINT "PK_c63bcbe4d8a631fea0557a2ac8b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_6e5d8fe4776e7509aeb825c8ed" ON "fee_payment_orders" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_7f3014a80413dcaa4c0d94e6b1" ON "fee_payment_orders" ("invoice_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_a9f2a72687789be8dc5ab5d6a8" ON "fee_payment_orders" ("student_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_59b80508d7a2d75b2c4bdec20e" ON "fee_payment_orders" ("status") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_fee_payment_orders_gateway" ON "fee_payment_orders" ("gateway_order_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "fee_credits" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "kind" character varying(10) NOT NULL, "amount" numeric(12,2) NOT NULL, "collection_id" integer, "payment_id" integer, "invoice_id" integer, CONSTRAINT "CHK_fee_credits_sign" CHECK (("kind" = 'applied' AND "amount" < 0) OR ("kind" <> 'applied' AND "amount" > 0)), CONSTRAINT "CHK_fee_credits_kind" CHECK ("kind" IN ('advance', 'applied', 'returned')), CONSTRAINT "PK_9f565cf32213047caef3a7667b9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_06d78d18ee5c512b37bdd43cfa" ON "fee_credits" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_bd85380dc55d45cb60b9188177" ON "fee_credits" ("student_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_690c59788898f9a04bfec540da" ON "fee_credits" ("payment_id") `);
    await queryRunner.query(
      `CREATE TABLE "fee_collections" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "amount" numeric(12,2) NOT NULL DEFAULT '0', "applied_amount" numeric(12,2) NOT NULL DEFAULT '0', "advance_amount" numeric(12,2) NOT NULL DEFAULT '0', "advance_receipt_no" character varying(30), "mode" character varying(16) NOT NULL, "reference" character varying(200), "paid_on" date NOT NULL, "notes" character varying(300), "idempotency_key" character varying(80), CONSTRAINT "CHK_fee_collections_amounts" CHECK ("amount" > 0 AND "applied_amount" >= 0 AND "advance_amount" >= 0), CONSTRAINT "PK_3ae7d3101901d543c5e1f3412b5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_b4c46fb0ec060f588943410e85" ON "fee_collections" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_7d9e2168b698055b5f34e3f5f5" ON "fee_collections" ("student_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_0f4bc9b2d9b2300888cbba806f" ON "fee_collections" ("paid_on") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_fee_collections_idempotency" ON "fee_collections" ("school_id", "idempotency_key") WHERE idempotency_key IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "transfer_certificates" ADD "fee_balance" numeric(12,2) NOT NULL DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "fee_payments" ADD "collection_id" integer`);
    await queryRunner.query(`CREATE INDEX "IDX_b04af5a57e8db5f40507271c5a" ON "fee_payments" ("collection_id") `);
    await queryRunner.query(`ALTER TABLE "fee_requests" DROP CONSTRAINT "CHK_fee_requests_kind"`);
    await queryRunner.query(
      `ALTER TABLE "fee_requests" ADD CONSTRAINT "CHK_fee_requests_kind" CHECK ("kind" IN ('discount', 'cancel', 'reversal', 'refund', 'reschedule', 'write_off'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "fee_requests" WHERE "kind" = 'write_off'`);
    await queryRunner.query(`ALTER TABLE "fee_requests" DROP CONSTRAINT "CHK_fee_requests_kind"`);
    await queryRunner.query(
      `ALTER TABLE "fee_requests" ADD CONSTRAINT "CHK_fee_requests_kind" CHECK ("kind" IN ('discount', 'cancel', 'reversal', 'refund', 'reschedule'))`,
    );
    await queryRunner.query(`ALTER TABLE "fee_payments" DROP COLUMN "collection_id"`);
    await queryRunner.query(`ALTER TABLE "transfer_certificates" DROP COLUMN "fee_balance"`);
    await queryRunner.query(`DROP TABLE "fee_collections"`);
    await queryRunner.query(`DROP TABLE "fee_credits"`);
    await queryRunner.query(`DROP TABLE "fee_payment_orders"`);
  }
}
