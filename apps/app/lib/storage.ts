export interface UploadFileInput {
  file: File;
  directory?: string;
  /** Staged-asset purpose; `server_icon` creates a durable asset id. */
  purpose?: "server_icon";
}

export interface UploadFileResult {
  bucket: string;
  key: string;
  scope: {
    type: "user";
    id: string;
  };
  contentType: string;
  contentLength: number;
  accessUrl: string;
  /** Present when a staged asset was created for the upload. */
  assetId?: string;
}

export async function uploadFileToStorage(
  input: UploadFileInput,
): Promise<UploadFileResult> {
  const formData = new FormData();
  formData.set("file", input.file);

  if (input.directory) {
    formData.set("directory", input.directory);
  }

  if (input.purpose) {
    formData.set("purpose", input.purpose);
  }

  const response = await fetch("/api/storage/upload", {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as {
      error?: string;
      code?: string;
      message?: string;
    } | null;

    const uploadError = new Error(
      errorPayload?.message ||
        errorPayload?.error ||
        `Upload failed with status ${response.status}`,
    ) as Error & { code?: string };

    if (errorPayload?.code) {
      uploadError.code = errorPayload.code;
    }

    throw uploadError;
  }

  return response.json();
}
