import { config } from './infra/env.ts';
import { createLinearAdapter } from './infra/linear.ts';
import { AREAS } from './domain/task.ts';

async function main(): Promise<void> {
  console.log(`Bootstrapping Linear team "${config.linear.teamKey}"...`);
  const linear = createLinearAdapter({
    apiKey: config.linear.apiKey,
    teamKey: config.linear.teamKey,
    timezone: config.schedule.timezone,
  });
  await linear.init();
  console.log('✓ team found.');

  for (const area of AREAS) {
    const project = await linear.ensureProject(area);
    console.log(`✓ project: ${project.name}`);
  }

  console.log('\nDone. Areas/projects are ready in Linear.');
  console.log('Next: `npm start`');
  process.exit(0);
}

main().catch(err => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
