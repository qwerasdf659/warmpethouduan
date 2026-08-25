import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AdminPrincipal } from '../admin-principal';

/** 注入当前登录管理员身份（req.admin，由 AdminJwtAuthGuard 挂载）。 */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminPrincipal => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { admin: AdminPrincipal }>();
    return req.admin;
  },
);
