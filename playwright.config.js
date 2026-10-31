import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',use:{baseURL:'http://127.0.0.1:8080',headless:true},webServer:{command:'python3 -m http.server 8080 --bind 127.0.0.1',url:'http://127.0.0.1:8080',reuseExistingServer:true},workers:1});
