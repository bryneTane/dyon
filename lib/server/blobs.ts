import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import "server-only";
import { blobBucket, dataDir, googleCredentials } from "./config";

/** File storage for run archives: a folder locally, a Google Cloud Storage bucket when BLOB_BUCKET is set. */
export interface Blobs {
  put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  /** A short-lived link the browser downloads from directly; null when the storage has none (local folder). */
  downloadUrl(key: string, filename: string): Promise<string | null>;
  /**
   * Short-lived links for the worker to upload or read one object directly (valet key): the worker holds
   * no storage credentials. Null when the storage has none (local folder: the web app serves the bytes).
   */
  signedUrl(key: string, method: "PUT" | "GET", contentType?: string): Promise<string | null>;
}

let instance: Promise<Blobs> | null = null;

export function blobs(): Promise<Blobs> {
  instance ??= blobBucket ? gcsBlobs(blobBucket) : Promise.resolve(folderBlobs(join(dataDir, "blobs")));
  return instance;
}

const SAFE_KEY = /^[A-Za-z0-9._\/-]+$/;

function folderBlobs(root: string): Blobs {
  const path = (key: string) => {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error(`Invalid blob key: ${key}`);
    return join(root, key);
  };
  return {
    async put(key, data) {
      const file = path(key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, data);
      await rename(`${file}.tmp`, file);
    },
    async get(key) {
      return readFile(path(key)).catch(() => null);
    },
    async downloadUrl() {
      return null;
    },
    async signedUrl() {
      return null;
    },
  };
}

async function gcsBlobs(bucketName: string): Promise<Blobs> {
  const { Storage } = await import("@google-cloud/storage");
  const credentials = googleCredentials();
  const bucket = new Storage(credentials ? { credentials } : {}).bucket(bucketName);
  return {
    async put(key, data, contentType = "application/octet-stream") {
      await bucket.file(key).save(Buffer.from(data), { resumable: false, contentType });
    },
    async get(key) {
      try {
        const [data] = await bucket.file(key).download();
        return data;
      } catch (error) {
        if ((error as { code?: number }).code === 404) return null;
        throw error;
      }
    },
    async downloadUrl(key, filename) {
      // Signed with the service account key: downloads skip the web app, whose responses are capped (4.5 MB on Vercel).
      const [url] = await bucket.file(key).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 10 * 60_000,
        responseDisposition: `attachment; filename="${filename.replace(/"/g, "")}"`,
      });
      return url;
    },
    async signedUrl(key, method, contentType) {
      const [url] = await bucket.file(key).getSignedUrl({
        version: "v4",
        action: method === "PUT" ? "write" : "read",
        expires: Date.now() + 45 * 60_000,
        ...(method === "PUT" ? { contentType: contentType ?? "application/octet-stream" } : {}),
      });
      return url;
    },
  };
}
