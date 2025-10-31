import { ComputeClient, ComputeConfig, JobSpec, GetJobResponse, ListJobsResponse, Status } from '@0glabs/0g-ts-sdk';
import { ethers } from 'ethers';
import { nanoid } from 'nanoid';

/**
 * Configuration for compute jobs. This extends the base job spec
 * with workflow-specific fields.
 */
export interface ComputeJobConfig extends JobSpec {
  // User-provided name/description
  name: string;
  // Docker image to run
  image: string;
  // Command and args
  command: string[];
  // Environment variables
  env?: Record<string, string>;
  // Input files to upload
  inputs?: Array<{
    name: string;
    content: string | ArrayBuffer | Uint8Array;
  }>;
  // Resource limits
  resources?: {
    cpu?: string;    // e.g., "1" or "0.5"
    memory?: string; // e.g., "1Gi" or "512Mi"
  };
  // Optional timeout in seconds
  timeoutSeconds?: number;
}

/**
 * Service for submitting and managing compute jobs.
 * This provides a high-level interface for running containerized
 * workloads on 0g's compute network.
 */
export class ComputeService {
  private client: ComputeClient;

  constructor(config?: {
    apiKey?: string;
    baseUrl?: string;
    provider?: ethers.Provider;
    signer?: ethers.Signer;
  }) {
    const cfg: ComputeConfig = {
      apiKey: config?.apiKey ?? process.env.OG_API_KEY,
      baseUrl: config?.baseUrl ?? process.env.OG_BASE_URL ?? "https://api.0g.ai",
      provider: config?.provider,
      signer: config?.signer,
    };
    this.client = new ComputeClient(cfg);
  }

  /**
   * Submit a new compute job with the given configuration.
   * Returns the job ID and initial status.
   */
  async submitJob(config: ComputeJobConfig): Promise<{ jobId: string; status: Status }> {
    // Generate a unique job ID if not provided
    const jobId = config.id ?? nanoid();

    // If there are input files, get presigned URLs and upload them
    if (config.inputs?.length) {
      const uploadSpecs = config.inputs.map(input => ({ name: input.name }));
      const presignedUrls = await this.client.getUploadUrls(uploadSpecs);

      // Upload all files in parallel
      await Promise.all(presignedUrls.uploads.map(async (upload) => {
        const content = config.inputs!.find(i => i.name === upload.name)?.content;
        if (!content) throw new Error(`Missing content for input file: ${upload.name}`);
        await this.uploadFile(upload.url, content);
      }));

      // Update job spec with upload references
      config = {
        ...config,
        uploads: presignedUrls.uploads,
      };
    }

    // Submit the job
    const job = await this.client.submitJob({
      id: jobId,
      name: config.name,
      image: config.image,
      command: config.command,
      env: config.env,
      resources: config.resources,
      timeout: config.timeoutSeconds ? `${config.timeoutSeconds}s` : undefined,
      ...config,
    });

    return {
      jobId: job.id,
      status: job.status,
    };
  }

  /**
   * Get the current status and details of a job
   */
  async getJob(jobId: string): Promise<GetJobResponse> {
    return await this.client.getJob(jobId);
  }

  /**
   * List recent compute jobs with pagination
   */
  async listJobs(params?: { limit?: number; before?: string; after?: string }): Promise<ListJobsResponse> {
    return await this.client.listJobs(params ?? {});
  }

  /**
   * Stream job logs, calling the callback for each new line.
   * Returns a function to stop streaming.
   */
  async streamLogs(jobId: string, onLog: (line: string) => void): Promise<() => void> {
    let stopped = false;
    let offset = 0;

    const poll = async () => {
      while (!stopped) {
        try {
          const logs = await this.client.getJobLogs(jobId, { offset });
          logs.lines.forEach(onLog);
          offset = logs.nextOffset;
        } catch (err) {
          console.error("Error streaming logs:", err);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    };

    poll();
    return () => { stopped = true; };
  }

  /**
   * Wait for a job to complete, with optional timeout
   */
  async waitForCompletion(jobId: string, timeoutMs = 5 * 60_000): Promise<GetJobResponse> {
    const start = Date.now();
    while (true) {
      const job = await this.getJob(jobId);
      if (job.status === 'SUCCEEDED') return job;
      if (job.status === 'FAILED') throw new Error(`Job ${jobId} failed`);
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timeout waiting for job ${jobId} completion`);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  /**
   * Download job artifact by URL
   */
  async downloadArtifact(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download artifact: ${res.status}`);
    return await res.arrayBuffer();
  }

  /**
   * Helper to upload a file to a presigned URL
   */
  private async uploadFile(url: string, content: string | ArrayBuffer | Uint8Array): Promise<void> {
    const body = typeof content === 'string' ? content :
      content instanceof ArrayBuffer ? new Uint8Array(content) :
      content;

    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    });

    if (!res.ok) throw new Error(`Failed to upload file: ${res.status}`);
  }
}

export default ComputeService;