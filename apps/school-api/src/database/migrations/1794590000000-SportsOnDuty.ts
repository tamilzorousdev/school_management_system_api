import { MigrationInterface, QueryRunner } from 'typeorm';

export class SportsOnDuty1794590000000 implements MigrationInterface {
  name = 'SportsOnDuty1794590000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sports_on_duty" (
        "id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_by" integer,
        "school_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "sport_name" character varying(80) NOT NULL,
        "title" character varying(120) NOT NULL,
        "from_date" date NOT NULL,
        "to_date" date NOT NULL,
        "session" character varying(10),
        "venue" character varying(120),
        "notes" character varying(500),
        CONSTRAINT "PK_sports_on_duty_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sports_on_duty_school_dates" ON "sports_on_duty" ("school_id", "from_date", "to_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sports_on_duty_student_dates" ON "sports_on_duty" ("student_id", "from_date", "to_date")`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE VIEW "student_attendance_days" AS
      SELECT r."school_id", r."student_id", r."date",
             max(r."status") FILTER (WHERE r."period" = 1) AS "morning",
             max(r."status") FILTER (WHERE r."period" = 5) AS "afternoon",
             CASE
               WHEN bool_and(r."status" = 'od') THEN 'od'
               WHEN bool_and(r."status" = 'leave') THEN 'leave'
               WHEN avg(CASE r."status" WHEN 'present' THEN 1 WHEN 'late' THEN 1 WHEN 'od' THEN 1 WHEN 'half_day' THEN 0.5 WHEN 'absent' THEN 0 END) = 1
                 THEN CASE WHEN bool_or(r."status" = 'od') THEN 'od' WHEN bool_or(r."status" = 'late') THEN 'late' ELSE 'present' END
               WHEN avg(CASE r."status" WHEN 'present' THEN 1 WHEN 'late' THEN 1 WHEN 'od' THEN 1 WHEN 'half_day' THEN 0.5 WHEN 'absent' THEN 0 END) = 0
                 THEN 'absent'
               ELSE 'half_day'
             END AS "status"
      FROM "attendance_records" r
      WHERE r."period" IN (1, 5)
      GROUP BY r."school_id", r."student_id", r."date"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_sports_on_duty_student_dates"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_sports_on_duty_school_dates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sports_on_duty"`);
  }
}
