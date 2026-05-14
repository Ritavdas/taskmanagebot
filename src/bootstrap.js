import { config } from './config.js';
import * as linear from './linear.js';

async function main() {
  console.log(`Bootstrapping Linear team "${config.linear.teamKey}"...`);
  await linear.init();
  console.log(`✓ team found.`);

  for (const area of config.areas) {
    const project = await linear.ensureProject(area);
    console.log(`✓ project: ${project.name}`);
  }

  console.log('\nDone. Areas/projects are ready in Linear.');
  console.log(`Next: \`npm start\``);
  process.exit(0);
}

main().catch(err => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
