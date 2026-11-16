import { MigrationInterface, QueryRunner } from 'typeorm';

export class CrewProfiles1794630000000 implements MigrationInterface {
  name = 'CrewProfiles1794630000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "staff" ADD "licence_type" character varying(20)`);
    await queryRunner.query(`ALTER TABLE "staff" ADD "licence_issued_on" date`);
    await queryRunner.query(`ALTER TABLE "staff" ADD "badge_no" character varying(30)`);
    await queryRunner.query(`ALTER TABLE "staff" ADD "badge_expiry" date`);
    await queryRunner.query(`ALTER TABLE "staff" ADD "medical_fitness_expiry" date`);
    await queryRunner.query(`ALTER TABLE "staff" ADD "police_verified_on" date`);
    await queryRunner.query(`ALTER TABLE "staff" ADD "police_verification_expiry" date`);
    await queryRunner.query(`ALTER TABLE "staff" ADD "duty_approved_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "staff" ADD "duty_approved_by" integer`);
    await queryRunner.query(`ALTER TABLE "staff" ADD "duty_approved_until" date`);
    await queryRunner.query(`ALTER TABLE "staff" ADD "last_reminded_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "staff" ADD "last_reminded_by" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "staff" DROP COLUMN "last_reminded_by"`);
    await queryRunner.query(`ALTER TABLE "staff" DROP COLUMN "last_reminded_at"`);
    await queryRunner.query(`ALTER TABLE "staff" DROP COLUMN "duty_approved_until"`);
    await queryRunner.query(`ALTER TABLE "staff" DROP COLUMN "duty_approved_by"`);
    await queryRunner.query(`ALTER TABLE "staff" DROP COLUMN "duty_approved_at"`);
    await queryRunner.query(`ALTER TABLE "staff" DROP COLUMN "police_verification_expiry"`);
    await queryRunner.query(`ALTER TABLE "staff" DROP COLUMN "police_verified_on"`);
    await queryRunner.query(`ALTER TABLE "staff" DROP COLUMN "medical_fitness_expiry"`);
    await queryRunner.query(`ALTER TABLE "staff" DROP COLUMN "badge_expiry"`);
    await queryRunner.query(`ALTER TABLE "staff" DROP COLUMN "badge_no"`);
    await queryRunner.query(`ALTER TABLE "staff" DROP COLUMN "licence_issued_on"`);
    await queryRunner.query(`ALTER TABLE "staff" DROP COLUMN "licence_type"`);
  }
}
