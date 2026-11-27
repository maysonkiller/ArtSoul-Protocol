import { getBytes, keccak256 } from 'ethers';

// Compiler-generated immutable words differ per deployment. All other bytes,
// including metadata, must match the reviewed collection implementation.
const templates = new Map([
    [20029, { hash: '0xeb666d3132cec9976e9a659f7d384cfe2a3ecbf3749785e4d899493aa03ba99a',
        supply: [2426,7891,14226], creator:[962,5188,14153], protocol:[1243,14060], registry:[1138,9750,10427,13699,13785] }],
    [22557, { hash: '0x66fdcff467de79e637f0a008a737563ed1f0e8613c9134d4059a883af1f8d7c2',
        supply:[2617,7850,14003,15012], creator:[1039,4999,13930], protocol:[1357,13837], registry:[1252,8923,9810,13476,13562] }]
]);

export function reviewedCollectionRuntime(code) {
    const template = typeof code === 'string' && templates.get((code.length-2)/2);
    if (!template) return null;
    const bytes = getBytes(code);
    for (const [offsets,width] of [[template.supply,4],[template.creator,20],[template.protocol,20],[template.registry,20]]) {
        // Constructors bind every reference to the very same typed word.
        const word = bytes.slice(offsets[0],offsets[0]+32);
        if (word.subarray(0,32-width).some(Boolean) || !word.some(Boolean)) return null;
        for (const start of offsets) {
            if (!word.every((byte,index)=>bytes[start+index]===byte)) return null;
            bytes.fill(0,start,start+32);
        }
    }
    return keccak256(bytes) === template.hash ? keccak256(code) : null;
}
