// generator.js
/* eslint-disable */
const crypto = require('crypto');

const SERVER_URL = 'http://localhost:3000/api/v1/logs';
const AUTH_TOKEN = 'Bearer rush-secret-token';
const INSTANCE_ID = 'pod-1';

// 유저별 레벨 메모리 (점진적 레벨업)
const userLevels = { 1001: 1, 1002: 1, 1003: 1, 1004: 1, 1005: 1 };

function getRandomDate() {
  const now = new Date();
  const pastDays = Math.floor(Math.random() * 7); 
  now.setDate(now.getDate() - pastDays);
  return now.toISOString();
}

function generateRandomLog() {
  const userId = Math.floor(Math.random() * 5) + 1001; 
  
  // 유저 번호에 따라 직업 평생 고정
  const jobs = ['전사', '마법사', '도적', '궁수', '해적'];
  const fixedJob = jobs[userId % jobs.length]; 

  // 1. 가중치 룰렛 (이벤트 발생 확률 조작)
  const eventWeights = {
    'session_login': 1,
    'monster_kill': 50, // 몬스터 학살
    'item_use': 20,     // 포션 섭취
    'level_up': 2,
    'shop_purchase': 1,
    'session_logout': 1
  };

  let totalWeight = 0;
  for (let event in eventWeights) totalWeight += eventWeights[event];

  let randomPick = Math.random() * totalWeight;
  let type = '';
  for (let event in eventWeights) {
    randomPick -= eventWeights[event];
    if (randomPick <= 0) {
      type = event;
      break;
    }
  }

  const log = {
    event_id: crypto.randomUUID(),
    instance_id: INSTANCE_ID,
    event_type: type,
    user_id: userId,
    channel_id: `CH_${Math.floor(Math.random() * 3) + 1}`,
    payload: {},
    occurred_at: getRandomDate(),
  };

  // 2. 타입별 Payload 상세 세팅
  if (type === 'shop_purchase') {
    const shopItems = [
      { id: 'gem_pack_small', amount: 1500 },
      { id: 'gem_pack_large', amount: 5000 },
      { id: 'avatar_box', amount: 3000 },
      { id: 'pet_food', amount: 500 }
    ];
    const pickedItem = shopItems[Math.floor(Math.random() * shopItems.length)];
    log.payload = { item_id: pickedItem.id, amount: pickedItem.amount };
  } 
  else if (type === 'monster_kill') {
    const monsters = [
      { name: '주황버섯', exp: 15 },
      { name: '슬라임', exp: 10 },
      { name: '스텀프', exp: 12 },
      { name: '돼지', exp: 8 },
      { name: '뿔버섯', exp: 20 }
    ];
    const pickedMonster = monsters[Math.floor(Math.random() * monsters.length)];
    log.payload = { monster: pickedMonster.name, exp: pickedMonster.exp, job: fixedJob };
  } 
  else if (type === 'level_up') {
    userLevels[userId] += 1; // 레벨 1씩 증가
    log.payload = { current_level: userLevels[userId] };
  } 
  else if (type === 'item_use') {
    // 3. 직업별 포션 성공 확률 (실패 시 로그 드랍)
    let potionType = null;
    const rand = Math.random();

    if (fixedJob === '전사') {
      if (rand < 0.75) potionType = 'HP포션';      
      else if (rand < 0.85) potionType = 'MP포션'; 
    } 
    else if (fixedJob === '마법사') {
      if (rand < 0.10) potionType = 'HP포션';      
      else if (rand < 0.85) potionType = 'MP포션'; 
    } 
    else if (fixedJob === '궁수' || fixedJob === '해적') {
      if (rand < 0.30) potionType = 'HP포션';      
      else if (rand < 0.60) potionType = 'MP포션'; 
    } 
    else if (fixedJob === '도적') {
      if (rand < 0.05) potionType = 'HP포션';      
      else if (rand < 0.15) potionType = 'MP포션'; 
    }

    if (potionType === null) return null; // 먹기 실패! 로그 생성 취소
    log.payload = { item_id: potionType, job: fixedJob };
  }

  return log;
}

// 3. 버퍼(배치) 전송 로직
async function startGenerator() {
  console.log('🚀 [로그 생성기] 가동 시작! (3초마다 배치 전송)');
  let logBuffer = []; 

  setInterval(async () => {
    const tryCount = Math.floor(Math.random() * 20) + 10;
    for (let i = 0; i < tryCount; i++) {
      const newLog = generateRandomLog();
      if (newLog !== null) logBuffer.push(newLog); // 성공한 로그만 바구니에 담기
    }

    // 멱등성 검증용 고의 중복 전송
    if (Math.random() > 0.7 && logBuffer.length > 0) {
      const duplicateLog = { ...logBuffer[0] };
      logBuffer.push(duplicateLog);
      console.log(`⚠️ [테스트] 고의 중복 전송: ${duplicateLog.event_id}`);
    }

    if (logBuffer.length === 0) return;

    const payloadToSend = [...logBuffer];
    logBuffer = []; 

    try {
      const response = await fetch(SERVER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': AUTH_TOKEN,
        },
        body: JSON.stringify(payloadToSend),
      });

      const result = await response.json();
      console.log(`📦 [전송 완료] ${payloadToSend.length}개 발송 -> 서버 응답:`, result);
    } catch (error) {
      console.error('❌ 서버 통신 에러', error.message);
    }
  }, 3000);
}

startGenerator();
