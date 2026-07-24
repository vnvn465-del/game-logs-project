import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LogsController } from './logs/logs.controller';
import { LogsService } from './logs/logs.service';
import { GameLog } from './game-log.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'rush',
      password: 'rushpass',
      database: 'gamedb',
      // 👇 여기에 GameLog를 등록해줘야 DB에 테이블이 만들어집니다!
      entities: [GameLog],
      synchronize: true,
    }),
    // 👇 아까 에러 났던 이유 해결: LogsService가 쓸 GameLog 레포지토리를 등록해줍니다!
    TypeOrmModule.forFeature([GameLog]),
  ],
  controllers: [AppController, LogsController],
  providers: [AppService, LogsService],
})
export class AppModule {}
