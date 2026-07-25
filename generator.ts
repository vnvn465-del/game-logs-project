import * as crypto from 'crypto';
import { EventType } from './src/logs/type/event-type.enum';

// 서버 주소
const SERVER_URL =
  process.env.LOG_SERVER_URL ?? 'http://localhost:3000/api/v1/logs';

// 인증 토큰
const AUTH_TOKEN = process.env.LOG_AUTH_TOKEN ?? 'Bearer rush-secret-token';

// 전체 유저 수
const TOTAL_USERS = Number(process.env.TOTAL_USERS ?? 300);

// 인스턴스 1개당 최대 유저 수
const USERS_PER_INSTANCE = 30;

// 최근 가입일 생성 범위
const LOOKBACK_DAYS = 35;

// 요청 1회당 최대 이벤트 수
const MAX_EVENTS_PER_BATCH = 150;

// 인스턴스당 최대 요청 수
const MAX_REQUESTS_PER_MINUTE_PER_INSTANCE = 120;

// 120 req/min 기준 최소 간격 = 500ms
const MIN_REQUEST_INTERVAL_MS = Math.ceil(
  60000 / MAX_REQUESTS_PER_MINUTE_PER_INSTANCE,
);

// 실제 요청 간격
const REQUEST_INTERVAL_MS = Math.max(
  Number(process.env.REQUEST_INTERVAL_MS ?? 1200),
  MIN_REQUEST_INTERVAL_MS,
);

// 요청 타임아웃 30초
const HTTP_TIMEOUT_MS = 30000;

// 요청 본문 최대 크기 4MB
const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;

// 요청 횟수 집계 구간 1분
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// 제한 초과 시 차단 시간 30초
const BLOCK_DURATION_MS = 30 * 1000;

// 중복 이벤트 비율
const DUPLICATE_RATE = 0.02;

// DRY_RUN=1 이면 생성만 하고 전송 안 함
const DRY_RUN = process.env.DRY_RUN === '1';

// 하루를 ms로 환산한 값
const DAY_MS = 24 * 60 * 60 * 1000;

// 직업 타입
type Job = '전사' | '마법사' | '도적' | '궁수' | '해적';

// 리텐션 패턴 타입
type RetentionPattern = 'churned' | 'd1' | 'd7' | 'd30' | 'active';

// 과금 여부 타입
type PayerType = 'free' | 'payer';

// 생성할 유저 정보
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

// 서버로 전송할 로그 구조
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

// min ~ max 범위의 랜덤 정수 반환
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 주어진 확률로 true 반환
function chance(rate: number): boolean {
  return Math.random() < rate;
}

// 배열에서 랜덤 요소 1개 선택
function pickOne<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)];
}

// 지정 시간(ms)만큼 대기
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

// 두 날짜 차이를 일 단위로 계산
function diffDays(from: Date, to: Date): number {
  const a = startOfUtcDay(from).getTime();
  const b = startOfUtcDay(to).getTime();
  return Math.max(0, Math.floor((b - a) / DAY_MS));
}

// 최근 LOOKBACK_DAYS 범위 안에서 랜덤 가입일 생성
function randomJoinDate(): Date {
  const now = new Date();
  const daysAgo = randomInt(0, LOOKBACK_DAYS);
  const date = new Date(now.getTime() - daysAgo * DAY_MS);

  // 같은 날 안에서도 시각을 랜덤 부여
  date.setUTCHours(
    randomInt(0, 23),
    randomInt(0, 59),
    randomInt(0, 59),
    randomInt(0, 999),
  );

  return date;
}

// 가입일 기준으로 대략적인 레벨 생성
function makeLevelByAge(joinDate: Date): number {
  const ageDays = diffDays(joinDate, new Date());

  if (ageDays <= 3) return randomInt(1, 8);
  if (ageDays <= 7) return randomInt(5, 15);
  if (ageDays <= 14) return randomInt(10, 20);
  if (ageDays <= 30) return randomInt(15, 35);

  return randomInt(20, 45);
}

// 유저 수에 맞춰 instance id 목록 생성
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
function buildVisitOffsets(user: UserProfile): number[] {
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
  if (user.retentionPattern === 'active') {
    const extra = randomInt(3, 8);

    for (let i = 0; i < extra; i += 1) {
      offsets.add(randomInt(0, ageDays));
    }
  }

  // 오름차순 정렬 후 반환
  return Array.from(offsets).sort((a, b) => a - b);
}

