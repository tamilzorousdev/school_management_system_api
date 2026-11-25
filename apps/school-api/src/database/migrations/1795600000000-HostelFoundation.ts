import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE = `"id" SERIAL NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_by" integer,
        "school_id" integer NOT NULL`;

export class HostelFoundation1795600000000 implements MigrationInterface {
  name = 'HostelFoundation1795600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "hostel_settings" (
        "id" SERIAL NOT NULL,
        "school_id" integer NOT NULL,
        "enabled_modules" jsonb NOT NULL DEFAULT '{}',
        "wake_up_time" character varying(5) NOT NULL DEFAULT '05:30',
        "study_start_time" character varying(5) NOT NULL DEFAULT '18:30',
        "study_end_time" character varying(5) NOT NULL DEFAULT '20:30',
        "in_time" character varying(5) NOT NULL DEFAULT '19:00',
        "lights_out_time" character varying(5) NOT NULL DEFAULT '22:00',
        "outing_from_time" character varying(5) NOT NULL DEFAULT '16:00',
        "outing_until_time" character varying(5) NOT NULL DEFAULT '18:30',
        "parent_consent_for_leave" boolean NOT NULL DEFAULT true,
        "holiday_mode" boolean NOT NULL DEFAULT false,
        "rules" text,
        "updated_by" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hostel_settings_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_hostel_settings_school" ON "hostel_settings" ("school_id")`);

    await queryRunner.query(
      `CREATE TABLE "hostels" (
        ${BASE},
        "name" character varying(100) NOT NULL,
        "code" character varying(20) NOT NULL,
        "gender" character varying(10) NOT NULL,
        "status" character varying(10) NOT NULL DEFAULT 'active',
        "warden_user_id" integer,
        "phone" character varying(10),
        "address" character varying(255),
        "notes" text,
        CONSTRAINT "PK_hostels_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_hostels_school_id" ON "hostels" ("school_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostels_school_code" ON "hostels" ("school_id", "code") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_blocks" (
        ${BASE},
        "hostel_id" integer NOT NULL,
        "name" character varying(60) NOT NULL,
        "code" character varying(20) NOT NULL,
        "sort_order" smallint NOT NULL DEFAULT 0,
        "incharge_user_id" integer,
        CONSTRAINT "PK_hostel_blocks_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_hostel_blocks_school_id" ON "hostel_blocks" ("school_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_blocks_code" ON "hostel_blocks" ("school_id", "hostel_id", "code") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_floors" (
        ${BASE},
        "hostel_id" integer NOT NULL,
        "block_id" integer NOT NULL,
        "name" character varying(40) NOT NULL,
        "level" smallint NOT NULL,
        CONSTRAINT "PK_hostel_floors_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_hostel_floors_school_id" ON "hostel_floors" ("school_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_floors_level" ON "hostel_floors" ("school_id", "block_id", "level") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_room_types" (
        ${BASE},
        "name" character varying(60) NOT NULL,
        "code" character varying(20) NOT NULL,
        "default_beds" smallint NOT NULL,
        "is_ac" boolean NOT NULL DEFAULT false,
        "attached_bathroom" boolean NOT NULL DEFAULT false,
        "annual_fee" numeric(12,2) NOT NULL DEFAULT 0,
        "amenities" character varying(255),
        CONSTRAINT "PK_hostel_room_types_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_hostel_room_types_school_id" ON "hostel_room_types" ("school_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_room_types_code" ON "hostel_room_types" ("school_id", "code") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_rooms" (
        ${BASE},
        "hostel_id" integer NOT NULL,
        "block_id" integer NOT NULL,
        "floor_id" integer NOT NULL,
        "room_type_id" integer NOT NULL,
        "room_no" character varying(20) NOT NULL,
        "capacity" smallint NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'active',
        "notes" character varying(255),
        CONSTRAINT "PK_hostel_rooms_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_hostel_rooms_school_id" ON "hostel_rooms" ("school_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_hostel_rooms_floor" ON "hostel_rooms" ("school_id", "floor_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_rooms_no" ON "hostel_rooms" ("school_id", "hostel_id", "room_no") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "hostel_beds" (
        ${BASE},
        "hostel_id" integer NOT NULL,
        "room_id" integer NOT NULL,
        "bed_no" character varying(10) NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'vacant',
        "notes" character varying(255),
        CONSTRAINT "PK_hostel_beds_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_hostel_beds_school_id" ON "hostel_beds" ("school_id")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_hostel_beds_status" ON "hostel_beds" ("school_id", "hostel_id", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_hostel_beds_label" ON "hostel_beds" ("school_id", "room_id", "bed_no") WHERE deleted_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "hostel_beds"`);
    await queryRunner.query(`DROP TABLE "hostel_rooms"`);
    await queryRunner.query(`DROP TABLE "hostel_room_types"`);
    await queryRunner.query(`DROP TABLE "hostel_floors"`);
    await queryRunner.query(`DROP TABLE "hostel_blocks"`);
    await queryRunner.query(`DROP TABLE "hostels"`);
    await queryRunner.query(`DROP TABLE "hostel_settings"`);
  }
}
