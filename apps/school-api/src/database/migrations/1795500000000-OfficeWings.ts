import { MigrationInterface, QueryRunner } from 'typeorm';

export class OfficeWings1795500000000 implements MigrationInterface {
  name = 'OfficeWings1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "school_wings" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "name" character varying(60) NOT NULL, "from_grade" smallint NOT NULL, "to_grade" smallint NOT NULL, "class_ids" integer array, "board" character varying(10), "sort_order" smallint NOT NULL DEFAULT 0, CONSTRAINT "PK_4b6c207a68819272b95c1961a61" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_5f88b873c7662d582b39fc5172" ON "school_wings" ("school_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_school_wings_name" ON "school_wings" ("school_id", "name") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "user_wings" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "user_id" integer NOT NULL, "wing_id" integer NOT NULL, "valid_from" date, "valid_to" date, "note" character varying(200), CONSTRAINT "PK_82b20c24bb47146298911b31eb9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_1df34630a8724c66c99f3f76f8" ON "user_wings" ("school_id")`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_wings_user" ON "user_wings" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_wings_wing" ON "user_wings" ("wing_id")`);
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "office_activity_logs" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "user_id" integer NOT NULL, "action" character varying(30) NOT NULL, "student_id" integer, "target_user_id" integer, "note" character varying(300), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_969c317f7891d8af535f18f562a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_office_activity_user" ON "office_activity_logs" ("school_id", "user_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "gate_settings" ADD IF NOT EXISTS "office_escalate_minutes" integer NOT NULL DEFAULT 30`,
    );
    await queryRunner.query(
      `ALTER TABLE "gate_passes" ADD IF NOT EXISTS "office_escalated_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "gate_passes" DROP COLUMN IF EXISTS "office_escalated_at"`);
    await queryRunner.query(`ALTER TABLE "gate_settings" DROP COLUMN IF EXISTS "office_escalate_minutes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "office_activity_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_wings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "school_wings"`);
  }
}
