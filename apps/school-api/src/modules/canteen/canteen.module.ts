import { Module, Provider, Type } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';
import { MENU_PARTS } from './canteen-menu.parts';
import { PEOPLE_PARTS } from './canteen-people.parts';
import { SALES_PARTS } from './canteen-sales.parts';
import { SUPPLY_PARTS } from './canteen-supply.parts';

interface Parts {
  entities: EntityClassOrSchema[];
  controllers: Type<unknown>[];
  providers: Provider[];
}

const PARTS: Parts[] = [MENU_PARTS, SALES_PARTS, SUPPLY_PARTS, PEOPLE_PARTS];

@Module({
  imports: [TypeOrmModule.forFeature(PARTS.flatMap((part) => part.entities))],
  controllers: PARTS.flatMap((part) => part.controllers),
  providers: PARTS.flatMap((part) => part.providers),
})
export class CanteenModule {}
