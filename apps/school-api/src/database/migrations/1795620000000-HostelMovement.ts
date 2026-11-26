import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE = `"id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_by" integer,
        "school_id" integer NOT NULL`;

export class HostelMovement1795620000000 implements MigrationInterface {
  name = 'HostelMovement1795620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "hostel_roll_calls" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "hostel_id" integer NOT NULL,
        "roll_date" date NOT NULL,
        "slot" character varying(10) NOT NULL,
        "started_by" integer,
        "finished_by" integer,
        "finished_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hostel_roll_calls_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_roll_calls_slot" ON "hostel_roll_calls" ("school_id", "hostel_id", "roll_date", "slot")`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_roll_call_records" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "roll_call_id" integer NOT NULL,
        "admission_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "status" character varying(10) NOT NULL,
        "method" character varying(8) NOT NULL DEFAULT 'manual',
        "note" character varying(255),
        "marked_by" integer,
        "marked_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "parent_notified_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_hostel_roll_call_records_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_roll_call_records_admission" ON "hostel_roll_call_records" ("roll_call_id", "admission_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_roll_call_records_student" ON "hostel_roll_call_records" ("school_id", "student_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_leaves" (
        ${BASE},
        "leave_no" character varying(40) NOT NULL,
        "admission_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "hostel_id" integer NOT NULL,
        "kind" character varying(10) NOT NULL,
        "from_date" date NOT NULL,
        "to_date" date NOT NULL,
        "depart_time" character varying(5),
        "return_time" character varying(5),
        "expected_return_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "reason" character varying(500) NOT NULL,
        "source" character varying(10) NOT NULL,
        "status" character varying(16) NOT NULL,
        "consent_status" character varying(10) NOT NULL DEFAULT 'not_needed',
        "consent_by" integer,
        "consent_at" TIMESTAMP WITH TIME ZONE,
        "escort_name" character varying(120),
        "escort_relation" character varying(40),
        "escort_mobile" character varying(10),
        "decided_by" integer,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "decision_note" character varying(255),
        "qr_version" smallint NOT NULL DEFAULT 1,
        "departed_at" TIMESTAMP WITH TIME ZONE,
        "departed_by" integer,
        "returned_at" TIMESTAMP WITH TIME ZONE,
        "returned_by" integer,
        "late_minutes" integer,
        "overdue_alerted_at" TIMESTAMP WITH TIME ZONE,
        "school_leave_id" integer,
        CONSTRAINT "PK_hostel_leaves_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_hostel_leaves_school_id" ON "hostel_leaves" ("school_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_hostel_leaves_status" ON "hostel_leaves" ("school_id", "status")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_leaves_admission" ON "hostel_leaves" ("school_id", "admission_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_leaves_no" ON "hostel_leaves" ("school_id", "leave_no") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_visits" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "visit_no" character varying(40) NOT NULL,
        "hostel_id" integer NOT NULL,
        "admission_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "visitor_name" character varying(120) NOT NULL,
        "relation" character varying(40) NOT NULL,
        "mobile" character varying(10) NOT NULL,
        "people_count" smallint NOT NULL DEFAULT 1,
        "id_proof_type" character varying(16),
        "id_proof_last4" character varying(4),
        "photo_file_id" integer,
        "purpose" character varying(255),
        "is_known" boolean NOT NULL DEFAULT false,
        "status" character varying(8) NOT NULL,
        "note" character varying(255),
        "in_at" TIMESTAMP WITH TIME ZONE,
        "in_by" integer,
        "out_at" TIMESTAMP WITH TIME ZONE,
        "out_by" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hostel_visits_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hostel_visits_no" ON "hostel_visits" ("school_id", "visit_no")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_visits_status" ON "hostel_visits" ("school_id", "hostel_id", "status")`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_approved_visitors" (
        ${BASE},
        "student_id" integer NOT NULL,
        "name" character varying(120) NOT NULL,
        "relation" character varying(40) NOT NULL,
        "mobile" character varying(10) NOT NULL,
        "photo_file_id" integer,
        "added_by_role" character varying(10) NOT NULL,
        CONSTRAINT "PK_hostel_approved_visitors_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_approved_visitors_school_id" ON "hostel_approved_visitors" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_approved_visitors_student" ON "hostel_approved_visitors" ("school_id", "student_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_blocklist" (
        ${BASE},
        "mobile" character varying(10) NOT NULL,
        "name" character varying(120),
        "reason" character varying(255) NOT NULL,
        CONSTRAINT "PK_hostel_blocklist_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_hostel_blocklist_school_id" ON "hostel_blocklist" ("school_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_blocklist_mobile" ON "hostel_blocklist" ("school_id", "mobile") WHERE deleted_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "hostel_blocklist"`);
    await queryRunner.query(`DROP TABLE "hostel_approved_visitors"`);
    await queryRunner.query(`DROP TABLE "hostel_visits"`);
    await queryRunner.query(`DROP TABLE "hostel_leaves"`);
    await queryRunner.query(`DROP TABLE "hostel_roll_call_records"`);
    await queryRunner.query(`DROP TABLE "hostel_roll_calls"`);
  }
}
