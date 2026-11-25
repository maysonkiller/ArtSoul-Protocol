// Offline behavioral check of the installed SDK's pure option resolver.
// Run with: node --experimental-vm-modules scripts/security/check-wallet-feature-precedence.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const file = new URL('../../node_modules/@reown/appkit/dist/esm/src/utils/ConfigUtil.js', import.meta.url);
const context = createContext({});
const source = new SourceTextModule(await readFile(file, 'utf8'), { context });
const modules = {
  '@reown/appkit-controllers': { AlertController: {}, ApiController: {}, ConstantsUtil: {} },
  '@reown/appkit-utils': { ErrorUtil: {} }
};
await source.link(name => {
  const values = modules[name];
  assert.ok(values, 'unexpected import');
  return new SyntheticModule(Object.keys(values), function() {
    for (const [key,value] of Object.entries(values)) this.setExport(key,value);
  }, { context });
});
await source.evaluate();
const { ConfigUtil } = source.namespace;
const features = { email: false, socials: [] };
for (const [label,remote,enabled,basic,expected] of [
  ['local-only',null,false,false,[false,[]]],
  ['empty dashboard',[],true,false,[false,false]],
  ['disabled dashboard',[{ id:'social_login', config:['email','google'], isEnabled:false }],true,false,[false,false]],
  ['enabled dashboard',[{ id:'social_login', config:['email','google'], isEnabled:true }],true,false,[true,['google']]],
  ['basic feature policy',[{ id:'social_login', config:['email','google'], isEnabled:true }],true,true,[false,false]]
]) {
  const result = ['email','socials'].map(feature => ConfigUtil.processFeature(feature, features, remote, enabled, basic));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), expected);
  console.log(label, JSON.stringify(result));
}
