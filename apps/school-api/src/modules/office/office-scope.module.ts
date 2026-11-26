import { Global, Module } from '@nestjs/common';
import { WingScopeInterceptor } from './wing-scope.interceptor';
import { WingScopeService } from './wing-scope.service';

@Global()
@Module({
  providers: [WingScopeService, WingScopeInterceptor],
  exports: [WingScopeService, WingScopeInterceptor],
})
export class OfficeScopeModule {}
