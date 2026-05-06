export interface Workflow {
  id?: string; // UUID identifier
  name: string;
  version: string;
  description?: string;
  requirements: {
    servers: string[]; // List of server names or manifest paths
  };
  inputs: WorkflowInput[];
  steps: WorkflowStep[];
  outputs?: Record<string, string>; // Mapping of final output name to {{ref}}
  createdAt?: string; // ISO timestamp
  updatedAt?: string; // ISO timestamp
  originalName?: string; // Original name for reference (when using UUID as filename)
  lastExecutedAt?: string; // Added for frontend compatibility
}

export interface WorkflowInput {
  id: string;
  type: "string" | "number" | "boolean";
  description?: string;
  default?: any;
  required?: boolean;
}

export interface WorkflowStep {
  id: string;
  type?: string; // Added for frontend compatibility: 'server' | 'tool' | 'condition' | 'loop'
  serverName?: string; // Made optional to support serverId
  serverId?: string; // Added to support older format
  toolName: string;
  description?: string; // Human-readable description of the step
  dependsOn?: string[]; // IDs of steps this step depends on
  parameters: Record<string, any>;
  if?: string; // Condition expression, e.g., "{{analysis.score > 5}}"
  retry?: {
    maxAttempts: number;
    delayMs: number;
  };
}

export interface WorkflowContext {
  inputs: Record<string, any>;
  state: Record<string, any>; // Stores step results: { stepId: { result: ... } }
  secrets: Record<string, string>;
}
