// IPFS Integration for ArtSoul
// Currently using Supabase Storage as file storage.
// IPFS integration can be added later when needed.

class IPFSClient {
    constructor() {
        this.gateway = 'https://ipfs.io/ipfs/';
    }

    shouldUseMockMetadataFallback() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            return params.get('debugMockMetadata') === '1' ||
                params.get('mockMetadata') === '1' ||
                window.localStorage?.getItem('artsoul_debug_mock_metadata') === 'true';
        } catch {
            return false;
        }
    }

    mockMetadataUpload(metadata) {
        const serialized = JSON.stringify(metadata);
        const mockHash = 'Qm' + btoa(unescape(encodeURIComponent(serialized))).substring(0, 44);
        return {
            ipfsHash: mockHash,
            url: `ipfs://${mockHash}`,
            debug_mock: true
        };
    }

    /**
     * Upload file to Supabase Storage.
     * Returns a compatibility hash plus the public storage URL.
     */
    async uploadFile(file) {
        console.log('Uploading artwork media to Supabase Storage...');

        const fileName = `${Date.now()}_${file.name}`;
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
            if (this.shouldUseMockMetadataFallback()) {
                console.warn('Using debug mock metadata URI because real metadata upload failed:', error.message);
                return this.mockMetadataUpload(metadata);
            }
            throw new Error(`Metadata upload failed: ${error.message}`);
        }
    }

    /**
     * Create NFT-style metadata in a format the public V4.1 adapter can resolve.
     */
    createMetadata(artworkData) {
        const mediaType = artworkData.mediaType || artworkData.fileType || '';
        const isImage = String(mediaType).toLowerCase().startsWith('image/');
        const now = new Date().toISOString();
        const metadata = {
            name: artworkData.title,
            title: artworkData.title,
            description: artworkData.description,
            media_url: artworkData.imageUrl,
            media_type: mediaType || 'image',
            creator: artworkData.creator,
            created_at: artworkData.createdAt || now,
            external_url: 'https://artsoul.vercel.app/upload.html',
            attributes: [
                {
                    trait_type: 'Creator',
                    value: artworkData.creator
                },
                {
                    trait_type: 'Creator Value',
                    value: artworkData.creatorValue,
                    display_type: 'number'
                },
                {
                    trait_type: 'Media Type',
                    value: mediaType || 'unknown'
                }
            ],
            properties: {
                category: 'Art',
                creator: artworkData.creator,
                media_url: artworkData.imageUrl,
                media_type: mediaType || 'image'
            }
        };

        if (isImage) {
            metadata.image = artworkData.imageUrl;
        } else {
            metadata.animation_url = artworkData.imageUrl;
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

window.IPFSClient = new IPFSClient();

console.log('IPFS Client module loaded (using Supabase Storage)');
