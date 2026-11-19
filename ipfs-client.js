// IPFS Integration for ArtSoul
// Currently using Supabase Storage as file storage.
// IPFS integration can be added later when needed.

import { MULTIMEDIA_NFT_COVER } from './src/config/upload-policy.js?v=3';

export class IPFSClient {
    constructor() {
        this.gateway = 'https://ipfs.io/ipfs/';
    }

    /**
     * Upload file to Supabase Storage.
     * Returns a compatibility hash plus the public storage URL.
     */
    async uploadFile(file) {
        console.log('Uploading artwork media to Supabase Storage...');

        const fileName = file.name;
        const url = await window.ArtSoulDB.uploadFile(file, fileName);
        const mockHash = 'Qm' + btoa(url).substring(0, 44);

        return {
            ipfsHash: mockHash,
            url,
            size: file.size
        };
    }

    /**
     * Upload metadata JSON to Supabase Storage through the SIWE-protected backend.
     */
    async uploadMetadata(metadata) {
        console.log('Uploading artwork metadata JSON...');

        try {
            const safeTitle = String(metadata?.name || metadata?.title || 'metadata')
                .normalize('NFKD')
                .replace(/[^\w.\-]+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^[-.]+|[-.]+$/g, '')
                .toLowerCase()
                .slice(0, 48) || 'metadata';
            const upload = await window.ArtSoulDB.uploadMetadata(metadata, `${safeTitle}.json`);
            return {
                ipfsHash: '',
                url: upload.url,
                path: upload.path,
                size: upload.size,
                contentType: upload.content_type
            };
        } catch (error) {
            throw new Error(`Metadata upload failed: ${error.message}`);
        }
    }

    /**
     * Create public ERC-721 metadata before the registry allocates an artwork ID.
     */
    createMetadata(artworkData) {
        const mediaType = String(artworkData.mediaType || artworkData.fileType || '').trim() || 'image';
        const kind = mediaType.toLowerCase().split('/', 1)[0];
        const now = new Date().toISOString();
        const metadata = {
            name: artworkData.title,
            title: artworkData.title,
            description: artworkData.description,
            media_url: artworkData.imageUrl,
            media_type: mediaType,
            creator: artworkData.creator,
            created_at: artworkData.createdAt || now,
            attributes: [
                {
                    trait_type: 'Creator',
                    value: artworkData.creator
                },
                {
                    trait_type: 'Media Type',
                    value: mediaType
                }
            ],
            properties: {
                category: 'Art',
                creator: artworkData.creator,
                media_url: artworkData.imageUrl,
                media_type: mediaType
            }
        };

        if (/^0x[0-9a-f]{40}$/i.test(artworkData.creator)) {
            metadata.external_url = `https://artsoulprotocol.com/profile?address=${artworkData.creator.toLowerCase()}`;
        }
        // ETH decimals can exceed JSON number precision. Keep the author's exact value as a text trait.
        if (artworkData.creatorValue != null && String(artworkData.creatorValue).trim() !== '') {
            metadata.attributes.push({ trait_type: 'Creator Value', value: String(artworkData.creatorValue) });
        }
        if (kind === 'image' || kind === 'gif') {
            metadata.image = artworkData.imageUrl;
        } else {
            metadata.animation_url = artworkData.imageUrl;
            if (kind === 'audio' || kind === 'music' || kind === 'video') metadata.image = MULTIMEDIA_NFT_COVER;
        }

        if (artworkData.aiGuidance && typeof artworkData.aiGuidance === 'object') {
            metadata.ai_value_guidance = artworkData.aiGuidance;
            metadata.properties.ai_value_guidance = artworkData.aiGuidance;
        }

        return metadata;
    }

    /**
     * Generate file hash for duplicate detection.
     */
    async generateFileHash(file) {
        const arrayBuffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Get IPFS URL from hash.
     */
    getUrl(ipfsHash) {
        return `${this.gateway}${ipfsHash}`;
    }
}

if (typeof window !== 'undefined') window.IPFSClient = new IPFSClient();
