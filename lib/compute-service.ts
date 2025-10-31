import { ComputeClient, ComputeConfig, JobSpec, GetJobResponse, ListJobsResponse, Status } from '@0glabs/0g-ts-sdk';
import { ethers } from 'ethers';
import { nanoid } from 'nanoid';

/**
 * Resource configuration for compute jobs
 */
export interface ComputeResources {
  // CPU cores (e.g., "0.5", "1", "2")
  cpu?: string;
  // Memory (e.g., "512Mi", "1Gi", "2Gi")
  memory?: string;
  // GPU requirements (e.g., "nvidia-tesla-t4")
  gpu?: {
    type?: string;
    count?: number;
  };
  // Disk space (e.g., "10Gi")
  storage?: string;
  // Spot/preemptible instance
  preemptible?: boolean;
}

/**
 * Network configuration for compute jobs
 */
export interface NetworkConfig {
  // Enable outbound internet access
  internet?: boolean;
  // Required ports to expose
  ports?: Array<{
    port: number;
    protocol?: 'tcp' | 'udp';
    // Make port publicly accessible
    public?: boolean;
  }>;
  // DNS configuration
  dns?: {
    nameservers?: string[];
    searches?: string[];
  };
}

/**
 * Container configuration
 */
export interface ContainerConfig {
  // Working directory in container
  workingDir?: string;
  // User to run as (UID:GID)
  user?: string;
  // Additional volume mounts
  volumes?: Array<{
    name: string;
    mountPath: string;
    // Size if new volume
    size?: string;
    // Optional: persist volume across jobs
    persistent?: boolean;
  }>;
  // Container lifecycle hooks
  lifecycle?: {
    preStart?: string[];
    postStart?: string[];
    preStop?: string[];
  };
}

/**
 * Metadata and labels
 */
export interface JobMetadata {
  // Key-value labels
  labels?: Record<string, string>;
  // Annotations (non-identifying metadata)
  annotations?: Record<string, string>;
  // Project/group ID
  projectId?: string;
  // Cost tracking tags
  costCenter?: string;
}

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
  // Secret environment variables
  secrets?: Record<string, string>;
  // Input files to upload
  inputs?: Array<{
    name: string;
    content: string | ArrayBuffer | Uint8Array;
    // Optional: mark file as executable
    executable?: boolean;
    // Optional: mount path in container
    mountPath?: string;
  }>;
  // Resource requirements
  resources?: ComputeResources;
  // Network configuration
  network?: NetworkConfig;
  // Container configuration
  container?: ContainerConfig;
  // Job metadata and labels
  metadata?: JobMetadata;
  // Maximum runtime in seconds
  timeoutSeconds?: number;
  // Retry policy
  retry?: {
    limit: number;
    // Minimum wait between retries
    minBackoff?: string;
    // Maximum wait between retries
    maxBackoff?: string;
  };
  // Dependencies on other jobs
  dependencies?: Array<{
    jobId: string;
    // Optional: wait for specific status
    status?: Status;
    // Optional: timeout waiting for dep
    timeoutSeconds?: number;
  }>;
}

/**
 * Service for submitting and managing compute jobs.
 * This provides a high-level interface for running containerized
 * workloads on 0g's compute network.
 */
export class ComputeService {
  private client: ComputeClient;
  private activeJobs: Map<string, { stopLogs?: () => void }> = new Map();

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
    // Generate a unique job ID
    const jobId = nanoid();

    // Prepare input files if any
    const uploads: { name: string; url: string }[] = [];
    if (config.inputs?.length) {
      const uploadSpecs = config.inputs.map(input => ({ name: input.name }));
      const presignedUrls = await this.client.getUploadUrls(uploadSpecs);

      // Upload files in parallel
      await Promise.all(presignedUrls.uploads.map(async (upload: { name: string; url: string }) => {
        const input = config.inputs!.find(i => i.name === upload.name);
        if (!input) throw new Error(`Missing input spec for: ${upload.name}`);
        await this.uploadFile(upload.url, input.content);
        
        uploads.push({
          name: upload.name,
          url: upload.url,
        });
      }));
    }

    // Handle dependencies
    let dependencies: string[] | undefined;
    if (config.dependencies?.length) {
      // Wait for all dependencies in parallel
      await Promise.all(config.dependencies.map(async dep => {
        const timeout = dep.timeoutSeconds ?? 300; // 5 min default
        const start = Date.now();

        while (true) {
          const depJob = await this.getJob(dep.jobId);
          if (dep.status ? depJob.status === dep.status : depJob.status === 'SUCCEEDED') {
            break;
          }
          if (depJob.status === 'FAILED') {
            throw new Error(`Dependency ${dep.jobId} failed`);
          }
          if (Date.now() - start > timeout * 1000) {
            throw new Error(`Timeout waiting for dependency ${dep.jobId}`);
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      }));
      dependencies = config.dependencies.map(d => d.jobId);
    }

    // Prepare the complete job spec
    const jobSpec: JobSpec & { uploads?: typeof uploads } = {
      id: jobId,
      name: config.name,
      image: config.image,
      command: config.command,
      // Environment and secrets
      env: {
        ...config.env,
        ...(config.secrets ? Object.fromEntries(
          Object.entries(config.secrets).map(([k, v]) => [`SECRET_${k}`, v])
        ) : {}),
      },
      // Container configuration
      workingDir: config.container?.workingDir,
      user: config.container?.user,
      volumes: config.container?.volumes,
      // Resource limits
      resources: {
        cpu: config.resources?.cpu,
        memory: config.resources?.memory,
        gpu: config.resources?.gpu && {
          type: config.resources.gpu.type,
          count: config.resources.gpu.count,
        },
        storage: config.resources?.storage,
      },
      // Network config if specified
      network: config.network && {
        internet: config.network.internet,
        ports: config.network.ports,
        dns: config.network.dns,
      },
      // Lifecycle hooks
      lifecycle: config.container?.lifecycle,
      // Metadata
      labels: config.metadata?.labels,
      annotations: config.metadata?.annotations,
      projectId: config.metadata?.projectId,
      // Retry policy
      retry: config.retry,
      // Input file uploads
      uploads: uploads.length > 0 ? uploads : undefined,
      // Timeout
      timeout: config.timeoutSeconds ? `${config.timeoutSeconds}s` : undefined,
      // Dependencies
      dependencies,
    };

    // Submit the job
    const job = await this.client.submitJob(jobSpec);
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
    let body: string | Uint8Array;
    if (typeof content === 'string') {
      body = content;
    } else {
      body = content instanceof ArrayBuffer ? new Uint8Array(content) : content;
    }

    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: body as BodyInit,
    });

    if (!res.ok) throw new Error(`Failed to upload file: ${res.status}`);
  }
}

export default ComputeService;