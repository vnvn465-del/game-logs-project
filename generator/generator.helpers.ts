import { EventType } from '../src/logs/type/event-type.enum';
import * as crypto from 'crypto';
import {
  USERS_PER_INSTANCE,
  JOBS,
  CHANNELS,
  MAPS,
  MONSTERS,
  SHOP_ITEMS,
  DUPLICATE_RATE,
} from './constants';
import {
  RetentionPattern,
  PayerType,
  UserProfile,
  GameLogRequest,
  Job,
} from './type';
import {
  diffDays,
  chance,
  randomJoinDate,
  pickOne,
  plusSeconds,
  addDays,
  startOfUtcDay,
} from './utils';

// 가입일 기준으로 대략적인 레벨 생성
export function makeLevelByAge(joinDate: Date): number {
  const ageDays = diffDays(joinDate, new Date());

  if (ageDays <= 3) return crypto.randomInt(1, 8);
  if (ageDays <= 7) return crypto.randomInt(5, 15);
  if (ageDays <= 14) return crypto.randomInt(10, 20);
  if (ageDays <= 30) return crypto.randomInt(15, 35);

  return crypto.randomInt(20, 45);
}

// 유저 수에 맞춰 instance id 목록 생성
export function makeInstanceIds(userCount: number): string[] {
  const count = Math.ceil(userCount / USERS_PER_INSTANCE);
  return Array.from({ length: count }, (_, i) => `pod-${i + 1}`);
}

// 리텐션 패턴 랜덤 선택
export function pickRetentionPattern(): RetentionPattern {
  const roll = Math.random();

  if (roll < 0.2) return 'churned';
  if (roll < 0.4) return 'd1';
  if (roll < 0.6) return 'd7';
  if (roll < 0.8) return 'd30';
  return 'active';
}

// 과금 유저 여부 선택
export function pickPayerType(): PayerType {
  return chance(0.22) ? 'payer' : 'free';
}

// 유저 목록 생성
export function generateUsers(count: number): UserProfile[] {
  // 전체 유저 수에 맞는 인스턴스 목록 생성
  const instanceIds = makeInstanceIds(count);

  return Array.from({ length: count }, (_, index) => {
    // user_id 시작값
    const id = 1001 + index;

    // 유저별 가입일 생성
    const joinDate = randomJoinDate();

    return {
      id,
      nickname: `Player${id}`,
      level: makeLevelByAge(joinDate),
      job: pickOne(JOBS),
      joinDate,
      characterId: 200001 + index,
      channelId: pickOne(CHANNELS),

      // 30명 단위로 같은 인스턴스에 배정
      instanceId: instanceIds[Math.floor(index / USERS_PER_INSTANCE)],

      retentionPattern: pickRetentionPattern(),
      payerType: pickPayerType(),

      // 누적 경험치 추적용 값
      exp: 0,
    };
  });
}

// 리텐션 패턴에 따라 방문 offset 목록 생성
export function buildVisitOffsets(user: UserProfile): number[] {
  const ageDays = diffDays(user.joinDate, new Date());

  // 최초 방문일은 항상 포함
  const offsets = new Set<number>([0]);

  // D1 이상 유지 패턴이면 1일차 방문 추가
  if (
    ageDays >= 1 &&
    ['d1', 'd7', 'd30', 'active'].includes(user.retentionPattern)
  ) {
    offsets.add(1);
  }

  // D7 이상 유지 패턴이면 7일차 방문 추가
  if (ageDays >= 7 && ['d7', 'd30', 'active'].includes(user.retentionPattern)) {
    offsets.add(7);
  }

  // D30 이상 유지 패턴이면 30일차 방문 추가
  if (ageDays >= 30 && ['d30', 'active'].includes(user.retentionPattern)) {
    offsets.add(30);
  }

  // active 유저는 추가 방문일을 더 생성
  if (user.retentionPattern === 'active' && ageDays >= 1) {
    const extra = crypto.randomInt(3, 8);

    for (let i = 0; i < extra; i += 1) {
      offsets.add(crypto.randomInt(0, ageDays));
    }
  }

  // 오름차순 정렬 후 반환
  return Array.from(offsets).sort((a, b) => a - b);
}

