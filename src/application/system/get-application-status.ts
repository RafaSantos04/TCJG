export type ApplicationStatus = Readonly<{
  name: 'tcjg';
  status: 'ok';
}>;

export class GetApplicationStatus {
  execute(): ApplicationStatus {
    return {
      name: 'tcjg',
      status: 'ok',
    };
  }
}
