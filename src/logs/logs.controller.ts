/* eslint-disable */
import {
  Controller,
  Post,
  Body,
  HttpCode,
  UnauthorizedException,
  Headers,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { LogsService } from './logs.service';
import { GameLog } from '../game-log.entity';
import {
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from './auth.guard';
import { TimeoutInterceptor } from './timeout.interceptor';

@ApiTags('게임 로그 통계 API')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@UseInterceptors(TimeoutInterceptor)
@Controller('api/v1/logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: '로그 적재 API',
    description:
      '전송 측(게임 인스턴스)에서 보낸 로그 배열(Batch)을 수신하여 DB에 중복 없이 저장합니다.',
  })
  @ApiBody({ type: [GameLog] })
  async receiveLogs(@Body() logs: GameLog[]) {
    if (!logs || !Array.isArray(logs) || logs.length === 0) {
      return {
        status: 'error',
        message: '로그 데이터가 배열 형식이 아니거나 비어있습니다.',
      };
    }
    return await this.logsService.saveLogsBatch(logs);
  }

  // ==========================================
  // [문제 2-B] 집계 API 엔드포인트
  // ==========================================

  @Get('stats/dau')
  @ApiOperation({
    summary: 'DAU 조회 API',
    description: '일자별 고유 접속 유저 수(DAU)를 반환합니다.',
  })
  @ApiQuery({
    name: 'start',
    description: '시작일 (예: 2026-07-15)',
    required: true,
  })
  @ApiQuery({
    name: 'end',
    description: '종료일 (예: 2026-07-25)',
    required: true,
  })
  async getDauStats(
    @Query('start') startDate: string,
    @Query('end') endDate: string,
  ) {
    if (!startDate || !endDate)
      return {
        error: 'start와 end 날짜 파라미터가 필요합니다. (형식: YYYY-MM-DD)',
      };
    return await this.logsService.getDau(startDate, endDate);
  }

  @Get('stats/revenue')
  @ApiOperation({
    summary: '매출 및 ARPU 조회 API',
    description:
      '기간 내 총 결제 매출 합계 및 유저 1명당 평균 매출(ARPU)을 반환합니다.',
  })
  @ApiQuery({
    name: 'start',
    description: '시작일 (예: 2026-07-15)',
    required: true,
  })
  @ApiQuery({
    name: 'end',
    description: '종료일 (예: 2026-07-25)',
    required: true,
  })
  async getRevenueStats(
    @Query('start') startDate: string,
    @Query('end') endDate: string,
  ) {
    if (!startDate || !endDate)
      return {
        error: 'start와 end 날짜 파라미터가 필요합니다. (형식: YYYY-MM-DD)',
      };
    return await this.logsService.getRevenue(startDate, endDate);
  }

  @Get('stats/conversion')
  @ApiOperation({
    summary: '결제 전환율 조회 API',
    description:
      '활성 유저 중 실제 결제를 진행한 유저의 비율(PU/DAU)을 퍼센트(%)로 반환합니다.',
  })
  @ApiQuery({
    name: 'start',
    description: '시작일 (예: 2026-07-15)',
    required: true,
  })
  @ApiQuery({
    name: 'end',
    description: '종료일 (예: 2026-07-25)',
    required: true,
  })
  async getConversionStats(
    @Query('start') startDate: string,
    @Query('end') endDate: string,
  ) {
    if (!startDate || !endDate)
      return { error: 'start와 end 날짜 파라미터가 필요합니다.' };
    return await this.logsService.getConversionRate(startDate, endDate);
  }

  @Get('stats/retention')
  @ApiOperation({
    summary: '리텐션(D1, D7) 조회 API',
    description:
      '최초 접속일 기준으로 신규 유저의 1일 뒤, 7일 뒤 재접속 비율을 반환합니다.',
  })
  async getRetentionStats() {
    return await this.logsService.getRetention();
  }

  // ==========================================
  // [추가 운영 지표 API]
  // ==========================================

  @Get('stats/exp-per-hour')
  @ApiOperation({
    summary: '직업별 시간당 평균 경험치 API',
    description:
      '각 직업별 유저들이 1시간 동안 사냥하며 획득하는 평균 경험치 효율을 계산합니다.',
  })
  async getExpPerHourStats() {
    return await this.logsService.getExpPerHourByJob();
  }

  @Get('stats/potion-per-hour')
  @ApiOperation({
    summary: '직업별 시간당 평균 포션 사용량 API',
    description:
      '각 직업별 유저들이 1시간 동안 소모하는 HP/MP 포션의 평균 개수를 반환합니다.',
  })
  async getPotionPerHourStats() {
    return await this.logsService.getPotionPerHourByJob();
  }
}
