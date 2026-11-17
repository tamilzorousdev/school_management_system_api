import { MigrationInterface, QueryRunner } from 'typeorm';

export class RouteChanges1794680000000 implements MigrationInterface {
  name = 'RouteChanges1794680000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "route_changes" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "route_id" integer NOT NULL, "stop_id" integer, "student_id" integer, "kind" character varying(16) NOT NULL, "summary" character varying(255) NOT NULL, "parents_told" integer NOT NULL DEFAULT '0', "changed_by" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_route_changes" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_route_changes_school" ON "route_changes" ("school_id") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_route_changes_route" ON "route_changes" ("route_id") `);
    await queryRunner.query(
      `ALTER TABLE "student_transport" ADD IF NOT EXISTS "pass_status" character varying(10) NOT NULL DEFAULT 'active'`,
    );
    await queryRunner.query(`ALTER TABLE "student_transport" ADD IF NOT EXISTS "pass_note" character varying(255)`);
    await queryRunner.query(
      `ALTER TABLE "student_transport" ADD IF NOT EXISTS "pass_changed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "student_transport" ADD IF NOT EXISTS "pass_changed_by" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "student_transport" DROP COLUMN "pass_changed_by"`);
    await queryRunner.query(`ALTER TABLE "student_transport" DROP COLUMN "pass_changed_at"`);
    await queryRunner.query(`ALTER TABLE "student_transport" DROP COLUMN "pass_note"`);
    await queryRunner.query(`ALTER TABLE "student_transport" DROP COLUMN "pass_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_route_changes_route"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_route_changes_school"`);
    await queryRunner.query(`DROP TABLE "route_changes"`);
  }
}
