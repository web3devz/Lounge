import React from 'react';
import { Status } from '@0glabs/0g-ts-sdk';
import { Card } from '../ui/card';
import { Progress } from '../ui/progress';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import {
  Loader2, CheckCircle, XCircle, Clock, RefreshCcw,
  Cpu, Database as Memory, HardDrive, Wifi, Terminal, Box,
  ChevronRight, ChevronDown
} from 'lucide-react';

// Literal status type to match SDK
type JobStatus = 'SUCCEEDED' | 'FAILED' | 'RUNNING' | 'PENDING';

interface ResourceUsage {
  cpu?: {
    used: string;
    limit: string;
  };
  memory?: {
    used: string;
    limit: string;
  };
  gpu?: {
    used: number;
    type: string;
  };
}

interface ComputeJobCardProps {
  jobId?: string;
  name?: string;
  status?: JobStatus;
  logs: string[];
  isLoading: boolean;
  startTime?: Date;
  endTime?: Date;
  resources?: ResourceUsage;
  metadata?: Record<string, string>;
  error?: string;
  retryCount?: number;
  maxRetries?: number;
  artifacts?: Array<{
    name: string;
    size: number;
    url: string;
  }>;
  onCancel?: () => void;
  onRetry?: () => void;
  onDownload?: (artifact: { name: string; url: string }) => void;
}

/**
 * Enhanced card component for displaying compute job status and details
 */
