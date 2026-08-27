import { Matches, MaxLength, MinLength } from 'class-validator';

export class DeviceLoginDto {
  /**
   * 客户端本地生成并持久化的设备标识（如 GUID / 平台 deviceUniqueIdentifier）。
   * 限定字符集与长度，避免拼出畸形 openid；上限留足前缀空间（openid 列 64 字符）。
   */
  @Matches(/^[A-Za-z0-9:_-]+$/, {
    message: 'deviceId 仅允许字母、数字、冒号、下划线与连字符',
  })
  @MinLength(8)
  @MaxLength(48)
  deviceId: string;
}
