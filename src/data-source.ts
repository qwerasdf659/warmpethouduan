import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { Pet } from './entities/pet.entity';

loadEnv();

/**
 * TypeORM CLI 专用 DataSource（迁移生成/执行）。
 * synchronize 永远为 false，表结构一律走 migration。
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [User, Pet],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
  logging: ['error', 'warn'],
});
