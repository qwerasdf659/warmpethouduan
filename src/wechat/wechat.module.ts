import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { WechatService } from './wechat.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 2,
    }),
  ],
  providers: [WechatService],
  exports: [WechatService],
})
export class WechatModule {}
