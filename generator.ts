import * as crypto from 'crypto';
import { EventType } from './src/logs/type/event-type.enum';

// 서버 주소
const SERVER_URL =
  process.env.LOG_SERVER_URL ?? 'http://localhost:3000/api/v1/logs';

// 인증 토큰
const AUTH_TOKEN = process.env.LOG_AUTH_TOKEN ?? 'Bearer rush-secret-token';

// 생성할 유저 수
const TOTAL_USERS = Number(process.env.TOTAL_USERS ?? 150);

// 인스턴스당 최대 유저 수
const USERS_PER_INSTANCE = 30;

// 가입일 생성 범위
const LOOKBACK_DAYS = 35;

// 배치당 최대 이벤트 수
const MAX_EVENTS_PER_BATCH = 150;

// 배치 전송 간격(ms)
const REQUEST_INTERVAL_MS = 1200;

// 요청 타임아웃(ms)
const HTTP_TIMEOUT_MS = 25000;

// 중복 이벤트 비율
const DUPLICATE_RATE = 0.02;

// 전송 없이 생성만 확인할지 여부
const DRY_RUN = process.env.DRY_RUN === '1';

// 하루 밀리초
const DAY_MS = 24 * 60 * 60 * 1000;

// 직업 타입
type Job = '전사' | '마법사' | '도적' | '궁수' | '해적';

// 리텐션 패턴
type RetentionPattern = 'churned' | 'd1' | 'd7' | 'd30' | 'active';

// 과금 타입
type PayerType = 'free' | 'payer';

// 유저 정보
interface UserProfile {
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

// 서버로 보내는 로그 구조
interface GameLogRequest {
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

// 직업 목록
const JOBS: Job[] = ['전사', '마법사', '도적', '궁수', '해적'];

// 채널 목록
const CHANNELS = ['CH_1', 'CH_2', 'CH_3'];

// 맵 목록
const MAPS = ['헤네시스', '엘리니아', '커닝시티', '페리온', '슬리피우드'];

// 몬스터 목록
const MONSTERS = [
  { id: 'orange_mushroom', name: '주황버섯', exp: 15 },
  { id: 'slime', name: '슬라임', exp: 10 },
  { id: 'pig', name: '돼지', exp: 8 },
  { id: 'stump', name: '스텀프', exp: 12 },
  { id: 'horny_mushroom', name: '뿔버섯', exp: 20 },
];

// 결제 상품 목록
const SHOP_ITEMS = [
  { id: 'gem_small', name: '젬 소형', amount: 1500 },
  { id: 'gem_large', name: '젬 대형', amount: 5000 },
  { id: 'avatar_box', name: '아바타 박스', amount: 3000 },
  { id: 'pet_food', name: '펫 먹이', amount: 500 },
];

// 랜덤 정수
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 확률 판정
function chance(rate: number): boolean {
  return Math.random() < rate;
}

// 배열에서 랜덤 하나 선택
function pickOne<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)];
}

// 대기 함수
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 날짜를 UTC 자정으로 맞춤
function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

// 날짜에 일수 추가
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

// 두 날짜 차이를 일수로 계산
function diffDays(from: Date, to: Date): number {
  const a = startOfUtcDay(from).getTime();
  const b = startOfUtcDay(to).getTime();
  return Math.max(0, Math.floor((b - a) / DAY_MS));
}

// 최근 LOOKBACK_DAYS 내 랜덤 가입일 생성
function randomJoinDate(): Date {
  const now = new Date();
  const daysAgo = randomInt(0, LOOKBACK_DAYS);
  const date = new Date(now.getTime() - daysAgo * DAY_MS);

  date.setUTCHours(
    randomInt(0, 23),
    randomInt(0, 59),
    randomInt(0, 59),
    randomInt(0, 999),
  );

  return date;
}

// 가입일에 따라 대략적인 레벨 생성
function makeLevelByAge(joinDate: Date): number {
  const ageDays = diffDays(joinDate, new Date());

  if (ageDays <= 3) return randomInt(1, 8);
  if (ageDays <= 7) return randomInt(5, 15);
  if (ageDays <= 14) return randomInt(10, 20);
  if (ageDays <= 30) return randomInt(15, 35);

  return randomInt(20, 45);
}

// user 수에 맞는 instance id 목록 생성
function makeInstanceIds(userCount: number): string[] {
  const count = Math.ceil(userCount / USERS_PER_INSTANCE);
  return Array.from({ length: count }, (_, i) => `pod-${i + 1}`);
}

// 리텐션 패턴 랜덤 선택
function pickRetentionPattern(): RetentionPattern {
  const roll = Math.random();

  if (roll < 0.2) return 'churned';
  if (roll < 0.4) return 'd1';
  if (roll < 0.6) return 'd7';
  if (roll < 0.8) return 'd30';
  return 'active';
}

// 과금 유저 여부 선택
function pickPayerType(): PayerType {
  return chance(0.22) ? 'payer' : 'free';
}

