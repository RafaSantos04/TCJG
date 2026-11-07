import { Controller, Get } from '@nestjs/common';
import { GetApplicationStatus } from '../../application/system/get-application-status.js';

@Controller()
export class AppController {
  constructor(private readonly getApplicationStatus: GetApplicationStatus) {}

  @Get()
  getStatus() {
    return this.getApplicationStatus.execute();
  }
}
