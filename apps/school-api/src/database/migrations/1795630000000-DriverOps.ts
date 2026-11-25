import { MigrationInterface, QueryRunner } from 'typeorm';

export class DriverOps1795630000000 implements MigrationInterface {
  name = 'DriverOps1795630000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transport_trips" ALTER COLUMN "device_id" DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "transport_trips" ADD "tracking" character varying(10) NOT NULL DEFAULT 'telematics'`,
    );
    await queryRunner.query(`ALTER TABLE "transport_trips" ADD "sweep_photo_id" integer`);
    await queryRunner.query(`ALTER TABLE "transport_trips" ADD "swept_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "transport_trips" ADD "swept_by" integer`);
    await queryRunner.query(`ALTER TABLE "transport_boardings" ADD "handed_to" character varying(160)`);

    await queryRunner.query(
      `CREATE TABLE "driver_duties" (
        "id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_by" integer,
        "school_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "vehicle_id" integer,
        "duty_date" date NOT NULL,
        "check_in_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "check_in_lat" numeric(9,6),
        "check_in_lng" numeric(9,6),
        "check_in_place" character varying(10) NOT NULL DEFAULT 'unknown',
        "check_in_photo_id" integer,
        "reporting_time" character varying(5),
        "late_minutes" integer NOT NULL DEFAULT 0,
        "attendant_user_id" integer,
        "attendant_present" boolean,
        "check_out_at" TIMESTAMP WITH TIME ZONE,
        "check_out_lat" numeric(9,6),
        "check_out_lng" numeric(9,6),
        "check_out_photo_id" integer,
        CONSTRAINT "PK_driver_duties" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_ae685f6bfd07c5fe1dbc66c7ee" ON "driver_duties" ("school_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_9300f52edfed7b625f0f90a5a8" ON "driver_duties" ("duty_date")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_driver_duties_user_date" ON "driver_duties" ("user_id", "duty_date") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "transport_incidents" (
        "id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_by" integer,
        "school_id" integer NOT NULL,
        "vehicle_id" integer,
        "trip_id" integer,
        "reported_by" integer NOT NULL,
        "type" character varying(20) NOT NULL,
        "description" text NOT NULL,
        "student_ids" jsonb NOT NULL DEFAULT '[]',
        "photo_file_ids" jsonb NOT NULL DEFAULT '[]',
        "lat" numeric(9,6),
        "lng" numeric(9,6),
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "status" character varying(10) NOT NULL DEFAULT 'open',
        "resolved_by" integer,
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        "resolution_note" text,
        CONSTRAINT "PK_transport_incidents" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_31f668b01e4e769104801abb71" ON "transport_incidents" ("school_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_transport_incidents_school_status" ON "transport_incidents" ("school_id", "status")`,
    );

    await queryRunner.query(
      `CREATE TABLE "bus_opt_outs" (
        "id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_by" integer,
        "school_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "opt_date" date NOT NULL,
        "trip" character varying(10) NOT NULL,
        "reason" character varying(200),
        CONSTRAINT "PK_bus_opt_outs" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_13d0193e3ab04d43ad61d64fc0" ON "bus_opt_outs" ("school_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_bus_opt_outs_student_date_trip" ON "bus_opt_outs" ("student_id", "opt_date", "trip") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "bus_pickup_persons" (
        "id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_by" integer,
        "school_id" integer NOT NULL,
        "student_id" integer NOT NULL,
        "pickup_date" date NOT NULL,
        "name" character varying(120) NOT NULL,
        "relation" character varying(40) NOT NULL,
        "mobile" character varying(15) NOT NULL,
        "photo_file_id" integer,
        CONSTRAINT "PK_bus_pickup_persons" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_1aec09925e0111e864f5042259" ON "bus_pickup_persons" ("school_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_bus_pickup_persons_student_date" ON "bus_pickup_persons" ("student_id", "pickup_date") WHERE deleted_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "bus_pickup_persons"`);
    await queryRunner.query(`DROP TABLE "bus_opt_outs"`);
    await queryRunner.query(`DROP TABLE "transport_incidents"`);
    await queryRunner.query(`DROP TABLE "driver_duties"`);
    await queryRunner.query(`ALTER TABLE "transport_boardings" DROP COLUMN "handed_to"`);
    await queryRunner.query(`ALTER TABLE "transport_trips" DROP COLUMN "swept_by"`);
    await queryRunner.query(`ALTER TABLE "transport_trips" DROP COLUMN "swept_at"`);
    await queryRunner.query(`ALTER TABLE "transport_trips" DROP COLUMN "sweep_photo_id"`);
    await queryRunner.query(`ALTER TABLE "transport_trips" DROP COLUMN "tracking"`);
    await queryRunner.query(`DELETE FROM "transport_trips" WHERE "device_id" IS NULL`);
    await queryRunner.query(`ALTER TABLE "transport_trips" ALTER COLUMN "device_id" SET NOT NULL`);
  }
}
