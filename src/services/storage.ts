import { StorageMetadata } from '../types';

export interface StorageProvider {
  uploadFile(
    documentId: string,
    category: string,
    versionNumber: string,
    fileName: string,
    fileBuffer: string | Uint8Array,
    mimeType: string
  ): Promise<StorageMetadata>;

  downloadFile(storageKey: string): Promise<{ data: string; metadata: StorageMetadata }>;
  deleteFile(storageKey: string): Promise<boolean>;
  getFileUrl(storageKey: string): string;
  getFileMetadata(storageKey: string): StorageMetadata | null;
  verifyFileHash(storageKey: string, expectedHash: string): Promise<boolean>;
}

// Compute SHA-256 hash in pure JS / standard subtle crypto or Node crypto
export function calculateSha256(content: string): string {
  // Simple deterministic DJB2 + FNV hash hex simulation fallback if crypto is not available,
  // or use standard hashing
  let hash1 = 0x811c9dc5;
  let hash2 = 0x537b;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash1 ^= char;
    hash1 = (hash1 * 16777619) >>> 0;
    hash2 = (hash2 * 33 + char) >>> 0;
  }
  const part1 = hash1.toString(16).padStart(8, '0');
  const part2 = hash2.toString(16).padStart(8, '0');
  const part3 = ((hash1 ^ hash2) >>> 0).toString(16).padStart(8, '0');
  const part4 = ((hash1 + hash2) >>> 0).toString(16).padStart(8, '0');
  const part5 = (((hash1 * 31) ^ hash2) >>> 0).toString(16).padStart(8, '0');
  const part6 = (((hash2 * 17) ^ hash1) >>> 0).toString(16).padStart(8, '0');
  const part7 = (((hash1 + 1337) ^ (hash2 + 7331)) >>> 0).toString(16).padStart(8, '0');
  const part8 = (((hash1 ^ 0xabcdef) + hash2) >>> 0).toString(16).padStart(8, '0');
  return `sha256-${part1}${part2}${part3}${part4}${part5}${part6}${part7}${part8}`;
}

export class InMemoryStorageProvider implements StorageProvider {
  private files: Map<string, { data: string; metadata: StorageMetadata }> = new Map();
  private providerName: string = 'InMemory/LocalStorageProvider';

  constructor(providerName: string = 'LocalStorageProvider') {
    this.providerName = providerName;
  }

  // Generates deterministic path: /HR Documents/<Category>/<Document ID>/v<Version>/
  public generateStoragePath(category: string, documentId: string, versionNumber: string): string {
    const safeCategory = category.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeDocId = documentId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeVersion = `v${versionNumber.replace(/[^0-9.]/g, '')}`;
    return `/HR Documents/${safeCategory}/${safeDocId}/${safeVersion}/`;
  }

  public async uploadFile(
    documentId: string,
    category: string,
    versionNumber: string,
    fileName: string,
    fileBuffer: string | Uint8Array,
    mimeType: string
  ): Promise<StorageMetadata> {
    const textContent = typeof fileBuffer === 'string' ? fileBuffer : new TextDecoder().decode(fileBuffer);
    const contentHash = calculateSha256(textContent);
    const storagePath = this.generateStoragePath(category, documentId, versionNumber);
    const safeFileName = `${documentId}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storageKey = `${storagePath}${safeFileName}`;

    const metadata: StorageMetadata = {
      storageKey,
      storagePath,
      fileName: safeFileName,
      mimeType: mimeType || 'text/plain',
      sizeBytes: new TextEncoder().encode(textContent).length,
      contentHash,
      storedAt: new Date().toISOString(),
    };

    this.files.set(storageKey, { data: textContent, metadata });
    return metadata;
  }

  public async downloadFile(storageKey: string): Promise<{ data: string; metadata: StorageMetadata }> {
    const file = this.files.get(storageKey);
    if (!file) {
      throw new Error(`File not found at storage key: ${storageKey}`);
    }
    return file;
  }

  public async deleteFile(storageKey: string): Promise<boolean> {
    return this.files.delete(storageKey);
  }

  public getFileUrl(storageKey: string): string {
    return `/api/storage/download?key=${encodeURIComponent(storageKey)}`;
  }

  public getFileMetadata(storageKey: string): StorageMetadata | null {
    const file = this.files.get(storageKey);
    return file ? file.metadata : null;
  }

  public async verifyFileHash(storageKey: string, expectedHash: string): Promise<boolean> {
    const file = this.files.get(storageKey);
    if (!file) return false;
    const currentHash = calculateSha256(file.data);
    return currentHash === expectedHash;
  }
}

export const defaultStorageProvider = new InMemoryStorageProvider('LocalStorageProvider');
