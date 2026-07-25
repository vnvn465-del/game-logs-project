import { Job } from './type';

// 서버 주소
export const SERVER_URL =
  process.env.LOG_SERVER_URL ?? 'http://localhost:3000/api/v1/logs';

// 인증 토큰
export const AUTH_TOKEN =
  process.env.LOG_AUTH_TOKEN ?? 'Bearer rush-secret-token';

// 전체 유저 수
export const TOTAL_USERS = Number(process.env.TOTAL_USERS ?? 300);

// 인스턴스 1개당 최대 유저 수
export const USERS_PER_INSTANCE = 30;

// 최근 가입일 생성 범위
export const LOOKBACK_DAYS = 35;

// 요청 1회당 최대 이벤트 수
export const MAX_EVENTS_PER_BATCH = 150;

// 인스턴스당 최대 요청 수
export const MAX_REQUESTS_PER_MINUTE_PER_INSTANCE = 120;

// 120 req/min 기준 최소 간격 = 500ms
export const MIN_REQUEST_INTERVAL_MS = Math.ceil(
  60000 / MAX_REQUESTS_PER_MINUTE_PER_INSTANCE,
);

// 실제 요청 간격
export const REQUEST_INTERVAL_MS = Math.max(
  Number(process.env.REQUEST_INTERVAL_MS ?? 1200),
  MIN_REQUEST_INTERVAL_MS,
);

// 요청 타임아웃 30초
export const HTTP_TIMEOUT_MS = 30000;

// 요청 본문 최대 크기 4MB
export const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;

// 요청 횟수 집계 구간 1분
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// 제한 초과 시 차단 시간 30초
export const BLOCK_DURATION_MS = 30 * 1000;

// 중복 이벤트 비율
export const DUPLICATE_RATE = 0.02;

// DRY_RUN=1 이면 생성만 하고 전송 안 함
export const DRY_RUN = process.env.DRY_RUN === '1';

// 하루를 ms로 환산한 값
export const DAY_MS = 24 * 60 * 60 * 1000;

// 직업 목록
export const JOBS: Job[] = ['전사', '마법사', '도적', '궁수', '해적'];

// 채널 목록
export const CHANNELS = ['CH_1', 'CH_2', 'CH_3'];

// 맵 목록
export const MAPS = [
  '헤네시스',
  '엘리니아',
  '커닝시티',
  '페리온',
  '슬리피우드',
];

// 몬스터 목록
export const MONSTERS = [
  { id: 'orange_mushroom', name: '주황버섯', exp: 15 },
  { id: 'slime', name: '슬라임', exp: 10 },
  { id: 'pig', name: '돼지', exp: 8 },
  { id: 'stump', name: '스텀프', exp: 12 },
  { id: 'horny_mushroom', name: '뿔버섯', exp: 20 },
];

// 결제 상품 목록
export const SHOP_ITEMS = [
  { id: 'gem_small', name: '젬 소형', amount: 1500 },
  { id: 'gem_large', name: '젬 대형', amount: 5000 },
  { id: 'avatar_box', name: '아바타 박스', amount: 3000 },
  { id: 'pet_food', name: '펫 먹이', amount: 500 },
];
