import type { NextConfig } from 'next';
const config: NextConfig = { poweredByHeader: false, distDir: process.env.WORKSPACE_QA_BUILD === '1' ? '.next-qa' : '.next' };
export default config;
