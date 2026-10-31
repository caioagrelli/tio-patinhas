module.exports = {
  preset: 'ts-jest', testEnvironment: 'node', roots: ['<rootDir>/tests'],
  testMatch: ['**/*.spec.ts'], testTimeout: 120000,
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.server.json' }] },
  collectCoverageFrom: ['server/src/**/*.ts', 'shared/**/*.ts'],
  coveragePathIgnorePatterns: ['/main.ts'], coverageReporters: ['text', 'lcov', 'html'],
};
