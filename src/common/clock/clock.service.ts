import { Injectable } from '@nestjs/common';

/**
 * 服务端权威时钟。全项目「当前时间」的唯一来源——
 * 所有时长/冷却/收益计算都用它，禁用客户端上报的时间。
 * 抽成服务是为了可测试（测试里可注入假时钟）。
 */
@Injectable()
export class ClockService {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }
}
