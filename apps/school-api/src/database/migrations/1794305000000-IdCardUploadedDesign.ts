import { MigrationInterface, QueryRunner } from 'typeorm';

export class IdCardUploadedDesign1794305000000 implements MigrationInterface {
  name = 'IdCardUploadedDesign1794305000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "schools"
      ADD COLUMN IF NOT EXISTS "id_card_front_file_id" int,
      ADD COLUMN IF NOT EXISTS "id_card_back_file_id" int
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "schools"
      DROP COLUMN IF EXISTS "id_card_front_file_id",
      DROP COLUMN IF EXISTS "id_card_back_file_id"
    `);
  }
}
