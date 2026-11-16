import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { appConfig, AppConfig } from '../../config/configuration';
import { yearClause } from '../../shared/year-context';
import { ROLES } from '../access/access.catalog';
import { FilesService } from '../files/files.service';
import { TEMPLATES } from '../notifications/notification-templates.catalog';
import { NotificationsService } from '../notifications/notifications.service';
import { Staff } from '../staff/entities/staff.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { User } from '../users/entities/user.entity';
import { SignatureChangeDto, SignatureDetailDto, SignatureSavedDto } from './dto/signature.dto';
import { SignatureChange, SignatureSide } from './entities/signature-change.entity';
import {
  actionOf,
  canUseAgain,
  changeImage,
  COPY_NOTE,
  REUSE_NOTE,
  shouldCopyToParent,
  shortDate,
  TEACHER_KEPT_MESSAGE,
  teacherSaveMessage,
} from './signatures.logic';

export interface SignatureActor {
  user_id: number;
  by_admin: boolean;
}

interface Owner {
  side: SignatureSide;
  school_id: number;
  staff_id: number | null;
  guardian_id: number | null;
  user_id: number | null;
  file_id: number | null;
}

@Injectable()
export class SignaturesService {
  private readonly logger = new Logger(SignaturesService.name);

  constructor(
    @InjectRepository(SignatureChange) private readonly changes: Repository<SignatureChange>,
    private readonly dataSource: DataSource,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async saveTeacher(
    staff: Staff,
    fileId: number | null,
    actor: SignatureActor,
    note: string | null = null,
  ): Promise<SignatureSavedDto> {
    await this.assertImage(staff.school_id, fileId);
    const parent = await this.dataSource
      .getRepository(Guardian)
      .findOne({ where: { user_id: staff.user_id, school_id: staff.school_id }, order: { id: 'ASC' } });
    let copied = false;
    await this.dataSource.transaction(async (manager) => {
      await this.apply(manager, this.teacherOwner(staff), fileId, actor, note);
      if (parent && !actor.by_admin && shouldCopyToParent(fileId, parent.signature_file_id, true)) {
        await this.apply(manager, this.parentOwner(parent), fileId, actor, COPY_NOTE);
        copied = true;
      }
    });
    if (actor.by_admin) this.tellOwner('teacher', staff.user_id, fileId);
    return {
      signature_file_id: fileId,
      signature_url: this.files.linkFor(fileId),
      parent_signature_copied: copied,
      message: actor.by_admin ? null : teacherSaveMessage(!!parent, copied),
    };
  }

  async saveParent(
    guardian: Guardian,
    fileId: number | null,
    actor: SignatureActor,
    note: string | null = null,
  ): Promise<SignatureSavedDto> {
    await this.assertImage(guardian.school_id, fileId);
    const oldFileId = guardian.signature_file_id;
    const isAlsoStaff = guardian.user_id
      ? await this.dataSource.getRepository(Staff).exists({
          where: { user_id: guardian.user_id, school_id: guardian.school_id },
        })
      : false;
    const changed = await this.dataSource.transaction((manager) =>
      this.apply(manager, this.parentOwner(guardian), fileId, actor, note, !isAlsoStaff),
    );
    if (changed) {
      if (actor.by_admin) this.tellOwner('parent', guardian.user_id, fileId);
      else this.tellSchool(guardian, actionOf(oldFileId, fileId) === 'removed');
    }
    return {
      signature_file_id: fileId,
      signature_url: this.files.linkFor(fileId),
      parent_signature_copied: false,
      message: isAlsoStaff && !actor.by_admin ? TEACHER_KEPT_MESSAGE : null,
    };
  }

  async reuseTeacher(staff: Staff, changeId: number, actor: SignatureActor): Promise<SignatureSavedDto> {
    const change = await this.changes.findOneBy({ id: changeId, staff_id: staff.id, side: 'teacher' });
    return this.saveTeacher(staff, this.earlierFile(change, staff.signature_file_id), actor, REUSE_NOTE);
  }

  async reuseParent(guardian: Guardian, changeId: number, actor: SignatureActor): Promise<SignatureSavedDto> {
    const change = await this.changes.findOneBy({ id: changeId, guardian_id: guardian.id, side: 'parent' });
    return this.saveParent(guardian, this.earlierFile(change, guardian.signature_file_id), actor, REUSE_NOTE);
  }

  private earlierFile(change: SignatureChange | null, currentFileId: number | null): number {
    if (!change || changeImage(change) === null) {
      throw AppException.notFound('This signature is not in the history', 'SIGNATURE_CHANGE_NOT_FOUND');
    }
    if (!canUseAgain(change, currentFileId)) {
      throw AppException.badRequest('This signature is already in use', 'SIGNATURE_ALREADY_IN_USE');
    }
    return changeImage(change)!;
  }

  async ownStaff(schoolId: number | null, userId: number): Promise<Staff> {
    if (!schoolId) throw AppException.forbidden('Your account is not linked to a school', 'NO_SCHOOL');
    const staff = await this.dataSource.getRepository(Staff).findOneBy({ user_id: userId, school_id: schoolId });
    if (!staff) throw AppException.notFound('Staff record not found', 'STAFF_NOT_FOUND');
    return staff;
  }

  async ownGuardian(userId: number): Promise<Guardian> {
    const guardian = await this.dataSource
      .getRepository(Guardian)
      .findOne({ where: { user_id: userId }, order: { id: 'ASC' } });
    if (!guardian) {
      throw AppException.notFound('No parent profile is linked to this login', 'PARENT_PROFILE_NOT_FOUND');
    }
    return guardian;
  }

  async staffById(schoolId: number, id: number): Promise<Staff> {
    const staff = await this.dataSource.getRepository(Staff).findOneBy({ id, school_id: schoolId });
    if (!staff) throw AppException.notFound('Staff not found', 'STAFF_NOT_FOUND');
    return staff;
  }

  async guardianById(schoolId: number, id: number): Promise<Guardian> {
    const guardian = await this.dataSource.getRepository(Guardian).findOneBy({ id, school_id: schoolId });
    if (!guardian) throw AppException.notFound('Parent or guardian not found', 'GUARDIAN_NOT_FOUND');
    return guardian;
  }

  async teacherDetail(staff: Staff): Promise<SignatureDetailDto> {
    const [user] = await this.dataSource.query(`SELECT name FROM users u WHERE u.id = $1`, [staff.user_id]);
    return this.detail(
      'teacher',
      { id: staff.id, name: user?.name ?? '' },
      staff.signature_file_id,
      await this.changes.find({ where: { staff_id: staff.id, side: 'teacher' }, order: { id: 'DESC' }, take: 50 }),
    );
  }

  async parentDetail(guardian: Guardian): Promise<SignatureDetailDto> {
    return this.detail(
      'parent',
      { id: guardian.id, name: guardian.name },
      guardian.signature_file_id,
      await this.changes.find({
        where: { guardian_id: guardian.id, side: 'parent' },
        order: { id: 'DESC' },
        take: 50,
      }),
    );
  }

  private async detail(
    side: SignatureSide,
    owner: { id: number; name: string },
    fileId: number | null,
    rows: SignatureChange[],
  ): Promise<SignatureDetailDto> {
    const ids = [...new Set(rows.map((row) => row.changed_by))];
    const people = ids.length
      ? await this.dataSource
          .getRepository(User)
          .find({ where: { id: In(ids) }, withDeleted: true, select: { id: true, name: true } })
      : [];
    const names = new Map(people.map((person) => [person.id, { id: person.id, name: person.name }]));
    const history: SignatureChangeDto[] = rows.map((row) => ({
      id: row.id,
      side: row.side,
      action: row.action,
      old_url: this.files.linkFor(row.old_file_id),
      new_url: this.files.linkFor(row.new_file_id),
      changed_by: names.get(row.changed_by) ?? null,
      by_admin: row.by_admin,
      note: row.note,
      at: row.created_at,
      can_use_again: canUseAgain(row, fileId),
    }));
    return {
      side,
      owner,
      signature_file_id: fileId,
      signature_url: this.files.linkFor(fileId),
      updated_at: rows[0]?.created_at ?? null,
      history,
    };
  }

  private teacherOwner(staff: Staff): Owner {
    return {
      side: 'teacher',
      school_id: staff.school_id,
      staff_id: staff.id,
      guardian_id: null,
      user_id: staff.user_id,
      file_id: staff.signature_file_id,
    };
  }

  private parentOwner(guardian: Guardian): Owner {
    return {
      side: 'parent',
      school_id: guardian.school_id,
      staff_id: null,
      guardian_id: guardian.id,
      user_id: guardian.user_id,
      file_id: guardian.signature_file_id,
    };
  }

  private async apply(
    manager: EntityManager,
    owner: Owner,
    fileId: number | null,
    actor: SignatureActor,
    note: string | null,
    syncUser = true,
  ): Promise<boolean> {
    const action = actionOf(owner.file_id, fileId);
    if (!action) return false;
    if (owner.side === 'teacher') {
      await manager.getRepository(Staff).update(owner.staff_id!, { signature_file_id: fileId });
    } else {
      await manager.getRepository(Guardian).update(owner.guardian_id!, { signature_file_id: fileId });
    }
    if (owner.user_id && syncUser) {
      await manager.getRepository(User).update(owner.user_id, { signature_file_id: fileId });
    }
    await manager.getRepository(SignatureChange).insert({
      school_id: owner.school_id,
      side: owner.side,
      staff_id: owner.staff_id,
      guardian_id: owner.guardian_id,
      owner_user_id: owner.user_id,
      action,
      old_file_id: owner.file_id,
      new_file_id: fileId,
      changed_by: actor.user_id,
      by_admin: actor.by_admin,
      note,
    });
    if (fileId !== null && owner.user_id) await this.refreshCards(manager, owner, fileId);
    return true;
  }

  private async refreshCards(manager: EntityManager, owner: Owner, fileId: number): Promise<void> {
    const side = owner.side;
    await manager.query(
      `UPDATE report_card_signatures rcs
       SET ${side}_signature_file_id = $1, ${side}_signature_updated_at = now(), updated_at = now()
       WHERE rcs.school_id = $2 AND rcs.${side}_user_id = $3 AND rcs.${side}_signed_at IS NOT NULL
         AND rcs.deleted_at IS NULL AND rcs.${side}_signature_file_id IS DISTINCT FROM $1
         AND rcs.academic_year_id IN (SELECT ay.id FROM academic_years ay WHERE ay.school_id = $2 AND ${yearClause('ay')})`,
      [fileId, owner.school_id, owner.user_id],
    );
  }

  private async assertImage(schoolId: number, fileId: number | null): Promise<void> {
    if (fileId === null) return;
    const file = await this.files.assertAttachable(fileId, schoolId, 'signature_file_id');
    if (!file.mime_type.startsWith('image/')) {
      throw AppException.validation([
        { field: 'signature_file_id', message: 'The signature must be an image (PNG or JPG)' },
      ]);
    }
  }

  private tellOwner(side: SignatureSide, userId: number | null, fileId: number | null): void {
    if (!userId) return;
    this.notifications
      .dispatch({
        template: TEMPLATES.SIGNATURE_SET_BY_SCHOOL,
        audience: { user_ids: [userId] },
        data: {
          app: side === 'teacher' ? 'Staff app' : 'Parent app',
          change: fileId === null ? 'removed' : 'updated',
          date: shortDate(new Date(), this.app.timeZone),
          side,
        },
      })
      .catch((error: Error) => this.logger.warn(`Signature note not sent: ${error.message}`));
  }

  private tellSchool(guardian: Guardian, removed: boolean): void {
    void this.schoolAudience(guardian)
      .then(async ({ teacherIds, children }) => {
        const data = {
          parent: guardian.name,
          children,
          change: removed ? 'removed their signature' : 'changed their signature',
          date: shortDate(new Date(), this.app.timeZone),
          guardian_id: String(guardian.id),
        };
        if (teacherIds.length) {
          await this.notifications.dispatch({
            template: TEMPLATES.PARENT_SIGNATURE_CHANGED,
            audience: { user_ids: teacherIds },
            data,
          });
        }
        await this.notifications.dispatch({
          template: TEMPLATES.PARENT_SIGNATURE_CHANGED,
          audience: { roles: [ROLES.ADMIN, ROLES.PRINCIPAL], school_id: guardian.school_id },
          data,
        });
      })
      .catch((error: Error) => this.logger.warn(`Signature change note not sent: ${error.message}`));
  }

  private async schoolAudience(guardian: Guardian): Promise<{ teacherIds: number[]; children: string }> {
    const rows: { name: string; teacher: number | null }[] = await this.dataSource.query(
      `SELECT trim(concat_ws(' ', s.first_name, s.last_name)) AS name, sec.class_teacher_user_id AS teacher
       FROM student_guardians sg
       JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
       JOIN student_enrollments se ON se.student_id = s.id
       JOIN academic_years ay ON ay.id = se.academic_year_id AND ${yearClause('ay')}
       LEFT JOIN sections sec ON sec.id = se.section_id AND sec.deleted_at IS NULL
       WHERE sg.guardian_id = $1 AND s.school_id = $2`,
      [guardian.id, guardian.school_id],
    );
    const teacherIds = [
      ...new Set(rows.map((row) => Number(row.teacher)).filter((id) => id && id !== guardian.user_id)),
    ];
    return { teacherIds, children: [...new Set(rows.map((row) => row.name))].join(', ') };
  }
}
