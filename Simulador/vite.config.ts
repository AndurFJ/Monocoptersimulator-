import { defineConfig } from 'vite';

export default defineConfig({
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
