/** @type {import('next').NextConfig} */
const nextConfig = {
  // These packages use Node APIs / native deps and must not be bundled by Next
  // when used in server code (route handlers, server components).
  serverExternalPackages: ["@prisma/client", "prisma", "cheerio", "playwright", "exceljs"],
};

export default nextConfig;
