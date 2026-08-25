import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AdminPrincipal } from '../admin-principal';
import { AUDIT_KEY, AuditMeta } from '../decorators/audit.decorator';
import { AdminAuditService } from './admin-audit.service';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 后台审计拦截器：对写操作（或标注 @Audit 的接口）落一条审计日志。
 * 成功/失败都记录；写日志本身软失败。GET 且未标注 @Audit 时跳过，避免噪声。
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AdminAuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { admin?: AdminPrincipal }>();
    const res = context.switchToHttp().getResponse<Response>();

    const meta = this.reflector.getAllAndOverride<AuditMeta | undefined>(
      AUDIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    const shouldLog = WRITE_METHODS.has(req.method) || Boolean(meta);
    if (!shouldLog) return next.handle();

    const start = Date.now();
    const admin = req.admin ?? null;
    const body = req.body as Record<string, unknown> | undefined;
    const base = {
      adminUserId: admin?.adminUserId ?? null,
      adminUsername: admin?.username ?? null,
      action: meta?.action ?? null,
      method: req.method,
      path: req.originalUrl ?? req.url,
      targetType: meta?.targetType ?? null,
      targetId: (req.params?.id as string) ?? null,
      bizId: (body?.bizId as string) ?? null,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      requestBody: body ?? null,
    };

    return next.handle().pipe(
      tap({
        next: () => {
          void this.audit.record({
            ...base,
            statusCode: res.statusCode,
            success: true,
            errorMessage: null,
            durationMs: Date.now() - start,
          });
        },
        error: (err: unknown) => {
          const status =
            err && typeof err === 'object' && 'getStatus' in err
              ? (err as { getStatus: () => number }).getStatus()
              : 500;
          const message = err instanceof Error ? err.message : String(err);
          void this.audit.record({
            ...base,
            statusCode: status,
            success: false,
            errorMessage: message,
            durationMs: Date.now() - start,
          });
        },
      }),
    );
  }
}
