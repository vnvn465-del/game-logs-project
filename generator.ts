/* eslint-disable */
import * as crypto from 'crypto';
import { EventType } from './src/logs/type/event-type.enum';

const SERVER_URL = 'http://localhost:3000/api/v1/logs';
const AUTH_TOKEN = 'Bearer rush-secret-token';
const INSTANCE_ID = 'pod-1';

// TypeScript 인터페이스 정의
interface GameLogRequest {
  event_id: string;
  instance_id: string;
  event_type: EventType;
  user_id: number;
  channel_id: string;
  payload: Record<string, any>;
  occurred_at: string;
}

const userLevels: Record<number, number> = {
  1001: 1,
  1002: 1,
  1003: 1,
  1004: 1,
  1005: 1,
};

function getRandomDate(): string {
  const now = new Date();
  const pastDays = Math.floor(Math.random() * 7);
  now.setDate(now.getDate() - pastDays);
  return now.toISOString();
}

function generateRandomLog(): GameLogRequest | null {
  const userId = Math.floor(Math.random() * 5) + 1001;
  const jobs = ['전사', '마법사', '도적', '궁수', '해적'];
  const fixedJob = jobs[userId % jobs.length];

  const eventWeights: Partial<Record<EventType, number>> = {
    [EventType.SESSION_LOGIN]: 1,
    [EventType.MONSTER_KILL]: 50,
    [EventType.ITEM_USE]: 20,
    [EventType.LEVEL_UP]: 2,
    [EventType.SHOP_PURCHASE]: 1,
    [EventType.SESSION_LOGOUT]: 1,
  };

  let totalWeight = 0;
  for (const event in eventWeights) totalWeight += eventWeights[event];

  let randomPick = Math.random() * totalWeight;
  let type: EventType | undefined;
  for (const event of Object.keys(eventWeights) as EventType[]) {
    const weight = eventWeights[event]!;

    randomPick -= weight;

    if (randomPick <= 0) {
      type = event;
      break;
    }
  }

  if (!type) {
    throw new Error('이벤트 타입 선택에 실패했습니다.');
  }

  // 미리 정의한 타입에 맞게 객체 생성
  const log: GameLogRequest = {
    event_id: crypto.randomUUID(),
    instance_id: INSTANCE_ID,
    event_type: type,
    user_id: userId,
    channel_id: `CH_${Math.floor(Math.random() * 3) + 1}`,
    payload: {},
    occurred_at: getRandomDate(),
  };

  if (type === EventType.SHOP_PURCHASE) {
    const shopItems = [
      { id: 'gem_pack_small', amount: 1500 },
      { id: 'gem_pack_large', amount: 5000 },
      { id: 'avatar_box', amount: 3000 },
      { id: 'pet_food', amount: 500 },
    ];
    const pickedItem = shopItems[Math.floor(Math.random() * shopItems.length)];
    log.payload = { item_id: pickedItem.id, amount: pickedItem.amount };
  } else if (type === EventType.MONSTER_KILL) {
    const monsters = [
      { name: '주황버섯', exp: 15 },
      { name: '슬라임', exp: 10 },
      { name: '스텀프', exp: 12 },
      { name: '돼지', exp: 8 },
      { name: '뿔버섯', exp: 20 },
    ];
    const pickedMonster = monsters[Math.floor(Math.random() * monsters.length)];
    log.payload = {
      monster: pickedMonster.name,
      exp: pickedMonster.exp,
      job: fixedJob,
    };
  } else if (type === EventType.LEVEL_UP) {
    userLevels[userId] += 1;
    log.payload = { current_level: userLevels[userId] };
  } else if (type === 'item_use') {
    let potionType: string | null = null;
    const rand = Math.random();

    if (fixedJob === '전사') {
      if (rand < 0.75) potionType = 'HP포션';
      else if (rand < 0.85) potionType = 'MP포션';
    } else if (fixedJob === '마법사') {
      if (rand < 0.1) potionType = 'HP포션';
      else if (rand < 0.85) potionType = 'MP포션';
    } else if (fixedJob === '궁수' || fixedJob === '해적') {
      if (rand < 0.3) potionType = 'HP포션';
      else if (rand < 0.6) potionType = 'MP포션';
    } else if (fixedJob === '도적') {
      if (rand < 0.05) potionType = 'HP포션';
      else if (rand < 0.15) potionType = 'MP포션';
    }

    if (potionType === null) return null;
    log.payload = { item_id: potionType, job: fixedJob };
  }

  return log;
}

// 비동기 함수 타입 정의
async function startGenerator(): Promise<void> {
  console.log('[로그 생성기 TS 버전]  (3초마다 배치 전송)');
  let logBuffer: GameLogRequest[] = []; // 배열 타입 지정

  setInterval(async () => {
    const tryCount = Math.floor(Math.random() * 20) + 10;
    for (let i = 0; i < tryCount; i++) {
      const newLog = generateRandomLog();
      if (newLog !== null) logBuffer.push(newLog);
    }

    if (Math.random() > 0.7 && logBuffer.length > 0) {
      const duplicateLog = { ...logBuffer[0] };
      logBuffer.push(duplicateLog);
      console.log(`[테스트] 고의 중복 전송: ${duplicateLog.event_id}`);
    }

    if (logBuffer.length === 0) return;

    const payloadToSend = [...logBuffer];
    logBuffer = [];

    try {
      const response = await fetch(SERVER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: AUTH_TOKEN,
        },
        body: JSON.stringify(payloadToSend),
      });

      const result = await response.json();
      console.log(
        `[전송 완료] ${payloadToSend.length}개 발송 -> 서버 응답:`,
        result,
      );
    } catch (error: any) {
      console.error('서버 통신 에러', error.message);
    }
  }, 3000);
}

startGenerator();
