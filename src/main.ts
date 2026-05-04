/**
 * LastMile Deploy GitHub Action
 *
 * Deploys to Railway with automatic error fixing.
 * On failure, calls LastMile API to get a fix, commits it, and pushes.
 * The push triggers a new workflow run (retry loop).
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import { LastMileAPI } from './api.js';
import { RailwayClient, getRailwayContext } from './railway.js';
import {
  parseRetryMetadata,
  commitAndPush,
  readProjectFiles,
  writeFixFiles,
} from './git.js';

async function run(): Promise<void> {
  try {
    // Get inputs
    const apiKey = core.getInput('api-key', { required: true });
    const maxAttempts = parseInt(core.getInput('max-attempts') || '5', 10);
    const railwayToken = core.getInput('railway-token');

    // Initialize API client
    const api = new LastMileAPI(apiKey);

    // Parse retry metadata from last commit
    const retryMeta = await parseRetryMetadata();
    const currentAttempt = retryMeta ? retryMeta.attempt + 1 : 1;
    const effectiveMax = retryMeta?.max || maxAttempts;

    core.info(`Attempt ${currentAttempt} of ${effectiveMax}`);

    // Check if we've exceeded max attempts
    if (currentAttempt > effectiveMax) {
      core.setFailed(`Max attempts (${effectiveMax}) exceeded. Manual intervention required.`);
      return;
    }

    // Get GitHub context
    const repo = process.env.GITHUB_REPOSITORY || '';
    const branch = github.context.ref.replace('refs/heads/', '');
    const commitSha = github.context.sha;

    core.info(`Deploying ${repo}@${branch} (${commitSha.substring(0, 7)})`);

    // Register deployment with LastMile
    const { deploymentId } = await api.startDeployment({
      repoUrl: `https://github.com/${repo}`,
      branch,
      commitSha,
    });

    core.info(`Deployment registered: ${deploymentId}`);

    // Check if we have Railway context (means Railway GitHub integration is active)
    const railwayContext = getRailwayContext();

    let deploymentSuccess = false;
    let deploymentUrl: string | undefined;
    let railwayDeploymentId: string | undefined;

    if (railwayContext.serviceId && railwayContext.environmentId && railwayToken) {
      // Railway GitHub integration is handling the deployment
      // We just need to wait for it to complete
      core.info('Waiting for Railway deployment...');

      const railway = new RailwayClient(railwayToken);
      const deployment = await railway.waitForDeployment(
        railwayContext.serviceId,
        railwayContext.environmentId
      );

      railwayDeploymentId = deployment.id;
      deploymentSuccess = deployment.status === 'SUCCESS';
      deploymentUrl = deployment.url;

      core.info(`Railway deployment ${deployment.status}: ${deploymentUrl || 'no URL'}`);
    } else {
      // No Railway integration - deployment is handled elsewhere
      // For now, we assume the deployment happens via Railway's native GitHub integration
      // and we're just called to handle failures
      core.info('No Railway token provided - assuming deployment is handled externally');
      core.info('This action will only handle fix generation if called after a failure');

      // Check if this is being run after a failure (indicated by retry metadata)
      if (!retryMeta) {
        core.info('First run without Railway token - nothing to do');
        core.info('Configure Railway GitHub integration or provide railway-token input');
        return;
      }

      // We're in a retry loop, so previous deployment must have failed
      deploymentSuccess = false;
      railwayDeploymentId = 'unknown';
    }

    if (deploymentSuccess) {
      // Success! Mark complete and exit
      await api.completeDeployment({
        deploymentId,
        status: 'success',
        url: deploymentUrl,
      });

      core.setOutput('url', deploymentUrl);
      core.setOutput('status', 'success');
      core.setOutput('attempt', currentAttempt);

      core.info(`Deployment successful: ${deploymentUrl}`);
      return;
    }

    // Deployment failed - get fix from LastMile
    core.info('Deployment failed. Analyzing error...');

    // Read project files for context
    const files = await readProjectFiles();
    core.info(`Read ${Object.keys(files).length} files for analysis`);

    // Call LastMile API to analyze failure and get fix
    const analysis = await api.analyzeFailure({
      deploymentId,
      railwayDeploymentId: railwayDeploymentId || 'unknown',
      attempt: currentAttempt,
      files,
    });

    if (!analysis.fixable) {
      // Can't fix automatically
      if (analysis.requiresUserInput) {
        core.setFailed(
          `Missing required input: ${analysis.requiresUserInput.message}\n` +
          `Variables needed: ${analysis.requiresUserInput.variables?.join(', ') || 'unknown'}`
        );
      } else if (analysis.giveUp) {
        core.setFailed(`Cannot auto-fix: ${analysis.giveUp.reason}`);
      } else {
        core.setFailed('Cannot auto-fix this error');
      }

      await api.completeDeployment({
        deploymentId,
        status: 'failed',
        error: analysis.giveUp?.reason || analysis.requiresUserInput?.message || 'Unfixable error',
      });

      core.setOutput('status', 'failed');
      core.setOutput('attempt', currentAttempt);
      return;
    }

    // Apply the fix
    core.info(`Applying fix: ${analysis.fix!.commitMessage}`);

    await writeFixFiles(analysis.fix!.files);

    // Commit and push (this triggers a new workflow run)
    await commitAndPush(
      analysis.fix!.commitMessage,
      currentAttempt,
      effectiveMax
    );

    core.info('Fix committed and pushed. New workflow run will start automatically.');
    core.setOutput('status', 'retrying');
    core.setOutput('attempt', currentAttempt);

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

run();
