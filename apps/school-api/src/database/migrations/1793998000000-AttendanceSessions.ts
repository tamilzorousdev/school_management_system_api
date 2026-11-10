import { MigrationInterface, QueryRunner } from 'typeorm';

export class AttendanceSessions1793998000000 implements MigrationInterface {
  name = 'AttendanceSessions1793998000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "attendance_sessions" s
      WHERE s."period" = 0
        AND EXISTS (SELECT 1 FROM "attendance_sessions" o
                    WHERE o."section_id" = s."section_id" AND o."date" = s."date" AND o."period" = 1)
    `);
    await queryRunner.query(`UPDATE "attendance_sessions" SET "period" = 1 WHERE "period" = 0`);
    await queryRunner.query(`UPDATE "attendance_records" SET "period" = 1 WHERE "period" = 0`);
    await queryRunner.query(`
      CREATE OR REPLACE VIEW "student_attendance_days" AS
      SELECT r."school_id", r."student_id", r."date",
             max(r."status") FILTER (WHERE r."period" = 1) AS "morning",
             max(r."status") FILTER (WHERE r."period" = 5) AS "afternoon",
             CASE
               WHEN bool_and(r."status" = 'leave') THEN 'leave'
               WHEN avg(CASE r."status" WHEN 'present' THEN 1 WHEN 'late' THEN 1 WHEN 'half_day' THEN 0.5 WHEN 'absent' THEN 0 END) = 1
                 THEN CASE WHEN bool_or(r."status" = 'late') THEN 'late' ELSE 'present' END
               WHEN avg(CASE r."status" WHEN 'present' THEN 1 WHEN 'late' THEN 1 WHEN 'half_day' THEN 0.5 WHEN 'absent' THEN 0 END) = 0
                 THEN 'absent'
               ELSE 'half_day'
             END AS "status"
      FROM "attendance_records" r
      WHERE r."period" IN (1, 5)
      GROUP BY r."school_id", r."student_id", r."date"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS "student_attendance_days"`);
    await queryRunner.query(`DELETE FROM "attendance_sessions" WHERE "period" = 5`);
    await queryRunner.query(`UPDATE "attendance_records" SET "period" = 0 WHERE "period" = 1`);
    await queryRunner.query(`UPDATE "attendance_sessions" SET "period" = 0 WHERE "period" = 1`);
  }
}
