import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ApprovalsController } from './approvals.controller.js';
import { BalancesController } from './balances.controller.js';
import { EmployeesController } from './employees.controller.js';
import { HealthController } from './health.controller.js';
import { LeaveRequestsController } from './leave-requests.controller.js';
import { LeaveTypesController } from './leave-types.controller.js';
import { PoliciesController } from './policies.controller.js';
import { ReportsController } from './reports.controller.js';
import { SyncController } from './sync.controller.js';
import { SyncRunsController } from './sync-runs.controller.js';

@Module({
  imports: [AuthModule],
  providers: [JwtAuthGuard, RolesGuard],
  controllers: [
    HealthController,
    EmployeesController,
    SyncController,
    LeaveTypesController,
    PoliciesController,
    LeaveRequestsController,
    ApprovalsController,
    BalancesController,
    SyncRunsController,
    ReportsController,
  ],
})
export class ApiModule {}
