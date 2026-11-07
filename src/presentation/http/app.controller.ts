import { Controller, Get } from '@nestjs/common';
import { GetApplicationStatus } from '../../application/system/get-application-status.js';
import { Public } from './auth/public.decorator.js';

@Controller()
@Public()
export class AppController {
  constructor(private readonly getApplicationStatus: GetApplicationStatus) {}

  @Get()
  getStatus() {
    return this.getApplicationStatus.execute();
  }
}
