import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:import.meta.dirname,envDir:false,envPrefix:'PREVIEW_UNUSED_',plugins:[{
  name:'synthetic-evidence-only',enforce:'pre',resolveId(id){if(id==='@/lib/supabase')return fileURLToPath(new URL('./supabase.ts',import.meta.url));},
},react(),tailwind()],resolve:{alias:[{find:'@/lib/supabase',replacement:fileURLToPath(new URL('./supabase.ts',import.meta.url))},{find:'@',replacement:fileURLToPath(new URL('../../src',import.meta.url))}]},server:{host:'127.0.0.1',port:47935,strictPort:true},build:{outDir:'../../.verification-results/learn-slack-evidence-preview',emptyOutDir:true}});
