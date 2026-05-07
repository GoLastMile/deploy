/**
 * LastMile API Client
 */

const API_BASE = 'https://api.lastmile.sh';

export interface StartDeploymentResponse {
  deploymentId: string;
  status: string;
  url?: string;
  error?: string;
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
    projectName?: string;
    withDatabase?: boolean;
  }): Promise<StartDeploymentResponse> {
    // Use cloud deploy endpoint which actually deploys to Railway
    const response = await this.request<{
      id: string;
      status: string;
      url?: string;
      error?: string;
    }>('POST', '/v1/cloud/deploy', {
      projectName: data.projectName || this.extractProjectName(data.repoUrl),
      repoUrl: data.repoUrl,
      branch: data.branch,
      withDatabase: data.withDatabase || false,
    });

    return {
      deploymentId: response.id,
      status: response.status,
      url: response.url,
      error: response.error,
    };
  }

  private extractProjectName(repoUrl: string): string {
    // Extract repo name from URL: https://github.com/owner/repo -> repo
    const match = repoUrl.match(/\/([^\/]+?)(?:\.git)?$/);
    return match ? match[1] : 'app';
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

  async getDeploymentStatus(deploymentId: string): Promise<{
    id: string;
    status: string;
    url?: string;
    error?: string;
  }> {
    return this.request<{
      id: string;
      status: string;
      url?: string;
      error?: string;
    }>('GET', `/v1/cloud/deploy/${deploymentId}`);
  }

  /**
   * Poll for deployment completion
   * Returns when status is 'live' or 'failed', or timeout
   */
  async waitForDeployment(
    deploymentId: string,
    timeoutMs: number = 10 * 60 * 1000, // 10 minutes
    pollIntervalMs: number = 5000
  ): Promise<{ status: string; url?: string; error?: string }> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.getDeploymentStatus(deploymentId);

      if (result.status === 'live') {
        return { status: 'success', url: result.url };
      }

      if (result.status === 'failed') {
        return { status: 'failed', error: result.error };
      }

      // Still in progress - wait and poll again
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    return { status: 'timeout', error: 'Deployment timed out after 10 minutes' };
  }
}
