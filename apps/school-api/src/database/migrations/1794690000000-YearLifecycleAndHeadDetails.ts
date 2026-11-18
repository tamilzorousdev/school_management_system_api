import { MigrationInterface, QueryRunner } from 'typeorm';

export class YearLifecycleAndHeadDetails1794690000000 implements MigrationInterface {
  name = 'YearLifecycleAndHeadDetails1794690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "academic_years" ADD "status" character varying(10) NOT NULL DEFAULT 'draft'`);
    await queryRunner.query(`ALTER TABLE "academic_years" ADD "description" character varying(300)`);
    await queryRunner.query(`ALTER TABLE "academic_years" ADD "activated_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "academic_years" ADD "activated_by" integer`);
    await queryRunner.query(`ALTER TABLE "academic_years" ADD "closed_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "academic_years" ADD "closed_by" integer`);
    await queryRunner.query(`ALTER TABLE "academic_years" ADD "archived_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "academic_years" ADD "archived_by" integer`);
    await queryRunner.query(`UPDATE "academic_years" SET "status" = 'active' WHERE "is_current" = true`);
    await queryRunner.query(
      `UPDATE "academic_years" y SET "status" = 'closed'
       WHERE y."is_current" = false
         AND y."end_date" < COALESCE(
           (SELECT c."start_date" FROM "academic_years" c
            WHERE c."school_id" = y."school_id" AND c."is_current" = true AND c."deleted_at" IS NULL LIMIT 1),
           CURRENT_DATE)`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_years" ADD CONSTRAINT "CHK_academic_years_status" CHECK ("status" IN ('draft', 'active', 'closed', 'archived'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_years" ADD CONSTRAINT "CHK_academic_years_current" CHECK ("is_current" = ("status" = 'active'))`,
    );
    await queryRunner.query(`ALTER TABLE "fee_heads" ADD "description" character varying(300)`);
    await queryRunner.query(`ALTER TABLE "fee_heads" ADD "fee_group" character varying(60)`);
    await queryRunner.query(`ALTER TABLE "fee_heads" ADD "is_mandatory" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "fee_heads" ADD "frequency" character varying(12) NOT NULL DEFAULT 'custom'`);
    await queryRunner.query(`ALTER TABLE "fee_heads" ADD "is_refundable" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "fee_heads" ADD "applicable_class_ids" integer array NOT NULL DEFAULT '{}'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fee_heads" DROP COLUMN "applicable_class_ids"`);
    await queryRunner.query(`ALTER TABLE "fee_heads" DROP COLUMN "is_refundable"`);
    await queryRunner.query(`ALTER TABLE "fee_heads" DROP COLUMN "frequency"`);
    await queryRunner.query(`ALTER TABLE "fee_heads" DROP COLUMN "is_mandatory"`);
    await queryRunner.query(`ALTER TABLE "fee_heads" DROP COLUMN "fee_group"`);
    await queryRunner.query(`ALTER TABLE "fee_heads" DROP COLUMN "description"`);
    await queryRunner.query(`ALTER TABLE "academic_years" DROP CONSTRAINT "CHK_academic_years_current"`);
    await queryRunner.query(`ALTER TABLE "academic_years" DROP CONSTRAINT "CHK_academic_years_status"`);
    await queryRunner.query(`ALTER TABLE "academic_years" DROP COLUMN "archived_by"`);
    await queryRunner.query(`ALTER TABLE "academic_years" DROP COLUMN "archived_at"`);
    await queryRunner.query(`ALTER TABLE "academic_years" DROP COLUMN "closed_by"`);
    await queryRunner.query(`ALTER TABLE "academic_years" DROP COLUMN "closed_at"`);
    await queryRunner.query(`ALTER TABLE "academic_years" DROP COLUMN "activated_by"`);
    await queryRunner.query(`ALTER TABLE "academic_years" DROP COLUMN "activated_at"`);
    await queryRunner.query(`ALTER TABLE "academic_years" DROP COLUMN "description"`);
    await queryRunner.query(`ALTER TABLE "academic_years" DROP COLUMN "status"`);
  }
}