// 유저 목록 생성
function generateUsers(count: number): UserProfile[] {
  const instanceIds = makeInstanceIds(count);

  return Array.from({ length: count }, (_, index) => {
    const id = 1001 + index;
    const joinDate = randomJoinDate();

    return {
      id,
      nickname: `Player${id}`,
      level: makeLevelByAge(joinDate),
      job: pickOne(JOBS),
      joinDate,
      characterId: 200001 + index,
      channelId: pickOne(CHANNELS),
      instanceId: instanceIds[Math.floor(index / USERS_PER_INSTANCE)],
      retentionPattern: pickRetentionPattern(),
      payerType: pickPayerType(),
      exp: 0,
    };
  });
}

// 리텐션 패턴에 따라 방문 일자 목록 생성
function buildVisitOffsets(user: UserProfile): number[] {
  const ageDays = diffDays(user.joinDate, new Date());
  const offsets = new Set<number>([0]);

  // D1 유저는 1일차 재방문
  if (
    ageDays >= 1 &&
    ['d1', 'd7', 'd30', 'active'].includes(user.retentionPattern)
  ) {
    offsets.add(1);
  }

  // D7 유저는 7일차 재방문
  if (ageDays >= 7 && ['d7', 'd30', 'active'].includes(user.retentionPattern)) {
    offsets.add(7);
  }

  // D30 유저는 30일차 재방문
  if (ageDays >= 30 && ['d30', 'active'].includes(user.retentionPattern)) {
    offsets.add(30);
  }

  // active 유저는 추가 방문일 더 생성
  if (user.retentionPattern === 'active') {
    const extra = randomInt(3, 8);

    for (let i = 0; i < extra; i += 1) {
      offsets.add(randomInt(0, ageDays));
    }
  }

  return Array.from(offsets).sort((a, b) => a - b);
}

// 로그 공통 객체 생성
function createLog(
  user: UserProfile,
  eventType: EventType,
  occurredAt: Date,
  sessionId: string,
  payload: Record<string, unknown>,
): GameLogRequest {
  return {
    event_id: crypto.randomUUID(),
    instance_id: user.instanceId,
    event_type: eventType,
    user_id: user.id,
    character_id: user.characterId,
    session_id: sessionId,
    channel_id: user.channelId,
    payload,
    occurred_at: occurredAt.toISOString(),
  };
}

// 시간 몇 초 앞으로 이동
function plusSeconds(date: Date, min: number, max: number): Date {
  return new Date(date.getTime() + randomInt(min, max) * 1000);
}

// 직업별 포션 선택
function choosePotion(job: Job): string | null {
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

// 레벨업 필요 경험치
function requiredExp(level: number): number {
  return 100 + level * 20;
}

// 한 세션 안의 로그 생성
function generateSessionLogs(
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
    randomInt(10, 22),
    randomInt(0, 59),
    randomInt(0, 59),
    randomInt(0, 999),
  );

  // 현재 맵 선택
  let currentMap = pickOne(MAPS);

  // 로그인 이벤트
  logs.push(
    createLog(user, EventType.SESSION_LOGIN, currentTime, sessionId, {
      nickname: user.nickname,
      job: user.job,
      level: user.level,
      is_new_user: isFirstVisit,
    }),
  );

  // 맵 입장 이벤트
  currentTime = plusSeconds(currentTime, 10, 60);
  logs.push(
    createLog(user, EventType.MAP_ENTER, currentTime, sessionId, {
      map_id: currentMap,
      job: user.job,
    }),
  );

  // 사냥 횟수 결정
  const killCount =
    user.retentionPattern === 'active' ? randomInt(8, 15) : randomInt(4, 8);

  // 세션당 결제는 한 번만 하게 제한
  let purchased = false;

  for (let i = 0; i < killCount; i += 1) {
    const monster = pickOne(MONSTERS);

    // 몬스터 처치
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

    // 가끔 경험치 획득 이벤트도 추가
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

    // 포션 사용
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

    // 일부 유저만 결제
    if (!purchased && user.payerType === 'payer' && chance(0.18)) {
      const item = pickOne(SHOP_ITEMS);

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

      purchased = true;
    }

    // 가끔 맵 이동
    if (chance(0.12)) {
      currentMap = pickOne(MAPS);
      currentTime = plusSeconds(currentTime, 10, 30);
      logs.push(
        createLog(user, EventType.MAP_ENTER, currentTime, sessionId, {
          map_id: currentMap,
          job: user.job,
        }),
      );
    }

    // 경험치가 충분하면 레벨업
    while (user.exp >= requiredExp(user.level)) {
      user.exp -= requiredExp(user.level);
      user.level += 1;

      currentTime = plusSeconds(currentTime, 5, 15);
      logs.push(
        createLog(user, EventType.LEVEL_UP, currentTime, sessionId, {
          current_level: user.level,
          job: user.job,
        }),
      );
    }
  }

  // 로그아웃 이벤트
  currentTime = plusSeconds(currentTime, 30, 120);
  logs.push(
    createLog(user, EventType.SESSION_LOGOUT, currentTime, sessionId, {
      level: user.level,
      job: user.job,
    }),
  );

  return logs;
}

