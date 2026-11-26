import { MigrationInterface, QueryRunner } from 'typeorm';
import { AlumniRecordsService } from '../../modules/alumni/alumni-records.service';
import { SequencesService } from '../../modules/schools/sequences.service';

export class AlumniFromTransferCertificates1795510000000 implements MigrationInterface {
  name = 'AlumniFromTransferCertificates1795510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const students = (await queryRunner.query(
      `SELECT s.id, s.school_id FROM students s
       WHERE s.status IN ('transferred', 'withdrawn') AND s.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM transfer_certificates t WHERE t.student_id = s.id AND t.deleted_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM alumni a WHERE a.student_id = s.id AND a.deleted_at IS NULL)
       ORDER BY s.school_id, s.id`,
    )) as { id: number; school_id: number }[];
    const records = new AlumniRecordsService(new SequencesService());
    for (const student of students) {
      await records.convert(queryRunner.manager, Number(student.school_id), Number(student.id), {
        id: null,
        name: 'Transfer certificate',
      });
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT DISTINCT alumni_id FROM alumni_timeline
       WHERE action = 'converted' AND actor_name = 'Transfer certificate' AND actor_user_id IS NULL`,
    )) as { alumni_id: number }[];
    const ids = rows.map((row) => Number(row.alumni_id));
    if (!ids.length) return;
    await queryRunner.query(`DELETE FROM alumni_academic_history WHERE alumni_id = ANY($1)`, [ids]);
    await queryRunner.query(`DELETE FROM alumni_timeline WHERE alumni_id = ANY($1)`, [ids]);
    await queryRunner.query(`DELETE FROM alumni WHERE id = ANY($1)`, [ids]);
  }
}
