#!/usr/bin/env node
/**
 * Mint HS256 JWTs for local API testing.
 *
 * Usage:
 *   npm run tools:jwt -- --role employee --preset alice
 *   npm run tools:jwt -- --role manager --preset bob
 *   npm run tools:jwt -- --role system_admin
 *   npm run tools:jwt -- --role employee --employee-id <uuid>
 *   npm run tools:jwt -- --list-employees
 */
import { createSigner } from 'fast-jwt';
import { PrismaClient } from '@prisma/client';
import { loadDotEnv } from './lib/load-dotenv.js';
import { ALL_ROLES, type Role } from '../../src/auth/roles.js';
import { loadEnv } from '../../src/config/env.js';

const PRESETS: Record<string, { sub: string; externalEmployeeId?: string }> = {
  alice: { sub: 'alice', externalEmployeeId: 'worker-alice-wid' },
  bob: { sub: 'bob', externalEmployeeId: 'worker-bob-wid' },
  carol: { sub: 'carol', externalEmployeeId: 'worker-carol-wid' },
  admin: { sub: 'admin' },
  integration: { sub: 'integration-client' },
};

const ROLES_REQUIRING_EMPLOYEE: Role[] = ['employee', 'manager'];

interface CliArgs {
  role?: Role;
  sub?: string;
  employeeId?: string;
  externalId?: string;
  preset?: string;
  expires: string;
  listEmployees: boolean;
  help: boolean;
  quiet: boolean;
}

function printHelp(): void {
  console.log(`create-jwt — mint test JWTs for timeoff-service

Usage:
  npm run tools:jwt -- --role <role> [options]

Required:
  -r, --role <role>       One of: ${ALL_ROLES.join(', ')}

Options:
  --preset <name>         alice | bob | carol | admin | integration
                          Sets sub + resolves employeeId from DB (alice/bob/carol)
  -s, --sub <subject>     JWT sub claim (default: preset name or role)
  -e, --employee-id <id>  Internal employee UUID (employee_hcm_mappings.id)
  -x, --external-id <wid> Workday worker WID → lookup employeeId in DB
  --expires <duration>    Token lifetime (default: 24h). Examples: 1h, 7d, 30m
  --list-employees        Print synced employees and exit
  -q, --quiet             Print only the token (for scripts)
  -h, --help              Show this help

Examples:
  npm run tools:jwt -- --role system_admin
  npm run tools:jwt -- --role employee --preset alice
  npm run tools:jwt -- --role manager --preset bob
  npm run tools:jwt -- --role hr_admin --preset carol
  npm run tools:jwt -- --role integration_client --preset integration
`);
}

function parseDuration(input: string): number {
  const match = /^(\d+)(ms|s|m|h|d)?$/i.exec(input.trim());
  if (!match) throw new Error(`Invalid duration: ${input}`);
  const value = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * multipliers[unit];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    expires: '24h',
    listEmployees: false,
    help: false,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '-q':
      case '--quiet':
        args.quiet = true;
        break;
      case '-r':
      case '--role':
        args.role = argv[++i] as Role;
        break;
      case '-s':
      case '--sub':
        args.sub = argv[++i];
        break;
      case '-e':
      case '--employee-id':
        args.employeeId = argv[++i];
        break;
      case '-x':
      case '--external-id':
        args.externalId = argv[++i];
        break;
      case '--preset':
        args.preset = argv[++i];
        break;
      case '--expires':
        args.expires = argv[++i];
        break;
      case '--list-employees':
        args.listEmployees = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!args.role) {
          args.role = arg as Role;
        }
    }
  }
  return args;
}

async function listEmployees(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.employeeHcmMapping.findMany({
      orderBy: { externalEmployeeId: 'asc' },
      select: {
        id: true,
        externalEmployeeId: true,
        department: true,
        employmentStatus: true,
        managerId: true,
      },
    });
    if (rows.length === 0) {
      console.log('No employees in database. Run POST /api/v1/sync/time-off first.');
      return;
    }
    console.log('Employees (use id as --employee-id or externalEmployeeId with --external-id):\n');
    for (const row of rows) {
      const isManager = rows.some((r) => r.managerId === row.id);
      const tags = [
        row.employmentStatus,
        isManager ? 'manager-candidate' : null,
      ]
        .filter(Boolean)
        .join(', ');
      console.log(`  ${row.externalEmployeeId}`);
      console.log(`    id:       ${row.id}`);
      console.log(`    dept:     ${row.department ?? '—'}`);
      console.log(`    tags:     ${tags}`);
      console.log('');
    }
    console.log('Presets: --preset alice | bob | carol');
  } finally {
    await prisma.$disconnect();
  }
}

async function resolveEmployeeId(
  externalId: string,
): Promise<string | undefined> {
  const prisma = new PrismaClient();
  try {
    const row = await prisma.employeeHcmMapping.findUnique({
      where: { externalEmployeeId: externalId },
      select: { id: true },
    });
    return row?.id;
  } finally {
    await prisma.$disconnect();
  }
}

function applyPreset(args: CliArgs): void {
  if (!args.preset) return;
  const preset = PRESETS[args.preset.toLowerCase()];
  if (!preset) {
    throw new Error(`Unknown preset "${args.preset}". Use: ${Object.keys(PRESETS).join(', ')}`);
  }
  if (!args.sub) args.sub = preset.sub;
  if (!args.externalId && preset.externalEmployeeId) {
    args.externalId = preset.externalEmployeeId;
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.listEmployees) {
    await listEmployees();
    return;
  }

  if (!args.role) {
    printHelp();
    process.exit(1);
  }

  if (!ALL_ROLES.includes(args.role)) {
    throw new Error(`Invalid role "${args.role}". Must be one of: ${ALL_ROLES.join(', ')}`);
  }

  applyPreset(args);

  if (!args.sub) {
    args.sub = args.role === 'integration_client' ? 'integration-client' : args.role;
  }

  let employeeId = args.employeeId;
  if (!employeeId && args.externalId) {
    employeeId = await resolveEmployeeId(args.externalId);
    if (!employeeId) {
      throw new Error(
        `No employee with externalEmployeeId "${args.externalId}". Run sync first or use --list-employees.`,
      );
    }
  }

  if (ROLES_REQUIRING_EMPLOYEE.includes(args.role) && !employeeId) {
    throw new Error(
      `Role "${args.role}" requires --employee-id, --external-id, or --preset (alice|bob).`,
    );
  }

  const env = loadEnv();
  const expiresInMs = parseDuration(args.expires);

  const sign = createSigner({
    key: env.JWT_SECRET,
    algorithm: 'HS256',
    iss: env.JWT_ISSUER,
    aud: env.JWT_AUDIENCE,
    expiresIn: expiresInMs,
  });

  const payload: Record<string, unknown> = {
    sub: args.sub,
    roles: [args.role],
  };
  if (employeeId) {
    payload.employeeId = employeeId;
  }

  const token = sign(payload);

  if (args.quiet) {
    console.log(token);
    return;
  }

  console.log('JWT (HS256)\n');
  console.log(token);
  console.log('\nClaims:');
  console.log(JSON.stringify(payload, null, 2));
  console.log(`\nIssuer:   ${env.JWT_ISSUER}`);
  console.log(`Audience: ${env.JWT_AUDIENCE}`);
  console.log(`Expires:  ${args.expires}`);
  console.log('\nExample:');
  console.log(`  curl -H "Authorization: Bearer ${token}" http://localhost:${env.PORT}/api/v1/leave-types`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
