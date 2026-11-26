import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentNoc1795520000000 implements MigrationInterface {
  name = 'StudentNoc1795520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "student_nocs" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'open', "exit_type" character varying(12) NOT NULL, "leaving_date" date NOT NULL, "reason" character varying(255) NOT NULL, "requested_by" integer, "requested_by_name" character varying(120), "cleared_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancel_note" character varying(255), "tc_id" integer, CONSTRAINT "PK_student_nocs" PRIMARY KEY ("id"), CONSTRAINT "CHK_student_nocs_status" CHECK ("status" IN ('open', 'cleared', 'cancelled', 'issued')), CONSTRAINT "CHK_student_nocs_exit_type" CHECK ("exit_type" IN ('transferred', 'withdrawn')))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_student_nocs_school_id" ON "student_nocs" ("school_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_student_nocs_student" ON "student_nocs" ("student_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_student_nocs_live" ON "student_nocs" ("school_id", "student_id") WHERE "status" IN ('open', 'cleared') AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "student_noc_items" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "noc_id" integer NOT NULL, "department" character varying(16) NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'pending', "cleared_by" integer, "cleared_by_name" character varying(120), "cleared_at" TIMESTAMP WITH TIME ZONE, "remarks" character varying(255), "blocker_snapshot" character varying(255), CONSTRAINT "PK_student_noc_items" PRIMARY KEY ("id"), CONSTRAINT "FK_student_noc_items_noc" FOREIGN KEY ("noc_id") REFERENCES "student_nocs"("id") ON DELETE CASCADE, CONSTRAINT "CHK_student_noc_items_status" CHECK ("status" IN ('pending', 'cleared')), CONSTRAINT "CHK_student_noc_items_department" CHECK ("department" IN ('fees', 'library', 'transport', 'inventory', 'class_teacher')))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_student_noc_items_department" ON "student_noc_items" ("noc_id", "department")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "student_noc_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "student_nocs"`);
  }
}
