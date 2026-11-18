#!/usr/bin/env node
// The fleet guard (#234): a PreToolUse hook. A fleet helper (a soloagile plugin agent, whose
// agent_type starts "soloagile:") is refused anything that would read a token, a key or a
// login. Any other session, the user's own included, passes untouched. Kept free of imports
// so it starts fast: it runs before every tool call.
//
// Usage: soloagile's hooks.json pipes the hook's JSON to it on stdin.

// Files a helper never reads, whatever tool it uses: .env files, keys, logins, credentials.
const SECRET_PATH = /(^|[\/\s'"=])(\.env(\.[\w.-]+)?|\.netrc|\.npmrc|\.pypirc|id_(rsa|ed25519|ecdsa|dsa)\w*|[\w.-]*\.pem|[\w.-]*\.key|credentials(\.json)?|\.git-credentials|hosts\.yml|auth\.json|\.claude\.json)(?=$|[\s'"\/;|&)])|\.ssh\/|\.aws\/|\.config\/gh\b|\.docker\/config\.json|\.kube\/config/;
// Commands that print a token or the environment it lives in.
const SECRET_COMMAND = /\bgh\s+auth\s+(token|status\s+(-t|--show-token))|\bprintenv\b|(^|[;&|(]\s*)(env|set|export\s+-p|declare\s+-x)\s*($|[;&|)])|\$\{?\w*(TOKEN|SECRET|PASSWORD|API_KEY|APIKEY|CREDENTIAL)\w*\}?|\/proc\/[\w$]+\/environ|\bsecret-tool\b|\bgit\s+credential\b/i;

export function verdict(input) {
  if (!String(input?.agent_type ?? '').startsWith('soloagile:')) return null;
  const t = input.tool_input ?? {};
  const said = [t.command, t.file_path, t.path, t.pattern, t.glob, t.notebook_path].filter((v) => typeof v === 'string').join('\n');
  if (input.tool_name === 'Bash' && SECRET_COMMAND.test(t.command ?? '')) return 'it would print a token or the environment';
  if (SECRET_PATH.test(said)) return 'it would read a key, a login or a .env file';
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let text = '';
  process.stdin.on('data', (d) => (text += d));
  process.stdin.on('end', () => {
    let input = null;
    try {
      input = JSON.parse(text);
    } catch {
      process.exit(0); // not hook JSON: nothing to guard
    }
    const why = verdict(input);
    if (why) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
        permissionDecisionReason: `soloagile fleet guard: a fleet helper may not do this, because ${why}. Do the card without it, or say in your notes what you needed.` } }));
    }
    process.exit(0);
  });
}
