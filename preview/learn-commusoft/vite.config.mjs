import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import path from 'node:path';
const root=import.meta.dirname;
export default defineConfig({root,envDir:false,envPrefix:'PREVIEW_UNUSED_',plugins:[react()],resolve:{alias:[{find:'@/lib/supabase',replacement:path.join(root,'fixture.ts')},{find:'@',replacement:path.resolve(root,'../../src')}],dedupe:['react','react-dom']},build:{outDir:'dist',emptyOutDir:true},preview:{host:'127.0.0.1',port:47874,strictPort:true}});
