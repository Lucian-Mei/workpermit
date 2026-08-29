import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ContractorsService } from './contractors.service';
import { ContractorDto } from './contractors.service';

@Controller('contractors')
export class ContractorsController {
  constructor(private svc: ContractorsService) {}

  @Get()
  list(@Query('q') q?: string, @Query('includeDisabled') includeDisabled?: string) {
    return this.svc.list(q, includeDisabled === 'true' || includeDisabled === '1');
  }

  /** 智能 upsert：申请单填写后自动录入（按单位+负责人去重） */
  @Post()
  upsert(@Body() body: ContractorDto) {
    return this.svc.upsert(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: Partial<ContractorDto>) {
    return this.svc.update(id, body);
  }

  /** 启用/停用 */
  @Put(':id/enabled')
  setEnabled(@Param('id') id: string, @Body() body: { enabled: boolean }) {
    return this.svc.setEnabled(id, body?.enabled === true);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
