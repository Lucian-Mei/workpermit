import { Module } from '@nestjs/common';
import { HazardTypesService } from './hazard-types.service';
import { HazardTypesController } from './hazard-types.controller';

@Module({
  providers: [HazardTypesService],
  controllers: [HazardTypesController],
})
export class HazardTypesModule {}
