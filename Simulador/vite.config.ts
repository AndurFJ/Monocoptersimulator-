import { defineConfig } from 'vite';
import { remoteBridge } from './server/remoteBridge.ts';

export default defineConfig({
  // Puente WebSocket del control remoto desde el teléfono (/remote)
  plugins: [remoteBridge()],
  build: {
    rolldownOptions: {
      // Tres páginas: el simulador, el mando del teléfono y el diseño del PID
      input: {
        main: 'index.html',
        control: 'control.html',
        diseno: 'diseno.html',
      },
    },
  },
  server: {
    watch: {
      ignored: [
        '**/.git/**',
        '**/.*.tmpdir/**',
        '**/*.tmp*',
        '**/.*/**',
        '**/firmware/**',
        '**/sketch_sep19a/**',
        '**/*.md'
      ]
    }
  }
});
