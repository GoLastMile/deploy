/**
 * Railway deployment utilities
 *
 * Note: This is a simplified client. The actual deployment is triggered
 * by Railway's GitHub integration when we push to the repo.
 * We just need to check the deployment status.
 */

import * as core from '@actions/core';

const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';

export interface DeploymentStatus {
  id: string;
  status: 'BUILDING' | 'DEPLOYING' | 'SUCCESS' | 'FAILED' | 'CRASHED' | 'REMOVED' | 'QUEUED';
  url?: string;
}

export class RailwayClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(RAILWAY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Railway API error: ${response.status}`);
    }

    const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };

    if (json.errors?.length) {
      throw new Error(`Railway GraphQL error: ${json.errors[0].message}`);
    }

    return json.data as T;
  }

  /**
   * Get the latest deployment for a service
   */
  async getLatestDeployment(serviceId: string, environmentId: string): Promise<DeploymentStatus | null> {
    const query = `
      query GetDeployments($serviceId: String!, $environmentId: String!) {
        deployments(
          first: 1
          input: { serviceId: $serviceId, environmentId: $environmentId }
        ) {
          edges {
            node {
              id
              status
              staticUrl
            }
          }
        }
      }
    `;

    interface Response {
      deployments: {
        edges: Array<{
          node: {
            id: string;
            status: DeploymentStatus['status'];
            staticUrl?: string;
          };
        }>;
      };
    }

    const data = await this.query<Response>(query, { serviceId, environmentId });
    const deployment = data.deployments.edges[0]?.node;

    if (!deployment) {
      return null;
    }

    return {
      id: deployment.id,
      status: deployment.status,
      url: deployment.staticUrl,
    };
  }

  /**
   * Wait for deployment to complete (success or failure)
   */
  async waitForDeployment(
    serviceId: string,
    environmentId: string,
    timeoutMs: number = 10 * 60 * 1000
  ): Promise<DeploymentStatus> {
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds

    while (Date.now() - startTime < timeoutMs) {
      const deployment = await this.getLatestDeployment(serviceId, environmentId);

      if (!deployment) {
        core.info('Waiting for deployment to start...');
        await sleep(pollInterval);
        continue;
      }

      core.info(`Deployment status: ${deployment.status}`);

      if (['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED'].includes(deployment.status)) {
        return deployment;
      }

      await sleep(pollInterval);
    }

    throw new Error('Deployment timed out');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Detect Railway service/environment from environment variables
 * These are set when Railway's GitHub integration triggers a build
 */
export function getRailwayContext(): { serviceId?: string; environmentId?: string; deploymentId?: string } {
  return {
    serviceId: process.env.RAILWAY_SERVICE_ID,
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID,
  };
}
