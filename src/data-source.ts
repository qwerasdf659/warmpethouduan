import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';

loadEnv();

/**
 * TypeORM CLI 专用 DataSource（迁移生成/执行）。
 * synchronize 永远为 false，表结构一律走 migration。
 *
 * entities 用 glob 而非显式数组：漏登记一个实体会让 migration:generate
 * 把它对应的表判定为「多余」并生成 DROP TABLE，是高危陷阱。
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: ['src/entities/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
  logging: ['error', 'warn'],
});
