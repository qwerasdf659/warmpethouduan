import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'admin_audit';

export interface AuditMeta {
  /** 操作名（如 '封禁玩家'、'调整配置'），落 admin_audit_log.action */
  action: string;
  /** 目标资源类型（如 'player'、'admin_role'），可选 */
  targetType?: string;
}

/**
 * 标注需要写审计日志的后台接口。AdminAuditInterceptor 读取该元数据落库。
 * 未标注的写操作仍会被拦截器按「方法+路径」兜底记录。
 */
export const Audit = (action: string, targetType?: string) =>
  SetMetadata(AUDIT_KEY, { action, targetType });
