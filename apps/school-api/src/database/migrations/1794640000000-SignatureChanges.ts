import { MigrationInterface, QueryRunner } from 'typeorm';

export class SignatureChanges1794640000000 implements MigrationInterface {
  name = 'SignatureChanges1794640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "signature_changes" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "side" character varying(8) NOT NULL, "staff_id" integer, "guardian_id" integer, "owner_user_id" integer, "action" character varying(8) NOT NULL, "old_file_id" integer, "new_file_id" integer, "changed_by" integer NOT NULL, "by_admin" boolean NOT NULL DEFAULT false, "note" character varying(120), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_signature_changes" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_signature_changes_guardian" ON "signature_changes" ("guardian_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_signature_changes_staff" ON "signature_changes" ("staff_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_signature_changes_school" ON "signature_changes" ("school_id") `);
    await queryRunner.query(
      `ALTER TABLE "report_card_signatures" ADD "teacher_signature_updated_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_card_signatures" ADD "parent_signature_updated_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "report_card_signatures" DROP COLUMN "parent_signature_updated_at"`);
    await queryRunner.query(`ALTER TABLE "report_card_signatures" DROP COLUMN "teacher_signature_updated_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_signature_changes_school"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_signature_changes_staff"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_signature_changes_guardian"`);
    await queryRunner.query(`DROP TABLE "signature_changes"`);
  }
}