// 유저 한 명의 전체 로그 생성
function generateLogsForUser(user: UserProfile): GameLogRequest[] {
  const logs: GameLogRequest[] = [];
  const offsets = buildVisitOffsets(user);

  for (let i = 0; i < offsets.length; i += 1) {
    const visitDate = addDays(startOfUtcDay(user.joinDate), offsets[i]);
    const isFirstVisit = i === 0;

    logs.push(...generateSessionLogs(user, visitDate, isFirstVisit));
  }

  return logs;
}

// 전체 유저의 로그 생성
function generateAllLogs(users: UserProfile[]): GameLogRequest[] {
  const logs: GameLogRequest[] = [];

  for (const user of users) {
    logs.push(...generateLogsForUser(user));
  }

  return logs;
}

// 일부 로그를 복제해 중복 event_id 상황을 만든다.
function injectDuplicates(logs: GameLogRequest[]): GameLogRequest[] {
  const duplicateCount = Math.max(1, Math.floor(logs.length * DUPLICATE_RATE));
  const duplicates: GameLogRequest[] = [];

  for (let i = 0; i < duplicateCount; i += 1) {
    const original = pickOne(logs);
    duplicates.push({
      ...original,
      payload: { ...original.payload },
    });
  }

  return [...logs, ...duplicates];
}

// 이벤트 순서를 섞어 정렬되지 않은 도착 상황을 만든다.
function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [items[i], items[j]] = [items[j], items[i]];
  }
}

// 전체 로그를 여러 배치로 나눈다.
function splitIntoBatches(logs: GameLogRequest[]): GameLogRequest[][] {
  const batches: GameLogRequest[][] = [];

  for (let i = 0; i < logs.length; i += MAX_EVENTS_PER_BATCH) {
    batches.push(logs.slice(i, i + MAX_EVENTS_PER_BATCH));
  }

  return batches;
}

// fetch에 타임아웃을 적용한다.
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// 배치 하나를 서버로 전송한다.
async function sendBatch(
  batch: GameLogRequest[],
  index: number,
  total: number,
): Promise<void> {
  const response = await fetchWithTimeout(
    SERVER_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: AUTH_TOKEN,
      },
      body: JSON.stringify(batch),
    },
    HTTP_TIMEOUT_MS,
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `배치 ${index + 1}/${total} 전송 실패: ${response.status} ${text}`,
    );
  }

  console.log(`[전송 성공] ${index + 1}/${total} - ${batch.length}개 이벤트`);
}

// 생성 결과 요약 출력
function printSummary(
  users: UserProfile[],
  uniqueLogs: GameLogRequest[],
  finalLogs: GameLogRequest[],
  batches: GameLogRequest[][],
): void {
  const eventCounts: Record<string, number> = {};

  for (const log of finalLogs) {
    eventCounts[log.event_type] = (eventCounts[log.event_type] ?? 0) + 1;
  }

  console.log('='.repeat(60));
  console.log('[생성 요약]');
  console.log(`유저 수: ${users.length}`);
  console.log(`고유 로그 수: ${uniqueLogs.length}`);
  console.log(`최종 로그 수(중복 포함): ${finalLogs.length}`);
  console.log(`중복 로그 수: ${finalLogs.length - uniqueLogs.length}`);
  console.log(`배치 수: ${batches.length}`);
  console.log('이벤트 분포:', eventCounts);
  console.log('='.repeat(60));
}

// 전체 실행 함수
async function main(): Promise<void> {
  // Node 18+ fetch 확인
  if (typeof fetch !== 'function') {
    throw new Error('Node 18+ 환경에서 실행해 주세요.');
  }

  console.log('[Generator 시작]');

  // 유저 생성
  const users = generateUsers(TOTAL_USERS);

  // 중복 없는 원본 로그 생성
  const uniqueLogs = generateAllLogs(users);

  // 중복 이벤트 추가
  const finalLogs = injectDuplicates(uniqueLogs);

  // 순서 섞기
  shuffleInPlace(finalLogs);

  // 배치 분할
  const batches = splitIntoBatches(finalLogs);

  // 생성 결과 출력
  printSummary(users, uniqueLogs, finalLogs, batches);

  // DRY_RUN이면 전송 없이 종료
  if (DRY_RUN) {
    console.log('[DRY_RUN] 전송 없이 종료');
    return;
  }

  // 배치 순차 전송
  for (let i = 0; i < batches.length; i += 1) {
    await sendBatch(batches[i], i, batches.length);

    if (i < batches.length - 1) {
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  console.log('[완료] 모든 배치 전송 종료');
}

// 에러 처리
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[실패]', message);
  process.exit(1);
});
