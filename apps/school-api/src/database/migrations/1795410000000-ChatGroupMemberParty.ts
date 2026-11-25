import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatGroupMemberParty1795410000000 implements MigrationInterface {
  name = 'ChatGroupMemberParty1795410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_group_members" ADD "party" character varying(10)`);
    await queryRunner.query(
      `UPDATE "chat_group_members" gm SET "party" = sides.party
       FROM (
         SELECT ur.user_id,
                CASE
                  WHEN bool_or(r.code IN ('TEACHER', 'HOD', 'PRINCIPAL')) AND NOT bool_or(r.code = 'PARENT') THEN 'teacher'
                  WHEN bool_or(r.code = 'PARENT') AND NOT bool_or(r.code IN ('TEACHER', 'HOD', 'PRINCIPAL')) THEN 'parent'
                END AS party
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         GROUP BY ur.user_id
       ) sides
       WHERE sides.user_id = gm.user_id AND sides.party IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_group_members" DROP COLUMN "party"`);
  }
}
