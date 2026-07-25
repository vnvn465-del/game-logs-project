import { UserProfile, GameLogRequest } from './type';
import {
  USERS_PER_INSTANCE,
  MAX_REQUEST_BODY_BYTES,
  MAX_REQUESTS_PER_MINUTE_PER_INSTANCE,
  HTTP_TIMEOUT_MS,
  REQUEST_INTERVAL_MS,
  TOTAL_USERS,
  DRY_RUN,
} from './constants';
import { shuffleInPlace } from './utils';
import {
  generateUsers,
  generateAllLogs,
  injectDuplicates,
} from './generator.helpers';
import {
  splitIntoBatchesByInstance,
  sendInstanceBatches,
} from './generator.send';

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
