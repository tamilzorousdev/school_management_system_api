import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLES = ['students', 'staff'];

export class StudentStaffIdentity1795754736438 implements MigrationInterface {
  name = 'StudentStaffIdentity1795754736438';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD "community" character varying(5), ADD "caste" character varying(80), ADD "religion" character varying(12), ADD "nationality" character varying(40), ADD "mother_tongue" character varying(40), ADD "community_certificate_no" character varying(40), ADD "aadhaar_enc" text, ADD "aadhaar_last4" character varying(4)`,
      );
    }
    await queryRunner.query(
      `CREATE INDEX "IDX_students_school_community" ON "students" ("school_id", "community") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_students_school_community"`);
    for (const table of TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN "aadhaar_last4", DROP COLUMN "aadhaar_enc", DROP COLUMN "community_certificate_no", DROP COLUMN "mother_tongue", DROP COLUMN "nationality", DROP COLUMN "religion", DROP COLUMN "caste", DROP COLUMN "community"`,
      );
    }
  }
}
