import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlumniEmisNumber1795530000000 implements MigrationInterface {
  name = 'AlumniEmisNumber1795530000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "alumni" ADD COLUMN IF NOT EXISTS "emis_number" varchar(50)`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_alumni_school_emis" ON "alumni" ("school_id", "emis_number") WHERE "deleted_at" IS NULL AND "emis_number" IS NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "alumni" a SET "emis_number" = s."emis_number"
       FROM "students" s
       WHERE s."id" = a."student_id" AND a."emis_number" IS NULL AND s."emis_number" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_alumni_school_emis"`);
    await queryRunner.query(`ALTER TABLE "alumni" DROP COLUMN IF EXISTS "emis_number"`);
  }
}
