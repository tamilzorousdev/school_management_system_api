import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE = `"id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL`;

const TICKET_COLUMNS = [
  `"kind" character varying(8) NOT NULL DEFAULT 'repair'`,
  `"category" character varying(20)`,
  `"schedule_id" integer`,
  `"parts_cost" numeric(12,2)`,
  `"labour_cost" numeric(12,2)`,
  `"vendor_id" integer`,
  `"bill_file_id" integer`,
  `"photo_file_id" integer`,
  `"off_road" boolean NOT NULL DEFAULT false`,
  `"warranty_months" smallint`,
  `"warranty_km" integer`,
  `"reported_by" integer`,
];

const FUEL_COLUMNS = [
  `"is_full" boolean NOT NULL DEFAULT true`,
  `"status" character varying(10) NOT NULL DEFAULT 'approved'`,
  `"review_note" character varying(300)`,
  `"reviewed_by" integer`,
  `"reviewed_at" TIMESTAMP WITH TIME ZONE`,
  `"payment_mode" character varying(12) NOT NULL DEFAULT 'cash'`,
  `"reimbursed_at" TIMESTAMP WITH TIME ZONE`,
  `"reimbursed_by" integer`,
  `"station_id" integer`,
];

const VEHICLE_COLUMNS = [
  `"tank_litres" smallint`,
  `"monthly_budget" numeric(12,2)`,
  `"budget_alerted_month" character varying(7)`,
  `"tracker_odometer_km" numeric(10,1)`,
  `"tracker_odometer_at" TIMESTAMP WITH TIME ZONE`,
];

const columnName = (definition: string) => definition.split('"')[1];

export class VehicleMaintenance1794760000000 implements MigrationInterface {
  name = 'VehicleMaintenance1794760000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "fleet_settings" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "due_soon_km" integer NOT NULL DEFAULT 500, "due_soon_days" integer NOT NULL DEFAULT 15, "low_mileage_drop_pct" integer NOT NULL DEFAULT 20, "price_warning_pct" integer NOT NULL DEFAULT 15, "idle_litres_per_hour" numeric(4,2) NOT NULL DEFAULT 2.5, "pre_trip_check_required" boolean NOT NULL DEFAULT false, "locked_until" date, "updated_by" integer, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fleet_settings" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fleet_settings_school" ON "fleet_settings" ("school_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "maintenance_schedules" (${BASE}, "vehicle_id" integer NOT NULL, "category" character varying(20) NOT NULL, "title" character varying(100) NOT NULL, "every_km" integer, "every_months" smallint, "last_done_on" date NOT NULL, "last_done_km" numeric(10,1), "is_active" boolean NOT NULL DEFAULT true, "alerted_status" character varying(10), "alerted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_maintenance_schedules" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_maintenance_schedules_school" ON "maintenance_schedules" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_maintenance_schedules_school_vehicle" ON "maintenance_schedules" ("school_id", "vehicle_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "vehicle_expenses" (${BASE}, "vehicle_id" integer NOT NULL, "spent_on" date NOT NULL, "category" character varying(20) NOT NULL, "amount" numeric(12,2) NOT NULL, "vendor_id" integer, "paid_to" character varying(100), "payment_mode" character varying(12) NOT NULL DEFAULT 'cash', "reimbursed_at" TIMESTAMP WITH TIME ZONE, "reimbursed_by" integer, "bill_file_id" integer, "note" character varying(500), "renewed_until" date, CONSTRAINT "PK_vehicle_expenses" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_vehicle_expenses_school" ON "vehicle_expenses" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_vehicle_expenses_school_vehicle_date" ON "vehicle_expenses" ("school_id", "vehicle_id", "spent_on")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "fleet_vendors" (${BASE}, "kind" character varying(12) NOT NULL, "name" character varying(100) NOT NULL, "phone" character varying(15), "gst_no" character varying(15), "address" character varying(200), "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_fleet_vendors" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_fleet_vendors_school" ON "fleet_vendors" ("school_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fleet_vendors_school_kind_name" ON "fleet_vendors" ("school_id", "kind", "name") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "pre_trip_checks" (${BASE}, "vehicle_id" integer NOT NULL, "check_date" date NOT NULL, "checked_by" integer NOT NULL, "items" jsonb NOT NULL, "odometer_km" numeric(10,1), "failed_count" smallint NOT NULL DEFAULT 0, "critical_failed" boolean NOT NULL DEFAULT false, "ticket_id" integer, "photo_file_id" integer, "cleared_by" integer, "cleared_at" TIMESTAMP WITH TIME ZONE, "clear_note" character varying(300), CONSTRAINT "PK_pre_trip_checks" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pre_trip_checks_school" ON "pre_trip_checks" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pre_trip_checks_vehicle_date" ON "pre_trip_checks" ("vehicle_id", "check_date") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "fleet_entry_changes" (${BASE}, "entity" character varying(10) NOT NULL, "entity_id" integer NOT NULL, "vehicle_id" integer, "action" character varying(10) NOT NULL, "before" jsonb, "after" jsonb, "note" character varying(300), CONSTRAINT "PK_fleet_entry_changes" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fleet_entry_changes_school" ON "fleet_entry_changes" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_fleet_entry_changes_entity" ON "fleet_entry_changes" ("school_id", "entity", "entity_id")`,
    );

    for (const column of TICKET_COLUMNS) {
      await queryRunner.query(`ALTER TABLE "maintenance_tickets" ADD IF NOT EXISTS ${column}`);
    }
    for (const column of FUEL_COLUMNS) {
      await queryRunner.query(`ALTER TABLE "fuel_logs" ADD IF NOT EXISTS ${column}`);
    }
    for (const column of VEHICLE_COLUMNS) {
      await queryRunner.query(`ALTER TABLE "vehicles" ADD IF NOT EXISTS ${column}`);
    }
    await queryRunner.query(`ALTER TABLE "transport_trips" ADD IF NOT EXISTS "gps_km" numeric(8,1)`);
    await queryRunner.query(
      `ALTER TABLE "transport_trips" ADD IF NOT EXISTS "gps_checked_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transport_trips" DROP COLUMN IF EXISTS "gps_checked_at"`);
    await queryRunner.query(`ALTER TABLE "transport_trips" DROP COLUMN IF EXISTS "gps_km"`);
    for (const column of VEHICLE_COLUMNS) {
      await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN IF EXISTS "${columnName(column)}"`);
    }
    for (const column of FUEL_COLUMNS) {
      await queryRunner.query(`ALTER TABLE "fuel_logs" DROP COLUMN IF EXISTS "${columnName(column)}"`);
    }
    for (const column of TICKET_COLUMNS) {
      await queryRunner.query(`ALTER TABLE "maintenance_tickets" DROP COLUMN IF EXISTS "${columnName(column)}"`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "fleet_entry_changes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pre_trip_checks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fleet_vendors"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vehicle_expenses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "maintenance_schedules"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fleet_settings"`);
  }
}
