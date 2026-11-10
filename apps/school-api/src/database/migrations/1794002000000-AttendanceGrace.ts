import { MigrationInterface, QueryRunner } from 'typeorm';

export class AttendanceGrace1794002000000 implements MigrationInterface {
  name = 'AttendanceGrace1794002000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "attendance_grace_minutes" smallint NOT NULL DEFAULT 15`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attendance_alerts" (
        "id" SERIAL PRIMARY KEY,
        "school_id" int NOT NULL,
        "section_id" int NOT NULL,
        "date" date NOT NULL,
        "period" smallint NOT NULL,
        "kind" varchar(10) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_attendance_alerts" UNIQUE ("section_id", "date", "period", "kind")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_attendance_alerts_school_date" ON "attendance_alerts" ("school_id", "date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "attendance_alerts"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN IF EXISTS "attendance_grace_minutes"`);
  }
}
