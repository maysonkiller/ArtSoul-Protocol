#!/usr/bin/env node
/**
 * Read-only npm advisory inventory. No package installation or dependency edits.
 * Usage: node scripts/security/npm-audit-inventory.mjs [full.json] [prod.json]
 * Summarizes exact audit records instead of guessing from the npm ci banner.
 */
import {readFile, writeFile} from 'node:fs/promises';

const [fullPath='npm-audit-full.json',prodPath='npm-audit-prod.json'] = process.argv.slice(2);
const safe = value => String(value ?? '').replace(/[\r\n|<>]/g,' ').slice(0,240);
async function load(p) {
  const raw=JSON.parse(await readFile(p,'utf8'));
  if(raw.error || !raw.vulnerabilities || !raw.metadata?.vulnerabilities) throw new Error('audit_report_missing_or_invalid');
  return raw;
}
function numbers(report) {
  const v=report.metadata.vulnerabilities;
  return {low:v.low??0,moderate:v.moderate??0,high:v.high??0,critical:v.critical??0,total:v.total??0};
}
function fixLabel(fix) {
  if(fix===false) return 'No automatic fix';
  if(fix===true) return 'Compatible fix suggested';
  if(fix && typeof fix==='object') return ['Upgrade',safe(fix.name),safe(fix.version),fix.isSemVerMajor?'(MAJOR)':''].filter(Boolean).join(' ');
  return 'Unknown';
}
function issues(item) {
  const advisories=Array.isArray(item.via)?item.via:[];
  const rows=advisories.filter(v=>v&&typeof v==='object').map(v=>[safe(v.title),safe(v.range),safe(v.url)].filter(Boolean).join(' / '));
  const ancestors=advisories.filter(v=>typeof v==='string').map(safe);
  return [...rows,...ancestors.map(name=>'Via '+name)].join('; ')||'Inherited';
}
function formatList(report,prod) {
  const prodSet=new Set(Object.keys(prod.vulnerabilities));
  const items=Object.entries(report.vulnerabilities).map(([name,item])=>({
    name,severity:item.severity??'unknown',direct:!!item.isDirect,
    prod:prodSet.has(name),fixes:fixLabel(item.fixAvailable),
    via:issues(item),nodes:Array.isArray(item.nodes)?item.nodes.length:0,
    affectedRange:safe(item.range)
  }));
  const rank={critical:0,high:1,moderate:2,low:3,info:4};
  items.sort((a,b)=>(rank[a.severity]??9)-(rank[b.severity]??9)||a.name.localeCompare(b.name));
  return items;
}
const [full,prod]=await Promise.all([load(fullPath),load(prodPath)]);
const fullNums=numbers(full),prodNums=numbers(prod),records=formatList(full,prod);
if(records.length!==fullNums.total) console.error('Note: count of affected package records differs from metadata.total');
const rows=[
  '# ArtSoul Protocol — npm vulnerability inventory (lockfile only)',
  '',
  'The source is the **npm registry advisory response** for the checked-out package-lock.json. No dependencies were changed.',
  '',
  '| Severity | Full lockfile | --omit=dev |',
  '|---|---:|---:|',
  ...['critical','high','moderate','low','total'].map(k=>'| '+k+' | '+fullNums[k]+' | '+prodNums[k]+' |'),
  '',
  'A production-scope audit is NOT a browser exposure assessment: runtime reachability, bundling and data flows require code review.',
  '',
  '| Package | Severity | Direct | In --omit=dev | Instances | Fix path | Advisory / inherited chain |',
  '|---|---|---|---|---:|---|---|',
  ...records.map(v=>'| '+safe(v.name)+' | '+safe(v.severity)+' | '+(v.direct?'Yes':'No')+' | '+(v.prod?'Yes':'No')+' | '+v.nodes+' | '+safe(v.fixes)+' | '+safe(v.via)+' |'),
  '',
  '## Manual follow-ups',
  '',
  '- Prioritize critical and high production-scope advisories, then dev/build-chain exposures.',
  '- Review each root package usage before removal; avoid bulk npm audit fix --force.',
  '- Capture OLD/NEW audit differences and Linux/Windows, WebMCP and contract regressions before merging.',
  '- This is a lockfile advisory scan, NOT a penetration test or proof of exploitability.'
];
const output=rows.join('\n')+'\n';
await writeFile('npm-audit-inventory.md',output,'utf8');
console.log(JSON.stringify({full:fullNums,prod:prodNums,packageRecords:records.length,
  noFix:records.filter(r=>r.fixes==='No automatic fix').length,
  majorFix:records.filter(r=>r.fixes.includes('(MAJOR)')).length}));
console.log(output);
