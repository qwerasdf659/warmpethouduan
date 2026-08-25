import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminAuditLog } from '../../entities/admin-audit-log.entity';

const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'oldPassword',
  'newPassword',
];

export interface AuditRecordInput {
  adminUserId: string | null;
  adminUsername: string | null;
  action: string | null;
  method: string;
  path: string;
  targetType: string | null;
  targetId: string | null;
  bizId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestBody: unknown;
  statusCode: number;
  success: boolean;
  errorMessage: string | null;
  durationMs: number | null;
}

@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger('AdminAudit');

  constructor(
    @InjectRepository(AdminAuditLog)
    private readonly logs: Repository<AdminAuditLog>,
  ) {}

  /** 剔除敏感字段后返回浅拷贝，避免把口令等写进审计。 */
  static sanitize(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body ?? null;
    const clone: Record<string, unknown> = {
      ...(body as Record<string, unknown>),
    };
    for (const k of SENSITIVE_KEYS) {
      if (k in clone) clone[k] = '***';
    }
    return clone;
  }

  /**
   * 落一条审计。软失败：写库异常只记服务端日志，绝不冒泡阻断主链路。
   */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      const entity = this.logs.create({
        adminUserId: input.adminUserId,
        adminUsername: input.adminUsername,
        action: input.action,
        method: input.method,
        path: input.path.slice(0, 255),
        targetType: input.targetType,
        targetId: input.targetId ? String(input.targetId).slice(0, 64) : null,
        bizId: input.bizId ? String(input.bizId).slice(0, 128) : null,
        ip: input.ip,
        userAgent: input.userAgent ? input.userAgent.slice(0, 255) : null,
        requestBody: AdminAuditService.sanitize(input.requestBody),
        statusCode: input.statusCode,
        success: input.success,
        errorMessage: input.errorMessage
          ? input.errorMessage.slice(0, 512)
          : null,
        durationMs: input.durationMs,
      });
      await this.logs.save(entity);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`审计写入失败（已忽略）: ${msg}`);
    }
  }

  /** 分页查询审计日志，支持按管理员/是否成功过滤。 */
  async query(params: {
    page: number;
    pageSize: number;
    adminUserId?: string;
    success?: boolean;
  }): Promise<{ list: AdminAuditLog[]; total: number }> {
    const qb = this.logs
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC')
      .skip((params.page - 1) * params.pageSize)
      .take(params.pageSize);

    if (params.adminUserId) {
      qb.andWhere('log.adminUserId = :aid', { aid: params.adminUserId });
    }
    if (typeof params.success === 'boolean') {
      qb.andWhere('log.success = :ok', { ok: params.success });
    }

    const [list, total] = await qb.getManyAndCount();
    return { list, total };
  }
}
