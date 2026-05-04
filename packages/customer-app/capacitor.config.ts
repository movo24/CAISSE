import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.thewesley.club',
  appName: 'The Wesley Club',
  webDir: 'dist',
  ios: {
    contentInset: 'always',
    backgroundColor: '#0B0B10',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
