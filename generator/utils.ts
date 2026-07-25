import { DAY_MS, LOOKBACK_DAYS } from './constants';
import * as crypto from 'crypto';
import { GameLogRequest } from './type';

// min ~ max 범위의 랜덤 정수 반환
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 주어진 확률로 true 반환
export function chance(rate: number): boolean {
  return Math.random() < rate;
}

// 배열에서 랜덤 요소 1개 선택
export function pickOne<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)];
}

// 지정 시간(ms)만큼 대기
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 날짜를 UTC 자정으로 맞춤
export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

// 날짜에 일수 추가
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

// 두 날짜 차이를 일 단위로 계산
export function diffDays(from: Date, to: Date): number {
  const a = startOfUtcDay(from).getTime();
  const b = startOfUtcDay(to).getTime();
  return Math.max(0, Math.floor((b - a) / DAY_MS));
}

// 주어진 시간에서 몇 초 뒤 시각 반환
export function plusSeconds(date: Date, min: number, max: number): Date {
  return new Date(date.getTime() + crypto.randomInt(min, max) * 1000);
}

// 최근 LOOKBACK_DAYS 범위 안에서 랜덤 가입일 생성
export function randomJoinDate(): Date {
  const now = new Date();
  const daysAgo = crypto.randomInt(0, LOOKBACK_DAYS);
  const date = new Date(now.getTime() - daysAgo * DAY_MS);

  // 같은 날 안에서도 시각을 랜덤 부여
  date.setUTCHours(
    crypto.randomInt(0, 23),
    crypto.randomInt(0, 59),
    crypto.randomInt(0, 59),
    crypto.randomInt(0, 999),
  );

  return date;
}

// 로그 순서를 섞어 비정렬 도착 상황 생성
export function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i);
    [items[i], items[j]] = [items[j], items[i]];
  }
}

// fetch에 타임아웃 적용
export async function fetchWithTimeout(
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

// 실제 전송할 JSON body 크기를 byte 단위로 계산
export function getRequestBodySizeBytes(batch: GameLogRequest[]): number {
  return Buffer.byteLength(JSON.stringify(batch), 'utf8');
}
