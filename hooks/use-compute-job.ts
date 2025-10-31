import { useState, useEffect, useCallback } from 'react';
import { Status } from '@0glabs/0g-ts-sdk';
import ComputeService, { ComputeJobConfig } from '../lib/compute-service';
import { useToast } from './use-toast';

interface UseComputeJobOptions {
  onLog?: (line: string) => void;
  onComplete?: (jobId: string) => void;
  onError?: (error: Error) => void;
}

/**
 * React hook for submitting and monitoring compute jobs.
 * Provides real-time status updates and log streaming.
 * 
 * Example usage:
 * ```tsx
 * const { submitJob, status, logs } = useComputeJob({
 *   onComplete: (jobId) => {
 *     console.log(`Job ${jobId} completed successfully`);
 *   },
 * });
 * 
 * // Later in your component:
 * const handleClick = async () => {
 *   await submitJob({
 *     name: "process-data",
 *     image: "my-processor:latest",
 *     command: ["python", "process.py"],
 *     inputs: [{
 *       name: "data.txt",
 *       content: "raw data here"
 *     }]
 *   });
 * };
 * ```
 */
export function useComputeJob(options: UseComputeJobOptions = {}) {
  const [jobId, setJobId] = useState<string>();
  const [status, setStatus] = useState<Status>();
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<Error>();
  const [isLoading, setIsLoading] = useState(false);
  
  const { toast } = useToast();
  const compute = new ComputeService();

  // Reset state when starting a new job
  const reset = useCallback(() => {
    setJobId(undefined);
    setStatus(undefined);
    setLogs([]);
    setError(undefined);
  }, []);

  // Submit a new compute job
  const submitJob = useCallback(async (config: ComputeJobConfig) => {
    try {
      setIsLoading(true);
      reset();

      // Submit the job
      const { jobId: id, status: initialStatus } = await compute.submitJob(config);
      setJobId(id);
      setStatus(initialStatus);

      // Start streaming logs
      const stopLogs = await compute.streamLogs(id, (line) => {
        setLogs(prev => [...prev, line]);
        options.onLog?.(line);
      });

      // Wait for completion
      const result = await compute.waitForCompletion(id);
      setStatus(result.status);
      stopLogs();

      if (result.status === 'SUCCEEDED') {
        options.onComplete?.(id);
      } else {
        throw new Error(`Job failed: ${result.status}`);
      }
    } catch (err) {
      const error = err as Error;
      setError(error);
      options.onError?.(error);
      toast({
        title: "Compute Job Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [compute, options, reset, toast]);

  // Fetch initial job status if jobId is set
  useEffect(() => {
    if (!jobId) return;

    let mounted = true;
    const fetchStatus = async () => {
      try {
        const job = await compute.getJob(jobId);
        if (mounted) setStatus(job.status);
      } catch (err) {
        console.error("Error fetching job status:", err);
      }
    };

    fetchStatus();
    return () => { mounted = false; };
  }, [jobId, compute]);

  return {
    jobId,
    status,
    logs,
    error,
    isLoading,
    submitJob,
    reset,
  };
}

export default useComputeJob;