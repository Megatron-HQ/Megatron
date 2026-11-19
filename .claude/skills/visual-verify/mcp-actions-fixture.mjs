// A configured MCP server for the MCP actions screens (#49). This machine's real config may have
// none, and an action must never reach the real CLI from a sweep, so the server, the one granted
// project its project Declaration lives in, and every action's result are all fixtures.

const WINDOWS = process.platform === 'win32'
export const MCP_FIXTURE_ID = 'configured:fixture-api'
const NAME = 'fixture-api'
const GRANTED = WINDOWS ? 'C:\\Fixture\\team-app' : '/Users/fixture/team-app'
const UNGRANTED = WINDOWS ? 'C:\\Fixture\\other-app' : '/Users/fixture/other-app'
const USER_CONFIG = WINDOWS ? 'C:\\Users\\fixture\\.claude.json' : '/Users/fixture/.claude.json'
export const MCP_ACTION_CHANNELS = new Set(['mcp:remove', 'mcp:logout', 'mcp:resetProjectChoices'])

function declaration(overrides) {
  return {
    scope: 'user',
    projectPath: null,
    plugin: null,
    transport: 'http',
    problem: null,
    location: 'api.fixture.dev',
    env: [],
    headers: [{ name: 'Authorization', literal: false }],
    argCount: null,
    hasLiteralCredential: false,
    approval: null,
    sourcePath: USER_CONFIG,
    shadowedIn: [],
    ...overrides
  }
}

function row() {
  return {
    id: MCP_FIXTURE_ID,
    name: NAME,
    kind: 'configured',
    prefix: NAME,
    transports: ['http', 'stdio'],
    location: 'api.fixture.dev',
    scopes: ['local', 'project', 'user'],
    projectPaths: [GRANTED, UNGRANTED],
    projectCount: 2,
    calls: 42,
    errors: 3,
    denied: 1,
    ambiguousCalls: 0,
    lastUsedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    hasProblem: false,
    hasLiteralCredential: false,
    hasPendingApproval: false,
    prefixCollision: false,
    pluginDisabled: false,
    warnings: 0,
    notices: 0,
    liveStatus: null
  }
}

function detail() {
  return {
    server: row(),
    declarations: [
      declaration({}),
      declaration({
        scope: 'project',
        projectPath: GRANTED,
        approval: 'approved',
        sourcePath: WINDOWS ? `${GRANTED}\\.mcp.json` : `${GRANTED}/.mcp.json`
      }),
      declaration({
        scope: 'local',
        projectPath: UNGRANTED,
        transport: 'stdio',
        location: 'npx',
        headers: [],
        argCount: 2
      })
    ],
    disabledIn: [],
    connectorsDisabledIn: [],
    tools: [],
    findings: [],
    projectStatuses: [],
    definitionTokens: null
  }
}

const RESULTS = {
  'mcp-action-ok': {
    'mcp:remove': { ok: true, message: `Removed ${NAME} from user scope.` },
    'mcp:logout': {
      ok: true,
      message: `Logged out of ${NAME}. Claude Code will ask you to sign in again.`
    },
    'mcp:resetProjectChoices': {
      ok: true,
      message: 'Reset the .mcp.json choices: 2 servers wait for approval.'
    }
  },
  'mcp-action-unconfirmed': {
    'mcp:logout': {
      ok: true,
      verificationError: `Logout ran, but Megatron couldn't confirm it: Claude Code couldn't reach ${NAME} to check.`
    }
  },
  'mcp-action-failed': {
    'mcp:remove': { ok: false, error: `No MCP server named "${NAME}" in user scope` }
  }
}

// Before the real handler: an action fixture must never run `claude mcp`.
export function mcpActionResult(channel, mode) {
  const result = RESULTS[mode]?.[channel]
  if (!result) throw new Error(`No MCP action fixture for ${channel} in ${mode}`)
  return result
}

export function mcpActionsFixture(channel, args, result) {
  if (channel === 'mcp:detail') return args[0] === MCP_FIXTURE_ID ? detail() : result
  if (channel === 'mcp:list') return { ...result, servers: [...result.servers, row()] }
  if (channel === 'projects:list')
    return [...result, { path: GRANTED, kind: 'repository', status: 'available' }]
  return result
}
