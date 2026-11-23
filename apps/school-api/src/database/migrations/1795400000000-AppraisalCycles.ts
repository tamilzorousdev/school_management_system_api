import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE =
  '"id" SERIAL NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_by" integer, "school_id" integer NOT NULL';

const MOVED_GROUP = 'Moved from the earlier KRA setup';
const EMPTY_RULES = '{"staff_types":[],"departments":[],"designations":[],"roles":[]}';
const BANDS =
  '{"outstanding":12,"exceeds_expectations":10,"meets_expectations":7,"needs_improvement":3,"unsatisfactory":0}';

const LEGACY_KRAS: [string, string, string, number][] = [
  ['teaching_effectiveness', 'Teaching effectiveness', 'pedagogy', 25],
  ['student_outcomes', 'Student outcomes', 'academics', 25],
  ['classroom_management', 'Classroom management', 'administrative', 20],
  ['professional_conduct', 'Professional conduct', 'general', 15],
  ['extracurricular_contribution', 'Extracurricular contribution', 'extracurricular', 15],
];

interface OldAppraisal {
  id: number;
  school_id: number;
  academic_year_id: number;
  staff_id: number;
  user_id: number;
  status: string;
  overall_score: string;
  overall_rating: string;
  recommendation: string;
  increment_percent: string | null;
  expected_increment_percent: string | null;
  hike_justification: string | null;
  strengths: string | null;
  areas_for_improvement: string | null;
  goals_next_period: string | null;
  reviewer_remarks: string | null;
  staff_remarks: string | null;
  finalized_at: Date | null;
  finalized_by: number | null;
  created_at: Date;
  kra_scores: unknown;
  appeal_status: string | null;
  appeal_reason: string | null;
  appeal_requested_hike: string | null;
  appeal_feedback: string | null;
  appealed_at: Date | null;
  appeal_resolved_at: Date | null;
  appeal_resolved_by: number | null;
  [key: string]: unknown;
}

