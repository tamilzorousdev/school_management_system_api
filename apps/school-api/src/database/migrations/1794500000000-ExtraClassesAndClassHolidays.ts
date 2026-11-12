import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtraClassesAndClassHolidays1794500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "special_classes" ADD "kind" character varying(10) NOT NULL DEFAULT 'extra'`);
    await queryRunner.query(
      `ALTER TABLE "special_classes" ADD "timing" character varying(12) NOT NULL DEFAULT 'period'`,
    );
    await queryRunner.query(`ALTER TABLE "special_classes" ALTER COLUMN "day_of_week" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "special_classes" ALTER COLUMN "period_no" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "special_classes" ADD "days" smallint array`);
    await queryRunner.query(`ALTER TABLE "special_classes" ADD "start_time" character varying(5)`);
    await queryRunner.query(`ALTER TABLE "special_classes" ADD "end_time" character varying(5)`);
    await queryRunner.query(`ALTER TABLE "special_classes" ADD "start_date" date`);
    await queryRunner.query(`ALTER TABLE "special_classes" ADD "end_date" date`);
    await queryRunner.query(`ALTER TABLE "special_classes" ADD "day_part" character varying(10)`);
    await queryRunner.query(
      `CREATE TABLE "special_class_attendance" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "special_class_id" integer NOT NULL, "date" date NOT NULL, "student_id" integer NOT NULL, "status" character varying(10) NOT NULL, "marked_by" integer, "alert_sent" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_special_class_attendance" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_special_class_attendance_school" ON "special_class_attendance" ("school_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_special_class_attendance_class" ON "special_class_attendance" ("special_class_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_special_class_attendance_student" ON "special_class_attendance" ("student_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_special_class_attendance" ON "special_class_attendance" ("special_class_id", "date", "student_id") `,
    );
    await queryRunner.query(`ALTER TABLE "holidays" ADD "class_ids" integer array`);
    await queryRunner.query(`ALTER TABLE "schools" ADD "special_class_class_ids" integer array`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "special_class_class_ids"`);
    await queryRunner.query(`ALTER TABLE "holidays" DROP COLUMN "class_ids"`);
    await queryRunner.query(`DROP TABLE "special_class_attendance"`);
    await queryRunner.query(`ALTER TABLE "special_classes" DROP COLUMN "day_part"`);
    await queryRunner.query(`ALTER TABLE "special_classes" DROP COLUMN "end_date"`);
    await queryRunner.query(`ALTER TABLE "special_classes" DROP COLUMN "start_date"`);
    await queryRunner.query(`ALTER TABLE "special_classes" DROP COLUMN "end_time"`);
    await queryRunner.query(`ALTER TABLE "special_classes" DROP COLUMN "start_time"`);
    await queryRunner.query(`ALTER TABLE "special_classes" DROP COLUMN "days"`);
    await queryRunner.query(`ALTER TABLE "special_classes" DROP COLUMN "timing"`);
    await queryRunner.query(`ALTER TABLE "special_classes" DROP COLUMN "kind"`);
  }
}
