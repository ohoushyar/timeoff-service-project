import { Controller, Get, Header, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { JSON_API_CONTENT_TYPE } from '../common/constants.js';
import { paramId } from '../lib/params.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { getEmployee } from '../services/employee.service.js';
import { serializeEmployee } from '../serializers/jsonapi/resources/employees.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class EmployeesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  @Get('/api/v1/employees/:id')
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async getEmployee(@Req() req: AuthenticatedRequest, @Param() params: { id: string }) {
    const id = paramId(params);
    if (this.authorization.isPrivileged(req.user)) {
      await this.authorization.requireSelfOrPrivileged(req.user, id);
    } else {
      await this.authorization.requireManagerOfOrPrivileged(req.user, id);
    }
    const employee = await getEmployee(this.prisma, id);
    return serializeEmployee(employee);
  }
}
