import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * 统一异常输出：{ code, message }。
 * 非 HttpException 一律 500，且只记录服务端日志、不把内部细节回显给客户端。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = '服务器内部错误';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message =
        typeof body === 'string'
          ? body
          : ((body as Record<string, unknown>).message as string) ?? message;
    } else if (exception instanceof Error) {
      this.logger.error(
        `${req.method} ${req.url} -> ${exception.message}`,
        exception.stack,
      );
    }

    res.status(status).json({ code: status, message });
  }
}
