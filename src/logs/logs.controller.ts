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
  BadRequestException,
} from '@nestjs/common';
import { LogsService } from './logs.service';
import { GameLog } from '../game-log.entity';
import {
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
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
  // 빈 배열이나 잘못된 형식은 먼저 검증한 뒤 저장 로직을 호출합니다.
  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: '로그 적재 API',
    description:
      '게임 서버에서 전송한 로그 배열을 수신하여 저장합니다. event_id 기준 중복 로그는 저장하지 않습니다.',
  })
  @ApiBody({ type: [GameLog] })
  async receiveLogs(@Body() logs: GameLog[]) {
    if (!logs || !Array.isArray(logs) || logs.length === 0) {
      throw new BadRequestException(
        '로그 데이터가 배열 형식이 아니거나 비어있습니다.',
      );
    }

    return await this.logsService.saveLogsBatch(logs);
  }

  // 날짜별 고유 로그인 유저 수를 조회합니다.
  // start~end 구간 동안 SESSION_LOGIN 기준으로 DAU를 계산합니다.
  @Get('stats/dau')
  @ApiOperation({
    summary: 'DAU 조회 API',
    description: `지정한 기간 동안 일자별 고유 접속 유저 수(DAU)를 반환합니다.
                  SESSION_LOGIN 이벤트를 기준으로 집계합니다.`,
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
    // 날짜 범위 집계는 시작일과 종료일이 모두 있어야 하므로 필수로 검사합니다.
    if (!startDate || !endDate) {
      throw new BadRequestException(
        'start와 end 날짜 파라미터가 필요합니다. (형식: YYYY-MM-DD)',
      );
    }

    return await this.logsService.getDau(startDate, endDate);
  }

  // 기간 내 총매출, 활성유저수, 결제유저수, ARPU/ARPPU를 조회합니다.
  // 매출은 SHOP_PURCHASE 이벤트의 amount 값을 기준으로 계산합니다.
  @Get('stats/revenue')
  @ApiOperation({
    summary: '매출 및 ARPU 조회 API',
    description: `지정한 기간의 총매출, 활성 유저 수, 결제 유저 수, ARPU, ARPPU를 반환합니다. 
       매출은 SHOP_PURCHASE 이벤트의 payload.amount 값을 기준으로 계산합니다.`,
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
    // 기간 통계는 집계 구간이 명확해야 하므로 날짜 파라미터를 필수로 받습니다.
    if (!startDate || !endDate) {
      throw new BadRequestException(
        'start와 end 날짜 파라미터가 필요합니다. (형식: YYYY-MM-DD)',
      );
    }

    return await this.logsService.getRevenue(startDate, endDate);
  }

  // 지정한 기간 동안 활성 유저 대비 결제 유저 비율을 계산합니다.
  // SESSION_LOGIN을 활성 기준으로, SHOP_PURCHASE를 결제 기준으로 사용합니다.
  @Get('stats/conversion')
  @ApiOperation({
    summary: '결제 전환율 조회 API',
    description: `지정한 기간 동안 활성 유저 중 실제 결제를 진행한 유저의 비율을 반환합니다. 
       활성 유저는 SESSION_LOGIN, 결제 유저는 SHOP_PURCHASE 이벤트를 기준으로 집계합니다.`,
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
    // 결제 전환율도 기간 기준 지표이므로 start, end가 모두 필요합니다.
    if (!startDate || !endDate) {
      throw new BadRequestException(
        'start와 end 날짜 파라미터가 필요합니다. (형식: YYYY-MM-DD)',
      );
    }

    return await this.logsService.getConversionRate(startDate, endDate);
  }

  // 전체 신규 유저 기준의 D1/D7/D30 리텐션 요약 결과 1개를 조회합니다.
  // 최근 유저로 인한 왜곡을 줄이기 위해 eligible 유저 수까지 함께 반환합니다.
  @Get('stats/retention')
  @ApiOperation({
    summary: '리텐션 요약 조회 API',
    description: `전체 신규 유저 기준으로 D1, D7, D30 리텐션 요약 결과 1개를 반환합니다.
    각 리텐션 비율은 해당 일차까지 실제로 관측 가능한 신규 유저(eligible_users)만 분모에 포함하여 계산합니다.`,
  })
  async getRetentionStats() {
    return await this.logsService.getRetention();
  }

  // 최초 로그인일(cohort_date) 기준으로 날짜별 리텐션 상세 목록을 조회합니다.
  // startDate, endDate를 주면 원하는 코호트 기간만 필터링해서 확인할 수 있습니다.
  @Get('stats/retention/cohorts')
  @ApiOperation({
    summary: '코호트별 리텐션 상세 조회 API',
    description: `최초 접속일(cohort_date) 기준으로 날짜별 D1, D7, D30 리텐션 상세 목록을 반환합니다.
       startDate, endDate를 사용해 조회할 코호트 기간을 제한할 수 있으며, 
       아직 관측 기간이 충분히 지나지 않은 cohort의 D7/D30 값은 null로 반환될 수 있습니다.`,
  })
  @ApiQuery({
    name: 'startDate',
    description: '조회 시작 코호트 날짜 (예: 2026-06-20)',
    required: false,
  })
  @ApiQuery({
    name: 'endDate',
    description: '조회 종료 코호트 날짜 (예: 2026-07-24)',
    required: false,
  })
  async getRetentionCohortStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return await this.logsService.getRetentionCohorts(startDate, endDate);
  }

  // 직업별 유저의 시간당 평균 경험치 획득량을 조회합니다.
  // 세션 시간과 몬스터 처치 경험치를 이용해 효율 지표를 계산합니다.
  @Get('stats/exp-per-hour')
  @ApiOperation({
    summary: '직업별 시간당 평균 경험치 API',
    description: `각 직업별 유저의 평균 시간당 경험치 획득량을 반환합니다. 
       SESSION_LOGIN/SESSION_LOGOUT으로 플레이 시간을 계산하고, MONSTER_KILL의 경험치를 합산합니다.`,
  })
  async getExpPerHourStats() {
    return await this.logsService.getExpPerHourByJob();
  }

  // 직업별로 HP/MP 포션의 시간당 평균 사용량을 조회합니다.
  // item_use 이벤트를 기반으로 포션 소비 패턴을 확인할 수 있습니다.
  @Get('stats/potion-per-hour')
  @ApiOperation({
    summary: '직업별 시간당 평균 포션 사용량 API',
    description: `각 직업별 유저의 시간당 평균 포션 사용량을 반환합니다. 
       플레이 시간은 SESSION_LOGIN/SESSION_LOGOUT 기준으로 계산하며, ITEM_USE 이벤트를 집계합니다.`,
  })
  async getPotionPerHourStats() {
    return await this.logsService.getPotionPerHourByJob();
  }
}
