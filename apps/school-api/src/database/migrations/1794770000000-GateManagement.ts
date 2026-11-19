import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE = `"id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL`;

export class GateManagement1794770000000 implements MigrationInterface {
  name = 'GateManagement1794770000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "gate_settings" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "grace_minutes" integer NOT NULL DEFAULT 30, "emergency_wait_minutes" integer NOT NULL DEFAULT 10, "visitor_photo_required" boolean NOT NULL DEFAULT true, "visitor_id_required" boolean NOT NULL DEFAULT false, "visitor_checkout_time" character varying(5) NOT NULL DEFAULT '18:00', "notify_office_on_manual" boolean NOT NULL DEFAULT true, "updated_by" integer, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_gate_settings" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_gate_settings_school" ON "gate_settings" ("school_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "gate_passes" (${BASE}, "pass_no" character varying(20) NOT NULL, "student_id" integer NOT NULL, "pass_date" date NOT NULL, "from_time" character varying(5) NOT NULL, "until_time" character varying(5) NOT NULL, "reason" character varying(300) NOT NULL, "pickup_kind" character varying(10) NOT NULL, "guardian_id" integer, "authorised_id" integer, "pickup_name" character varying(80) NOT NULL, "pickup_relation" character varying(40), "pickup_mobile" character varying(15), "pickup_photo_file_id" integer, "status" character varying(10) NOT NULL DEFAULT 'pending', "source" character varying(8) NOT NULL, "is_emergency" boolean NOT NULL DEFAULT false, "needs_consent" boolean NOT NULL DEFAULT false, "consent_status" character varying(10), "consent_by" integer, "consent_at" TIMESTAMP WITH TIME ZONE, "consent_code" character varying(4), "consent_verified_at" TIMESTAMP WITH TIME ZONE, "requested_by" integer, "decided_by" integer, "decided_at" TIMESTAMP WITH TIME ZONE, "decision_note" character varying(300), "code" character varying(4) NOT NULL, "qr_version" smallint NOT NULL DEFAULT 1, "released_at" TIMESTAMP WITH TIME ZONE, "released_by" integer, "release_method" character varying(8), "release_photo_file_id" integer, "id_proof_kind" character varying(20), "id_proof_last4" character varying(4), "leave_id" integer, "escalated_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_gate_passes" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_gate_passes_school" ON "gate_passes" ("school_id")`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gate_passes_school_date" ON "gate_passes" ("school_id", "pass_date")`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_gate_passes_student" ON "gate_passes" ("student_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_gate_passes_number" ON "gate_passes" ("school_id", "pass_no")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "authorised_pickups" (${BASE}, "student_id" integer NOT NULL, "name" character varying(80) NOT NULL, "relation" character varying(40) NOT NULL, "mobile" character varying(15) NOT NULL, "photo_file_id" integer, "valid_until" date, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_authorised_pickups" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_authorised_pickups_school" ON "authorised_pickups" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_authorised_pickups_student" ON "authorised_pickups" ("school_id", "student_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "gate_visits" (${BASE}, "visit_no" character varying(20) NOT NULL, "visit_date" date NOT NULL, "name" character varying(80) NOT NULL, "mobile" character varying(15) NOT NULL, "photo_file_id" integer, "id_proof_kind" character varying(20), "id_proof_last4" character varying(4), "purpose" character varying(20) NOT NULL, "purpose_note" character varying(300), "company" character varying(100), "people_count" smallint NOT NULL DEFAULT 1, "vehicle_no" character varying(15), "host_user_id" integer, "student_id" integer, "status" character varying(10) NOT NULL, "expected_from" character varying(5), "expected_until" character varying(5), "code" character varying(4) NOT NULL, "qr_version" smallint NOT NULL DEFAULT 1, "invited_by" integer, "decided_by" integer, "decided_at" TIMESTAMP WITH TIME ZONE, "decision_note" character varying(300), "checked_in_at" TIMESTAMP WITH TIME ZONE, "checked_in_by" integer, "check_in_method" character varying(8), "checked_out_at" TIMESTAMP WITH TIME ZONE, "checked_out_by" integer, "check_out_method" character varying(8), "overstay_alerted_at" TIMESTAMP WITH TIME ZONE, "blocked_hit" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_gate_visits" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_gate_visits_school" ON "gate_visits" ("school_id")`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gate_visits_school_date" ON "gate_visits" ("school_id", "visit_date")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_gate_visits_number" ON "gate_visits" ("school_id", "visit_no")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "gate_blocklist" (${BASE}, "name" character varying(80) NOT NULL, "mobile" character varying(15), "reason" character varying(300) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_gate_blocklist" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_gate_blocklist_school" ON "gate_blocklist" ("school_id")`);

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "gate_events" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "kind" character varying(24) NOT NULL, "pass_id" integer, "visit_id" integer, "student_id" integer, "actor_id" integer, "method" character varying(8), "note" character varying(300), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_gate_events" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gate_events_school_at" ON "gate_events" ("school_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "gate_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "gate_blocklist"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "gate_visits"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "authorised_pickups"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "gate_passes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "gate_settings"`);
  }
}
