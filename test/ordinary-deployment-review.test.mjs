import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { keccak256 } from 'ethers';
import { prepareOrdinaryDeployment } from '../scripts/prepare-ordinary-deployment.mjs';

const addr = n => '0x' + n.toString(16).padStart(40, '0');
const payer = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const expectedCore = '0x082B6aC9e47d7D83ea3FaBbD1eC7DAba9D687b36';
const expectedNFT = '0x14b1764162066c57386721685BDA0CB434c8E4C8';

// Synthetic inputs verify the encoding and CREATE addresses. No release artifact is supplied here.
function setup() {
    const artifact = {
        contractName: 'OrdinaryMarket', sourceName: 'contracts/replacement/OrdinaryMarket.sol',
        bytecode: '0x600160005260206000f3', deployedBytecode: '0x' + '00'.repeat(31) + '01',
        abi: ['constructor(address protocol, address ecosystem, address security, uint256 limit, uint256 transferGas)']
    };
    const custody = { chainId: 84532 };
    const roles = ['protocolTreasury', 'ecosystemTreasury', 'adminSecurity'];
    for (const [i, role] of roles.entries()) custody[role] = { address: addr(i + 1), threshold: 2, owners: [addr(10), addr(11), addr(12)] };
    const review = {
        chainId: 84532, nonce: 5, payer, expectedCore, expectedNFT, contract: artifact.sourceName + ':' + artifact.contractName,
        constructorArgs: ['$protocolTreasury', '$ecosystemTreasury', '$adminSecurity', '4', '30000'],
        initCodeHash: '0xfcc7b5e7f00faa6a361417fe7a67ded5077e8741609b7663e5bcae4ed4630369'
    };
    return { artifact, custody, review };
}

test('builds a zero-value unsigned creation request and predicts the nested NFT for both Base chains', () => {
    for (const chainId of [84532, 8453]) {
        const { artifact, review, custody } = setup();
        custody.chainId = review.chainId = chainId;
        const plan = prepareOrdinaryDeployment(artifact, review, custody);
        assert.deepEqual(plan.transaction, {
            from: payer, to: null, chainId: '0x' + chainId.toString(16), nonce: '0x5', value: '0x0',
            data: artifact.bytecode + [1, 2, 3, 4, 30000].map(n => n.toString(16).padStart(64, '0')).join('')
        });
        assert.equal(plan.core, expectedCore);
        assert.equal(plan.nft, expectedNFT);
        assert.equal(plan.initCodeHash, review.initCodeHash);
    }
});

test('the public CLI prints the reviewed request and withholds output on a hash mismatch', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'artsoul-review-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const files = ['artifact', 'review', 'custody'].map(name => join(dir, name + '.json'));
    const { artifact, review, custody } = setup();
    await Promise.all([artifact, review, custody].map((input, i) => writeFile(files[i], '\uFEFF' + JSON.stringify(input))));
    const cli = fileURLToPath(new URL('../scripts/prepare-ordinary-deployment.mjs', import.meta.url));
    const run = () => spawnSync(process.execPath, [cli, ...files], { encoding: 'utf8' });
    const success = run();
    assert.equal(success.status, 0, success.stderr);
    assert.deepEqual(JSON.parse(success.stdout), prepareOrdinaryDeployment(artifact, review, custody));
    await writeFile(files[0], JSON.stringify({ ...artifact, bytecode: '0x6012' }));
    const rejected = run();
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, '');
    assert.match(rejected.stderr, /differs from the independent review/);
});

