import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LogsController } from './logs/logs.controller';
import { LogsService } from './logs/logs.service';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'rush',
      password: 'rushpass',
      database: 'gamedb',
      entities: [], // 조금 이따가 로그 테이블을 만들면 여기에 넣을 겁니다!
      synchronize: true, // 엔티티를 바탕으로 DB 테이블을 자동 생성 (스프링의 ddl-auto: update)
    }),
  ],
  controllers: [AppController, LogsController],
  providers: [AppService, LogsService],
})
export class AppModule {}
