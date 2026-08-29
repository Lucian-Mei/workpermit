import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AppConfigModule } from '@/config/config.module';
import { DatabaseModule } from '@/database/database.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { UsersModule } from '@/modules/users/users.module';
import { RolesModule } from '@/modules/roles/roles.module';
import { DepartmentsModule } from '@/modules/departments/departments.module';
import { AreasModule } from '@/modules/areas/areas.module';
import { ContractorsModule } from '@/modules/contractors/contractors.module';
import { HazardTypesModule } from '@/modules/hazard-types/hazard-types.module';
import { HazardsModule } from '@/modules/hazards/hazards.module';
import { WorkPermitsModule } from '@/modules/work-permits/work-permits.module';
import { EOnsiteModule } from '@/modules/e-onsite/e-onsite.module';
import { DashboardModule } from '@/modules/dashboard/dashboard.module';
import { BackupModule } from '@/modules/backup/backup.module';
import { SettingsModule } from '@/modules/settings/settings.module';
import { EmailModule } from '@/modules/email/email.module';
import { LotteryModule } from '@/modules/lottery/lottery.module';
import { QrCodesModule } from '@/modules/qr-codes/qr-codes.module';
import { TokensModule } from '@/modules/tokens/tokens.module';
import { PublicActionsModule } from '@/modules/public-actions/public-actions.module';
import { FeishuSyncModule } from '@/modules/feishu-sync/feishu-sync.module';
import { TrainingModule } from '@/modules/training/training.module';
import { SeedService } from '@/database/seed.service';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    AuthModule,
    UsersModule,
    RolesModule,
    DepartmentsModule,
    AreasModule,
    ContractorsModule,
    HazardTypesModule,
    HazardsModule,
    WorkPermitsModule,
    EOnsiteModule,
    DashboardModule,
    BackupModule,
    SettingsModule,
    EmailModule,
    LotteryModule,
    QrCodesModule,
    TokensModule,
    PublicActionsModule,
    FeishuSyncModule,
    TrainingModule,
  ],
  providers: [SeedService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