export class AppraisalCycles1795400000000 implements MigrationInterface {
  name = 'AppraisalCycles1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "appraisal_groups" (${BASE}, "academic_year_id" integer NOT NULL, "name" character varying(100) NOT NULL, "description" text, "rules" jsonb NOT NULL, "is_default" boolean NOT NULL DEFAULT false, "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_c640199e9e1039c0751650fcd20" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_422d7674c036b469c95fcd1530" ON "appraisal_groups" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_appraisal_groups_school_year" ON "appraisal_groups" ("school_id", "academic_year_id") `,
    );

    await queryRunner.query(
      `CREATE TABLE "appraisal_group_members" (${BASE}, "group_id" integer NOT NULL, "staff_id" integer NOT NULL, "mode" character varying(10) NOT NULL, CONSTRAINT "PK_7f77eaba5f8c45c1f7c34f266c7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9fc7b56cacf5bc9cf9b29a89c0" ON "appraisal_group_members" ("school_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_appraisal_group_members" ON "appraisal_group_members" ("group_id", "staff_id") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "appraisal_kras" (${BASE}, "group_id" integer NOT NULL, "code" character varying(50) NOT NULL, "title" character varying(150) NOT NULL, "description" text, "category" character varying(20) NOT NULL DEFAULT 'general', "weightage_percent" numeric(5,2) NOT NULL, "max_score" smallint NOT NULL DEFAULT '5', "scoring_mode" character varying(10) NOT NULL DEFAULT 'manual', "auto_metric" character varying(40), "auto_target" numeric(8,2), "sort_order" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_0a2b68c8026e28af1d2256e7370" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_0d40120f024e0c32f40bb43c2f" ON "appraisal_kras" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_appraisal_kras_group_code" ON "appraisal_kras" ("group_id", "code") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "appraisal_cycles" (${BASE}, "academic_year_id" integer NOT NULL, "title" character varying(150) NOT NULL, "description" text, "group_ids" integer array NOT NULL DEFAULT '{}', "self_opens_at" TIMESTAMP WITH TIME ZONE, "self_due_at" TIMESTAMP WITH TIME ZONE NOT NULL, "hod_due_at" TIMESTAMP WITH TIME ZONE NOT NULL, "final_due_at" TIMESTAMP WITH TIME ZONE NOT NULL, "appeal_days" smallint NOT NULL DEFAULT '7', "increment_bands" jsonb NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'draft', "is_legacy" boolean NOT NULL DEFAULT false, "opened_at" TIMESTAMP WITH TIME ZONE, "closed_at" TIMESTAMP WITH TIME ZONE, "self_reminder_sent_at" TIMESTAMP WITH TIME ZONE, "self_moved_at" TIMESTAMP WITH TIME ZONE, "hod_reminder_sent_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_f677a325911322fb9328bbb0b9d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_897d97cc6f83900404373266cd" ON "appraisal_cycles" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_appraisal_cycles_school_year" ON "appraisal_cycles" ("school_id", "academic_year_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_appraisal_cycles_status" ON "appraisal_cycles" ("status", "self_opens_at") `,
    );

    await queryRunner.query(
      `CREATE TABLE "appraisals" (${BASE}, "cycle_id" integer NOT NULL, "academic_year_id" integer NOT NULL, "staff_id" integer NOT NULL, "user_id" integer NOT NULL, "group_id" integer NOT NULL, "hod_user_id" integer, "stage" character varying(20) NOT NULL DEFAULT 'self_pending', "self_missed" boolean NOT NULL DEFAULT false, "self_submitted_at" TIMESTAMP WITH TIME ZONE, "hod_submitted_at" TIMESTAMP WITH TIME ZONE, "published_at" TIMESTAMP WITH TIME ZONE, "published_by" integer, "acknowledged_at" TIMESTAMP WITH TIME ZONE, "self_percent" numeric(5,2), "hod_percent" numeric(5,2), "final_percent" numeric(5,2), "rating" character varying(30), "recommendation" character varying(20), "suggested_increment" numeric(4,1), "increment_percent" numeric(4,1), "expected_increment_percent" numeric(4,1), "hike_justification" text, "strengths" text, "improvements" text, "goals" text, "hod_remarks" text, "principal_remarks" text, "staff_remarks" text, CONSTRAINT "PK_c4c4dfe76db3c762a3193370d02" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_226db0c50973b67a7cc79b5e09" ON "appraisals" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_appraisals_cycle_staff" ON "appraisals" ("cycle_id", "staff_id") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_appraisals_user" ON "appraisals" ("user_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_appraisals_hod" ON "appraisals" ("hod_user_id", "stage") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_appraisals_school_year_stage" ON "appraisals" ("school_id", "academic_year_id", "stage") `,
    );

    await queryRunner.query(
      `CREATE TABLE "appraisal_scores" (${BASE}, "appraisal_id" integer NOT NULL, "kra_id" integer, "code" character varying(50) NOT NULL, "title" character varying(150) NOT NULL, "description" text, "weightage_percent" numeric(5,2) NOT NULL, "max_score" smallint NOT NULL DEFAULT '5', "scoring_mode" character varying(10) NOT NULL DEFAULT 'manual', "auto_metric" character varying(40), "auto_target" numeric(8,2), "sort_order" integer NOT NULL DEFAULT '0', "auto_value" numeric(8,2), "auto_score" numeric(4,2), "self_score" numeric(4,2), "self_comment" text, "hod_score" numeric(4,2), "hod_comment" text, "final_score" numeric(4,2), "override_reason" text, CONSTRAINT "PK_8090a39d5652e085bebeb661b7b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_d1cb52c1b5a97dd09ab5dddbf0" ON "appraisal_scores" ("school_id") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_appraisal_scores_kra" ON "appraisal_scores" ("appraisal_id", "kra_id") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "appraisal_evidence" (${BASE}, "appraisal_id" integer NOT NULL, "score_id" integer, "file_id" integer NOT NULL, CONSTRAINT "PK_c10352d5d97303eae6598e56b49" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_df0808c55a586e6b215ff6f373" ON "appraisal_evidence" ("school_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_appraisal_evidence_appraisal" ON "appraisal_evidence" ("appraisal_id") `,
    );

    await queryRunner.query(
      `CREATE TABLE "appraisal_appeals" (${BASE}, "appraisal_id" integer NOT NULL, "reason" text NOT NULL, "requested_increment" numeric(4,1), "status" character varying(10) NOT NULL DEFAULT 'pending', "decided_by" integer, "decided_at" TIMESTAMP WITH TIME ZONE, "decision_note" text, CONSTRAINT "PK_94a15165353331ab9a77fe80368" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_43d4569b04d1911fdda0bbc159" ON "appraisal_appeals" ("school_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_appraisal_appeals_appraisal" ON "appraisal_appeals" ("appraisal_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_appraisal_appeals_school_status" ON "appraisal_appeals" ("school_id", "status") `,
    );

    await this.moveOldData(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'appraisal_appeals',
      'appraisal_evidence',
      'appraisal_scores',
      'appraisals',
      'appraisal_cycles',
      'appraisal_kras',
      'appraisal_group_members',
      'appraisal_groups',
    ]) {
      await queryRunner.query(`DROP TABLE "${table}"`);
    }
  }

  private async moveOldData(queryRunner: QueryRunner): Promise<void> {
    const [tables] = await queryRunner.query(
      `SELECT to_regclass('public.kra_configs') IS NOT NULL AS kras, to_regclass('public.staff_appraisals') IS NOT NULL AS reviews`,
    );
    if (!tables.kras || !tables.reviews) return;

    await queryRunner.query(
      `INSERT INTO appraisal_groups (school_id, academic_year_id, name, description, rules, is_default, sort_order, is_active)
       SELECT s.school_id, s.year_id, 'All staff', $1, $2::jsonb, true, 99, true
       FROM (
         SELECT x.school_id,
                COALESCE((SELECT y.id FROM academic_years y WHERE y.school_id = x.school_id AND y.is_current AND y.deleted_at IS NULL LIMIT 1),
                         MAX(x.academic_year_id)) AS year_id
         FROM (SELECT school_id, academic_year_id FROM kra_configs WHERE deleted_at IS NULL AND is_active
               UNION ALL SELECT school_id, academic_year_id FROM staff_appraisals WHERE deleted_at IS NULL) x
         GROUP BY x.school_id
       ) s
       WHERE s.year_id IS NOT NULL`,
      [MOVED_GROUP, EMPTY_RULES],
    );

    await queryRunner.query(
      `INSERT INTO appraisal_kras (school_id, group_id, code, title, description, category, weightage_percent, max_score, scoring_mode, sort_order)
       SELECT g.school_id, g.id, LEFT(k.code, 50), LEFT(k.title, 150), k.description,
              CASE WHEN k.category IN ('academics','pedagogy','administrative','extracurricular','general') THEN k.category ELSE 'general' END,
              k.weightage_percent, GREATEST(2, LEAST(10, ROUND(k.max_score)::int)), 'manual',
              ROW_NUMBER() OVER (PARTITION BY g.id ORDER BY k.sort_order, k.id)
       FROM appraisal_groups g
       JOIN (SELECT DISTINCT ON (school_id, code) * FROM kra_configs WHERE is_active AND deleted_at IS NULL
             ORDER BY school_id, code, id DESC) k ON k.school_id = g.school_id
       WHERE g.description = $1`,
      [MOVED_GROUP],
    );

    for (const [index, [code, title, category, weight]] of LEGACY_KRAS.entries()) {
      await queryRunner.query(
        `INSERT INTO appraisal_kras (school_id, group_id, code, title, category, weightage_percent, max_score, scoring_mode, sort_order)
         SELECT g.school_id, g.id, $2::varchar, $3::varchar, $4::varchar, $5::numeric, 5, 'manual', $6::int
         FROM appraisal_groups g
         WHERE g.description = $1::text AND NOT EXISTS (
           SELECT 1 FROM appraisal_kras k WHERE k.group_id = g.id
             AND k.code::varchar NOT IN (${LEGACY_KRAS.map((_, i) => `$${i + 7}::varchar`).join(', ')}))
           AND NOT EXISTS (SELECT 1 FROM appraisal_kras k WHERE k.group_id = g.id AND k.code = $2::varchar)`,
        [MOVED_GROUP, code, title, category, weight, index + 1, ...LEGACY_KRAS.map(([legacy]) => legacy)],
      );
    }

    await queryRunner.query(
      `INSERT INTO appraisal_cycles (school_id, academic_year_id, title, description, group_ids, self_due_at, hod_due_at, final_due_at, appeal_days, increment_bands, status, is_legacy, opened_at, closed_at)
       SELECT a.school_id, a.academic_year_id, LEFT('Earlier reviews ' || COALESCE(y.name, ''), 150),
              'Reviews made before appraisal cycles', ARRAY[g.id], a.last_at, a.last_at, a.last_at, 7, $2::jsonb,
              'closed', true, a.last_at, a.last_at
       FROM (SELECT school_id, academic_year_id, MAX(review_date)::timestamptz AS last_at
             FROM staff_appraisals WHERE deleted_at IS NULL GROUP BY school_id, academic_year_id) a
       JOIN appraisal_groups g ON g.school_id = a.school_id AND g.description = $1
       LEFT JOIN academic_years y ON y.id = a.academic_year_id`,
      [MOVED_GROUP, BANDS],
    );

    const rows: OldAppraisal[] = await queryRunner.query(
      `SELECT DISTINCT ON (school_id, academic_year_id, staff_id) *
       FROM staff_appraisals WHERE deleted_at IS NULL
       ORDER BY school_id, academic_year_id, staff_id, id DESC`,
    );
    for (const old of rows) {
      const [cycle] = await queryRunner.query(
        `SELECT id, group_ids[1] AS group_id FROM appraisal_cycles
         WHERE school_id = $1 AND academic_year_id = $2 AND is_legacy LIMIT 1`,
        [old.school_id, old.academic_year_id],
      );
      if (!cycle) continue;
      const done = old.status === 'finalized';
      const appealed = old.appeal_status === 'pending';
      const decided = done || appealed;
      const stage = done ? 'completed' : appealed ? 'appealed' : 'principal_pending';
      const percent = decided ? Math.round((Number(old.overall_score) / 5) * 10000) / 100 : null;
      const [created] = await queryRunner.query(
        `INSERT INTO appraisals (school_id, cycle_id, academic_year_id, staff_id, user_id, group_id, stage,
           published_at, published_by, acknowledged_at, final_percent, rating, recommendation, increment_percent,
           expected_increment_percent, hike_justification, strengths, improvements, goals, principal_remarks,
           staff_remarks, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         RETURNING id`,
        [
          old.school_id,
          cycle.id,
          old.academic_year_id,
          old.staff_id,
          old.user_id,
          cycle.group_id,
          stage,
          decided ? old.finalized_at : null,
          decided ? old.finalized_by : null,
          done && old.staff_remarks ? old.finalized_at : null,
          percent,
          decided ? old.overall_rating : null,
          old.recommendation,
          old.increment_percent,
          old.expected_increment_percent,
          old.hike_justification,
          old.strengths,
          old.areas_for_improvement,
          old.goals_next_period,
          old.reviewer_remarks,
          old.staff_remarks,
          old.created_at,
        ],
      );
      const scores = this.oldScores(old);
      for (const [position, score] of scores.entries()) {
        await queryRunner.query(
          `INSERT INTO appraisal_scores (school_id, appraisal_id, code, title, weightage_percent, max_score, scoring_mode,
             sort_order, hod_score, hod_comment, final_score)
           VALUES ($1, $2, $3, $4, $5, 5, 'manual', $6, $7, $8, $9)`,
          [
            old.school_id,
            created.id,
            score.code,
            score.title,
            score.weightage,
            position + 1,
            decided ? null : score.score,
            score.remarks,
            decided ? score.score : null,
          ],
        );
      }
      if (old.appeal_status && old.appeal_status !== 'none' && old.appeal_reason) {
        await queryRunner.query(
          `INSERT INTO appraisal_appeals (school_id, appraisal_id, reason, requested_increment, status, decided_by,
             decided_at, decision_note, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()))`,
          [
            old.school_id,
            created.id,
            old.appeal_reason,
            old.appeal_requested_hike,
            old.appeal_status === 'resolved' ? 'accepted' : old.appeal_status === 'rejected' ? 'rejected' : 'pending',
            old.appeal_resolved_by,
            old.appeal_resolved_at,
            old.appeal_feedback,
            old.appealed_at,
          ],
        );
      }
    }
  }

  private oldScores(old: OldAppraisal) {
    const parsed = typeof old.kra_scores === 'string' ? JSON.parse(old.kra_scores) : old.kra_scores;
    const list = Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
    const fromKras = list
      .filter((item) => item && typeof item.code === 'string')
      .map((item) => ({
        code: String(item.code).slice(0, 50),
        title: String(item.title ?? item.code).slice(0, 150),
        weightage: Number(item.weightage ?? 0),
        score: clamp(Number(item.score ?? 0)),
        remarks: typeof item.remarks === 'string' ? item.remarks : null,
      }));
    if (fromKras.length) return fromKras;
    return LEGACY_KRAS.map(([code, title, , weight]) => ({
      code,
      title,
      weightage: weight,
      score: clamp(Number(old[code] ?? 0)),
      remarks: null,
    }));
  }
}

function clamp(value: number): number {
  return Math.min(5, Math.max(1, Math.round(value * 10) / 10));
}
