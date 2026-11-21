import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const distApiDir = path.join(distDir, 'api');
const srcApiDir = path.join(rootDir, 'api');

console.log('[copy-build-assets] Preparing dist package for deployment...');

// Ensure dist exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 1. Copy api/ to dist/api/
if (fs.existsSync(srcApiDir)) {
  console.log('[copy-build-assets] Copying api/ to dist/api/...');
  fs.cpSync(srcApiDir, distApiDir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(srcApiDir, src);
      // Skip local dev demo data, logs or tests if any
      if (rel.startsWith('.local-demo-data') || rel.endsWith('.tmp')) {
        return false;
      }
      return true;
    }
  });
  console.log('[copy-build-assets] api/ copied successfully.');
}

// 2. Copy root .htaccess to dist/.htaccess to ensure all security & API routing rules are active
const rootHtaccess = path.join(rootDir, '.htaccess');
if (fs.existsSync(rootHtaccess)) {
  fs.copyFileSync(rootHtaccess, path.join(distDir, '.htaccess'));
  console.log('[copy-build-assets] Copied root .htaccess to dist/.htaccess');
}

console.log('[copy-build-assets] Build assets preparation completed successfully.');
