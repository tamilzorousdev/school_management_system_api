import { MigrationInterface, QueryRunner } from 'typeorm';

export class SchoolEvents1794750000000 implements MigrationInterface {
  name = 'SchoolEvents1794750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "school_events" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "academic_year_id" integer NOT NULL, "title" character varying(150) NOT NULL, "description" character varying(4000), "event_date" date NOT NULL, "start_time" character varying(5), "end_time" character varying(5), "venue" character varying(150), "audience" character varying(10) NOT NULL DEFAULT 'school', "rsvp_required" boolean NOT NULL DEFAULT true, "rsvp_deadline" TIMESTAMP WITH TIME ZONE, "status" character varying(10) NOT NULL DEFAULT 'draft', "published_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancel_reason" character varying(300), "day_before_sent_at" TIMESTAMP WITH TIME ZONE, "deadline_reminder_sent_at" TIMESTAMP WITH TIME ZONE, "day_of_sent_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_school_events" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_school_events_school" ON "school_events" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_school_events_school_year_date" ON "school_events" ("school_id", "academic_year_id", "event_date") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "event_targets" ("id" SERIAL NOT NULL, "event_id" integer NOT NULL, "class_id" integer, "section_id" integer, CONSTRAINT "PK_event_targets" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_event_targets_event" ON "event_targets" ("event_id") `);
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "event_rsvps" ("id" SERIAL NOT NULL, "event_id" integer NOT NULL, "student_id" integer NOT NULL, "response" character varying(15) NOT NULL, "responded_by" integer NOT NULL, "responded_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_event_rsvps" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_event_rsvps_event" ON "event_rsvps" ("event_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_event_rsvps_student" ON "event_rsvps" ("event_id", "student_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "event_rsvps"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "event_targets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "school_events"`);
  }
}
