/**
 * Git utilities for committing and pushing fixes
 */

import * as exec from '@actions/exec';
import * as core from '@actions/core';

export interface RetryMetadata {
  attempt: number;
  max: number;
}

/**
 * Parse retry metadata from the last commit message
 * Format: [lastmile:attempt=N,max=M]
 */
export async function parseRetryMetadata(): Promise<RetryMetadata | null> {
  let commitMessage = '';

  await exec.exec('git', ['log', '-1', '--pretty=%B'], {
    listeners: {
      stdout: (data: Buffer) => {
        commitMessage += data.toString();
      },
    },
    silent: true,
  });

  const match = commitMessage.match(/\[lastmile:attempt=(\d+),max=(\d+)\]/);
  if (match) {
    return {
      attempt: parseInt(match[1], 10),
      max: parseInt(match[2], 10),
    };
  }

  return null;
}

/**
 * Commit and push fix files
 */
export async function commitAndPush(
  commitMessage: string,
  attempt: number,
  maxAttempts: number
): Promise<void> {
  // Configure git
  await exec.exec('git', ['config', 'user.name', 'LastMile Bot']);
  await exec.exec('git', ['config', 'user.email', 'bot@lastmile.sh']);

  // Stage all changes
  await exec.exec('git', ['add', '-A']);

  // Check if there are changes to commit
  let hasChanges = false;
  await exec.exec('git', ['diff', '--staged', '--quiet'], {
    ignoreReturnCode: true,
  }).then((exitCode) => {
    hasChanges = exitCode !== 0;
  }).catch(() => {
    hasChanges = true;
  });

  if (!hasChanges) {
    core.warning('No changes to commit');
    return;
  }

  // Create commit with retry metadata
  const fullMessage = `${commitMessage}\n\n[lastmile:attempt=${attempt},max=${maxAttempts}]`;
  await exec.exec('git', ['commit', '-m', fullMessage]);

  // Push changes
  await exec.exec('git', ['push']);

  core.info(`Committed and pushed fix (attempt ${attempt}/${maxAttempts})`);
}

/**
 * Read files from the current directory for sending to API
 */
export async function readProjectFiles(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  // Read key files that are commonly needed for fix generation
  const keyFiles = [
    'package.json',
    'tsconfig.json',
    'next.config.js',
    'next.config.mjs',
    'vite.config.ts',
    'drizzle.config.ts',
    'prisma/schema.prisma',
  ];

  const fs = await import('fs/promises');
  const path = await import('path');

  for (const file of keyFiles) {
    try {
      const content = await fs.readFile(path.join(process.cwd(), file), 'utf-8');
      files[file] = content;
    } catch {
      // File doesn't exist, skip
    }
  }

  // Also read src/ directory structure for context
  try {
    const srcFiles = await walkDir(path.join(process.cwd(), 'src'), 'src');
    Object.assign(files, srcFiles);
  } catch {
    // No src directory
  }

  return files;
}

async function walkDir(dir: string, prefix: string): Promise<Record<string, string>> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const files: Record<string, string> = {};

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(prefix, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and common ignored dirs
        if (['node_modules', '.git', 'dist', 'build', '.next'].includes(entry.name)) {
          continue;
        }
        const subFiles = await walkDir(fullPath, relativePath);
        Object.assign(files, subFiles);
      } else if (entry.isFile()) {
        // Only read source files
        if (/\.(ts|tsx|js|jsx|json|css|scss|html|md)$/.test(entry.name)) {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            // Skip large files
            if (content.length < 100000) {
              files[relativePath] = content;
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }

  return files;
}

/**
 * Write fix files to disk
 */
export async function writeFixFiles(
  files: Array<{ path: string; content: string; action: string }>
): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  for (const file of files) {
    const fullPath = path.join(process.cwd(), file.path);

    if (file.action === 'delete') {
      try {
        await fs.unlink(fullPath);
        core.info(`Deleted: ${file.path}`);
      } catch {
        // File doesn't exist
      }
    } else {
      // Create directory if needed
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, file.content);
      core.info(`Wrote: ${file.path}`);
    }
  }
}
