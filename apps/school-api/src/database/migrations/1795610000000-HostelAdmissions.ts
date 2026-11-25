import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE = `"id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_by" integer,
        "school_id" integer NOT NULL`;

export class HostelAdmissions1795610000000 implements MigrationInterface {
  name = 'HostelAdmissions1795610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "hostel_applications" (
        ${BASE},
        "application_no" character varying(40) NOT NULL,
        "student_id" integer NOT NULL,
        "academic_year_id" integer NOT NULL,
        "hostel_id" integer,
        "room_type_id" integer,
        "source" character varying(10) NOT NULL DEFAULT 'office',
        "status" character varying(12) NOT NULL DEFAULT 'pending',
        "priority" smallint NOT NULL DEFAULT 0,
        "wanted_from" date,
        "reason" character varying(500),
        "decided_by" integer,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "decision_note" character varying(255),
        "admission_id" integer,
        CONSTRAINT "PK_hostel_applications_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_hostel_applications_school_id" ON "hostel_applications" ("school_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_applications_status" ON "hostel_applications" ("school_id", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_applications_no" ON "hostel_applications" ("school_id", "application_no") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_applications_open_student" ON "hostel_applications" ("school_id", "student_id", "academic_year_id") WHERE status IN ('pending', 'waitlisted', 'approved') AND deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_admissions" (
        ${BASE},
        "admission_no" character varying(40) NOT NULL,
        "student_id" integer NOT NULL,
        "academic_year_id" integer NOT NULL,
        "hostel_id" integer NOT NULL,
        "application_id" integer,
        "status" character varying(14) NOT NULL DEFAULT 'active',
        "admitted_on" date NOT NULL,
        "checked_out_on" date,
        "diet" character varying(12) NOT NULL DEFAULT 'veg',
        "local_guardian_name" character varying(120),
        "local_guardian_mobile" character varying(10),
        "local_guardian_relation" character varying(40),
        "local_guardian_address" character varying(255),
        "medical_notes" character varying(500),
        "notes" character varying(500),
        CONSTRAINT "PK_hostel_admissions_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_hostel_admissions_school_id" ON "hostel_admissions" ("school_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_admissions_hostel_status" ON "hostel_admissions" ("school_id", "hostel_id", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_admissions_no" ON "hostel_admissions" ("school_id", "admission_no") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_admissions_live_student" ON "hostel_admissions" ("school_id", "student_id") WHERE status <> 'checked_out' AND deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_allocations" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "admission_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "hostel_id" integer NOT NULL,
        "room_id" integer NOT NULL,
        "bed_id" integer NOT NULL,
        "from_date" date NOT NULL,
        "to_date" date,
        "end_reason" character varying(10),
        "created_by" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hostel_allocations_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_allocations_student" ON "hostel_allocations" ("school_id", "student_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_allocations_live_bed" ON "hostel_allocations" ("school_id", "bed_id") WHERE to_date IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_allocations_live_admission" ON "hostel_allocations" ("school_id", "admission_id") WHERE to_date IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_transfers" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "admission_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "kind" character varying(10) NOT NULL,
        "from_bed_id" integer,
        "to_bed_id" integer NOT NULL,
        "swap_admission_id" integer,
        "transfer_date" date NOT NULL,
        "reason" character varying(255),
        "created_by" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hostel_transfers_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_transfers_admission" ON "hostel_transfers" ("school_id", "admission_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_checkouts" (
        ${BASE},
        "admission_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "status" character varying(10) NOT NULL DEFAULT 'open',
        "reason" character varying(16) NOT NULL,
        "checkout_date" date NOT NULL,
        "forwarding_address" character varying(255),
        "remarks" character varying(500),
        "completed_by" integer,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_hostel_checkouts_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_hostel_checkouts_school_id" ON "hostel_checkouts" ("school_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_checkouts_open" ON "hostel_checkouts" ("school_id", "admission_id") WHERE status = 'open'`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_checkout_items" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "checkout_id" integer NOT NULL,
        "code" character varying(30) NOT NULL,
        "label" character varying(80) NOT NULL,
        "sort_order" smallint NOT NULL DEFAULT 0,
        "status" character varying(10) NOT NULL DEFAULT 'pending',
        "amount" numeric(12,2),
        "note" character varying(255),
        "cleared_by" integer,
        "cleared_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_hostel_checkout_items_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_checkout_items_code" ON "hostel_checkout_items" ("checkout_id", "code")`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_audit_log" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "entity" character varying(30) NOT NULL,
        "entity_id" integer NOT NULL,
        "action" character varying(30) NOT NULL,
        "student_id" integer,
        "actor_user_id" integer,
        "actor_name" character varying(120),
        "changes" jsonb,
        "note" character varying(255),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hostel_audit_log_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_audit_log_school_created" ON "hostel_audit_log" ("school_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_audit_log_student" ON "hostel_audit_log" ("school_id", "student_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "hostel_audit_log"`);
    await queryRunner.query(`DROP TABLE "hostel_checkout_items"`);
    await queryRunner.query(`DROP TABLE "hostel_checkouts"`);
    await queryRunner.query(`DROP TABLE "hostel_transfers"`);
    await queryRunner.query(`DROP TABLE "hostel_allocations"`);
    await queryRunner.query(`DROP TABLE "hostel_admissions"`);
    await queryRunner.query(`DROP TABLE "hostel_applications"`);
  }
}
