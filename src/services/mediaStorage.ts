import { storeMediaInIndexedDb, getMediaFromIndexedDb, findMediaInIndexedDb, getAllMediaFromIndexedDb } from './localMediaDb';

export interface MediaUploadResult {
  fileUrl: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Uploads a video or large binary file to the persistent server storage and caches in IndexedDB
 */
export async function uploadMediaToServer(payload: {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  documentId?: string;
  versionId?: string;
}): Promise<MediaUploadResult> {
  const { fileName, mimeType, dataUrl, documentId, versionId } = payload;

  // Approximate size from dataUrl
  const sizeBytes = Math.round((dataUrl.length * 3) / 4);

  try {
    const res = await fetch('/api/storage/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName,
        mimeType,
        dataUrl,
        documentId,
        versionId,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const fileId = data.fileId || `file_${Date.now()}`;
      const fileUrl = data.fileUrl || `/api/storage/file/${fileId}`;

      // Also cache in local IndexedDB for fast client replay and offline access
      await storeMediaInIndexedDb({
        id: fileId,
        fileName,
        mimeType,
        dataUrl,
        sizeBytes: data.sizeBytes || sizeBytes,
        updatedAt: new Date().toISOString(),
      });

      if (versionId) {
        await storeMediaInIndexedDb({
          id: versionId,
          fileName,
          mimeType,
          dataUrl,
          sizeBytes: data.sizeBytes || sizeBytes,
          updatedAt: new Date().toISOString(),
        });
      }

      return {
        fileUrl,
        fileId,
        fileName: data.fileName || fileName,
        mimeType: data.mimeType || mimeType,
        sizeBytes: data.sizeBytes || sizeBytes,
      };
    }
  } catch (err) {
    console.warn('[MediaStorage] Upload to server failed, storing in IndexedDB fallback:', err);
  }

  // Fallback: Generate local identifier and persist in IndexedDB
  const fallbackFileId = `local_media_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  await storeMediaInIndexedDb({
    id: fallbackFileId,
    fileName,
    mimeType,
    dataUrl,
    sizeBytes,
    updatedAt: new Date().toISOString(),
  });

  if (versionId) {
    await storeMediaInIndexedDb({
      id: versionId,
      fileName,
      mimeType,
      dataUrl,
      sizeBytes,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    fileUrl: `/api/storage/file/${fallbackFileId}`,
    fileId: fallbackFileId,
    fileName,
    mimeType,
    sizeBytes,
  };
}

/**
 * Ensures media data (especially video) is stored permanently in database storage
 * rather than storing massive base64 strings in Firestore documents
 */
export async function ensurePersistentMedia(
  dataUrlOrPath: string,
  fileName: string,
  mimeType: string,
  documentId?: string,
  versionId?: string
): Promise<string> {
  if (!dataUrlOrPath) return '';

  // If already an API or remote URL, no conversion needed
  if (dataUrlOrPath.startsWith('/api/storage/') || dataUrlOrPath.startsWith('http://') || dataUrlOrPath.startsWith('https://')) {
    return dataUrlOrPath;
  }

  // If it's a data URL (e.g. data:video/... or data:application/pdf...), upload to server storage
  if (dataUrlOrPath.startsWith('data:')) {
    const res = await uploadMediaToServer({
      fileName,
      mimeType,
      dataUrl: dataUrlOrPath,
      documentId,
      versionId,
    });
    return res.fileUrl;
  }

  return dataUrlOrPath;
}

/**
 * Resolves a playable media URL, checking IndexedDB cache, direct dataUrl, and server availability
 */
export async function resolvePlayableMediaUrl(
  fileUrl?: string,
  versionId?: string,
  documentId?: string,
  fileName?: string
): Promise<string> {
  // 1. If already a full data URL or blob URL, return it directly
  if (fileUrl && (fileUrl.startsWith('data:video/') || fileUrl.startsWith('data:') || fileUrl.startsWith('blob:'))) {
    return fileUrl;
  }

  // 2. Extract potential identifiers
  const identifiers: string[] = [];
  if (fileUrl) {
    if (fileUrl.startsWith('/api/storage/')) {
      const cleanId = fileUrl
        .replace('/api/storage/file/', '')
        .replace('/api/storage/download/', '')
        .replace('/api/storage/download?key=', '')
        .split('?')[0];
      if (cleanId) identifiers.push(decodeURIComponent(cleanId));
    } else {
      identifiers.push(fileUrl);
    }
  }
  if (versionId) identifiers.push(versionId);
  if (documentId) identifiers.push(documentId);
  if (fileName) identifiers.push(fileName);

  // 3. Check IndexedDB with all identifiers
  const localMatch = await findMediaInIndexedDb(identifiers);
  if (localMatch?.dataUrl) {
    return localMatch.dataUrl;
  }
  if (localMatch?.blob) {
    return URL.createObjectURL(localMatch.blob);
  }

  // 4. If fileUrl is a server endpoint, check if we can format a clean stream endpoint
  if (fileUrl && (fileUrl.startsWith('/api/storage/file/') || fileUrl.startsWith('/api/storage/download/'))) {
    return fileUrl.replace('/api/storage/download/', '/api/storage/file/');
  }

  // 5. If fileUrl is a download key /api/storage/download?key=..., convert to server file route
  if (fileUrl && fileUrl.includes('/api/storage/download?key=')) {
    const rawKey = fileUrl.split('/api/storage/download?key=')[1];
    const key = decodeURIComponent(rawKey);
    const baseName = key.split('/').pop() || '';
    if (baseName) {
      return `/api/storage/file/${encodeURIComponent(baseName)}`;
    }
  }

  // 6. If we have versionId or documentId and no fileUrl, return canonical server file endpoint
  if (versionId) {
    return `/api/storage/file/${versionId}`;
  }
  if (documentId) {
    return `/api/storage/file/${documentId}`;
  }

  return fileUrl || '';
}