// 공통 로그 객체 생성
export function createLog(
  user: UserProfile,
  eventType: EventType,
  occurredAt: Date,
  sessionId: string,
  payload: Record<string, unknown>,
): GameLogRequest {
  return {
    // event_id는 매번 유니크하게 생성
    event_id: crypto.randomUUID(),

    // 어떤 인스턴스에서 발생한 로그인지 표시
    instance_id: user.instanceId,

    event_type: eventType,
    user_id: user.id,
    character_id: user.characterId,
    session_id: sessionId,
    channel_id: user.channelId,
    payload,

    // ISO8601 UTC 형식으로 전송
    occurred_at: occurredAt.toISOString(),
  };
}

// 직업별 포션 사용 성향 설정
export function choosePotion(job: Job): string | null {
  const roll = Math.random();

  if (job === '전사') {
    if (roll < 0.6) return 'HP포션';
    if (roll < 0.75) return 'MP포션';
    return null;
  }

  if (job === '마법사') {
    if (roll < 0.15) return 'HP포션';
    if (roll < 0.65) return 'MP포션';
    return null;
  }

  if (job === '도적') {
    if (roll < 0.2) return 'HP포션';
    if (roll < 0.35) return 'MP포션';
    return null;
  }

  if (job === '궁수' || job === '해적') {
    if (roll < 0.3) return 'HP포션';
    if (roll < 0.5) return 'MP포션';
    return null;
  }

  return null;
}

// 현재 레벨 기준 필요 경험치 계산
export function requiredExp(level: number): number {
  return 100 + level * 20;
}

// 한 세션 안의 로그 생성
export function generateSessionLogs(
  user: UserProfile,
  visitDate: Date,
  isFirstVisit: boolean,
): GameLogRequest[] {
  const logs: GameLogRequest[] = [];

  // 세션 ID 생성
  const sessionId = crypto.randomUUID();

  // 세션 시작 시각
  let currentTime = new Date(visitDate);
  currentTime.setUTCHours(
    crypto.randomInt(10, 22),
    crypto.randomInt(0, 59),
    crypto.randomInt(0, 59),
    crypto.randomInt(0, 999),
  );

  // 현재 맵 선택
  let currentMap = pickOne(MAPS);

  // 로그인 이벤트 생성
  logs.push(
    createLog(user, EventType.SESSION_LOGIN, currentTime, sessionId, {
      nickname: user.nickname,
      job: user.job,
      level: user.level,
      is_new_user: isFirstVisit,
    }),
  );

  // 맵 입장 이벤트 생성
  currentTime = plusSeconds(currentTime, 10, 60);
  logs.push(
    createLog(user, EventType.MAP_ENTER, currentTime, sessionId, {
      map_id: currentMap,
      job: user.job,
    }),
  );

  // active 유저는 더 오래 플레이하도록 사냥 횟수 증가
  const killCount =
    user.retentionPattern === 'active'
      ? crypto.randomInt(8, 15)
      : crypto.randomInt(4, 8);

  // 세션당 결제는 1번만 허용
  let purchased = false;

  // 사냥 횟수만큼 반복
  for (let i = 0; i < killCount; i += 1) {
    // 이번 루프에서 처치할 몬스터 선택
    const monster = pickOne(MONSTERS);

    // 몬스터 처치 이벤트 생성
    currentTime = plusSeconds(currentTime, 20, 90);
    logs.push(
      createLog(user, EventType.MONSTER_KILL, currentTime, sessionId, {
        monster_id: monster.id,
        monster: monster.name,
        exp: monster.exp,
        map_id: currentMap,
        job: user.job,
      }),
    );

    // 누적 경험치 증가
    user.exp += monster.exp;

    // 일부 상황에서 EXP_GAIN 이벤트 추가
    if (chance(0.15)) {
      currentTime = plusSeconds(currentTime, 5, 20);
      logs.push(
        createLog(user, EventType.EXP_GAIN, currentTime, sessionId, {
          amount: monster.exp,
          source: 'monster_kill',
          map_id: currentMap,
          job: user.job,
        }),
      );
    }

    // 직업별 성향에 따라 포션 사용 이벤트 발생
    const potion = choosePotion(user.job);
    if (potion) {
      currentTime = plusSeconds(currentTime, 5, 20);
      logs.push(
        createLog(user, EventType.ITEM_USE, currentTime, sessionId, {
          item_id: potion,
          job: user.job,
        }),
      );
    }

    // 과금 유저이고 아직 미결제 상태면 결제 이벤트 발생 가능
    if (!purchased && user.payerType === 'payer' && chance(0.18)) {
      // 구매 상품 랜덤 선택
      const item = pickOne(SHOP_ITEMS);

      // 결제 이벤트 생성
      currentTime = plusSeconds(currentTime, 10, 40);
      logs.push(
        createLog(user, EventType.SHOP_PURCHASE, currentTime, sessionId, {
          item_id: item.id,
          product_name: item.name,
          amount: item.amount,
          currency: 'KRW',
          job: user.job,
        }),
      );

      // 세션 내 추가 결제 방지
      purchased = true;
    }

    // 일정 확률로 맵 이동 이벤트 발생
    if (chance(0.12)) {
      // 새 맵 선택
      currentMap = pickOne(MAPS);

      // MAP_ENTER 이벤트 생성
      currentTime = plusSeconds(currentTime, 10, 30);
      logs.push(
        createLog(user, EventType.MAP_ENTER, currentTime, sessionId, {
          map_id: currentMap,
          job: user.job,
        }),
      );
    }

    // 현재 경험치가 충분한 동안 레벨업 반복 처리
    while (user.exp >= requiredExp(user.level)) {
      // 필요 경험치 차감
      user.exp -= requiredExp(user.level);

      // 레벨 1 증가
      user.level += 1;

      // LEVEL_UP 이벤트 생성
      currentTime = plusSeconds(currentTime, 5, 15);
      logs.push(
        createLog(user, EventType.LEVEL_UP, currentTime, sessionId, {
          current_level: user.level,
          job: user.job,
        }),
      );
    }
  }

  // 세션 종료 시 로그아웃 이벤트 생성
  currentTime = plusSeconds(currentTime, 30, 120);
  logs.push(
    createLog(user, EventType.SESSION_LOGOUT, currentTime, sessionId, {
      level: user.level,
      job: user.job,
    }),
  );

  return logs;
}

