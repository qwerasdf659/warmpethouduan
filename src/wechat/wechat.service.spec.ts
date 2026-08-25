import { HttpService } from '@nestjs/axios';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { WechatService } from './wechat.service';

/**
 * 假登录开关是一条鉴权绕过路径，这里重点验证它「该关的时候一定关得死」，
 * 以及开启后不会污染真 code 的正常链路。
 */
describe('WechatService 假登录开关', () => {
  function makeService(opts: { mockLogin: boolean; httpGet?: jest.Mock }) {
    const config = {
      get: (k: string) => {
        if (k === 'wechat.mockLogin') return opts.mockLogin;
        if (k === 'wechat.appid') return 'wxtest';
        if (k === 'wechat.secret') return 'secret';
        if (k === 'env') return 'development';
        return undefined;
      },
    };
    const http = { get: opts.httpGet ?? jest.fn() };
    return new WechatService(
      http as unknown as HttpService,
      config as unknown as ConfigService,
    );
  }

  describe('开关关闭', () => {
    it('mock code 被拒，且明确提示是开关未开（而非凭证无效）', async () => {
      const httpGet = jest.fn();
      const svc = makeService({ mockLogin: false, httpGet });

      await expect(svc.code2Session('mock:alice')).rejects.toThrow(
        '假登录未启用',
      );
      // 关键：不得回落到真实微信请求
      expect(httpGet).not.toHaveBeenCalled();
    });
  });

  describe('开关开启', () => {
    it('mock code 直接换到确定性 openid，不打微信接口', async () => {
      const httpGet = jest.fn();
      const svc = makeService({ mockLogin: true, httpGet });

      const s = await svc.code2Session('mock:alice');

      expect(s.openid).toBe('mock_openid_alice');
      expect(s.unionid).toBeUndefined();
      expect(httpGet).not.toHaveBeenCalled();
    });

    it('同一标识稳定映射到同一 openid（可反复登录同一玩家）', async () => {
      const svc = makeService({ mockLogin: true });
      const a = await svc.code2Session('mock:alice');
      const b = await svc.code2Session('mock:alice');
      expect(a.openid).toBe(b.openid);
    });

    it('不同标识是不同玩家', async () => {
      const svc = makeService({ mockLogin: true });
      const a = await svc.code2Session('mock:alice');
      const b = await svc.code2Session('mock:bob');
      expect(a.openid).not.toBe(b.openid);
    });

    it.each(['mock:', 'mock:bad tag', 'mock:../etc', 'mock:' + 'x'.repeat(33)])(
      '非法标识 %p 被拒',
      async (code) => {
        const svc = makeService({ mockLogin: true });
        await expect(svc.code2Session(code)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      },
    );

    it('无前缀的真 code 仍走微信接口（同环境可混合联调）', async () => {
      const httpGet = jest
        .fn()
        .mockReturnValue(
          of({ data: { openid: 'real_openid', session_key: 'sk' } }),
        );
      const svc = makeService({ mockLogin: true, httpGet });

      const s = await svc.code2Session('0a1b2c3d');

      expect(httpGet).toHaveBeenCalled();
      expect(s.openid).toBe('real_openid');
    });
  });
});
