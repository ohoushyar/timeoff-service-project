import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfigService } from '../config/app-config.service.js';
import { AuthorizationService } from './authorization.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.env.JWT_SECRET,
        signOptions: {
          issuer: config.env.JWT_ISSUER,
          audience: config.env.JWT_AUDIENCE,
        },
        verifyOptions: {
          issuer: config.env.JWT_ISSUER,
          audience: config.env.JWT_AUDIENCE,
        },
      }),
    }),
  ],
  providers: [AuthorizationService, JwtAuthGuard, RolesGuard],
  exports: [JwtModule, AuthorizationService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
