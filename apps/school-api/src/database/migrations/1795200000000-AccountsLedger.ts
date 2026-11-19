import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountsLedger1795200000000 implements MigrationInterface {
  name = 'AccountsLedger1795200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "account_entries" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "kind" character varying(10) NOT NULL, "entry_no" character varying(40) NOT NULL, "category_id" integer NOT NULL, "entry_date" date NOT NULL, "amount" numeric(12,2) NOT NULL, "payment_mode" character varying(15) NOT NULL DEFAULT 'cash', "party" character varying(120), "reference" character varying(60), "file_id" integer, "note" character varying(500), "status" character varying(10) NOT NULL DEFAULT 'pending', "decided_by" integer, "decided_at" TIMESTAMP WITH TIME ZONE, "decision_note" character varying(300), CONSTRAINT "CHK_account_entries_status" CHECK ("status" IN ('pending', 'approved', 'rejected', 'void')), CONSTRAINT "CHK_account_entries_kind" CHECK ("kind" IN ('expense', 'income')), CONSTRAINT "CHK_account_entries_amount" CHECK ("amount" > 0), CONSTRAINT "PK_4378c8454b064f22303906c5da4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_a960be19b6370c89fa941f57ac" ON "account_entries" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_account_entries_school_no" ON "account_entries" ("school_id", "entry_no") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_account_entries_school_kind_date" ON "account_entries" ("school_id", "kind", "entry_date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "account_categories" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "kind" character varying(10) NOT NULL, "name" character varying(60) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "sort_order" smallint NOT NULL DEFAULT '0', CONSTRAINT "CHK_account_categories_kind" CHECK ("kind" IN ('expense', 'income')), CONSTRAINT "PK_af654c97c640c652fbecee94152" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_1d09d44d6a8cf7e5421a11badf" ON "account_categories" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_account_categories_school_kind_name" ON "account_categories" ("school_id", "kind", "name") WHERE deleted_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_account_categories_school_kind_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1d09d44d6a8cf7e5421a11badf"`);
    await queryRunner.query(`DROP TABLE "account_categories"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_account_entries_school_kind_date"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_account_entries_school_no"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a960be19b6370c89fa941f57ac"`);
    await queryRunner.query(`DROP TABLE "account_entries"`);
  }
}
