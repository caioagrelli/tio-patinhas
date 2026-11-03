module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.spec.ts'],
  // Browser tests run with Playwright (npm run test:e2e), not Jest.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/e2e/'],
  testTimeout: 120000,
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.server.json' }] },
  collectCoverageFrom: ['server/src/**/*.ts', 'shared/**/*.ts'],
  coveragePathIgnorePatterns: ['/main.ts'],
  coverageReporters: ['text', 'lcov', 'html'],
};
