import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // 主进程各模块依赖 electron mock 与临时目录，串行避免端口/文件相互影响
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }
  }
})
