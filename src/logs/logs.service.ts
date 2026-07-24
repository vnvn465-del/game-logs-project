/* eslint-disable */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameLog } from '../game-log.entity';

// 로그 적재 코드
@Injectable()
export class LogsService {
  constructor(
    @InjectRepository(GameLog)
    private readonly gameLogRepo: Repository<GameLog>,
  ) {}

  async saveLogsBatch(logs: GameLog[]): Promise<any> {
    try {
      // 일반 save() 대신 insert() 구문을 짜서 중복을 무시하도록 명령합니다.
      const result = await this.gameLogRepo
        .createQueryBuilder()
        .insert()
        .into(GameLog)
        .values(logs)
        .orIgnore() // <= event_id가 겹치면 무시
        .execute();

      return { status: 'success', inserted_count: logs.length };
    } catch (error) {
      console.error('로그 적재 중 에러 발생:', error);
      throw error;
    }
  }

  //  DAU (일일 활성 유저 수) 구하기
  async getDau(startDate: string, endDate: string): Promise<any> {
    const result = await this.gameLogRepo
      .createQueryBuilder('log')
      .select('DATE(log.occurred_at)', 'date')
      .addSelect('COUNT(DISTINCT log.user_id)', 'dau')
      .where('log.event_type = :type', { type: 'session_login' })
      .andWhere('log.occurred_at >= :start AND log.occurred_at <= :end', {
        start: startDate,
        end: endDate,
      })
      .groupBy('DATE(log.occurred_at)')
      .orderBy('date', 'ASC')
      .getRawMany();

    return result;
  }

  // 매출 및 ARPU 구하기
  async getRevenue(startDate: string, endDate: string): Promise<any> {
    const result = await this.gameLogRepo
      .createQueryBuilder('log')
      .select("SUM(CAST(log.payload->>'amount' AS INTEGER))", 'total_revenue')
      .addSelect('COUNT(DISTINCT log.user_id)', 'paying_users')
      .where('log.event_type = :type', { type: 'shop_purchase' })
      .andWhere('log.occurred_at >= :start AND log.occurred_at <= :end', {
        start: startDate,
        end: endDate,
      })
      .getRawOne();

    const totalRevenue = result.total_revenue
      ? parseInt(result.total_revenue, 10)
      : 0;
    const payingUsers = result.paying_users
      ? parseInt(result.paying_users, 10)
      : 0;
    const arpu = payingUsers > 0 ? (totalRevenue / payingUsers).toFixed(2) : 0;

    return {
      total_revenue: totalRevenue,
      paying_users: payingUsers,
      arpu: Number(arpu),
    };
  }

  //  결제 전환율 (PU / DAU)
  async getConversionRate(startDate: string, endDate: string): Promise<any> {
    // 1) 해당 기간의 전체 고유 접속 유저 수 (DAU 개념)
    const dauResult = await this.gameLogRepo
      .createQueryBuilder('log')
      .select('COUNT(DISTINCT log.user_id)', 'total_users')
      .where('log.event_type = :type', { type: 'session_login' })
      .andWhere('log.occurred_at >= :start AND log.occurred_at <= :end', {
        start: startDate,
        end: endDate,
      })
      .getRawOne();

    // 2) 해당 기간의 결제 유저 수 (PU)
    const puResult = await this.gameLogRepo
      .createQueryBuilder('log')
      .select('COUNT(DISTINCT log.user_id)', 'paying_users')
      .where('log.event_type = :type', { type: 'shop_purchase' })
      .andWhere('log.occurred_at >= :start AND log.occurred_at <= :end', {
        start: startDate,
        end: endDate,
      })
      .getRawOne();

    const totalUsers = dauResult.total_users
      ? parseInt(dauResult.total_users, 10)
      : 0;
    const payingUsers = puResult.paying_users
      ? parseInt(puResult.paying_users, 10)
      : 0;

    // 3) 비율 계산 (소수점 2자리 % 로 표시)
    const conversionRate =
      totalUsers > 0 ? ((payingUsers / totalUsers) * 100).toFixed(2) : 0;

    return {
      total_active_users: totalUsers,
      paying_users: payingUsers,
      conversion_rate_percent: Number(conversionRate),
    };
  }

