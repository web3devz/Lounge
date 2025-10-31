import { ComputeClient, ComputeConfig, JobSpec, JobStatus, JobWithUploads, GetJobResponse, ListJobsResponse, GetJobLogsResponse } from '@0glabs/0g-ts-sdk';
import { ethers } from 'ethers';

export interface OGComputeClientOptions {
  // API key for auth
  apiKey?: string;
  // Base URL for compute API (e.g., "https://api.0g.ai")
  baseUrl?: string;
  // Timeout for individual HTTP calls (ms)
  timeoutMs?: number;
  // Poll interval when waiting for job completion (ms)
  pollIntervalMs?: number;
  // Optional ethers provider for signing job payloads
  provider?: ethers.Provider;
  // Optional signer for auth if not using API key
  signer?: ethers.Signer;
}

/**
 * Enhanced 0g Compute client that builds on the official SDK
 * with extra utilities for job management, log streaming,
 * artifact handling and more.
 */
export class OGComputeClient {
  private client: ComputeClient;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;

  constructor(opts: OGComputeClientOptions = {}) {
    const config: ComputeConfig = {
      apiKey: opts.apiKey || (globalThis as any).process?.env?.OG_API_KEY,
      baseUrl: (opts.baseUrl || (globalThis as any).process?.env?.OG_BASE_URL || "https://api.0g.ai").replace(/\/$/, ""),
      provider: opts.provider,
      signer: opts.signer,
    };
    this.client = new ComputeClient(config);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 2500;
  }

  /**
   * Submit a compute job with optional file uploads. This method handles both simple
   * jobs and those requiring file uploads via presigned URLs.
   * 
   * Example without uploads:
   * ```typescript
   * const job = await client.submitJob({
   *   name: "example-job",
   *   image: "alpine:latest",
   *   command: ["sh", "-c", "echo hello world"]
   * });
   * ```
   * 
   * Example with uploads:
   * ```typescript
   * const job = await client.submitJob({
   *   name: "process-file",
   *   image: "my-processor:latest",
   *   command: ["python", "process.py", "/inputs/data.txt"],
   *   uploads: [{
   *     name: "data.txt",
   *     content: "raw file content here"
   *   }]
   * });
   * ```
   */
  async submitJob(jobSpec: JobSpec & { uploads?: Array<{ name: string; content: string | ArrayBuffer | Uint8Array }> }): Promise<GetJobResponse> {
    if (!Array.isArray(jobSpec.uploads) || jobSpec.uploads.length === 0) {
      return await this.client.submitJob(jobSpec as JobSpec);
    }

    // Handle jobs with uploads
    const uploadSpecs = jobSpec.uploads.map(u => ({ name: u.name }));
    const presignedUrls = await this.client.getUploadUrls(uploadSpecs);

    // Upload all files in parallel
    await Promise.all(presignedUrls.uploads.map(async (upload) => {
      const content = jobSpec.uploads!.find(u => u.name === upload.name)?.content;
      if (!content) throw new Error(`missing content for upload ${upload.name}`);
      await this.uploadToUrl(upload.url, content);
    }));

    // Submit job with upload references
    const jobSpecWithUploads: JobWithUploads = {
      ...jobSpec,
      uploads: presignedUrls.uploads,
    };
    delete (jobSpecWithUploads as any).uploads;
    return await this.client.submitJob(jobSpecWithUploads);
  }

  /**
   * Upload arbitrary content to a presigned URL (PUT). Supports string or binary content.
   */
  private async uploadToUrl(url: string, content: string | ArrayBuffer | Uint8Array): Promise<void> {
    const opts: RequestInit = { method: "PUT", headers: {} } as any;
    if (typeof content === "string") {
      opts.body = content;
      opts.headers = { "Content-Type": "application/octet-stream" };
    } else if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      opts.body = (content instanceof ArrayBuffer ? new Uint8Array(content) : (content as Uint8Array)) as any;
      opts.headers = { "Content-Type": "application/octet-stream" };
    } else {
      throw new Error("unsupported upload content type");
    }
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`upload failed: ${res.status} ${res.statusText}`);
  }

  /**
   * Get status and details for a specific job
   */
  async getJob(jobId: string): Promise<GetJobResponse> {
    return await this.client.getJob(jobId);
  }

  /**
   * List jobs with pagination support
   */
  async listJobs(params: { limit?: number; before?: string; after?: string } = {}): Promise<ListJobsResponse> {
    return await this.client.listJobs(params);
  }

  /**
   * Get logs for a specific job with optional offset
   */
  async getJobLogs(jobId: string, params: { offset?: number } = {}): Promise<GetJobLogsResponse> {
    return await this.client.getJobLogs(jobId, params);
  }

  /**
   * Poll job status until completion or timeout. Returns final job state.
   * Throws error if job fails or times out.
   */
  async waitForCompletion(jobId: string, timeoutMs = 5 * 60_000): Promise<GetJobResponse> {
    const start = Date.now();
    while (true) {
      const job = await this.getJob(jobId);
      if (job.status === 'SUCCEEDED') return job;
      if (job.status === 'FAILED') throw new Error(`job ${jobId} failed`);
      if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for job ${jobId}`);
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
  }

  /**
   * Stream job logs in real-time, calling onLog for each new line.
   * Returns a function to stop streaming.
   */
  async streamLogs(jobId: string, onLog: (line: string) => void): Promise<() => void> {
    let closed = false;
    let offset = 0;
    const poll = async () => {
      while (!closed) {
        try {
          const res = await this.getJobLogs(jobId, { offset });
          for (const line of res.lines) onLog(line);
          offset = res.nextOffset;
        } catch (err) {
          // swallow transient errors and retry
        }
        await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      }
    };
    poll();
    return () => { closed = true; };
  }

  /**
   * Download an artifact from a signed URL
   */
  async fetchArtifact(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch artifact: ${res.status}`);
    return await res.arrayBuffer();
  }
}

export default OGComputeClient;