export const ComputeJobCard = ({
  jobId,
  name,
  status,
  logs,
  isLoading,
  startTime,
  endTime,
  resources,
  metadata,
  error,
  retryCount,
  maxRetries,
  artifacts,
  onCancel,
  onRetry,
  onDownload,
}: ComputeJobCardProps) => {
  const [expanded, setExpanded] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<'logs' | 'artifacts' | 'metadata'>('logs');
  const logEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll logs to bottom when new logs arrive
  React.useEffect(() => {
    if (logEndRef.current && activeTab === 'logs') {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  // Colors and icons based on status
  const statusColor = React.useMemo(() => {
    switch (status) {
      case 'SUCCEEDED': return 'text-green-500 bg-green-50';
      case 'FAILED': return 'text-red-500 bg-red-50';
      case 'RUNNING': return 'text-blue-500 bg-blue-50';
      case 'PENDING': return 'text-yellow-500 bg-yellow-50';
      default: return 'text-gray-500 bg-gray-50';
    }
  }, [status]);

  const StatusIcon = React.useMemo(() => {
    switch (status) {
      case 'SUCCEEDED': return CheckCircle;
      case 'FAILED': return XCircle;
      case 'RUNNING': return Loader2;
      case 'PENDING': return Clock;
      default: return null;
    }
  }, [status]);

  // Auto-scroll logs
  React.useEffect(() => {
    if (activeTab === 'logs' && status === 'RUNNING') {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab, status]);

  // Format duration
  const duration = React.useMemo(() => {
    if (!startTime) return '';
    const end = endTime || new Date();
    const diff = end.getTime() - startTime.getTime();
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }, [startTime, endTime]);

  return (
    <Card className="w-full">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {StatusIcon && (
              <StatusIcon className={`w-5 h-5 ${status === 'RUNNING' ? 'animate-spin' : ''}`} />
            )}
            <div>
              <h3 className="font-medium">
                {name || 'Unnamed Job'}
                <Badge variant="outline" className="ml-2">
                  {jobId}
                </Badge>
              </h3>
              <div className="flex items-center space-x-2 text-sm text-gray-500">
                <Badge variant="secondary" className={statusColor}>
                  {status || 'Initializing'}
                </Badge>
                {duration && (
                  <span className="flex items-center space-x-1">
                    <Clock className="w-3 h-3" />
                    <span>{duration}</span>
                  </span>
                )}
                {retryCount !== undefined && maxRetries !== undefined && (
                  <span className="flex items-center space-x-1">
                    <RefreshCcw className="w-3 h-3" />
                    <span>Retry {retryCount}/{maxRetries}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </Button>
        </div>

        {/* Resource usage */}
        {expanded && resources && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            {resources.cpu && (
              <div className="flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-gray-400" />
                <span className="text-sm">
                  CPU: {resources.cpu.used}/{resources.cpu.limit}
                </span>
              </div>
            )}
            {resources.memory && (
              <div className="flex items-center space-x-2">
                <Memory className="w-4 h-4 text-gray-400" />
                <span className="text-sm">
                  Memory: {resources.memory.used}/{resources.memory.limit}
                </span>
              </div>
            )}
            {resources.gpu && (
              <div className="flex items-center space-x-2">
                <HardDrive className="w-4 h-4 text-gray-400" />
                <span className="text-sm">
                  GPU: {resources.gpu.used}x {resources.gpu.type}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Progress for running jobs */}
      {status === 'RUNNING' && (
        <Progress value={isLoading ? undefined : 100} className="w-full" />
      )}

      {/* Main content area */}
      {expanded && (
        <div className="p-4">
          <Tabs 
            value={activeTab} 
            onValueChange={(value: string) => setActiveTab(value as 'logs' | 'artifacts' | 'metadata')}>
            <TabsList>
              <TabsTrigger value="logs" className="flex items-center space-x-1">
                <Terminal className="w-4 h-4" />
                <span>Logs</span>
              </TabsTrigger>
              {artifacts?.length ? (
                <TabsTrigger value="artifacts" className="flex items-center space-x-1">
                  <Box className="w-4 h-4" />
                  <span>Artifacts ({artifacts.length})</span>
                </TabsTrigger>
              ) : null}
              {metadata && Object.keys(metadata).length > 0 && (
                <TabsTrigger value="metadata" className="flex items-center space-x-1">
                  <Wifi className="w-4 h-4" />
                  <span>Details</span>
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="logs" className="mt-2">
              <ScrollArea className="h-[300px] w-full rounded-md border">
                <pre className="p-4 font-mono text-sm">
                  {logs.length > 0 ? (
                    logs.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap">
                        {line}
                      </div>
                    ))
                  ) : (
                    <span className="text-gray-400">No logs available yet...</span>
                  )}
                  <div ref={logEndRef} />
                </pre>
              </ScrollArea>

              {error && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                  {error}
                </div>
              )}

              <div className="mt-2 flex justify-end space-x-2">
                {status === 'RUNNING' && onCancel && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onCancel}
                  >
                    Cancel
                  </Button>
                )}
                {status === 'FAILED' && onRetry && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={onRetry}
                  >
                    Retry Job
                  </Button>
                )}
              </div>
            </TabsContent>

            {artifacts?.length && (
              <TabsContent value="artifacts" className="mt-2">
                <div className="space-y-2">
                  {artifacts.map((artifact) => (
                    <div
                      key={artifact.name}
                      className="flex items-center justify-between p-2 rounded-md border"
                    >
                      <div className="flex items-center space-x-2">
                        <Box className="w-4 h-4 text-gray-400" />
                        <span>{artifact.name}</span>
                        <span className="text-sm text-gray-500">
                          ({formatBytes(artifact.size)})
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDownload?.(artifact)}
                      >
                        Download
                      </Button>
                    </div>
                  ))}
                </div>
              </TabsContent>
            )}

            {metadata && Object.keys(metadata).length > 0 && (
              <TabsContent value="metadata" className="mt-2">
                <div className="rounded-md border divide-y">
                  {Object.entries(metadata).map(([key, value]) => (
                    <div key={key} className="flex p-2">
                      <span className="font-medium w-1/3">{key}</span>
                      <span className="text-gray-600">{value}</span>
                    </div>
                  ))}
                </div>
              </TabsContent>
            )}
          </Tabs>
        </div>
      )}
    </Card>
  );
}

// Helper to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default ComputeJobCard;