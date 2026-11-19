import { MigrationInterface, QueryRunner } from 'typeorm';

export class FeeFines1795067052745 implements MigrationInterface {
  name = 'FeeFines1795067052745';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "fee_fine_types" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(80) NOT NULL, "default_amount" numeric(12,2) NOT NULL DEFAULT '0', "description" character varying(300), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "CHK_fee_fine_types_amount" CHECK ("default_amount" > 0), CONSTRAINT "PK_1c0b9393c6e7021352429b82b3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_f0f7537b13e481bf8b309dc268" ON "fee_fine_types" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_fee_fine_types_name" ON "fee_fine_types" ("school_id", "name") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "fee_fines" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "fine_no" character varying(30) NOT NULL, "academic_year_id" integer NOT NULL, "student_id" integer NOT NULL, "fine_type_id" integer, "title" character varying(120) NOT NULL, "amount" numeric(12,2) NOT NULL DEFAULT '0', "incident_on" date NOT NULL, "details" character varying(1000), "status" character varying(10) NOT NULL DEFAULT 'pending', "behaviour_note_id" integer, "invoice_id" integer, "decided_by" integer, "decided_at" TIMESTAMP WITH TIME ZONE, "decision_comment" character varying(300), CONSTRAINT "CHK_fee_fines_status" CHECK ("status" IN ('pending', 'approved', 'rejected', 'withdrawn')), CONSTRAINT "CHK_fee_fines_amount" CHECK ("amount" > 0), CONSTRAINT "PK_54f43757fb18c483d80d19bdb78" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_fa6d83be06ea80837090bc68e9" ON "fee_fines" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_bffe57ad938ead246bdceb08f0" ON "fee_fines" ("academic_year_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_858d0edefb9d54f7a750dd13e9" ON "fee_fines" ("student_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_65913d4e5d9165915b90541816" ON "fee_fines" ("status") `);
    await queryRunner.query(`CREATE INDEX "IDX_c0d0069004ae5c21cc46d5f654" ON "fee_fines" ("invoice_id") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_fee_fines_school_no" ON "fee_fines" ("school_id", "fine_no") `);
    await queryRunner.query(`ALTER TABLE "fee_invoices" ADD "kind" character varying(6) NOT NULL DEFAULT 'fee'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fee_invoices" DROP COLUMN "kind"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_fee_fines_school_no"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c0d0069004ae5c21cc46d5f654"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_65913d4e5d9165915b90541816"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_858d0edefb9d54f7a750dd13e9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_bffe57ad938ead246bdceb08f0"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fa6d83be06ea80837090bc68e9"`);
    await queryRunner.query(`DROP TABLE "fee_fines"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_fee_fine_types_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f0f7537b13e481bf8b309dc268"`);
    await queryRunner.query(`DROP TABLE "fee_fine_types"`);
  }
}
