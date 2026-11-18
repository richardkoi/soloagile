import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdict } from '../bin/fleet-guard.js';

const GUARD = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'fleet-guard.js');
const helper = (tool_name, tool_input) => ({ agent_type: 'soloagile:tobin', tool_name, tool_input });
const run = (input) => spawnSync('node', [GUARD], { input: JSON.stringify(input), encoding: 'utf8' });

test('a fleet helper is refused tokens, the environment and credential files', () => {
  for (const command of ['gh auth token', 'gh auth status --show-token', 'printenv', 'env', 'ls; env | grep X', 'echo $GITHUB_TOKEN', 'curl -H "x: ${API_KEY}"', 'cat .env', 'cat app/.env.local', 'cat ~/.ssh/id_ed25519', 'cat ~/.config/gh/hosts.yml', 'cat /proc/self/environ', 'git credential fill']) {
    assert.ok(verdict(helper('Bash', { command })), command);
  }
  for (const file_path of ['/repo/.env', '/home/r/.aws/credentials', '/home/r/.netrc', '/repo/certs/server.pem', '/home/r/.claude.json']) {
    assert.ok(verdict(helper('Read', { file_path })), file_path);
  }
  assert.ok(verdict(helper('Grep', { pattern: 'x', path: '/repo/.env' })));
});

test('a fleet helper still does ordinary work', () => {
  for (const command of ['node --test', 'git status', 'npm run build', 'grep -rn environment src/', 'echo $HOME', 'cat src/envelope.js', 'git diff main', 'ls .github']) {
    assert.equal(verdict(helper('Bash', { command })), null, command);
  }
  for (const file_path of ['/repo/src/env.js', '/repo/README.md', '/repo/keyboard.js']) {
    assert.equal(verdict(helper('Read', { file_path })), null, file_path);
  }
});

test('a normal session is never refused, the same command included', () => {
  assert.equal(verdict({ tool_name: 'Bash', tool_input: { command: 'gh auth token' } }), null);
  assert.equal(verdict({ agent_type: 'Explore', tool_name: 'Read', tool_input: { file_path: '/repo/.env' } }), null);
});

test('as a hook it prints a deny for a helper and nothing for anyone else', () => {
  const denied = run(helper('Bash', { command: 'gh auth token' }));
  assert.equal(denied.status, 0);
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const normal = run({ tool_name: 'Bash', tool_input: { command: 'gh auth token' } });
  assert.equal(normal.stdout, '');
  assert.equal(spawnSync('node', [GUARD], { input: 'not json', encoding: 'utf8' }).status, 0);
});