// 유저 1명의 전체 방문 로그 생성
export function generateLogsForUser(user: UserProfile): GameLogRequest[] {
  const logs: GameLogRequest[] = [];

  // 해당 유저의 방문일 offset 목록 계산
  const offsets = buildVisitOffsets(user);

  // 방문일마다 세션 로그 생성
  for (let i = 0; i < offsets.length; i += 1) {
    // 가입일 기준 offset만큼 더한 실제 방문일
    const visitDate = addDays(startOfUtcDay(user.joinDate), offsets[i]);

    // 첫 방문이면 신규 유저로 표시
    const isFirstVisit = i === 0;

    // 세션 로그 누적
    logs.push(...generateSessionLogs(user, visitDate, isFirstVisit));
  }

  return logs;
}

// 전체 유저의 로그 생성
export function generateAllLogs(users: UserProfile[]): GameLogRequest[] {
  const logs: GameLogRequest[] = [];

  // 모든 유저에 대해 로그 생성
  for (const user of users) {
    logs.push(...generateLogsForUser(user));
  }

  return logs;
}

// 일부 로그를 복제해 중복 event_id 상황 생성
export function injectDuplicates(logs: GameLogRequest[]): GameLogRequest[] {
  // 전체 로그 수의 일정 비율만큼 중복 생성
  const duplicateCount = Math.max(1, Math.floor(logs.length * DUPLICATE_RATE));

  const duplicates: GameLogRequest[] = [];

  for (let i = 0; i < duplicateCount; i += 1) {
    // 원본 로그 1개 랜덤 선택
    const original = pickOne(logs);

    // event_id까지 동일하게 복제
    duplicates.push({
      ...original,
      payload: { ...original.payload },
    });
  }

  // 원본 + 중복 로그 합쳐 반환
  return [...logs, ...duplicates];
}
