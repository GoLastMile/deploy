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

    // Start deployment with LastMile (this actually deploys to Railway)
    const deployment = await api.startDeployment({
      repoUrl: `https://github.com/${repo}`,
      branch,
      commitSha,
    });

    const deploymentId = deployment.deploymentId;
    core.info(`Deployment started: ${deploymentId}`);
    core.info(`Status: ${deployment.status}`);

    // Check deployment result from LastMile API (which deployed to Railway)
    const deploymentSuccess = deployment.status === 'live' || deployment.status === 'success';
    const deploymentUrl = deployment.url;
    const deploymentError = deployment.error;

    if (deploymentSuccess) {
      core.info(`Deployment successful: ${deploymentUrl}`);
    } else if (deploymentError) {
      core.info(`Deployment failed: ${deploymentError}`);
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
      railwayDeploymentId: deploymentId, // Use our deployment ID
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
