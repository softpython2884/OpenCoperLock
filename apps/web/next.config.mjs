/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a minimal standalone server bundle for the Docker image.
  output: 'standalone',
  reactStrictMode: true,
  // Allow importing the workspace shared package (TS source) into the app.
  transpilePackages: ['@opencoperlock/shared'],
};

export default nextConfig;
