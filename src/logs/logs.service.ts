/* eslint-disable */
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameLog } from '../game-log.entity';
import { EventType } from './type/event-type.enum';

// 로그 적재와 통계 조회를 담당하는 서비스입니다.
// 배치 저장, DAU/매출/전환율/리텐션 등의 집계 로직이 들어있습니다.
@Injectable()
export class LogsService {
  constructor(
    @InjectRepository(GameLog)
    private readonly gameLogRepo: Repository<GameLog>,
  ) {}

  // YYYY-MM-DD 형식의 날짜 문자열을 검증하고 UTC Date로 변환합니다.
  // 잘못된 형식이면 바로 400 에러를 발생시킵니다.
  private parseDateOnly(value: string, fieldName: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(
        `${fieldName} 날짜 형식이 올바르지 않습니다. (예: 2026-07-25)`,
      );
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `${fieldName} 날짜 형식이 올바르지 않습니다. (예: 2026-07-25)`,
      );
    }

    return parsed;
  }

  // Date 객체를 YYYY-MM-DD 문자열로 바꿉니다.
  // 날짜 범위 계산 후 쿼리용 문자열을 만들 때 사용합니다.
  private formatDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  // 시작일과 종료일을 UTC 기준 조회 범위로 변환합니다.
  // end 날짜 하루 전체를 포함시키기 위해 end+1일 미만 조건으로 조회합니다.
  private buildUtcDateRange(
    startDate: string,
    endDate: string,
  ): {
    start: string;
    endExclusive: string;
    startDateOnly: string;
    endExclusiveDateOnly: string;
  } {
    const start = this.parseDateOnly(startDate, 'start');
    const end = this.parseDateOnly(endDate, 'end');

    if (start.getTime() > end.getTime()) {
      throw new BadRequestException(
        'start 날짜는 end 날짜보다 늦을 수 없습니다.',
      );
    }

    const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);

    return {
      start: start.toISOString(),
      endExclusive: endExclusive.toISOString(),
      startDateOnly: this.formatDateOnly(start),
      endExclusiveDateOnly: this.formatDateOnly(endExclusive),
    };
  }

  // DB에서 문자열로 넘어오는 숫자 값을 안전하게 number로 변환합니다.
  // null, undefined, 빈 문자열이면 0으로 처리합니다.
  private toNumber(value: any): number {
    if (value === null || value === undefined || value === '') return 0;
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  // 로그 배치를 저장합니다.
  // 요청 내부 중복과 DB 기존 중복을 모두 제외하고 실제 저장 개수를 반환합니다.
  async saveLogsBatch(logs: GameLog[]): Promise<any> {
    if (!logs || !Array.isArray(logs) || logs.length === 0) {
      throw new BadRequestException(
        '로그 데이터가 배열 형식이 아니거나 비어있습니다.',
      );
    }

    // 같은 요청 안에서 event_id가 중복된 로그는 하나만 남깁니다.
    const uniqueMap = new Map<string, GameLog>();

    for (const log of logs) {
      // event_id는 중복 제거의 기준이므로 반드시 있어야 합니다.
      if (!log?.event_id) {
        throw new BadRequestException('모든 로그에는 event_id가 필요합니다.');
      }

      if (!uniqueMap.has(log.event_id)) {
        uniqueMap.set(log.event_id, log);
      }
    }

    const uniqueLogs = Array.from(uniqueMap.values());
    const receivedCount = logs.length;
    const duplicateInRequestCount = receivedCount - uniqueLogs.length;

    // 요청 전체가 중복이면 DB 작업 없이 바로 응답합니다.
    if (uniqueLogs.length === 0) {
      return {
        status: 'success',
        received_count: receivedCount,
        inserted_count: 0,
        duplicate_count: receivedCount,
      };
    }

    try {
      // DB에 이미 존재하는 event_id를 미리 조회해서 중복 저장을 피합니다.
      const eventIds = uniqueLogs.map((log) => log.event_id);

      const existingRows = await this.gameLogRepo
        .createQueryBuilder('log')
        .select('log.event_id', 'event_id')
        .where('log.event_id IN (:...eventIds)', { eventIds })
        .getRawMany();

      const existingEventIdSet = new Set(
        existingRows.map((row) => row.event_id as string),
      );

      // DB에 없는 로그만 실제 insert 대상으로 분리합니다.
      const insertTargets = uniqueLogs.filter(
        (log) => !existingEventIdSet.has(log.event_id),
      );

      // insert + orIgnore 로 한 번 더 안전하게 중복을 무시합니다.
      if (insertTargets.length > 0) {
        await this.gameLogRepo
          .createQueryBuilder()
          .insert()
          .into(GameLog)
          .values(insertTargets)
          .orIgnore()
          .execute();
      }

      const insertedCount = insertTargets.length;
      const duplicateCount = duplicateInRequestCount + existingEventIdSet.size;

      return {
        status: 'success',
        received_count: receivedCount,
        inserted_count: insertedCount,
        duplicate_count: duplicateCount,
      };
    } catch (error) {
      console.error('로그 적재 중 에러 발생:', error);
      throw error;
    }
  }

  // 날짜별 로그인 유저 수를 집계해 DAU를 반환합니다.
  // generator의 SESSION_LOGIN 이벤트를 기준으로 계산합니다.
  async getDau(startDate: string, endDate: string): Promise<any> {
    const { start, endExclusive } = this.buildUtcDateRange(startDate, endDate);

    const result = await this.gameLogRepo
      .createQueryBuilder('log')
      .select(`DATE(log.occurred_at AT TIME ZONE 'UTC')`, 'date')
      .addSelect('COUNT(DISTINCT log.user_id)', 'dau')
      .where('log.event_type = :type', { type: EventType.SESSION_LOGIN })
      .andWhere(
        'log.occurred_at >= :start AND log.occurred_at < :endExclusive',
        {
          start,
          endExclusive,
        },
      )
      .groupBy(`DATE(log.occurred_at AT TIME ZONE 'UTC')`)
      .orderBy('date', 'ASC')
      .getRawMany();

    // 문자열로 내려올 수 있는 count 값을 number로 변환해 반환합니다.
    return result.map((row) => ({
      date: row.date,
      dau: this.toNumber(row.dau),
    }));
  }

  // 기간 내 총매출, 활성유저수, 결제유저수, ARPU, ARPPU를 반환합니다.
  // ARPU는 활성유저 기준, ARPPU는 결제유저 기준으로 계산합니다.
  async getRevenue(startDate: string, endDate: string): Promise<any> {
    const { start, endExclusive } = this.buildUtcDateRange(startDate, endDate);

    const [revenueResult, activeUserResult] = await Promise.all([
      this.gameLogRepo
        .createQueryBuilder('log')
        .select(
          `COALESCE(SUM(CAST(log.payload->>'amount' AS INTEGER)), 0)`,
          'total_revenue',
        )
        .addSelect('COUNT(DISTINCT log.user_id)', 'paying_users')
        .where('log.event_type = :type', { type: EventType.SHOP_PURCHASE })
        .andWhere(
          'log.occurred_at >= :start AND log.occurred_at < :endExclusive',
          {
            start,
            endExclusive,
          },
        )
        .getRawOne(),

      this.gameLogRepo
        .createQueryBuilder('log')
        .select('COUNT(DISTINCT log.user_id)', 'active_users')
        .where('log.event_type = :type', { type: EventType.SESSION_LOGIN })
        .andWhere(
          'log.occurred_at >= :start AND log.occurred_at < :endExclusive',
          {
            start,
            endExclusive,
          },
        )
        .getRawOne(),
    ]);

    const totalRevenue = this.toNumber(revenueResult?.total_revenue);
    const payingUsers = this.toNumber(revenueResult?.paying_users);
    const activeUsers = this.toNumber(activeUserResult?.active_users);

    // ARPU = 총매출 / 활성유저수
    const arpu =
      activeUsers > 0 ? Number((totalRevenue / activeUsers).toFixed(2)) : 0;

    // ARPPU = 총매출 / 결제유저수
    const arppu =
      payingUsers > 0 ? Number((totalRevenue / payingUsers).toFixed(2)) : 0;

    return {
      total_revenue: totalRevenue,
      active_users: activeUsers,
      paying_users: payingUsers,
      arpu,
      arppu,
    };
  }

  // 활성유저 중 실제 결제한 유저 비율을 계산합니다.
  // SESSION_LOGIN을 활성 기준으로, SHOP_PURCHASE를 결제 기준으로 사용합니다.
  async getConversionRate(startDate: string, endDate: string): Promise<any> {
    const { start, endExclusive } = this.buildUtcDateRange(startDate, endDate);

    const [activeUserResult, payingUserResult] = await Promise.all([
      this.gameLogRepo
        .createQueryBuilder('log')
        .select('COUNT(DISTINCT log.user_id)', 'active_users')
        .where('log.event_type = :type', { type: EventType.SESSION_LOGIN })
        .andWhere(
          'log.occurred_at >= :start AND log.occurred_at < :endExclusive',
          {
            start,
            endExclusive,
          },
        )
        .getRawOne(),

      this.gameLogRepo
        .createQueryBuilder('log')
        .select('COUNT(DISTINCT log.user_id)', 'paying_users')
        .where('log.event_type = :type', { type: EventType.SHOP_PURCHASE })
        .andWhere(
          'log.occurred_at >= :start AND log.occurred_at < :endExclusive',
          {
            start,
            endExclusive,
          },
        )
        .getRawOne(),
    ]);

    const activeUsers = this.toNumber(activeUserResult?.active_users);
    const payingUsers = this.toNumber(payingUserResult?.paying_users);

    // 결제 전환율 = 결제유저수 / 활성유저수 * 100
    const conversionRatePercent =
      activeUsers > 0
        ? Number(((payingUsers / activeUsers) * 100).toFixed(2))
        : 0;

    return {
      total_active_users: activeUsers,
      paying_users: payingUsers,
      conversion_rate_percent: conversionRatePercent,
    };
  }

  // 유저의 최초 로그인일을 코호트 기준일로 잡아 D1/D7/D30 리텐션을 계산합니다.
  // 같은 유저가 기준일 + 1, +7, +30일에 다시 로그인했는지를 집계합니다.
  async getRetention(): Promise<any> {
    const tableName = this.gameLogRepo.metadata.tableName;

    const query = `
      WITH FirstLogin AS (
        SELECT
          user_id,
          DATE(MIN(occurred_at AT TIME ZONE 'UTC')) AS first_date
        FROM ${tableName}
        WHERE event_type = $1
        GROUP BY user_id
      )
      SELECT
        f.first_date AS cohort_date,
        COUNT(DISTINCT f.user_id) AS new_users,

        COUNT(DISTINCT CASE
          WHEN DATE(l.occurred_at AT TIME ZONE 'UTC') = f.first_date + INTERVAL '1 day'
          THEN l.user_id
        END) AS d1_users,

        COUNT(DISTINCT CASE
          WHEN DATE(l.occurred_at AT TIME ZONE 'UTC') = f.first_date + INTERVAL '7 day'
          THEN l.user_id
        END) AS d7_users,

        COUNT(DISTINCT CASE
          WHEN DATE(l.occurred_at AT TIME ZONE 'UTC') = f.first_date + INTERVAL '30 day'
          THEN l.user_id
        END) AS d30_users,

        ROUND(
          COALESCE(
            COUNT(DISTINCT CASE
              WHEN DATE(l.occurred_at AT TIME ZONE 'UTC') = f.first_date + INTERVAL '1 day'
              THEN l.user_id
            END) * 100.0 / NULLIF(COUNT(DISTINCT f.user_id), 0),
            0
          ),
          2
        ) AS d1_retention_percent,

        ROUND(
          COALESCE(
            COUNT(DISTINCT CASE
              WHEN DATE(l.occurred_at AT TIME ZONE 'UTC') = f.first_date + INTERVAL '7 day'
              THEN l.user_id
            END) * 100.0 / NULLIF(COUNT(DISTINCT f.user_id), 0),
            0
          ),
          2
        ) AS d7_retention_percent,

        ROUND(
          COALESCE(
            COUNT(DISTINCT CASE
              WHEN DATE(l.occurred_at AT TIME ZONE 'UTC') = f.first_date + INTERVAL '30 day'
              THEN l.user_id
            END) * 100.0 / NULLIF(COUNT(DISTINCT f.user_id), 0),
            0
          ),
          2
        ) AS d30_retention_percent

      FROM FirstLogin f
      LEFT JOIN ${tableName} l
        ON f.user_id = l.user_id
       AND l.event_type = $1
      GROUP BY f.first_date
      ORDER BY f.first_date ASC;
    `;

    return await this.gameLogRepo.query(query, [EventType.SESSION_LOGIN]);
  }

  // 직업별로 유저 1명당 평균 시간당 경험치 획득량을 계산합니다.
  // 세션 로그인/로그아웃으로 플레이 시간을 구하고, 몬스터 처치 경험치를 합산합니다.
  async getExpPerHourByJob(): Promise<any> {
    const tableName = this.gameLogRepo.metadata.tableName;

    const query = `
      WITH SessionBounds AS (
        SELECT
          user_id,
          session_id,
          MAX(CASE WHEN event_type = $1 THEN payload->>'job' END) AS job,
          MIN(CASE WHEN event_type = $1 THEN occurred_at END) AS login_at,
          MAX(CASE WHEN event_type = $2 THEN occurred_at END) AS logout_at
        FROM ${tableName}
        WHERE event_type IN ($1, $2)
        GROUP BY user_id, session_id
      ),
      UserPlayTime AS (
        SELECT
          user_id,
          job,
          SUM(
            GREATEST(
              EXTRACT(EPOCH FROM (COALESCE(logout_at, login_at) - login_at)) / 3600.0,
              1.0 / 60.0
            )
          ) AS play_hours
        FROM SessionBounds
        WHERE job IS NOT NULL
          AND login_at IS NOT NULL
        GROUP BY user_id, job
      ),
      UserExp AS (
        SELECT
          user_id,
          payload->>'job' AS job,
          COALESCE(SUM(CAST(payload->>'exp' AS INTEGER)), 0) AS total_exp
        FROM ${tableName}
        WHERE event_type = $3
        GROUP BY user_id, payload->>'job'
      )
      SELECT
        t.job AS job,
        COUNT(DISTINCT t.user_id) AS users,
        ROUND(AVG(COALESCE(e.total_exp, 0) / NULLIF(t.play_hours, 0)), 2) AS exp_per_hour
      FROM UserPlayTime t
      LEFT JOIN UserExp e
        ON t.user_id = e.user_id
       AND t.job = e.job
      GROUP BY t.job
      ORDER BY exp_per_hour DESC, t.job ASC;
    `;

    return await this.gameLogRepo.query(query, [
      EventType.SESSION_LOGIN,
      EventType.SESSION_LOGOUT,
      EventType.MONSTER_KILL,
    ]);
  }

  // 직업별로 HP/MP 포션의 시간당 평균 사용량을 계산합니다.
  // 세션 기준 플레이 시간을 분모로 두고 item_use 이벤트 수를 집계합니다.
  async getPotionPerHourByJob(): Promise<any> {
    const tableName = this.gameLogRepo.metadata.tableName;

    const query = `
      WITH SessionBounds AS (
        SELECT
          user_id,
          session_id,
          MAX(CASE WHEN event_type = $1 THEN payload->>'job' END) AS job,
          MIN(CASE WHEN event_type = $1 THEN occurred_at END) AS login_at,
          MAX(CASE WHEN event_type = $2 THEN occurred_at END) AS logout_at
        FROM ${tableName}
        WHERE event_type IN ($1, $2)
        GROUP BY user_id, session_id
      ),
      UserPlayTime AS (
        SELECT
          user_id,
          job,
          SUM(
            GREATEST(
              EXTRACT(EPOCH FROM (COALESCE(logout_at, login_at) - login_at)) / 3600.0,
              1.0 / 60.0
            )
          ) AS play_hours
        FROM SessionBounds
        WHERE job IS NOT NULL
          AND login_at IS NOT NULL
        GROUP BY user_id, job
      ),
      PotionTypes AS (
        SELECT 'HP포션' AS potion_type
        UNION ALL
        SELECT 'MP포션' AS potion_type
      ),
      UserPotion AS (
        SELECT
          user_id,
          payload->>'job' AS job,
          payload->>'item_id' AS potion_type,
          COUNT(*) AS potion_count
        FROM ${tableName}
        WHERE event_type = $3
          AND payload->>'item_id' IN ('HP포션', 'MP포션')
        GROUP BY user_id, payload->>'job', payload->>'item_id'
      )
      SELECT
        t.job AS job,
        pt.potion_type AS potion_type,
        COUNT(DISTINCT t.user_id) AS users,
        ROUND(
          AVG(COALESCE(p.potion_count, 0) / NULLIF(t.play_hours, 0)),
          2
        ) AS potion_per_hour
      FROM UserPlayTime t
      CROSS JOIN PotionTypes pt
      LEFT JOIN UserPotion p
        ON t.user_id = p.user_id
       AND t.job = p.job
       AND pt.potion_type = p.potion_type
      GROUP BY t.job, pt.potion_type
      ORDER BY t.job ASC, pt.potion_type ASC;
    `;

    return await this.gameLogRepo.query(query, [
      EventType.SESSION_LOGIN,
      EventType.SESSION_LOGOUT,
      EventType.ITEM_USE,
    ]);
  }
}
