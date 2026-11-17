import { MigrationInterface, QueryRunner } from 'typeorm';

export class DriverRatings1794690000000 implements MigrationInterface {
  name = 'DriverRatings1794690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "driver_ratings" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "driver_user_id" integer NOT NULL, "vehicle_id" integer, "student_id" integer NOT NULL, "parent_user_id" integer NOT NULL, "month" character varying(7) NOT NULL, "rating" smallint NOT NULL, "tags" character varying array NOT NULL DEFAULT '{}', "comment" character varying(500), CONSTRAINT "PK_driver_ratings" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_driver_ratings_school" ON "driver_ratings" ("school_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_driver_ratings_parent_driver_month" ON "driver_ratings" ("parent_user_id", "driver_user_id", "month")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_driver_ratings_driver" ON "driver_ratings" ("school_id", "driver_user_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_driver_ratings_driver"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."UQ_driver_ratings_parent_driver_month"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_driver_ratings_school"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "driver_ratings"`);
  }
}
