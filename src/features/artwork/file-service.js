// FileService - Business logic for file handling
// Centralized file type detection, validation, and preview generation

class FileService {
    constructor() {
        // File type mappings
        this.typeMap = {
            video: ['video/mp4', 'video/webm', 'video/mov', 'video/avi', 'video/mkv'],
            music: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/m4a', 'audio/flac'],
            gif: ['image/gif'],
            image: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml']
        };

        // Max file sizes (in bytes)
        this.maxSizes = {
            image: 50 * 1024 * 1024,  // 50MB
            video: 200 * 1024 * 1024, // 200MB
            music: 50 * 1024 * 1024,  // 50MB
            gif: 20 * 1024 * 1024     // 20MB
        };
    }

    /**
     * Detect file type from File object
     * Returns: 'image' | 'video' | 'music' | 'gif'
     */
    detectFileType(file) {
        if (!file || !file.type) {
            return 'image'; // default
        }

        const mimeType = file.type.toLowerCase();

        // Check GIF first (it's also an image)
        if (mimeType === 'image/gif') {
            return 'gif';
        }

        // Check video
        if (mimeType.startsWith('video/')) {
            return 'video';
        }

        // Check audio
        if (mimeType.startsWith('audio/')) {
            return 'music';
        }

        // Default to image
        return 'image';
    }

    /**
     * Detect file type from URL
     */
    detectFileTypeFromUrl(url) {
        if (!url) return 'image';

        const urlLower = url.toLowerCase();

        // Video extensions
        if (urlLower.includes('.mp4') || urlLower.includes('.webm') ||
            urlLower.includes('.mov') || urlLower.includes('.avi')) {
            return 'video';
        }

        // Audio extensions
        if (urlLower.includes('.mp3') || urlLower.includes('.wav') ||
            urlLower.includes('.ogg') || urlLower.includes('.aac')) {
            return 'music';
        }

        // GIF
        if (urlLower.includes('.gif')) {
            return 'gif';
        }

        return 'image';
    }

    /**
     * Validate file
     * Returns: { valid: boolean, error?: string }
     */
    validateFile(file) {
        if (!file) {
            return { valid: false, error: 'No file selected' };
        }

        // Detect type
        const fileType = this.detectFileType(file);

        // Check file size
        const maxSize = this.maxSizes[fileType];
        if (file.size > maxSize) {
            const maxMB = Math.floor(maxSize / (1024 * 1024));
            return {
                valid: false,
                error: `File too large. Maximum size for ${fileType} is ${maxMB}MB`
            };
        }

        // Check if type is allowed
        const allowedTypes = Object.values(this.typeMap).flat();
        if (!allowedTypes.includes(file.type.toLowerCase())) {
            return {
                valid: false,
                error: 'Unsupported file type. Please upload image, video, or audio files.'
            };
        }

        return { valid: true };
    }

    /**
     * Generate preview for file
     * Returns: Promise<string> (data URL or placeholder URL)
     */
    async generatePreview(file) {
        const fileType = this.detectFileType(file);

        if (fileType === 'image' || fileType === 'gif') {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (e) => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });
        }

        // Return placeholder for video/audio
        if (fileType === 'video') {
            return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LXNpemU9IjE2IiBmaWxsPSIjZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+VklERU88L3RleHQ+PC9zdmc+';
        }

        if (fileType === 'music') {
            return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LXNpemU9IjE2IiBmaWxsPSIjZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+TVVTSUM8L3RleHQ+PC9zdmc+';
        }

        return '';
    }

    /**
     * Get file info for display
     */
    getFileInfo(file) {
        const fileType = this.detectFileType(file);
        const sizeMB = (file.size / (1024 * 1024)).toFixed(2);

        return {
            name: file.name,
            type: fileType,
            size: file.size,
            sizeFormatted: `${sizeMB} MB`,
            mimeType: file.type
        };
    }

    /**
     * Check if file type matches expected type
     */
    isFileType(file, expectedType) {
        const actualType = this.detectFileType(file);
        return actualType === expectedType;
    }

    /**
     * Get icon for file type
     */
    getFileTypeIcon(fileType) {
        const icons = {
            image: '🖼️',
            video: '',
            music: '🎵',
            gif: '🎞️'
        };
        return icons[fileType] || '📄';
    }

    /**
     * Get color for file type (for UI)
     */
    getFileTypeColor(fileType) {
        const colors = {
            image: '#10b981',  // green
            video: '#3b82f6',  // blue
            music: '#8b5cf6',  // purple
            gif: '#f59e0b'     // amber
        };
        return colors[fileType] || '#6b7280';
    }
}

// Export for use in other modules
export default FileService;

// Also make available globally for HTML pages
if (typeof window !== 'undefined') {
    window.FileService = FileService;
}
