import { MigrationInterface, QueryRunner } from 'typeorm';

export class VehicleMaster1794650000000 implements MigrationInterface {
  name = 'VehicleMaster1794650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "vehicle_documents" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "type" character varying(30) NOT NULL, "title" character varying(120) NOT NULL, "file_id" integer NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'pending', "remarks" character varying(255), "verified_by" integer, "verified_at" TIMESTAMP WITH TIME ZONE, "vehicle_id" integer NOT NULL, "number" character varying(40), "expiry_date" date, CONSTRAINT "PK_d0cc0eb10dcf41a4f35575f5273" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_e5f585c17282017f0f5f811727" ON "vehicle_documents" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_vehicle_documents_vehicle" ON "vehicle_documents" ("vehicle_id") `);
    await queryRunner.query(
      `CREATE TABLE "duty_overrides" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "subject" character varying(8) NOT NULL, "subject_id" integer NOT NULL, "on_date" date NOT NULL, "reason" character varying(255) NOT NULL, "created_by" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_duty_overrides" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_duty_overrides_school" ON "duty_overrides" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_duty_overrides_day" ON "duty_overrides" ("subject", "subject_id", "on_date") `,
    );
    await queryRunner.query(`ALTER TABLE "vehicles" ADD "vehicle_type" character varying(12) NOT NULL DEFAULT 'bus'`);
    await queryRunner.query(`ALTER TABLE "vehicles" ADD "fuel_type" character varying(10)`);
    await queryRunner.query(`ALTER TABLE "vehicles" ADD "manufacture_year" smallint`);
    await queryRunner.query(`ALTER TABLE "vehicles" ADD "chassis_no" character varying(30)`);
    await queryRunner.query(`ALTER TABLE "vehicles" ADD "engine_no" character varying(30)`);
    await queryRunner.query(`ALTER TABLE "vehicles" ADD "ownership" character varying(12) NOT NULL DEFAULT 'school'`);
    await queryRunner.query(`ALTER TABLE "vehicles" ADD "contractor_name" character varying(80)`);
    await queryRunner.query(`ALTER TABLE "vehicles" ADD "contractor_mobile" character varying(10)`);
    await queryRunner.query(`ALTER TABLE "vehicles" ADD "rc_expiry" date`);
    await queryRunner.query(`ALTER TABLE "vehicles" ADD "road_tax_expiry" date`);
    await queryRunner.query(`ALTER TABLE "vehicles" ADD "speed_governor_expiry" date`);
    await queryRunner.query(`ALTER TABLE "vehicles" ADD "fire_extinguisher_expiry" date`);
    await queryRunner.query(`ALTER TABLE "vehicles" ADD "first_aid_expiry" date`);
    await queryRunner.query(`ALTER TABLE "fleet_expiry_alerts" ALTER COLUMN "kind" TYPE character varying(24)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fleet_expiry_alerts" ALTER COLUMN "kind" TYPE character varying(12)`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "first_aid_expiry"`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "fire_extinguisher_expiry"`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "speed_governor_expiry"`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "road_tax_expiry"`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "rc_expiry"`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "contractor_mobile"`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "contractor_name"`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "ownership"`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "engine_no"`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "chassis_no"`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "manufacture_year"`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "fuel_type"`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "vehicle_type"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_duty_overrides_day"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_duty_overrides_school"`);
    await queryRunner.query(`DROP TABLE "duty_overrides"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_vehicle_documents_vehicle"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e5f585c17282017f0f5f811727"`);
    await queryRunner.query(`DROP TABLE "vehicle_documents"`);
  }
}
