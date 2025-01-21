import MonacoWebpackPlugin from "monaco-editor-webpack-plugin";

/** @type {import("next").NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Monaco Editor 웹 워커 설정
    if (!isServer) {
      config.plugins.push(
        new MonacoWebpackPlugin({
          languages: ["typescript", "javascript", "css", "html", "json", "rust"],
          filename: "static/[name].worker.js",
          publicPath: "_next",
        }),
      );
    }
    return config;
  },
};

export default nextConfig;