// 공통 로그 객체 생성
function createLog(
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

// 주어진 시간에서 몇 초 뒤 시각 반환
function plusSeconds(date: Date, min: number, max: number): Date {
  return new Date(date.getTime() + randomInt(min, max) * 1000);
}

// 직업별 포션 사용 성향 설정
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

// 현재 레벨 기준 필요 경험치 계산
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
    user.retentionPattern === 'active' ? randomInt(8, 15) : randomInt(4, 8);

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
function generateLogsForUser(user: UserProfile): GameLogRequest[] {
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
function generateAllLogs(users: UserProfile[]): GameLogRequest[] {
  const logs: GameLogRequest[] = [];

  // 모든 유저에 대해 로그 생성
  for (const user of users) {
    logs.push(...generateLogsForUser(user));
  }

  return logs;
}

// 일부 로그를 복제해 중복 event_id 상황 생성
function injectDuplicates(logs: GameLogRequest[]): GameLogRequest[] {
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

// 로그 순서를 섞어 비정렬 도착 상황 생성
function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [items[i], items[j]] = [items[j], items[i]];
  }
}

// 실제 전송할 JSON body 크기를 byte 단위로 계산
function getRequestBodySizeBytes(batch: GameLogRequest[]): number {
  return Buffer.byteLength(JSON.stringify(batch), 'utf8');
}

// 로그를 배치 단위로 분할
function splitIntoBatches(logs: GameLogRequest[]): GameLogRequest[][] {
  const batches: GameLogRequest[][] = [];

  // 현재 만들고 있는 배치
  let currentBatch: GameLogRequest[] = [];

  for (const log of logs) {
    // 현재 배치에 다음 로그를 추가한 가상 배치
    const nextBatch = [...currentBatch, log];

    // 최대 이벤트 수 초과 여부
    const exceedsCountLimit = nextBatch.length > MAX_EVENTS_PER_BATCH;

    // 4MB 본문 크기 초과 여부
    const exceedsBodySizeLimit =
      getRequestBodySizeBytes(nextBatch) > MAX_REQUEST_BODY_BYTES;

    // 두 제한 모두 통과하면 현재 배치에 추가
    if (!exceedsCountLimit && !exceedsBodySizeLimit) {
      currentBatch = nextBatch;
      continue;
    }

    // 현재 배치가 비어 있는데도 초과면 단일 로그가 너무 큰 것
    if (currentBatch.length === 0) {
      throw new Error('단일 로그 1개가 요청 본문 최대 크기(4MB)를 초과합니다.');
    }

    // 현재 배치를 먼저 확정
    batches.push(currentBatch);

    // 새 배치를 현재 로그 1개로 시작
    currentBatch = [log];

    // 단일 로그 1개 자체가 4MB 초과인지 다시 검사
    if (getRequestBodySizeBytes(currentBatch) > MAX_REQUEST_BODY_BYTES) {
      throw new Error('단일 로그 1개가 요청 본문 최대 크기(4MB)를 초과합니다.');
    }
  }

  // 남은 배치가 있으면 마지막에 추가
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

// instance_id 기준으로 로그를 그룹핑
function groupLogsByInstance(
  logs: GameLogRequest[],
): Record<string, GameLogRequest[]> {
  const grouped: Record<string, GameLogRequest[]> = {};

  for (const log of logs) {
    // 처음 보는 instance_id면 배열 초기화
    if (!grouped[log.instance_id]) {
      grouped[log.instance_id] = [];
    }

    // 해당 인스턴스 배열에 로그 추가
    grouped[log.instance_id].push(log);
  }

  return grouped;
}

// 인스턴스별로 다시 배치 분할
function splitIntoBatchesByInstance(
  logs: GameLogRequest[],
): Record<string, GameLogRequest[][]> {
  // 먼저 instance_id 단위로 그룹핑
  const grouped = groupLogsByInstance(logs);

  const result: Record<string, GameLogRequest[][]> = {};

  for (const [instanceId, instanceLogs] of Object.entries(grouped)) {
    // 각 인스턴스 로그를 다시 배치로 분할
    result[instanceId] = splitIntoBatches(instanceLogs);
  }

  return result;
}

// fetch에 타임아웃 적용
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  // AbortController로 타임아웃 제어
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

// 인스턴스별 1분 120회 제한 확인
async function waitForRateLimit(
  instanceId: string,
  requestTimestamps: number[],
): Promise<void> {
  while (true) {
    const now = Date.now();

    // 1분이 지난 요청 기록은 제거
    while (
      requestTimestamps.length > 0 &&
      now - requestTimestamps[0] >= RATE_LIMIT_WINDOW_MS
    ) {
      requestTimestamps.shift();
    }

    // 현재 120회 미만이면 바로 통과
    if (requestTimestamps.length < MAX_REQUESTS_PER_MINUTE_PER_INSTANCE) {
      return;
    }

    // 제한 초과 시 30초 동안 전송 중단
    console.warn(
      `[${instanceId}] 1분당 요청 제한(120회) 초과. 30초 동안 전송을 중단합니다.`,
    );

    await sleep(BLOCK_DURATION_MS);
  }
}

// 배치 1개를 서버로 전송
async function sendBatch(
  instanceId: string,
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

      // 컨트롤러가 배열 자체를 받는 구조에 맞춤
      body: JSON.stringify(batch),
    },
    HTTP_TIMEOUT_MS,
  );

  const text = await response.text();

  // 실패 시 인스턴스/배치 번호 포함해서 예외 처리
  if (!response.ok) {
    throw new Error(
      `[${instanceId}] 배치 ${index + 1}/${total} 전송 실패: ${response.status} ${text}`,
    );
  }

  console.log(
    `[전송 성공][${instanceId}] ${index + 1}/${total} - ${batch.length}개 이벤트`,
  );
}

