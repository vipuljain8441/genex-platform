function hostnameFrom(value) {
  if (!value) return null;
  try {
    return new URL(value).hostname || null;
  } catch {
    return value.replace(/^https?:\/\//, "").split("/")[0]?.split(":")[0] || null;
  }
}

const allowedDevOrigins = Array.from(
  new Set(
    [
      "localhost",
      "127.0.0.1",
      hostnameFrom(process.env.PUBLIC_HOST),
      hostnameFrom(process.env.APP_BASE_URL),
      hostnameFrom(process.env.NEXT_PUBLIC_API_URL),
      hostnameFrom(process.env.NEXT_PUBLIC_SANDBOX_URL),
    ].filter(Boolean)
  )
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  allowedDevOrigins,
};

export default nextConfig;
