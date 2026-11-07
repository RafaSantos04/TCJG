import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GetApplicationStatus } from './application/system/get-application-status.js';
import { environmentSchema } from './config/environment.schema.js';
import { DatabaseModule } from './infrastructure/persistence/database.module.js';
import { FinancialModule } from './financial.module.js';
import { AppController } from './presentation/http/app.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validationSchema: environmentSchema,
    }),
    DatabaseModule,
    FinancialModule,
  ],
  controllers: [AppController],
  providers: [GetApplicationStatus],
})
export class AppModule {}
