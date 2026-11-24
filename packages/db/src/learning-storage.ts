import { resolve } from 'node:path';
import { REPO_ROOT } from './env';
export const learningStorageRoot = (stagingDir: string) => resolve(REPO_ROOT, stagingDir, 'learning-private');

export const isLearningStoragePath = (path: string, stagingDir: string) => [learningStorageRoot(stagingDir), resolve(REPO_ROOT, 'apps/api', stagingDir, 'learning-private')].some(root => resolve(path).startsWith(root + '/'));
