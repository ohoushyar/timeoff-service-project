import { DynamicModule, Module } from '@nestjs/common';
import { ApiModule } from './api/api.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { LoggingModule } from './common/logging.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import { getEnv } from './config/env.js';
import { JobsModule } from './jobs/jobs.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

function jobsEnabled(): boolean {
  try {
    return getEnv().ENABLE_JOBS;
  } catch {
    return process.env.ENABLE_JOBS !== 'false';
  }
}

@Module({})
export class AppModule {
  static register(): DynamicModule {
    const imports = [
      AppConfigModule,
      LoggingModule,
      PrismaModule,
      CommonModule,
      AuthModule,
      ApiModule,
      ...(jobsEnabled() ? [JobsModule] : []),
    ];

    return {
      module: AppModule,
      imports,
    };
  }
}
