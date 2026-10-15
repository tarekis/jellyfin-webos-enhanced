const fs = require('fs');
const { defineConfig } = require('@playwright/test');

const localChromium = '/opt/pw-browsers/chromium';

module.exports = defineConfig({
    testDir: './test',
    workers: 1,
    fullyParallel: false,
    timeout: 30000,
    reporter: 'list',
    use: {
        browserName: 'chromium',
        launchOptions: fs.existsSync(localChromium) ? { executablePath: localChromium } : {}
    }
});
