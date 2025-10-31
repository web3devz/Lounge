import React from 'react';
import { Status } from '@0glabs/0g-ts-sdk';
import { Card } from '../ui/card';
import { Progress } from '../ui/progress';
import { Button } from '../ui/button';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

interface ComputeJobCardProps {
  jobId?: string;
  status?: Status;
  logs: string[];
  isLoading: boolean;
  onCancel?: () => void;
}

/**
 * Card component for displaying compute job status and logs
 */
export function ComputeJobCard({ jobId, status, logs, isLoading, onCancel }: ComputeJobCardProps) {
  const statusColor = React.useMemo(() => {
    switch (status) {
      case 'SUCCEEDED': return 'text-green-500';
      case 'FAILED': return 'text-red-500';
      case 'RUNNING': return 'text-blue-500';
      default: return 'text-gray-500';
    }
  }, [status]);

  const StatusIcon = React.useMemo(() => {
    switch (status) {
      case 'SUCCEEDED': return CheckCircle;
      case 'FAILED': return XCircle;
      case 'RUNNING': return Loader2;
      default: return null;
    }
  }, [status]);

  return (
    <Card className="w-full p-4 space-y-4">
      {/* Header with status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {StatusIcon && (
            <StatusIcon className={`w-5 h-5 ${statusColor} ${status === 'RUNNING' ? 'animate-spin' : ''}`} />
          )}
          <span className={`font-medium ${statusColor}`}>
            {status || 'Initializing...'}
          </span>
        </div>
        {jobId && (
          <span className="text-sm text-gray-500">
            Job ID: {jobId}
          </span>
        )}
      </div>

      {/* Progress bar for running jobs */}
      {status === 'RUNNING' && (
        <Progress value={isLoading ? undefined : 100} className="w-full" />
      )}

      {/* Log output */}
      <div className="relative">
        <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto max-h-60 font-mono text-sm">
          {logs.length > 0 ? (
            logs.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {line}
              </div>
            ))
          ) : (
            <span className="text-gray-400">No logs available yet...</span>
          )}
        </pre>

        {/* Cancel button */}
        {status === 'RUNNING' && onCancel && (
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="absolute top-2 right-2"
          >
            Cancel
          </Button>
        )}
      </div>
    </Card>
  );
}

export default ComputeJobCard;