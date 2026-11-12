import { MigrationInterface, QueryRunner } from 'typeorm';

export class IdCardLayout1794306000000 implements MigrationInterface {
  name = 'IdCardLayout1794306000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "id_card_layout" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN IF EXISTS "id_card_layout"`);
  }
}
