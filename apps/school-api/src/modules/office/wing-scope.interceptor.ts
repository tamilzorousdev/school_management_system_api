import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AppException, AuthenticatedRequest } from '@app/common';
import { runInWings } from '../../shared/wing-context';
import { isWingLimitedRole } from './office.logic';
import { WingScopeService } from './wing-scope.service';

const SCOPED_PATH = /\/(admin|mobile\/office)\//;
const STUDENT_PARAM = /\/students\/:(id|studentId)(\/|$)/;

@Injectable()
export class WingScopeInterceptor implements NestInterceptor {
  constructor(private readonly scope: WingScopeService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user?.school_id || !isWingLimitedRole(user.roles) || !SCOPED_PATH.test(request.path)) return next.handle();
    const classIds = await this.scope.classIdsFor(user, user.school_id);
    if (!classIds) return next.handle();
    const routePath = String((request as unknown as { route?: { path?: string } }).route?.path ?? '');
    const match = routePath.match(STUDENT_PARAM);
    if (match) {
      const studentId = Number(request.params[match[1]!]);
      if (Number.isInteger(studentId) && studentId > 0) {
        const classId = await this.scope.studentClassId(user.school_id, studentId);
        if (classId === null || !classIds.includes(classId)) {
          throw AppException.notFound('Student not found', 'STUDENT_NOT_FOUND');
        }
      }
    }
    return new Observable((subscriber) => runInWings(classIds, () => next.handle().subscribe(subscriber)));
  }
}
