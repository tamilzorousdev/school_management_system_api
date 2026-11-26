import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE = `"id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_by" integer,
        "school_id" integer NOT NULL`;

export class HostelFeesConduct1795660000000 implements MigrationInterface {
  name = 'HostelFeesConduct1795660000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "hostel_settings" ADD "caution_deposit" numeric(12,2) NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "hostel_settings" ADD "bill_on_admission" boolean NOT NULL DEFAULT true`);

    await queryRunner.query(
      `CREATE TABLE "hostel_fee_schedules" (
        ${BASE},
        "academic_year_id" integer NOT NULL,
        "label" character varying(40) NOT NULL,
        "due_date" date NOT NULL,
        "share_percent" numeric(5,2) NOT NULL,
        "sort_order" smallint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_hostel_fee_schedules_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_fee_schedules_school_id" ON "hostel_fee_schedules" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_fee_schedules_year" ON "hostel_fee_schedules" ("school_id", "academic_year_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_charges" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "admission_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "academic_year_id" integer NOT NULL,
        "kind" character varying(10) NOT NULL,
        "schedule_id" integer,
        "invoice_id" integer NOT NULL,
        "label" character varying(80) NOT NULL,
        "amount" numeric(12,2) NOT NULL DEFAULT 0,
        "settled_at" TIMESTAMP WITH TIME ZONE,
        "settled_by" integer,
        "deduction_amount" numeric(12,2),
        "deduction_reason" character varying(255),
        "refund_amount" numeric(12,2),
        "refund_mode" character varying(20),
        "refund_reference" character varying(60),
        "created_by" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hostel_charges_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_charges_student" ON "hostel_charges" ("school_id", "student_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_charges_rent" ON "hostel_charges" ("admission_id", "schedule_id") WHERE kind = 'rent'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_charges_deposit" ON "hostel_charges" ("admission_id") WHERE kind = 'deposit'`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_discipline_cases" (
        ${BASE},
        "case_no" character varying(40) NOT NULL,
        "admission_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "hostel_id" integer NOT NULL,
        "leave_id" integer,
        "category" character varying(24) NOT NULL,
        "severity" character varying(10) NOT NULL,
        "incident_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "location" character varying(120),
        "description" character varying(1000) NOT NULL,
        "witnesses" character varying(255),
        "status" character varying(14) NOT NULL DEFAULT 'open',
        "action" character varying(20),
        "action_note" character varying(500),
        "suspended_from" date,
        "suspended_to" date,
        "fine_amount" numeric(12,2),
        "fee_fine_id" integer,
        "visible_to_parent" boolean NOT NULL DEFAULT true,
        "decided_by" integer,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "closed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_hostel_discipline_cases_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_discipline_cases_school_id" ON "hostel_discipline_cases" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_discipline_cases_admission" ON "hostel_discipline_cases" ("school_id", "admission_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_discipline_cases_no" ON "hostel_discipline_cases" ("school_id", "case_no") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_complaints" (
        ${BASE},
        "complaint_no" character varying(40) NOT NULL,
        "hostel_id" integer NOT NULL,
        "admission_id" integer,
        "student_id" integer,
        "room_id" integer,
        "category" character varying(14) NOT NULL,
        "priority" character varying(8) NOT NULL DEFAULT 'normal',
        "title" character varying(120) NOT NULL,
        "description" character varying(1000) NOT NULL,
        "photo_file_id" integer,
        "raised_by_role" character varying(10) NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'open',
        "assigned_to" integer,
        "due_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "resolution" character varying(500),
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        "rating" smallint,
        "rating_comment" character varying(255),
        "maintenance_ticket_id" integer,
        CONSTRAINT "PK_hostel_complaints_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_hostel_complaints_school_id" ON "hostel_complaints" ("school_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_complaints_status" ON "hostel_complaints" ("school_id", "hostel_id", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_complaints_no" ON "hostel_complaints" ("school_id", "complaint_no") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_maintenance_tickets" (
        ${BASE},
        "ticket_no" character varying(40) NOT NULL,
        "hostel_id" integer NOT NULL,
        "room_id" integer,
        "bed_id" integer,
        "category" character varying(14) NOT NULL,
        "priority" character varying(8) NOT NULL DEFAULT 'normal',
        "title" character varying(120) NOT NULL,
        "description" character varying(1000),
        "photo_file_id" integer,
        "status" character varying(12) NOT NULL DEFAULT 'open',
        "assigned_to" integer,
        "vendor_name" character varying(120),
        "scheduled_on" date,
        "blocks_room" boolean NOT NULL DEFAULT false,
        "cost" numeric(12,2),
        "due_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "complaint_id" integer,
        "charged_admission_id" integer,
        "charged_fine_id" integer,
        CONSTRAINT "PK_hostel_maintenance_tickets_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_maintenance_tickets_school_id" ON "hostel_maintenance_tickets" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_maintenance_tickets_status" ON "hostel_maintenance_tickets" ("school_id", "hostel_id", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_maintenance_tickets_no" ON "hostel_maintenance_tickets" ("school_id", "ticket_no") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_ticket_updates" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "target" character varying(12) NOT NULL,
        "target_id" integer NOT NULL,
        "status" character varying(12),
        "note" character varying(500),
        "actor_user_id" integer,
        "actor_name" character varying(120),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hostel_ticket_updates_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_ticket_updates_target" ON "hostel_ticket_updates" ("target", "target_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "hostel_ticket_updates"`);
    await queryRunner.query(`DROP TABLE "hostel_maintenance_tickets"`);
    await queryRunner.query(`DROP TABLE "hostel_complaints"`);
    await queryRunner.query(`DROP TABLE "hostel_discipline_cases"`);
    await queryRunner.query(`DROP TABLE "hostel_charges"`);
    await queryRunner.query(`DROP TABLE "hostel_fee_schedules"`);
    await queryRunner.query(`ALTER TABLE "hostel_settings" DROP COLUMN "bill_on_admission"`);
    await queryRunner.query(`ALTER TABLE "hostel_settings" DROP COLUMN "caution_deposit"`);
  }
}
