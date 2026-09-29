// Local custody helper. This entry point has no signing or broadcast operation.
import { Wallet, getAddress } from 'ethers';
import { pathToFileURL } from 'node:url';

export function validateImport(privateKey, expectedAddress, policy) {
    if (policy?.version !== 1 || policy.chainId !== 84532 ||
        !Array.isArray(policy.excludedAddresses) || policy.excludedAddresses.length === 0) {
        throw new Error('INVALID_TESTNET_POLICY');
    }
    if (typeof privateKey !== 'string' || !/^(?:0x)?[a-fA-F0-9]{64}$/.test(privateKey)) {
        throw new Error('INVALID_PRIVATE_KEY_FORMAT');
    }
    let address;
    let expected;
    let excluded;
    try {
        expected = getAddress(expectedAddress);
        excluded = policy.excludedAddresses.map(value => getAddress(value).toLowerCase());
        address = new Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`).address;
    } catch {
        throw new Error('INVALID_KEY_OR_ADDRESS');
    }
    if (address !== expected) throw new Error('KEY_ADDRESS_MISMATCH');
    if (excluded.includes(address.toLowerCase())) throw new Error('PROTECTED_ADDRESS');
    return { address, chainId: 84532 };
}

async function main() {
    if (process.argv.length !== 3 || process.argv[2] !== 'validate-import') {
        throw new Error('UNSUPPORTED_OPERATION');
    }
    // Private material arrives only over the parent's anonymous stdin pipe.
    const chunks = [];
    let length = 0;
    for await (const chunk of process.stdin) {
        length += chunk.length;
        if (length > 8192) throw new Error('INPUT_TOO_LARGE');
        chunks.push(chunk);
    }
    const input = Buffer.concat(chunks);
    try {
        const { privateKey, expectedAddress, policy } = JSON.parse(input.toString('utf8'));
        process.stdout.write(JSON.stringify(validateImport(privateKey, expectedAddress, policy)));
    } finally {
        input.fill(0);
        for (const chunk of chunks) chunk.fill(0);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(() => {
        // Do not serialize an ethers/JSON/process error containing private input.
        process.stderr.write('TESTNET_WALLET_VALIDATION_FAILED\n');
        process.exitCode = 1;
    });
}
