/* eslint-disable */
import {
  Controller,
  Post,
  Body,
  HttpCode,
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

// 게임 로그 적재 API와 통계 조회 API를 제공하는 컨트롤러입니다.
// 인증, 타임아웃 처리, Swagger 문서 설명도 함께 붙어 있습니다.
@ApiTags('게임 로그 통계 API')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@UseInterceptors(TimeoutInterceptor)
@Controller('api/v1/logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  // 외부에서 전달한 로그 배열을 수신해 서비스로 넘깁니다.
  // 빈 배열이나 잘못된 형식은 간단히 걸러낸 뒤 저장 로직을 호출합니다.
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

  // 날짜별 고유 로그인 유저 수를 조회합니다.
  // start~end 구간 동안 SESSION_LOGIN 기준으로 DAU를 계산합니다.
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
    // 날짜 파라미터가 비어 있으면 바로 안내 메시지를 반환합니다.
    if (!startDate || !endDate) {
      return {
        error: 'start와 end 날짜 파라미터가 필요합니다. (형식: YYYY-MM-DD)',
      };
    }

    return await this.logsService.getDau(startDate, endDate);
  }

  // 기간 내 총매출, 활성유저수, 결제유저수, ARPU/ARPPU를 조회합니다.
  // 매출은 SHOP_PURCHASE의 payload.amount 값을 기준으로 합산합니다.
  @Get('stats/revenue')
  @ApiOperation({
    summary: '매출 및 ARPU 조회 API',
    description:
      '기간 내 총 결제 매출, 활성 유저 수, 결제 유저 수, ARPU/ARPPU를 반환합니다.',
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
    // 날짜가 없으면 서비스 호출 전에 먼저 요청 형식을 확인합니다.
    if (!startDate || !endDate) {
      return {
        error: 'start와 end 날짜 파라미터가 필요합니다. (형식: YYYY-MM-DD)',
      };
    }

    return await this.logsService.getRevenue(startDate, endDate);
  }

  // 활성 유저 대비 결제 유저 비율을 계산합니다.
  // SESSION_LOGIN을 활성 기준으로, SHOP_PURCHASE를 결제 기준으로 사용합니다.
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
    // 필수 날짜 파라미터가 빠지면 집계 의미가 없으므로 바로 반환합니다.
    if (!startDate || !endDate) {
      return {
        error: 'start와 end 날짜 파라미터가 필요합니다. (형식: YYYY-MM-DD)',
      };
    }

    return await this.logsService.getConversionRate(startDate, endDate);
  }

  // 유저의 최초 로그인일을 코호트 기준일로 잡아 리텐션을 조회합니다.
  // 현재 서비스 기준으로 D1, D7, D30 재방문율을 함께 반환합니다.
  @Get('stats/retention')
  @ApiOperation({
    summary: '리텐션(D1, D7, D30) 조회 API',
    description:
      '최초 접속일 기준으로 신규 유저의 1일 뒤, 7일 뒤, 30일 뒤 재접속 비율을 반환합니다.',
  })
  async getRetentionStats() {
    return await this.logsService.getRetention();
  }

  // 직업별 유저의 시간당 평균 경험치 획득량을 조회합니다.
  // 세션 시간과 몬스터 처치 경험치를 이용해 효율 지표를 계산합니다.
  @Get('stats/exp-per-hour')
  @ApiOperation({
    summary: '직업별 시간당 평균 경험치 API',
    description:
      '각 직업별 유저들이 1시간 동안 사냥하며 획득하는 평균 경험치 효율을 계산합니다.',
  })
  async getExpPerHourStats() {
    return await this.logsService.getExpPerHourByJob();
  }

  // 직업별로 HP/MP 포션의 시간당 평균 사용량을 조회합니다.
  // item_use 이벤트를 기반으로 포션 소비 패턴을 확인할 수 있습니다.
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
