/* eslint-disable prettier/prettier */
import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('game_logs')
export class GameLog {
  
  @PrimaryColumn('uuid') 
  event_id!: string; // 👈 느낌표 추가됨!

  @Column({ type: 'varchar', length: 255 })
  instance_id!: string;

  @Column({ type: 'varchar', length: 50 })
  event_type!: string;

  @Column({ type: 'int' })
  user_id!: number;

  @Column({ type: 'int', nullable: true })
  character_id!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  session_id!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  channel_id!: string;

  @Column({ type: 'jsonb' })
  payload!: any;

  @Column({ type: 'timestamp' })
  occurred_at!: Date;

  @CreateDateColumn()
  created_at!: Date;
}
