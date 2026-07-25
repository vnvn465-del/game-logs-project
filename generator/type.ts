import { EventType } from '../src/logs/type/event-type.enum';

// 직업 타입
export type Job = '전사' | '마법사' | '도적' | '궁수' | '해적';

// 리텐션 패턴 타입
export type RetentionPattern = 'churned' | 'd1' | 'd7' | 'd30' | 'active';

// 과금 여부 타입
export type PayerType = 'free' | 'payer';

// 생성할 유저 정보
export interface UserProfile {
  id: number;
  nickname: string;
  level: number;
  job: Job;
  joinDate: Date;
  characterId: number;
  channelId: string;
  instanceId: string;
  retentionPattern: RetentionPattern;
  payerType: PayerType;
  exp: number;
}

// 서버로 전송할 로그 구조
export interface GameLogRequest {
  event_id: string;
  instance_id: string;
  event_type: EventType;
  user_id: number;
  character_id: number;
  session_id: string;
  channel_id: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}
