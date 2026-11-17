import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudentTransportStops1794640000000 implements MigrationInterface {
  name = 'StudentTransportStops1794640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "student_transport" ADD "drop_stop_id" integer`);
    await queryRunner.query(
      `CREATE INDEX "IDX_student_transport_drop_stop" ON "student_transport" ("drop_stop_id") WHERE drop_stop_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "student_transport_changes" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "student_id" integer NOT NULL, "action" character varying(10) NOT NULL, "from_route_id" integer, "from_stop_id" integer, "from_drop_stop_id" integer, "to_route_id" integer, "to_stop_id" integer, "to_drop_stop_id" integer, "mode" character varying(10), CONSTRAINT "PK_student_transport_changes" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_transport_changes_school" ON "student_transport_changes" ("school_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_transport_changes_student" ON "student_transport_changes" ("school_id", "student_id", "created_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_student_transport_changes_student"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_student_transport_changes_school"`);
    await queryRunner.query(`DROP TABLE "student_transport_changes"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_student_transport_drop_stop"`);
    await queryRunner.query(`ALTER TABLE "student_transport" DROP COLUMN "drop_stop_id"`);
  }
}
