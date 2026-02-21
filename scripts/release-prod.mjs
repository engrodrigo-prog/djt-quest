#!/usr/bin/env node
/*
  Production release helper:
  - Ensures repo is clean and on main
  - Applies Supabase SQL migrations to the linked project
  - Deploys to Vercel production

  Requirements (local):
  - Supabase CLI installed and authenticated (supabase login)
  - Vercel CLI authenticated (via prior `vercel login` or `VERCEL_TOKEN`)
*/

import { spawnSync } from 'node:child_process';

const run = (cmd, args, opts = {}) => {
  const pretty = [cmd, ...args].join(' ');
  console.log(`\n$ ${pretty}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    const code = r.status == null ? 1 : r.status;
    throw new Error(`Command failed (${code}): ${pretty}`);
  }
};

const capture = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) return '';
  return String(r.stdout || '').trim();
};

const hasFlag = (name) => process.argv.includes(name);

async function main() {
  const skipGate = hasFlag('--skip-gate');

  const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') throw new Error(`Refusing to release from branch "${branch}". Switch to "main".`);

  const status = capture('git', ['status', '--porcelain']);
  if (status) {
    throw new Error('Working tree is not clean. Commit or stash changes before releasing.');
  }

  if (!skipGate) {
    run('npm', ['run', 'gate']);
  } else {
    console.log('\n(skip) npm run gate');
  }

  // Apply all pending SQL migrations to the linked Supabase project.
  run('supabase', ['db', 'push', '--linked', '--yes']);

  // Deploy to Vercel production (uses .vercel/project.json if present).
  // If running in CI, set VERCEL_TOKEN (vercel --token).
  const token = process.env.VERCEL_TOKEN;
  if (token) {
    run('npx', ['vercel@50.10.0', 'deploy', '--prod', '--yes', '--token', token]);
  } else {
    run('npx', ['vercel@50.10.0', 'deploy', '--prod', '--yes']);
  }
}

main().catch((err) => {
  console.error(`\n❌ ${err?.message || err}`);
  process.exit(1);
});

