import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { TrainingService } from './training.service';
import { Public } from '@/common/decorators/public.decorator';

@Controller('training')
export class TrainingController {
  constructor(private svc: TrainingService) {}

  // ===== 配置 =====
  @Get('config')
  getConfig(@Query('key') key?: string) {
    if (key) return this.svc.getConfig(key);
    return this.svc.getAllConfig();
  }
  @Put('config/:key')
  setConfig(@Param('key') key: string, @Body() body: { value: string }) {
    return this.svc.setConfig(key, body.value);
  }

  // ===== 试题管理 =====
  @Get('questions')
  listQuestions() {
    return this.svc.listQuestions();
  }
  @Post('questions')
  createQuestion(@Body() body: { question: string; options: string[]; answer: string; sort?: number }) {
    return this.svc.createQuestion(body);
  }
  @Put('questions/:id')
  updateQuestion(@Param('id') id: string, @Body() body: any) {
    return this.svc.updateQuestion(id, body);
  }
  @Delete('questions/:id')
  deleteQuestion(@Param('id') id: string) {
    return this.svc.deleteQuestion(id);
  }

  // ===== 考试（现场工人匿名考试入口，免登录，但走 @Public 放行）=====
  @Public()
  @Get('exam')
  getExam(@Query('count') count?: string) {
    return this.svc.getExam(count ? Number(count) : undefined);
  }
  @Public()
  @Post('exam')
  submitExam(@Body() body: { name: string; idCard?: string; phone?: string; answers: { questionId: string; answer: string }[] }) {
    return this.svc.submitExam(body);
  }

  // ===== 培训记录 =====
  @Get('records')
  listRecords(@Query('name') name?: string, @Query('idCard') idCard?: string) {
    return this.svc.listRecords(name, idCard);
  }
  // S12：按身份证号（首选）+ 姓名查询有效期内的培训记录
  @Get('check/:name')
  checkValid(@Param('name') name: string, @Query('idCard') idCard?: string) {
    return this.svc.findValidRecord({ name, idCard });
  }
}
