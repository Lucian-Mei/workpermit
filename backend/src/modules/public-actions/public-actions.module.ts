import { Module } from '@nestjs/common';
import { PublicActionsController } from './public-actions.controller';
import { PublicActionsService } from './public-actions.service';
import { WorkPermitsModule } from '@/modules/work-permits/work-permits.module';

// 公开端点模块：邮件内“同意/拒绝”按钮 + 二维码手机签字。
// 无 JWT 守卫，靠 action_tokens 令牌校验身份与时效（48 小时、单次有效）。
@Module({
  imports: [WorkPermitsModule],
  controllers: [PublicActionsController],
  providers: [PublicActionsService],
})
export class PublicActionsModule {}
