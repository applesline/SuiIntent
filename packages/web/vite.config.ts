import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { daemonPlugin } from './vite-plugin-daemon'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), daemonPlugin()],
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
    port: 5173,
  },
  resolve: {
    dedupe: [
      // Deduplicate d3-selection to ensure d3-transition and reactflow
      // share the same d3-selection instance.
      // d3-transition patches selection.prototype.interrupt and
      // selection.prototype.transition, but if reactflow uses a different
      // d3-selection instance, the patch won't apply.
      'd3-selection',
    ],
  },
  optimizeDeps: {
    include: [
      // Ensure d3-selection is pre-bundled as a shared chunk so that
      // both d3-transition and reactflow's internal d3-zoom use the
      // same d3-selection instance. Without this, each package inlines
      // its own copy of d3-selection, and d3-transition's patches to
      // selection.prototype (interrupt, transition) won't apply to the
      // instance used by reactflow.
      'd3-selection',
      // Ensure d3-transition is pre-bundled so its selection.prototype
      // patches (interrupt, transition) are applied to the shared
      // d3-selection instance used by reactflow's internal d3-zoom.
      'd3-transition',
    ],
  },
})
