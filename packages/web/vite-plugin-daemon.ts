/**
 * Vite 插件：在 Vite 开发服务器启动时自动启动内嵌的 DaemonServer
 *
 * 这样开发者只需要运行 `pnpm run dev` 或 `pnpm --filter @intentorch/web dev`，
 * 就能同时启动前端 Vite 开发服务器和后端 Daemon HTTP 服务（端口 9658），
 * 无需手动先启动 daemon。
 */

import type { Plugin, ViteDevServer } from 'vite';

let daemonServer: any = null;

export function daemonPlugin(): Plugin {
  return {
    name: 'vite-plugin-daemon',

    /**
     * 在 Vite 服务器启动前启动 Daemon
     */
    async configureServer(_server: ViteDevServer) {
      // 只在开发模式下启动 daemon
      if (process.env.NODE_ENV === 'production') {
        return;
      }

      // 如果已经启动了 daemon，跳过
      if (daemonServer) {
        return;
      }

      // 检查是否已经有 daemon 在运行（避免重复启动）
      try {
        const healthCheckUrl = `http://localhost:9658/api/status`;
        const response = await fetch(healthCheckUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          console.log('[daemon-plugin] Daemon is already running on port 9658, skipping auto-start');
          return;
        }
      } catch {
        // Daemon 未运行，需要启动
      }

      console.log('[daemon-plugin] Starting embedded DaemonServer...');

      try {
        const { DaemonServer } = await import('./src/daemon/server.js');
        daemonServer = new DaemonServer({
          host: 'localhost',
          port: 9658,
        });

        await daemonServer.start();
        console.log('[daemon-plugin] ✅ DaemonServer started on http://localhost:9658');
      } catch (error) {
        console.error('[daemon-plugin] ❌ Failed to start DaemonServer:', error);
        console.warn('[daemon-plugin] The web app will still work, but API calls to daemon will fail.');
      }
    },

    /**
     * Vite 服务器真正关闭时停止 Daemon
     * 注意：使用 closeServer 而不是 closeBundle，
     * 因为 closeBundle 在热重载时也会触发，会导致 daemon 被错误停止。
     */
    async closeServer() {
      if (daemonServer) {
        console.log('[daemon-plugin] Stopping DaemonServer...');
        try {
          await daemonServer.stop();
          console.log('[daemon-plugin] ✅ DaemonServer stopped');
        } catch (error) {
          console.error('[daemon-plugin] Error stopping DaemonServer:', error);
        }
        daemonServer = null;
      }
    },
  };
}
