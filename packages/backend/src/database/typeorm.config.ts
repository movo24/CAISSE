import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * TypeORM DataSource configuration for CLI migrations.
 *
 * Usage:
 *   npx typeorm migration:generate -d src/database/typeorm.config.ts src/database/migrations/InitSchema
 *   npx typeorm migration:run -d src/database/typeorm.config.ts
 *   npx typeorm migration:revert -d src/database/typeorm.config.ts
 */
export default new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL,
  entities: ['src/database/entities/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false, // NEVER true in production
  logging: process.env.NODE_ENV === 'development',
});
