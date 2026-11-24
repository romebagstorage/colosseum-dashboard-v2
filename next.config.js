/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // Serve solo alla modalità demo (DEMO_PAYLOAD=1): include data/ nel bundle serverless.
  // Da Next 15 l'opzione sta fuori da `experimental`.
  outputFileTracingIncludes: { '/': ['./data/**'], '/api/data': ['./data/**'] },
};
