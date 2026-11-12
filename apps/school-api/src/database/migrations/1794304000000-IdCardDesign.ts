import { MigrationInterface, QueryRunner } from 'typeorm';

export class IdCardDesign1794304000000 implements MigrationInterface {
  name = 'IdCardDesign1794304000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "schools"
      ADD COLUMN IF NOT EXISTS "id_card_design" varchar(30) DEFAULT 'design2'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "schools"
      DROP COLUMN IF EXISTS "id_card_design"
    `);
  }
}
