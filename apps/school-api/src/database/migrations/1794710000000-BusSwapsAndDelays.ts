import { MigrationInterface, QueryRunner } from 'typeorm';

export class BusSwapsAndDelays1794710000000 implements MigrationInterface {
  name = 'BusSwapsAndDelays1794710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "route_bus_swaps" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "route_id" integer NOT NULL, "swap_date" date NOT NULL, "vehicle_id" integer NOT NULL, "original_vehicle_id" integer, "reason" character varying(200), CONSTRAINT "PK_route_bus_swaps" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_route_bus_swaps_school" ON "route_bus_swaps" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_route_bus_swaps_route_date" ON "route_bus_swaps" ("route_id", "swap_date") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "route_changes" ADD IF NOT EXISTS "reason" character varying(200)`);
    await queryRunner.query(`ALTER TABLE "transport_trips" ADD IF NOT EXISTS "delay_minutes" integer`);
    await queryRunner.query(`ALTER TABLE "transport_trips" ADD IF NOT EXISTS "delay_reason" character varying(200)`);
    await queryRunner.query(`ALTER TABLE "transport_trips" ADD IF NOT EXISTS "delayed_at" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transport_trips" DROP COLUMN IF EXISTS "delayed_at"`);
    await queryRunner.query(`ALTER TABLE "transport_trips" DROP COLUMN IF EXISTS "delay_reason"`);
    await queryRunner.query(`ALTER TABLE "transport_trips" DROP COLUMN IF EXISTS "delay_minutes"`);
    await queryRunner.query(`ALTER TABLE "route_changes" DROP COLUMN IF EXISTS "reason"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "route_bus_swaps"`);
  }
}
