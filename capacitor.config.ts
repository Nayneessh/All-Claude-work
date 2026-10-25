import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.monstergains.app',
  appName: 'Monster Gains',
  webDir: 'dist',
  backgroundColor: '#071F16',
  android: { allowMixedContent: false, backgroundColor: '#071F16' },
  plugins: {
    SplashScreen: { launchShowDuration: 900, backgroundColor: '#071F16', showSpinner: false, launchAutoHide: true },
    Keyboard: { resize: 'body', resizeOnFullScreen: true },
    StatusBar: { style: 'DARK', backgroundColor: '#071F16', overlaysWebView: false },
  },
};

export default config;
