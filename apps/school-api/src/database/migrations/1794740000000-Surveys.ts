import { MigrationInterface, QueryRunner } from 'typeorm';

export class Surveys1794740000000 implements MigrationInterface {
  name = 'Surveys1794740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "surveys" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "academic_year_id" integer NOT NULL, "title" character varying(150) NOT NULL, "description" text, "audience" character varying(10) NOT NULL DEFAULT 'parents', "class_ids" integer array, "section_ids" integer array, "staff_groups" character varying(10) array, "is_anonymous" boolean NOT NULL DEFAULT false, "per_child" boolean NOT NULL DEFAULT false, "status" character varying(10) NOT NULL DEFAULT 'draft', "send_at" TIMESTAMP WITH TIME ZONE, "closes_at" TIMESTAMP WITH TIME ZONE, "sent_at" TIMESTAMP WITH TIME ZONE, "closed_at" TIMESTAMP WITH TIME ZONE, "reminder_sent_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_1b5e3d4aaeb2321ffa98498c971" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_13d1ba69f6a2895958420f1740" ON "surveys" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_surveys_status_due" ON "surveys" ("status", "send_at", "closes_at") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_surveys_school_year_status" ON "surveys" ("school_id", "academic_year_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "survey_questions" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "survey_id" integer NOT NULL, "type" character varying(15) NOT NULL, "text" character varying(300) NOT NULL, "options" jsonb NOT NULL DEFAULT '[]', "is_required" boolean NOT NULL DEFAULT true, "sort_order" smallint NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_131815624efb0f0e15a220102de" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_survey_questions_survey" ON "survey_questions" ("survey_id", "sort_order") `,
    );
    await queryRunner.query(
      `CREATE TABLE "survey_recipients" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "survey_id" integer NOT NULL, "user_id" integer NOT NULL, "student_id" integer, "kind" character varying(6) NOT NULL, "name" character varying(150) NOT NULL, "students" jsonb NOT NULL DEFAULT '[]', "notified_at" TIMESTAMP WITH TIME ZONE, "reminded_at" TIMESTAMP WITH TIME ZONE, "answered_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1d83b3e32eb4afa8c87c71764b0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_survey_recipients_user" ON "survey_recipients" ("user_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_survey_recipients_survey" ON "survey_recipients" ("survey_id", "answered_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_recipients_slot" ON "survey_recipients" ("survey_id", "user_id", (COALESCE("student_id", 0)))`,
    );
    await queryRunner.query(
      `CREATE TABLE "survey_responses" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "survey_id" integer NOT NULL, "recipient_id" integer NOT NULL, "submitted_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_349995c51959d139d8e485a58ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_responses_recipient" ON "survey_responses" ("recipient_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_survey_responses_survey" ON "survey_responses" ("survey_id", "submitted_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "survey_answers" ("id" SERIAL NOT NULL, "school_id" integer NOT NULL, "response_id" integer NOT NULL, "question_id" integer NOT NULL, "value" jsonb NOT NULL, CONSTRAINT "PK_e4cab112318f766c93435f77a1a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_survey_answers_question" ON "survey_answers" ("question_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_survey_answers_response" ON "survey_answers" ("response_id") `);
    await queryRunner.query(
      `CREATE TABLE "survey_templates" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL, "key" character varying(40), "title" character varying(150) NOT NULL, "description" text, "questions" jsonb NOT NULL DEFAULT '[]', "is_active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_938015fccae381778b558d2af89" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_3a54a7973503f3e63d77137b03" ON "survey_templates" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_survey_templates_school" ON "survey_templates" ("school_id", "sort_order") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_templates_school_key" ON "survey_templates" ("school_id", "key") WHERE key IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_survey_templates_school_key"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_survey_templates_school"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3a54a7973503f3e63d77137b03"`);
    await queryRunner.query(`DROP TABLE "survey_templates"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_survey_answers_response"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_survey_answers_question"`);
    await queryRunner.query(`DROP TABLE "survey_answers"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_survey_responses_survey"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_survey_responses_recipient"`);
    await queryRunner.query(`DROP TABLE "survey_responses"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_survey_recipients_slot"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_survey_recipients_survey"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_survey_recipients_user"`);
    await queryRunner.query(`DROP TABLE "survey_recipients"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_survey_questions_survey"`);
    await queryRunner.query(`DROP TABLE "survey_questions"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_surveys_school_year_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_surveys_status_due"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_13d1ba69f6a2895958420f1740"`);
    await queryRunner.query(`DROP TABLE "surveys"`);
  }
}
