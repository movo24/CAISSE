import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.addxintelligence.poscaisse',
  appName: 'CAISSE POS',
  webDir: 'dist',
  server: {
    // For dev on local network, uncomment and set your IP:
    // url: 'http://192.168.x.x:5175',
    iosScheme: 'capacitor',
    allowNavigation: ['api.addxintelligence.com'],
  },
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
    scrollEnabled: false,
    limitsNavigationsToAppBoundDomains: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true, // Route HTTP through native — bypasses CORS
    },
  },
};

export default config;