  // 리텐션 (D1, D7 재접속률)
  async getRetention(): Promise<any> {
    /* 
      [리텐션 SQL 로직 설명]
      1. CTE(WITH)를 써서 유저별 '최초 접속일(first_login)'을 먼저 찾습니다.
      2. 그 최초 접속일과 원본 로그 테이블을 JOIN 합니다.
      3. 최초 접속일로부터 정확히 1일 뒤(D1), 7일 뒤(D7)에 로그인한 기록이 있으면 카운트를 셉니다.
    */
    const query = `
      WITH FirstLogin AS (
        SELECT user_id, DATE(MIN(occurred_at)) as first_date
        FROM game_logs
        WHERE event_type = 'session_login'
        GROUP BY user_id
      )
      SELECT 
        f.first_date as "기준일(Cohort)",
        COUNT(DISTINCT f.user_id) as "신규유저수",
        COUNT(DISTINCT CASE WHEN DATE(l.occurred_at) = f.first_date + INTERVAL '1 day' THEN l.user_id END) as "D1_접속자",
        COUNT(DISTINCT CASE WHEN DATE(l.occurred_at) = f.first_date + INTERVAL '7 day' THEN l.user_id END) as "D7_접속자",
        
        -- 백분율(%) 계산
        ROUND(COUNT(DISTINCT CASE WHEN DATE(l.occurred_at) = f.first_date + INTERVAL '1 day' THEN l.user_id END) * 100.0 / COUNT(DISTINCT f.user_id), 2) as "D1_리텐션(%)",
        ROUND(COUNT(DISTINCT CASE WHEN DATE(l.occurred_at) = f.first_date + INTERVAL '7 day' THEN l.user_id END) * 100.0 / COUNT(DISTINCT f.user_id), 2) as "D7_리텐션(%)"
      FROM FirstLogin f
      LEFT JOIN game_logs l ON f.user_id = l.user_id AND l.event_type = 'session_login'
      GROUP BY f.first_date
      ORDER BY f.first_date ASC;
    `;

    // SQL을 DB에 그대로 쏴서 결과를 받습니다
    const result = await this.gameLogRepo.query(query);
    return result;
  }

  // ==========================================
  // 직업별 '유저 평균' 1시간당 경험치 획득량
  // ==========================================
  async getExpPerHourByJob(): Promise<any> {
    const query = `
      WITH UserPlayTime AS (
        SELECT 
          user_id,
          payload->>'job' as job,
          GREATEST(EXTRACT(EPOCH FROM (MAX(occurred_at) - MIN(occurred_at))) / 3600.0, 1.0) as play_hours
        FROM game_logs
        WHERE payload->>'job' IS NOT NULL
        GROUP BY user_id, payload->>'job'
      ),
      UserExp AS (
        SELECT 
          user_id,
          payload->>'job' as job,
          SUM(CAST(payload->>'exp' AS INTEGER)) as user_total_exp
        FROM game_logs
        WHERE event_type = 'monster_kill'
        GROUP BY user_id, payload->>'job'
      )
      SELECT 
        t.job as "직업",
        ROUND(AVG(COALESCE(e.user_total_exp, 0) / t.play_hours), 2) as "1시간당_평균_경험치"
      FROM UserPlayTime t
      LEFT JOIN UserExp e ON t.user_id = e.user_id AND t.job = e.job
      GROUP BY t.job
      ORDER BY "1시간당_평균_경험치" DESC;
    `;
    return await this.gameLogRepo.query(query);
  }

  // ==========================================
  //  직업별 '유저 평균' 1시간당 포션 사용량 (HP/MP 분리)
  // ==========================================
  async getPotionPerHourByJob(): Promise<any> {
    const query = `
      WITH UserPlayTime AS (
        SELECT 
          user_id,
          payload->>'job' as job,
          GREATEST(EXTRACT(EPOCH FROM (MAX(occurred_at) - MIN(occurred_at))) / 3600.0, 1.0) as play_hours
        FROM game_logs
        WHERE payload->>'job' IS NOT NULL
        GROUP BY user_id, payload->>'job'
      ),
      UserPotion AS (
        SELECT 
          user_id,
          payload->>'job' as job,
          payload->>'item_id' as potion_type,
          COUNT(*) as user_potion_count
        FROM game_logs
        WHERE event_type = 'item_use' AND payload->>'item_id' IN ('HP포션', 'MP포션')
        GROUP BY user_id, payload->>'job', payload->>'item_id'
      )
      SELECT 
        t.job as "직업",
        p.potion_type as "포션종류",
        ROUND(AVG(COALESCE(p.user_potion_count, 0) / t.play_hours), 2) as "1시간당_평균_포션사용량"
      FROM UserPlayTime t
      JOIN UserPotion p ON t.user_id = p.user_id AND t.job = p.job
      GROUP BY t.job, p.potion_type
      ORDER BY t.job ASC, "1시간당_평균_포션사용량" DESC;
    `;
    return await this.gameLogRepo.query(query);
  }
}