// 인스턴스별로 자기 배치를 순차 전송
async function sendInstanceBatches(
  instanceId: string,
  batches: GameLogRequest[][],
): Promise<void> {
  // 최근 1분 요청 시각 기록용 배열
  const requestTimestamps: number[] = [];

  for (let i = 0; i < batches.length; i += 1) {
    // 전송 전에 rate limit 확인
    await waitForRateLimit(instanceId, requestTimestamps);

    // 이번 요청 시각 기록
    requestTimestamps.push(Date.now());

    // 현재 인스턴스의 i번째 배치 전송
    await sendBatch(instanceId, batches[i], i, batches.length);

    // 마지막 배치가 아니면 간격 대기
    if (i < batches.length - 1) {
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  console.log(`[${instanceId}] 모든 배치 전송 완료`);
}

// 생성 결과 요약 출력
function printSummary(
  users: UserProfile[],
  uniqueLogs: GameLogRequest[],
  finalLogs: GameLogRequest[],
  batchesByInstance: Record<string, GameLogRequest[][]>,
): void {
  const eventCounts: Record<string, number> = {};
  const userCountsByInstance: Record<string, number> = {};

  // 이벤트 타입별 개수 집계
  for (const log of finalLogs) {
    eventCounts[log.event_type] = (eventCounts[log.event_type] ?? 0) + 1;
  }

  // 인스턴스별 유저 수 집계
  for (const user of users) {
    userCountsByInstance[user.instanceId] =
      (userCountsByInstance[user.instanceId] ?? 0) + 1;
  }

  // 전체 배치 수 계산
  const totalBatchCount = Object.values(batchesByInstance).reduce(
    (sum, batches) => sum + batches.length,
    0,
  );

  console.log('='.repeat(60));
  console.log('[생성 요약]');
  console.log(`유저 수: ${users.length}`);
  console.log(`인스턴스 수: ${Object.keys(batchesByInstance).length}`);
  console.log(`인스턴스당 최대 유저 수: ${USERS_PER_INSTANCE}`);
  console.log(
    `인스턴스당 최대 요청 수: ${MAX_REQUESTS_PER_MINUTE_PER_INSTANCE} req/min`,
  );
  console.log(`요청 간격(ms): ${REQUEST_INTERVAL_MS}`);
  console.log(`요청 타임아웃(ms): ${HTTP_TIMEOUT_MS}`);
  console.log(`요청 본문 최대 크기(bytes): ${MAX_REQUEST_BODY_BYTES}`);
  console.log(`고유 로그 수: ${uniqueLogs.length}`);
  console.log(`최종 로그 수(중복 포함): ${finalLogs.length}`);
  console.log(`중복 로그 수: ${finalLogs.length - uniqueLogs.length}`);
  console.log(`전체 배치 수: ${totalBatchCount}`);
  console.log('이벤트 분포:', eventCounts);

  console.log('[인스턴스별 요약]');
  for (const [instanceId, batches] of Object.entries(batchesByInstance)) {
    // 인스턴스별 전체 이벤트 수 계산
    const eventCount = batches.reduce((sum, batch) => sum + batch.length, 0);

    console.log(
      `- ${instanceId}: users=${userCountsByInstance[instanceId] ?? 0}, batches=${batches.length}, events=${eventCount}`,
    );
  }

  console.log('='.repeat(60));
}

// 전체 실행 함수
async function main(): Promise<void> {
  // Node 18+ 환경에서 fetch 사용 가능 여부 확인
  if (typeof fetch !== 'function') {
    throw new Error('Node 18+ 환경에서 실행해 주세요.');
  }

  console.log('[Generator 시작]');

  // 1) 유저 생성
  const users = generateUsers(TOTAL_USERS);

  // 2) 중복 없는 원본 로그 생성
  const uniqueLogs = generateAllLogs(users);

  // 3) 중복 event_id 로그 추가
  const finalLogs = injectDuplicates(uniqueLogs);

  // 4) 로그 도착 순서를 랜덤하게 섞음
  shuffleInPlace(finalLogs);

  // 5) instance_id 기준으로 배치 분할
  const batchesByInstance = splitIntoBatchesByInstance(finalLogs);

  // 6) 생성 결과 요약 출력
  printSummary(users, uniqueLogs, finalLogs, batchesByInstance);

  // 7) DRY_RUN이면 실제 전송 없이 종료
  if (DRY_RUN) {
    console.log('[DRY_RUN] 전송 없이 종료');
    return;
  }

  // 8) 인스턴스별로 병렬 전송 시작
  await Promise.all(
    Object.entries(batchesByInstance).map(([instanceId, batches]) =>
      sendInstanceBatches(instanceId, batches),
    ),
  );

  console.log('[완료] 모든 인스턴스 배치 전송 종료');
}

// 최상위 에러 처리
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[실패]', message);
  process.exit(1);
});
