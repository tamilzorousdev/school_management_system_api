import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SignatureChange } from './entities/signature-change.entity';
import {
  AdminSignaturesController,
  MobileParentSignatureController,
  MobileTeacherSignatureController,
} from './signatures.controller';
import { SignaturesService } from './signatures.service';

@Module({
  imports: [TypeOrmModule.forFeature([SignatureChange])],
  controllers: [AdminSignaturesController, MobileTeacherSignatureController, MobileParentSignatureController],
  providers: [SignaturesService],
  exports: [SignaturesService],
})
export class SignaturesModule {}
