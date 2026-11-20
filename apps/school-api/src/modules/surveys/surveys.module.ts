import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmergencyModule } from '../emergency/emergency.module';
import {
  Survey,
  SurveyAnswer,
  SurveyQuestion,
  SurveyRecipient,
  SurveyResponse,
  SurveyTemplate,
} from './entities/survey.entity';
import { MeSurveysController, SurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Survey, SurveyQuestion, SurveyRecipient, SurveyResponse, SurveyAnswer, SurveyTemplate]),
    EmergencyModule,
  ],
  controllers: [SurveysController, MeSurveysController],
  providers: [SurveysService],
})
export class SurveysModule {}