test('enforces both size limits at the byte boundary including the encoded constructor arguments', () => {
    const { artifact, review, custody } = setup();
    const args = [1, 2, 3, 4, 30000].map(n => n.toString(16).padStart(64, '0')).join('');
    artifact.bytecode = '0x' + '00'.repeat(49_152 - args.length / 2);
    artifact.deployedBytecode = '0x' + '00'.repeat(24_576);
    review.initCodeHash = keccak256(artifact.bytecode + args);
    const plan = prepareOrdinaryDeployment(artifact, review, custody);
    assert.equal(plan.initCodeBytes, 49_152);
    assert.equal(plan.runtimeTemplateBytes, 24_576);
    assert.throws(() => prepareOrdinaryDeployment({ ...artifact, deployedBytecode: artifact.deployedBytecode + '00' }, review, custody), /EIP-170/);
    artifact.bytecode += '00';
    review.initCodeHash = keccak256(artifact.bytecode + args);
    assert.throws(() => prepareOrdinaryDeployment(artifact, review, custody), /EIP-3860/);
});

test('requires an independently matching build, constructor, custody and deployment identity', () => {
    const changes = [
        [s => { s.artifact.bytecode = '0x'; }, /nonempty linked/],
        [s => { delete s.artifact.deployedBytecode; }, /linked runtime/],
        [s => { s.artifact.deployedBytecode = '0x'; }, /linked runtime/],
        [s => { s.artifact.bytecode += '00'; }, /differs from the independent review/],
        [s => { s.review.initCodeHash = undefined; }, /independently reviewed hash/],
        [s => { s.review.contract += 'Other'; }, /qualified production Core/],
        [s => { s.artifact.sourceName = 'contracts/test/TreasuryBindingFixture.sol';
            s.review.contract = s.artifact.sourceName + ':' + s.artifact.contractName; }, /qualified production Core/],
        [s => { s.artifact.contractName = 'AuctionFixture'; s.artifact.sourceName = 'contracts/replacement/AuctionFixture.sol';
            s.review.contract = s.artifact.sourceName + ':AuctionFixture'; }, /qualified production Core/],
        [s => { s.review.constructorArgs[3] = '5'; }, /differs from the independent review/],
        [s => { s.review.constructorArgs.pop(); }, /argument count/],
        [s => { s.review.constructorArgs[0] = '$ecosystemTreasury'; }, /each custody reference/],
        [s => { s.artifact.abi = ['constructor(uint256,address,address,uint256,uint256)']; }, /address argument/],
        [s => { s.review.constructorArgs[3] = '0'; }, /positive integer refund limits/],
        [s => { s.review.constructorArgs[4] = Number.MAX_SAFE_INTEGER + 1; }, /positive integer refund limits/],
        [s => { s.artifact.contractName = 'OrdinaryArtDonations'; s.artifact.sourceName = 'contracts/replacement/OrdinaryArtDonations.sol';
            s.review.contract = s.artifact.sourceName + ':' + s.artifact.contractName; }, /qualified production Core/],
        [s => { s.custody.protocolTreasury.address = addr(21); }, /differs from the independent review/],
        [s => { s.custody.adminSecurity.address = addr(2); }, /distinct Safes/],
        [s => { s.custody.adminSecurity.owners = [payer]; }, /active Safe owner/],
        [s => { s.custody.ecosystemTreasury.threshold = 1; }, /two confirmations/],
        [s => { s.custody.adminSecurity.owners[1] = s.custody.adminSecurity.owners[0]; }, /distinct Safe owners/],
        [s => { s.custody.protocolTreasury.owners[1] = addr(0); }, /distinct Safe owners/],
        [s => { s.review.payer = addr(1); }, /separate payer/],
        [s => { s.review.payer = addr(15); }, /reviewed address/],
        [s => { s.review.nonce++; }, /reviewed address/],
        [s => { s.review.nonce = Number.MAX_SAFE_INTEGER + 1; }, /exact nonnegative/],
        [s => { s.review.expectedNFT = addr(4); }, /reviewed address/],
        [s => { s.custody.chainId = 8453; }, /same Base network/],
        [s => { s.review.chainId = s.custody.chainId = 1; }, /same Base network/]
    ];
    for (const [change, reason] of changes) {
        const inputs = setup();
        change(inputs);
        assert.throws(() => prepareOrdinaryDeployment(inputs.artifact, inputs.review, inputs.custody), reason);
    }
});
