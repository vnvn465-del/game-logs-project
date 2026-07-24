import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  RequestTimeoutException,
} from '@nestjs/common';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      // 30000ms (30초) 동안 응답이 없으면 TimeoutError 발생
      timeout(30000),
      catchError((err: unknown) => {
        if (err instanceof TimeoutError) {
          return throwError(
            () =>
              new RequestTimeoutException(
                '요청 시간이 30초를 초과하여 타임아웃 되었습니다.',
              ),
          );
        }

        return throwError(() =>
          err instanceof Error ? err : new Error(String(err)),
        );
      }),
    );
  }
}
