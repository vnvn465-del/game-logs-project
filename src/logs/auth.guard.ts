import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    // 토큰이 없거나, 유효한 토큰이 아닌 경우 예외 처리
    if (!authHeader || authHeader !== 'Bearer rush-secret-token') {
      throw new UnauthorizedException('유효하지 않은 인증 토큰입니다.');
    }

    return true; // 통과!
  }
}
