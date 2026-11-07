import { GetApplicationStatus } from '../../application/system/get-application-status.js';
import { AppController } from './app.controller.js';

describe('AppController', () => {
  it('returns the application status', () => {
    const controller = new AppController(new GetApplicationStatus());

    expect(controller.getStatus()).toEqual({
      name: 'tcjg',
      status: 'ok',
    });
  });
});
