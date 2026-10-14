import type { MultipartFile } from '@fastify/multipart';

/**
 * Reads an uploaded file into memory, or returns null if it exceeded the size limit passed
 * to request.file(). Busboy truncates an oversized file instead of failing the stream, so a
 * plain read would silently keep only the first N bytes.
 */
export async function readLimited(data: MultipartFile): Promise<Buffer | null> {
  try {
    const buffer = await data.toBuffer();
    return data.file.truncated ? null : buffer;
  } catch (err) {
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') return null;
    throw err;
  }
}
