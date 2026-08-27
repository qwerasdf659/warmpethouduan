import type { IncomingMessage } from 'node:http';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { WebSocket } from 'ws';

interface AuthedSocket extends WebSocket {
  userId?: string;
  trackKey?: string;
  roomId?: string;
}

interface Waiting {
  userId: string;
  client: AuthedSocket;
}

/**
 * 实时 PvP 通讯层（P6）。
 *
 * 设计边界（与文档 §11 一致）：
 *  - 依赖原生 ws（非 socket.io），落同进程同端口 8080，路径 /ws/pvp；
 *  - 握手用玩家 JWT（query token）鉴权，复用 JWT_SECRET，不为 WS 另开一套凭证；
 *  - WS 只负责**过程表现**（匹配、倒计时、tick 状态广播）；
 *  - **发奖/积分结算必须走 HTTP 幂等接口** `POST /pvp/challenge`（WS 消息无 bizId 幂等保护）。
 *    匹配成功后服务端下发 `race:finish`，指示双方各自调用 HTTP 完成权威结算。
 *
 * 详细帧协议（重连/消息编号/断线补偿）需与前端联合定案，此处实现最小可用的
 * 「鉴权 + 匹配 + 状态同步」骨架，不单方面固化协议细节。
 */
@WebSocketGateway({ path: '/ws/pvp' })
export class PvpGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('PvpGateway');
  private readonly queues = new Map<string, Waiting[]>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  handleConnection(client: AuthedSocket, req: IncomingMessage): void {
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token') ?? '';
      const payload = this.jwt.verify<{ sub: string }>(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
      client.userId = payload.sub;
      this.send(client, 'connected', { userId: payload.sub });
    } catch {
      this.send(client, 'error', { message: '令牌无效或已过期' });
      client.close();
    }
  }

  handleDisconnect(client: AuthedSocket): void {
    if (client.trackKey) {
      const q = this.queues.get(client.trackKey);
      if (q) {
        this.queues.set(
          client.trackKey,
          q.filter((w) => w.userId !== client.userId),
        );
      }
    }
  }

  @SubscribeMessage('ping')
  onPing(): { event: string; data: unknown } {
    return { event: 'pong', data: { t: Date.now() } };
  }

  /** 加入某赛道的实时匹配队列；凑齐两人即开局。 */
  @SubscribeMessage('race:join')
  onJoin(
    client: AuthedSocket,
    data: { trackKey?: string },
  ): { event: string; data: unknown } {
    if (!client.userId) return { event: 'error', data: { message: '未鉴权' } };
    const trackKey = (data?.trackKey ?? 'meadow').slice(0, 32);
    client.trackKey = trackKey;
    const q = this.queues.get(trackKey) ?? [];

    const opponent = q.find((w) => w.userId !== client.userId);
    if (opponent) {
      this.queues.set(
        trackKey,
        q.filter((w) => w.userId !== opponent.userId),
      );
      this.startMatch(trackKey, opponent, { userId: client.userId, client });
      return { event: 'race:queued', data: { matched: true } };
    }

    q.push({ userId: client.userId, client });
    this.queues.set(trackKey, q);
    return { event: 'race:queued', data: { matched: false } };
  }

  @SubscribeMessage('race:cancel')
  onCancel(client: AuthedSocket): { event: string; data: unknown } {
    if (client.trackKey) {
      const q = this.queues.get(client.trackKey) ?? [];
      this.queues.set(
        client.trackKey,
        q.filter((w) => w.userId !== client.userId),
      );
    }
    return { event: 'race:cancelled', data: {} };
  }

  private startMatch(trackKey: string, a: Waiting, b: Waiting): void {
    const roomId = `${a.userId}-${b.userId}-${Date.now()}`;
    a.client.roomId = roomId;
    b.client.roomId = roomId;
    this.send(a.client, 'race:matched', {
      roomId,
      trackKey,
      opponentUserId: b.userId,
      countdownMs: 3000,
    });
    this.send(b.client, 'race:matched', {
      roomId,
      trackKey,
      opponentUserId: a.userId,
      countdownMs: 3000,
    });

    // 服务端权威 tick：过程表现同步；到点后指示双方走 HTTP 幂等接口结算
    const startAt = Date.now() + 3000;
    const durationMs = 6000;
    const timer = setInterval(() => {
      const elapsed = Date.now() - startAt;
      if (elapsed < 0) return;
      if (elapsed >= durationMs) {
        clearInterval(timer);
        this.send(a.client, 'race:finish', {
          roomId,
          opponentUserId: b.userId,
          trackKey,
        });
        this.send(b.client, 'race:finish', {
          roomId,
          opponentUserId: a.userId,
          trackKey,
        });
        return;
      }
      const payload = {
        roomId,
        elapsedMs: elapsed,
        progress: elapsed / durationMs,
      };
      this.send(a.client, 'race:tick', payload);
      this.send(b.client, 'race:tick', payload);
    }, 500);
  }

  private send(client: WebSocket, event: string, data: unknown): void {
    try {
      client.send(JSON.stringify({ event, data }));
    } catch (e) {
      this.logger.warn(`ws send failed: ${(e as Error).message}`);
    }
  }
}
