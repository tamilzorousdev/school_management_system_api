import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '@app/common';
import { resolveSchoolId } from '../../shared/school-context';
import { HostelSettingsService } from './hostel-settings.service';
import { HostelOptionalModule } from './hostel.logic';

export const HOSTEL_MODULE_KEY = 'hostel_module';

export const HostelModuleGate = (module: HostelOptionalModule) => SetMetadata(HOSTEL_MODULE_KEY, module);

@Injectable()
export class HostelModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: HostelSettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const module = this.reflector.getAllAndOverride<HostelOptionalModule | undefined>(HOSTEL_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!module) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.school_id && !request.user?.roles.includes('SUPER_ADMIN')) return true;
    await this.settings.ensureEnabled(resolveSchoolId(request), module);
    return true;
  }
}
