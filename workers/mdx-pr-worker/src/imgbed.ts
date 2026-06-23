type ImageBedEnv = {
  IMGBED_URL?: string;
  IMGBED_TOKEN?: string;
  IMGBED_FOLDER_PREFIX?: string;
};

type PendingAttachment = {
  originalName: string;
  safeName: string;
  mime: string;
  size: number;
  bytes: Uint8Array;
  contentPath: string;
};

const DEFAULT_IMGBED_URL = "https://imgbed.nuist.dev";
const DEFAULT_FOLDER_PREFIX = "posts";

export async function uploadAttachmentsToImageBed(
  env: ImageBedEnv,
  attachments: PendingAttachment[],
  options: {
    year: string;
    month: string;
    slug: string;
  }
): Promise<void> {
  if (attachments.length === 0) return;

  const baseUrl = normalizeBaseUrl(env.IMGBED_URL ?? DEFAULT_IMGBED_URL);
  const token = env.IMGBED_TOKEN?.trim();
  const prefix = normalizeFolderPrefix(
    env.IMGBED_FOLDER_PREFIX ?? DEFAULT_FOLDER_PREFIX
  );
  const folder = [prefix, options.year, options.month, options.slug]
    .filter(Boolean)
    .join("/");

  await Promise.all(
    attachments.map(async attachment => {
      const form = new FormData();
      const fileBytes = cloneToArrayBuffer(attachment.bytes);
      form.set(
        "file",
        new File([fileBytes], attachment.safeName, {
          type: attachment.mime || "application/octet-stream",
        })
      );
      form.set("folder", folder);

      const headers = new Headers();
      if (token) {
        headers.set("X-Upload-Token", token);
      }

      const response = await fetch(`${baseUrl}/_upload`, {
        method: "POST",
        headers,
        body: form,
      });

      if (!response.ok) {
        throw new Error(await buildUploadError(response));
      }

      attachment.contentPath = await resolveUploadedUrl(
        response,
        baseUrl,
        folder,
        attachment.safeName
      );
    })
  );
}

async function buildUploadError(response: Response): Promise<string> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as {
        error?: unknown;
        message?: unknown;
      };
      const message =
        typeof payload.error === "string"
          ? payload.error
          : typeof payload.message === "string"
            ? payload.message
            : null;
      if (message) {
        return `Image bed upload failed: ${message}`;
      }
    } catch {
      // Fall through to plain-text parsing.
    }
  }

  try {
    const text = (await response.text()).trim();
    if (text) {
      return `Image bed upload failed: ${text}`;
    }
  } catch {
    // Ignore parse failures.
  }

  return `Image bed upload failed with status ${response.status}.`;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function cloneToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function normalizeFolderPrefix(value: string): string {
  return value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

async function resolveUploadedUrl(
  response: Response,
  baseUrl: string,
  folder: string,
  fallbackFileName: string
): Promise<string> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as {
        url?: unknown;
        path?: unknown;
      };

      if (typeof payload.url === "string" && payload.url.trim()) {
        return payload.url.trim();
      }

      if (typeof payload.path === "string" && payload.path.trim()) {
        return new URL(payload.path.trim(), `${baseUrl}/`).toString();
      }
    } catch {
      // Fall back to deterministic URL handling.
    }
  }

  return buildPublicUrl(baseUrl, folder, fallbackFileName);
}

function buildPublicUrl(baseUrl: string, folder: string, fileName: string): string {
  const path = [folder, fileName]
    .filter(Boolean)
    .map(encodePathSegment)
    .join("/");
  return `${baseUrl}/${path}`;
}

function encodePathSegment(segment: string): string {
  return segment
    .split("/")
    .map(part => encodeURIComponent(part))
    .join("/");
}
