import { MigrationInterface, QueryRunner } from 'typeorm';

export class HostelSafety1795680000000 implements MigrationInterface {
  name = 'HostelSafety1795680000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "hostel_sos_events" (
        "id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_by" integer,
        "school_id" integer NOT NULL,
        "sos_no" character varying(40) NOT NULL,
        "hostel_id" integer NOT NULL,
        "kind" character varying(20) NOT NULL,
        "message" character varying(500) NOT NULL,
        "admission_id" integer,
        "is_drill" boolean NOT NULL DEFAULT false,
        "notify_parents" boolean NOT NULL DEFAULT false,
        "status" character varying(10) NOT NULL DEFAULT 'open',
        "resolved_by" integer,
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        "resolution" character varying(500),
        CONSTRAINT "PK_hostel_sos_events_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_hostel_sos_events_school_id" ON "hostel_sos_events" ("school_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_sos_events_status" ON "hostel_sos_events" ("school_id", "hostel_id", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_sos_events_no" ON "hostel_sos_events" ("school_id", "sos_no") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_sos_marks" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "sos_id" integer NOT NULL,
        "admission_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "status" character varying(8) NOT NULL,
        "marked_by" integer,
        "marked_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_hostel_sos_marks_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_sos_marks_admission" ON "hostel_sos_marks" ("sos_id", "admission_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_rule_acks" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "admission_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "rules_hash" character varying(64) NOT NULL,
        "acknowledged_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_hostel_rule_acks_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_rule_acks_version" ON "hostel_rule_acks" ("admission_id", "user_id", "rules_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "hostel_rule_acks"`);
    await queryRunner.query(`DROP TABLE "hostel_sos_marks"`);
    await queryRunner.query(`DROP TABLE "hostel_sos_events"`);
  }
}
