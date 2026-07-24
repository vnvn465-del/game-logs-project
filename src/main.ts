import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('러쉬에잇 과제 API 명세서')
    .setDescription('게임 로그 적재 및 통계 파이프라인 API 문서입니다.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  const port = 3000;
  await app.listen(port);

  console.log(`Swagger 문서: http://localhost:${port}/api-docs`);
}

// Promise 예외 처리 추가
bootstrap().catch((err: Error) => {
  console.error('서버 실행 중 에러 발생:', err.message);
});
