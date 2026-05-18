import { Cron } from 'croner';

export interface Scheduler {
  schedule(cronExpr: string, fn: () => void | Promise<void>): void;
}

export function createScheduler(timezone: string): Scheduler {
  return {
    schedule(cronExpr, fn) {
      new Cron(cronExpr, { timezone }, () => {
        Promise.resolve(fn()).catch(err => {
          console.error(`scheduled job error (${cronExpr}):`, err);
        });
      });
    },
  };
}
