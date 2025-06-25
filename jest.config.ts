import type { JestConfigWithTsJest } from 'ts-jest';

const jestConfig: JestConfigWithTsJest = {
  preset: 'ts-jest/presets/default-esm',

  testEnvironment: 'jsdom',

  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },

  moduleNameMapper: {
  
    '^(\\.{1,2}/.*)\\.js$': '$1',

    '^~/(.*)$': '<rootDir>/src/$1',
  },
};

export default jestConfig;