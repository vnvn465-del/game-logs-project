import {
  MAX_EVENTS_PER_BATCH,
  MAX_REQUEST_BODY_BYTES,
  RATE_LIMIT_WINDOW_MS,
  MAX_REQUESTS_PER_MINUTE_PER_INSTANCE,
  BLOCK_DURATION_MS,
  SERVER_URL,
  AUTH_TOKEN,
  HTTP_TIMEOUT_MS,
  REQUEST_INTERVAL_MS,
} from './constants';
import { GameLogRequest } from './type';
import { getRequestBodySizeBytes, sleep, fetchWithTimeout } from './utils';

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
export function splitIntoBatchesByInstance(
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

// 인스턴스별 1분 120회 제한 확인
export async function waitForRateLimit(
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
export async function sendBatch(
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
export async function sendInstanceBatches(
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
