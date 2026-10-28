// Headless invocation of each agent CLI. Flags checked against each vendor's docs on 2026-10-26;
// see skills/plan/references/providers.md for sources and caveats.
//
// Safety stance: every provider runs in its "edit files, ask before anything riskier" mode.
// No provider is ever started with a bypass/yolo flag. A plan can add flags through `extraArgs`,
// which is an explicit choice by the user, never a default.

export const PROVIDERS = {
  claude: {
    label: 'Claude Code',
    bin: 'claude',
    // `allow` entries are Claude permission rules, for example "Bash(npm test)".
    build: ({ prompt, model, allow, extra }) => [
      '-p', prompt,
      '--permission-mode', 'acceptEdits',
      ...(model ? ['--model', model] : []),
      ...extra,
      // variadic flag goes last so it cannot swallow other arguments
      ...(allow.length ? ['--allowedTools', ...allow] : []),
    ],
  },
  codex: {
    label: 'Codex CLI',
    bin: 'codex',
    resultFile: true,
    // workspace-write sandbox lets Codex edit and run commands inside the worktree, without network.
    build: ({ prompt, model, extra, resultPath }) => [
      'exec',
      '--sandbox', 'workspace-write',
      ...(model ? ['-m', model] : []),
      ...extra,
      '-o', resultPath,
      prompt,
    ],
  },
  gemini: {
    label: 'Gemini CLI',
    bin: 'gemini',
    build: ({ prompt, model, extra }) => [
      '-p', prompt,
      '--approval-mode', 'auto_edit',
      ...(model ? ['-m', model] : []),
      ...extra,
    ],
  },
  agy: {
    label: 'Antigravity CLI',
    bin: 'agy',
    // Shell tools stay denied in headless runs unless the user's settings.json pre-approves them.
    build: ({ prompt, extra }) => [
      '-p', prompt,
      '--mode', 'accept-edits',
      '--output-format', 'text',
      ...extra,
    ],
  },
  copilot: {
    label: 'GitHub Copilot CLI',
    bin: 'copilot',
    // `allow` entries are Copilot tool rules, for example "shell(npm test)". Writing is always allowed.
    build: ({ prompt, model, allow, extra }) => [
      '-p', prompt,
      '-s',
      '--no-ask-user',
      `--allow-tool=${['write', ...allow].join(', ')}`,
      ...(model ? ['--model', model] : []),
      ...extra,
    ],
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

export const WORKER_PROMPT =
  'Read the file .playmaker/brief.md in the current directory and carry out the task it describes. ' +
  'Stay inside the scope it defines and finish with the report format it asks for.';
