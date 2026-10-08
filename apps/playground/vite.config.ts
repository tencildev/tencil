import react from '@vitejs/plugin-react';
import tencil from 'tencil/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react(), tencil()],
});
