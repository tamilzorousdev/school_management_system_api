import { MigrationInterface, QueryRunner } from 'typeorm';

export class BusPasses1794730000000 implements MigrationInterface {
  name = 'BusPasses1794730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "bus_passes" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "academic_year_id" integer NOT NULL, "pass_no" character varying(30) NOT NULL, "issued_at" TIMESTAMP WITH TIME ZONE, "valid_from" date NOT NULL, "valid_until" date NOT NULL, CONSTRAINT "PK_bus_passes" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_bus_passes_school" ON "bus_passes" ("school_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bus_passes_student_year" ON "bus_passes" ("student_id", "academic_year_id") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bus_passes_number" ON "bus_passes" ("school_id", "pass_no") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "bus_pass_settings" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "grace_days" integer NOT NULL DEFAULT 7, "valid_until" date, "updated_by" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_bus_pass_settings" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bus_pass_settings_school" ON "bus_pass_settings" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "bus_fee_reminders" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "invoice_id" integer NOT NULL, "kind" character varying(16) NOT NULL, "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_bus_fee_reminders" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bus_fee_reminders_invoice_kind" ON "bus_fee_reminders" ("invoice_id", "kind")`,
    );
    await queryRunner.query(`ALTER TABLE "student_transport" ADD IF NOT EXISTS "hold_kind" character varying(8)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "student_transport" DROP COLUMN IF EXISTS "hold_kind"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bus_fee_reminders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bus_pass_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bus_passes"`);
  }
}
