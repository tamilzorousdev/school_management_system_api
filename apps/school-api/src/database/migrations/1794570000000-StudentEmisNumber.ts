import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentEmisNumber1794570000000 implements MigrationInterface {
  name = 'StudentEmisNumber1794570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "emis_number" varchar(50)`);
    await queryRunner.query(`ALTER TABLE "admissions" ADD COLUMN IF NOT EXISTS "emis_number" varchar(50)`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_students_school_emis" ON "students" ("school_id", "emis_number") WHERE "deleted_at" IS NULL AND "emis_number" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_students_school_emis"`);
    await queryRunner.query(`ALTER TABLE "admissions" DROP COLUMN IF EXISTS "emis_number"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "emis_number"`);
  }
}
