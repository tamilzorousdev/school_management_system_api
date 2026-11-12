import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassBellSchedule1794463000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bell_periods" ADD "class_id" integer`);
    await queryRunner.query(
      `CREATE INDEX "IDX_bell_periods_school_class" ON "bell_periods" ("school_id", "class_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "bell_periods" ADD CONSTRAINT "FK_bell_periods_class_id" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bell_periods" DROP CONSTRAINT "FK_bell_periods_class_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_bell_periods_school_class"`);
    await queryRunner.query(`ALTER TABLE "bell_periods" DROP COLUMN "class_id"`);
  }
}
