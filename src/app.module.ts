import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
      entities: [GameLog],
      synchronize: true,
    }),
    // LogsService가 쓸 GameLog 레포지토리 등록
    TypeOrmModule.forFeature([GameLog]),
  ],
  controllers: [LogsController],
  providers: [LogsService],
})
export class AppModule {}
