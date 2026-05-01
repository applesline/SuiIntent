/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/kernel/__tests__/',
  ],
  // 不忽略任何 node_modules，让 babel-jest 处理所有 ESM 模块
  transformIgnorePatterns: [],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        types: ['jest', 'node'],
        strict: false,
        noImplicitAny: false,
      },
      useESM: true,
    }],
    // 转换所有 .mjs 和 .js 文件（包括 node_modules 中的 ESM 包）
    '^.+\\.m?js$': ['babel-jest', { configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // 告诉 Jest .ts 文件是 ESM
  extensionsToTreatAsEsm: ['.ts'],
  cache: false,
};

module.exports = config;
