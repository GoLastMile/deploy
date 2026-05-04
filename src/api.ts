/**
 * LastMile API Client
 */

const API_BASE = 'https://api.lastmile.sh';

export interface StartDeploymentResponse {
  deploymentId: string;
  status: string;
}

export interface FixFile {
  path: string;
  content: string;
  action: 'create' | 'modify' | 'delete';
}

export interface AnalyzeFailureResponse {
  fixable: boolean;
  fix?: {
    commitMessage: string;
    files: FixFile[];
  };
  requiresUserInput?: {
    type: string;
    message: string;
    variables?: string[];
  };
  giveUp?: {
    reason: string;
  };
}

export interface CompleteDeploymentResponse {
  success: boolean;
}

export class LastMileAPI {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || API_BASE;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API request failed: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  async startDeployment(data: {
    repoUrl: string;
    branch: string;
    commitSha?: string;
  }): Promise<StartDeploymentResponse> {
    return this.request<StartDeploymentResponse>('POST', '/v1/deploy/start', data);
  }

  async analyzeFailure(data: {
    deploymentId: string;
    railwayDeploymentId: string;
    attempt: number;
    files?: Record<string, string>;
    stack?: {
      language: string | null;
      framework: string | null;
      database: string | null;
      orm: string | null;
      buildTool: string | null;
      packageManager: string | null;
    };
  }): Promise<AnalyzeFailureResponse> {
    return this.request<AnalyzeFailureResponse>('POST', '/v1/deploy/analyze-failure', data);
  }

  async completeDeployment(data: {
    deploymentId: string;
    status: 'success' | 'failed';
    url?: string;
    error?: string;
  }): Promise<CompleteDeploymentResponse> {
    return this.request<CompleteDeploymentResponse>('POST', '/v1/deploy/complete', data);
  }
}
