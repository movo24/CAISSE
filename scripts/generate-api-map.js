#!/usr/bin/env node
/**
 * generate-api-map.js — P289 (bloc B2, TD-API-MAP).
 *
 * Extracts the REAL API surface from the NestJS controllers (no invention):
 * base path, route method+path, handler name, guards, roles, tenant-check
 * opt-outs, and DTO/body types — and writes POS_API_MAP_DETAILED.md.
 *
 * Re-run any time the controllers change:  node scripts/generate-api-map.js
 * The doc header records the generation date + counts.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../packages/backend/src');
const OUT = path.join(__dirname, '../POS_API_MAP_DETAILED.md');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.controller.ts') ? [p] : [];
  });
}

const HTTP = ['Get', 'Post', 'Put', 'Patch', 'Delete'];

function parseController(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ctrl = src.match(/@Controller\(\s*['"`]([^'"`]*)['"`]?\s*\)/);
  const base = ctrl ? ctrl[1] : '';
  // class-level decorators (between @Controller and `export class`)
  const classHead = src.slice(0, src.search(/export class/));
  const classGuards = [...classHead.matchAll(/@UseGuards\(([^)]*)\)/g)].map((m) => m[1].trim());

  const routes = [];
  // Split on decorator lines for HTTP methods; capture the decorator block above each handler.
  // After the HTTP decorator, skip any further decorators (@HttpCode/@Roles/@UseGuards/@Header…)
  // before the actual handler name — they are captured in group 3 for role/guard extraction.
  // Nested-paren tolerant (3 levels) for decorators like @Throttle({default:{ttl,limit}}).
  const DECO = String.raw`@\w+\((?:[^()]|\((?:[^()]|\((?:[^()]|\([^)]*\))*\))*\))*\)`;
  const GAP = String.raw`(?:\s|//[^\n]*)*`; // whitespace + line comments between decorators
  const re = new RegExp(
    String.raw`@(Get|Post|Put|Patch|Delete)\(\s*(?:['"\`]([^'"\`]*)['"\`])?\s*\)${GAP}((?:${DECO}${GAP})*)(?:async\s+)?([a-zA-Z0-9_]+)\s*\(([^)]*)\)`,
    'g',
  );
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, verb, subpath = '', between, handler, params] = m;
    // decorators near this route = between the HTTP decorator and the handler,
    // plus up to 6 lines ABOVE the HTTP decorator (Roles/UseGuards often precede it)
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    const zone = before.split('\n').slice(-7).join('\n') + between;
    const roles = [...zone.matchAll(/@Roles\(([^)]*)\)/g)].map((r) => r[1].replace(/['"`\s]/g, ''));
    const guards = [...zone.matchAll(/@UseGuards\(([^)]*)\)/g)].map((g) => g[1].trim());
    const skipTenant = /@SkipTenantCheck\(\)/.test(zone);
    const bodyType = (params.match(/@Body\(\)\s*\w+\s*:\s*([A-Za-z0-9_<>\[\]]+)/) || [])[1] || '';
    routes.push({
      verb: verb.toUpperCase(),
      path: ('/' + [base, subpath].filter(Boolean).join('/')).replace(/\/+/g, '/'),
      handler,
      roles: roles.join(',') || '',
      guards: [...new Set([...classGuards, ...guards])].join(' + ') || '',
      skipTenant,
      bodyType,
    });
  }
  return { file: path.relative(SRC, file), base, classGuards, routes };
}

const files = walk(SRC).sort();
const controllers = files.map(parseController);
const totalRoutes = controllers.reduce((s, c) => s + c.routes.length, 0);

let md = `# POS_API_MAP_DETAILED.md — Cartographie API générée depuis le code
`;
md += `
> Générée le ${new Date().toISOString().slice(0, 10)} par \`node scripts/generate-api-map.js\` — NE PAS éditer à la main, régénérer.
> **${controllers.length} controllers · ${totalRoutes} routes.** Auth : \`JwtAuthGuard\` (JWT employé) · \`MobileAuthGuard\` (JWT Wesley Club, audience mobile-app) · \`RolesGuard\` (hiérarchie admin>manager>cashier) · TenantInterceptor global (storeId du JWT) sauf \`@SkipTenantCheck\`.
> Colonne Rôles vide = tout JWT valide du guard indiqué ; Guards vide = route publique (vérifier le contexte du controller).
`;

for (const c of controllers) {
  if (c.routes.length === 0) continue;
  md += `\n## \`${c.file}\` — base \`/${c.base}\`\n\n`;
  md += `| Méthode | Route | Handler | Guards | Rôles | Tenant | Body DTO |\n|---|---|---|---|---|---|---|\n`;
  for (const r of c.routes) {
    md += `| ${r.verb} | \`${r.path}\` | ${r.handler} | ${r.guards || '—'} | ${r.roles || '—'} | ${r.skipTenant ? '⚠️ skip' : '✓'} | ${r.bodyType || '—'} |\n`;
  }
}

fs.writeFileSync(OUT, md);
console.log(`Wrote ${OUT}: ${controllers.length} controllers, ${totalRoutes} routes.`);
